"""Aether Agent Protocol (AAP) -- Python client SDK.

Zero dependencies beyond the standard library. POSTs are dispatched on a
background daemon thread (via ``urllib.request``) so instrumentation never
blocks the host agent, and every network error is swallowed -- telemetry must
not crash the program it observes.

The wire shapes mirror ``src/lib/agentProtocol.ts``; keep them in sync.

Usage
-----
    from aether import AetherClient, new_id

    aether = AetherClient()                       # -> http://127.0.0.1:9700/ingest
    aether.run_start("Refactor auth module", framework="custom")

    orch = new_id("agent")
    aether.spawn_agent(agent_id=orch, name="Orchestrator", model="claude-opus-4-8")
    aether.agent_status(orch, "running")

    call = new_id("tool")
    aether.tool_start(orch, call, "Read", {"path": "src/auth.py"})
    aether.tool_end(orch, call, "ok", duration_ms=42, output="...file...")

    aether.message(orch, "assistant", "Found 3 call sites to update.")
    aether.end_agent(orch, "done", input_tokens=1200, output_tokens=380, cost_usd=0.012)
    aether.run_end("done")

    aether.flush()   # optional: block until queued POSTs drain (e.g. before exit)

Run the built-in demo:
    python aether.py --demo            # respects AETHER_ENDPOINT
"""

from __future__ import annotations

import json
import os
import queue
import random
import secrets
import sys
import threading
import time
import urllib.request
from typing import Any, Optional

DEFAULT_ENDPOINT = "http://127.0.0.1:9700/ingest"

AgentStatus = str  # "spawning" | "running" | "waiting" | "done" | "error"
ToolEndStatus = str  # "ok" | "error"
RunStatus = str  # "running" | "done" | "error"
MessageRole = str  # "assistant" | "thinking" | "system" | "user"
LogLevel = str  # "debug" | "info" | "warn" | "error"


def new_id(prefix: str = "ae") -> str:
    """A collision-resistant id string with an optional prefix."""
    return f"{prefix}_{int(time.time() * 1000):x}{secrets.token_hex(4)}"


