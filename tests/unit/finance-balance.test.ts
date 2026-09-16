import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { computeFinancialBalance } from "@cvg/domain";
import { financialBalanceSchema, id, type Charge, type Payment } from "@cvg/contracts";

const identifier = () => id(randomUUID());
const observedAt = "2026-09-13T12:00:00.000Z";

function charge(status: Charge["status"], amountCents: number, currency = "BRL"): Charge {
  return { id: identifier(), organizationId: identifier(), unitId: identifier(), patientId: null, description: "synthetic charge", amountCents, currency, status, createdAt: observedAt };
}

function payment(chargeId: Charge["id"], status: Payment["status"], amountCents: number): Payment {
  return { id: identifier(), organizationId: identifier(), chargeId, amountCents, method: "PIX", externalReference: null, status, createdAt: observedAt };
}

function balance(charges: Charge[], payments: Payment[]) {
  return financialBalanceSchema.parse(computeFinancialBalance(charges, payments, { currency: "BRL", observedAt }));
}

test("a paid charge of 10000 cents never increases the open amount", () => {
  const paid = charge("PAID", 10_000);
  const result = balance([paid], [payment(paid.id, "SETTLED", 10_000)]);
  assert.equal(result.state, "PAID");
  assert.equal(result.pendingCents, 0);
  assert.equal(result.chargedCents, 10_000);
  assert.equal(result.settledPaymentCents, 10_000);
});

test("partial payment reports the exact remaining cents without double counting", () => {
  const partial = charge("PARTIALLY_PAID", 10_000);
  const result = balance([partial], [payment(partial.id, "SETTLED", 4_000)]);
  assert.equal(result.state, "PARTIALLY_PAID");
  assert.equal(result.pendingCents, 6_000);
  assert.equal(result.settledPaymentCents, 4_000);
});

test("an open charge reports the full amount and a refund stays explicitly unresolved", () => {
  const open = charge("OPEN", 10_000);
  assert.equal(balance([open], []).state, "OPEN");
  const refunded = charge("REFUNDED", 10_000);
  const result = balance([refunded], [payment(refunded.id, "REFUNDED", 10_000)]);
  assert.equal(result.state, "REQUIRES_POLICY");
  assert.equal(result.pendingCents, null);
  assert.deepEqual(result.refunds, { status: "UNRESOLVED", amountCents: null });
});

test("a refunded charge without an observed refunded payment is UNKNOWN, not a settled state", () => {
  const refunded = charge("REFUNDED", 10_000);
  const result = balance([refunded], [payment(refunded.id, "SETTLED", 10_000)]);
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.pendingCents, null);
});

test("multiple settled payments sum once and close the charge", () => {
  const target = charge("PARTIALLY_PAID", 10_000);
  const result = balance([target], [payment(target.id, "SETTLED", 4_000), payment(target.id, "SETTLED", 6_000)]);
  assert.equal(result.state, "PAID");
  assert.equal(result.pendingCents, 0);
  assert.equal(result.settledPaymentCents, 10_000);
});

test("payments from another charge or context do not leak into the balance", () => {
  const first = charge("OPEN", 5_000);
  const second = charge("PARTIALLY_PAID", 7_000);
  const result = balance([first, second], [payment(second.id, "SETTLED", 2_000), payment(identifier(), "SETTLED", 9_999)]);
  assert.equal(result.chargedCents, 12_000);
  assert.equal(result.settledPaymentCents, 2_000);
  assert.equal(result.pendingCents, 10_000);
  assert.equal(result.state, "PARTIALLY_PAID");
});

test("mixed currencies cannot be represented as a single settled balance", () => {
  const result = balance([charge("OPEN", 5_000, "BRL"), charge("OPEN", 5_000, "USD")], []);
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.pendingCents, null);
});
