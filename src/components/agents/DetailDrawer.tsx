import { useMemo } from "react";
import type { AgentNode, AgentStoreState, ToolCall } from "../../lib/agentProtocol";
import { fmtAgo, fmtCost, fmtDuration, fmtTokens, summarizeInput } from "./format";
import { agentVisual, toolGlyph } from "./status";

interface DetailDrawerProps {
  agent: AgentNode;
  store: AgentStoreState;
  onClose: () => void;
}

function WaterfallRow({ tool, maxDur }: { tool: ToolCall; maxDur: number }) {
  const { cls, glyph } = toolGlyph(tool.status);
  const input = summarizeInput(tool.input);
  const running = tool.status === "running";
  const dur = tool.durationMs ?? (running ? Date.now() - tool.startedAt : 0);
  const pct = maxDur > 0 ? Math.max(4, Math.round((dur / maxDur) * 100)) : 4;

  const barCls = [
    "mc-wf__bar-fill",
    tool.status === "error" && "mc-wf__bar-fill--err",
    running && "mc-wf__bar-fill--running",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mc-wf__row">
      <span className={`mc-wf__icon ${cls}`} aria-hidden>
        {running ? <span className="mc-spin" /> : glyph}
      </span>
      <div className="mc-wf__main">
        <div className="mc-wf__name">{tool.name}</div>
        {input && <div className="mc-wf__input">{input}</div>}
        {tool.error && <div className="mc-wf__err">⚠ {tool.error}</div>}
      </div>
      <div className="mc-wf__right">
        <span className="mc-wf__dur num">{running ? "running" : fmtDuration(dur)}</span>
        <span className="mc-wf__bar">
          <span className={barCls} style={{ width: running ? "60%" : `${pct}%` }} />
        </span>
      </div>
    </div>
  );
}

export default function DetailDrawer({ agent, store, onClose }: DetailDrawerProps) {
  const vis = agentVisual(agent.status);
  const tools = useMemo(
    () => agent.toolCallIds.map((id) => store.tools[id]).filter((t): t is ToolCall => Boolean(t)),
    [agent.toolCallIds, store.tools],
  );
  const maxDur = useMemo(
    () =>
      tools.reduce((m, t) => Math.max(m, t.durationMs ?? (t.status === "running" ? 0 : 0)), 1),
    [tools],
  );
  const messages = agent.messages.filter((m) => m.role === "thinking" || m.role === "assistant");

  return (
    <aside className="mc-drawer" aria-label={`${agent.name} detail`}>
      <div className="mc-drawer__head" style={{ ["--c-accent" as string]: vis.color }}>
        <div className="mc-drawer__titlewrap">
          <span className="mc-drawer__name">{agent.name}</span>
          <div className="mc-drawer__badges">
            {agent.agentType && <span className="mc-badge">{agent.agentType}</span>}
            {agent.model && <span className="mc-chip">{agent.model}</span>}
            <span className={vis.live ? "mc-status mc-status--live" : "mc-status"}>
              <span className="mc-status__dot" />
              {vis.label}
            </span>
            <span className="mc-chip">{fmtCost(agent.costUsd)}</span>
            <span className="mc-chip">
              {fmtTokens(agent.inputTokens)}↓ {fmtTokens(agent.outputTokens)}↑
            </span>
          </div>
        </div>
        <button className="mc-drawer__close" onClick={onClose} aria-label="Close detail">
          ✕
        </button>
      </div>

      <div className="mc-drawer__body mc-scroll">
        {agent.task && (
          <section className="mc-section">
            <div className="mc-section__title">Task</div>
            <div className="mc-task">{agent.task}</div>
          </section>
        )}

        <section className="mc-section">
          <div className="mc-section__title">
            Tool Timeline · {tools.length}
          </div>
          {tools.length > 0 ? (
            <div className="mc-wf">
              {tools.map((tool) => (
                <WaterfallRow key={tool.id} tool={tool} maxDur={maxDur} />
              ))}
            </div>
          ) : (
            <div className="mc-detail-empty">No tool calls recorded yet.</div>
          )}
        </section>

        <section className="mc-section">
          <div className="mc-section__title">Reasoning · {messages.length}</div>
          {messages.length > 0 ? (
            <div className="mc-msgs">
              {messages.map((m, i) => (
                <div key={i} className={`mc-msg mc-msg--${m.role}`}>
                  <div className="mc-msg__role">
                    <span>{m.role}</span>
                    <span style={{ opacity: 0.7 }}>{fmtAgo(m.ts)}</span>
                  </div>
                  <div className="mc-msg__text">{m.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mc-detail-empty">No messages streamed yet.</div>
          )}
        </section>
      </div>
    </aside>
  );
}
