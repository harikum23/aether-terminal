import { useEffect, useMemo, useState } from "react";
import { computeTotals, useAgentStore } from "../../lib/agentStore";
import type { AgentRun } from "../../lib/agentProtocol";
import "./agents.css";

import StatBar from "./StatBar";
import RunTabs from "./RunTabs";
import Roster from "./Roster";
import DetailDrawer from "./DetailDrawer";
import Ticker from "./Ticker";
import EmptyState from "./EmptyState";

/** Pick the most-recently-active run to focus by default. */
function pickDefaultRun(runs: AgentRun[]): string | null {
  if (runs.length === 0) return null;
  const running = runs.filter((r) => r.status === "running");
  const pool = running.length ? running : runs;
  return [...pool].sort((a, b) => b.startedAt - a.startedAt)[0].id;
}

export default function MissionControl(): JSX.Element {
  const store = useAgentStore();
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const runs = useMemo(
    () => Object.values(store.runs).sort((a, b) => b.startedAt - a.startedAt),
    [store.runs],
  );

  // Resolve the focused run: explicit selection if still valid, else default.
  const activeRunId = runId && store.runs[runId] ? runId : pickDefaultRun(runs);
  const activeRun = activeRunId ? store.runs[activeRunId] : undefined;

  // If the focused run changes, drop any selection that's no longer in it.
  useEffect(() => {
    if (!selectedAgentId) return;
    const agent = store.agents[selectedAgentId];
    if (!agent || agent.runId !== activeRunId) setSelectedAgentId(null);
  }, [activeRunId, selectedAgentId, store.agents]);

  // Close drawer on Escape.
  useEffect(() => {
    if (!selectedAgentId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedAgentId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedAgentId]);

  const totals = useMemo(
    () => computeTotals(store, activeRunId ?? undefined),
    [store, activeRunId],
  );
  const live = totals.activeAgents > 0;

  if (runs.length === 0 || !activeRun) {
    return (
      <div className="mc">
        <EmptyState />
      </div>
    );
  }

  const selectedAgent = selectedAgentId ? store.agents[selectedAgentId] : undefined;

  return (
    <div className="mc">
      <StatBar totals={totals} live={live} runTitle={runs.length > 1 ? undefined : activeRun.title} />

      <RunTabs runs={runs} activeId={activeRunId} onSelect={setRunId} />

      <div className="mc-body">
        <div className={selectedAgent ? "mc-main mc-main--drawer" : "mc-main"}>
          <Roster
            run={activeRun}
            store={store}
            selectedId={selectedAgentId}
            onSelect={(id) =>
              setSelectedAgentId((cur) => (cur === id ? null : id))
            }
          />
          {selectedAgent && (
            <DetailDrawer
              key={selectedAgent.id}
              agent={selectedAgent}
              store={store}
              onClose={() => setSelectedAgentId(null)}
            />
          )}
        </div>

        <Ticker items={store.ticker} live={live} />
      </div>
    </div>
  );
}
