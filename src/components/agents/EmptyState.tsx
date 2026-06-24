import { useState } from "react";
import { seedMockStore } from "../../lib/agentMock";

const SNIPPET = `import { AetherClient } from "aether-sdk";
const ae = new AetherClient({ title: "My run" });
ae.toolStart(agentId, id, "search", { q });`;

export default function EmptyState() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div className="mc-empty">
      <div className="mc-empty__card">
        <div className="mc-empty__orb" aria-hidden>
          <span className="mc-empty__orb-core" />
        </div>

        <div>
          <div className="mc-empty__heading">Waiting for agents…</div>
          <div className="mc-empty__sub">
            Mission Control is listening. Point any Claude or OpenAI agent
            framework at the local ingestion endpoint and watch dispatches,
            tool calls, tokens and cost stream in live.
          </div>
        </div>

        <div className="mc-endpoints">
          <div className="mc-endpoint">
            <span className="mc-endpoint__tag">WS</span>
            <span className="mc-endpoint__url">ws://127.0.0.1:9700/ws</span>
          </div>
          <div className="mc-endpoint">
            <span className="mc-endpoint__tag">POST</span>
            <span className="mc-endpoint__url">http://127.0.0.1:9700/ingest</span>
          </div>
        </div>

        <div className="mc-snippet">
          <div className="mc-snippet__bar">
            <span>aether-sdk · quickstart</span>
            <button
              className={copied ? "mc-snippet__copy mc-snippet__copy--done" : "mc-snippet__copy"}
              onClick={copy}
            >
              {copied ? "✓ copied" : "copy"}
            </button>
          </div>
          <pre>
            <code>
              <span className="tok-kw">import</span> {"{ AetherClient } "}
              <span className="tok-kw">from</span>{" "}
              <span className="tok-str">"aether-sdk"</span>
              <span className="tok-dim">;</span>
              {"\n"}
              <span className="tok-kw">const</span> ae ={" "}
              <span className="tok-kw">new</span>{" "}
              <span className="tok-fn">AetherClient</span>
              {"({ title: "}
              <span className="tok-str">"My run"</span>
              {" });"}
              {"\n"}
              ae.<span className="tok-fn">toolStart</span>
              {"(agentId, id, "}
              <span className="tok-str">"search"</span>
              {", { q });"}
            </code>
          </pre>
        </div>

        <div className="mc-empty__actions">
          <button className="mc-btn" onClick={() => seedMockStore()}>
            <span className="mc-btn__glyph">▶</span> Load demo
          </button>
          <span className="mc-empty__hint">
            seeds a realistic multi-agent run instantly
          </span>
        </div>
      </div>
    </div>
  );
}
