import type { AgentTotals } from "../../lib/agentProtocol";
import { fmtCost, fmtTokens } from "./format";
import { useCountUp, useReducedMotion } from "./hooks";

interface StatBarProps {
  totals: AgentTotals;
  live: boolean;
  runTitle?: string;
}

/** An animated integer that counts up to its target. */
function Counter({ value, reduced }: { value: number; reduced: boolean }) {
  const v = useCountUp(value, reduced);
  return <>{Math.round(v).toLocaleString()}</>;
}

interface PillProps {
  label: string;
  accent?: string;
  tone?: "ok" | "warn" | "err";
  hot?: boolean;
  children: React.ReactNode;
}
function Pill({ label, accent, tone, hot, children }: PillProps) {
  const cls = ["mc-pill", hot && "mc-pill--hot", tone && `mc-pill--${tone}`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={accent ? ({ ["--pill-accent" as string]: accent }) : undefined}>
      <span className="mc-pill__label">{label}</span>
      <span className="mc-pill__value">{children}</span>
    </div>
  );
}

export default function StatBar({ totals, live, runTitle }: StatBarProps) {
  const reduced = useReducedMotion();
  return (
    <div className="mc-statbar">
      <div className="mc-statbar__title">
        <span className="mc-statbar__kicker">
          <span className={live ? "mc-live" : "mc-live mc-live--idle"}>
            <span className="mc-live__dot" />
            {live ? "LIVE" : "IDLE"}
          </span>
        </span>
        <span className="mc-statbar__name">Mission Control</span>
      </div>

      <div className="mc-stats">
        <Pill label="Agents" accent="var(--accent)" hot={totals.activeAgents > 0}>
          <Counter value={totals.activeAgents} reduced={reduced} />
          <span className="mc-pill__sub">/ {totals.agents}</span>
        </Pill>

        <Pill label="Tool Calls" accent="var(--accent)" hot={totals.activeToolCalls > 0}>
          <Counter value={totals.activeToolCalls} reduced={reduced} />
          <span className="mc-pill__sub">/ {totals.toolCalls}</span>
        </Pill>

        <Pill label="Input tok" accent="var(--accent-2)">
          {fmtTokens(totals.inputTokens)}
        </Pill>

        <Pill label="Output tok" accent="var(--accent-2)">
          {fmtTokens(totals.outputTokens)}
        </Pill>

        <Pill label="Cost" accent="var(--mc-ok)" tone="ok">
          {fmtCost(totals.costUsd)}
        </Pill>

        <Pill
          label="Errors"
          accent={totals.errors > 0 ? "var(--mc-err)" : "var(--text-dim)"}
          tone={totals.errors > 0 ? "err" : undefined}
        >
          <Counter value={totals.errors} reduced={reduced} />
        </Pill>
      </div>

      {runTitle && (
        <div className="mc-statbar__title" style={{ borderRight: "none", borderLeft: "1px solid var(--mc-line)", paddingRight: 0, paddingLeft: 14, marginRight: 0, marginLeft: 4 }}>
          <span className="mc-statbar__kicker">Focused run</span>
          <span className="mc-statbar__name" style={{ fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {runTitle}
          </span>
        </div>
      )}
    </div>
  );
}
