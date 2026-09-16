import test from "node:test";
import assert from "node:assert/strict";
import { CvgStore, DomainError } from "@cvg/domain";
import { GovernedHarness } from "@cvg/harness";

function context(store: CvgStore, userId = store.bootstrapCredentials.userId) {
  const option = store.contextOptions(userId)[0];
  assert.ok(option);
  const session = store.createSession(userId, "budget-test-token", "budget-test-csrf", 60);
  return store.resolveContext(userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", "budget-test", null, null, session.id);
}

test("budget reservations are atomic per scope/category, expire and never double-spend", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  assert.ok(veterinarianId);
  const ctx = context(store, veterinarianId);
  const harness = new GovernedHarness(store, { caps: { TOKENS: 10_000 }, ttlMs: 1_000 });
  const copilotSession = harness.createSession(ctx, { purpose: "SUMMARY", patientId: null, encounterId: null });
  const reserve = (units: number) => store.reserveBudget(ctx, { sessionId: copilotSession.id, category: "TOKENS", units, cap: 10_000, ttlMs: 1_000 });

  const first = reserve(6_000);
  assert.equal(first.status, "RESERVED");
  assert.throws(
    () => reserve(6_000),
    (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED" && (error.details?.available as number) === 4_000
  );
  const settled = store.settleBudgetReservation(first.id, 2_000);
  assert.equal(settled.reservation.status, "RELEASED");
  assert.equal(settled.reservation.consumedUnits, 2_000);
  assert.equal(settled.overageUnits, 0);

  const second = reserve(8_000);
  assert.equal(second.status, "RESERVED");
  assert.throws(() => reserve(1), (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED");

  const late = store.settleBudgetReservation(first.id, 9_999);
  assert.equal(late.late, true);
  assert.equal(late.overageUnits, 3_999);
  // E02: actual usage is not capped at the old consumed value of 6_000.
  assert.equal(late.reservation.consumedUnits, 9_999);
  assert.notEqual(late.reservation.consumedUnits, 6_000);
  assert.equal(late.reservation.status, "EXHAUSTED");
  const duplicate = store.settleBudgetReservation(first.id, 9_999);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reservation.consumedUnits, 9_999);
  assert.throws(() => reserve(2), (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED");
  assert.equal(store.settleBudgetReservation(second.id, 0).reservation.consumedUnits, 0);

  const media = store.reserveBudget(ctx, { sessionId: copilotSession.id, category: "MEDIA", units: 20, cap: 20, ttlMs: 1_000 });
  assert.equal(media.category, "MEDIA");
  assert.throws(
    () => store.reserveBudget(ctx, { sessionId: copilotSession.id, category: "MEDIA", units: 1, cap: 20, ttlMs: 1_000 }),
    (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED"
  );
  assert.equal(store.settleBudgetReservation(media.id, 20).reservation.status, "EXHAUSTED");

  const expiring = store.reserveBudget(ctx, { sessionId: copilotSession.id, category: "TOKENS", units: 1_000, cap: 11_000, ttlMs: 1_000 });
  assert.equal(store.expireBudgetReservations(1_000, Date.now() + 2_000) >= 1, true);
  assert.equal(store.budgetReservations.get(expiring.id)?.status, "RELEASED");
  const afterExpiry = store.settleBudgetReservation(expiring.id, 900);
  assert.equal(afterExpiry.reservation.consumedUnits, 900);
  assert.equal(afterExpiry.reservation.status, "RELEASED");
});

test("harness denies before dispatch when the atomic reservation cannot cover the turn", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  assert.ok(veterinarianId);
  const ctx = context(store, veterinarianId);
  const harness = new GovernedHarness(store, { caps: { TOKENS: 10 }, ttlMs: 60_000 });
  await assert.rejects(
    () => harness.executeTurn(ctx, { sessionId: null, prompt: "um pedido suficientemente longo para estourar o teto", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "budget-denied" }),
    (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED" && typeof (error.details?.turnId as string) === "string"
  );
  const denied = [...store.aiTurns.values()].find((turn) => turn.status === "DENIED");
  assert.ok(denied);
  assert.match(denied!.response ?? "", /Budget insuficiente antes do turno/);
  assert.equal([...store.budgetReservations.values()].some((reservation) => reservation.status === "RESERVED"), false);
});

test("late absolute usage reconciles above an exhausted hold and unknown usage remains committed", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  assert.ok(veterinarianId);
  const ctx = context(store, veterinarianId);
  const harness = new GovernedHarness(store);
  const copilotSession = harness.createSession(ctx, { purpose: "SUMMARY", patientId: null, encounterId: null });
  const first = store.reserveBudget(ctx, { sessionId: copilotSession.id, category: "MEDIA", units: 100, cap: 1_000, ttlMs: 60_000 });
  assert.equal(store.settleBudgetReservation(first.id, 100).reservation.status, "EXHAUSTED");
  const late = store.settleBudgetReservation(first.id, 900);
  assert.equal(late.overageUnits, 800);
  assert.equal(late.reservation.consumedUnits, 900);
  assert.equal(store.settleBudgetReservation(first.id, 900).duplicate, true);
  assert.equal([...store.auditRecords.values()].some((record) => record.action === "ai.budget.settlement" && record.resourceId === first.id && record.metadata.actualUnits === 900), true);

  const unknown = store.reserveBudget(ctx, { sessionId: copilotSession.id, category: "MEDIA", units: 100, cap: 1_000, ttlMs: 60_000 });
  const unknownSettlement = store.settleBudgetReservation(unknown.id, null);
  assert.equal(unknownSettlement.unknown, true);
  assert.equal(unknownSettlement.reservation.consumedUnits, 100);
  assert.throws(() => store.reserveBudget(ctx, { sessionId: copilotSession.id, category: "MEDIA", units: 1, cap: 1_000, ttlMs: 60_000 }), (error: unknown) => error instanceof DomainError && error.code === "BUDGET_EXCEEDED");
});

test("harness settles a reserved turn with usage instead of releasing it as free", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  assert.ok(veterinarianId);
  const ctx = context(store, veterinarianId);
  const harness = new GovernedHarness(store);
  const result = await harness.executeTurn(ctx, { sessionId: null, prompt: "resuma a fila desta manhã", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "budget-settle" });
  assert.equal(result.turn.status, "COMPLETED");
  const reservations = [...store.budgetReservations.values()].filter((reservation) => reservation.sessionId === result.session.id);
  assert.equal(reservations.length, 1);
  assert.ok((reservations[0]!.consumedUnits ?? 0) > 0);
  assert.ok(reservations[0]!.consumedUnits <= reservations[0]!.reservedUnits);
});
