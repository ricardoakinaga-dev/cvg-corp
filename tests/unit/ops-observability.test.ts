import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileDurableLogSink,
  OpsTelemetry,
  PROPOSED_OPERATIONAL_SLO_DEFINITIONS,
  PROPOSED_SLO_ALERT_RULES,
  type SloId,
  evaluateSlo,
  evaluateSloAlerts,
  readDurableLogFile,
  runWithSpanLifecycle
} from "@cvg/ops";

const context = {
  requestId: "req-local",
  correlationId: "corr-local",
  sessionId: null,
  toolInvocationId: null,
  jobId: "job-local",
  outboxId: null,
  providerRequestId: null
} as const;

test("telemetry normalizes 10k URL variants, bounds maps and redacts payload-like values", () => {
  const telemetry = new OpsTelemetry({ maxOperations: 8, maxSpans: 4, maxLogs: 8 });
  for (let index = 0; index < 10_000; index += 1) {
    const startedAt = telemetry.requestStarted();
    telemetry.requestFinished(startedAt, 200, `GET /api/v1/patients/${index}?query=synthetic-${index}`);
    const span = telemetry.startSpan(`GET /api/v1/patients/${index}?prompt=synthetic-${index}`, { prompt: "synthetic patient text", "http.route": `/api/v1/patients/${index}`, requestId: `req-${index}` });
    telemetry.finishSpan(span, 200);
    telemetry.log({ timestamp: new Date().toISOString(), level: "info", event: "synthetic.request", correlationId: `corr-${index}`, actorId: null, metadata: { token: "synthetic-secret", prompt: "synthetic text", index } });
  }
  for (let index = 0; index < 100; index += 1) telemetry.requestFinished(telemetry.requestStarted(), 200, `GET /synthetic-${index}`);

  const metrics = telemetry.metrics("memory");
  assert.ok(Object.keys(metrics.operations).length <= 8);
  assert.ok(telemetry.cardinality.operationOverflow > 0);
  assert.ok(Object.keys(metrics.operations).every((operation) => !operation.includes("?")));
  assert.equal(telemetry.logs.at(-1)?.metadata.token, "[REDACTED]");
  assert.equal(telemetry.spans.at(-1)?.attributes.prompt, "[REDACTED]");
  assert.equal(telemetry.openSpanCount, 0);
});

test("metrics redact sensitive static route segments without dropping the aggregate", () => {
  const telemetry = new OpsTelemetry();
  for (const route of [
    "POST /api/v1/auth/password/rotate",
    "POST /api/v1/auth/secret/rotate",
    "POST /api/v1/auth/access-token/revoke"
  ]) telemetry.requestFinished(telemetry.requestStarted(), 200, route);
  telemetry.requestFinished(telemetry.requestStarted(), 200, "GET /api/v1/health");

  const operations = telemetry.metrics("memory").operations;
  assert.equal(operations["POST /api/v1/auth/:redacted/rotate"], 2);
  assert.equal(operations["POST /api/v1/auth/:redacted/revoke"], 1);
  assert.equal(operations["GET /api/v1/health"], 1);
  assert.equal(Object.keys(operations).some((key) => /(?:^|[_.:/ -])(?:password|secret|token|authorization)(?:$|[_.:/ -])/i.test(key)), false);
});

test("span lifecycle closes response, error, abort, timeout and disconnect exactly once", async () => {
  const telemetry = new OpsTelemetry({ maxSpans: 16 });
  await runWithSpanLifecycle(telemetry, "GET /synthetic", context, async () => "ok");
  await assert.rejects(() => runWithSpanLifecycle(telemetry, "GET /synthetic/error", context, async () => { throw new Error("synthetic failure"); }));

  const abortController = new AbortController();
  const aborted = runWithSpanLifecycle(telemetry, "GET /synthetic/abort", context, async (signal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })), { signal: abortController.signal });
  abortController.abort();
  await assert.rejects(aborted, /aborted|operation ended/i);

  await assert.rejects(() => runWithSpanLifecycle(telemetry, "GET /synthetic/timeout", context, async () => new Promise<never>(() => undefined), { timeoutMs: 2 }), /deadline|timeout/i);
  await assert.rejects(() => runWithSpanLifecycle(telemetry, "GET /synthetic/disconnect", context, async () => new Promise<never>(() => undefined), { disconnect: Promise.resolve() }), /disconnect|ended/i);

  const reasons = telemetry.spans.map((span) => span.endReason).sort();
  assert.deepEqual(reasons, ["abort", "disconnect", "error", "response", "timeout"]);
  assert.equal(telemetry.openSpanCount, 0);
  const duplicate = telemetry.startSpan("GET /synthetic/duplicate", context);
  telemetry.finishSpan(duplicate, 200, "response");
  telemetry.finishSpan(duplicate, 200, "response");
  assert.equal(telemetry.openSpanCount, 0);
  assert.equal(telemetry.lifecycle.duplicateFinishes, 1);
});

