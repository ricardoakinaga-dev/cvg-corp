import test from "node:test";
import assert from "node:assert/strict";
import { OpsTelemetry } from "@cvg/ops";

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
