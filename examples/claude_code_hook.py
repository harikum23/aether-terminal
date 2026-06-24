#!/usr/bin/env python3
"""Claude Code -> Aether hook bridge.

Claude Code invokes hook scripts at lifecycle points (PreToolUse, PostToolUse,
SubagentStop, Stop, ...). It writes a JSON payload to the hook's **stdin** and
reads the hook's behaviour from its exit code / stdout. This script reads that
payload, maps it to Aether Agent Protocol (AAP) events, and POSTs them to the
local Aether ingest endpoint. It is intentionally fire-and-forget and always
exits 0 so it can never block or fail a tool call.

------------------------------------------------------------------------------
Wire it in via `.claude/settings.json` (project or ~/.claude):

    {
      "hooks": {
        "PreToolUse":  [{ "hooks": [{ "type": "command",
            "command": "python3 /ABS/PATH/examples/claude_code_hook.py" }] }],
        "PostToolUse": [{ "hooks": [{ "type": "command",
            "command": "python3 /ABS/PATH/examples/claude_code_hook.py" }] }],
        "SubagentStop":[{ "hooks": [{ "type": "command",
            "command": "python3 /ABS/PATH/examples/claude_code_hook.py" }] }],
        "Stop":        [{ "hooks": [{ "type": "command",
            "command": "python3 /ABS/PATH/examples/claude_code_hook.py" }] }]
      }
    }

The same script handles every event; it branches on `hook_event_name`.
Set AETHER_ENDPOINT to override the ingest URL.

------------------------------------------------------------------------------
Payload assumptions (documented because Claude Code's exact hook schema varies
by version -- we read defensively and degrade gracefully):

  Common fields:
    hook_event_name : "PreToolUse" | "PostToolUse" | "SubagentStop" | "Stop"
    session_id      : stable id for the Claude Code session -> we use it as runId
    cwd             : working directory (used for the run title on first event)
    transcript_path : path to the conversation transcript (unused here)

  PreToolUse / PostToolUse:
    tool_name       : e.g. "Read", "Bash", "Edit", "Task", "WebFetch"
    tool_input      : dict of tool arguments
    tool_use_id     : stable id for the tool call (preferred for toolCallId);
                      if absent we derive a stable id from tool_name+input hash.
    tool_response   : (PostToolUse) tool result; may carry an error.

  SubagentStop:
    Emitted when a Task() sub-agent finishes. Fields are sparse; we map it to
    agent.end for the sub-agent if we can identify one, else a log.

A run.start is emitted lazily the first time we see a session_id (tracked via a
small marker file under the system temp dir so we only announce each run once).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.request

ENDPOINT = os.environ.get("AETHER_ENDPOINT", "http://127.0.0.1:9700/ingest")


def _main_agent_id(run_id: str) -> str:
    """Logical id for a session's top-level agent.

    Must be unique PER SESSION: the Aether store keys agent nodes by id, so a
    fixed constant would make concurrent `claude` tabs overwrite each other.
    Deriving it from the session id keeps every terminal's run distinct.
    """
    return f"claude-main-{run_id}"


def _post(event: dict) -> None:
    """Best-effort POST. Never raises; the hook must not disrupt the session."""
    try:
        data = json.dumps(event).encode("utf-8")
        req = urllib.request.Request(
            ENDPOINT, data=data,
            headers={"content-type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=2.0).close()
    except Exception:  # noqa: BLE001
        pass  # swallow -- telemetry is non-critical


def _stamp(run_id: str, event: dict) -> dict:
    return {"runId": run_id, "ts": int(time.time() * 1000), **event}


def _tool_call_id(payload: dict, run_id: str) -> str:
    """Stable id linking a PreToolUse to its PostToolUse.

    Prefer Claude Code's own id; otherwise hash (tool_name + json(tool_input)),
    which is identical across the matched pair within a turn. Namespaced by
    run_id so two sessions can't collide on the hashed fallback (tool calls,
    like agents, are keyed globally in the Aether store).
    """
    explicit = payload.get("tool_use_id") or payload.get("toolUseId")
    if explicit:
        return str(explicit)
    basis = payload.get("tool_name", "") + json.dumps(
        payload.get("tool_input", {}), sort_keys=True
    )
    return f"tc_{run_id}_" + hashlib.sha1(basis.encode()).hexdigest()[:16]


def _run_marker(run_id: str) -> str:
    safe = hashlib.sha1(run_id.encode()).hexdigest()[:16]
    return os.path.join(tempfile.gettempdir(), f"aether-run-{safe}")


def _ensure_run_started(run_id: str, main_agent_id: str, title: str) -> None:
    """Emit run.start + the main agent.spawn once per session."""
    marker = _run_marker(run_id)
    if os.path.exists(marker):
        return
    try:
        with open(marker, "w") as fh:
            fh.write(str(int(time.time())))
    except OSError:
        pass  # if we can't write the marker we'll just re-announce; harmless
    _post(_stamp(run_id, {
        "type": "run.start", "title": title, "framework": "claude-code",
    }))
    _post(_stamp(run_id, {
        "type": "agent.spawn", "agentId": main_agent_id, "name": "Claude Code",
        "agentType": "main", "model": "claude-opus-4-8",
    }))
    _post(_stamp(run_id, {
        "type": "agent.status", "agentId": main_agent_id, "status": "running",
    }))


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        # Invoked with no payload (e.g. a defensive smoke run). Do nothing.
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return

    run_id = str(
        payload.get("session_id") or payload.get("sessionId") or "claude-code"
    )
    main_agent_id = _main_agent_id(run_id)
    cwd = payload.get("cwd") or os.getcwd()
    event_name = payload.get("hook_event_name") or payload.get("hookEventName") or ""

    _ensure_run_started(
        run_id, main_agent_id, title=f"Claude Code — {os.path.basename(cwd)}"
    )

    tool_name = payload.get("tool_name") or payload.get("toolName") or ""
    is_subagent_tool = tool_name in ("Task", "Agent")

    if event_name in ("PreToolUse", "preToolUse"):
        call_id = _tool_call_id(payload, run_id)
        tool_input = payload.get("tool_input") or payload.get("toolInput") or {}
        if is_subagent_tool:
            # A Task() spawns a sub-agent. Model the sub-agent node directly.
            sub_id = "sub_" + call_id
            _post(_stamp(run_id, {
                "type": "agent.spawn", "agentId": sub_id,
                "parentId": main_agent_id,
                "name": tool_input.get("description")
                or tool_input.get("subagent_type") or "Sub-agent",
                "agentType": tool_input.get("subagent_type") or "task",
                "task": tool_input.get("prompt") or tool_input.get("description"),
            }))
            _post(_stamp(run_id, {
                "type": "agent.status", "agentId": sub_id, "status": "running",
            }))
        else:
            _post(_stamp(run_id, {
                "type": "tool.start", "agentId": main_agent_id,
                "toolCallId": call_id, "name": tool_name, "input": tool_input,
            }))

    elif event_name in ("PostToolUse", "postToolUse"):
        call_id = _tool_call_id(payload, run_id)
        response = payload.get("tool_response") or payload.get("toolResponse")
        err = None
        status = "ok"
        if isinstance(response, dict):
            # Heuristic: many tools surface failures as an `error` key or
            # a falsy `success`.
            if response.get("error") or response.get("success") is False:
                status, err = "error", str(
                    response.get("error") or "tool reported failure"
                )
        if is_subagent_tool:
            sub_id = "sub_" + call_id
            _post(_stamp(run_id, {
                "type": "agent.end", "agentId": sub_id,
                "status": "error" if status == "error" else "done",
            }))
        else:
            _post(_stamp(run_id, {
                "type": "tool.end", "agentId": main_agent_id,
                "toolCallId": call_id, "status": status,
                **({"error": err} if err else {}),
                **({"output": _truncate(response)} if response is not None else {}),
            }))

    elif event_name in ("SubagentStop", "subagentStop"):
        # Sparse payload; we can't always recover the sub-agent id. Log it.
        _post(_stamp(run_id, {
            "type": "log", "level": "info", "agentId": main_agent_id,
            "message": "sub-agent finished",
        }))

    elif event_name in ("Stop", "stop"):
        _post(_stamp(run_id, {
            "type": "agent.end", "agentId": main_agent_id, "status": "done",
        }))
        _post(_stamp(run_id, {"type": "run.end", "status": "done"}))
        try:
            os.remove(_run_marker(run_id))
        except OSError:
            pass


def _truncate(value, limit: int = 2000):
    """Keep tool outputs from bloating the event stream."""
    try:
        s = value if isinstance(value, str) else json.dumps(value)
    except (TypeError, ValueError):
        s = str(value)
    return s if len(s) <= limit else s[:limit] + "…[truncated]"


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 -- a hook must never fail the session
        pass
    sys.exit(0)
