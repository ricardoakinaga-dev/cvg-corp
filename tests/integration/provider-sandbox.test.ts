import assert from "node:assert/strict";
import test from "node:test";
import { runProviderSandboxVerification } from "../../scripts/verify-provider-sandbox.ts";

test("messaging provider crosses the real loopback HTTP boundary", async () => {
  const report = await runProviderSandboxVerification();
  assert.equal(report.verification, "PASS");
  assert.equal(report.boundary, "LOOPBACK_HTTP");
  assert.equal(report.externalProvider, "NOT_RUN");
  assert.equal(report.delivered, true);
  assert.equal(report.replayIdempotent, true);
  assert.equal(report.unknownReconciled, true);
  assert.equal(report.validCallbackAccepted, true);
  assert.equal(report.invalidCallbackDenied, true);
  assert.equal(report.stats.sendRequests, 4);
  assert.equal(report.stats.queryRequests, 2);
  assert.equal(report.stats.callbackRequests, 2);
  assert.equal(report.stats.simulatedLostResponses, 1);
});
