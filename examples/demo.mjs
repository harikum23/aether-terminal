#!/usr/bin/env node
/* ============================================================================
 * Aether live demo emitter.
 *
 * Streams a realistic, time-spaced multi-agent scenario to the Aether ingest
 * endpoint so Mission Control animates live: an orchestrator dispatches four
 * specialist sub-agents, each running several tool calls (Read/Bash/Grep/
 * WebFetch/web_search), reporting token usage and cost, with one tool failure
 * and a recovery.
 *
 * Usage:
 *   node examples/demo.mjs            # POST to http://127.0.0.1:9700/ingest
 *   node examples/demo.mjs --dry      # print events to stdout, do not POST
 *   AETHER_ENDPOINT=http://host:port/ingest node examples/demo.mjs
 *
 * Requires Node 18+ (global fetch). Zero dependencies.
 * ========================================================================== */

const ENDPOINT = process.env.AETHER_ENDPOINT || "http://127.0.0.1:9700/ingest";
const DRY = process.argv.includes("--dry");

const RUN_ID = id("run");

function id(prefix = "ae") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.random() * (hi - lo);

async function emit(event) {
  const payload = { runId: RUN_ID, ts: Date.now(), ...event };
  if (DRY) {
    process.stdout.write(JSON.stringify(payload) + "\n");
    return;
  }
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn(`[demo] emit failed (${event.type}):`, err.message);
  }
}

// A tool call: start, wait, end. Returns the (input,output) token estimate.
async function toolCall(agentId, name, input, { ms, status = "ok", output, error } = {}) {
  const callId = id("tool");
  await emit({ type: "tool.start", agentId, toolCallId: callId, name, input });
  const dur = ms ?? Math.round(jitter(300, 900));
  await sleep(DRY ? 0 : dur);
  await emit({
    type: "tool.end",
    agentId,
    toolCallId: callId,
    status,
    durationMs: dur,
    ...(status === "ok" ? { output } : { error }),
  });
}