class AetherClient:
    """Fire-and-forget AAP emitter.

    Parameters
    ----------
    endpoint:
        Ingest URL. Defaults to ``$AETHER_ENDPOINT`` or
        ``http://127.0.0.1:9700/ingest``.
    run_id:
        Run identifier. Auto-generated if omitted.
    timeout:
        Per-request socket timeout in seconds.
    """

    def __init__(
        self,
        endpoint: Optional[str] = None,
        run_id: Optional[str] = None,
        timeout: float = 3.0,
    ) -> None:
        self.endpoint = endpoint or os.environ.get("AETHER_ENDPOINT", DEFAULT_ENDPOINT)
        self.run_id = run_id or new_id("run")
        self.timeout = timeout
        self._queue: "queue.Queue[Optional[dict[str, Any]]]" = queue.Queue()
        self._worker = threading.Thread(
            target=self._drain, name="aether-emitter", daemon=True
        )
        self._worker.start()

    # --- run lifecycle ---------------------------------------------------

    def run_start(self, title: str, framework: Optional[str] = None) -> None:
        evt: dict[str, Any] = {"type": "run.start", "title": title}
        if framework:
            evt["framework"] = framework
        self._send(evt)

    def run_end(self, status: RunStatus) -> None:
        self._send({"type": "run.end", "status": status})

    # --- agents ----------------------------------------------------------

    def spawn_agent(
        self,
        agent_id: str,
        name: str,
        parent_id: Optional[str] = None,
        agent_type: Optional[str] = None,
        model: Optional[str] = None,
        task: Optional[str] = None,
    ) -> None:
        evt: dict[str, Any] = {"type": "agent.spawn", "agentId": agent_id, "name": name}
        if parent_id:
            evt["parentId"] = parent_id
        if agent_type:
            evt["agentType"] = agent_type
        if model:
            evt["model"] = model
        if task:
            evt["task"] = task
        self._send(evt)

    def agent_status(self, agent_id: str, status: AgentStatus) -> None:
        self._send({"type": "agent.status", "agentId": agent_id, "status": status})

    def message(self, agent_id: str, role: MessageRole, text: str) -> None:
        self._send(
            {"type": "agent.message", "agentId": agent_id, "role": role, "text": text}
        )

    def end_agent(
        self,
        agent_id: str,
        status: AgentStatus,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
        cost_usd: Optional[float] = None,
    ) -> None:
        evt: dict[str, Any] = {"type": "agent.end", "agentId": agent_id, "status": status}
        if input_tokens is not None:
            evt["inputTokens"] = input_tokens
        if output_tokens is not None:
            evt["outputTokens"] = output_tokens
        if cost_usd is not None:
            evt["costUsd"] = cost_usd
        self._send(evt)

    # --- tools -----------------------------------------------------------

    def tool_start(
        self,
        agent_id: str,
        tool_call_id: str,
        name: str,
        input: Any = None,
    ) -> None:
        evt: dict[str, Any] = {
            "type": "tool.start",
            "agentId": agent_id,
            "toolCallId": tool_call_id,
            "name": name,
        }
        if input is not None:
            evt["input"] = input
        self._send(evt)

    def tool_end(
        self,
        agent_id: str,
        tool_call_id: str,
        status: ToolEndStatus,
        output: Any = None,
        error: Optional[str] = None,
        duration_ms: Optional[int] = None,
    ) -> None:
        evt: dict[str, Any] = {
            "type": "tool.end",
            "agentId": agent_id,
            "toolCallId": tool_call_id,
            "status": status,
        }
        if output is not None:
            evt["output"] = output
        if error is not None:
            evt["error"] = error
        if duration_ms is not None:
            evt["durationMs"] = duration_ms
        self._send(evt)

    # --- usage & logs ----------------------------------------------------

    def usage(
        self,
        input_tokens: int,
        output_tokens: int,
        agent_id: Optional[str] = None,
        model: Optional[str] = None,
        cost_usd: Optional[float] = None,
    ) -> None:
        evt: dict[str, Any] = {
            "type": "usage",
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
        }
        if agent_id:
            evt["agentId"] = agent_id
        if model:
            evt["model"] = model
        if cost_usd is not None:
            evt["costUsd"] = cost_usd
        self._send(evt)

    def log(self, level: LogLevel, message: str, agent_id: Optional[str] = None) -> None:
        evt: dict[str, Any] = {"type": "log", "level": level, "message": message}
        if agent_id:
            evt["agentId"] = agent_id
        self._send(evt)

    # --- lifecycle / transport ------------------------------------------

    def flush(self, timeout: float = 5.0) -> None:
        """Block until all queued events have been dispatched (best effort)."""
        deadline = time.time() + timeout
        while not self._queue.empty() and time.time() < deadline:
            time.sleep(0.01)

    def _send(self, event: dict[str, Any]) -> None:
        payload = {"runId": self.run_id, "ts": int(time.time() * 1000), **event}
        self._queue.put(payload)

    def _drain(self) -> None:
        while True:
            payload = self._queue.get()
            if payload is None:  # poison pill (unused; daemon thread exits with proc)
                return
            self._post(payload)
            self._queue.task_done()

    def _post(self, payload: dict[str, Any]) -> None:
        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                self.endpoint,
                data=data,
                headers={"content-type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=self.timeout).close()
        except Exception as err:  # noqa: BLE001 -- telemetry must never crash host
            sys.stderr.write(
                f"[aether] failed to emit {payload.get('type')}: {err}\n"
            )


# ---------------------------------------------------------------------------
# `python aether.py --demo` -- emit a small 2-agent run for smoke testing.
# ---------------------------------------------------------------------------

def _demo() -> None:
    endpoint = os.environ.get("AETHER_ENDPOINT", DEFAULT_ENDPOINT)
    ae = AetherClient(endpoint=endpoint)
    print(f"[aether] demo -> {endpoint} (run {ae.run_id})", file=sys.stderr)

    ae.run_start("Python SDK smoke run", framework="custom")

    orch = new_id("agent")
    ae.spawn_agent(orch, "Orchestrator", model="claude-opus-4-8", task="Investigate flaky test")
    ae.agent_status(orch, "running")
    ae.message(orch, "thinking", "Plan: read the test, run it, inspect the diff.")

    worker = new_id("agent")
    ae.spawn_agent(worker, "Test Runner", parent_id=orch, agent_type="executor",
                   model="claude-haiku-4-5", task="Run the failing test")
    ae.agent_status(worker, "running")

    for name, arg, out in [
        ("Read", {"path": "tests/test_auth.py"}, "def test_login(): ..."),
        ("Bash", {"cmd": "pytest tests/test_auth.py -q"}, "1 failed, 4 passed"),
    ]:
        call = new_id("tool")
        ae.tool_start(worker, call, name, arg)
        time.sleep(0.4 + random.random() * 0.3)
        ae.tool_end(worker, call, "ok", output=out, duration_ms=random.randint(120, 800))

    ae.message(worker, "assistant", "test_login fails: token expiry off by one hour.")
    ae.end_agent(worker, "done", input_tokens=900, output_tokens=210, cost_usd=0.003)

    ae.usage(input_tokens=2100, output_tokens=640, agent_id=orch, model="claude-opus-4-8",
             cost_usd=0.028)
    ae.message(orch, "assistant", "Root cause: TTL uses local time instead of UTC.")
    ae.end_agent(orch, "done", input_tokens=2100, output_tokens=640, cost_usd=0.028)
    ae.run_end("done")

    ae.flush()
    print("[aether] demo done", file=sys.stderr)


if __name__ == "__main__":
    if "--demo" in sys.argv:
        _demo()
    else:
        print(__doc__)
