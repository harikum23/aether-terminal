/* ============================================================================
 * Aether Agent Protocol (AAP) — TypeScript client SDK.
 *
 * Zero runtime dependencies. Works in Node 18+ and modern browsers (global
 * `fetch`). Fire-and-forget: instrumentation must never crash the host agent,
 * so every network error is swallowed (console.warn) rather than thrown.
 *
 * The wire shapes mirror `src/lib/agentProtocol.ts` — keep them in sync.
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   import { AetherClient, id } from "./aether";
 *
 *   const aether = new AetherClient();              // POSTs to 127.0.0.1:9700
 *   aether.runStart("Refactor auth module", "custom");
 *
 *   const orch = id("agent");
 *   aether.spawnAgent({ agentId: orch, name: "Orchestrator", model: "claude-opus-4-8" });
 *   aether.agentStatus(orch, "running");
 *
 *   const call = id("tool");
 *   aether.toolStart(orch, call, "Read", { path: "src/auth.ts" });
 *   aether.toolEnd(orch, call, "ok", { durationMs: 42, output: "...file..." });
 *
 *   aether.message(orch, "assistant", "Found 3 call sites to update.");
 *   aether.endAgent(orch, "done", { inputTokens: 1200, outputTokens: 380, costUsd: 0.012 });
 *   aether.runEnd("done");
 * ========================================================================== */

export type AgentStatus = "spawning" | "running" | "waiting" | "done" | "error";
export type ToolEndStatus = "ok" | "error";
export type RunStatus = "running" | "done" | "error";
export type MessageRole = "assistant" | "thinking" | "system" | "user";
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Token/cost usage attached to an agent's end event. */
export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** Extra fields for a tool.end event. */
export interface ToolEndExtra {
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface SpawnAgentArgs {
  agentId: string;
  name: string;
  parentId?: string;
  agentType?: string;
  model?: string;
  task?: string;
}

export interface AetherClientOptions {
  /** Ingest endpoint. Default `http://127.0.0.1:9700/ingest`. */
  endpoint?: string;
  /** Run id. Auto-generated if absent. */
  runId?: string;
  /** Override fetch (e.g. for tests / non-global environments). */
  fetchImpl?: typeof fetch;
}

/** A monotonic-ish, collision-resistant id with an optional prefix. */
export function id(prefix = "ae"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:9700/ingest";

export class AetherClient {
  readonly endpoint: string;
  readonly runId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AetherClientOptions = {}) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.runId = opts.runId ?? id("run");
    const f = opts.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!f) {
      throw new Error(
        "AetherClient: no global `fetch` available. Use Node 18+ or pass `fetchImpl`.",
      );
    }
    this.fetchImpl = f;
  }

  // --- run lifecycle -------------------------------------------------------

  runStart(title: string, framework?: string): void {
    this.send({ type: "run.start", title, ...(framework ? { framework } : {}) });
  }

  runEnd(status: RunStatus): void {
    this.send({ type: "run.end", status });
  }

  // --- agents --------------------------------------------------------------

  spawnAgent(args: SpawnAgentArgs): void {
    const { agentId, name, parentId, agentType, model, task } = args;
    this.send({
      type: "agent.spawn",
      agentId,
      name,
      ...(parentId ? { parentId } : {}),
      ...(agentType ? { agentType } : {}),
      ...(model ? { model } : {}),
      ...(task ? { task } : {}),
    });
  }

  agentStatus(agentId: string, status: AgentStatus): void {
    this.send({ type: "agent.status", agentId, status });
  }

  message(agentId: string, role: MessageRole, text: string): void {
    this.send({ type: "agent.message", agentId, role, text });
  }

  endAgent(agentId: string, status: AgentStatus, usage?: UsageInfo): void {
    this.send({
      type: "agent.end",
      agentId,
      status,
      ...(usage?.inputTokens != null ? { inputTokens: usage.inputTokens } : {}),
      ...(usage?.outputTokens != null ? { outputTokens: usage.outputTokens } : {}),
      ...(usage?.costUsd != null ? { costUsd: usage.costUsd } : {}),
    });
  }

  // --- tools ---------------------------------------------------------------

  toolStart(agentId: string, toolCallId: string, name: string, input?: unknown): void {
    this.send({
      type: "tool.start",
      agentId,
      toolCallId,
      name,
      ...(input !== undefined ? { input } : {}),
    });
  }

  toolEnd(
    agentId: string,
    toolCallId: string,
    status: ToolEndStatus,
    extra: ToolEndExtra = {},
  ): void {
    this.send({
      type: "tool.end",
      agentId,
      toolCallId,
      status,
      ...(extra.output !== undefined ? { output: extra.output } : {}),
      ...(extra.error !== undefined ? { error: extra.error } : {}),
      ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
    });
  }

  // --- usage & logs --------------------------------------------------------

  usage(args: {
    inputTokens: number;
    outputTokens: number;
    agentId?: string;
    model?: string;
    costUsd?: number;
  }): void {
    const { inputTokens, outputTokens, agentId, model, costUsd } = args;
    this.send({
      type: "usage",
      inputTokens,
      outputTokens,
      ...(agentId ? { agentId } : {}),
      ...(model ? { model } : {}),
      ...(costUsd != null ? { costUsd } : {}),
    });
  }

  log(level: LogLevel, message: string, agentId?: string): void {
    this.send({ type: "log", level, message, ...(agentId ? { agentId } : {}) });
  }

  // --- transport -----------------------------------------------------------

  /**
   * Stamp a partial event with runId + ts and POST it. Fire-and-forget:
   * returns immediately, never rejects into the caller.
   */
  private send(event: Record<string, unknown>): void {
    const payload = { runId: this.runId, ts: Date.now(), ...event };
    void this.post(payload);
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    try {
      await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        // keepalive lets browser flush during unload; harmless in Node.
        keepalive: true,
      });
    } catch (err) {
      // Instrumentation must never break the host. Best-effort only.
      console.warn(`[aether] failed to emit ${String(payload.type)}:`, err);
    }
  }
}

export default AetherClient;
