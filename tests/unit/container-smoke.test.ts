import test from "node:test";
import assert from "node:assert/strict";
import { cookieFlagsValid, providerScenarioValid, securityHeadersValid } from "../../scripts/verify-container-smoke.ts";

test("container smoke rejects weak edge headers", () => {
  const headers = new Headers({ "strict-transport-security": "max-age=10", "content-security-policy": "default-src 'self'", "x-content-type-options": "nosniff", "referrer-policy": "origin", "permissions-policy": "camera=()", "x-frame-options": "SAMEORIGIN" });
  const failures = securityHeadersValid(headers);
  assert.ok(failures.some((failure) => failure.includes("strict-transport-security")));
  assert.ok(failures.some((failure) => failure.includes("x-frame-options")));
});

test("container smoke requires Secure, HttpOnly and strict SameSite on session cookies", () => {
  assert.deepEqual(cookieFlagsValid(["cvg_session=token; Path=/"]), ["session cookie is missing Secure", "session cookie is missing HttpOnly", "session cookie is missing SameSite=Strict"]);
  assert.deepEqual(cookieFlagsValid(["cvg_session=token; Path=/; Secure; HttpOnly; SameSite=Strict"]), []);
  assert.deepEqual(cookieFlagsValid(["cvg_csrf=token; Path=/"]), ["CSRF cookie is missing Secure", "CSRF cookie is missing SameSite=Strict"]);
  assert.deepEqual(cookieFlagsValid(["cvg_csrf=token; Path=/; Secure; SameSite=Strict"]), []);
  assert.deepEqual(cookieFlagsValid(["__cvg_require_session__"]), ["authenticated smoke did not receive a cvg_session cookie"]);
});

test("container smoke requires a durable provider receipt, effect and audit outcome", () => {
  assert.equal(providerScenarioValid({ data: { receiptId: "receipt-1", effectId: "effect-1", auditRecordId: "audit-1", outboxId: "outbox-1", reconciliationId: "reconcile-1", outboxDurable: true, replayIdempotent: true, outcome: "RECONCILED" } }), true);
  assert.equal(providerScenarioValid({ data: { receiptId: "receipt-1", effectId: "effect-1", auditRecordId: "audit-1", outcome: "ACCEPTED" } }), false);
  assert.equal(providerScenarioValid({ data: { receiptId: "receipt-1", effectId: "effect-1", outcome: "DELIVERED" } }), false);
});
