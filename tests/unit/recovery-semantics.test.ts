import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { checkpointDigest } from "@cvg/agent-session";
import { id, type OpaqueId } from "@cvg/contracts";
import { CvgStore, digest, serializeSnapshot } from "@cvg/domain";
import { assertRestorableRecoveryBundle, createRecoveryBundleManifest, encryptRecoveryBundle, PersistenceCorruptionError, PersistenceUnavailableError, validateRecoveryBundle, verifyOperationalBackupDirectory, type DurableAgentCheckpointRecord, type DurableAgentLeaseRecord, type DurableAgentSessionRecord, type DurableAgentTurnRecord, type DurableExternalEffectRecord, type DurableInboxRecord, type DurableOutboxRecord, type DurableRecoveryBundle, type DurableUsageRecord } from "@cvg/persistence";

type RuntimeFixture = {
  session: Record<string, unknown>;
  turns: Array<Record<string, unknown>>;
  checkpoints: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
};

function contentDigest(record: Record<string, unknown>): string {
  const { recordDigest: _recordDigest, checkpointId: _checkpointId, ...content } = record;
  return digest(content);
}

function withDigest<T extends Record<string, unknown>>(record: T): T & { recordDigest: string } {
  return { ...record, recordDigest: contentDigest(record) };
}

function usageRecord(organizationId: OpaqueId, usageId: OpaqueId = id(randomUUID())): DurableUsageRecord {
  const input = { id: usageId, organizationId, reservationId: null, providerRequestId: null, idempotencyKey: `recovery-usage-${usageId}`, usageKind: "TOKENS", reservedUnits: 4, consumedUnits: 4, status: "SETTLED" as const, record: { synthetic: true }, createdAt: "2026-09-20T00:00:01.000Z" };
  return { ...input, recordDigest: digest({ organizationId, reservationId: null, providerRequestId: null, idempotencyKey: input.idempotencyKey, usageKind: input.usageKind, reservedUnits: input.reservedUnits, consumedUnits: input.consumedUnits, status: input.status, record: input.record }) };
}

