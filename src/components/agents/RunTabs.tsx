import type { AgentRun } from "../../lib/agentProtocol";
import { fmtElapsed } from "./format";
import { runDotColor } from "./status";
import { useTick } from "./hooks";

interface RunTabsProps {
  runs: AgentRun[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export default function RunTabs({ runs, activeId, onSelect }: RunTabsProps) {
  // keep elapsed clocks live while any run is running
  const anyRunning = runs.some((r) => r.status === "running");
  useTick(1000, anyRunning);

  if (runs.length <= 1) return null;

  return (
    <div className="mc-runs" role="tablist" aria-label="Agent runs">
      <span className="mc-runs__lead">Runs</span>
      {runs.map((run) => {
        const active = run.id === activeId;
        const end = run.endedAt ?? Date.now();
        const elapsed = fmtElapsed(end - run.startedAt);
        return (
          <button
            key={run.id}
            role="tab"
            aria-selected={active}
            className={active ? "mc-runtab mc-runtab--active" : "mc-runtab"}
            onClick={() => onSelect(run.id)}
          >
            <span
              className="mc-runtab__status"
              style={{
                background: runDotColor(run.status),
                boxShadow: `0 0 8px ${runDotColor(run.status)}`,
                animation:
                  run.status === "running"
                    ? "mc-pulse 1.6s var(--mc-ease) infinite"
                    : "none",
              }}
            />
            <span className="mc-runtab__meta">
              <span className="mc-runtab__title">{run.title}</span>
              <span className="mc-runtab__sub">
                {run.framework ?? "agents"} · {run.status} · {elapsed}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
