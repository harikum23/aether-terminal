import { useEffect, useState } from "react";

import { THEMES, type AetherTheme } from "../lib/theme";
import {
  FONT_STACKS,
  TYPE_LIMITS,
  type TypeSettings,
} from "../lib/typography";
import type { OllamaPrefs } from "../lib/prefs";
import { ACCENTS } from "../lib/accents";
import { listModels, testConnection, type OllamaModel } from "../lib/ollama";

interface SettingsPanelProps {
  open: boolean;
  theme: AetherTheme;
  type: TypeSettings;
  ollama: OllamaPrefs;
  accentId: string;
  onClose: () => void;
  onSelectTheme: (id: string) => void;
  onSelectAccent: (id: string) => void;
  onPatchType: (patch: Partial<TypeSettings>) => void;
  onPatchOllama: (patch: Partial<OllamaPrefs>) => void;
}

type TestStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; modelCount: number; version?: string }
  | { kind: "error"; message: string };

/** The six "core" ANSI hues we preview on each theme card. */
const SWATCH_KEYS = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;

function ThemeCard({
  theme,
  active,
  onSelect,
}: {
  theme: AetherTheme;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={"theme-card" + (active ? " theme-card--active" : "")}
      style={{
        // preview each theme in its own colors, regardless of the live theme
        ["--card-bg" as string]: theme.bg,
        ["--card-accent" as string]: theme.accent,
        ["--card-accent-2" as string]: theme.accent2,
        ["--card-text" as string]: theme.ui.text,
      }}
      onClick={onSelect}
      aria-pressed={active}
    >
      <div className="theme-card__preview">
        <span className="theme-card__dot" />
        <span className="theme-card__sample">Aa</span>
        <div className="theme-card__swatches">
          {SWATCH_KEYS.map((k) => (
            <span
              key={k}
              className="theme-card__swatch"
              style={{ background: theme.xterm[k] as string }}
            />
          ))}
        </div>
      </div>
      <div className="theme-card__meta">
        <span className="theme-card__name">{theme.name}</span>
        {active && <span className="theme-card__check">✓</span>}
      </div>
    </button>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={"seg__btn" + (o.value === value ? " seg__btn--on" : "")}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-row__label">
        {label}
        {hint && <span className="set-row__hint">{hint}</span>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

function OllamaSection({
  ollama,
  onPatchOllama,
}: {
  ollama: OllamaPrefs;
  onPatchOllama: (patch: Partial<OllamaPrefs>) => void;
}) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [test, setTest] = useState<TestStatus>({ kind: "idle" });

  // Populate the model dropdown whenever enabled + a base URL is set.
  useEffect(() => {
    if (!ollama.enabled) return;
    let cancelled = false;
    setFetchFailed(false);
    listModels(ollama.baseUrl)
      .then((m) => {
        if (!cancelled) setModels(m);
      })
      .catch(() => {
        if (!cancelled) {
          setModels([]);
          setFetchFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ollama.enabled, ollama.baseUrl]);

  const runTest = () => {
    setTest({ kind: "testing" });
    testConnection(ollama.baseUrl)
      .then((h) =>
        setTest({ kind: "ok", modelCount: h.modelCount, version: h.version }),
      )
      .catch((err: unknown) =>
        setTest({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
  };

  return (
    <section className="settings__section">
      <h3 className="settings__legend">AI / Ollama</h3>

      <Row label="Enable" hint="local LLM assistant">
        <Segmented
          value={ollama.enabled ? "on" : "off"}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(v) => onPatchOllama({ enabled: v === "on" })}
        />
      </Row>

      {ollama.enabled && (
        <>
          <Row label="Endpoint" hint="Ollama server URL">
            <input
              type="text"
              className="set-select ai-text-input"
              value={ollama.baseUrl}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => onPatchOllama({ baseUrl: e.target.value })}
            />
          </Row>

          <Row label="Model">
            {fetchFailed ? (
              <input
                type="text"
                className="set-select ai-text-input"
                placeholder="model name (e.g. llama3.2)"
                value={ollama.model}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => onPatchOllama({ model: e.target.value })}
              />
            ) : (
              <select
                className="set-select"
                value={ollama.model}
                onChange={(e) => onPatchOllama({ model: e.target.value })}
              >
                <option value="">Pick a model…</option>
                {/* keep a previously-saved model visible even if not in the list */}
                {ollama.model && !models.some((m) => m.name === ollama.model) && (
                  <option value={ollama.model}>{ollama.model}</option>
                )}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Row>

          <Row label="Connection">
            <div className="ai-test">
              <button
                type="button"
                className="ai-btn"
                onClick={runTest}
                disabled={test.kind === "testing"}
              >
                {test.kind === "testing" ? "Testing…" : "Test Connection"}
              </button>
              {test.kind === "ok" && (
                <span className="ai-test__status ai-test__status--ok">
                  Connected · {test.modelCount} model
                  {test.modelCount === 1 ? "" : "s"}
                  {test.version ? ` · v${test.version}` : ""}
                </span>
              )}
              {test.kind === "error" && (
                <span className="ai-test__status ai-test__status--err">
                  Couldn't reach Ollama at {ollama.baseUrl}
                </span>
              )}
            </div>
          </Row>
        </>
      )}
    </section>
  );
}

export default function SettingsPanel({
  open,
  theme,
  type,
  ollama,
  accentId,
  onClose,
  onSelectTheme,
  onSelectAccent,
  onPatchType,
  onPatchOllama,
}: SettingsPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const darkThemes = THEMES.filter((t) => t.appearance === "dark");
  const lightThemes = THEMES.filter((t) => t.appearance === "light");
  const lim = TYPE_LIMITS;

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div
        className="settings"
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="settings__head">
          <div>
            <h2 className="settings__title">Settings</h2>
            <p className="settings__sub">Appearance, typography &amp; AI</p>
          </div>
          <button type="button" className="settings__close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </header>

        <div className="settings__body">
          {/* ---- Appearance ---- */}
          <section className="settings__section">
            <h3 className="settings__legend">Theme</h3>
            <p className="settings__group-label">Dark</p>
            <div className="theme-grid">
              {darkThemes.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  active={t.id === theme.id}
                  onSelect={() => onSelectTheme(t.id)}
                />
              ))}
            </div>
            <p className="settings__group-label">Light</p>
            <div className="theme-grid">
              {lightThemes.map((t) => (
                <ThemeCard
                  key={t.id}
                  theme={t}
                  active={t.id === theme.id}
                  onSelect={() => onSelectTheme(t.id)}
                />
              ))}
            </div>
          </section>

          {/* ---- Accent ---- */}
          <section className="settings__section">
            <h3 className="settings__legend">Accent</h3>
            <p className="settings__sub">Overrides the theme accent on any theme.</p>
            <div className="accent-row" role="radiogroup" aria-label="Accent color">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === accentId}
                  aria-label={a.name}
                  title={a.name}
                  className={
                    "accent-chip" + (a.id === accentId ? " accent-chip--active" : "")
                  }
                  style={
                    {
                      "--chip": a.accent,
                      "--chip-2": a.accent2,
                    } as React.CSSProperties
                  }
                  onClick={() => onSelectAccent(a.id)}
                />
              ))}
            </div>
          </section>

          {/* ---- Typography ---- */}
          <section className="settings__section">
            <h3 className="settings__legend">Typography</h3>

            <Row label="Font family">
              <select
                className="set-select"
                value={type.fontFamily}
                onChange={(e) => onPatchType({ fontFamily: e.target.value })}
              >
                {FONT_STACKS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Row>

            <Row label="Font size" hint={`${type.fontSize}px`}>
              <input
                type="range"
                className="set-range"
                min={lim.fontSize.min}
                max={lim.fontSize.max}
                step={lim.fontSize.step}
                value={type.fontSize}
                onChange={(e) => onPatchType({ fontSize: Number(e.target.value) })}
              />
            </Row>

            <Row label="Weight">
              <Segmented
                value={type.fontWeight}
                options={[
                  { value: 300, label: "Light" },
                  { value: 400, label: "Regular" },
                  { value: 500, label: "Medium" },
                ]}
                onChange={(v) => onPatchType({ fontWeight: v })}
              />
            </Row>

            <Row label="Line height" hint={type.lineHeight.toFixed(2)}>
              <input
                type="range"
                className="set-range"
                min={lim.lineHeight.min}
                max={lim.lineHeight.max}
                step={lim.lineHeight.step}
                value={type.lineHeight}
                onChange={(e) => onPatchType({ lineHeight: Number(e.target.value) })}
              />
            </Row>

            <Row label="Letter spacing" hint={`${type.letterSpacing}px`}>
              <input
                type="range"
                className="set-range"
                min={lim.letterSpacing.min}
                max={lim.letterSpacing.max}
                step={lim.letterSpacing.step}
                value={type.letterSpacing}
                onChange={(e) => onPatchType({ letterSpacing: Number(e.target.value) })}
              />
            </Row>
          </section>

          {/* ---- Cursor ---- */}
          <section className="settings__section">
            <h3 className="settings__legend">Cursor</h3>
            <Row label="Style">
              <Segmented
                value={type.cursorStyle}
                options={[
                  { value: "block", label: "Block" },
                  { value: "bar", label: "Bar" },
                  { value: "underline", label: "Underline" },
                ]}
                onChange={(v) => onPatchType({ cursorStyle: v })}
              />
            </Row>
            <Row label="Blink">
              <Segmented
                value={type.cursorBlink ? "on" : "off"}
                options={[
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
                onChange={(v) => onPatchType({ cursorBlink: v === "on" })}
              />
            </Row>
          </section>

          {/* ---- AI / Ollama ---- */}
          <OllamaSection ollama={ollama} onPatchOllama={onPatchOllama} />
        </div>

        <footer className="settings__foot">
          <span className="settings__foot-hint">⌘, to toggle · Esc to close</span>
          <span className="settings__foot-theme">{theme.name}</span>
        </footer>
      </div>
    </div>
  );
}
