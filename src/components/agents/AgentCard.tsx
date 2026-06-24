import type { AgentNode, AgentStoreState } from "../../lib/agentProtocol";
import { fmtCost, fmtTokens } from "./format";
import { agentVisual } from "./status";

interface AgentCardProps {
  agent: AgentNode;
  store: AgentStoreState;
  selected: boolean;
  onSelect: (id: string) => void;
}

export default function AgentCard({ agent, store, selected, onSelect }: AgentCardProps) {
  const vis = agentVisual(agent.status);
  const activeTool = agent.activeToolId ? store.tools[agent.activeToolId] : undefined;
  const toolCount = agent.toolCallIds.length;
  const lastTool =
    toolCount > 0 ? store.tools[agent.toolCallIds[toolCount - 1]] : undefined;

  const cls = [
    "mc-card",
    selected && "mc-card--selected",
    vis.live && "mc-card--live",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={cls}
      style={{ ["--c-accent" as string]: vis.color }}
      onClick={() => onSelect(agent.id)}
      aria-pressed={selected}
    >
      <span className="mc-card__rail" />

      <div className="mc-card__head">
        <span className="mc-card__name">{agent.name}</span>
        {agent.agentType && <span className="mc-badge">{agent.agentType}</span>}
        {agent.model && <span className="mc-chip">{agent.model}</span>}
        <span className={vis.live ? "mc-status mc-status--live" : "mc-status"}>
          <span className="mc-status__dot" />
          {vis.label}
        </span>
      </div>

      <div className="mc-card__tool">
        {activeTool ? (
          <>
            <span className="mc-spin" aria-hidden />
            <span className="mc-card__tool-name">{activeTool.name}</span>
          </>
        ) : lastTool ? (
          <span className="mc-card__tool-idle">
            last · {lastTool.name}
            {lastTool.status === "error" ? " (failed)" : ""}
          </span>
        ) : (
          <span className="mc-card__tool-idle">no tool activity yet</span>
        )}
      </div>

      <div className="mc-card__metric">
        <span className="mc-card__cost num">{fmtCost(agent.costUsd)}</span>
        <span className="mc-card__io">
          <span>
            <b>{fmtTokens(agent.inputTokens)}</b>↓
          </span>
          <span>
            <b>{fmtTokens(agent.outputTokens)}</b>↑
          </span>
        </span>
        <span className="mc-card__tools-n">
          {toolCount} tool{toolCount === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}
