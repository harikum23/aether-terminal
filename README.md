# ◇ Aether

A futuristic terminal **and agent mission-control** — real PTY, GPU-rendered,
glassmorphic, with a live observability layer for AI multi-agent frameworks.

Built with **Tauri 2 + Rust** (PTY engine via `portable-pty`, ingestion server
via `axum`) and **React + xterm.js** (WebGL renderer). It runs your actual login
shell *and* watches your agents get dispatched and use tools in real time.

## Features

### Terminal
- **Real shell** — spawns your `$SHELL` over a true PTY (login shell, full env, `xterm-256color` + truecolor).
- **GPU rendering** — xterm.js WebGL addon, falls back to DOM renderer automatically.
- **Multiple sessions** — tabs, each a live independent shell that keeps running in the background.
- **Split panes** — divide any tab into resizable panes (`⌘D` vertical, `⌘⇧D` horizontal), each its own PTY. Drag the dividers to re-weight, `⌘⌥`+arrows to move focus; the focused pane wears a neon ring.
- **Broadcast input** — `⌘⌥I` mirrors your keystrokes to every pane in the tab (run the same command on many hosts at once), à la iTerm2 / PuTTY.
- **Command palette** — `⌘K` for panes, tabs, themes, font size, CRT toggle, view switch.
- **IBM Plex Mono** type at a comfortable 13px — Carbon Design System fonts, bundled (no system install needed).
- **5 themes** — **Carbon** (IBM dark, default), Aether, Synthwave, Matrix, Nord (live-switchable, theme the whole app).
- **Futuristic chrome** — animated aurora, glass bars, macOS window vibrancy, neon glow, optional CRT scanlines.

### Agent Mission Control (`⌘\` to toggle)
- **Live agent tree** — watch agents (and sub-agents) get dispatched, with parent→child connectors.
- **Tool monitoring** — every `tool.start`/`tool.end` with status, duration waterfall, and the currently-running tool shimmering on each agent card.
- **Token & cost meters** — live aggregate input/output tokens and USD across the run.
- **Detail drawer** — per-agent task, tool-call timeline, and reasoning/message feed.
- **Live event ticker** — streaming feed of dispatches, tool calls, and errors.
- Fed by the **Aether Agent Protocol** — any framework streams JSON events to a local server (see below).

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘T` | New session |
| `⌘D` / `⌘⇧D` | Split pane right (vertical) / down (horizontal) |
| `⌘⌥←↑↓→` | Move focus between panes |
| `⌘W` | Close focused pane (closes the tab when it's the last pane) |
| `⌘⌥I` | Toggle broadcast input (type into every pane at once) |
| `⌘1`–`⌘9` | Jump to session N |
| `⌘⇧]` / `⌘⇧[` | Next / previous session |
| `⌘K` | Command palette |
| `⌘\` | Toggle Terminal ⇄ Agent Mission Control |
| `⌘+` / `⌘-` / `⌘0` | Font size up / down / reset |

## Monitoring your agents (Aether Agent Protocol)

The Rust backend runs a local ingestion server on boot:

- WebSocket: `ws://127.0.0.1:9700/ws`
- HTTP: `POST http://127.0.0.1:9700/ingest` (one JSON event or an array)

Stream events from any framework. TypeScript:

```ts
import { AetherClient } from "./sdk/typescript/aether";
const ae = new AetherClient({ runId: "my-run" });
ae.runStart("Refactor auth");
ae.spawnAgent({ agentId: "a1", name: "reviewer", model: "claude-opus-4-8" });
ae.toolStart("a1", "t1", "Read", { file: "auth.ts" });
ae.toolEnd("a1", "t1", "ok");
```

Or Python (`sdk/python/aether.py`), plus ready-made adapters in `examples/`:
- `claude_code_hook.py` — wire into Claude Code via `.claude/settings.json` hooks
- `openai_agents_adapter.py` — OpenAI Agents SDK tracing processor
- `langgraph_callback.py` — LangChain/LangGraph callback handler

See **[PROTOCOL.md](PROTOCOL.md)** for the full event schema.

### One-click monitored Claude Code

Click **Launch Claude** in the title bar (or `⌘K` → *Launch Claude Code
(monitored)*). Aether materializes the hook bridge into `~/.aether/` and opens a
new terminal tab running:

```
AETHER_ENDPOINT=http://127.0.0.1:9700/ingest claude --settings ~/.aether/claude-hooks.settings.json
```

`--settings` merges an extra layer for that session only — your global
`~/.claude/settings.json` is never modified. From then on, every tool call and
sub-agent (`Task`) in that Claude Code session streams into Mission Control.
Switch to the **Agents** view (`⌘\`) to watch it live.

**Try it now (no Claude needed):** launch the app, open the command palette
(`⌘K`) → *Load demo agent run*, or stream the live demo:

```bash
node examples/demo.mjs        # emits a staggered multi-agent run to the dashboard
```

## Develop

```bash
npm install
npm run tauri dev      # launch the app with hot reload
```

## Build a distributable

```bash
npm run tauri build    # produces a .app + .dmg under src-tauri/target/release/bundle
```

## Layout

```
src/                  React UI
  components/          Terminal (xterm), TabBar, StatusBar, CommandPalette
  components/agents/   Mission Control dashboard (roster, drawer, timeline, ticker)
  lib/                 pty.ts, theme.ts, agentProtocol.ts (AAP types),
                       agentStore.ts (event reducer + hooks), agentMock.ts
src-tauri/src/
  pty.rs               PTY manager — spawn/write/resize/kill + output streaming
  ingest.rs            AAP ingestion server (axum ws + http) → agent://event
  lib.rs               Tauri app + command registration
sdk/                   TypeScript + Python client SDKs
examples/              demo emitter + framework adapters
PROTOCOL.md            Aether Agent Protocol spec
```

The PTY backend keys every session by a UUID, streams raw output bytes to the
webview over `pty://output/{id}` events, and resizes the kernel PTY on viewport
change. The ingestion server forwards each received agent event to the webview
as `agent://event`, where a reducer builds the live agent tree the dashboard
renders.
