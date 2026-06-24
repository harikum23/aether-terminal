import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type IngestState = "offline" | "listening" | "idle" | "live";

export interface IngestHealth {
  running: boolean;
  port: number;
  eventsReceived: number;
  lastEventMs: number | null;
  state: IngestState;
  /** seconds since the last event, or null if none yet */
  secondsSinceLast: number | null;
}

interface RawStatus {
  running: boolean;
  port: number;
  eventsReceived: number;
  lastEventMs: number | null;
}

const LIVE_WINDOW_MS = 8000;
const POLL_MS = 2500;

function classify(raw: RawStatus): IngestHealth {
  const since =
    raw.lastEventMs != null ? Math.max(0, Date.now() - raw.lastEventMs) : null;
  let state: IngestState;
  if (!raw.running) state = "offline";
  else if (raw.eventsReceived === 0) state = "listening";
  else if (since != null && since < LIVE_WINDOW_MS) state = "live";
  else state = "idle";
  return {
    ...raw,
    state,
    secondsSinceLast: since == null ? null : Math.floor(since / 1000),
  };
}

const OFFLINE: IngestHealth = {
  running: false,
  port: 9700,
  eventsReceived: 0,
  lastEventMs: null,
  state: "offline",
  secondsSinceLast: null,
};

/** Polls the Rust `ingest_status` command so the UI can surface a stalled or
 * misconfigured telemetry pipeline instead of failing silently. */
export function useIngestHealth(): IngestHealth {
  const [health, setHealth] = useState<IngestHealth>(OFFLINE);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const raw = await invoke<RawStatus>("ingest_status");
        if (alive) setHealth(classify(raw));
      } catch {
        if (alive) setHealth(OFFLINE);
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return health;
}
