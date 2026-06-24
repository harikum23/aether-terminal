# Aether TypeScript SDK

Zero-dependency client for the **Aether Agent Protocol (AAP)**. Streams agent
telemetry to the local Aether ingestion server so Mission Control can render
your multi-agent run live.

- Runtime: Node 18+ or any modern browser (uses global `fetch`).
- Transport: fire-and-forget `POST http://127.0.0.1:9700/ingest`.
- Safety: network errors are swallowed (`console.warn`) — instrumentation can
  never throw into your agent code.

## Install

It's a single file with no deps. Copy `aether.ts` into your project (or import
it from this path) and use it directly. For a JS build, transpile with `tsc`,
`esbuild`, or `tsx`.

## Quickstart

```ts
import { AetherClient, id } from "./aether";

const aether = new AetherClient(); // -> http://127.0.0.1:9700/ingest, auto runId
aether.runStart("Refactor auth module", "custom");

const orch = id("agent");
aether.spawnAgent({ agentId: orch, name: "Orchestrator", model: "claude-opus-4-8" });
aether.agentStatus(orch, "running");

const call = id("tool");
aether.toolStart(orch, call, "Read", { path: "src/auth.ts" });
aether.toolEnd(orch, call, "ok", { durationMs: 42, output: "...file body..." });

aether.message(orch, "assistant", "Found 3 call sites to update.");
aether.endAgent(orch, "done", { inputTokens: 1200, outputTokens: 380, costUsd: 0.012 });
aether.runEnd("done");
```

## API

| Method | Emits |
| --- | --- |
| `new AetherClient({ endpoint?, runId?, fetchImpl? })` | — (auto-generates `runId`) |
| `runStart(title, framework?)` | `run.start` |
| `runEnd(status)` | `run.end` |
| `spawnAgent({ agentId, name, parentId?, agentType?, model?, task? })` | `agent.spawn` |
| `agentStatus(agentId, status)` | `agent.status` |
| `message(agentId, role, text)` | `agent.message` |
| `endAgent(agentId, status, usage?)` | `agent.end` |
| `toolStart(agentId, toolCallId, name, input?)` | `tool.start` |
| `toolEnd(agentId, toolCallId, status, extra?)` | `tool.end` |
| `usage({ inputTokens, outputTokens, agentId?, model?, costUsd? })` | `usage` |
| `log(level, message, agentId?)` | `log` |
| `id(prefix?)` | helper — collision-resistant id string |

`status` for agents is `spawning | running | waiting | done | error`; for tools
`ok | error`; for runs `running | done | error`. Roles are `assistant |
thinking | system | user`. See `../../PROTOCOL.md` for the full event table.

## Notes

- Each client owns one `runId`. For multiple concurrent runs, construct
  multiple clients.
- Events are stamped with `runId` and `ts` (epoch ms) automatically.
- Ordering is per-process send order; the server records receive time if you
  omit `ts`.
