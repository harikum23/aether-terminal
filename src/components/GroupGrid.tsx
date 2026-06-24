import { type PaneNode, firstLeafId } from "../lib/panes";
import { type TabGroup, colorValue } from "../lib/tabGroups";
import * as termRegistry from "../lib/termRegistry";
import Icon from "./Icon";

interface GridTab {
  id: string;
  title: string;
  root: PaneNode;
}

interface GroupGridProps {
  group: TabGroup | null;
  tabs: GridTab[];
  onOpen: (tabId: string) => void;
  onClose: () => void;
}

/**
 * Overview grid for a tab group: one preview card per session showing the
 * title, the group color dot, a recent-output snippet pulled live from the
 * terminal registry, and a status. Clicking a card opens that session.
 *
 * This is NOT a tiled live terminal — cards are static snapshots, so it stays
 * cheap to render for large groups.
 */
export default function GroupGrid({
  group,
  tabs,
  onOpen,
  onClose,
}: GroupGridProps) {
  if (!group) return null;
  const dot = colorValue(group.color);

  return (
    <div
      className="group-grid"
      role="region"
      aria-label={`Overview of group ${group.name}`}
      style={{ ["--grp" as string]: dot } as React.CSSProperties}
    >
      <header className="group-grid__head">
        <span className="group-grid__dot" />
        <h2 className="group-grid__title">{group.name}</h2>
        <span className="group-grid__count">
          {tabs.length} {tabs.length === 1 ? "session" : "sessions"}
        </span>
        <button
          type="button"
          className="group-grid__close"
          onClick={onClose}
          title="Back to terminal"
          aria-label="Close grid view"
        >
          <Icon name="close" />
        </button>
      </header>

      {tabs.length === 0 ? (
        <p className="group-grid__empty">This group has no sessions.</p>
      ) : (
        <div className="group-grid__cards">
          {tabs.map((tab) => {
            const paneId = firstLeafId(tab.root);
            const snippet =
              termRegistry.get(paneId)?.getRecentText(6)?.trim() ?? "";
            const live = snippet.length > 0;
            return (
              <button
                key={tab.id}
                type="button"
                className="grid-card"
                onClick={() => onOpen(tab.id)}
                title={`Open ${tab.title}`}
              >
                <div className="grid-card__head">
                  <span className="grid-card__dot" />
                  <span className="grid-card__title">{tab.title}</span>
                  <span
                    className={
                      "grid-card__status" +
                      (live ? " grid-card__status--live" : "")
                    }
                  >
                    {live ? "active" : "idle"}
                  </span>
                </div>
                <pre className="grid-card__snippet">
                  {live ? snippet : "no output yet"}
                </pre>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
