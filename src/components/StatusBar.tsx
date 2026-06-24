import { useEffect, useState } from "react";
import type { AetherTheme } from "../lib/theme";
import type { IngestHealth } from "../lib/ingestHealth";

interface StatusBarProps {
  theme: AetherTheme;
  tabCount: number;
  /** total panes across every tab */
  paneCount: number;
  /** panes in the currently-focused tab */
  focusedTabPanes: number;
  fontSize: number;
  shell: string;
  health: IngestHealth;
  broadcast: boolean;
}

const PILL: Record<
  IngestHealth["state"],
  { mod: string; label: string }
> = {
  live: { mod: "status-pill--live", label: "AAP LIVE" },
  listening: { mod: "status-pill--warn", label: "AAP READY" },
  idle: { mod: "status-pill--idle", label: "AAP IDLE" },
  offline: { mod: "status-pill--err", label: "AAP DOWN" },
};

function healthTitle(h: IngestHealth): string {
  if (h.state === "offline") return "Ingestion server is not running";
  const base = `Ingest :${h.port} — ${h.eventsReceived} events received`;
  if (h.state === "listening") return `${base}. Waiting for the first event.`;
  if (h.secondsSinceLast != null) return `${base}. Last ${h.secondsSinceLast}s ago.`;
  return base;
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function StatusBar({
  theme,
  tabCount,
  paneCount,
  focusedTabPanes,
  fontSize,
  shell,
  health,
  broadcast,
}: StatusBarProps) {
  const clock = useClock();
  const pill = PILL[health.state];
  return (
    <div className="statusbar">
      <div className="status-left">
        <span
          className={"status-pill " + pill.mod}
          title={healthTitle(health)}
        >
          <span className="status-dot" /> {pill.label}
        </span>
        {broadcast && (
          <span className="status-pill status-pill--cast" title="Keystrokes echo to every pane in the focused tab">
            <span className="status-dot" /> BROADCAST
          </span>
        )}
        {health.eventsReceived > 0 && (
          <span className="status-item">{health.eventsReceived} ev</span>
        )}
        <span className="status-item">{shell}</span>
        <span className="status-sep">/</span>
        <span className="status-item">{theme.name}</span>
      </div>
      <div className="status-right">
        <span className="status-item">{tabCount} sessions</span>
        {paneCount > tabCount && (
          <>
            <span className="status-sep">/</span>
            <span className="status-item">{focusedTabPanes} panes</span>
          </>
        )}
        <span className="status-sep">/</span>
        <span className="status-item">{fontSize}px</span>
        <span className="status-sep">/</span>
        <span className="status-item status-hint">⌘K palette</span>
        <span className="status-sep">/</span>
        <span className="status-item status-clock">{clock}</span>
      </div>
    </div>
  );
}
