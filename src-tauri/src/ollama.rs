//! Local Ollama integration.
//!
//! Bridges the Tauri webview to a user-run Ollama server (`localhost:11434` by
//! default) over HTTP via `reqwest`. Four commands cover the surface:
//! list models, test connection, streaming generate, and cancel.
//!
//! Generation is NDJSON-streamed: `POST /api/generate` with `stream:true`
//! returns newline-delimited JSON objects. We line-buffer the raw byte stream
//! (chunks split mid-line), parse complete lines, and forward each token delta
//! to the webview as a Tauri event — mirroring `ingest.rs`'s WS text handling.
//!
//! The backend is stateless per request: config (base URL, model, options) is
//! passed in from frontend prefs on every call. The only module-level state is
//! the cancellation map and a lazily-built shared `reqwest::Client`. Nothing
//! here panics; errors are surfaced as `Err(String)` or `ollama://error` emits
//! and otherwise logged like `ingest.rs`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// Connect timeout — fail fast when Ollama is absent / unreachable.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Total timeout for the short request/response calls (list, test). Generation
/// deliberately has no overall timeout: it is long-running and relies on the
/// NDJSON stream plus user-driven cancellation instead.
const SHORT_TIMEOUT: Duration = Duration::from_secs(5);

/// Shared client for the short list/test calls (3s connect, 5s total).
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(SHORT_TIMEOUT)
        .build()
        .unwrap_or_default()
});

/// Shared client for streaming generation: same connect timeout, but no overall
/// timeout so long completions are not cut off mid-stream.
static STREAM_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .unwrap_or_default()
});

/// `request_id -> cancel flag`. Set by `ollama_generate`, flipped by
/// `ollama_cancel`, checked between NDJSON chunks. Module-level like ingest's
/// `METRICS`; no Tauri `.manage()` state needed.
static CANCELS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// A model entry from `GET /api/tags`.
#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub modified_at: Option<String>,
}

/// Health summary returned by `ollama_test_connection`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealth {
    pub ok: bool,
    pub model_count: usize,
    pub version: Option<String>,
}

/// Shape of `GET /api/tags`. Other fields ignored.
#[derive(Debug, Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<OllamaModel>,
}