function fixture(): { store: CvgStore; organizationId: OpaqueId; runtime: RuntimeFixture; usage: DurableUsageRecord } {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const organizationId = store.bootstrapCredentials.organizationId;
  const sessionId = randomUUID();
  const checkpointPayload = { step: 1 };
  const usage = usageRecord(organizationId);
  const session = withDigest({ sessionId, organizationId, actorId: store.bootstrapCredentials.userId, unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "AUD22-002", status: "ACTIVE", runState: "RUNNING", fence: 2, checkpointDigest: checkpointDigest(checkpointPayload, 1), createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:10.000Z", expiresAt: "2026-09-20T01:00:00.000Z" });
  const firstTurn = withDigest({ turnId: randomUUID(), sessionId, organizationId, sequence: 1, status: "COMPLETED", inputDigest: "a".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: usage.id, provenance: { provider: "fixture" }, startedAt: "2026-09-20T00:00:02.000Z", completedAt: "2026-09-20T00:00:03.000Z", fence: 1 });
  const secondTurn = withDigest({ ...firstTurn, turnId: randomUUID(), sequence: 2, usageRecordId: null, startedAt: "2026-09-20T00:00:04.000Z", completedAt: "2026-09-20T00:00:05.000Z", fence: 2 });
  const checkpoint = withDigest({ checkpointId: "1", sessionId, organizationId, sequence: 1, schemaVersion: 1, digest: checkpointDigest(checkpointPayload, 1), payload: checkpointPayload, fence: 1, createdAt: "2026-09-20T00:00:06.000Z" });
  const lease = withDigest({ sessionId, organizationId, ownerId: "fixture-owner", fence: 2, acquiredAt: "2026-09-20T00:00:07.000Z", expiresAt: "2026-09-20T00:10:07.000Z" });
  return { store, organizationId, runtime: { session, turns: [firstTurn, secondTurn], checkpoints: [checkpoint], leases: [lease] }, usage };
}

function bundleFor(store: CvgStore, organizationId: OpaqueId, runtime: RuntimeFixture, usageRecords: DurableUsageRecord[]): DurableRecoveryBundle {
  const snapshot = store.snapshot();
  const recoveryData = { revision: 7n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [], usageRecords, inboxRecords: [], externalEffects: [], agentSessions: [runtime.session], agentTurns: runtime.turns, agentCheckpoints: runtime.checkpoints, agentLeases: runtime.leases };
  const manifest = createRecoveryBundleManifest({
    organizationId,
    revision: recoveryData.revision,
    snapshotDigest: recoveryData.snapshotDigest,
    eventId: recoveryData.eventId,
    migrationFingerprint: digest([{ version: "044_agent_restore_authority_and_lease_terminality", checksum: "synthetic-checksum" }]),
    outboxRecords: recoveryData.outboxRecords,
    usageRecords: recoveryData.usageRecords,
    inboxRecords: recoveryData.inboxRecords,
    externalEffects: recoveryData.externalEffects,
    agentSessions: recoveryData.agentSessions as unknown as DurableAgentSessionRecord[],
    agentTurns: recoveryData.agentTurns as unknown as DurableAgentTurnRecord[],
    agentCheckpoints: recoveryData.agentCheckpoints as unknown as DurableAgentCheckpointRecord[],
    agentLeases: recoveryData.agentLeases as unknown as DurableAgentLeaseRecord[]
  });
  return { ...recoveryData, manifest } as unknown as DurableRecoveryBundle;
}

test("AUD22-002 accepts a current recovery bundle with a compatible usage reference", () => {
  const { store, organizationId, runtime, usage } = fixture();
  const bundle = bundleFor(store, organizationId, runtime, [usage]);
  assert.doesNotThrow(() => validateRecoveryBundle(bundle));
  assert.doesNotThrow(() => assertRestorableRecoveryBundle(bundle));
  const legacy = { ...bundle, agentSessions: undefined, agentTurns: undefined, agentCheckpoints: undefined, agentLeases: undefined, manifest: createRecoveryBundleManifest({
    organizationId,
    revision: bundle.revision,
    snapshotDigest: bundle.snapshotDigest,
    eventId: bundle.eventId,
    outboxRecords: bundle.outboxRecords,
    usageRecords: bundle.usageRecords,
    inboxRecords: bundle.inboxRecords,
    externalEffects: bundle.externalEffects,
    migrationFingerprint: bundle.manifest.migrationFingerprint
  }) } as unknown as DurableRecoveryBundle;
  assert.throws(() => assertRestorableRecoveryBundle(legacy), /predates agent runtime state/);
});

test("recovery validation binds non-empty outbox, inbox and external-effect ledgers", () => {
  const { store, organizationId, usage } = fixture();
  const timestamp = "2026-09-20T00:00:00.000Z";
  const outboxInput = {
    id: id(randomUUID()), organizationId, eventType: "fixture.event", aggregateId: id(randomUUID()), payload: { source: "recovery-ledger" },
    status: "PENDING" as const, attempts: 0, availableAt: timestamp, claimedBy: null, leaseUntil: null, fenceToken: 0n, lastError: null, createdAt: timestamp, processedAt: null
  };
  const outbox: DurableOutboxRecord = {
    ...outboxInput,
    recordDigest: digest({ organizationId, eventType: outboxInput.eventType, aggregateId: outboxInput.aggregateId, payload: outboxInput.payload })
  };
  const inboxInput = {
    id: id(randomUUID()), organizationId, consumer: "fixture-consumer", provider: "fixture-provider", externalEventId: "fixture-external-1", eventType: "fixture.received",
    schemaVersion: 1, signatureAlgorithm: "HMAC-SHA256" as const, signatureKeyRef: "fixture-inbox-key", signature: "a".repeat(64), payload: { value: "received" },
    status: "RECEIVED" as const, conflictDigest: null, lastError: null, receivedAt: timestamp, processedAt: null, lastSeenAt: timestamp
  };
  const inbox: DurableInboxRecord = {
    ...inboxInput,
    recordDigest: digest({ organizationId, consumer: inboxInput.consumer, provider: inboxInput.provider, externalEventId: inboxInput.externalEventId, eventType: inboxInput.eventType, schemaVersion: inboxInput.schemaVersion, signatureAlgorithm: inboxInput.signatureAlgorithm, signatureKeyRef: inboxInput.signatureKeyRef, payload: inboxInput.payload })
  };
  const externalInput = {
    id: id(randomUUID()), organizationId, outboxId: outbox.id, integrationId: "fixture-integration", idempotencyKey: "fixture-effect-1", request: { channel: "synthetic" },
    status: "ADMISSION_PENDING" as const, attempts: 0, claimedBy: null, leaseUntil: null, fenceToken: 0n, providerRequestId: null, response: null, lastError: null,
    outcomeDigest: null, reconciliationSource: null, reconciledAt: null, createdAt: timestamp, updatedAt: timestamp
  };
  const externalEffect: DurableExternalEffectRecord = {
    ...externalInput,
    requestDigest: digest({ organizationId, outboxId: externalInput.outboxId, integrationId: externalInput.integrationId, idempotencyKey: externalInput.idempotencyKey, request: externalInput.request })
  };
  const snapshot = store.snapshot();
  const recoveryData = {
    revision: 7n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(),
    outboxRecords: [outbox], usageRecords: [usage], inboxRecords: [inbox], externalEffects: [externalEffect]
  };
  const manifest = createRecoveryBundleManifest({ organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "048_aud27_migration_rls", checksum: "synthetic-checksum" }]) });
  assert.doesNotThrow(() => validateRecoveryBundle({ ...recoveryData, manifest }));
});

