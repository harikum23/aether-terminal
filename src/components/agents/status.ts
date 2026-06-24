import type { AgentStatus, RunStatus, ToolStatus } from "../../lib/agentProtocol";

/** Maps an agent status to a CSS accent var + label + whether it reads "alive". */
export interface StatusVisual {
  /** value for --c-accent on the card */
  color: string;
  label: string;
  live: boolean;
}

export function agentVisual(status: AgentStatus): StatusVisual {
  switch (status) {
    case "spawning":
      return { color: "var(--accent-2)", label: "spawning", live: true };
    case "running":
      return { color: "var(--accent)", label: "running", live: true };
    case "waiting":
      return { color: "var(--mc-warn)", label: "waiting", live: true };
    case "done":
      return { color: "var(--mc-ok)", label: "done", live: false };
    case "error":
      return { color: "var(--mc-err)", label: "error", live: false };
  }
}

export function runDotColor(status: RunStatus): string {
  switch (status) {
    case "running":
      return "var(--accent)";
    case "done":
      return "var(--mc-ok)";
    case "error":
      return "var(--mc-err)";
  }
}

export function toolGlyph(status: ToolStatus): { cls: string; glyph: string } {
  switch (status) {
    case "ok":
      return { cls: "mc-wf__icon--ok", glyph: "✓" };
    case "error":
      return { cls: "mc-wf__icon--err", glyph: "✕" };
    case "running":
      return { cls: "mc-wf__icon--running", glyph: "" };
  }
}

/** Ticker kind → modifier class + glyph for the live feed. */
export function tickVisual(kind: string): { cls: string; glyph: string } {
  switch (kind) {
    case "agent.spawn":
      return { cls: "mc-tick--spawn", glyph: "✦" };
    case "tool.start":
      return { cls: "mc-tick--tool", glyph: "›" };
    case "tool.end":
      return { cls: "mc-tick--err", glyph: "✕" };
    case "agent.end":
      return { cls: "mc-tick--end", glyph: "●" };
    case "run.start":
    case "run.end":
      return { cls: "mc-tick--run", glyph: "▸" };
    case "log":
      return { cls: "mc-tick--run", glyph: "·" };
    default:
      return { cls: "", glyph: "·" };
  }
}
