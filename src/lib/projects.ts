/* ============================================================
   Projects — named snapshots of the whole workspace so you can
   pick up where you left off. A project captures every session
   (its pane tree, title and group membership), the groups, and
   each pane's last working directory. Restoring rebuilds the
   layout with fresh ids and cd's each pane back into place.

   Live shell process state can't be restored — this recreates
   the structure and re-runs each pane's launch command.
   ============================================================ */

import {
  type PaneNode,
  type SavedPaneNode,
  serializePane,
  restorePane,
} from "./panes";
import { type TabGroup, makeGroup } from "./tabGroups";

/** The shape of a live tab the snapshot needs (a subset of App's Tab). */
export interface ProjectTabInput {
  title: string;
  root: PaneNode;
  groupId?: string | null;
}

interface SavedTab {
  title: string;
  root: SavedPaneNode;
  /** index into the project's `groups`, or null when the tab is loose */
  group: number | null;
}

interface SavedGroup {
  name: string;
  color: string;
  collapsed: boolean;
  broadcasting?: boolean;
}

export interface Project {
  id: string;
  name: string;
  savedAt: number;
  tabs: SavedTab[];
  groups: SavedGroup[];
}

/** A freshly rebuilt tab, ready to merge into App state. */
export interface RestoredTab {
  id: string;
  title: string;
  root: PaneNode;
  groupId: string | null;
}

let seq = 0;
function makeProjectId(): string {
  seq += 1;
  return `proj-${seq.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Snapshot the current workspace into a Project. Only groups that still have
 * member tabs are kept, and each is given a stable index the tabs reference.
 */
export function buildProject(
  name: string,
  tabs: ProjectTabInput[],
  groups: TabGroup[],
  cwdById: Map<string, string>,
): Project {
  const used = groups.filter((g) => tabs.some((t) => t.groupId === g.id));
  const indexOf = new Map(used.map((g, i) => [g.id, i]));
  return {
    id: makeProjectId(),
    name: name.trim() || "Untitled project",
    savedAt: Date.now(),
    groups: used.map((g) => ({
      name: g.name,
      color: g.color,
      collapsed: g.collapsed,
      broadcasting: g.broadcasting,
    })),
    tabs: tabs.map((t) => ({
      title: t.title,
      root: serializePane(t.root, cwdById),
      group:
        t.groupId != null && indexOf.has(t.groupId)
          ? indexOf.get(t.groupId)!
          : null,
    })),
  };
}

/** Rebuild a project's tabs + groups with fresh ids, remapping membership. */
export function restoreProject(project: Project): {
  tabs: RestoredTab[];
  groups: TabGroup[];
} {
  const groups = project.groups.map((g) => {
    const ng = makeGroup(g.name, g.color);
    ng.collapsed = g.collapsed;
    ng.broadcasting = g.broadcasting ?? false;
    return ng;
  });
  const tabs = project.tabs.map((t) => ({
    id: crypto.randomUUID(),
    title: t.title,
    root: restorePane(t.root),
    groupId: t.group != null && groups[t.group] ? groups[t.group].id : null,
  }));
  return { tabs, groups };
}

/* ---- persistence -------------------------------------------- */

const KEY = "aether.projects.v1";

function isProject(p: unknown): p is Project {
  return (
    !!p &&
    typeof p === "object" &&
    typeof (p as Project).id === "string" &&
    typeof (p as Project).name === "string" &&
    Array.isArray((p as Project).tabs) &&
    Array.isArray((p as Project).groups)
  );
}

/** Read saved projects from localStorage, newest first. */
export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(isProject);
  } catch {
    return [];
  }
}

/** Persist the projects list; ignore storage errors (e.g. private mode). */
export function saveProjects(list: Project[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — projects just won't persist */
  }
}
