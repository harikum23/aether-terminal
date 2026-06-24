import { useEffect, useSyncExternalStore } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  type AgentEvent,
  type AgentNode,
  type AgentRun,
  type AgentStoreState,
  type AgentTotals,
  type TickerItem,
  type ToolCall,
  EMPTY_STORE,
} from "./agentProtocol";

/* ============================================================================
 * A tiny external store: reduces the AAP event stream into the view-model and
 * notifies React via useSyncExternalStore. One instance for the whole app.
 * ========================================================================== */

const TICKER_CAP = 240;
const MESSAGE_CAP = 200;

let state: AgentStoreState = EMPTY_STORE;
const listeners = new Set<() => void>();
let tickSeq = 0;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): AgentStoreState {
  return state;
}

function now(ev: AgentEvent): number {
  return ev.ts ?? Date.now();
}

function pushTicker(item: Omit<TickerItem, "id">) {
  tickSeq += 1;
  const ticker = [...state.ticker, { ...item, id: `tk-${tickSeq}` }];
  if (ticker.length > TICKER_CAP) ticker.splice(0, ticker.length - TICKER_CAP);
  state = { ...state, ticker };
}

function upsertRun(id: string, patch: Partial<AgentRun>, ts: number) {
  const prev: AgentRun =
    state.runs[id] ??
    {
      id,
      title: id,
      status: "running",
      startedAt: ts,
      rootAgentIds: [],
      agentIds: [],
    };
  state = { ...state, runs: { ...state.runs, [id]: { ...prev, ...patch } } };
}

function patchAgent(id: string, patch: Partial<AgentNode>) {
  const prev = state.agents[id];
  if (!prev) return;
  state = { ...state, agents: { ...state.agents, [id]: { ...prev, ...patch } } };
}

/** Reduce a single event into the store and notify subscribers. */
export function applyEvent(ev: AgentEvent): void {
  const ts = now(ev);

  switch (ev.type) {
    case "run.start": {
      upsertRun(
        ev.runId,
        { title: ev.title, framework: ev.framework, status: "running", startedAt: ts },
        ts,
      );
      pushTicker({ ts, kind: ev.type, runId: ev.runId, label: `Run started`, detail: ev.title });
      break;
    }

    case "run.end": {
      upsertRun(ev.runId, { status: ev.status, endedAt: ts }, ts);
      pushTicker({ ts, kind: ev.type, runId: ev.runId, label: `Run ${ev.status}` });
      break;
    }

    case "agent.spawn": {
      upsertRun(ev.runId, {}, ts);
      const node: AgentNode = {
        id: ev.agentId,
        runId: ev.runId,
        parentId: ev.parentId,
        name: ev.name,
        agentType: ev.agentType,
        model: ev.model,
        task: ev.task,
        status: "spawning",
        startedAt: ts,
        lastActivity: ts,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        toolCallIds: [],
        messages: [],
      };
      state = { ...state, agents: { ...state.agents, [ev.agentId]: node } };
      const run = state.runs[ev.runId];
      const agentIds = run.agentIds.includes(ev.agentId)
        ? run.agentIds
        : [...run.agentIds, ev.agentId];
      const rootAgentIds =
        ev.parentId || run.rootAgentIds.includes(ev.agentId)
          ? run.rootAgentIds
          : [...run.rootAgentIds, ev.agentId];
      upsertRun(ev.runId, { agentIds, rootAgentIds }, ts);
      pushTicker({
        ts,
        kind: ev.type,
        runId: ev.runId,
        agentId: ev.agentId,
        label: `Dispatched ${ev.name}`,
        detail: ev.agentType ?? ev.model,
      });
      break;
    }

    case "agent.status": {
      patchAgent(ev.agentId, { status: ev.status, lastActivity: ts });
      break;
    }

    case "agent.message": {
      const prev = state.agents[ev.agentId];
      if (prev) {
        const messages = [...prev.messages, { role: ev.role, text: ev.text, ts }];
        if (messages.length > MESSAGE_CAP) messages.splice(0, messages.length - MESSAGE_CAP);
        patchAgent(ev.agentId, { messages, lastActivity: ts });
      }
      break;
    }

    case "agent.end": {
      const prev = state.agents[ev.agentId];
      patchAgent(ev.agentId, {
        status: ev.status,
        endedAt: ts,
        lastActivity: ts,
        activeToolId: undefined,
        inputTokens: ev.inputTokens ?? prev?.inputTokens ?? 0,
        outputTokens: ev.outputTokens ?? prev?.outputTokens ?? 0,
        costUsd: ev.costUsd ?? prev?.costUsd ?? 0,
      });
      pushTicker({
        ts,
        kind: ev.type,
        runId: ev.runId,
        agentId: ev.agentId,
        label: `${prev?.name ?? ev.agentId} ${ev.status}`,
      });
      break;
    }

    case "tool.start": {
      const tool: ToolCall = {
        id: ev.toolCallId,
        agentId: ev.agentId,
        runId: ev.runId,
        name: ev.name,
        input: ev.input,
        status: "running",
        startedAt: ts,
      };
      state = { ...state, tools: { ...state.tools, [ev.toolCallId]: tool } };
      const prev = state.agents[ev.agentId];
      if (prev) {
        patchAgent(ev.agentId, {
          toolCallIds: prev.toolCallIds.includes(ev.toolCallId)
            ? prev.toolCallIds
            : [...prev.toolCallIds, ev.toolCallId],
          activeToolId: ev.toolCallId,
          status: prev.status === "spawning" ? "running" : prev.status,
          lastActivity: ts,
        });
      }
      pushTicker({
        ts,
        kind: ev.type,
        runId: ev.runId,
        agentId: ev.agentId,
        label: `${prev?.name ?? ev.agentId} → ${ev.name}`,
      });
      break;
    }

    case "tool.end": {
      const prev = state.tools[ev.toolCallId];
      if (prev) {
        const durationMs = ev.durationMs ?? ts - prev.startedAt;
        state = {
          ...state,
          tools: {
            ...state.tools,
            [ev.toolCallId]: {
              ...prev,
              status: ev.status,
              output: ev.output,
              error: ev.error,
              endedAt: ts,
              durationMs,
            },
          },
        };
        const agent = state.agents[prev.agentId];
        if (agent && agent.activeToolId === ev.toolCallId) {
          patchAgent(prev.agentId, { activeToolId: undefined, lastActivity: ts });
        }
        if (ev.status === "error") {
          pushTicker({
            ts,
            kind: ev.type,
            runId: ev.runId,
            agentId: ev.agentId,
            label: `${prev.name} failed`,
            detail: ev.error,
          });
        }
      }
      break;
    }

    case "usage": {
      if (ev.agentId) {
        const prev = state.agents[ev.agentId];
        if (prev) {
          patchAgent(ev.agentId, {
            inputTokens: prev.inputTokens + ev.inputTokens,
            outputTokens: prev.outputTokens + ev.outputTokens,
            costUsd: prev.costUsd + (ev.costUsd ?? 0),
            lastActivity: ts,
          });
        }
      }
      break;
    }

    case "log": {
      pushTicker({
        ts,
        kind: ev.type,
        runId: ev.runId,
        agentId: ev.agentId,
        label: ev.message,
        detail: ev.level,
      });
      break;
    }
  }

  emit();
}

