import { useEffect, useRef } from "react";

import type { AiTaskStatus } from "../lib/useAiTask";

interface AiPanelProps {
  open: boolean;
  /** short label shown in the header (e.g. "Explain output") */
  title: string;
  /** optional model name shown in the subheading */
  model?: string;
  status: AiTaskStatus;
  text: string;
  error: string | null;
  /** when set, shown instead of the connection error/streaming flow */
  emptyMessage?: string | null;
  onClose: () => void;
  /** stop an in-flight stream */
  onStop: () => void;
  /** re-run the same task after an error */
  onRetry: () => void;
  /**
   * Action slot rendered in the footer — insert/run buttons, a selectable
   * suggestion list, etc. Owned by the caller because it differs per task.
   */
  actions?: React.ReactNode;
}

/**
 * Shared overlay that renders a streamed assistant response with all four
 * async states: loading (spinner + Stop), error (+ Retry), empty (gated
 * message), and success (streamed text + action slot).
 */
export default function AiPanel({
  open,
  title,
  model,
  status,
  text,
  error,
  emptyMessage,
  onClose,
  onStop,
  onRetry,
  actions,
}: AiPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Esc closes the panel.
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

  // Keep the latest tokens in view while streaming.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  if (!open) return null;

  const streaming = status === "streaming";
  const showEmpty = !!emptyMessage;

  return (
    <div className="ai-backdrop" onMouseDown={onClose}>
      <div
        className="ai-panel"
        role="dialog"
        aria-label={title}
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ai-panel__head">
          <div>
            <h2 className="ai-panel__title">{title}</h2>
            {model && <p className="ai-panel__sub">{model}</p>}
          </div>
          <div className="ai-panel__head-actions">
            {streaming && (
              <button type="button" className="ai-btn ai-btn--stop" onClick={onStop}>
                <span className="ai-spinner" aria-hidden /> Stop
              </button>
            )}
            <button
              type="button"
              className="ai-panel__close"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="ai-panel__body" ref={bodyRef} aria-live="polite">
          {showEmpty ? (
            <p className="ai-panel__empty">{emptyMessage}</p>
          ) : status === "error" ? (
            <div className="ai-panel__error" role="alert">
              <p className="ai-panel__error-msg">{error ?? "Something went wrong."}</p>
              <button type="button" className="ai-btn" onClick={onRetry}>
                Retry
              </button>
            </div>
          ) : streaming && text.length === 0 ? (
            <p className="ai-panel__loading">
              <span className="ai-spinner" aria-hidden /> Generating…
            </p>
          ) : (
            <pre className="ai-panel__text">{text}</pre>
          )}
        </div>

        {!showEmpty && status !== "error" && actions && (
          <footer className="ai-panel__foot">{actions}</footer>
        )}
      </div>
    </div>
  );
}
