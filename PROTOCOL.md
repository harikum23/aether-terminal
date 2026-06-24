# Aether Agent Protocol (AAP)

AAP is the wire contract for streaming multi-agent telemetry into **Aether**.
Any agent framework — Claude Code, OpenAI Agents SDK, LangGraph, CrewAI, or
something custom — emits AAP events to the local ingestion server, and Aether's
Mission Control renders the run live (agent tree, tool calls, tokens, cost).

The canonical type definitions live in
[`src/lib/agentProtocol.ts`](src/lib/agentProtocol.ts). This document mirrors
them for non-TypeScript consumers.

## Transport

The ingestion server listens on `127.0.0.1:9700`:

| Transport | Endpoint | Body |
| --- | --- | --- |
| HTTP | `POST http://127.0.0.1:9700/ingest` | one JSON event object, **or** a JSON array of events |
| WebSocket | `ws://127.0.0.1:9700/ws` | one JSON event per message |

- `Content-Type: application/json` for HTTP.
- The server treats events as opaque JSON and forwards them to the UI. It does
  not validate beyond JSON parsing — malformed events are dropped.
- Emit **fire-and-forget**: instrumentation must never block or crash the host
  agent. The official SDKs swallow network errors by design.

## Event model

Every event is a discriminated union on `type`. All events carry:

| Field | Type | Notes |
| --- | --- | --- |
| `runId` | string | required; groups all events of one run |
| `ts` | number | epoch **milliseconds**; optional — server fills receive-time if absent |

All ids (`runId`, `agentId`, `toolCallId`) are **client-supplied strings**.

### Events

| `type` | Required fields | Optional fields |
| --- | --- | --- |
| `run.start` | `title` | `framework` |
| `run.end` | `status` = `running\|done\|error` | — |
| `agent.spawn` | `agentId`, `name` | `parentId`, `agentType`, `model`, `task` |
| `agent.status` | `agentId`, `status` = `spawning\|running\|waiting\|done\|error` | — |
| `agent.message` | `agentId`, `role` = `assistant\|thinking\|system\|user`, `text` | — |
| `agent.end` | `agentId`, `status` | `inputTokens`, `outputTokens`, `costUsd` |
| `tool.start` | `agentId`, `toolCallId`, `name` | `input` (any JSON) |
| `tool.end` | `agentId`, `toolCallId`, `status` = `ok\|error` | `output`, `error`, `durationMs` |
| `usage` | `inputTokens`, `outputTokens` | `agentId`, `model`, `costUsd` |
| `log` | `level` = `debug\|info\|warn\|error`, `message` | `agentId` |

## Ordering & id expectations

- **A run brackets everything**: emit `run.start` first and `run.end` last.
  Other events for that `runId` should fall between them.
- **Agents**: `agent.spawn` before any tool/message/usage referencing that
  `agentId`; `agent.end` (or a terminal `agent.status`) closes it. Set
  `parentId` to nest a sub-agent under its spawner (drives the agent tree).
- **Tools**: a `tool.start` and its matching `tool.end` must share the same
  `toolCallId` (and `agentId`). The UI shows a tool as in-flight between them.
- **Ids are opaque and client-chosen**; just keep them unique within a run and
  stable across a start/end pair. The SDKs provide an `id()` / `new_id()`
  helper.
- Ordering is your send order. If you omit `ts`, the server stamps receive
  time, so prefer sending events in causal order.

## Quickstart

### TypeScript (`sdk/typescript/aether.ts`)

```ts
import { AetherClient, id } from "./sdk/typescript/aether";
const ae = new AetherClient();                 // 127.0.0.1:9700/ingest, auto runId
ae.runStart("My run", "custom");
const a = id("agent"); ae.spawnAgent({ agentId: a, name: "Worker" }); ae.runEnd("done");
```

### Python (`sdk/python/aether.py`)

```python
from aether import AetherClient, new_id
ae = AetherClient()                            # 127.0.0.1:9700/ingest, auto run_id
ae.run_start("My run", framework="custom")
a = new_id("agent"); ae.spawn_agent(a, "Worker"); ae.run_end("done"); ae.flush()
```

## Framework adapters

Reference integrations live in [`examples/`](examples/):

| File | Framework | Maps |
| --- | --- | --- |
| [`examples/claude_code_hook.py`](examples/claude_code_hook.py) | Claude Code hooks | PreToolUse/PostToolUse/SubagentStop/Stop → tool/agent/run events |
| [`examples/openai_agents_adapter.py`](examples/openai_agents_adapter.py) | OpenAI Agents SDK | `TracingProcessor` spans → agent/tool/usage events |
| [`examples/langgraph_callback.py`](examples/langgraph_callback.py) | LangChain / LangGraph | `BaseCallbackHandler` → agent/tool/usage events |

## Live demo

```bash
node examples/demo.mjs          # stream a realistic 5-agent audit run to Aether
node examples/demo.mjs --dry    # print the event stream to stdout instead
```

SDK references: [`sdk/typescript/README.md`](sdk/typescript/README.md),
[`sdk/python/README.md`](sdk/python/README.md).
