/* ============================================================
   Pane tree — the data model behind split panes.

   A tab owns a `PaneNode` tree. A `leaf` runs one PTY-backed
   terminal; a `split` lays its children out in a row (side by
   side) or column (stacked) with proportional `sizes`.

   All operations here are PURE — they return a new tree, never
   mutate — so React state updates stay predictable.
   ============================================================ */

export type SplitDir = "row" | "column";

export interface LeafNode {
  type: "leaf";
  id: string;
  title: string;
  /** typed into the shell once the PTY is ready (e.g. launch a tool) */
  initialCommand?: string;
}

export interface SplitNode {
  type: "split";
  id: string;
  dir: SplitDir;
  children: PaneNode[];
  /** one weight per child; they need not sum to 1 (flex-grow uses them raw) */
  sizes: number[];
}

export type PaneNode = LeafNode | SplitNode;

let seq = 0;
const uid = (prefix: string) =>
  `${prefix}-${(seq++).toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

export function makeLeaf(opts?: {
  title?: string;
  initialCommand?: string;
}): LeafNode {
  return {
    type: "leaf",
    id: uid("pane"),
    title: opts?.title ?? "zsh",
    initialCommand: opts?.initialCommand,
  };
}

/** Every leaf id under `node`, left-to-right / top-to-bottom. */
export function leafIds(node: PaneNode): string[] {
  if (node.type === "leaf") return [node.id];
  return node.children.flatMap(leafIds);
}

export function leafCount(node: PaneNode): number {
  return node.type === "leaf" ? 1 : node.children.reduce((n, c) => n + leafCount(c), 0);
}

export function firstLeafId(node: PaneNode): string {
  return node.type === "leaf" ? node.id : firstLeafId(node.children[0]);
}

export function findLeaf(node: PaneNode, id: string): LeafNode | null {
  if (node.type === "leaf") return node.id === id ? node : null;
  for (const c of node.children) {
    const hit = findLeaf(c, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Split the leaf `targetId` along `dir`, inserting `fresh` next to it.
 * If the target's parent already splits along `dir`, the new pane joins that
 * split as an even sibling (so repeated splits give clean N-way layouts, like
 * iTerm2). Otherwise the target is wrapped in a new 2-way split.
 */
export function splitLeaf(
  root: PaneNode,
  targetId: string,
  dir: SplitDir,
  fresh: LeafNode,
): PaneNode {
  // Wrap a bare leaf root.
  if (root.type === "leaf") {
    if (root.id !== targetId) return root;
    return { type: "split", id: uid("split"), dir, children: [root, fresh], sizes: [1, 1] };
  }

  // Does a direct child leaf match? If so, splice here.
  const idx = root.children.findIndex((c) => c.type === "leaf" && c.id === targetId);
  if (idx !== -1) {
    if (root.dir === dir) {
      // Join the existing split: insert after target, even weights.
      const children = [...root.children];
      children.splice(idx + 1, 0, fresh);
      return { ...root, children, sizes: children.map(() => 1) };
    }
    // Perpendicular: wrap the single target leaf in a nested split.
    const wrapped: SplitNode = {
      type: "split",
      id: uid("split"),
      dir,
      children: [root.children[idx], fresh],
      sizes: [1, 1],
    };
    const children = [...root.children];
    children[idx] = wrapped;
    return { ...root, children };
  }

  // Recurse into child splits.
  return {
    ...root,
    children: root.children.map((c) => (c.type === "leaf" ? c : splitLeaf(c, targetId, dir, fresh))),
  };
}

/**
 * Remove the leaf `targetId`. Splits left with a single child collapse into
 * that child. Returns the new tree, or `null` if nothing remains.
 */
export function closeLeaf(root: PaneNode, targetId: string): PaneNode | null {
  if (root.type === "leaf") return root.id === targetId ? null : root;

  const kept: PaneNode[] = [];
  const sizes: number[] = [];
  root.children.forEach((child, i) => {
    const next = closeLeaf(child, targetId);
    if (next !== null) {
      kept.push(next);
      sizes.push(root.sizes[i]);
    }
  });

  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]; // collapse degenerate split
  return { ...root, children: kept, sizes };
}

/** Replace the `sizes` of the split with id `splitId`. */
export function setSizes(root: PaneNode, splitId: string, sizes: number[]): PaneNode {
  if (root.type === "leaf") return root;
  if (root.id === splitId) return { ...root, sizes };
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) };
}

/* ---- spatial navigation (Cmd+Opt+Arrow) ----------------------- */

interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lay leaves out in normalized [0,1] space so we can reason about adjacency. */
function layout(node: PaneNode, x: number, y: number, w: number, h: number, out: Rect[]): void {
  if (node.type === "leaf") {
    out.push({ id: node.id, x, y, w, h });
    return;
  }
  const total = node.sizes.reduce((a, b) => a + b, 0) || node.children.length;
  let cursor = node.dir === "row" ? x : y;
  node.children.forEach((child, i) => {
    const frac = (node.sizes[i] ?? 1) / total;
    if (node.dir === "row") {
      const cw = w * frac;
      layout(child, cursor, y, cw, h, out);
      cursor += cw;
    } else {
      const ch = h * frac;
      layout(child, x, cursor, w, ch, out);
      cursor += ch;
    }
  });
}

export type Direction = "left" | "right" | "up" | "down";

/**
 * The leaf nearest to `fromId` in `dir`, or null if none lies that way.
 * Picks the candidate on the correct side whose perpendicular span overlaps
 * the source most, breaking ties by edge proximity.
 */
export function neighbor(root: PaneNode, fromId: string, dir: Direction): string | null {
  const rects: Rect[] = [];
  layout(root, 0, 0, 1, 1, rects);
  const src = rects.find((r) => r.id === fromId);
  if (!src) return null;

  const horizontal = dir === "left" || dir === "right";
  const wantPositive = dir === "right" || dir === "down";

  let best: Rect | null = null;
  let bestScore = -Infinity;
  const EPS = 1e-4;

  for (const r of rects) {
    if (r.id === fromId) continue;
    // Must be strictly on the requested side.
    if (horizontal) {
      const onSide = wantPositive ? r.x >= src.x + src.w - EPS : r.x + r.w <= src.x + EPS;
      if (!onSide) continue;
    } else {
      const onSide = wantPositive ? r.y >= src.y + src.h - EPS : r.y + r.h <= src.y + EPS;
      if (!onSide) continue;
    }
    // Overlap along the perpendicular axis.
    const overlap = horizontal
      ? Math.min(src.y + src.h, r.y + r.h) - Math.max(src.y, r.y)
      : Math.min(src.x + src.w, r.x + r.w) - Math.max(src.x, r.x);
    if (overlap <= 0) continue;
    // Distance to the shared edge (smaller = closer).
    const dist = horizontal
      ? wantPositive
        ? r.x - (src.x + src.w)
        : src.x - (r.x + r.w)
      : wantPositive
        ? r.y - (src.y + src.h)
        : src.y - (r.y + r.h);
    const score = overlap - dist; // prefer big overlap, small distance
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best?.id ?? null;
}
