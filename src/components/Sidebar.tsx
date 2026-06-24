import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  type TabGroup,
  GROUP_COLORS,
  buildRows,
  colorValue,
} from "../lib/tabGroups";
import type { Launcher } from "../lib/launchers";
import type { Project } from "../lib/projects";
import Icon from "./Icon";
import ProjectsSection from "./ProjectsSection";
import LauncherMenu from "./LauncherMenu";

export interface SidebarTab {
  id: string;
  title: string;
  groupId?: string | null;
}

interface SidebarProps {
  tabs: SidebarTab[];
  groups: TabGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onNewInGroup: (groupId: string) => void;
  onRenameTab: (id: string, name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onCycleGroupColor: (id: string) => void;
  onSetGroupColor: (id: string, colorId: string) => void;
  onToggleCollapse: (id: string) => void;
  onSetAllCollapsed: (collapsed: boolean) => void;
  onToggleGroupBroadcast: (id: string) => void;
  onNewGroupFromTab: (tabId: string) => void;
  onMoveToGroup: (tabId: string, groupId: string | null) => void;
  onUngroup: (groupId: string) => void;
  onCloseGroup: (groupId: string) => void;
  /** DnD: place `dragId` before `beforeId` (null = end) and set its group. */
  onMoveTab: (dragId: string, beforeId: string | null, groupId: string | null) => void;
  /** DnD: relocate a whole group block before `beforeId` (null = end). */
  onMoveGroup: (groupId: string, beforeId: string | null) => void;
  onOpenGrid: (groupId: string) => void;
  /** curated + saved "new session" launchers */
  launchers: Launcher[];
  onNewWithLauncher: (launcher: Launcher) => void;
  onAddLauncher: () => void;
  onDeleteLauncher: (id: string) => void;
  /** saved workspace snapshots */
  projects: Project[];
  onSaveProject: () => void;
  onRestoreProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
}

/** A right-click menu anchored to the cursor, for a tab or a group header. */
type Menu =
  | { kind: "tab"; id: string; x: number; y: number }
  | { kind: "group"; id: string; x: number; y: number }
  | null;

/** What a drag is currently carrying. */
type Drag =
  | { kind: "tab"; id: string }
  | { kind: "group"; id: string }
  | null;

/** Inline single-line editor: commit on Enter/blur, cancel on Escape. */
function InlineEdit({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="sb-edit"
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const v = (e.target as HTMLInputElement).value.trim();
          onCommit(v || value);
        } else if (e.key === "Escape") {
          onCancel();
        }
        e.stopPropagation();
      }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        onCommit(v || value);
      }}
    />
  );
}

