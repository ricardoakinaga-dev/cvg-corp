import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createOpenTelemetryRuntime, evaluateSlo, evaluateSloAlerts, OpsTelemetry, PROPOSED_SLO_ALERT_RULES, PROPOSED_SLO_DEFINITIONS } from "@cvg/ops";

test("redacted telemetry preserves safe diagnostics and removes sensitive metadata", () => {
  const telemetry = new OpsTelemetry();
  telemetry.log({
    timestamp: "2026-09-08T00:00:00.000Z",
    level: "error",
    event: "persistence.commit.failed",
    correlationId: "correlation",
    actorId: null,
    metadata: { databaseCode: "23505", constraint: "role_assignments_active_unique", password: "should-not-appear", prompt: "clinical text" }
  });
  assert.deepEqual(telemetry.logs[0]?.metadata, { databaseCode: "23505", constraint: "role_assignments_active_unique", password: "[REDACTED]", prompt: "[REDACTED]" });
});

test("telemetry exposes an OpenTelemetry-compatible span seam without sensitive attributes", async () => {
  const exported: string[] = [];
  const telemetry = new OpsTelemetry({ exporter: { export: (span) => { exported.push(span.name); } }, maxSpans: 1 });
  const span = telemetry.startSpan("GET /patients", { requestId: "request-1", prompt: "clinical text", organizationId: "org-1" });
  telemetry.finishSpan(span, 200);
  assert.equal(telemetry.spans[0]?.statusCode, 200);
  assert.equal(telemetry.spans[0]?.attributes.prompt, "[REDACTED]");
  assert.deepEqual(exported, ["GET /patients"]);
  const metrics = telemetry.metrics("memory");
  assert.equal(metrics.telemetry.dropped, 0);
});

test("OTLP runtime exports a real protobuf span only after redaction", async () => {
  const received: Array<{ url: string | undefined; contentType: string | undefined; body: Buffer }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ url: request.url, contentType: typeof request.headers["content-type"] === "string" ? request.headers["content-type"] : undefined, body: Buffer.concat(chunks) });
      response.statusCode = 200;
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const runtime = createOpenTelemetryRuntime({ serviceName: "cvg-otel-test", environment: { OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}` } });
  try {
    assert.equal(runtime.status, "READY");
    assert.ok(runtime.exporter);
    const telemetry = new OpsTelemetry({ exporter: runtime.exporter });
    const span = telemetry.startSpan("test.redacted", { prompt: "clinical text", requestId: "req-otel" });
    telemetry.finishSpan(span, 200);
    await runtime.shutdown();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const request = received[0];
  assert.ok(request);
  assert.equal(request.url, "/v1/traces");
  assert.equal(request.contentType, "application/x-protobuf");
  assert.ok(request.body.byteLength > 0);
  assert.equal(request.body.includes("clinical text"), false);
});

test("SLO catalog preserves proposed targets and evaluates a measured synthetic observation", () => {
  assert.equal(PROPOSED_SLO_DEFINITIONS.length, 8);
  assert.ok(PROPOSED_SLO_DEFINITIONS.every((definition) => definition.status === "PROPOSED"));
  const availability = PROPOSED_SLO_DEFINITIONS.find((definition) => definition.id === "API_AVAILABILITY");
  assert.ok(availability);
  const evaluation = evaluateSlo(availability, { value: 0.9995, sampleCount: 1000, evidence: "MEASURED", environment: "synthetic", observedAt: "2026-09-09T00:00:00.000Z" });
  assert.equal(evaluation.status, "PASS");
  assert.equal(evaluation.errorBudgetConsumedRatio, 0);
  assert.equal(evaluation.errorBudgetRemainingRatio, 1);
});

test("SLO evaluation fails closed for a breach, missing sample and unapproved target", () => {
  const availability = PROPOSED_SLO_DEFINITIONS.find((definition) => definition.id === "API_AVAILABILITY");
  const login = PROPOSED_SLO_DEFINITIONS.find((definition) => definition.id === "LOGIN_LATENCY");
  assert.ok(availability);
  assert.ok(login);
  const breach = evaluateSlo(availability, { value: 0.998, sampleCount: 1000, evidence: "MEASURED", environment: "synthetic", observedAt: "2026-09-09T00:00:00.000Z" });
  assert.equal(breach.status, "BREACH");
  assert.equal(breach.errorBudgetConsumedRatio, 1);
  assert.equal(breach.errorBudgetRemainingRatio, 0);
  assert.equal(evaluateSlo(availability, { value: 0.999, sampleCount: 0, evidence: "MEASURED", environment: "synthetic", observedAt: "2026-09-09T00:00:00.000Z" }).status, "NOT_RUN");
  assert.equal(evaluateSlo(availability, { value: 0.999, sampleCount: 1000, evidence: "NOT_RUN", environment: "production-like", observedAt: "2026-09-09T00:00:00.000Z" }).status, "NOT_RUN");
  assert.equal(evaluateSlo(login, { value: 200, sampleCount: 1000, evidence: "MEASURED", environment: "synthetic", observedAt: "2026-09-09T00:00:00.000Z" }).reason, "target_tbd");
});

test("SLO alerts are linked to runbooks and stay NOT_RUN without an evaluated signal", () => {
  const availability = PROPOSED_SLO_DEFINITIONS.find((definition) => definition.id === "API_AVAILABILITY");
  assert.ok(availability);
  const breach = evaluateSlo(availability, { value: 0.998, sampleCount: 1000, evidence: "MEASURED", environment: "synthetic", observedAt: "2026-09-09T00:00:00.000Z" });
  const alerts = evaluateSloAlerts([breach]);
  const breachAlert = alerts.find((alert) => alert.ruleId === "SLO-ALERT-API-AVAILABILITY-BREACH");
  const budgetAlert = alerts.find((alert) => alert.ruleId === "SLO-ALERT-API-AVAILABILITY-BUDGET");
  const outboxAlert = alerts.find((alert) => alert.ruleId === "SLO-ALERT-OUTBOX-BREACH");
  assert.equal(breachAlert?.status, "ALERT");
  assert.equal(breachAlert?.runbook, "docs/runbooks/database-incident.md");
  assert.equal(budgetAlert?.status, "ALERT");
  assert.equal(outboxAlert?.status, "NOT_RUN");
  assert.ok(PROPOSED_SLO_ALERT_RULES.every((rule) => rule.status === "PROPOSED"));
});
