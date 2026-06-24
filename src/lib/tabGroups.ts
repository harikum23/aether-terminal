/* ============================================================
   Tab groups — the data model behind the sidebar's Chrome-like
   tab grouping. A group has a name, a color and a collapsed
   flag; tabs reference a group by id via their `groupId`.

   Helpers here are PURE — they take state and return new state,
   so React updates stay predictable.
   ============================================================ */

export interface TabGroup {
  id: string;
  name: string;
  /** one of GROUP_COLORS' ids */
  color: string;
  collapsed: boolean;
  /** when true, typed input in a member session mirrors to every member */
  broadcasting?: boolean;
}

/** Anything the sidebar can lay out: we only need id + group membership. */
export interface GroupableTab {
  id: string;
  groupId?: string | null;
}

/** Chrome-style group palette. `value` feeds the CSS color tokens. */
export const GROUP_COLORS: { id: string; name: string; value: string }[] = [
  { id: "grey", name: "Grey", value: "#9aa0a6" },
  { id: "blue", name: "Blue", value: "#5b9dff" },
  { id: "cyan", name: "Cyan", value: "#36c5d6" },
  { id: "green", name: "Green", value: "#4ec98a" },
  { id: "yellow", name: "Yellow", value: "#f5c451" },
  { id: "orange", name: "Orange", value: "#f59e4b" },
  { id: "red", name: "Red", value: "#fa6d6d" },
  { id: "pink", name: "Pink", value: "#ff7bbf" },
  { id: "purple", name: "Purple", value: "#b48bff" },
];

const DEFAULT_COLOR = GROUP_COLORS[1].id; // blue

export function colorValue(colorId: string): string {
  return (GROUP_COLORS.find((c) => c.id === colorId) ?? GROUP_COLORS[0]).value;
}

/** Next color in the palette — used by the one-click color cycle. */
export function nextColor(colorId: string): string {
  const i = GROUP_COLORS.findIndex((c) => c.id === colorId);
  return GROUP_COLORS[(i + 1) % GROUP_COLORS.length].id;
}

let groupSeq = 0;
export function makeGroup(name?: string, color?: string): TabGroup {
  groupSeq += 1;
  return {
    id: `grp-${groupSeq.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    name: name ?? `Group ${groupSeq}`,
    color: color ?? DEFAULT_COLOR,
    collapsed: false,
    broadcasting: false,
  };
}

/* ---- sidebar layout rows ------------------------------------ */

export type SidebarRow<T extends GroupableTab> =
  | { kind: "tab"; tab: T; index: number }
  | { kind: "group"; group: TabGroup; tabs: { tab: T; index: number }[] };

/**
 * Walk `tabs` in order and produce the rows the sidebar renders.
 * A group is emitted at the position of its FIRST member and gathers
 * every member (in tab order), so grouping never requires the tabs to
 * be physically contiguous in the array. `index` is the tab's global
 * position — the sidebar uses it for the ⌘1–9 hint.
 */
export function buildRows<T extends GroupableTab>(
  tabs: T[],
  groups: TabGroup[],
): SidebarRow<T>[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const emitted = new Set<string>();
  const rows: SidebarRow<T>[] = [];

  tabs.forEach((tab, index) => {
    const gid = tab.groupId;
    const group = gid ? byId.get(gid) : undefined;
    if (!group) {
      rows.push({ kind: "tab", tab, index });
      return;
    }
    if (emitted.has(group.id)) return;
    emitted.add(group.id);
    const members = tabs
      .map((t, i) => ({ tab: t, index: i }))
      .filter((m) => m.tab.groupId === group.id);
    rows.push({ kind: "group", group, tabs: members });
  });

  return rows;
}

/* ---- drag & drop reordering --------------------------------- */

/**
 * Move tab `dragId` so it lands just before `beforeId` (or at the end when
 * `beforeId` is null), and set its group membership to `groupId`.
 *
 * Because `buildRows` derives the sidebar purely from tab order + groupId,
 * every DnD case reduces to this one primitive: reordering within a group,
 * moving between groups, and dragging in/out of a group are all "remove the
 * tab, set its groupId, reinsert it at the target slot". Returns a new array.
 */
export function moveTab<T extends GroupableTab>(
  tabs: T[],
  dragId: string,
  beforeId: string | null,
  groupId: string | null,
): T[] {
  const dragged = tabs.find((t) => t.id === dragId);
  if (!dragged) return tabs;
  const rest = tabs.filter((t) => t.id !== dragId);
  const moved = { ...dragged, groupId } as T;
  const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  if (at === -1) rest.push(moved);
  else rest.splice(at, 0, moved);
  return rest;
}

/**
 * Reorder a whole group (all its member tabs, in order) so the block lands
 * just before tab `beforeId` (or at the end when null). Loose tabs and other
 * groups keep their relative order. Returns a new array.
 */
export function moveGroupBlock<T extends GroupableTab>(
  tabs: T[],
  groupId: string,
  beforeId: string | null,
): T[] {
  const block = tabs.filter((t) => t.groupId === groupId);
  if (block.length === 0) return tabs;
  const rest = tabs.filter((t) => t.groupId !== groupId);
  const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  if (at === -1) rest.push(...block);
  else rest.splice(at, 0, ...block);
  return rest;
}

/** Drop any group that no longer has member tabs. */
export function pruneGroups(
  tabs: GroupableTab[],
  groups: TabGroup[],
): TabGroup[] {
  const used = new Set(
    tabs.map((t) => t.groupId).filter((id): id is string => !!id),
  );
  const next = groups.filter((g) => used.has(g.id));
  return next.length === groups.length ? groups : next;
}
