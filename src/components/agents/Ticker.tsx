import { useMemo } from "react";
import type { TickerItem } from "../../lib/agentProtocol";
import { fmtAgo } from "./format";
import { tickVisual } from "./status";
import { useTick } from "./hooks";

interface TickerProps {
  items: TickerItem[];
  live: boolean;
}

const MAX = 40;

export default function Ticker({ items, live }: TickerProps) {
  useTick(2000, true);
  // newest last in the store; we render newest-first (column-reverse keeps
  // newest pinned to the bottom edge and auto-reveals incoming items).
  const recent = useMemo(() => items.slice(-MAX), [items]);
  const newestTs = recent.length ? recent[recent.length - 1].ts : 0;

  return (
    <div className="mc-ticker">
      <div className="mc-ticker__head">
        {live && (
          <span className="mc-ticker__bars" aria-hidden>
            <span /><span /><span /><span />
          </span>
        )}
        <span className="mc-ticker__title">Live Event Stream</span>
      </div>
      <div className="mc-ticker__feed mc-scroll" role="log" aria-live="polite" aria-label="Agent events">
        {recent.map((item) => {
          const { cls, glyph } = tickVisual(item.kind);
          const fresh = item.ts >= newestTs - 4000;
          return (
            <div key={item.id} className={`mc-tick ${cls} ${fresh ? "mc-tick--fresh" : ""}`}>
              <span className="mc-tick__time">{fmtAgo(item.ts)}</span>
              <span className="mc-tick__glyph">{glyph}</span>
              <span className="mc-tick__label">{item.label}</span>
              {item.detail && <span className="mc-tick__detail">{item.detail}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