export function resetStore(): void {
  state = EMPTY_STORE;
  emit();
}

/* ----------------------------------------------------------------------------
 * Tauri ingestion bridge — start once, forward `agent://event` into the store.
 * -------------------------------------------------------------------------- */
let bridgeStarted = false;
let unlistenBridge: UnlistenFn | undefined;

async function startBridge() {
  if (bridgeStarted) return;
  bridgeStarted = true;
  try {
    unlistenBridge = await listen<AgentEvent>("agent://event", (e) => {
      applyEvent(e.payload);
    });
  } catch {
    // not running under Tauri (e.g. plain vite preview) — store still works
    // via injected/mock events.
    bridgeStarted = false;
  }
}

/** Start the ingestion bridge from app boot so no events are missed. */
export function ensureBridge(): void {
  void startBridge();
}

export function stopBridge(): void {
  unlistenBridge?.();
  unlistenBridge = undefined;
  bridgeStarted = false;
}

/* ----------------------------------------------------------------------------
 * React hooks + selectors.
 * -------------------------------------------------------------------------- */

export function useAgentStore(): AgentStoreState {
  useEffect(() => {
    void startBridge();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function computeTotals(
  s: AgentStoreState,
  runId?: string,
): AgentTotals {
  const agents = Object.values(s.agents).filter(
    (a) => !runId || a.runId === runId,
  );
  const tools = Object.values(s.tools).filter(
    (t) => !runId || t.runId === runId,
  );
  return {
    agents: agents.length,
    activeAgents: agents.filter((a) => a.status === "running" || a.status === "waiting" || a.status === "spawning").length,
    toolCalls: tools.length,
    activeToolCalls: tools.filter((t) => t.status === "running").length,
    inputTokens: agents.reduce((n, a) => n + a.inputTokens, 0),
    outputTokens: agents.reduce((n, a) => n + a.outputTokens, 0),
    costUsd: agents.reduce((n, a) => n + a.costUsd, 0),
    errors:
      agents.filter((a) => a.status === "error").length +
      tools.filter((t) => t.status === "error").length,
  };
}

/** Children of an agent (sub-agents), in spawn order. */
export function childrenOf(s: AgentStoreState, agentId: string): AgentNode[] {
  return Object.values(s.agents)
    .filter((a) => a.parentId === agentId)
    .sort((a, b) => a.startedAt - b.startedAt);
}