export default function Sidebar({
  tabs,
  groups,
  activeId,
  onSelect,
  onClose,
  onNew,
  onNewInGroup,
  onRenameTab,
  onRenameGroup,
  onCycleGroupColor,
  onSetGroupColor,
  onToggleCollapse,
  onSetAllCollapsed,
  onToggleGroupBroadcast,
  onNewGroupFromTab,
  onMoveToGroup,
  onUngroup,
  onCloseGroup,
  onMoveTab,
  onMoveGroup,
  onOpenGrid,
  launchers,
  onNewWithLauncher,
  onAddLauncher,
  onDeleteLauncher,
  projects,
  onSaveProject,
  onRestoreProject,
  onRenameProject,
  onDeleteProject,
}: SidebarProps) {
  const [menu, setMenu] = useState<Menu>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [editing, setEditing] = useState<
    { kind: "tab" | "group"; id: string } | null
  >(null);
  const [drag, setDrag] = useState<Drag>(null);
  // current drop target highlight: a tab row (drop before it / into its group)
  // or a group's body (append to group).
  const [dropTab, setDropTab] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);

  // dismiss the context menu on any outside interaction
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const rows = buildRows(tabs, groups);
  const tabGroupOf = (id: string) =>
    tabs.find((t) => t.id === id)?.groupId ?? null;

  const clearDrop = () => {
    setDropTab(null);
    setDropGroup(null);
  };

  /** Drop the dragged tab/group before `beforeId`, into `groupId`. */
  const handleDropOnTab = (beforeId: string, groupId: string | null) => {
    if (!drag) return;
    if (drag.kind === "tab") {
      if (drag.id !== beforeId) onMoveTab(drag.id, beforeId, groupId);
    } else {
      onMoveGroup(drag.id, beforeId);
    }
    setDrag(null);
    clearDrop();
  };

  const renderTab = (tab: SidebarTab, index: number, inGroup: boolean) => {
    const isActive = tab.id === activeId;
    const editingThis = editing?.kind === "tab" && editing.id === tab.id;
    const isDropTarget = dropTab === tab.id;
    return (
      <div
        key={tab.id}
        className={
          "sb-tab" +
          (isActive ? " sb-tab--active" : "") +
          (inGroup ? " sb-tab--nested" : "") +
          (drag?.kind === "tab" && drag.id === tab.id ? " sb-tab--dragging" : "") +
          (isDropTarget ? " sb-tab--drop" : "")
        }
        role="tab"
        aria-selected={isActive}
        title={tab.title}
        draggable={!editingThis}
        onClick={() => onSelect(tab.id)}
        onDoubleClick={() => setEditing({ kind: "tab", id: tab.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: "tab", id: tab.id, x: e.clientX, y: e.clientY });
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tab.id);
          setDrag({ kind: "tab", id: tab.id });
        }}
        onDragEnd={() => {
          setDrag(null);
          clearDrop();
        }}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTab(tab.id);
          setDropGroup(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // dropping onto a tab adopts that tab's group membership
          handleDropOnTab(tab.id, inGroup ? (tab.groupId ?? null) : null);
        }}
      >
        <span className="sb-tab__dot" />
        {editingThis ? (
          <InlineEdit
            value={tab.title}
            onCommit={(v) => {
              onRenameTab(tab.id, v);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <span className="sb-tab__label">{tab.title}</span>
        )}
        {index < 9 && !editingThis && (
          <span className="sb-tab__index">⌘{index + 1}</span>
        )}
        <span
          className="sb-tab__close"
          role="button"
          aria-label="Close tab"
          title="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
        >
          <Icon name="close" />
        </span>
      </div>
    );
  };

  return (
    <aside className="sidebar" aria-label="Sessions">
      <ProjectsSection
        projects={projects}
        onSave={onSaveProject}
        onRestore={onRestoreProject}
        onRename={onRenameProject}
        onDelete={onDeleteProject}
      />

      <div className="sidebar__head">
        <span className="sidebar__title">Sessions</span>
        <div className="sidebar__new-split">
          <button
            className="sidebar__new"
            onClick={onNew}
            title="New session (⌘T)"
          >
            <Icon name="plus" /> New
          </button>
          <button
            className={
              "sidebar__new-caret" + (launcherOpen ? " sidebar__new-caret--on" : "")
            }
            aria-haspopup="menu"
            aria-expanded={launcherOpen}
            title="Choose a shell or launcher"
            onClick={() => setLauncherOpen((o) => !o)}
          >
            <Icon name="chevron" />
          </button>
          {launcherOpen && (
            <LauncherMenu
              launchers={launchers}
              onPick={onNewWithLauncher}
              onAdd={onAddLauncher}
              onDelete={onDeleteLauncher}
              onClose={() => setLauncherOpen(false)}
            />
          )}
        </div>
      </div>

      <div
        className="sidebar__list"
        role="tablist"
        // drop onto empty list space → move to end as a loose tab
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          setDropTab(null);
          setDropGroup(null);
        }}
        onDrop={(e) => {
          if (!drag) return;
          e.preventDefault();
          if (drag.kind === "tab") onMoveTab(drag.id, null, null);
          else onMoveGroup(drag.id, null);
          setDrag(null);
          clearDrop();
        }}
      >
        {rows.map((row) => {
          if (row.kind === "tab") {
            return renderTab(row.tab, row.index, false);
          }
          const g = row.group;
          const hasActive = row.tabs.some((m) => m.tab.id === activeId);
          const editingGroup = editing?.kind === "group" && editing.id === g.id;
          return (
            <div
              key={g.id}
              className={
                "sb-group" +
                (drag?.kind === "group" && drag.id === g.id
                  ? " sb-group--dragging"
                  : "") +
                (dropGroup === g.id ? " sb-group--drop" : "")
              }
              style={
                { ["--grp" as string]: colorValue(g.color) } as React.CSSProperties
              }
            >
              <div
                className={
                  "sb-group__head" + (hasActive ? " sb-group__head--active" : "")
                }
                draggable={!editingGroup}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: "group", id: g.id, x: e.clientX, y: e.clientY });
                }}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", g.id);
                  setDrag({ kind: "group", id: g.id });
                }}
                onDragEnd={() => {
                  setDrag(null);
                  clearDrop();
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  // hovering a group header: a dragged tab joins this group,
                  // a dragged group reorders before this one.
                  setDropGroup(g.id);
                  setDropTab(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!drag) return;
                  if (drag.kind === "tab") {
                    onMoveTab(drag.id, row.tabs[0]?.tab.id ?? null, g.id);
                  } else if (drag.id !== g.id) {
                    onMoveGroup(drag.id, row.tabs[0]?.tab.id ?? null);
                  }
                  setDrag(null);
                  clearDrop();
                }}
              >
                <button
                  className={
                    "sb-group__caret" +
                    (g.collapsed ? "" : " sb-group__caret--open")
                  }
                  title={g.collapsed ? "Expand group" : "Collapse group"}
                  aria-expanded={!g.collapsed}
                  onClick={() => onToggleCollapse(g.id)}
                >
                  <Icon name="chevron" />
                </button>
                <button
                  className="sb-group__swatch"
                  title="Change color"
                  onClick={() => onCycleGroupColor(g.id)}
                />
                {editingGroup ? (
                  <InlineEdit
                    value={g.name}
                    onCommit={(v) => {
                      onRenameGroup(g.id, v);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <span
                    className="sb-group__name"
                    onDoubleClick={() => setEditing({ kind: "group", id: g.id })}
                  >
                    {g.name}
                  </span>
                )}
                {g.broadcasting && (
                  <span className="sb-group__cast" title="Broadcasting to group">
                    <Icon name="broadcast" />
                  </span>
                )}
                <span className="sb-group__count">{row.tabs.length}</span>
                <button
                  className="sb-group__grid"
                  title="View group as grid"
                  aria-label="View group as grid"
                  onClick={() => onOpenGrid(g.id)}
                >
                  <Icon name="grid" />
                </button>
                <button
                  className="sb-group__add"
                  title="New session in group"
                  onClick={() => onNewInGroup(g.id)}
                >
                  <Icon name="plus" />
                </button>
              </div>
              {!g.collapsed && (
                <div
                  className="sb-group__body"
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    setDropGroup(g.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!drag) return;
                    if (drag.kind === "tab") {
                      // append to end of this group
                      onMoveTab(drag.id, null, g.id);
                    } else if (drag.id !== g.id) {
                      onMoveGroup(drag.id, null);
                    }
                    setDrag(null);
                    clearDrop();
                  }}
                >
                  {row.tabs.map((m) => renderTab(m.tab, m.index, true))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          groups={groups}
          group={menu.kind === "group" ? groups.find((g) => g.id === menu.id) ?? null : null}
          tabGroupId={menu.kind === "tab" ? tabGroupOf(menu.id) : null}
          onRename={() => {
            setEditing({ kind: menu.kind, id: menu.id });
            setMenu(null);
          }}
          onNewGroup={() => {
            onNewGroupFromTab(menu.id);
            setMenu(null);
          }}
          onNewInGroup={(gid) => {
            onNewInGroup(gid);
            setMenu(null);
          }}
          onMoveToGroup={(gid) => {
            onMoveToGroup(menu.id, gid);
            setMenu(null);
          }}
          onUngroupTab={() => {
            onMoveToGroup(menu.id, null);
            setMenu(null);
          }}
          onUngroup={() => {
            onUngroup(menu.id);
            setMenu(null);
          }}
          onSetColor={(colorId) => {
            onSetGroupColor(menu.id, colorId);
            setMenu(null);
          }}
          onToggleBroadcast={() => {
            onToggleGroupBroadcast(menu.id);
            setMenu(null);
          }}
          onCollapseAll={() => {
            onSetAllCollapsed(true);
            setMenu(null);
          }}
          onExpandAll={() => {
            onSetAllCollapsed(false);
            setMenu(null);
          }}
          onCloseGroup={() => {
            onCloseGroup(menu.id);
            setMenu(null);
          }}
          onCloseTab={() => {
            onClose(menu.id);
            setMenu(null);
          }}
        />
      )}
    </aside>
  );
}