async function main() {
  console.warn(
    `[demo] run=${RUN_ID} -> ${DRY ? "(dry run, stdout)" : ENDPOINT}`,
  );

  await emit({
    type: "run.start",
    title: "Audit & harden the payments service",
    framework: "demo",
  });

  // --- Orchestrator ------------------------------------------------------
  const orch = id("agent");
  await emit({
    type: "agent.spawn",
    agentId: orch,
    name: "Orchestrator",
    agentType: "supervisor",
    model: "claude-opus-4-8",
    task: "Audit the payments service for security & correctness, then summarize.",
  });
  await emit({ type: "agent.status", agentId: orch, status: "running" });
  await emit({
    type: "agent.message",
    agentId: orch,
    role: "thinking",
    text: "Plan: (1) map the codebase, (2) hunt vulns, (3) check tests, (4) research best practice. Dispatch four specialists in parallel.",
  });

  // --- Sub-agent 1: Code Mapper -----------------------------------------
  const mapper = id("agent");
  await emit({
    type: "agent.spawn",
    agentId: mapper,
    parentId: orch,
    name: "Code Mapper",
    agentType: "researcher",
    model: "claude-haiku-4-5",
    task: "Inventory the payments module: entrypoints, handlers, external calls.",
  });
  await emit({ type: "agent.status", agentId: mapper, status: "running" });
  await toolCall(mapper, "Read", { path: "src/payments/charge.ts" }, {
    output: "export async function charge(req) { /* 180 lines */ }",
  });
  await toolCall(mapper, "Grep", { pattern: "stripe|paypal|braintree", glob: "src/payments/**" }, {
    output: "12 matches across 5 files",
  });
  await emit({
    type: "agent.message",
    agentId: mapper,
    role: "assistant",
    text: "3 entrypoints, 2 PSP integrations (Stripe, PayPal), 1 webhook handler.",
  });
  await emit({
    type: "agent.end",
    agentId: mapper,
    status: "done",
    inputTokens: 4200,
    outputTokens: 510,
    costUsd: 0.0041,
  });

  // --- Sub-agent 2: Security Auditor (has the failing tool) -------------
  const sec = id("agent");
  await emit({
    type: "agent.spawn",
    agentId: sec,
    parentId: orch,
    name: "Security Auditor",
    agentType: "security",
    model: "claude-sonnet-4-6",
    task: "Find injection, authz, and secret-handling issues in the payments path.",
  });
  await emit({ type: "agent.status", agentId: sec, status: "running" });
  await toolCall(sec, "Grep", { pattern: "execSync|child_process", glob: "src/**" }, {
    output: "src/payments/refund.ts:44: execSync(`refund ${id}`)",
  });
  // A tool that fails -> error path + recovery.
  await toolCall(sec, "Bash", { cmd: "semgrep --config p/owasp-top-ten src/payments" }, {
    status: "error",
    error: "semgrep: command not found (binary missing in sandbox)",
    ms: 520,
  });
  await emit({
    type: "agent.message",
    agentId: sec,
    role: "thinking",
    text: "semgrep unavailable; fall back to manual pattern review.",
  });
  await emit({ type: "agent.status", agentId: sec, status: "waiting" });
  await toolCall(sec, "Read", { path: "src/payments/refund.ts" }, {
    output: "line 44 interpolates user-supplied id into a shell command",
  });
  await emit({
    type: "agent.message",
    agentId: sec,
    role: "assistant",
    text: "HIGH: command injection in refund.ts:44 — user `id` flows into execSync. Use parametrized API.",
  });
  await emit({ type: "log", agentId: sec, level: "warn", message: "1 high-severity finding" });
  await emit({
    type: "agent.end",
    agentId: sec,
    status: "done",
    inputTokens: 9800,
    outputTokens: 1340,
    costUsd: 0.041,
  });

  // --- Sub-agent 3: Test Runner -----------------------------------------
  const tester = id("agent");
  await emit({
    type: "agent.spawn",
    agentId: tester,
    parentId: orch,
    name: "Test Runner",
    agentType: "executor",
    model: "claude-haiku-4-5",
    task: "Run the payments test suite and report coverage gaps.",
  });
  await emit({ type: "agent.status", agentId: tester, status: "running" });
  await toolCall(tester, "Bash", { cmd: "npm test -- src/payments --coverage" }, {
    output: "34 passing, 2 failing — refund.test.ts, webhook.test.ts; coverage 71%",
    ms: 860,
  });
  await emit({
    type: "agent.message",
    agentId: tester,
    role: "assistant",
    text: "2 failing tests; refund path and webhook signature verification uncovered.",
  });
  await emit({
    type: "agent.end",
    agentId: tester,
    status: "done",
    inputTokens: 3100,
    outputTokens: 420,
    costUsd: 0.0031,
  });

  // --- Sub-agent 4: Researcher (web tools) ------------------------------
  const researcher = id("agent");
  await emit({
    type: "agent.spawn",
    agentId: researcher,
    parentId: orch,
    name: "Best-Practice Researcher",
    agentType: "researcher",
    model: "gpt-5",
    task: "Find current PCI-DSS guidance for webhook signature verification.",
  });
  await emit({ type: "agent.status", agentId: researcher, status: "running" });
  await toolCall(researcher, "web_search", { query: "Stripe webhook signature verification best practice 2026" }, {
    output: "Top result: verify Stripe-Signature with constructEvent + timing-safe compare",
  });
  await toolCall(researcher, "WebFetch", { url: "https://stripe.com/docs/webhooks/signatures" }, {
    output: "Use stripe.webhooks.constructEvent; reject events older than 5 min.",
    ms: 740,
  });
  await emit({
    type: "agent.message",
    agentId: researcher,
    role: "assistant",
    text: "Recommend constructEvent + 5-min tolerance window; current code does neither.",
  });
  await emit({
    type: "agent.end",
    agentId: researcher,
    status: "done",
    inputTokens: 5600,
    outputTokens: 980,
    costUsd: 0.018,
  });

  // --- Orchestrator wrap-up ---------------------------------------------
  await emit({
    type: "usage",
    agentId: orch,
    model: "claude-opus-4-8",
    inputTokens: 7400,
    outputTokens: 2100,
    costUsd: 0.094,
  });
  await emit({
    type: "agent.message",
    agentId: orch,
    role: "assistant",
    text: "Summary: 1 HIGH (command injection in refund.ts), 2 failing tests, webhook signatures unverified. Recommended fixes attached.",
  });
  await emit({
    type: "agent.end",
    agentId: orch,
    status: "done",
    inputTokens: 7400,
    outputTokens: 2100,
    costUsd: 0.094,
  });
  await emit({ type: "run.end", status: "done" });

  console.warn("[demo] done");
}

main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
