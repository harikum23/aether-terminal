/** Typography + cursor settings applied live to every terminal. */
export interface TypeSettings {
  /** css `font-family` stack id (see FONT_STACKS) */
  fontFamily: string;
  fontSize: number;
  /** regular weight (bold renders +200) */
  fontWeight: number;
  lineHeight: number;
  /** px of tracking between cells */
  letterSpacing: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
}

/** A selectable monospace stack. Only IBM Plex Mono ships bundled; the rest
 *  resolve against fonts the user may have installed and fall back gracefully. */
export interface FontStack {
  id: string;
  label: string;
  stack: string;
}

const FALLBACK = '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const FONT_STACKS: FontStack[] = [
  { id: "plex", label: "IBM Plex Mono", stack: `"IBM Plex Mono", ${FALLBACK}` },
  { id: "jetbrains", label: "JetBrains Mono", stack: `"JetBrains Mono", ${FALLBACK}` },
  { id: "fira", label: "Fira Code", stack: `"Fira Code", ${FALLBACK}` },
  { id: "cascadia", label: "Cascadia Code", stack: `"Cascadia Code", "Cascadia Mono", ${FALLBACK}` },
  { id: "sfmono", label: "SF Mono", stack: `"SF Mono", ui-monospace, Menlo, monospace` },
  { id: "menlo", label: "Menlo", stack: `Menlo, Monaco, "Courier New", monospace` },
  { id: "source", label: "Source Code Pro", stack: `"Source Code Pro", ${FALLBACK}` },
  { id: "hack", label: "Hack", stack: `Hack, ${FALLBACK}` },
  { id: "system", label: "System Monospace", stack: `ui-monospace, ${FALLBACK}` },
];

export function fontStackById(id: string): string {
  return (FONT_STACKS.find((f) => f.id === id) ?? FONT_STACKS[0]).stack;
}

/** Editable ranges + the default for each slider/control. */
export const TYPE_LIMITS = {
  fontSize: { min: 9, max: 28, step: 1, default: 13 },
  fontWeight: { options: [300, 400, 500] as const, default: 400 },
  lineHeight: { min: 1.0, max: 2.0, step: 0.05, default: 1.4 },
  letterSpacing: { min: -1, max: 3, step: 0.5, default: 0 },
} as const;

export const DEFAULT_TYPE: TypeSettings = {
  // SF Mono = the native macOS terminal/Xcode face; ui-monospace resolves to it
  // even when the literal "SF Mono" family isn't directly addressable.
  fontFamily: "sfmono",
  fontSize: 13,
  fontWeight: 400,
  // tighter leading reads crisper and denser — terminal-standard, not the loose
  // 1.4 used for prose.
  lineHeight: 1.25,
  letterSpacing: 0,
  cursorStyle: "block",
  cursorBlink: true,
};
