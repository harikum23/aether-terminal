import { applyEvent, resetStore } from "./agentStore";
import type { AgentEvent } from "./agentProtocol";

/* A representative multi-agent run for design previews and offline demos.
 * Mirrors what a real Claude/OpenAI orchestration would emit. */

const RUN = "run-demo";

function seed(base: number): AgentEvent[] {
  const t = (s: number) => base + s * 1000;
  return [
    { type: "run.start", runId: RUN, title: "Refactor auth module", framework: "claude-code", ts: t(0) },

    { type: "agent.spawn", runId: RUN, agentId: "orch", name: "orchestrator", agentType: "orchestrator", model: "claude-opus-4-8", task: "Refactor the auth module for clarity and safety", ts: t(0) },
    { type: "agent.status", runId: RUN, agentId: "orch", status: "running", ts: t(1) },

    { type: "agent.spawn", runId: RUN, agentId: "explore", parentId: "orch", name: "code-explorer", agentType: "explorer", model: "claude-sonnet-4-6", task: "Map the existing auth flow", ts: t(2) },
    { type: "tool.start", runId: RUN, agentId: "explore", toolCallId: "tc1", name: "Grep", input: { pattern: "login|session|token" }, ts: t(2) },
    { type: "tool.end", runId: RUN, agentId: "explore", toolCallId: "tc1", status: "ok", durationMs: 820, ts: t(3) },
    { type: "tool.start", runId: RUN, agentId: "explore", toolCallId: "tc2", name: "Read", input: { file: "src/auth/session.ts" }, ts: t(3) },
    { type: "tool.end", runId: RUN, agentId: "explore", toolCallId: "tc2", status: "ok", durationMs: 410, ts: t(4) },
    { type: "usage", runId: RUN, agentId: "explore", model: "claude-sonnet-4-6", inputTokens: 12400, outputTokens: 1820, costUsd: 0.07, ts: t(4) },
    { type: "agent.end", runId: RUN, agentId: "explore", status: "done", inputTokens: 12400, outputTokens: 1820, costUsd: 0.07, ts: t(5) },

    { type: "agent.spawn", runId: RUN, agentId: "arch", parentId: "orch", name: "code-architect", agentType: "architect", model: "claude-opus-4-8", task: "Design the refactor", ts: t(5) },
    { type: "agent.message", runId: RUN, agentId: "arch", role: "thinking", text: "Session handling is split across 3 modules; consolidate behind a SessionService.", ts: t(6) },
    { type: "tool.start", runId: RUN, agentId: "arch", toolCallId: "tc3", name: "Read", input: { file: "src/auth/middleware.ts" }, ts: t(6) },
    { type: "tool.end", runId: RUN, agentId: "arch", toolCallId: "tc3", status: "ok", durationMs: 380, ts: t(7) },
    { type: "tool.start", runId: RUN, agentId: "arch", toolCallId: "tc4", name: "WebFetch", input: { url: "https://owasp.org/session" }, ts: t(7) },
    { type: "tool.end", runId: RUN, agentId: "arch", toolCallId: "tc4", status: "error", error: "timeout after 30s", durationMs: 30000, ts: t(8) },
    { type: "usage", runId: RUN, agentId: "arch", model: "claude-opus-4-8", inputTokens: 28800, outputTokens: 6400, costUsd: 0.62, ts: t(9) },
    { type: "agent.status", runId: RUN, agentId: "arch", status: "running", ts: t(9) },

    { type: "agent.spawn", runId: RUN, agentId: "review", parentId: "orch", name: "code-reviewer", agentType: "reviewer", model: "claude-opus-4-8", task: "Review the proposed diff", ts: t(9) },
    { type: "tool.start", runId: RUN, agentId: "review", toolCallId: "tc5", name: "Bash", input: { command: "git diff --stat" }, ts: t(10) },
  ];
}

/** Replace store contents with the demo scenario. */
export function seedMockStore(): void {
  resetStore();
  // anchor times slightly in the past so durations read naturally
  const base = Date.now() - 11_000;
  for (const ev of seed(base)) applyEvent(ev);
}
