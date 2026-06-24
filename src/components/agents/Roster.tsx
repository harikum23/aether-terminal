import type { AgentNode, AgentRun, AgentStoreState } from "../../lib/agentProtocol";
import { childrenOf } from "../../lib/agentStore";
import AgentCard from "./AgentCard";

interface RosterProps {
  run: AgentRun;
  store: AgentStoreState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface BranchProps {
  agent: AgentNode;
  store: AgentStoreState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function Branch({ agent, store, selectedId, onSelect }: BranchProps) {
  const children = childrenOf(store, agent.id);
  return (
    <div className="mc-branch">
      <AgentCard
        agent={agent}
        store={store}
        selected={selectedId === agent.id}
        onSelect={onSelect}
      />
      {children.length > 0 && (
        <div className="mc-branch__children">
          {children.map((child) => (
            <Branch
              key={child.id}
              agent={child}
              store={store}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Roster({ run, store, selectedId, onSelect }: RosterProps) {
  const roots = run.rootAgentIds
    .map((id) => store.agents[id])
    .filter((a): a is AgentNode => Boolean(a));

  return (
    <div className="mc-roster mc-scroll">
      <div className="mc-roster__head">
        <span className="mc-roster__title">Agent Roster</span>
        <span className="mc-roster__count num">{run.agentIds.length} agents</span>
      </div>
      <div className="mc-tree">
        {roots.map((root) => (
          <Branch
            key={root.id}
            agent={root}
            store={store}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