test("durable local logs survive a sink restart, rotate and expose sink failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cvg-ops-"));
  const path = join(directory, "operational.jsonl");
  try {
    const firstSink = new FileDurableLogSink({ path, maxBytes: 8_192, maxBackups: 2 });
    const firstTelemetry = new OpsTelemetry({ durableLogSink: firstSink });
    firstTelemetry.log({ timestamp: new Date().toISOString(), level: "error", event: "synthetic.failure", correlationId: "corr-restart", actorId: null, metadata: { token: "do-not-persist", prompt: "synthetic only", safe: "kept" } });
    await firstTelemetry.close();

    const secondSink = new FileDurableLogSink({ path, maxBytes: 8_192, maxBackups: 2 });
    const secondTelemetry = new OpsTelemetry({ durableLogSink: secondSink });
    secondTelemetry.logCorrelated({ context, event: "synthetic.restarted", metadata: { result: "recovered" }, outcome: "OBSERVED" });
    await secondTelemetry.close();
    const records = readDurableLogFile(path);
    assert.equal(records.length, 2);
    assert.equal(records[0]?.correlationId, "corr-restart");
    assert.equal(records[0]?.metadata.token, "[REDACTED]");
    assert.equal(JSON.stringify(records).includes("do-not-persist"), false);
    assert.equal(JSON.stringify(records).includes("synthetic only"), false);

    const rotating = new FileDurableLogSink({ path: join(directory, "rotating.jsonl"), maxBytes: 256, maxBackups: 2 });
    for (let index = 0; index < 8; index += 1) rotating.append({ timestamp: new Date().toISOString(), level: "info", event: "synthetic.rotation", correlationId: `corr-${index}`, actorId: null, metadata: { value: "bounded" } });
    assert.ok(rotating.stats().rotated > 0);

    const failingTelemetry = new OpsTelemetry({ durableLogSink: { append: () => { throw new Error("synthetic sink pressure"); } } });
    failingTelemetry.log({ timestamp: new Date().toISOString(), level: "warn", event: "synthetic.sink", correlationId: "corr-failure", actorId: null, metadata: {} });
    assert.ok(failingTelemetry.metrics("memory").telemetry.dropped >= 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("operational SLO catalog covers errors, dependencies, queue/worker, telemetry and unknown DR evidence", () => {
  const ids = new Set(PROPOSED_OPERATIONAL_SLO_DEFINITIONS.map((definition) => definition.id));
  const requiredIds: readonly SloId[] = ["API_AVAILABILITY", "API_P95_LATENCY", "API_ERROR_RATIO", "DEPENDENCY_AVAILABILITY", "OUTBOX_PROCESSING_DELAY", "WORKER_HEARTBEAT", "TELEMETRY_DROPS", "RESTORE_RTO", "RESTORE_RPO"];
  for (const id of requiredIds) assert.ok(ids.has(id));
  const rto = PROPOSED_OPERATIONAL_SLO_DEFINITIONS.find((definition) => definition.id === "RESTORE_RTO");
  const rpo = PROPOSED_OPERATIONAL_SLO_DEFINITIONS.find((definition) => definition.id === "RESTORE_RPO");
  assert.equal(evaluateSlo(rto!, { value: null, sampleCount: 0, evidence: "UNKNOWN", environment: "synthetic", observedAt: new Date().toISOString() }).status, "NOT_RUN");
  assert.equal(evaluateSlo(rpo!, { value: null, sampleCount: 0, evidence: "UNKNOWN", environment: "synthetic", observedAt: new Date().toISOString() }).status, "NOT_RUN");
  const alerts = evaluateSloAlerts([
    evaluateSlo(rto!, { value: null, sampleCount: 0, evidence: "UNKNOWN", environment: "synthetic", observedAt: new Date().toISOString() })
  ]);
  assert.equal(alerts.find((alert) => alert.ruleId === "SLO-ALERT-RESTORE-RTO-UNKNOWN")?.status, "ALERT");
  assert.ok(PROPOSED_SLO_ALERT_RULES.every((rule) => rule.status === "PROPOSED"));
});
