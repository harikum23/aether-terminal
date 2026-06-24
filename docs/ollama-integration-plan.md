# Local Ollama Integration for Aether Terminal

## Context

Aether is a Tauri 2 terminal (Rust backend + React/TS frontend). Today it has **no LLM
inference** — only Claude Code telemetry monitoring (`claude.rs`/`ingest.rs`). The goal is to
connect to a **local Ollama** server and offload four small, on-demand assistant tasks to it, so
the terminal can help with commands and output without any cloud dependency or API key.

Approved scope:
- **Four features:** NL→shell command, Explain last output/error, Summarize long output, Suggest next command.
- **Routing:** through the Rust backend (reqwest → `localhost:11434`), streaming tokens back via Tauri events. Avoids webview CORS, matches existing `ingest.rs`/`claude.rs` patterns, single config source.
- **Config UI:** a new "AI / Ollama" section in the existing Settings panel (enable toggle, endpoint URL, model dropdown auto-fetched from Ollama, Test Connection), persisted via `prefs.ts`.

Intended outcome: with `ollama serve` running and a model pulled, the user enables it in Settings,
picks a model, and gets four AI actions in the ⌘K palette. With Ollama absent or disabled, the app
behaves exactly as before (backend stays stateless; nothing auto-starts Ollama).

## Key codebase facts grounding this plan

- **PTY id == pane leaf id.** Writing to the active terminal = `pty.write(activeTab.activePaneId, text)`. `pty_write` writes raw bytes with **no trailing newline** (`pty.rs`), so inserting a command without `\r` gives "type but don't run" for free.
- **xterm instances are private to `Terminal.tsx`.** Output capture needs a small registry to expose a "read recent lines" accessor up to App. xterm keeps `scrollback: 10000`, so `term.buffer.active` + `getLine(i).translateToString(true)` yields recent text with no extra buffering.
- **Backend is stateless per request** (ingest/claude pattern). Ollama follows suit: config passed per-call from frontend prefs; streaming via `app.emit(channel, payload)` like `pty://output/{id}`.
- **reqwest is NOT yet a dependency** — must be added (`rustls-tls` to avoid macOS OpenSSL friction).
- **Settings/prefs:** `Prefs { themeId, type, crt }` in `src/lib/prefs.ts` (localStorage key `aether.prefs.v1`, merge-over-defaults). App.tsx owns prefs state and persists via `useEffect`; SettingsPanel uses reusable `Row`/`Segmented`/`select`/`range` blocks. Palette commands are built in App.tsx `commands` useMemo with shape `{id,title,hint,group,run}`.

## New files

| File | Responsibility |
|---|---|
| `src-tauri/src/ollama.rs` | reqwest client + 4 Tauri commands; NDJSON streaming bridge → events |
| `src/lib/ollama.ts` | typed invoke wrappers + `generateStream` streaming helper (mirrors `pty.ts`) |
| `src/lib/ollamaPrompts.ts` | pure `{system, prompt}` template builders, one per task |
| `src/lib/termRegistry.ts` | module-level `paneId → { getRecentText(maxLines) }` registry |
| `src/lib/useAiTask.ts` | React hook: holds `state/text/error`, wires stream handlers, `start()`/`cancel()` |
| `src/components/AiPanel.tsx` | shared streamed-response surface (overlay) reused by explain/summarize/suggest + NL preview |
| `src/components/AiPromptModal.tsx` | tiny free-text input modal for the NL→command request (palette has no arg input) |

## Existing files to modify

- **`src-tauri/Cargo.toml`** — add `reqwest = { version = "0.12", default-features = false, features = ["json","stream","rustls-tls"] }`, `futures-util = "0.3"`, and (if using cancellation tokens) `tokio-util = { version = "0.7", features = ["rt"] }`.
- **`src-tauri/src/lib.rs`** — `mod ollama;` and add the 4 commands to `generate_handler!`. No `.manage()` — cancellation map is a module-level `LazyLock<Mutex<HashMap<..>>>` like ingest's `METRICS`.
- **`src/lib/prefs.ts`** — extend `Prefs` with `ollama: OllamaPrefs` (see schema below) + defaults + validation; backward-compatible additive change (key stays `aether.prefs.v1`).
- **`src/components/Terminal.tsx`** — on mount, register `{ getRecentText }` in `termRegistry` for its pane id; unregister on cleanup. Add `getRecentText(maxLines)` reading `term.buffer.active` (trim blank edges, char-cap the tail).
- **`src/components/SettingsPanel.tsx`** — add an "AI / Ollama" `<section>`: enable toggle (`Segmented`), endpoint URL text input, model dropdown populated via `listModels` (free-text fallback if fetch fails), Test Connection button + status line. New props `ollama` + `onPatchOllama`; transient UI state (model list, test status) is local `useState`.
- **`src/App.tsx`** — add `ollama` state + `patchOllama` (mirrors `type`/`patchType`); include in `savePrefs` effect; pass to SettingsPanel; mount `<AiPanel>` + `<AiPromptModal>`; add `recentOutput(n)` helper via registry on `activeTab.activePaneId`; add four "AI" palette commands (gated on `ollama.enabled`); update `commands` useMemo deps.

## Tauri commands + event channels

Commands (registered in `generate_handler!`):
- `ollama_list_models(base_url: String) -> Result<Vec<OllamaModel>, String>` — `GET /api/tags`
- `ollama_test_connection(base_url: String) -> Result<OllamaHealth, String>` — `GET /api/tags` (Ollama has no `/health`), ~5s timeout
- `ollama_generate(app, request_id, base_url, model, prompt, system: Option<String>, options: Option<Value>) -> Result<(), String>` — `POST /api/generate` with `stream:true`; spawns on `tauri::async_runtime::spawn`; streams via events
- `ollama_cancel(request_id: String) -> Result<(), String>` — trips the per-request cancel token

