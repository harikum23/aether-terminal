#!/usr/bin/env python3
"""OpenAI Agents SDK -> Aether tracing adapter.

The OpenAI Agents SDK (`openai-agents`) emits **traces** and **spans** for agent
runs, LLM generations, and tool ("function") calls. You subscribe by adding a
`TracingProcessor` via `add_trace_processor(...)`. This module implements such a
processor that translates spans into Aether Agent Protocol (AAP) events using
the zero-dependency Aether Python SDK.

It also works as a **generic callback shape**: if you're on a different agent
framework, call the `on_*` methods directly (see the bottom of this file).

------------------------------------------------------------------------------
Wire it in (OpenAI Agents SDK >= 0.0.x):

    from agents import add_trace_processor, Runner, Agent
    from openai_agents_adapter import AetherTracingProcessor

    add_trace_processor(AetherTracingProcessor(title="Research run"))
    Runner.run_sync(Agent(name="Orchestrator", ...), "Summarize the Q3 report")

------------------------------------------------------------------------------
IMPORTANT -- field names depend on the SDK version. The Agents SDK has moved
attributes around between releases. The accessors below try several spellings
and fall back gracefully. If your version names things differently, adjust the
`_span_kind`, `_span_name`, and `_span_data` helpers -- they are the only
version-sensitive surface.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Optional

# The Aether SDK lives at ../sdk/python. Make it importable when run from repo.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))
from aether import AetherClient, new_id  # noqa: E402


def _get(obj: Any, *names: str, default: Any = None) -> Any:
    """Read the first present attribute/key from `obj` across name variants."""
    for n in names:
        if isinstance(obj, dict) and n in obj:
            return obj[n]
        if hasattr(obj, n):
            return getattr(obj, n)
    return default


def _span_kind(span: Any) -> str:
    """Best-effort span category: 'agent' | 'function' | 'generation' | other."""
    data = _get(span, "span_data", "data", default=span)
    # Newer SDKs expose `span_data.type`; older ones use the class name.
    kind = _get(data, "type")
    if kind:
        return str(kind)
    cls = type(data).__name__.lower()
    if "agent" in cls:
        return "agent"
    if "function" in cls or "tool" in cls:
        return "function"
    if "generation" in cls or "response" in cls:
        return "generation"
    return cls


def _span_name(span: Any) -> str:
    data = _get(span, "span_data", "data", default=span)
    return str(_get(data, "name", "tool_name", "agent_name", default="span"))


def _span_id(span: Any) -> str:
    return str(_get(span, "span_id", "id", default=new_id("span")))


class AetherTracingProcessor:
    """A TracingProcessor that mirrors OpenAI Agents spans into Aether.

    Implements the duck-typed processor interface the SDK calls:
    `on_trace_start`, `on_trace_end`, `on_span_start`, `on_span_end`,
    plus `shutdown`/`force_flush`. Unknown extra methods are no-ops.
    """

    def __init__(
        self,
        title: str = "OpenAI Agents run",
        endpoint: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> None:
        self.client = AetherClient(endpoint=endpoint, run_id=run_id)
        self.title = title
        # Map SDK span_id -> the AAP agentId / toolCallId we created for it.
        self._agent_of_span: dict[str, str] = {}
        self._tool_of_span: dict[str, str] = {}
        # The most recently opened agent span, so tool spans can attach to it.
        self._current_agent: Optional[str] = None

    # --- trace lifecycle -> run -----------------------------------------

    def on_trace_start(self, trace: Any) -> None:
        self.client.run_start(_get(trace, "name", default=self.title) or self.title,
                              framework="openai-agents")

    def on_trace_end(self, trace: Any) -> None:
        self.client.run_end("done")
        self.client.flush()

    # --- span lifecycle -------------------------------------------------

    def on_span_start(self, span: Any) -> None:
        kind = _span_kind(span)
        sid = _span_id(span)

        if kind == "agent":
            agent_id = new_id("agent")
            self._agent_of_span[sid] = agent_id
            self._current_agent = agent_id
            self.client.spawn_agent(
                agent_id,
                name=_span_name(span),
                agent_type="agent",
                model=_get(_get(span, "span_data", "data", default=span), "model"),
            )
            self.client.agent_status(agent_id, "running")

        elif kind == "function":
            agent_id = self._current_agent or self._fallback_agent()
            call_id = new_id("tool")
            self._tool_of_span[sid] = call_id
            data = _get(span, "span_data", "data", default=span)
            self.client.tool_start(
                agent_id, call_id, _span_name(span),
                input=_get(data, "input", "arguments", "args"),
            )

        elif kind == "generation":
            # LLM call -- we surface it after completion (token usage) on end.
            pass

    def on_span_end(self, span: Any) -> None:
        kind = _span_kind(span)
        sid = _span_id(span)
        data = _get(span, "span_data", "data", default=span)
        err = _get(span, "error")

        if kind == "agent":
            agent_id = self._agent_of_span.get(sid)
            if agent_id:
                self.client.end_agent(
                    agent_id, "error" if err else "done",
                    input_tokens=_get(data, "input_tokens"),
                    output_tokens=_get(data, "output_tokens"),
                )
                if self._current_agent == agent_id:
                    self._current_agent = None

        elif kind == "function":
            call_id = self._tool_of_span.get(sid)
            agent_id = self._current_agent or self._fallback_agent()
            if call_id:
                self.client.tool_end(
                    agent_id, call_id,
                    "error" if err else "ok",
                    output=_get(data, "output", "result"),
                    error=str(err) if err else None,
                )

        elif kind == "generation":
            agent_id = self._current_agent or self._fallback_agent()
            usage = _get(data, "usage", default={})
            it = _get(usage, "input_tokens", "prompt_tokens", default=0)
            ot = _get(usage, "output_tokens", "completion_tokens", default=0)
            if it or ot:
                self.client.usage(
                    input_tokens=int(it), output_tokens=int(ot),
                    agent_id=agent_id, model=_get(data, "model"),
                )

    # --- processor housekeeping (SDK may call these) --------------------

    def force_flush(self) -> None:
        self.client.flush()

    def shutdown(self) -> None:
        self.client.flush()

    # --- helpers --------------------------------------------------------

    def _fallback_agent(self) -> str:
        """If a tool span arrives with no open agent span, synthesize one."""
        agent_id = new_id("agent")
        self.client.spawn_agent(agent_id, name="Agent", agent_type="agent")
        self.client.agent_status(agent_id, "running")
        self._current_agent = agent_id
        return agent_id


# ---------------------------------------------------------------------------
# Generic-callback usage (no OpenAI Agents SDK installed) -- drive it by hand.
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # Minimal self-contained demonstration of the mapping, using duck-typed
    # dict "spans" so this file runs without the SDK installed.
    proc = AetherTracingProcessor(title="Adapter self-demo")
    proc.on_trace_start({"name": "Adapter self-demo"})

    proc.on_span_start({"span_id": "s1", "span_data": {"type": "agent",
                        "name": "Orchestrator", "model": "gpt-5"}})
    proc.on_span_start({"span_id": "s2", "span_data": {"type": "function",
                        "name": "web_search", "input": {"q": "openai agents sdk"}}})
    proc.on_span_end({"span_id": "s2", "span_data": {"type": "function",
                      "output": "3 results"}})
    proc.on_span_end({"span_id": "s1", "span_data": {"type": "agent",
                      "input_tokens": 1500, "output_tokens": 300}})

    proc.on_trace_end({"name": "Adapter self-demo"})
    print("[adapter] self-demo emitted", file=sys.stderr)
