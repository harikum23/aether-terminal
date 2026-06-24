//! Aether Agent Protocol (AAP) ingestion server.
//!
//! Runs a small axum HTTP+WebSocket server on `127.0.0.1:{port}` that receives
//! opaque JSON agent-telemetry events and forwards each JSON object to the
//! webview as a Tauri `agent://event`. Events are treated as opaque
//! `serde_json::Value`s — we only check they are JSON objects, never deserialize
//! into typed structs.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::Emitter;
use tower_http::cors::CorsLayer;

/// Default port the ingestion server listens on. Mirrored in the SDKs and the
/// frontend (`ws://127.0.0.1:9700/ws`, `http://127.0.0.1:9700/ingest`).
pub const PORT: u16 = 9700;

/// The Tauri event channel every forwarded agent event is emitted on.
const EVENT: &str = "agent://event";

/// Liveness/throughput metrics so the UI can distinguish "server down" from
/// "server up but no events arriving" (a silently-misconfigured hook).
struct Metrics {
    running: AtomicBool,
    received: AtomicU64,
    last_event_ms: AtomicU64,
}

static METRICS: LazyLock<Metrics> = LazyLock::new(|| Metrics {
    running: AtomicBool::new(false),
    received: AtomicU64::new(0),
    last_event_ms: AtomicU64::new(0),
});

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Shared handler state: just the Tauri app handle used to emit events.
#[derive(Clone)]
struct AppState {
    app: tauri::AppHandle,
}

/// Forward a single value to the webview, but only if it is a JSON object.
/// Returns `true` if the value was an object and was emitted.
fn forward(app: &tauri::AppHandle, value: Value) -> bool {
    if value.is_object() {
        let _ = app.emit(EVENT, value);
        METRICS.received.fetch_add(1, Ordering::Relaxed);
        METRICS.last_event_ms.store(now_ms(), Ordering::Relaxed);
        true
    } else {
        false
    }
}

/// Start the ingestion server on Tauri's tokio runtime. Never panics: bind
/// failures are reported via `agent://server-status` and `eprintln!`.
pub fn start(app: tauri::AppHandle, port: u16) {
    tauri::async_runtime::spawn(async move {
        let state = AppState { app: app.clone() };

        let router = Router::new()
            .route("/health", get(health))
            .route("/ingest", post(ingest))
            .route("/ws", get(ws_upgrade))
            .layer(CorsLayer::permissive())
            .with_state(state);

        let addr = format!("127.0.0.1:{port}");
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(e) => {
                let _ = app.emit("agent://server-status", json!({"running": false, "port": port}));
                eprintln!("aether AAP ingest failed to bind {addr}: {e}");
                return;
            }
        };

        METRICS.running.store(true, Ordering::Relaxed);
        let _ = app.emit("agent://server-status", json!({"running": true, "port": port}));
        eprintln!("aether AAP ingest listening on http://127.0.0.1:{port}");

        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("aether AAP ingest server stopped: {e}");
        }
    });
}

/// `GET /health` — liveness probe.
async fn health(State(_state): State<AppState>) -> impl IntoResponse {
    Json(json!({"ok": true, "service": "aether-aap", "port": PORT}))
}

/// `POST /ingest` — body is one JSON event object or an array of them. Malformed
/// entries are skipped rather than rejected. Responds `{"accepted":<n>}`.
async fn ingest(State(state): State<AppState>, body: String) -> impl IntoResponse {
    let mut accepted = 0usize;
    match serde_json::from_str::<Value>(&body) {
        Ok(Value::Array(items)) => {
            for item in items {
                if forward(&state.app, item) {
                    accepted += 1;
                }
            }
        }
        Ok(value) => {
            if forward(&state.app, value) {
                accepted += 1;
            }
        }
        Err(_) => {}
    }
    Json(json!({"accepted": accepted}))
}

/// `GET /ws` — WebSocket upgrade for streaming events.
async fn ws_upgrade(
    State(state): State<AppState>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Drain a WebSocket, forwarding each text message. A message may be a single
/// JSON event or newline-delimited JSON (one event per line). Parse errors are
/// ignored per-line.
async fn handle_socket(mut socket: WebSocket, state: AppState) {
    while let Some(Ok(msg)) = socket.recv().await {
        match msg {
            Message::Text(text) => {
                for line in text.split('\n') {
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(value) = serde_json::from_str::<Value>(line) {
                        forward(&state.app, value);
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}

/// Tauri command: where the ingestion server is reachable.
#[tauri::command]
pub fn ingest_info() -> Value {
    json!({
        "port": PORT,
        "ws": format!("ws://127.0.0.1:{PORT}/ws"),
        "http": format!("http://127.0.0.1:{PORT}/ingest"),
    })
}

/// Tauri command: live health/throughput of the ingestion server.
#[tauri::command]
pub fn ingest_status() -> Value {
    let last = METRICS.last_event_ms.load(Ordering::Relaxed);
    json!({
        "running": METRICS.running.load(Ordering::Relaxed),
        "port": PORT,
        "eventsReceived": METRICS.received.load(Ordering::Relaxed),
        "lastEventMs": if last == 0 { Value::Null } else { json!(last) },
    })
}