Event channels (`app.emit` → frontend `listen`):
- `ollama://token/{requestId}` → `String` (token delta)
- `ollama://done/{requestId}` → `{ ok, evalCount?, totalDurationMs? }`
- `ollama://error/{requestId}` → `String`

(JS invoke args are camelCase: `requestId`, `baseUrl` — matches `pty_spawn`'s `cols/rows`.)

## Prefs schema extension (`prefs.ts`)

```ts
export interface OllamaPrefs {
  enabled: boolean;   // default false
  baseUrl: string;    // default "http://localhost:11434", validated with new URL(...)
  model: string;      // default "" — features show "pick a model" until set
}
// Prefs gains: ollama: OllamaPrefs
```

## Prompt strategy (per task)

All use a tight `system` forcing terse, terminal-appropriate output, inject zsh/macOS context, and
use `options: { temperature: 0.2 }` for the command tasks. Input is char-capped (~8000 chars, keep tail).
1. **NL→shell:** system = "output ONLY a single zsh command, no prose/fences". Frontend strips fences, takes first line, inserts via `pty.write(paneId, cmd)` **without `\r`**. Optional "Insert & Run" button appends `\r` (opt-in).
2. **Explain:** system = "explain this terminal output concisely; if an error, give likely cause + fix". prompt = fenced last ~40 lines.
3. **Summarize:** system = "summarize into key points, bullets". prompt = fenced ~120 lines (capped).
4. **Suggest:** system = "suggest 1–3 next zsh commands, one per line `command — reason`". prompt = fenced ~60 lines; parsed into a selectable list; selecting inserts (no `\r`).

## Output capture

xterm `scrollback` already retains history. `getRecentText(maxLines)` walks `term.buffer.active` from
`max(0, length-maxLines)` to `length-1`, `getLine(i)?.translateToString(true)`, trims blank edges,
joins `\n`, caps tail. AI features read the **active pane** id. If buffer near-empty → "No recent output to analyze." (no Ollama call).

## Error / streaming / degradation handling

- **NDJSON line-buffering:** maintain a partial-line buffer in `ollama_generate`; parse only complete lines, retain remainder (same discipline as ingest's WS text handling).
- **Connection refused / absent:** reqwest connect error → `Err` + `ollama://error` emit; Test Connection shows red "Couldn't reach Ollama at {baseUrl}".
- **Timeouts:** ~3s connect timeout for snappy failure; ~5s total on list/test; **no** short overall timeout on `generate` (long-running) — rely on streaming + user Stop.
- **model not pulled (404):** surface "model 'x' not found — run `ollama pull x`".
- **Listener lifecycle:** `generateStream` unlistens all three channels on done/error/cancel to prevent leaks/double-render across repeated palette triggers.
- **Disabled / empty model:** AI commands hidden/disabled when `!enabled`; if enabled but no model, AiPanel says "Pick a model in Settings → AI / Ollama."

## Build sequence (batches)

1. **Backend foundation** — Cargo deps; `ollama.rs` with `list_models` + `test_connection`; register in `lib.rs`. (`cargo check`)
2. **Streaming backend** — `ollama_generate` (NDJSON + event emit) + `ollama_cancel`.
3. **Prefs + Settings UI** — extend `prefs.ts`; wire `ollama`/`patchOllama` through App; add AI/Ollama settings section. (End-to-end config path testable here.)
4. **Frontend AI plumbing** — `ollama.ts`, `ollamaPrompts.ts`, `useAiTask.ts`, `AiPanel.tsx`, `AiPromptModal.tsx`; mount in App.
5. **Output capture** — `termRegistry.ts`; register/unregister in `Terminal.tsx`.
6. **Wire the four features** — palette commands; NL→shell insertion (no `\r`); explain/summarize/suggest via `recentOutput()` + AiPanel.
7. **Polish** — cancellation UX, empty/disabled states, error messaging, AiPanel CSS (theme-variable aware).

Dispatch: one **rust-engineer** for batches 1–2 (backend), one **frontend-engineer**/**design-engineer** for batches 3–7 (frontend). Backend and frontend share the command/channel contract above; build backend first so the frontend can call it.

## Verification

- **With Ollama** (`ollama serve` + `ollama pull llama3.2`): Settings → enable → Test shows green + model count → dropdown lists models → pick one. Exercise all four: NL→shell **inserts (not runs)** at the active prompt; explain/summarize stream into AiPanel from real output; suggest yields selectable commands. Verify Stop cancels mid-stream and a second run doesn't double-render (listeners released).
- **Without Ollama:** stop server → Test shows clear red error; enabled AI features open AiPanel with the connection error (no hang/crash). With `enabled:false`, AI commands hidden. Existing terminal features fully unaffected.
- **Build gates:** `cargo check`/`clippy` clean; `npm run build` (tsc) clean; confirm `prefs.ts` round-trips an old localStorage value missing `ollama` (backward compat).
- **Visual:** capture a screenshot of the AI/Ollama settings section and the AiPanel mid-stream (headless-Chrome against the vite dev server; Tauri `invoke` fails gracefully there, so use the dev server for layout and the full app for live Ollama calls).

## Decisions adopted (recommended defaults)

- **NL→command input:** a small dedicated `AiPromptModal` (the palette has no free-text arg). Cleaner/lower-risk than overloading the palette query.
- **No auto-run:** NL→shell inserts without `\r`; "Insert & Run" is an optional opt-in button only.
- **Model dropdown offline:** free-text model input fallback when `listModels` fails.
- **reqwest TLS:** `rustls-tls` (localhost is plain HTTP, but supports `https` base URLs without OpenSSL).
