/* Formatting helpers for Mission Control — tokens, cost, durations, relative time. */

/** 12400 → "12.4k", 980 → "980", 2_300_000 → "2.3M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : trim1(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : trim1(m)}M`;
}

/** 0.62 → "$0.62", 0 → "$0.00", 12.4 → "$12.40". */
export function fmtCost(usd: number): string {
  return `$${usd.toFixed(usd >= 100 ? 0 : 2)}`;
}

/** 820 → "820ms", 1200 → "1.2s", 95000 → "95s", 125000 → "2m05s". */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 100_000) return `${trim1(ms / 1000)}s`;
  const totalS = Math.round(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

/** Relative time: "now", "12s ago", "4m ago", "2h ago". */
export function fmtAgo(ts: number, ref: number = Date.now()): string {
  const d = Math.max(0, ref - ts);
  if (d < 3000) return "now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/** Elapsed wall-clock, mm:ss style: "00:11", "01:24", "12:03". */
export function fmtElapsed(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function trim1(n: number): string {
  // one decimal, but drop trailing ".0"
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
}

/** Best-effort single-line summary of arbitrary tool input JSON. */
export function summarizeInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") return input;
  if (typeof input !== "object") return String(input);
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  return entries
    .map(([k, v]) => `${k}: ${oneLine(v)}`)
    .join("  ")
    .slice(0, 160);
}

function oneLine(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "…" : v;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v);
}
