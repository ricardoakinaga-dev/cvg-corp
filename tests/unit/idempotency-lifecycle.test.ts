import test from "node:test";
import assert from "node:assert/strict";
import { id } from "@cvg/contracts";
import { CvgStore, commandReceiptLookups, DomainError, idempotent, idempotencyLookup, legacyIdempotencyLookup, newCommandReceipt, type IdempotencyInput } from "@cvg/domain";

const organizationId = id("00000000-0000-4000-8000-000000000010");
const actorId = id("00000000-0000-4000-8000-000000000001");

function input(overrides: Partial<IdempotencyInput> = {}): IdempotencyInput {
  return {
    organizationId,
    actorId,
    sessionId: id("00000000-0000-4000-8000-0000000000a1"),
    operation: "test.command",
    key: "stable-key",
    resourceId: null,
    unitId: null,
    workspaceId: null,
    body: { value: 1 },
    ...overrides
  };
}

test("stable identity excludes the session and keeps a legacy lookup for old receipts", () => {
  const first = input();
  const second = input({ sessionId: id("00000000-0000-4000-8000-0000000000b2") });
  assert.equal(idempotencyLookup(first), idempotencyLookup(second));
  assert.notEqual(legacyIdempotencyLookup(first), legacyIdempotencyLookup(second));
  assert.equal(commandReceiptLookups(first).length, 2);
  assert.equal(commandReceiptLookups(input({ resourceId: id("00000000-0000-4000-8000-0000000000c3") })).length, 2);
});

test("a re-login session replays the original receipt instead of a second effect", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  let calls = 0;
  const first = idempotent(store, input(), () => { calls += 1; return { created: true }; });
  assert.equal(first.replayed, false);
  const replay = idempotent(store, input({ sessionId: id("00000000-0000-4000-8000-0000000000b2") }), () => { calls += 1; return { created: "again" }; });
  assert.equal(calls, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.id, first.receipt.id);
  assert.deepEqual(replay.value, { created: true });
});

test("an expired pre-dispatch claim becomes CLAIM_ABANDONED and never silently retries", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const seeded = newCommandReceipt(input());
  store.setCommandReceipt({ ...seeded, claimExpiresAt: new Date(Date.now() - 1_000).toISOString(), dispatchState: "NOT_STARTED" });
  assert.throws(
    () => idempotent(store, input(), () => ({ created: true })),
    (error: unknown) => error instanceof DomainError && error.code === "CLAIM_ABANDONED" && error.details?.failurePhase === "PRE_DISPATCH"
  );
  assert.equal(store.commandReceipts.get(idempotencyLookup(input()))?.status, "FAILED");
  assert.throws(
    () => idempotent(store, input(), () => ({ created: true })),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT" && error.details?.failurePhase === "PRE_DISPATCH"
  );
  const fresh = idempotent(store, input({ key: "new-intent" }), () => ({ created: true }));
  assert.equal(fresh.replayed, false);
});

test("an expired post-dispatch claim stays OUTCOME_UNKNOWN under every retry", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const seeded = newCommandReceipt(input());
  store.setCommandReceipt({ ...seeded, claimExpiresAt: new Date(Date.now() - 1_000).toISOString(), dispatchState: "DISPATCHED" });
  assert.throws(
    () => idempotent(store, input(), () => ({ created: true })),
    (error: unknown) => error instanceof DomainError && error.code === "OUTCOME_UNKNOWN" && error.details?.failurePhase === "POST_DISPATCH"
  );
  assert.throws(
    () => idempotent(store, input(), () => ({ created: true })),
    (error: unknown) => error instanceof DomainError && error.code === "OUTCOME_UNKNOWN"
  );
});

test("a legacy claim without a lease deadline is reconciled instead of remaining stuck", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const seeded = newCommandReceipt(input({ key: "legacy-missing-deadline" }));
  store.setCommandReceipt({ ...seeded, claimExpiresAt: null, dispatchState: "NOT_STARTED" });
  assert.throws(
    () => idempotent(store, input({ key: "legacy-missing-deadline" }), () => ({ created: true })),
    (error: unknown) => error instanceof DomainError && error.code === "CLAIM_ABANDONED" && error.details?.failurePhase === "PRE_DISPATCH"
  );
  assert.equal(store.commandReceipts.get(idempotencyLookup(input({ key: "legacy-missing-deadline" })))?.failurePhase, "PRE_DISPATCH");
});

test("a live claim reports ADMISSION_IN_PROGRESS with its lease deadline", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const live = newCommandReceipt(input());
  store.setCommandReceipt(live);
  assert.throws(
    () => idempotent(store, input(), () => ({ created: true })),
    (error: unknown) => error instanceof DomainError && error.code === "ADMISSION_IN_PROGRESS" && error.details?.claimExpiresAt === live.claimExpiresAt
  );
});
