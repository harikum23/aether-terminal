import { DEFAULT_TYPE, type TypeSettings } from "./typography";
import { themeById } from "./theme";
import { DEFAULT_ACCENT_ID, accentById } from "./accents";

/** Local-Ollama assistant configuration. */
export interface OllamaPrefs {
  enabled: boolean;
  baseUrl: string;
  model: string;
}

/** Everything the user can tune that should survive a reload. */
export interface Prefs {
  themeId: string;
  /** accent-id that overrides the theme's accent pair (see accents.ts) */
  accentId: string;
  type: TypeSettings;
  ollama: OllamaPrefs;
}

const KEY = "aether.prefs.v1";

export const DEFAULT_OLLAMA: OllamaPrefs = {
  enabled: false,
  baseUrl: "http://localhost:11434",
  model: "",
};

export const DEFAULT_PREFS: Prefs = {
  themeId: "aether-dark",
  accentId: DEFAULT_ACCENT_ID,
  type: DEFAULT_TYPE,
  ollama: DEFAULT_OLLAMA,
};

/** Merge a saved (possibly absent/partial) ollama blob over defaults, validating the URL. */
function validateOllama(saved: Partial<OllamaPrefs> | undefined): OllamaPrefs {
  const s = saved ?? {};
  let baseUrl = DEFAULT_OLLAMA.baseUrl;
  if (typeof s.baseUrl === "string" && s.baseUrl.trim()) {
    try {
      new URL(s.baseUrl);
      baseUrl = s.baseUrl;
    } catch {
      /* keep default on malformed URL */
    }
  }
  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULT_OLLAMA.enabled,
    baseUrl,
    model: typeof s.model === "string" ? s.model : DEFAULT_OLLAMA.model,
  };
}

/** Read prefs from localStorage, merged over defaults and validated. */
export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    return {
      themeId: themeById(saved.themeId ?? DEFAULT_PREFS.themeId).id,
      accentId: accentById(saved.accentId)?.id ?? DEFAULT_PREFS.accentId,
      type: { ...DEFAULT_TYPE, ...(saved.type ?? {}) },
      ollama: validateOllama(saved.ollama),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Persist prefs; ignore quota / availability errors (e.g. private mode). */
export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — preferences just won't persist */
  }
}
