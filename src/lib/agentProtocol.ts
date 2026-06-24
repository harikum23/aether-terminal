/* ============================================================================
 * Aether Agent Protocol (AAP) — the canonical contract.
 *
 * Agent frameworks (Claude Code, OpenAI Agents SDK, LangGraph, CrewAI, custom)
 * emit `AgentEvent`s to the local ingestion server (ws://127.0.0.1:9700/ws or
 * POST http://127.0.0.1:9700/ingest). The Rust backend forwards each event to
 * the webview as a Tauri `agent://event`. The store reduces the event stream
 * into the view-model entities below, which the Mission Control UI renders.
 *
 * This file is the single source of truth. The Rust server treats events as
 * opaque JSON; the SDKs mirror these shapes. Keep all three in sync.
 * ========================================================================== */

/** Epoch milliseconds. */
export type Millis = number;

export type AgentStatus =
  | "spawning"
  | "running"
  | "waiting"
  | "done"
  | "error";

export type ToolStatus = "running" | "ok" | "error";

export type RunStatus = "running" | "done" | "error";

export type MessageRole = "assistant" | "thinking" | "system" | "user";

export type LogLevel = "debug" | "info" | "warn" | "error";

/* ----------------------------------------------------------------------------
 * Wire events — a discriminated union on `type`. `ts` defaults to server
 * receive-time if a client omits it. All ids are client-supplied strings.
 * -------------------------------------------------------------------------- */

interface BaseEvent {
  runId: string;
  ts?: Millis;
}

export interface RunStartEvent extends BaseEvent {
  type: "run.start";
  title: string;
  framework?: string; // "claude-code" | "openai-agents" | "langgraph" | ...
}

export interface RunEndEvent extends BaseEvent {
  type: "run.end";
  status: RunStatus;
}

export interface AgentSpawnEvent extends BaseEvent {
  type: "agent.spawn";
  agentId: string;
  parentId?: string; // sub-agent of another agent
  name: string;
  agentType?: string; // role, e.g. "code-reviewer", "researcher"
  model?: string; // "claude-opus-4-8", "gpt-5", ...
  task?: string; // the prompt / objective handed to the agent
}

export interface AgentStatusEvent extends BaseEvent {
  type: "agent.status";
  agentId: string;
  status: AgentStatus;
}

export interface AgentMessageEvent extends BaseEvent {
  type: "agent.message";
  agentId: string;
  role: MessageRole;
  text: string;
}

export interface AgentEndEvent extends BaseEvent {
  type: "agent.end";
  agentId: string;
  status: AgentStatus; // typically "done" | "error"
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ToolStartEvent extends BaseEvent {
  type: "tool.start";
  agentId: string;
  toolCallId: string;
  name: string; // "Read", "Bash", "web_search", ...
  input?: unknown; // arguments (any JSON)
}

export interface ToolEndEvent extends BaseEvent {
  type: "tool.end";
  agentId: string;
  toolCallId: string;
  status: Exclude<ToolStatus, "running">;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface UsageEvent extends BaseEvent {
  type: "usage";
  agentId?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface LogEvent extends BaseEvent {
  type: "log";
  agentId?: string;
  level: LogLevel;
  message: string;
}

export type AgentEvent =
  | RunStartEvent
  | RunEndEvent
  | AgentSpawnEvent
  | AgentStatusEvent
  | AgentMessageEvent
  | AgentEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | UsageEvent
  | LogEvent;

/* ----------------------------------------------------------------------------
 * View-model entities — what the store produces and the UI consumes.
 * -------------------------------------------------------------------------- */

export interface AgentMessage {
  role: MessageRole;
  text: string;
  ts: Millis;
}

export interface ToolCall {
  id: string;
  agentId: string;
  runId: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  status: ToolStatus;
  startedAt: Millis;
  endedAt?: Millis;
  durationMs?: number;
}

export interface AgentNode {
  id: string;
  runId: string;
  parentId?: string;
  name: string;
  agentType?: string;
  model?: string;
  task?: string;
  status: AgentStatus;
  startedAt: Millis;
  endedAt?: Millis;
  lastActivity: Millis;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** ids into the tools map, in start order */
  toolCallIds: string[];
  /** id of the tool currently running, if any */
  activeToolId?: string;
  messages: AgentMessage[];
}

export interface AgentRun {
  id: string;
  title: string;
  framework?: string;
  status: RunStatus;
  startedAt: Millis;
  endedAt?: Millis;
  /** root agent ids (no parent), in spawn order */
  rootAgentIds: string[];
  /** all agent ids in this run */
  agentIds: string[];
}

/** A flattened, timestamped event for the live ticker. */
export interface TickerItem {
  id: string;
  ts: Millis;
  kind: AgentEvent["type"];
  runId: string;
  agentId?: string;
  label: string;
  detail?: string;
}

export interface AgentStoreState {
  runs: Record<string, AgentRun>;
  agents: Record<string, AgentNode>;
  tools: Record<string, ToolCall>;
  /** most-recent-last, capped */
  ticker: TickerItem[];
}

export const EMPTY_STORE: AgentStoreState = {
  runs: {},
  agents: {},
  tools: {},
  ticker: [],
};

/** Aggregate totals across all (or one) run — used by the stat meters. */
export interface AgentTotals {
  agents: number;
  activeAgents: number;
  toolCalls: number;
  activeToolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errors: number;
}
