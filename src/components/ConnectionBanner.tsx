import { useEffect, useState } from "react";
import type { IngestHealth } from "../lib/ingestHealth";

interface BannerProps {
  health: IngestHealth;
  /** epoch ms of the last "Launch Claude" action, or null */
  launchedAt: number | null;
}

/** Grace period after launching Claude before we warn about missing telemetry. */
const SILENT_GRACE_MS = 12000;

interface Banner {
  key: string;
  level: "error" | "warn";
  title: string;
  body: string;
}

function deriveBanner(health: IngestHealth, launchedAt: number | null): Banner | null {
  if (health.state === "offline") {
    return {
      key: "offline",
      level: "error",
      title: "Ingestion server offline",
      body:
        "Aether's agent telemetry server (127.0.0.1:9700) isn't running. Agent events can't be received. Restart Aether to bring it back up.",
    };
  }
  if (
    launchedAt != null &&
    health.eventsReceived === 0 &&
    Date.now() - launchedAt > SILENT_GRACE_MS
  ) {
    return {
      key: "no-events",
      level: "warn",
      title: "No telemetry from Claude Code yet",
      body:
        "The server is listening but hasn't received any events since you launched Claude. Make sure python3 is on your PATH, and that the session was started with the monitored command (the launched tab shows it). Telemetry appears after Claude's first tool call.",
    };
  }
  return null;
}

export default function ConnectionBanner({ health, launchedAt }: BannerProps) {
  const banner = deriveBanner(health, launchedAt);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  // re-show if the underlying reason changes
  useEffect(() => {
    if (banner && banner.key !== dismissedKey) setDismissedKey(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner?.key]);

  if (!banner || banner.key === dismissedKey) return null;

  return (
    <div className={"conn-banner conn-banner--" + banner.level} role="status">
      <span className="conn-banner__icon">{banner.level === "error" ? "⚠" : "◇"}</span>
      <div className="conn-banner__text">
        <div className="conn-banner__title">{banner.title}</div>
        <div className="conn-banner__body">{banner.body}</div>
      </div>
      <button
        className="conn-banner__dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissedKey(banner.key)}
      >
        ×
      </button>
    </div>
  );
}
