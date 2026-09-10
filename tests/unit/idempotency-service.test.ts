import test from "node:test";
import assert from "node:assert/strict";
import { CvgStore, DomainError, newCommandReceipt, type IdempotencyInput } from "@cvg/domain";
import type { PostgresPersistence } from "@cvg/persistence";
import { DurableIdempotencyService } from "../../apps/api/src/application/idempotency-service.ts";

function input(store: CvgStore, body: unknown = { value: 1 }): IdempotencyInput {
  return {
    organizationId: store.bootstrapCredentials.organizationId,
    actorId: store.bootstrapCredentials.userId,
    sessionId: null,
    operation: "test.durable-command",
    key: "durable-command-test-1",
    resourceId: null,
    unitId: null,
    workspaceId: null,
    body
  };
}

function fakePersistence(
  claim: PostgresPersistence["claimCommandReceipt"],
  settle: PostgresPersistence["settleCommandReceipt"] = async () => undefined
): PostgresPersistence {
  return { claimCommandReceipt: claim, settleCommandReceipt: settle } as unknown as PostgresPersistence;
}

test("durable command executor claims before work and replays without invoking work", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const command = input(store);
  const receipt = newCommandReceipt(command);
  let workCalls = 0;
  const persistence = fakePersistence(async () => {
    if (receipt.status === "IN_FLIGHT") return { status: "CLAIMED", receipt };
    return { status: "REPLAY", receipt };
  });
  const executor = new DurableIdempotencyService(store, persistence);

  const first = await executor.execute(command, () => {
    workCalls += 1;
    return { operationId: "stable-operation-1" };
  });
  const replay = await executor.execute(command, () => {
    workCalls += 1;
    return { operationId: "must-not-run" };
  });

  assert.equal(workCalls, 1);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.value, first.value);
  assert.equal(replay.receipt.id, first.receipt.id);
});

test("durable command executor rejects a concurrent claim before the callback", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const command = input(store);
  const receipt = newCommandReceipt(command);
  let workCalls = 0;
  const persistence = fakePersistence(async () => ({ status: "IN_FLIGHT", receipt }));
  const executor = new DurableIdempotencyService(store, persistence);

  await assert.rejects(
    () => executor.execute(command, () => {
      workCalls += 1;
      return true;
    }),
    (error: unknown) => error instanceof DomainError && error.code === "OUTCOME_UNKNOWN"
  );
  assert.equal(workCalls, 0);
});

test("durable command executor rejects a reused key with a different body", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const command = input(store);
  const receipt = newCommandReceipt(command);
  let claimCalls = 0;
  let workCalls = 0;
  const persistence = fakePersistence(async () => {
    claimCalls += 1;
    return claimCalls === 1 ? { status: "CLAIMED", receipt } : { status: "CONFLICT", receipt };
  });
  const executor = new DurableIdempotencyService(store, persistence);

  await executor.execute(command, () => {
    workCalls += 1;
    return true;
  });
  await assert.rejects(
    () => executor.execute({ ...command, body: { value: 2 } }, () => {
      workCalls += 1;
      return false;
    }),
    (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT"
  );
  assert.equal(workCalls, 1);
});

test("durable command executor settles a failed claim and preserves the original error", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const command = input(store);
  const receipt = newCommandReceipt(command);
  let settled: string | null = null;
  const persistence = fakePersistence(
    async () => ({ status: "CLAIMED", receipt }),
    async (value) => { settled = value.status; }
  );
  const executor = new DurableIdempotencyService(store, persistence);

  await assert.rejects(
    () => executor.execute(command, async () => { throw new DomainError("INVALID_STATE", "synthetic failure", 409); }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_STATE"
  );
  assert.equal(receipt.status, "FAILED");
  assert.equal(settled, "FAILED");
});