/// Trim trailing slashes so `{base}/api/...` never produces a double slash.
fn join(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

/// `GET {base_url}/api/tags` → the model list.
#[tauri::command]
pub async fn ollama_list_models(base_url: String) -> Result<Vec<OllamaModel>, String> {
    let url = join(&base_url, "/api/tags");
    let resp = CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| reach_error(&base_url, &e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned {} for {}", resp.status(), url));
    }

    let tags: TagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse Ollama model list: {e}"))?;

    Ok(tags.models)
}

/// `GET {base_url}/api/tags` as a liveness probe (Ollama has no `/health`).
/// Version is best-effort from `GET /api/version`.
#[tauri::command]
pub async fn ollama_test_connection(base_url: String) -> Result<OllamaHealth, String> {
    let tags_url = join(&base_url, "/api/tags");
    let resp = CLIENT
        .get(&tags_url)
        .send()
        .await
        .map_err(|e| reach_error(&base_url, &e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned {} for {}", resp.status(), tags_url));
    }

    let tags: TagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse Ollama response: {e}"))?;

    // Best-effort version; absence is not an error.
    let version = match CLIENT.get(join(&base_url, "/api/version")).send().await {
        Ok(r) if r.status().is_success() => r
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(String::from)),
        _ => None,
    };

    Ok(OllamaHealth {
        ok: true,
        model_count: tags.models.len(),
        version,
    })
}

/// `POST {base_url}/api/generate` with `stream:true`. Spawns a background task
/// on Tauri's runtime that line-buffers the NDJSON byte stream and emits:
/// - `ollama://token/{request_id}` — `String` token delta, per chunk
/// - `ollama://done/{request_id}`  — `{ ok, evalCount?, totalDurationMs? }`
/// - `ollama://error/{request_id}` — `String`, on any failure
///
/// Returns immediately after spawning; streaming happens off-thread.
#[tauri::command]
pub fn ollama_generate(
    app: AppHandle,
    request_id: String,
    base_url: String,
    model: String,
    prompt: String,
    system: Option<String>,
    options: Option<Value>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    CANCELS.lock().insert(request_id.clone(), cancel.clone());

    tauri::async_runtime::spawn(async move {
        let token_ch = format!("ollama://token/{request_id}");
        let done_ch = format!("ollama://done/{request_id}");
        let error_ch = format!("ollama://error/{request_id}");

        // Drop the cancel-map entry however this task exits.
        let _guard = CancelGuard(request_id.clone());

        let mut body = json!({
            "model": model,
            "prompt": prompt,
            "stream": true,
        });
        if let Some(sys) = system {
            body["system"] = json!(sys);
        }
        if let Some(opts) = options {
            body["options"] = opts;
        }

        let url = join(&base_url, "/api/generate");
        let resp = match STREAM_CLIENT.post(&url).json(&body).send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit(&error_ch, reach_error(&base_url, &e));
                return;
            }
        };

        let status = resp.status();
        if !status.is_success() {
            // Surface a helpful pull hint on 404 (unknown model).
            let msg = if status.as_u16() == 404 {
                format!("model '{model}' not found — run `ollama pull {model}`")
            } else {
                let detail = resp.text().await.unwrap_or_default();
                let detail = detail.trim();
                if detail.is_empty() {
                    format!("Ollama returned {status}")
                } else {
                    format!("Ollama returned {status}: {detail}")
                }
            };
            let _ = app.emit(&error_ch, msg);
            return;
        }

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();

        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                // User-requested stop: end quietly without a done/error emit.
                return;
            }

            let bytes = match chunk {
                Ok(b) => b,
                Err(e) => {
                    let _ = app.emit(&error_ch, format!("stream error: {e}"));
                    return;
                }
            };
            buf.extend_from_slice(&bytes);

            // Parse every complete line; retain the trailing partial line.
            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buf.drain(..=nl).collect();
                let line = &line[..line.len() - 1]; // drop the '\n'
                if line.is_empty() {
                    continue;
                }

                let value: Value = match serde_json::from_slice(line) {
                    Ok(v) => v,
                    Err(_) => continue, // skip malformed lines, keep streaming
                };

                // Ollama may report an error inline in the NDJSON.
                if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
                    let _ = app.emit(&error_ch, err.to_string());
                    return;
                }

                if let Some(delta) = value.get("response").and_then(|r| r.as_str()) {
                    if !delta.is_empty() {
                        let _ = app.emit(&token_ch, delta.to_string());
                    }
                }

                if value.get("done").and_then(Value::as_bool).unwrap_or(false) {
                    let eval_count = value.get("eval_count").and_then(Value::as_u64);
                    let total_ms = value
                        .get("total_duration")
                        .and_then(Value::as_u64)
                        .map(|ns| ns / 1_000_000);
                    let _ = app.emit(
                        &done_ch,
                        json!({
                            "ok": true,
                            "evalCount": eval_count,
                            "totalDurationMs": total_ms,
                        }),
                    );
                    return;
                }
            }
        }

        // Stream ended without an explicit `done:true` — treat as completed.
        let _ = app.emit(&done_ch, json!({ "ok": true }));
    });

    Ok(())
}

/// Trip the cancel flag for `request_id`, if it is still in flight. A no-op for
/// unknown / already-finished requests.
#[tauri::command]
pub fn ollama_cancel(request_id: String) -> Result<(), String> {
    if let Some(flag) = CANCELS.lock().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Removes a request's cancel-map entry on drop, so the spawned task cannot leak
/// the entry on any early return.
struct CancelGuard(String);

impl Drop for CancelGuard {
    fn drop(&mut self) {
        CANCELS.lock().remove(&self.0);
    }
}

/// Map a reqwest send error into a user-facing "couldn't reach" message,
/// distinguishing timeouts from connection failures.
fn reach_error(base_url: &str, e: &reqwest::Error) -> String {
    if e.is_timeout() {
        format!("Timed out reaching Ollama at {base_url}")
    } else if e.is_connect() {
        format!("Couldn't reach Ollama at {base_url} — is `ollama serve` running?")
    } else {
        format!("Couldn't reach Ollama at {base_url}: {e}")
    }
}
