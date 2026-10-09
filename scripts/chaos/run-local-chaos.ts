import { OpsTelemetry, runWithSpanLifecycle, type SpanEndReason } from "@cvg/ops";

export interface LocalChaosCase {
  readonly name: string;
  readonly localResult: "PASS" | "FAIL";
  readonly observedReason: SpanEndReason | "sink_pressure";
  readonly liveExecution: "NOT_RUN";
}

export interface LocalChaosResult {
  readonly status: "LOCAL_SYNTHETIC_PASS" | "LOCAL_SYNTHETIC_FAIL";
  readonly cases: readonly LocalChaosCase[];
  readonly openSpans: number;
  readonly duplicateFinishes: number;
  readonly externalEvidence: "NOT_RUN";
}

const context = {
  requestId: "chaos-request",
  correlationId: "chaos-correlation",
  sessionId: null,
  toolInvocationId: null,
  jobId: "chaos-job",
  outboxId: null,
  providerRequestId: null
} as const;

/**
 * Safe fault-injection matrix. Process, network, database, queue, provider
 * and collector cases are modeled in-process; no service, port or external
 * dependency is stopped by this harness.
 */
export async function runLocalChaos(): Promise<LocalChaosResult> {
  const telemetry = new OpsTelemetry({ maxSpans: 32 });
  const cases: LocalChaosCase[] = [];
  const run = async (name: string, expected: SpanEndReason, action: () => Promise<unknown>): Promise<void> => {
    try { await action(); } catch { /* expected synthetic failure */ }
    const observed = telemetry.spans.at(-1)?.endReason;
    cases.push({ name, localResult: observed === expected ? "PASS" : "FAIL", observedReason: observed ?? "error", liveExecution: "NOT_RUN" });
  };

  await run("process_restart", "abort", async () => {
    const controller = new AbortController();
    const pending = runWithSpanLifecycle(telemetry, "worker.process", context, async (signal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })), { signal: controller.signal });
    controller.abort();
    await pending;
  });
  await run("network_disconnect", "disconnect", () => runWithSpanLifecycle(telemetry, "http.network", context, async () => new Promise<never>(() => undefined), { disconnect: Promise.resolve() }));
  await run("database_timeout", "timeout", () => runWithSpanLifecycle(telemetry, "database.query", context, async () => new Promise<never>(() => undefined), { timeoutMs: 2 }));
  await run("queue_backpressure", "error", () => runWithSpanLifecycle(telemetry, "worker.queue", context, async () => { throw new Error("synthetic queue backpressure"); }));
  await run("provider_timeout", "timeout", () => runWithSpanLifecycle(telemetry, "provider.request", context, async () => new Promise<never>(() => undefined), { timeoutMs: 2 }));

  const pressureTelemetry = new OpsTelemetry({ durableLogSink: { append: () => { throw new Error("synthetic collector pressure"); } } });
  pressureTelemetry.log({ timestamp: new Date().toISOString(), level: "warn", event: "collector.pressure", correlationId: "collector-correlation", actorId: null, metadata: { mode: "synthetic" } });
  cases.push({ name: "collector_pressure", localResult: pressureTelemetry.metrics("memory").telemetry.dropped > 0 ? "PASS" : "FAIL", observedReason: "sink_pressure", liveExecution: "NOT_RUN" });

  const passed = cases.every((item) => item.localResult === "PASS") && telemetry.openSpanCount === 0;
  return { status: passed ? "LOCAL_SYNTHETIC_PASS" : "LOCAL_SYNTHETIC_FAIL", cases, openSpans: telemetry.openSpanCount, duplicateFinishes: telemetry.lifecycle.duplicateFinishes, externalEvidence: "NOT_RUN" };
}

if (process.argv[1]?.endsWith("run-local-chaos.ts")) process.stdout.write(`${JSON.stringify(await runLocalChaos(), null, 2)}\n`);
