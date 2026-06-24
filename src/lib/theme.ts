import type { ITheme } from "@xterm/xterm";

/** Chrome (window UI) colors that pair with a palette. */
export interface ThemeUI {
  /** primary UI text */
  text: string;
  /** muted UI text (labels, hints) */
  textDim: string;
}

/** A complete Aether look: chrome accents + a matching xterm palette. */
export interface AetherTheme {
  id: string;
  name: string;
  /** drives whether the window chrome renders light or dark */
  appearance: "dark" | "light";
  /** primary accent (hex) */
  accent: string;
  /** secondary accent (hex) */
  accent2: string;
  /** base window background (CSS color) */
  bg: string;
  /** soft glow color used behind the chrome */
  glow: string;
  /** chrome text colors */
  ui: ThemeUI;
  xterm: ITheme;
}

const TRANSPARENT = "rgba(0,0,0,0)";

/* ---- small color helpers (used to derive the glass chrome surface) ---- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): [number, number, number] {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const l = (x: number, y: number) => Math.round(x + (y - x) * t);
  return [l(r1, r2), l(g1, g2), l(b1, b2)];
}

const rgba = ([r, g, b]: [number, number, number], a: number) =>
  `rgba(${r}, ${g}, ${b}, ${a})`;

/** The translucent glass color for tab bar / status bar / panels.
 *  Tuned for a refined, cohesive read: a touch of the accent is mixed into the
 *  dark glass so chrome feels of-a-piece with the palette rather than neutral gray. */
export function chromeSurface(t: AetherTheme): string {
  if (t.appearance === "light") {
    return rgba(mix(t.bg, "#ffffff", 0.55), 0.66);
  }
  // dark: lift the base bg slightly, then nudge toward the accent for a cohesive tint
  const lifted = rgbToHex(mix(t.bg, "#ffffff", 0.08));
  const tinted = mix(lifted, t.accent, 0.06);
  return rgba(tinted, 0.5);
}

/** The hairline border color for chrome edges — crisp, low-contrast. */
export function chromeLine(t: AetherTheme): string {
  return t.appearance === "light"
    ? "rgba(15, 23, 42, 0.09)"
    : "rgba(255, 255, 255, 0.08)";
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/* =====================================================================
   Theme library — faithful, widely-used palettes.
   Dark themes first, then light. xterm `background` stays transparent so
   the app's gradient + native vibrancy show through.
   ===================================================================== */

export const THEMES: AetherTheme[] = [
  // ---- House themes (GitHub / Copilot CLI aesthetic) ----------------
  // One confident accent: GitHub blue, green secondary. Restrained glow.
  {
    id: "aether-dark",
    name: "Aether Dark",
    appearance: "dark",
    accent: "#2f81f7",
    accent2: "#3fb950",
    bg: "#0d1117",
    glow: "rgba(47,129,247,0.16)",
    ui: { text: "#e6edf3", textDim: "#7d8590" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#e6edf3",
      cursor: "#2f81f7",
      cursorAccent: "#0d1117",
      selectionBackground: "rgba(47,129,247,0.30)",
      black: "#484f58",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#2f81f7",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd",
      brightWhite: "#f0f6fc",
    },
  },
  {
    id: "aether-black",
    name: "Aether Black",
    appearance: "dark",
    accent: "#2f81f7",
    accent2: "#3fb950",
    bg: "#000000",
    glow: "rgba(47,129,247,0.18)",
    ui: { text: "#e6edf3", textDim: "#7d8590" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#e6edf3",
      cursor: "#2f81f7",
      cursorAccent: "#000000",
      selectionBackground: "rgba(47,129,247,0.32)",
      black: "#0a0a0a",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#2f81f7",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "aether-light",
    name: "Aether Light",
    appearance: "light",
    accent: "#0969da",
    accent2: "#1a7f37",
    bg: "#ffffff",
    glow: "rgba(9,105,218,0.12)",
    ui: { text: "#1f2328", textDim: "#636c76" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#1f2328",
      cursor: "#0969da",
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(9,105,218,0.16)",
      black: "#24292f",
      red: "#cf222e",
      green: "#1a7f37",
      yellow: "#9a6700",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#1a7f37",
      brightYellow: "#633c01",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#8c959f",
    },
  },

  // ---- Curated classics (canonical brand palettes) ------------------
  {
    id: "dracula",
    name: "Dracula",
    appearance: "dark",
    accent: "#bd93f9",
    accent2: "#ff79c6",
    bg: "#282a36",
    glow: "rgba(189,147,249,0.18)",
    ui: { text: "#f8f8f2", textDim: "#6272a4" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "rgba(68,71,90,0.85)",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    appearance: "dark",
    accent: "#7aa2f7",
    accent2: "#bb9af7",
    bg: "#1a1b26",
    glow: "rgba(122,162,247,0.18)",
    ui: { text: "#c0caf5", textDim: "#565f89" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "rgba(54,64,108,0.8)",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    appearance: "dark",
    accent: "#58a6ff",
    accent2: "#bc8cff",
    bg: "#0d1117",
    glow: "rgba(88,166,255,0.18)",
    ui: { text: "#c9d1d9", textDim: "#8b949e" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#c9d1d9",
      cursor: "#c9d1d9",
      cursorAccent: "#0d1117",
      selectionBackground: "rgba(56,139,253,0.4)",
      black: "#484f58",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d4dd",
      brightWhite: "#f0f6fc",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    appearance: "light",
    accent: "#0969da",
    accent2: "#8250df",
    bg: "#ffffff",
    glow: "rgba(9,105,218,0.14)",
    ui: { text: "#1f2328", textDim: "#656d76" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#1f2328",
      cursor: "#1f2328",
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(9,105,218,0.18)",
      black: "#24292e",
      red: "#cf222e",
      green: "#116329",
      yellow: "#4d2d00",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#1a7f37",
      brightYellow: "#633c01",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#8c959f",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    appearance: "dark",
    accent: "#268bd2",
    accent2: "#2aa198",
    bg: "#002b36",
    glow: "rgba(38,139,210,0.18)",
    ui: { text: "#93a1a1", textDim: "#586e75" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#93a1a1",
      cursor: "#93a1a1",
      cursorAccent: "#002b36",
      selectionBackground: "rgba(7,54,66,0.9)",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    appearance: "light",
    accent: "#268bd2",
    accent2: "#b58900",
    bg: "#fdf6e3",
    glow: "rgba(38,139,210,0.14)",
    ui: { text: "#586e75", textDim: "#93a1a1" },
    xterm: {
      background: TRANSPARENT,
      foreground: "#586e75",
      cursor: "#586e75",
      cursorAccent: "#fdf6e3",
      selectionBackground: "rgba(238,232,213,0.9)",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
];

export function themeById(id: string): AetherTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function themeIndexById(id: string): number {
  const i = THEMES.findIndex((t) => t.id === id);
  return i === -1 ? 0 : i;
}