/** The popover itself — actions differ for a tab vs a group header.
 *  Rendered through a portal to <body> so it escapes the sidebar's
 *  backdrop-filter containing block and floats over the whole window. */
function ContextMenu({
  menu,
  groups,
  group,
  tabGroupId,
  onRename,
  onNewGroup,
  onNewInGroup,
  onMoveToGroup,
  onUngroupTab,
  onUngroup,
  onSetColor,
  onToggleBroadcast,
  onCollapseAll,
  onExpandAll,
  onCloseGroup,
  onCloseTab,
}: {
  menu: NonNullable<Menu>;
  groups: TabGroup[];
  group: TabGroup | null;
  tabGroupId: string | null;
  onRename: () => void;
  onNewGroup: () => void;
  onNewInGroup: (groupId: string) => void;
  onMoveToGroup: (groupId: string) => void;
  onUngroupTab: () => void;
  onUngroup: () => void;
  onSetColor: (colorId: string) => void;
  onToggleBroadcast: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onCloseGroup: () => void;
  onCloseTab: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // measure the rendered menu and clamp/flip so it never overflows the window
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: menu.x,
    top: menu.y,
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    let left = menu.x;
    let top = menu.y;
    if (left + width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - width - pad);
    }
    if (top + height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - height - pad);
    }
    setPos({ left, top });
  }, [menu.x, menu.y, menu.kind, menu.id]);

  return createPortal(
    <div
      ref={ref}
      className="sb-menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {menu.kind === "tab" ? (
        <>
          <button className="sb-menu__item" onClick={onRename}>
            Rename…
          </button>
          <div className="sb-menu__sep" />
          <button className="sb-menu__item" onClick={onNewGroup}>
            Add to new group
          </button>
          {tabGroupId && (
            <button
              className="sb-menu__item"
              onClick={() => onNewInGroup(tabGroupId)}
            >
              New session in group
            </button>
          )}
          {groups
            .filter((g) => g.id !== tabGroupId)
            .map((g) => (
              <button
                key={g.id}
                className="sb-menu__item"
                onClick={() => onMoveToGroup(g.id)}
              >
                <span
                  className="sb-menu__swatch"
                  style={{ background: colorValue(g.color) }}
                />
                Move to “{g.name}”
              </button>
            ))}
          {tabGroupId && (
            <button className="sb-menu__item" onClick={onUngroupTab}>
              Remove from group
            </button>
          )}
          <div className="sb-menu__sep" />
          <button className="sb-menu__item sb-menu__item--danger" onClick={onCloseTab}>
            Close tab
          </button>
        </>
      ) : (
        <>
          <button className="sb-menu__item" onClick={onRename}>
            Rename group…
          </button>
          <button
            className="sb-menu__item"
            onClick={() => onNewInGroup(menu.id)}
          >
            New session in group
          </button>
          <div className="sb-menu__colors" role="group" aria-label="Group color">
            {GROUP_COLORS.map((c) => (
              <button
                key={c.id}
                className={
                  "sb-menu__color" +
                  (group?.color === c.id ? " sb-menu__color--on" : "")
                }
                style={{ background: c.value }}
                title={c.name}
                aria-label={c.name}
                aria-pressed={group?.color === c.id}
                onClick={() => onSetColor(c.id)}
              />
            ))}
          </div>
          <div className="sb-menu__sep" />
          <button className="sb-menu__item" onClick={onToggleBroadcast}>
            {group?.broadcasting
              ? "Stop broadcasting to group"
              : "Broadcast input to group"}
          </button>
          <button className="sb-menu__item" onClick={onUngroup}>
            Ungroup tabs
          </button>
          <div className="sb-menu__sep" />
          <button className="sb-menu__item" onClick={onCollapseAll}>
            Collapse all groups
          </button>
          <button className="sb-menu__item" onClick={onExpandAll}>
            Expand all groups
          </button>
          <div className="sb-menu__sep" />
          <button
            className="sb-menu__item sb-menu__item--danger"
            onClick={onCloseGroup}
          >
            Close group &amp; tabs
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