test("recovery validation preserves complete authentication security state", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const organizationId = store.bootstrapCredentials.organizationId;
  store.createSession(store.bootstrapCredentials.userId, digest("recovery-complete-auth-session"), "synthetic-csrf", 60);
  store.createAuthChallenge("MFA", store.bootstrapCredentials.userId, digest("recovery-complete-auth-challenge"), 60, 3);
  const snapshot = store.snapshot();
  const timestamp = "2026-09-20T00:00:00.000Z";
  const userSecurity = snapshot.users[0]!.security;
  userSecurity.passwordExpiresAt = "2026-10-20T00:00:00.000Z";
  userSecurity.lockedUntil = "2026-09-20T00:05:00.000Z";
  userSecurity.mfaRequired = true;
  userSecurity.mfaSecretRef = "synthetic-mfa-secret";
  userSecurity.recoveryCodeDigests = [digest("recovery-code")];
  userSecurity.recoveryCodesIssuedAt = timestamp;
  snapshot.sessions[0]!.revokedAt = null;
  snapshot.sessions[0]!.mfaVerifiedAt = timestamp;
  snapshot.authChallenges[0]!.consumedAt = timestamp;
  const recoveryData = {
    revision: 7n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const migrationFingerprint = digest([{ version: "048_aud27_migration_rls", checksum: "synthetic-checksum" }]);
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({
      organizationId,
      ...recoveryData,
      migrationFingerprint,
      createdAt: timestamp
    })
  };
  assert.doesNotThrow(() => validateRecoveryBundle(bundle, {
    expectedMigrationFingerprint: migrationFingerprint,
    minimumRevision: 7n,
    maxAgeMs: 86_400_000,
    now: "2026-09-20T12:00:00.000Z"
  }));
  assert.throws(() => validateRecoveryBundle(bundle, { expectedMigrationFingerprint: "invalid" }), /expected recovery migration fingerprint is invalid/);
  assert.throws(() => validateRecoveryBundle(bundle, { minimumRevision: -1n }), /minimum recovery revision is invalid/);
  assert.throws(() => validateRecoveryBundle(bundle, { maxAgeMs: -1 }), /maximum recovery bundle age is invalid/);
});

