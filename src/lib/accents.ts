/**
 * Selectable accent overrides.
 *
 * An accent overrides the active theme's `--accent` / `--accent-2` without
 * touching the rest of the palette. `accent2` is the same hue rotated toward a
 * complementary tone so the dual-accent chrome (gradients, glows) stays
 * coherent on any theme. Default is GitHub blue to match the house look.
 */
export interface Accent {
  id: string;
  name: string;
  /** primary accent (hex) — overrides --accent */
  accent: string;
  /** secondary accent (hex) — overrides --accent-2 */
  accent2: string;
}

export const ACCENTS: Accent[] = [
  { id: "github-blue", name: "GitHub Blue", accent: "#2f81f7", accent2: "#3fb950" },
  { id: "green", name: "Green", accent: "#3fb950", accent2: "#2f81f7" },
  { id: "coral", name: "Coral", accent: "#ff7b72", accent2: "#ffa657" },
  { id: "violet", name: "Violet", accent: "#bc8cff", accent2: "#79c0ff" },
  { id: "amber", name: "Amber", accent: "#e3b341", accent2: "#ff7b72" },
  { id: "cyan", name: "Cyan", accent: "#39c5cf", accent2: "#2f81f7" },
];

/** The default accent id — matches the GitHub/Copilot house look. */
export const DEFAULT_ACCENT_ID = "github-blue";

export function accentById(id: string | undefined): Accent | undefined {
  if (!id) return undefined;
  return ACCENTS.find((a) => a.id === id);
}

/** Build the soft glow color (matches theme.glow shape) for an accent. */
export function accentGlow(a: Accent): string {
  const h = a.accent.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},0.16)`;
}
