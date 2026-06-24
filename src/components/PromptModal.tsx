import { useEffect, useRef, useState } from "react";

export interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
  /** prefill value when the modal opens */
  initial?: string;
}

interface PromptModalProps {
  open: boolean;
  title: string;
  fields: PromptField[];
  submitLabel: string;
  onClose: () => void;
  /** called with the trimmed field values; only fires when the first is non-empty */
  onSubmit: (values: Record<string, string>) => void;
}

/**
 * Small reusable text-input modal styled like the AI prompt. Drives the
 * "Save project as…" and "New launcher…" flows — the first field is required,
 * the rest optional. Enter submits, Escape cancels.
 */
export default function PromptModal({
  open,
  title,
  fields,
  submitLabel,
  onClose,
  onSubmit,
}: PromptModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = f.initial ?? "";
    setValues(seed);
    const t = setTimeout(() => firstRef.current?.focus(), 10);
    return () => clearTimeout(t);
    // re-seed each time the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const firstKey = fields[0]?.key;
  const canSubmit = !!firstKey && (values[firstKey] ?? "").trim() !== "";

  const submit = () => {
    if (!canSubmit) return;
    const out: Record<string, string> = {};
    for (const f of fields) out[f.key] = (values[f.key] ?? "").trim();
    onSubmit(out);
  };

  return (
    <div className="ai-backdrop" onMouseDown={onClose}>
      <div
        className="ai-prompt"
        role="dialog"
        aria-label={title}
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label className="ai-prompt__label">{title}</label>
        {fields.map((f, i) => (
          <div className="ai-prompt__row" key={f.key}>
            <span className="ai-prompt__sigil">{i === 0 ? "❯" : "·"}</span>
            <input
              ref={i === 0 ? firstRef : undefined}
              className="ai-prompt__input"
              placeholder={f.placeholder ?? f.label}
              aria-label={f.label}
              value={values[f.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        ))}
        <div className="ai-prompt__foot">
          <span className="ai-prompt__hint">Enter to confirm · Esc to cancel</span>
          <button
            type="button"
            className="ai-btn ai-btn--primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
