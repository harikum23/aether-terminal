import type { IconName } from "../components/Icon";

/**
 * Maps a command-palette `group` to a hue token + an icon, so rows are
 * scannable like VS Code / Claude Code menus. Colors are CSS custom-property
 * references (defined in styles.css) so they theme cleanly — never raw hex
 * baked into the component. Tasteful, restrained: one hue per category.
 */
export interface GroupStyle {
  /** CSS color (a var() reference) for the group chip + icon */
  color: string;
  icon: IconName;
}

const FALLBACK: GroupStyle = { color: "var(--text-dim)", icon: "chevron" };

const MAP: Record<string, GroupStyle> = {
  View: { color: "var(--pg-view)", icon: "view" },
  Pane: { color: "var(--pg-pane)", icon: "grid" },
  Tab: { color: "var(--pg-tab)", icon: "tab" },
  Theme: { color: "var(--pg-theme)", icon: "theme" },
  Accent: { color: "var(--pg-accent)", icon: "palette" },
  Agents: { color: "var(--pg-agents)", icon: "agents" },
  AI: { color: "var(--pg-ai)", icon: "ai" },
  Launch: { color: "var(--pg-tab)", icon: "terminal" },
  Project: { color: "var(--pg-view)", icon: "folder" },
};

export function groupStyle(group: string): GroupStyle {
  return MAP[group] ?? FALLBACK;
}
