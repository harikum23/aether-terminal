# Aether Python SDK

Zero-dependency (stdlib only) client for the **Aether Agent Protocol (AAP)**.
Streams agent telemetry to the local Aether ingestion server.

- POSTs run on a background daemon thread (`urllib.request`) so they never
  block your agent loop.
- Network errors are swallowed (written to stderr) — telemetry can't crash the
  host program.

## Install

Single file, no dependencies. Copy `aether.py` next to your code (or add this
directory to `PYTHONPATH`) and import it.

## Quickstart

```python
from aether import AetherClient, new_id

aether = AetherClient()  # -> http://127.0.0.1:9700/ingest (or $AETHER_ENDPOINT)
aether.run_start("Refactor auth module", framework="custom")

orch = new_id("agent")
aether.spawn_agent(orch, "Orchestrator", model="claude-opus-4-8")
aether.agent_status(orch, "running")

call = new_id("tool")
aether.tool_start(orch, call, "Read", {"path": "src/auth.py"})
aether.tool_end(orch, call, "ok", duration_ms=42, output="...file body...")

aether.message(orch, "assistant", "Found 3 call sites to update.")
aether.end_agent(orch, "done", input_tokens=1200, output_tokens=380, cost_usd=0.012)
aether.run_end("done")

aether.flush()  # block until queued POSTs drain — call before a short-lived process exits
```

## API

| Method | Emits |
| --- | --- |
| `AetherClient(endpoint=None, run_id=None, timeout=3.0)` | — (auto `run_id`) |
| `run_start(title, framework=None)` | `run.start` |
| `run_end(status)` | `run.end` |
| `spawn_agent(agent_id, name, parent_id=None, agent_type=None, model=None, task=None)` | `agent.spawn` |
| `agent_status(agent_id, status)` | `agent.status` |
| `message(agent_id, role, text)` | `agent.message` |
| `end_agent(agent_id, status, input_tokens=None, output_tokens=None, cost_usd=None)` | `agent.end` |
| `tool_start(agent_id, tool_call_id, name, input=None)` | `tool.start` |
| `tool_end(agent_id, tool_call_id, status, output=None, error=None, duration_ms=None)` | `tool.end` |
| `usage(input_tokens, output_tokens, agent_id=None, model=None, cost_usd=None)` | `usage` |
| `log(level, message, agent_id=None)` | `log` |
| `flush(timeout=5.0)` | — (drain queue) |
| `new_id(prefix="ae")` | helper id string |

Statuses: agents `spawning | running | waiting | done | error`; tools
`ok | error`; runs `running | done | error`. Roles `assistant | thinking |
system | user`. Levels `debug | info | warn | error`.

## Smoke test

```bash
python aether.py --demo           # emits a 2-agent run to AETHER_ENDPOINT
```

Because POSTs are async, call `flush()` before a short-lived script exits or the
daemon thread may be killed mid-send. See `../../PROTOCOL.md` for the wire spec.
