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
