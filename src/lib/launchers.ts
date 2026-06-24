/* ============================================================
   Launchers — curated "new session" profiles plus user-saved
   ones. A launcher just opens a fresh session and (optionally)
   runs a command in it via the existing initialCommand path —
   the same mechanism the Claude launcher uses. No backend
   change is needed: `pwsh`, `python3`, etc. are typed into the
   freshly spawned login shell.
   ============================================================ */

import type { IconName } from "../components/Icon";

export interface Launcher {
  id: string;
  /** label shown in menus, and the new session's title */
  name: string;
  /** command run in the fresh shell; "" means a plain default shell */
  command: string;
  icon: IconName;
  /** short note shown under the name in the picker */
  hint?: string;
  /** built-ins ship with the app and can't be deleted */
  builtin?: boolean;
}

/**
 * Curated suggestions. These nudge toward modern tooling — e.g. PowerShell 7
 * (`pwsh`) rather than legacy Windows PowerShell. Anything not installed simply
 * fails in-shell with a normal "command not found", so the list stays useful
 * cross-platform without probing the system.
 */
export const BUILTIN_LAUNCHERS: Launcher[] = [
  { id: "default", name: "Default shell", command: "", icon: "terminal", hint: "your login shell", builtin: true },
  { id: "pwsh", name: "PowerShell 7", command: "pwsh", icon: "terminal", hint: "modern cross-platform pwsh", builtin: true },
  { id: "bash", name: "Bash", command: "bash", icon: "terminal", hint: "GNU Bash", builtin: true },
  { id: "fish", name: "Fish", command: "fish", icon: "terminal", hint: "friendly interactive shell", builtin: true },
  { id: "python", name: "Python", command: "python3", icon: "terminal", hint: "python3 REPL", builtin: true },
  { id: "node", name: "Node", command: "node", icon: "terminal", hint: "Node.js REPL", builtin: true },
];

const KEY = "aether.launchers.v1";

let seq = 0;
function makeId(): string {
  seq += 1;
  return `lnch-${seq.toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

/** A new user launcher from a name + command (icon fixed to the terminal glyph). */
export function makeLauncher(name: string, command: string): Launcher {
  return { id: makeId(), name: name.trim() || command.trim(), command: command.trim(), icon: "terminal" };
}

/** Read the user's saved launchers (never the built-ins) from localStorage. */
export function loadUserLaunchers(): Launcher[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (l): l is Launcher =>
          !!l &&
          typeof l === "object" &&
          typeof (l as Launcher).id === "string" &&
          typeof (l as Launcher).name === "string" &&
          typeof (l as Launcher).command === "string",
      )
      .map((l) => ({ ...l, icon: "terminal" as IconName, builtin: false }));
  } catch {
    return [];
  }
}

/** Persist the user's launchers; ignore storage errors (e.g. private mode). */
export function saveUserLaunchers(list: Launcher[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.filter((l) => !l.builtin)));
  } catch {
    /* storage unavailable — launchers just won't persist */
  }
}
