import { Fragment, useRef } from "react";

import Terminal from "./Terminal";
import type { AetherTheme } from "../lib/theme";
import type { TypeSettings } from "../lib/typography";
import type { PaneNode, SplitDir } from "../lib/panes";

interface PaneTreeProps {
  node: PaneNode;
  theme: AetherTheme;
  type: TypeSettings;
  /** the focused leaf in the *active* tab, or null when this tab is inactive */
  activePaneId: string | null;
  /** other leaf ids in this tab — keystrokes fan out to them when broadcasting */
  broadcastIds: string[];
  ownsShortcut: (e: KeyboardEvent) => boolean;
  onFocusPane: (id: string) => void;
  onExitPane: (id: string) => void;
  onResize: (splitId: string, sizes: number[]) => void;
}

/** A drag handle that re-weights the two panes it sits between. */
function Divider({
  dir,
  containerRef,
  sizes,
  index,
  onResize,
}: {
  dir: SplitDir;
  containerRef: React.RefObject<HTMLDivElement | null>;
  sizes: number[];
  index: number;
  onResize: (sizes: number[]) => void;
}) {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const horizontal = dir === "row";
    const extent = horizontal ? container.clientWidth : container.clientHeight;
    const total = sizes.reduce((a, b) => a + b, 0);
    const a0 = sizes[index - 1];
    const b0 = sizes[index];
    const pair = a0 + b0;
    const start = horizontal ? e.clientX : e.clientY;

    const move = (ev: PointerEvent) => {
      const now = horizontal ? ev.clientX : ev.clientY;
      // Fraction of the whole container the pointer has travelled…
      const deltaFrac = ((now - start) / Math.max(1, extent)) * total;
      const MIN = 0.08 * pair; // keep both panes usable
      let a = a0 + deltaFrac;
      a = Math.max(MIN, Math.min(pair - MIN, a));
      const next = [...sizes];
      next[index - 1] = a;
      next[index] = pair - a;
      onResize(next);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      (e.target as HTMLElement).releasePointerCapture?.(ev.pointerId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={"pane-divider pane-divider--" + dir}
      role="separator"
      aria-orientation={dir === "row" ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
    >
      <span className="pane-divider__grip" />
    </div>
  );
}

export default function PaneTree(props: PaneTreeProps) {
  const { node, activePaneId, broadcastIds, onResize } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === "leaf") {
    const focused = node.id === activePaneId;
    return (
      <div
        className={"pane" + (focused ? " pane--focused" : "")}
        onMouseDownCapture={() => props.onFocusPane(node.id)}
      >
        <Terminal
          id={node.id}
          theme={props.theme}
          type={props.type}
          active={focused}
          initialCommand={node.initialCommand}
          ownsShortcut={props.ownsShortcut}
          broadcastIds={broadcastIds.filter((b) => b !== node.id)}
          onFocusPane={() => props.onFocusPane(node.id)}
          onExit={() => props.onExitPane(node.id)}
        />
        {focused && <span className="pane__focus-ring" aria-hidden />}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={"pane-split pane-split--" + node.dir}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <Divider
              dir={node.dir}
              containerRef={containerRef}
              sizes={node.sizes}
              index={i}
              onResize={(sizes) => onResize(node.id, sizes)}
            />
          )}
          <div className="pane-slot" style={{ flexGrow: node.sizes[i] ?? 1 }}>
            <PaneTree {...props} node={child} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
