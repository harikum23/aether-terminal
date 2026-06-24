import { useEffect, useMemo, useRef, useState } from "react";

import Icon from "./Icon";
import { groupStyle } from "../lib/paletteGroups";

export interface Command {
  id: string;
  title: string;
  hint?: string;
  group: string;
  /** optional color swatch (e.g. accent commands) shown instead of the group icon */
  swatch?: string;
  run: () => void;
}

interface PaletteProps {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}

export default function CommandPalette({
  open,
  commands,
  onClose,
}: PaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // focus after the element is painted
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      (c.title + " " + c.group).toLowerCase().includes(q),
    );
  }, [query, commands]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1));
  }, [filtered, cursor]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[cursor];
      if (cmd) {
        onClose();
        cmd.run();
      }
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette__search">
          <Icon name="search" className="palette__search-icon" />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Run a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <ul className="palette__list">
          {filtered.length === 0 && (
            <li className="palette__empty">No matching commands</li>
          )}
          {filtered.map((cmd, i) => {
            const gs = groupStyle(cmd.group);
            return (
              <li
                key={cmd.id}
                className={
                  "palette__item" + (i === cursor ? " palette__item--active" : "")
                }
                style={
                  {
                    "--pg-color": gs.color,
                    // cap the entrance stagger so long lists don't crawl in
                    animationDelay: `${Math.min(i, 12) * 18}ms`,
                  } as React.CSSProperties
                }
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  onClose();
                  cmd.run();
                }}
              >
                <span className="palette__icon" aria-hidden>
                  {cmd.swatch ? (
                    <span
                      className="palette__swatch"
                      style={{ background: cmd.swatch }}
                    />
                  ) : (
                    <Icon name={gs.icon} />
                  )}
                </span>
                <span className="palette__title">{cmd.title}</span>
                <span className="palette__group">{cmd.group}</span>
                {cmd.hint && <span className="palette__hint">{cmd.hint}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
