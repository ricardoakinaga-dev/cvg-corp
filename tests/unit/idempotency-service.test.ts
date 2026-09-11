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

test("external command work does not hold the organization coordinator while the provider is pending", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const executor = new DurableIdempotencyService(store, null);
  let releaseRemote!: () => void;
  const remotePending = new Promise<void>((resolve) => { releaseRemote = resolve; });
  let localFinished = false;
  const remote = executor.execute({ ...input(store), key: "remote-command-test-1" }, async () => {
    await remotePending;
    return { remote: true };
  }, { external: true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const local = await executor.execute({ ...input(store), key: "local-command-test-1" }, () => {
    localFinished = true;
    return { local: true };
  });
  assert.equal(localFinished, true);
  assert.deepEqual(local.value, { local: true });
  releaseRemote();
  await remote;
});

test("an external idempotency replay returns the stored result without a second remote call", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const executor = new DurableIdempotencyService(store, null);
  let remoteCalls = 0;
  const command = { ...input(store), key: "remote-replay-test-1" };
  const first = await executor.execute(command, async () => {
    remoteCalls += 1;
    return { providerRequestId: "provider-1" };
  }, { external: true });
  const replay = await executor.execute(command, async () => {
    remoteCalls += 1;
    return { providerRequestId: "provider-2" };
  }, { external: true });
  assert.equal(remoteCalls, 1);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.value, first.value);
});

test("concurrent in-memory external claims admit one provider call", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const executor = new DurableIdempotencyService(store, null);
  let remoteCalls = 0;
  const command = { ...input(store), key: "remote-concurrent-test-1" };
  const first = executor.execute(command, async () => {
    remoteCalls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    return { providerRequestId: "provider-concurrent-1" };
  }, { external: true });
  const second = executor.execute(command, async () => {
    remoteCalls += 1;
    return { providerRequestId: "provider-concurrent-2" };
  }, { external: true });
  const results = await Promise.allSettled([first, second]);
  assert.equal(remoteCalls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
  assert.ok(rejection instanceof DomainError);
  assert.equal(rejection.code, "OUTCOME_UNKNOWN");
});

test("a final commit failure can durably settle a successful claim as outcome unknown", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const command = input(store, { value: "final-commit-failure" });
  const receipt = newCommandReceipt(command);
  let settled: string | null = null;
  let durableStatus: "IN_FLIGHT" | "OUTCOME_UNKNOWN" = "IN_FLIGHT";
  const persistence = fakePersistence(
    async () => durableStatus === "IN_FLIGHT" ? { status: "CLAIMED", receipt } : { status: "OUTCOME_UNKNOWN", receipt: { ...receipt, status: durableStatus, result: null, completedAt: new Date().toISOString() } },
    async (value) => { settled = value.status; durableStatus = "OUTCOME_UNKNOWN"; }
  );
  const executor = new DurableIdempotencyService(store, persistence);
  const result = await executor.execute(command, () => ({ createdId: "local-before-commit" }));
  assert.equal(result.receipt.status, "SUCCEEDED");
  const unknown = await executor.markOutcomeUnknown(result.receipt);
  assert.equal(unknown.status, "OUTCOME_UNKNOWN");
  assert.equal(unknown.result, null);
  assert.equal(settled, "OUTCOME_UNKNOWN");
  await assert.rejects(
    () => executor.execute(command, () => ({ createdId: "must-not-retry" })),
    (error: unknown) => error instanceof DomainError && error.code === "OUTCOME_UNKNOWN"
  );
});