test("operational backup verification fails closed when its directory is absent", async () => {
  await assert.rejects(
    () => verifyOperationalBackupDirectory({ directory: `/tmp/cvg-missing-backups-${randomUUID()}`, resolveKey: () => new Uint8Array(32) }),
    (error: unknown) => error instanceof PersistenceUnavailableError && error.message.includes("no operational backup artifacts")
  );
});

test("AUD22-002 rejects rehashed semantic known-bads instead of trusting old digests", () => {
  const cases: Array<{ name: string; mutate: (base: ReturnType<typeof fixture>) => void; message: string }> = [
    {
      name: "dangling_usage_reference",
      mutate: ({ runtime }) => { runtime.turns[0] = withDigest({ ...runtime.turns[0], usageRecordId: randomUUID() }); },
      message: "usageRecordId"
    },
    {
      name: "cross_tenant_usage_reference",
      mutate: ({ runtime, usage }) => { usage.organizationId = id(randomUUID()); usage.recordDigest = digest({ organizationId: usage.organizationId, reservationId: usage.reservationId, providerRequestId: usage.providerRequestId, idempotencyKey: usage.idempotencyKey, usageKind: usage.usageKind, reservedUnits: usage.reservedUnits, consumedUnits: usage.consumedUnits, status: usage.status, record: usage.record }); runtime.turns[0] = withDigest({ ...runtime.turns[0], usageRecordId: usage.id }); },
      message: "different organization scope"
    },
    {
      name: "zero_fence_lease",
      mutate: ({ runtime }) => { runtime.leases[0] = withDigest({ ...runtime.leases[0], fence: 0 }); },
      message: "agentLeases[0].fence"
    },
    {
      name: "lease_session_mismatch",
      mutate: ({ runtime }) => { runtime.leases[0] = withDigest({ ...runtime.leases[0], fence: 1 }); },
      message: "not the authoritative session fence"
    },
    {
      name: "lease_terminal_session",
      mutate: ({ runtime }) => { runtime.session = withDigest({ ...runtime.session, status: "COMPLETED", runState: "COMPLETED" }); },
      message: "terminal session"
    },
    {
      name: "inverted_lease_timestamp",
      mutate: ({ runtime }) => { runtime.leases[0] = withDigest({ ...runtime.leases[0], expiresAt: "2026-09-20T00:00:06.000Z" }); },
      message: "expiresAt precedes acquiredAt"
    },
    {
      name: "invalid_unit_workspace_scope",
      mutate: ({ runtime }) => { runtime.session = withDigest({ ...runtime.session, unitId: randomUUID(), workspaceId: null }); },
      message: "incomplete unit/workspace scope"
    },
    {
      name: "turn_sequence_gap",
      mutate: ({ runtime }) => { runtime.turns[1] = withDigest({ ...runtime.turns[1], sequence: 3 }); },
      message: "sequence is not contiguous"
    },
    {
      name: "checkpoint_sequence_gap",
      mutate: ({ runtime }) => {
        const checkpoint = withDigest({ ...runtime.checkpoints[0], sequence: 3 });
        runtime.checkpoints[0] = checkpoint;
        runtime.session = withDigest({ ...runtime.session, checkpointDigest: String((checkpoint as Record<string, unknown>).digest) });
      },
      message: "sequence is not contiguous"
    },
    {
      name: "future_checkpoint_fence",
      mutate: ({ runtime }) => { runtime.checkpoints[0] = withDigest({ ...runtime.checkpoints[0], fence: 3 }); },
      message: "newer than its authoritative session fence"
    }
  ];

  for (const candidate of cases) {
    const state = fixture();
    candidate.mutate(state);
    const bad = bundleFor(state.store, state.organizationId, state.runtime, candidate.name === "cross_tenant_usage_reference" ? [state.usage] : candidate.name === "dangling_usage_reference" ? [] : [state.usage]);
    assert.throws(() => validateRecoveryBundle(bad), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes(candidate.message), candidate.name);
    assert.throws(() => encryptRecoveryBundle(bad, randomBytes(32), "synthetic-recovery-key"), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes(candidate.message), `${candidate.name} encryption boundary`);
  }
});
