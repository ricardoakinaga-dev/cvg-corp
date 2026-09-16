import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CvgStore } from "@cvg/domain";
import type { CvgContext } from "@cvg/contracts";
import { EmbeddedAgentRuntime } from "@cvg/embedded-agent-runtime";
import { MemoryAgentSessionStore } from "@cvg/agent-session";
import { MockModelProvider } from "@cvg/model-adapters";

/**
 * Local load baseline for the embedded agent runtime.  Raw samples are kept in
 * the artifact (not just a summary).  Latency does not include a real model:
 * this isolates runtime overhead (kernel + context + session + governance),
 * exactly as the harness benchmark requires.  Budgets remain PROPOSED until a
 * real-model baseline exists.
 */

const LEVELS = process.env.CVG_AGENT_LOAD_LEVELS?.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0) ?? [1, 5, 10, 25, 50];
const MOCK_LATENCY_MS = Number(process.env.CVG_AGENT_LOAD_MODEL_LATENCY_MS ?? 2);
const MAX_CONCURRENT_TURNS = Number(process.env.CVG_AGENT_LOAD_MAX_CONCURRENT ?? 8);

function context(store: CvgStore): CvgContext {
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id ?? store.bootstrapCredentials.userId;
  const option = store.contextOptions(veterinarianId)[0];
  if (!option) throw new Error("load benchmark requires a context option");
  const session = store.createSession(veterinarianId, "agent-load-token", "agent-load-csrf", 60);
  return store.resolveContext(veterinarianId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "benchmark", "agent-load", null, null, session.id);
}

async function runLevel(level: number): Promise<Record<string, unknown>> {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const ctx = context(store);
  const sessionStore = new MemoryAgentSessionStore();
  const runtime = new EmbeddedAgentRuntime({
    store,
    modelProvider: new MockModelProvider({ latencyMs: MOCK_LATENCY_MS }),
    sessionStore,
    instanceId: "load-benchmark",
    runtimeCommit: "benchmark-local",
    maxConcurrentTurns: MAX_CONCURRENT_TURNS
  });
  const before = process.memoryUsage();
  const samples: { accepted: boolean; latencyMs: number; status: string; reason: string | null }[] = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: level }, async (_, index) => {
      const turnStarted = performance.now();
      try {
        const result = await runtime.executeTurn(ctx, {
          sessionId: null,
          prompt: `turno de carga ${level}/${index}`,
          purpose: "SUMMARY",
          patientId: null,
          encounterId: null,
          requestedTool: null,
          approvalId: null,
          idempotencyKey: `agent-load-${level}-${index}`
        });
        samples.push({ accepted: true, latencyMs: Math.round((performance.now() - turnStarted) * 100) / 100, status: result.turn.status, reason: null });
      } catch (error) {
        samples.push({ accepted: false, latencyMs: Math.round((performance.now() - turnStarted) * 100) / 100, status: "REJECTED", reason: error instanceof Error ? error.message : "unknown" });
      }
    })
  );
  const wallMs = Math.round((performance.now() - started) * 100) / 100;
  const after = process.memoryUsage();
  await runtime.shutdown();
  const accepted = samples.filter((sample) => sample.accepted);
  const latencies = accepted.map((sample) => sample.latencyMs).sort((left, right) => left - right);
  const percentile = (fraction: number): number | null => latencies.length === 0 ? null : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * fraction))]!;
  const tokens = accepted.length * 15;
  return {
    sessions: level,
    accepted: accepted.length,
    rejectedByBackpressure: samples.length - accepted.length,
    maxConcurrentTurns: MAX_CONCURRENT_TURNS,
    wallMs,
    latencyMs: { min: latencies.at(0) ?? null, p50: percentile(0.5), p95: percentile(0.95), max: latencies.at(-1) ?? null },
    tokensPerSecond: wallMs > 0 ? Math.round((tokens / wallMs) * 1_000 * 100) / 100 : null,
    heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
    rssDeltaBytes: after.rss - before.rss,
    samples
  };
}

const levels: Record<string, unknown>[] = [];
for (const level of LEVELS) {
  const result = await runLevel(level);
  levels.push(result);
  process.stdout.write(`level sessions=${result.sessions} accepted=${result.accepted} rejected=${result.rejectedByBackpressure} wallMs=${result.wallMs} p95=${String((result.latencyMs as Record<string, unknown>).p95 ?? "n/a")}\n`);
}
const sha = process.env.CVG_BUILD_SHA ?? process.env.CVG_GIT_SHA ?? "local";
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  subjectSha: sha,
  evidenceClass: "LOCAL_REAL",
  scope: "embedded runtime overhead with deterministic mock provider (no real model latency)",
  modelLatencyMs: MOCK_LATENCY_MS,
  budgets: "PROPOSED — requires a real-provider baseline",
  levels
};
mkdirSync("artifacts/operational-proof", { recursive: true });
writeFileSync("artifacts/operational-proof/agent-runtime-load-local.json", `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`AGENT_RUNTIME_LOAD_BASELINE levels=${LEVELS.join(",")} artifact=artifacts/operational-proof/agent-runtime-load-local.json\n`);
