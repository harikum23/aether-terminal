#!/usr/bin/env python3
"""LangChain / LangGraph -> Aether callback handler.

LangChain's `BaseCallbackHandler` fires on tool, chain, and LLM lifecycle
events; LangGraph reuses the same callback system. This handler maps those
callbacks to Aether Agent Protocol (AAP) events via the Aether Python SDK.

------------------------------------------------------------------------------
Wire it in:

    from langgraph_callback import AetherCallbackHandler
    handler = AetherCallbackHandler(title="LangGraph research")

    # Pass per-invocation:
    graph.invoke({"input": "..."}, config={"callbacks": [handler]})
    # or per-LLM/agent:
    llm = ChatAnthropic(model="claude-sonnet-4-6", callbacks=[handler])

LangChain passes a `run_id` (UUID) to every callback and a `parent_run_id` for
nested runs -- we use those to correlate start/end pairs and to nest agents.
This file imports `langchain_core` lazily so it can be syntax-checked and the
class instantiated even when LangChain isn't installed.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Optional
from uuid import UUID

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk", "python"))
from aether import AetherClient, new_id  # noqa: E402

try:
    from langchain_core.callbacks import BaseCallbackHandler  # type: ignore
except Exception:  # noqa: BLE001 -- allow import without LangChain present
    class BaseCallbackHandler:  # minimal shim
        pass


class AetherCallbackHandler(BaseCallbackHandler):
    """Mirror LangChain/LangGraph runs into Aether.

    One agent node is created per chain/agent run; tool runs become
    tool.start/tool.end on the nearest enclosing agent.
    """

    def __init__(
        self,
        title: str = "LangGraph run",
        endpoint: Optional[str] = None,
        run_id: Optional[str] = None,
    ) -> None:
        self.client = AetherClient(endpoint=endpoint, run_id=run_id)
        self._started = False
        # LangChain run_id (UUID) -> our AAP agentId / toolCallId.
        self._agent_of: dict[str, str] = {}
        self._tool_of: dict[str, str] = {}

    def _ensure_run(self) -> None:
        if not self._started:
            self.client.run_start(self.title if hasattr(self, "title") else "LangGraph run",
                                  framework="langgraph")
            self._started = True

    # --- chains / agents ------------------------------------------------

    def on_chain_start(self, serialized: dict, inputs: dict, *,
                       run_id: UUID, parent_run_id: Optional[UUID] = None,
                       **kwargs: Any) -> None:
        self.__dict__.setdefault("title", "LangGraph run")
        self._ensure_run()
        agent_id = new_id("agent")
        self._agent_of[str(run_id)] = agent_id
        name = (serialized or {}).get("name") or kwargs.get("name") or "Chain"
        parent = self._agent_of.get(str(parent_run_id)) if parent_run_id else None
        self.client.spawn_agent(agent_id, name=name, parent_id=parent,
                                agent_type="chain")
        self.client.agent_status(agent_id, "running")

    def on_chain_end(self, outputs: dict, *, run_id: UUID, **kwargs: Any) -> None:
        agent_id = self._agent_of.get(str(run_id))
        if agent_id:
            self.client.end_agent(agent_id, "done")

    def on_chain_error(self, error: BaseException, *, run_id: UUID,
                       **kwargs: Any) -> None:
        agent_id = self._agent_of.get(str(run_id))
        if agent_id:
            self.client.message(agent_id, "system", f"error: {error}")
            self.client.end_agent(agent_id, "error")

    # --- tools ----------------------------------------------------------

    def on_tool_start(self, serialized: dict, input_str: str, *,
                      run_id: UUID, parent_run_id: Optional[UUID] = None,
                      **kwargs: Any) -> None:
        self._ensure_run()
        agent_id = self._agent_of.get(str(parent_run_id)) if parent_run_id else None
        agent_id = agent_id or self._lone_agent()
        call_id = new_id("tool")
        self._tool_of[str(run_id)] = (agent_id, call_id)  # type: ignore[assignment]
        name = (serialized or {}).get("name") or kwargs.get("name") or "tool"
        self.client.tool_start(agent_id, call_id, name, input=input_str)

    def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> None:
        entry = self._tool_of.get(str(run_id))
        if entry:
            agent_id, call_id = entry  # type: ignore[misc]
            self.client.tool_end(agent_id, call_id, "ok", output=str(output)[:2000])

    def on_tool_error(self, error: BaseException, *, run_id: UUID,
                      **kwargs: Any) -> None:
        entry = self._tool_of.get(str(run_id))
        if entry:
            agent_id, call_id = entry  # type: ignore[misc]
            self.client.tool_end(agent_id, call_id, "error", error=str(error))

    # --- LLM token usage ------------------------------------------------

    def on_llm_end(self, response: Any, *, run_id: UUID,
                   parent_run_id: Optional[UUID] = None, **kwargs: Any) -> None:
        agent_id = self._agent_of.get(str(parent_run_id)) if parent_run_id else None
        usage = {}
        try:
            usage = (response.llm_output or {}).get("token_usage", {})
        except Exception:  # noqa: BLE001
            pass
        it = usage.get("prompt_tokens") or usage.get("input_tokens")
        ot = usage.get("completion_tokens") or usage.get("output_tokens")
        if it or ot:
            self.client.usage(input_tokens=int(it or 0), output_tokens=int(ot or 0),
                              agent_id=agent_id)

    # --- helpers --------------------------------------------------------

    def _lone_agent(self) -> str:
        if self._agent_of:
            return next(iter(self._agent_of.values()))
        agent_id = new_id("agent")
        self._agent_of["__lone__"] = agent_id
        self.client.spawn_agent(agent_id, name="Agent", agent_type="chain")
        self.client.agent_status(agent_id, "running")
        return agent_id

    def flush(self) -> None:
        if self._started:
            self.client.run_end("done")
        self.client.flush()


if __name__ == "__main__":
    # Drive the handler by hand to demonstrate the mapping without LangChain.
    from uuid import uuid4

    h = AetherCallbackHandler(title="Callback self-demo")
    cid, tid = uuid4(), uuid4()
    h.on_chain_start({"name": "Researcher"}, {}, run_id=cid)
    h.on_tool_start({"name": "WebFetch"}, "https://example.com", run_id=tid,
                    parent_run_id=cid)
    h.on_tool_end("fetched 4kb", run_id=tid)
    h.on_chain_end({}, run_id=cid)
    h.flush()
    print("[langgraph_callback] self-demo emitted", file=sys.stderr)
