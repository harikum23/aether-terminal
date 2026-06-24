import { useEffect, useRef } from "react";

import type { Launcher } from "../lib/launchers";
import Icon from "./Icon";

interface LauncherMenuProps {
  launchers: Launcher[];
  onPick: (launcher: Launcher) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/**
 * Dropdown of "new session" profiles: curated shells/REPLs (PowerShell 7,
 * bash, Python…) plus the user's saved launchers. Opens from the sidebar's
 * New split-button. Dismisses on outside click or Escape.
 */
export default function LauncherMenu({
  launchers,
  onPick,
  onAdd,
  onDelete,
  onClose,
}: LauncherMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // defer so the opening click doesn't immediately close it
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="sb-launchers" ref={ref} role="menu">
      {launchers.map((l) => (
        <button
          key={l.id}
          className="sb-launcher"
          role="menuitem"
          onClick={() => {
            onPick(l);
            onClose();
          }}
        >
          <span className="sb-launcher__icon">
            <Icon name={l.icon} />
          </span>
          <span className="sb-launcher__body">
            <span className="sb-launcher__name">{l.name}</span>
            {l.hint && <span className="sb-launcher__hint">{l.hint}</span>}
            {!l.hint && l.command && (
              <span className="sb-launcher__hint">{l.command}</span>
            )}
          </span>
          {!l.builtin && (
            <span
              className="sb-launcher__del"
              role="button"
              aria-label="Delete launcher"
              title="Delete launcher"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(l.id);
              }}
            >
              <Icon name="close" />
            </span>
          )}
        </button>
      ))}
      <div className="sb-launchers__sep" />
      <button
        className="sb-launcher sb-launcher--add"
        role="menuitem"
        onClick={() => {
          onAdd();
          onClose();
        }}
      >
        <span className="sb-launcher__icon">
          <Icon name="plus" />
        </span>
        <span className="sb-launcher__body">
          <span className="sb-launcher__name">New launcher…</span>
          <span className="sb-launcher__hint">save a custom command</span>
        </span>
      </button>
    </div>
  );
}
