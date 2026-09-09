import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSlo, evaluateSloAlerts, OpsTelemetry, PROPOSED_SLO_ALERT_RULES, PROPOSED_SLO_DEFINITIONS } from "@cvg/ops";

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
