import { useEffect, useRef, useState } from "react";

interface AiPromptModalProps {
  open: boolean;
  onClose: () => void;
  /** called with the trimmed request when the user submits */
  onSubmit: (request: string) => void;
}

/**
 * Small free-text modal for the NL→command request. The command palette has
 * no argument input, so this collects the natural-language ask before we
 * dispatch the generation.
 */
export default function AiPromptModal({ open, onClose, onSubmit }: AiPromptModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue("");
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
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

  const submit = () => {
    const req = value.trim();
    if (!req) return;
    onSubmit(req);
  };

  return (
    <div className="ai-backdrop" onMouseDown={onClose}>
      <div
        className="ai-prompt"
        role="dialog"
        aria-label="Describe a command"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label className="ai-prompt__label" htmlFor="ai-prompt-input">
          Describe the command you want
        </label>
        <div className="ai-prompt__row">
          <span className="ai-prompt__sigil">❯</span>
          <input
            id="ai-prompt-input"
            ref={inputRef}
            className="ai-prompt__input"
            placeholder="e.g. find files larger than 100MB modified this week"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className="ai-prompt__foot">
          <span className="ai-prompt__hint">Enter to generate · Esc to cancel</span>
          <button
            type="button"
            className="ai-btn ai-btn--primary"
            onClick={submit}
            disabled={!value.trim()}
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
