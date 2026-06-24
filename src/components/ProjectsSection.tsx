import { useEffect, useRef, useState } from "react";

import type { Project } from "../lib/projects";
import Icon from "./Icon";

interface ProjectsSectionProps {
  projects: Project[];
  /** open the "save current workspace" flow */
  onSave: () => void;
  /** reopen a project's sessions (appended to the current workspace) */
  onRestore: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/** "3m ago" / "2h ago" / "Apr 7" — compact recency for a saved snapshot. */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function paneCount(p: Project): number {
  const count = (node: { type: string; children?: unknown[] }): number =>
    node.type === "leaf"
      ? 1
      : ((node.children ?? []) as { type: string; children?: unknown[] }[]).reduce(
          (n, c) => n + count(c),
          0,
        );
  return p.tabs.reduce((n, t) => n + count(t.root), 0);
}

/** First saved working directory in the project's pane trees, if any. */
function firstCwd(p: Project): string | null {
  const walk = (node: {
    type: string;
    cwd?: string;
    children?: unknown[];
  }): string | null => {
    if (node.type === "leaf") return node.cwd ?? null;
    for (const c of (node.children ?? []) as Parameters<typeof walk>[0][]) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  for (const t of p.tabs) {
    const hit = walk(t.root as Parameters<typeof walk>[0]);
    if (hit) return hit;
  }
  return null;
}

/** Abbreviate an absolute path for the narrow rail: `~/code/aether`. */
function prettyPath(path: string): string {
  // strip a leading /Users/<name> or /home/<name> down to `~`
  const home = path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
  return home.replace(/\/$/, "") || "/";
}

export default function ProjectsSection({
  projects,
  onSave,
  onRestore,
  onRename,
  onDelete,
}: ProjectsSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [editing]);

  return (
    <div className="sb-projects">
      <div className="sb-projects__head">
        <button
          className={
            "sb-projects__caret" + (collapsed ? "" : " sb-projects__caret--open")
          }
          aria-expanded={!collapsed}
          title={collapsed ? "Expand projects" : "Collapse projects"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <Icon name="chevron" />
        </button>
        <span className="sb-projects__title">Projects</span>
        {projects.length > 0 && (
          <span className="sb-projects__count">{projects.length}</span>
        )}
        <button
          className="sb-projects__save"
          title="Save current workspace as a project"
          onClick={onSave}
        >
          <Icon name="save" /> Save
        </button>
      </div>

      {!collapsed &&
        (projects.length === 0 ? (
          <p className="sb-projects__empty">
            Save your open sessions to pick up where you left off.
          </p>
        ) : (
          <div className="sb-projects__list">
            {projects.map((p) => {
              const cwd = firstCwd(p);
              const path = cwd ? prettyPath(cwd) : null;
              const panes = paneCount(p);
              return (
                <div
                  key={p.id}
                  className="sb-project"
                  title={
                    cwd
                      ? `Reopen “${p.name}” — ${cwd} (${p.tabs.length} sessions)`
                      : `Reopen “${p.name}” (${p.tabs.length} sessions)`
                  }
                  role="button"
                  onClick={() => editing !== p.id && onRestore(p.id)}
                >
                  <span className="sb-project__icon">
                    <Icon name="folder" />
                  </span>
                  <div className="sb-project__body">
                    {editing === p.id ? (
                      <input
                        ref={editRef}
                        className="sb-edit"
                        defaultValue={p.name}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            const v = (e.target as HTMLInputElement).value.trim();
                            onRename(p.id, v || p.name);
                            setEditing(null);
                          } else if (e.key === "Escape") {
                            setEditing(null);
                          }
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          onRename(p.id, v || p.name);
                          setEditing(null);
                        }}
                      />
                    ) : (
                      <span
                        className="sb-project__name"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditing(p.id);
                        }}
                      >
                        {p.name}
                      </span>
                    )}
                    <span className="sb-project__sub">
                      {path ? (
                        <span className="sb-project__path" title={cwd ?? undefined}>
                          {path}
                        </span>
                      ) : (
                        <span className="sb-project__meta-item">
                          <Icon name="layers" /> {panes} {panes === 1 ? "pane" : "panes"}
                        </span>
                      )}
                      <span className="sb-project__meta-item">
                        <Icon name="clock" /> {ago(p.savedAt)}
                      </span>
                    </span>
                  </div>
                  <span
                    className="sb-project__del"
                    role="button"
                    aria-label="Delete project"
                    title="Delete project"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(p.id);
                    }}
                  >
                    <Icon name="close" />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
