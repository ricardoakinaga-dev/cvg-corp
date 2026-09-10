import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { AiSession, AnimalPatient, Appointment, AuditRecord, Bed, Charge, ClinicalDocument, CommunicationMessage, CommandReceipt, CvgContext, DiagnosticRequest, DiagnosticResult, Encounter, Guardian, HospitalEpisode, KnowledgeDocument, LedgerEntry, Lot, MedicationOrder, OpaqueId, Payment, Product, QueueEntry, Specimen, StockLocation } from "@cvg/contracts";
import { id } from "@cvg/contracts";
import { auditRecordHash, digest, idempotencyLookup, newCommandReceipt, now, parseSnapshot, serializeSnapshot, type IdempotencyInput, type StoreSnapshot } from "@cvg/domain";

const LOCK_KEY = "cvg-corp:canonical-state:v1";

export class PersistenceUnavailableError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceUnavailableError";
    this.cause = cause;
  }
}

export class PersistenceConflictError extends Error {
  public readonly expectedRevision: bigint | null;
  public readonly actualRevision: bigint;

  constructor(expectedRevision: bigint | null, actualRevision: bigint) {
    super(`persistent state revision conflict: expected ${expectedRevision?.toString() ?? "empty"}, actual ${actualRevision.toString()}`);
    this.name = "PersistenceConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class PersistenceCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceCorruptionError";
  }
}

export class OutboxLeaseLostError extends Error {
  constructor(message = "outbox lease is no longer owned by this worker") {
    super(message);
    this.name = "OutboxLeaseLostError";
  }
}

export class PersistenceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceStateError";
  }
}

export class PersistenceSignatureError extends PersistenceStateError {
  constructor(message = "inbox event signature is invalid") {
    super(message);
    this.name = "PersistenceSignatureError";
  }
}

export interface DurableSnapshot {
  revision: bigint;
  snapshot: StoreSnapshot;
  snapshotDigest: string;
  eventId: string;
}

export interface DurableCommitInput {
  expectedRevision: bigint | null;
  snapshot: StoreSnapshot;
  eventType: "BOOTSTRAP" | "HTTP_REQUEST" | "RESTORE_QUARANTINED" | "SYSTEM";
  operation: string;
  organizationId: OpaqueId | null;
  actorId: OpaqueId | null;
  correlationId: string;
  aggregateType: string;
  aggregateId: OpaqueId | null;
  payload: Record<string, unknown>;
  auditRecords?: AuditRecord[];
  commandReceipts?: CommandReceipt[];
  outboxRecords?: DurableOutboxInput[];
  recoveredOutboxRecords?: DurableOutboxRecord[];
  recoveredUsageRecords?: DurableUsageRecord[];
  recoveredInboxRecords?: DurableInboxRecord[];
  recoveredExternalEffects?: DurableExternalEffectRecord[];
  recoveredWorkerJobs?: DurableWorkerJobRecord[];
  /**
   * A command-owned normalized write. It is executed in the same transaction
   * as the canonical snapshot and deliberately excluded from the generic
   * projection pass below, so the command has one authoritative SQL write.
   */
  normalizedPatientWrite?: AnimalPatient;
  /**
   * The appointment command's authoritative normalized row. It follows the
   * same transaction and replay-safety contract as normalizedPatientWrite.
   */
  normalizedAppointmentWrite?: Appointment;
  /**
   * The encounter command's authoritative normalized row. It follows the
   * same transaction and replay-safety contract as the other command-owned
   * normalized writes.
   */
  normalizedEncounterWrite?: Encounter;
  /**
   * A clinical sign transition. It is an update-only normalized write: the
   * existing draft/review row must match the signed snapshot and version
   * predecessor, so a missing or divergent source row fails closed.
   */
  normalizedClinicalSignWrite?: ClinicalDocument;
  /**
   * A replay already materialized the signed row. It may be excluded from
   * the generic snapshot projection while session activity is committed.
   */
  normalizedClinicalSignReplayId?: OpaqueId;
  /**
   * A guardian command's authoritative normalized row. It is written in the
   * same transaction as the canonical snapshot and removed from generic
   * projection to prevent a second competing write path.
   */
  normalizedGuardianWrite?: Guardian;
  /**
   * A replay already materialized the guardian row. The canonical snapshot,
   * audit and receipt may still advance without issuing another guardian DML.
   */
  normalizedGuardianReplayId?: OpaqueId;
  /**
   * A diagnostic request command's authoritative normalized row. Its unit and
   * workspace scope are derived from the bound encounter, never the payload.
   */
  normalizedDiagnosticRequestWrite?: DiagnosticRequest;
  /**
   * A replay already materialized the diagnostic request. The canonical
   * snapshot and receipt may advance without issuing another diagnostic DML.
   */
  normalizedDiagnosticRequestReplayId?: OpaqueId;
  /**
   * A specimen command's authoritative normalized row. Its scope is derived
   * from the bound diagnostic request and encounter, never from the payload.
   */
  normalizedSpecimenWrite?: Specimen;
  /**
   * A replay already materialized the specimen row; no second specimen DML is
   * issued while the canonical snapshot and receipt advance.
   */
  normalizedSpecimenReplayId?: OpaqueId;
  /**
   * A diagnostic result command's authoritative normalized row. Its scope is
   * derived from the bound request and encounter, never from the payload.
   */
  normalizedDiagnosticResultWrite?: DiagnosticResult;
  /**
   * A replay already materialized the diagnostic result; no second result DML
   * is issued while the canonical snapshot and receipt advance.
   */
  normalizedDiagnosticResultReplayId?: OpaqueId;
  eventId?: string;
}

export type DurableCommandReceiptClaimStatus = "CLAIMED" | "REPLAY" | "IN_FLIGHT" | "OUTCOME_UNKNOWN" | "FAILED" | "CONFLICT";

export interface DurableCommandReceiptClaim {
  status: DurableCommandReceiptClaimStatus;
  receipt: CommandReceipt;
}

export interface DurableOutboxInput {
  id: OpaqueId;
  organizationId: OpaqueId;
  eventType: string;
  aggregateId: OpaqueId;
  payload: Record<string, unknown>;
  availableAt?: string;
}

export type DurableOutboxStatus = "PENDING" | "CLAIMED" | "DELIVERED" | "FAILED" | "QUARANTINED";

export interface DurableOutboxRecord extends DurableOutboxInput {
  status: DurableOutboxStatus;
  attempts: number;
  availableAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  fenceToken: bigint;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
  recordDigest: string;
}

export type DurableWorkerLane = "jobs" | "schedule" | "reconciliation" | "notifications" | "maintenance";
export type DurableWorkerJobStatus = "PENDING" | "CLAIMED" | "COMPLETED" | "QUARANTINED";

export interface DurableWorkerJobInput {
  id: OpaqueId;
  organizationId: OpaqueId;
  lane: DurableWorkerLane;
  jobType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: string;
}

export interface DurableWorkerJobRecord extends DurableWorkerJobInput {
  status: DurableWorkerJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  fenceToken: bigint;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
  recordDigest: string;
}

export type DurableWorkerHeartbeatStatus = "RUNNING" | "DEGRADED" | "STOPPING" | "STOPPED";
export type DurableWorkerHeartbeatLane = "outbox" | DurableWorkerLane;

export interface DurableWorkerHeartbeatInput {
  organizationId: OpaqueId;
  workerId: string;
  status: DurableWorkerHeartbeatStatus;
  lane: DurableWorkerHeartbeatLane | null;
  cycleId: OpaqueId | null;
  startedAt: string;
  lastSeenAt?: string;
  expiresAt: string;
  detail: string | null;
}

export interface DurableWorkerHeartbeatRecord extends Omit<DurableWorkerHeartbeatInput, "lastSeenAt"> {
  lastSeenAt: string;
  updatedAt: string;
}

export interface DurableUsageInput {
  id: OpaqueId;
  organizationId: OpaqueId;
  reservationId: OpaqueId | null;
  providerRequestId: string | null;
  idempotencyKey: string;
  usageKind: string;
  reservedUnits: number;
  consumedUnits: number;
  status: "RECEIVED" | "SETTLED" | "RECONCILIATION_REQUIRED" | "QUARANTINED";
  record: Record<string, unknown>;
}

export interface DurableUsageRecord extends DurableUsageInput {
  recordDigest: string;
  createdAt: string;
}

export type DurableInboxStatus = "RECEIVED" | "PROCESSED" | "QUARANTINED" | "RECONCILIATION_REQUIRED";

export interface DurableInboxInput {
  id: OpaqueId;
  organizationId: OpaqueId;
  consumer: string;
  provider: string;
  externalEventId: string;
  eventType: string;
  schemaVersion: number;
  signatureAlgorithm: "HMAC-SHA256";
  signatureKeyRef: string;
  signature: string;
  /** Exact received bytes, used only for signature verification and never persisted. */
  rawBody?: string;
  payload: Record<string, unknown>;
}

export type DurableInboxSignatureAlgorithm = "HMAC-SHA256" | "UNVERIFIED";

export interface DurableInboxRecord extends Omit<DurableInboxInput, "signatureAlgorithm" | "rawBody"> {
  signatureAlgorithm: DurableInboxSignatureAlgorithm;
  recordDigest: string;
  status: DurableInboxStatus;
  conflictDigest: string | null;
  lastError: string | null;
  receivedAt: string;
  processedAt: string | null;
  lastSeenAt: string;
}

export interface DurableInboxReceipt extends DurableInboxRecord {
  duplicate: boolean;
}

export type DurableExternalEffectStatus = "ADMISSION_PENDING" | "DISPATCHED" | "FAILED_RETRYABLE" | "SUCCEEDED" | "OUTCOME_UNKNOWN" | "RECONCILIATION_REQUIRED" | "RECONCILING" | "FAILED_FINAL" | "QUARANTINED";

export interface DurableExternalEffectInput {
  id: OpaqueId;
  organizationId: OpaqueId;
  outboxId: OpaqueId;
  integrationId: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
}

export interface DurableExternalEffectRecord extends DurableExternalEffectInput {
  requestDigest: string;
  status: DurableExternalEffectStatus;
  attempts: number;
  claimedBy: string | null;
  leaseUntil: string | null;
  fenceToken: bigint;
  providerRequestId: string | null;
  response: Record<string, unknown> | null;
  lastError: string | null;
  outcomeDigest: string | null;
  reconciliationSource: "SYNTHETIC_PROVIDER_QUERY" | "PROVIDER_QUERY" | "MANUAL_REVIEW" | null;
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DurableBreakGlassStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "REVIEWED";
export type DurableBreakGlassMfaMethod = "WEBAUTHN";

/**
 * Durable record admitted only after the application boundary has verified an
 * independent WebAuthn approval. This adapter intentionally does not perform
 * WebAuthn verification or grant public capability access by itself.
 */
export interface DurableBreakGlassInput {
  grantId: OpaqueId;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  approverId: OpaqueId;
  reason: string;
  target: string;
  mfaMethod: DurableBreakGlassMfaMethod;
  issuedAt: string;
  expiresAt: string;
}

export interface DurableBreakGlassGrant extends DurableBreakGlassInput {
  status: DurableBreakGlassStatus;
  reviewedBy: OpaqueId | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type DurableExternalEffectOutcomeStatus = "SUCCEEDED" | "FAILED_RETRYABLE" | "OUTCOME_UNKNOWN" | "FAILED_FINAL" | "QUARANTINED";

export interface DurableExternalEffectOutcome {
  status: DurableExternalEffectOutcomeStatus;
  providerRequestId?: string | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
}

export interface DurableExternalReconciliationEvidence {
  status: "SUCCEEDED" | "FAILED_FINAL" | "QUARANTINED";
  providerRequestId: string | null;
  response: Record<string, unknown> | null;
  error?: string | null;
  source: "SYNTHETIC_PROVIDER_QUERY" | "PROVIDER_QUERY" | "MANUAL_REVIEW";
  observedAt: string;
  queryDigest: string;
}

export interface RecoveryBundleManifest {
  format: "CVG-RECOVERY-MANIFEST";
  version: 1;
  organizationId: OpaqueId;
  snapshotSchemaVersion: 1;
  createdAt: string;
  migrationFingerprint: string;
  watermark: {
    revision: string;
    eventId: string;
    snapshotDigest: string;
  };
  ledgerDigests: {
    outbox: string;
    usage: string;
    inbox: string;
    externalEffects: string;
    workerJobs?: string;
  };
}

export interface RecoveryBundleManifestInput {
  organizationId: OpaqueId;
  revision: bigint;
  snapshotDigest: string;
  eventId: string;
  migrationFingerprint: string;
  outboxRecords: readonly DurableOutboxRecord[];
  usageRecords: readonly DurableUsageRecord[];
  inboxRecords: readonly DurableInboxRecord[];
  externalEffects: readonly DurableExternalEffectRecord[];
  workerJobs?: readonly DurableWorkerJobRecord[];
  createdAt?: string;
  snapshotSchemaVersion?: number;
}

export interface RecoveryBundleValidationOptions {
  expectedMigrationFingerprint?: string;
  expectedSnapshotSchemaVersion?: number;
  minimumRevision?: bigint;
  maxAgeMs?: number;
  now?: string;
}

export interface DurableRecoveryBundle extends DurableSnapshot {
  manifest: RecoveryBundleManifest;
  outboxRecords: DurableOutboxRecord[];
  usageRecords: DurableUsageRecord[];
  inboxRecords: DurableInboxRecord[];
  externalEffects: DurableExternalEffectRecord[];
  workerJobs?: DurableWorkerJobRecord[];
}

export interface EncryptedRecoveryBundle {
  format: "CVG-RECOVERY-BUNDLE";
  version: 1 | 2;
  algorithm: "AES-256-GCM";
  keyRef: string;
  payloadDigest: string;
  expiresAt: string | null;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

export interface RecoveryBundleEncryptionOptions {
  expiresAt?: string | null;
}

const RECOVERY_BUNDLE_FORMAT = "CVG-RECOVERY-BUNDLE" as const;
const RECOVERY_BUNDLE_VERSION = 2 as const;
const RECOVERY_BUNDLE_LEGACY_VERSION = 1 as const;
const RECOVERY_BUNDLE_ALGORITHM = "AES-256-GCM" as const;
const RECOVERY_MANIFEST_FORMAT = "CVG-RECOVERY-MANIFEST" as const;
const RECOVERY_MANIFEST_VERSION = 1 as const;
const RECOVERY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

function recoveryKey(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw new PersistenceStateError("recovery encryption key must be exactly 32 bytes");
  return Buffer.from(key);
}

function recoveryKeyRef(keyRef: string): string {
  if (typeof keyRef !== "string" || !keyRef.trim() || keyRef.length > 200) throw new PersistenceStateError("recovery encryption key reference is invalid");
  return keyRef;
}

function recoveryPlaintext(bundle: DurableRecoveryBundle): string {
  return JSON.stringify(bundle, (_key, value) => typeof value === "bigint" ? `${value}` : value);
}

function recoveryAssociatedData(keyRef: string, payloadDigest: string, version: 1 | 2, expiresAt: string | null): Buffer {
  const associatedData: { format: typeof RECOVERY_BUNDLE_FORMAT; version: 1 | 2; algorithm: typeof RECOVERY_BUNDLE_ALGORITHM; keyRef: string; payloadDigest: string; expiresAt?: string | null } = { format: RECOVERY_BUNDLE_FORMAT, version, algorithm: RECOVERY_BUNDLE_ALGORITHM, keyRef, payloadDigest };
  if (version === RECOVERY_BUNDLE_VERSION) associatedData.expiresAt = expiresAt;
  return Buffer.from(JSON.stringify(associatedData), "utf8");
}

function recoveryBase64(value: unknown, field: string): Buffer {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is not valid base64`);
  return Buffer.from(value, "base64");
}

function recoveryRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is not an object`);
  return value as Record<string, unknown>;
}

function recoveryRecords(value: unknown, field: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is not an array`);
  return value.map((item, index) => recoveryRecord(item, `${field}[${index}]`));
}

function recoveryString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is invalid`);
  return value;
}

function recoveryBigInt(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is not a serialized integer`);
  try {
    return BigInt(value);
  } catch {
    throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is not a serialized integer`);
  }
}

function recoveryCanonical(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested));
}

function recoveryLedgerDigest(values: readonly unknown[]): string {
  const ordered = values.map((value, index) => ({ value, index })).sort((left, right) => {
    const leftRecord = left.value && typeof left.value === "object" && !Array.isArray(left.value) ? left.value as Record<string, unknown> : {};
    const rightRecord = right.value && typeof right.value === "object" && !Array.isArray(right.value) ? right.value as Record<string, unknown> : {};
    const leftKey = typeof leftRecord.id === "string" ? leftRecord.id : JSON.stringify(recoveryCanonical(left.value));
    const rightKey = typeof rightRecord.id === "string" ? rightRecord.id : JSON.stringify(recoveryCanonical(right.value));
    return leftKey.localeCompare(rightKey) || left.index - right.index;
  });
  return digest(ordered.map(({ value }) => recoveryCanonical(value)));
}

function recoveryDigestString(value: unknown, field: string): string {
  const text = recoveryString(value, field);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is not a SHA-256 digest`);
  return text;
}

function recoveryTimestamp(value: unknown, field: string): string {
  const timestamp = recoveryString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field} is not a valid timestamp`);
  return timestamp;
}

function recoveryExpirationTimestamp(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(Date.parse(value))) throw new PersistenceStateError("recovery envelope expiresAt must be a valid timestamp");
  return value;
}

function recoveryCreationTimestamp(value: string | undefined): string {
  const timestamp = value ?? now();
  if (typeof timestamp !== "string" || !timestamp || !Number.isFinite(Date.parse(timestamp))) throw new PersistenceStateError("recovery manifest createdAt must be a valid timestamp");
  return timestamp;
}

export function createRecoveryBundleManifest(input: RecoveryBundleManifestInput): RecoveryBundleManifest {
  if (typeof input.organizationId !== "string" || !input.organizationId.trim()) throw new PersistenceStateError("recovery manifest organization scope is required");
  if (typeof input.revision !== "bigint" || input.revision < 0n) throw new PersistenceStateError("recovery manifest revision is invalid");
  if (typeof input.eventId !== "string" || !input.eventId.trim()) throw new PersistenceStateError("recovery manifest event id is required");
  if (typeof input.snapshotDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.snapshotDigest)) throw new PersistenceStateError("recovery manifest snapshot digest is invalid");
  if (typeof input.migrationFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.migrationFingerprint)) throw new PersistenceStateError("recovery manifest migration fingerprint is invalid");
  const snapshotSchemaVersion = input.snapshotSchemaVersion ?? RECOVERY_SNAPSHOT_SCHEMA_VERSION;
  if (snapshotSchemaVersion !== RECOVERY_SNAPSHOT_SCHEMA_VERSION) throw new PersistenceStateError(`recovery manifest snapshot schema version ${snapshotSchemaVersion} is unsupported`);
  const createdAt = recoveryCreationTimestamp(input.createdAt);
  return {
    format: RECOVERY_MANIFEST_FORMAT,
    version: RECOVERY_MANIFEST_VERSION,
    organizationId: input.organizationId,
    snapshotSchemaVersion: RECOVERY_SNAPSHOT_SCHEMA_VERSION,
    createdAt,
    migrationFingerprint: input.migrationFingerprint,
    watermark: {
      revision: input.revision.toString(),
      eventId: input.eventId,
      snapshotDigest: input.snapshotDigest
    },
    ledgerDigests: {
      outbox: recoveryLedgerDigest(input.outboxRecords),
      usage: recoveryLedgerDigest(input.usageRecords),
      inbox: recoveryLedgerDigest(input.inboxRecords),
      externalEffects: recoveryLedgerDigest(input.externalEffects),
      workerJobs: recoveryLedgerDigest(input.workerJobs ?? [])
    }
  };
}

function parseRecoveryManifest(value: unknown): RecoveryBundleManifest {
  const manifest = recoveryRecord(value, "manifest");
  if (manifest.format !== RECOVERY_MANIFEST_FORMAT || manifest.version !== RECOVERY_MANIFEST_VERSION) throw new PersistenceCorruptionError("encrypted recovery bundle manifest format is unsupported");
  const organizationId = recoveryString(manifest.organizationId, "manifest.organizationId") as OpaqueId;
  if (manifest.snapshotSchemaVersion !== RECOVERY_SNAPSHOT_SCHEMA_VERSION) throw new PersistenceCorruptionError(`encrypted recovery bundle snapshot schema version ${String(manifest.snapshotSchemaVersion)} is unsupported`);
  const createdAt = recoveryTimestamp(manifest.createdAt, "manifest.createdAt");
  const migrationFingerprint = recoveryDigestString(manifest.migrationFingerprint, "manifest.migrationFingerprint");
  const watermark = recoveryRecord(manifest.watermark, "manifest.watermark");
  const revision = recoveryBigInt(watermark.revision, "manifest.watermark.revision");
  const eventId = recoveryString(watermark.eventId, "manifest.watermark.eventId");
  const snapshotDigest = recoveryDigestString(watermark.snapshotDigest, "manifest.watermark.snapshotDigest");
  const ledgerDigests = recoveryRecord(manifest.ledgerDigests, "manifest.ledgerDigests");
  return {
    format: RECOVERY_MANIFEST_FORMAT,
    version: RECOVERY_MANIFEST_VERSION,
    organizationId,
    snapshotSchemaVersion: RECOVERY_SNAPSHOT_SCHEMA_VERSION,
    createdAt,
    migrationFingerprint,
    watermark: { revision: revision.toString(), eventId, snapshotDigest },
    ledgerDigests: {
      outbox: recoveryDigestString(ledgerDigests.outbox, "manifest.ledgerDigests.outbox"),
      usage: recoveryDigestString(ledgerDigests.usage, "manifest.ledgerDigests.usage"),
      inbox: recoveryDigestString(ledgerDigests.inbox, "manifest.ledgerDigests.inbox"),
      externalEffects: recoveryDigestString(ledgerDigests.externalEffects, "manifest.ledgerDigests.externalEffects"),
      ...(ledgerDigests.workerJobs === undefined ? {} : { workerJobs: recoveryDigestString(ledgerDigests.workerJobs, "manifest.ledgerDigests.workerJobs") })
    }
  };
}

function recoveryLedgerRecords(value: unknown, field: string, organizationId: OpaqueId, digestField: "recordDigest" | "requestDigest"): unknown[] {
  const records = recoveryRecords(value, field);
  return records.map((record, index) => {
    if (typeof record.id !== "string" || !record.id) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field}[${index}].id is invalid`);
    if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`encrypted recovery bundle ${field}[${index}] has a different organization scope`);
    recoveryDigestString(record[digestField], `${field}[${index}].${digestField}`);
    return record;
  });
}

export function validateRecoveryBundle(bundle: DurableRecoveryBundle, options: RecoveryBundleValidationOptions = {}): void {
  const raw = recoveryRecord(bundle, "bundle");
  const manifest = parseRecoveryManifest(raw.manifest);
  if (typeof bundle.revision !== "bigint" || bundle.revision < 0n) throw new PersistenceCorruptionError("encrypted recovery bundle revision is invalid");
  const eventId = recoveryString(bundle.eventId, "eventId");
  const snapshotDigest = recoveryDigestString(bundle.snapshotDigest, "snapshotDigest");
  if (manifest.watermark.revision !== bundle.revision.toString() || manifest.watermark.eventId !== eventId || manifest.watermark.snapshotDigest !== snapshotDigest) throw new PersistenceCorruptionError("encrypted recovery bundle watermark does not match durable state");

  let snapshot: StoreSnapshot;
  try {
    snapshot = parseSnapshot(serializeSnapshot(bundle.snapshot));
  } catch (error) {
    throw new PersistenceCorruptionError(`encrypted recovery bundle snapshot failed validation: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (digest(canonicalSnapshot(snapshot)) !== snapshotDigest) throw new PersistenceCorruptionError("encrypted recovery bundle snapshot digest mismatch");
  if (!snapshot.organizations.some((organization) => organization.id === manifest.organizationId)) throw new PersistenceCorruptionError(`encrypted recovery bundle manifest has no matching organization ${manifest.organizationId}`);

  const outboxRecords = recoveryLedgerRecords(raw.outboxRecords, "outboxRecords", manifest.organizationId, "recordDigest");
  const usageRecords = recoveryLedgerRecords(raw.usageRecords, "usageRecords", manifest.organizationId, "recordDigest");
  const inboxRecords = recoveryLedgerRecords(raw.inboxRecords, "inboxRecords", manifest.organizationId, "recordDigest");
  const externalEffects = recoveryLedgerRecords(raw.externalEffects, "externalEffects", manifest.organizationId, "requestDigest");
  const workerJobs = recoveryLedgerRecords(raw.workerJobs ?? [], "workerJobs", manifest.organizationId, "recordDigest");
  if (manifest.ledgerDigests.outbox !== recoveryLedgerDigest(outboxRecords) || manifest.ledgerDigests.usage !== recoveryLedgerDigest(usageRecords) || manifest.ledgerDigests.inbox !== recoveryLedgerDigest(inboxRecords) || manifest.ledgerDigests.externalEffects !== recoveryLedgerDigest(externalEffects) || (manifest.ledgerDigests.workerJobs !== undefined && manifest.ledgerDigests.workerJobs !== recoveryLedgerDigest(workerJobs))) throw new PersistenceCorruptionError("encrypted recovery bundle ledger digest mismatch");

  const expectedSnapshotSchemaVersion = options.expectedSnapshotSchemaVersion ?? RECOVERY_SNAPSHOT_SCHEMA_VERSION;
  if (!Number.isSafeInteger(expectedSnapshotSchemaVersion) || expectedSnapshotSchemaVersion !== manifest.snapshotSchemaVersion) throw new PersistenceStateError(`recovery bundle snapshot schema version ${manifest.snapshotSchemaVersion} does not match expected ${expectedSnapshotSchemaVersion}`);
  if (options.expectedMigrationFingerprint !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(options.expectedMigrationFingerprint)) throw new PersistenceStateError("expected recovery migration fingerprint is invalid");
    if (manifest.migrationFingerprint !== options.expectedMigrationFingerprint) throw new PersistenceStateError("recovery bundle migration fingerprint does not match the target schema");
  }
  if (options.minimumRevision !== undefined) {
    if (typeof options.minimumRevision !== "bigint" || options.minimumRevision < 0n) throw new PersistenceStateError("minimum recovery revision is invalid");
    if (bundle.revision < options.minimumRevision) throw new PersistenceStateError(`recovery bundle revision ${bundle.revision.toString()} is stale; minimum is ${options.minimumRevision.toString()}`);
  }
  if (options.maxAgeMs !== undefined) {
    if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 0) throw new PersistenceStateError("maximum recovery bundle age is invalid");
    const referenceTimestamp = options.now ?? now();
    if (!Number.isFinite(Date.parse(referenceTimestamp))) throw new PersistenceStateError("recovery validation reference time is invalid");
    const ageMs = Date.parse(referenceTimestamp) - Date.parse(manifest.createdAt);
    if (ageMs < 0) throw new PersistenceStateError("recovery bundle was created in the future");
    if (ageMs > options.maxAgeMs) throw new PersistenceStateError(`recovery bundle is stale; age ${ageMs}ms exceeds ${options.maxAgeMs}ms`);
  }
}

function parseEncryptedRecoveryBundle(value: unknown): EncryptedRecoveryBundle {
  const envelope = recoveryRecord(value, "envelope");
  const version = envelope.version === RECOVERY_BUNDLE_LEGACY_VERSION ? RECOVERY_BUNDLE_LEGACY_VERSION : envelope.version === RECOVERY_BUNDLE_VERSION ? RECOVERY_BUNDLE_VERSION : null;
  if (envelope.format !== RECOVERY_BUNDLE_FORMAT || version === null || envelope.algorithm !== RECOVERY_BUNDLE_ALGORITHM) throw new PersistenceCorruptionError("encrypted recovery bundle format is unsupported");
  const keyRef = recoveryKeyRef(recoveryString(envelope.keyRef, "keyRef"));
  const payloadDigest = recoveryString(envelope.payloadDigest, "payloadDigest");
  if (!/^[a-f0-9]{64}$/.test(payloadDigest)) throw new PersistenceCorruptionError("encrypted recovery bundle payload digest is invalid");
  const expiresAt = version === RECOVERY_BUNDLE_VERSION ? (envelope.expiresAt === null ? null : recoveryTimestamp(envelope.expiresAt, "expiresAt")) : null;
  return {
    format: RECOVERY_BUNDLE_FORMAT,
    version,
    algorithm: RECOVERY_BUNDLE_ALGORITHM,
    keyRef,
    payloadDigest,
    expiresAt,
    nonce: recoveryString(envelope.nonce, "nonce"),
    ciphertext: recoveryString(envelope.ciphertext, "ciphertext"),
    authTag: recoveryString(envelope.authTag, "authTag")
  };
}

function hydrateRecoveryBundle(raw: unknown): DurableRecoveryBundle {
  const bundle = recoveryRecord(raw, "payload");
  let snapshot: StoreSnapshot;
  try {
    snapshot = parseSnapshot(JSON.stringify(bundle.snapshot));
  } catch (error) {
    throw new PersistenceCorruptionError(`encrypted recovery bundle snapshot failed validation: ${error instanceof Error ? error.message : String(error)}`);
  }
  const snapshotDigest = recoveryDigestString(bundle.snapshotDigest, "snapshotDigest");
  if (digest(canonicalSnapshot(snapshot)) !== snapshotDigest) throw new PersistenceCorruptionError("encrypted recovery bundle snapshot digest mismatch");
  const outboxRecords = recoveryRecords(bundle.outboxRecords, "outboxRecords").map((record) => ({ ...record, fenceToken: recoveryBigInt(record.fenceToken, "outboxRecords.fenceToken") }) as unknown as DurableOutboxRecord);
  const usageRecords = recoveryRecords(bundle.usageRecords, "usageRecords") as unknown as DurableUsageRecord[];
  const inboxRecords = recoveryRecords(bundle.inboxRecords, "inboxRecords") as unknown as DurableInboxRecord[];
  const externalEffects = recoveryRecords(bundle.externalEffects, "externalEffects").map((record) => ({ ...record, fenceToken: recoveryBigInt(record.fenceToken, "externalEffects.fenceToken") }) as unknown as DurableExternalEffectRecord);
  const workerJobs = recoveryRecords(bundle.workerJobs ?? [], "workerJobs").map((record) => ({ ...record, fenceToken: recoveryBigInt(record.fenceToken, "workerJobs.fenceToken") }) as unknown as DurableWorkerJobRecord);
  const hydrated: DurableRecoveryBundle = {
    manifest: parseRecoveryManifest(bundle.manifest),
    revision: recoveryBigInt(bundle.revision, "revision"),
    snapshot,
    snapshotDigest,
    eventId: recoveryString(bundle.eventId, "eventId"),
    outboxRecords,
    usageRecords,
    inboxRecords,
    externalEffects,
    workerJobs
  };
  validateRecoveryBundle(hydrated);
  return hydrated;
}

export function encryptRecoveryBundle(bundle: DurableRecoveryBundle, key: Uint8Array, keyRef: string, options: RecoveryBundleEncryptionOptions = {}): EncryptedRecoveryBundle {
  const safeKey = recoveryKey(key);
  const safeKeyRef = recoveryKeyRef(keyRef);
  const expiresAt = recoveryExpirationTimestamp(options.expiresAt);
  validateRecoveryBundle(bundle);
  const plaintext = Buffer.from(recoveryPlaintext(bundle), "utf8");
  const payloadDigest = digest(JSON.parse(plaintext.toString("utf8")));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", safeKey, nonce);
  cipher.setAAD(recoveryAssociatedData(safeKeyRef, payloadDigest, RECOVERY_BUNDLE_VERSION, expiresAt));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: RECOVERY_BUNDLE_FORMAT,
    version: RECOVERY_BUNDLE_VERSION,
    algorithm: RECOVERY_BUNDLE_ALGORITHM,
    keyRef: safeKeyRef,
    payloadDigest,
    expiresAt,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptRecoveryBundle(encrypted: unknown, key: Uint8Array): DurableRecoveryBundle {
  const envelope = parseEncryptedRecoveryBundle(encrypted);
  const safeKey = recoveryKey(key);
  const nonce = recoveryBase64(envelope.nonce, "nonce");
  const ciphertext = recoveryBase64(envelope.ciphertext, "ciphertext");
  const authTag = recoveryBase64(envelope.authTag, "authTag");
  if (nonce.length !== 12 || authTag.length !== 16) throw new PersistenceCorruptionError("encrypted recovery bundle cryptographic parameters are invalid");
  try {
    const decipher = createDecipheriv("aes-256-gcm", safeKey, nonce);
    decipher.setAAD(recoveryAssociatedData(envelope.keyRef, envelope.payloadDigest, envelope.version, envelope.expiresAt));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (digest(parsed) !== envelope.payloadDigest) throw new PersistenceCorruptionError("encrypted recovery bundle payload digest mismatch");
    if (envelope.expiresAt !== null && Date.parse(envelope.expiresAt) <= Date.now()) throw new PersistenceStateError("encrypted recovery bundle has expired");
    return hydrateRecoveryBundle(parsed);
  } catch (error) {
    if (error instanceof PersistenceCorruptionError || error instanceof PersistenceStateError) throw error;
    throw new PersistenceCorruptionError("encrypted recovery bundle authentication failed");
  }
}

interface RevisionRow {
  revision: string;
}

interface CommandReceiptRow {
  id: string;
  organization_id: string;
  actor_id: string;
  unit_id: string | null;
  workspace_id: string | null;
  audit_record_id: string | null;
  operation: string;
  idempotency_lookup: string;
  body_digest: string;
  status: CommandReceipt["status"];
  result: unknown;
  created_at: SqlTimestamp;
  completed_at: SqlTimestamp;
}

interface MigrationRow {
  version: string;
  checksum: string;
}

interface SnapshotRow extends RevisionRow {
  organization_id: string;
  snapshot: unknown;
  snapshot_digest: string;
  journal_snapshot_digest: string;
  schema_version: number;
  event_id: string;
}

interface OutboxRow {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: DurableOutboxStatus;
  attempts: number;
  available_at: SqlTimestamp;
  claimed_by: string | null;
  lease_until: SqlTimestamp;
  fence_token: string | number | bigint;
  last_error: string | null;
  created_at: SqlTimestamp;
  processed_at: SqlTimestamp;
  record_digest: string;
}

interface WorkerJobRow {
  id: string;
  organization_id: string;
  lane: DurableWorkerLane;
  job_type: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: DurableWorkerJobStatus;
  attempts: number;
  max_attempts: number;
  available_at: SqlTimestamp;
  claimed_by: string | null;
  lease_until: SqlTimestamp;
  fence_token: string | number | bigint;
  last_error: string | null;
  created_at: SqlTimestamp;
  processed_at: SqlTimestamp;
  record_digest: string;
}

interface WorkerHeartbeatRow {
  organization_id: string;
  worker_id: string;
  status: DurableWorkerHeartbeatStatus;
  lane: DurableWorkerHeartbeatLane | null;
  cycle_id: string | null;
  started_at: SqlTimestamp;
  last_seen_at: SqlTimestamp;
  expires_at: SqlTimestamp;
  detail: string | null;
  updated_at: SqlTimestamp;
}

interface UsageRow {
  id: string;
  organization_id: string;
  reservation_id: string | null;
  provider_request_id: string | null;
  idempotency_key: string;
  usage_kind: string;
  reserved_units: number;
  consumed_units: number;
  status: DurableUsageRecord["status"];
  record: Record<string, unknown>;
  record_digest: string;
  created_at: SqlTimestamp;
}

interface InboxRow {
  id: string;
  organization_id: string;
  consumer: string;
  provider: string;
  external_event_id: string;
  event_type: string;
  schema_version: number;
  signature_algorithm: "HMAC-SHA256" | "UNVERIFIED";
  signature_key_ref: string;
  signature: string;
  payload: Record<string, unknown>;
  record_digest: string;
  status: DurableInboxStatus;
  conflict_digest: string | null;
  last_error: string | null;
  received_at: SqlTimestamp;
  processed_at: SqlTimestamp;
  last_seen_at: SqlTimestamp;
}

interface ExternalEffectRow {
  id: string;
  organization_id: string;
  outbox_id: string;
  integration_id: string;
  idempotency_key: string;
  request: Record<string, unknown>;
  request_digest: string;
  status: DurableExternalEffectStatus;
  attempts: number;
  claimed_by: string | null;
  lease_until: SqlTimestamp;
  fence_token: string | number | bigint;
  provider_request_id: string | null;
  response: Record<string, unknown> | null;
  last_error: string | null;
  outcome_digest: string | null;
  reconciliation_source: "SYNTHETIC_PROVIDER_QUERY" | "PROVIDER_QUERY" | "MANUAL_REVIEW" | null;
  reconciled_at: SqlTimestamp;
  created_at: SqlTimestamp;
  updated_at: SqlTimestamp;
}

interface BreakGlassRow {
  id: string;
  organization_id: string;
  actor_id: string;
  approver_id: string;
  reason: string;
  target: string;
  mfa_method: DurableBreakGlassMfaMethod;
  issued_at: SqlTimestamp;
  expires_at: SqlTimestamp;
  status: DurableBreakGlassStatus;
  reviewed_by: string | null;
  reviewed_at: SqlTimestamp;
  review_note: string | null;
  revoked_at: SqlTimestamp;
  created_at: SqlTimestamp;
}

const BREAK_GLASS_COLUMNS = "id::text as id, organization_id::text as organization_id, actor_id::text as actor_id, approver_id::text as approver_id, reason, target, mfa_method, issued_at, expires_at, status, reviewed_by::text as reviewed_by, reviewed_at, review_note, revoked_at, created_at";
const WORKER_JOB_COLUMNS = "id::text as id, organization_id::text as organization_id, lane, job_type, idempotency_key, payload, status, attempts, max_attempts, available_at, claimed_by, lease_until, fence_token::text as fence_token, last_error, created_at, processed_at, record_digest";
const WORKER_JOB_UPDATE_COLUMNS = "job.id::text as id, job.organization_id::text as organization_id, job.lane, job.job_type, job.idempotency_key, job.payload, job.status, job.attempts, job.max_attempts, job.available_at, job.claimed_by, job.lease_until, job.fence_token::text as fence_token, job.last_error, job.created_at, job.processed_at, job.record_digest";
const WORKER_HEARTBEAT_COLUMNS = "organization_id::text as organization_id, worker_id, status, lane, cycle_id::text as cycle_id, started_at, last_seen_at, expires_at, detail, updated_at";

type SqlTimestamp = string | Date | null;

export interface NormalizedPatientRead extends AnimalPatient {
  guardian: Pick<Guardian, "id" | "displayName" | "phone"> | null;
}

export interface NormalizedAppointmentRead extends Appointment {
  patient: { id: OpaqueId; name: string } | null;
  provider: string | null;
}

export interface NormalizedEncounterRead extends Encounter {
  patient: { id: OpaqueId; name: string };
}

export interface NormalizedMedicationOrderRead extends MedicationOrder {
  product: Pick<Product, "id" | "name" | "unit"> | null;
}

export interface NormalizedStockRead extends Lot {
  product: Product | null;
  location: StockLocation | null;
}

export interface NormalizedQueueRead extends QueueEntry {
  patient: { id: OpaqueId; name: string } | null;
}

export interface NormalizedAiSessionRead extends AiSession {
  turns: number;
}

interface AuditReadRow {
  id: string;
  organization_id: string;
  actor_id: string | null;
  unit_id: string | null;
  workspace_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  result: AuditRecord["result"];
  reason: string | null;
  correlation_id: string;
  metadata: unknown;
  chain_version: number;
  previous_hash: string | null;
  record_hash: string;
  created_at: SqlTimestamp;
}

interface EncounterReadRow {
  id: string;
  organization_id: string;
  unit_id: string;
  workspace_id: string;
  patient_id: string;
  appointment_id: string | null;
  chief_complaint: unknown;
  urgency: unknown;
  status: unknown;
  opened_at: SqlTimestamp;
  closed_at: SqlTimestamp;
  patient_name: unknown;
}

interface ClinicalDocumentReadRow {
  id: string;
  organization_id: string;
  unit_id: string;
  workspace_id: string;
  encounter_id: string;
  patient_id: string;
  author_id: string;
  document_type: unknown;
  title: unknown;
  content: unknown;
  data_class: unknown;
  status: unknown;
  version: unknown;
  signed_at: SqlTimestamp;
  signed_by: string | null;
  created_at: SqlTimestamp;
}

interface DiagnosticRequestReadRow {
  id: string;
  organization_id: string;
  patient_id: string;
  encounter_id: string;
  test_name: unknown;
  priority: unknown;
  status: unknown;
  requested_by: string;
  created_at: SqlTimestamp;
  unit_id: string;
  workspace_id: string;
}

interface SpecimenReadRow {
  id: string;
  organization_id: string;
  request_id: string;
  patient_id: string;
  label: unknown;
  collected_at: SqlTimestamp;
  status: unknown;
  unit_id: string;
  workspace_id: string;
}

interface DiagnosticResultReadRow {
  id: string;
  organization_id: string;
  request_id: string;
  specimen_id: string;
  patient_id: string;
  value: unknown;
  source: unknown;
  source_version: unknown;
  status: unknown;
  created_at: SqlTimestamp;
  unit_id: string;
  workspace_id: string;
}

interface BedReadRow {
  id: string;
  organization_id: string;
  unit_id: string;
  name: unknown;
  status: unknown;
}

interface HospitalEpisodeReadRow {
  id: string;
  organization_id: string;
  unit_id: string;
  patient_id: string;
  encounter_id: string | null;
  bed_id: string | null;
  status: unknown;
  admitted_at: SqlTimestamp;
  discharged_at: SqlTimestamp;
}

interface MedicationOrderReadRow {
  id: string;
  organization_id: string;
  patient_id: string;
  encounter_id: string;
  product_id: string;
  dose: unknown;
  route: unknown;
  frequency: unknown;
  status: unknown;
  prescribed_by: string;
  unit_id: string;
  workspace_id: string;
  product_name: unknown;
  product_unit: unknown;
}

interface StockReadRow {
  id: string;
  organization_id: string;
  product_id: string;
  lot_number: unknown;
  expires_on: string;
  quantity: unknown;
  location_id: string;
  status: unknown;
  product_sku: unknown;
  product_name: unknown;
  product_category: unknown;
  product_unit: unknown;
  product_reorder_point: unknown;
  product_status: unknown;
  location_unit_id: string;
  location_name: unknown;
}

interface QueueReadRow {
  id: string;
  organization_id: string;
  unit_id: string;
  appointment_id: string | null;
  patient_id: string;
  status: unknown;
  priority: unknown;
  checked_in_at: SqlTimestamp;
  appointment_workspace_id: string | null;
  patient_name: unknown;
}

interface AiSessionReadRow {
  id: string;
  organization_id: string;
  actor_id: string;
  unit_id: string | null;
  workspace_id: string | null;
  patient_id: string | null;
  encounter_id: string | null;
  purpose: unknown;
  engine_commit: unknown;
  profile_digest: unknown;
  status: unknown;
  created_at: SqlTimestamp;
  turn_count: unknown;
}

interface ChargeReadRow {
  id: string;
  organization_id: string;
  unit_id: string | null;
  patient_id: string | null;
  description: unknown;
  amount_cents: unknown;
  currency: unknown;
  status: unknown;
  created_at: SqlTimestamp;
}

interface PaymentReadRow {
  id: string;
  organization_id: string;
  charge_id: string;
  scope_unit_id: string | null;
  amount_cents: unknown;
  method: unknown;
  external_reference: unknown;
  status: unknown;
  created_at: SqlTimestamp;
}

interface LedgerEntryReadRow {
  id: string;
  organization_id: string;
  kind: unknown;
  reference_id: string;
  amount_cents: unknown;
  currency: unknown;
  description: unknown;
  created_at: SqlTimestamp;
  scope_unit_id: string | null;
}

interface CommunicationReadRow {
  id: string;
  organization_id: string;
  unit_id: string | null;
  workspace_id: string | null;
  patient_id: string | null;
  channel: unknown;
  recipient: unknown;
  template: unknown;
  body: unknown;
  status: unknown;
  created_by: string | null;
  decided_by: string | null;
  decided_at: SqlTimestamp;
  approved_by: string | null;
  approved_at: SqlTimestamp;
  decision_reason: unknown;
  created_at: SqlTimestamp;
}

interface KnowledgeReadRow {
  id: string;
  organization_id: string;
  unit_id: string | null;
  workspace_id: string | null;
  title: unknown;
  source: unknown;
  data_class: unknown;
  version: unknown;
  status: unknown;
  content: unknown;
  created_at: SqlTimestamp;
}

function sqlId(value: unknown, field: string): OpaqueId {
  if (typeof value !== "string") throw new PersistenceCorruptionError(`normalized ${field} is not a UUID string`);
  return id(value);
}

function sqlText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new PersistenceCorruptionError(`normalized ${field} is not text`);
  return value;
}

function sqlNullableText(value: unknown, field: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new PersistenceCorruptionError(`normalized ${field} is not nullable text`);
}

function sqlTimestamp(value: SqlTimestamp, field: string): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))) return timestamp;
  throw new PersistenceCorruptionError(`normalized ${field} is null`);
}

function sqlNullableTimestamp(value: SqlTimestamp): string | null {
  if (value === null) return null;
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (Number.isFinite(Date.parse(timestamp))) return timestamp;
  throw new PersistenceCorruptionError("durable timestamp is invalid");
}

function sqlStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new PersistenceCorruptionError(`normalized ${field} is not a string array`);
  return [...value];
}

function sqlEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  throw new PersistenceCorruptionError(`normalized ${field} has an unsupported value`);
}

function mapCommandReceiptRow(row: CommandReceiptRow): CommandReceipt {
  return {
    id: sqlId(row.id, "command receipt.id"),
    organizationId: sqlId(row.organization_id, "command receipt.organization_id"),
    actorId: sqlId(row.actor_id, "command receipt.actor_id"),
    unitId: row.unit_id === null ? null : sqlId(row.unit_id, "command receipt.unit_id"),
    workspaceId: row.workspace_id === null ? null : sqlId(row.workspace_id, "command receipt.workspace_id"),
    auditRecordId: row.audit_record_id === null ? null : sqlId(row.audit_record_id, "command receipt.audit_record_id"),
    operation: sqlText(row.operation, "command receipt.operation"),
    idempotencyLookup: sqlText(row.idempotency_lookup, "command receipt.idempotency_lookup"),
    bodyDigest: sqlText(row.body_digest, "command receipt.body_digest"),
    status: sqlEnum(row.status, ["IN_FLIGHT", "SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN"] as const, "command receipt.status"),
    result: row.result === undefined ? null : row.result,
    createdAt: sqlTimestamp(row.created_at, "command receipt.created_at"),
    completedAt: sqlNullableTimestamp(row.completed_at)
  };
}

function sqlInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw new PersistenceCorruptionError(`normalized ${field} is not a safe integer`);
  return value as number;
}

function sqlObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PersistenceCorruptionError(`durable ${field} is not an object`);
  return { ...(value as Record<string, unknown>) };
}

function sqlNullableObject(value: unknown, field: string): Record<string, unknown> | null {
  return value === null ? null : sqlObject(value, field);
}

function sqlAuditMetadata(value: unknown): AuditRecord["metadata"] {
  const object = sqlObject(value, "audit.metadata");
  for (const [key, entry] of Object.entries(object)) {
    if (entry !== null && typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") throw new PersistenceCorruptionError(`normalized audit.metadata.${key} is not a scalar value`);
  }
  return object as AuditRecord["metadata"];
}

function sqlAuditResult(value: unknown): AuditRecord["result"] {
  if (value !== "ALLOWED" && value !== "DENIED" && value !== "ERROR" && value !== "UNKNOWN") throw new PersistenceCorruptionError("normalized audit.result is invalid");
  return value;
}

function sqlAuditChainVersion(value: unknown): 2 {
  if (value !== 2) throw new PersistenceCorruptionError("normalized audit.chain_version is unsupported");
  return 2;
}

function outboxDigest(input: DurableOutboxInput): string {
  return digest({ organizationId: input.organizationId, eventType: input.eventType, aggregateId: input.aggregateId, payload: input.payload });
}

const DURABLE_WORKER_LANES = ["jobs", "schedule", "reconciliation", "notifications", "maintenance"] as const;
const DURABLE_WORKER_HEARTBEAT_LANES = ["outbox", ...DURABLE_WORKER_LANES] as const;

function durableWorkerJobDigest(input: DurableWorkerJobInput): string {
  return digest({ organizationId: input.organizationId, lane: input.lane, jobType: input.jobType.trim(), idempotencyKey: input.idempotencyKey.trim(), payload: input.payload, maxAttempts: input.maxAttempts ?? 5, availableAt: input.availableAt ?? null });
}

function durableWorkerMaxAttempts(value: number | undefined): number {
  const maxAttempts = value ?? 5;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new PersistenceStateError("durable worker job maxAttempts is invalid");
  return maxAttempts;
}

function validateDurableWorkerJobInput(input: DurableWorkerJobInput): void {
  if (typeof input.id !== "string" || !input.id.trim() || typeof input.organizationId !== "string" || !input.organizationId.trim()) throw new PersistenceStateError("durable worker job identity is invalid");
  if (!DURABLE_WORKER_LANES.includes(input.lane)) throw new PersistenceStateError("durable worker job lane is invalid");
  if (!input.jobType.trim() || input.jobType.length > 160) throw new PersistenceStateError("durable worker job type is invalid");
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 512) throw new PersistenceStateError("durable worker job idempotency key is invalid");
  sqlObject(input.payload, "worker job.payload");
  durableWorkerMaxAttempts(input.maxAttempts);
  if (input.availableAt !== undefined && !Number.isFinite(Date.parse(input.availableAt))) throw new PersistenceStateError("durable worker job availableAt is invalid");
}

function mapWorkerJobRow(row: WorkerJobRow): DurableWorkerJobRecord {
  const status = sqlEnum(row.status, ["PENDING", "CLAIMED", "COMPLETED", "QUARANTINED"] as const, "worker job.status");
  const attempts = sqlInteger(row.attempts, "worker job.attempts");
  if (attempts < 0) throw new PersistenceCorruptionError("worker job.attempts cannot be negative");
  const maxAttempts = sqlInteger(row.max_attempts, "worker job.max_attempts");
  if (maxAttempts < 1 || maxAttempts > 20 || attempts > maxAttempts) throw new PersistenceCorruptionError("worker job attempt budget is invalid");
  const recordDigest = sqlText(row.record_digest, "worker job.record_digest");
  if (!/^[a-f0-9]{64}$/.test(recordDigest)) throw new PersistenceCorruptionError("worker job.record_digest is not a SHA-256 digest");
  const jobType = sqlText(row.job_type, "worker job.job_type");
  const idempotencyKey = sqlText(row.idempotency_key, "worker job.idempotency_key");
  const claimedBy = sqlNullableText(row.claimed_by, "worker job.claimed_by");
  const leaseUntil = sqlNullableTimestamp(row.lease_until);
  const processedAt = sqlNullableTimestamp(row.processed_at);
  if (!jobType.trim() || jobType.length > 160 || !idempotencyKey.trim() || idempotencyKey.length > 512) throw new PersistenceCorruptionError("worker job identity fields are invalid");
  if (status === "CLAIMED" && (!claimedBy || !leaseUntil)) throw new PersistenceCorruptionError("claimed worker job has no owner or lease");
  if (status !== "CLAIMED" && (claimedBy !== null || leaseUntil !== null)) throw new PersistenceCorruptionError("non-claimed worker job retains a lease");
  if ((status === "COMPLETED" || status === "QUARANTINED") && !processedAt) throw new PersistenceCorruptionError("terminal worker job has no processed timestamp");
  if ((status === "PENDING" || status === "CLAIMED") && processedAt) throw new PersistenceCorruptionError("active worker job has a processed timestamp");
  return {
    id: sqlId(row.id, "worker job.id"),
    organizationId: sqlId(row.organization_id, "worker job.organization_id"),
    lane: sqlEnum(row.lane, DURABLE_WORKER_LANES, "worker job.lane"),
    jobType,
    idempotencyKey,
    payload: sqlObject(row.payload, "worker job.payload"),
    status,
    attempts,
    maxAttempts,
    availableAt: sqlTimestamp(row.available_at, "worker job.available_at"),
    claimedBy,
    leaseUntil,
    fenceToken: revisionOf(row.fence_token),
    lastError: sqlNullableText(row.last_error, "worker job.last_error"),
    createdAt: sqlTimestamp(row.created_at, "worker job.created_at"),
    processedAt,
    recordDigest
  };
}

function validateDurableWorkerHeartbeatInput(input: DurableWorkerHeartbeatInput, lastSeenAt: string): void {
  if (typeof input.organizationId !== "string" || !input.organizationId.trim() || !input.workerId.trim() || input.workerId.length > 160) throw new PersistenceStateError("durable worker heartbeat identity is invalid");
  if (!(["RUNNING", "DEGRADED", "STOPPING", "STOPPED"] as const).includes(input.status)) throw new PersistenceStateError("durable worker heartbeat status is invalid");
  if (input.lane !== null && !DURABLE_WORKER_HEARTBEAT_LANES.includes(input.lane)) throw new PersistenceStateError("durable worker heartbeat lane is invalid");
  if (input.cycleId !== null && (typeof input.cycleId !== "string" || !input.cycleId.trim())) throw new PersistenceStateError("durable worker heartbeat cycle is invalid");
  const startedAt = Date.parse(input.startedAt);
  const seenAt = Date.parse(lastSeenAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(seenAt) || !Number.isFinite(expiresAt) || seenAt < startedAt || expiresAt < seenAt) throw new PersistenceStateError("durable worker heartbeat timestamps are invalid");
  if (input.detail !== null && input.detail.length > 2_000) throw new PersistenceStateError("durable worker heartbeat detail is invalid");
}

function mapWorkerHeartbeatRow(row: WorkerHeartbeatRow): DurableWorkerHeartbeatRecord {
  const lane = row.lane === null ? null : sqlEnum(row.lane, DURABLE_WORKER_HEARTBEAT_LANES, "worker heartbeat.lane");
  const startedAt = sqlTimestamp(row.started_at, "worker heartbeat.started_at");
  const lastSeenAt = sqlTimestamp(row.last_seen_at, "worker heartbeat.last_seen_at");
  const expiresAt = sqlTimestamp(row.expires_at, "worker heartbeat.expires_at");
  if (Date.parse(lastSeenAt) < Date.parse(startedAt) || Date.parse(expiresAt) < Date.parse(lastSeenAt)) throw new PersistenceCorruptionError("worker heartbeat timestamps are inconsistent");
  return {
    organizationId: sqlId(row.organization_id, "worker heartbeat.organization_id"),
    workerId: sqlText(row.worker_id, "worker heartbeat.worker_id"),
    status: sqlEnum(row.status, ["RUNNING", "DEGRADED", "STOPPING", "STOPPED"] as const, "worker heartbeat.status"),
    lane,
    cycleId: row.cycle_id === null ? null : sqlId(row.cycle_id, "worker heartbeat.cycle_id"),
    startedAt,
    lastSeenAt,
    expiresAt,
    detail: sqlNullableText(row.detail, "worker heartbeat.detail"),
    updatedAt: sqlTimestamp(row.updated_at, "worker heartbeat.updated_at")
  };
}

function inboxDigest(input: DurableInboxInput): string {
  return digest({ organizationId: input.organizationId, consumer: input.consumer, provider: input.provider, externalEventId: input.externalEventId, eventType: input.eventType, schemaVersion: input.schemaVersion, signatureAlgorithm: input.signatureAlgorithm, signatureKeyRef: input.signatureKeyRef, payload: input.payload });
}

function externalEffectDigest(input: DurableExternalEffectInput): string {
  return digest({ organizationId: input.organizationId, outboxId: input.outboxId, integrationId: input.integrationId, idempotencyKey: input.idempotencyKey, request: input.request });
}

function durableUsageDigest(input: DurableUsageInput): string {
  const { id: _id, ...immutable } = input;
  return digest(immutable);
}

function mapOutboxRow(row: OutboxRow): DurableOutboxRecord {
  return {
    id: sqlId(row.id, "outbox.id"),
    organizationId: sqlId(row.organization_id, "outbox.organization_id"),
    eventType: sqlText(row.event_type, "outbox.event_type"),
    aggregateId: sqlId(row.aggregate_id, "outbox.aggregate_id"),
    payload: sqlObject(row.payload, "outbox.payload"),
    status: row.status,
    attempts: row.attempts,
    availableAt: sqlTimestamp(row.available_at, "outbox.available_at"),
    claimedBy: row.claimed_by,
    leaseUntil: sqlNullableTimestamp(row.lease_until),
    fenceToken: revisionOf(row.fence_token),
    lastError: row.last_error,
    createdAt: sqlTimestamp(row.created_at, "outbox.created_at"),
    processedAt: sqlNullableTimestamp(row.processed_at),
    recordDigest: sqlText(row.record_digest, "outbox.record_digest")
  };
}

function mapUsageRow(row: UsageRow): DurableUsageRecord {
  return {
    id: sqlId(row.id, "usage.id"),
    organizationId: sqlId(row.organization_id, "usage.organization_id"),
    reservationId: row.reservation_id ? sqlId(row.reservation_id, "usage.reservation_id") : null,
    providerRequestId: row.provider_request_id,
    idempotencyKey: sqlText(row.idempotency_key, "usage.idempotency_key"),
    usageKind: sqlText(row.usage_kind, "usage.usage_kind"),
    reservedUnits: row.reserved_units,
    consumedUnits: row.consumed_units,
    status: row.status,
    record: sqlObject(row.record, "usage.record"),
    recordDigest: sqlText(row.record_digest, "usage.record_digest"),
    createdAt: sqlTimestamp(row.created_at, "usage.created_at")
  };
}

function mapInboxRow(row: InboxRow): DurableInboxRecord {
  return {
    id: sqlId(row.id, "inbox.id"),
    organizationId: sqlId(row.organization_id, "inbox.organization_id"),
    consumer: sqlText(row.consumer, "inbox.consumer"),
    provider: sqlText(row.provider, "inbox.provider"),
    externalEventId: sqlText(row.external_event_id, "inbox.external_event_id"),
    eventType: sqlText(row.event_type, "inbox.event_type"),
    schemaVersion: row.schema_version,
    signatureAlgorithm: row.signature_algorithm,
    signatureKeyRef: sqlText(row.signature_key_ref, "inbox.signature_key_ref"),
    signature: sqlText(row.signature, "inbox.signature"),
    payload: sqlObject(row.payload, "inbox.payload"),
    recordDigest: sqlText(row.record_digest, "inbox.record_digest"),
    status: row.status,
    conflictDigest: row.conflict_digest,
    lastError: row.last_error,
    receivedAt: sqlTimestamp(row.received_at, "inbox.received_at"),
    processedAt: sqlNullableTimestamp(row.processed_at),
    lastSeenAt: sqlTimestamp(row.last_seen_at, "inbox.last_seen_at")
  };
}

function mapExternalEffectRow(row: ExternalEffectRow): DurableExternalEffectRecord {
  return {
    id: sqlId(row.id, "external_effect.id"),
    organizationId: sqlId(row.organization_id, "external_effect.organization_id"),
    outboxId: sqlId(row.outbox_id, "external_effect.outbox_id"),
    integrationId: sqlText(row.integration_id, "external_effect.integration_id"),
    idempotencyKey: sqlText(row.idempotency_key, "external_effect.idempotency_key"),
    request: sqlObject(row.request, "external_effect.request"),
    requestDigest: sqlText(row.request_digest, "external_effect.request_digest"),
    status: row.status,
    attempts: row.attempts,
    claimedBy: row.claimed_by,
    leaseUntil: sqlNullableTimestamp(row.lease_until),
    fenceToken: revisionOf(row.fence_token),
    providerRequestId: row.provider_request_id,
    response: sqlNullableObject(row.response, "external_effect.response"),
    lastError: row.last_error,
    outcomeDigest: row.outcome_digest,
    reconciliationSource: row.reconciliation_source,
    reconciledAt: sqlNullableTimestamp(row.reconciled_at),
    createdAt: sqlTimestamp(row.created_at, "external_effect.created_at"),
    updatedAt: sqlTimestamp(row.updated_at, "external_effect.updated_at")
  };
}

function mapBreakGlassRow(row: BreakGlassRow): DurableBreakGlassGrant {
  return {
    grantId: sqlId(row.id, "break_glass.grant_id"),
    organizationId: sqlId(row.organization_id, "break_glass.organization_id"),
    actorId: sqlId(row.actor_id, "break_glass.actor_id"),
    approverId: sqlId(row.approver_id, "break_glass.approver_id"),
    reason: sqlText(row.reason, "break_glass.reason"),
    target: sqlText(row.target, "break_glass.target"),
    mfaMethod: row.mfa_method,
    issuedAt: sqlTimestamp(row.issued_at, "break_glass.issued_at"),
    expiresAt: sqlTimestamp(row.expires_at, "break_glass.expires_at"),
    status: row.status,
    reviewedBy: row.reviewed_by ? sqlId(row.reviewed_by, "break_glass.reviewed_by") : null,
    reviewedAt: sqlNullableTimestamp(row.reviewed_at),
    reviewNote: row.review_note,
    revokedAt: sqlNullableTimestamp(row.revoked_at),
    createdAt: sqlTimestamp(row.created_at, "break_glass.created_at")
  };
}

function validateBreakGlassInput(input: DurableBreakGlassInput, atMs = Date.now()): void {
  if (input.mfaMethod !== "WEBAUTHN") throw new PersistenceStateError("durable break-glass grants require WebAuthn");
  if (!input.reason.trim() || input.reason.trim().length < 10 || input.reason.length > 2_000) throw new PersistenceStateError("durable break-glass reason is invalid");
  if (!input.target.trim() || input.target.length > 512) throw new PersistenceStateError("durable break-glass target is invalid");
  if (input.actorId === input.approverId) throw new PersistenceStateError("durable break-glass approval must be independent");
  const issuedAt = Date.parse(input.issuedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > atMs || expiresAt <= atMs || expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60_000) throw new PersistenceStateError("durable break-glass window is invalid");
}

function breakGlassInstant(atMs: number): string {
  if (!Number.isFinite(atMs)) throw new PersistenceStateError("break-glass clock value is invalid");
  return new Date(atMs).toISOString();
}

function validateExternalSuccess(providerRequestId: string | null | undefined, response: Record<string, unknown> | null | undefined): void {
  if (!providerRequestId?.trim() || !response || typeof response !== "object" || Array.isArray(response)) throw new PersistenceStateError("external effect success requires a provider request id and a structured receipt");
}

function canonicalSnapshot(snapshot: StoreSnapshot): unknown {
  return JSON.parse(serializeSnapshot(snapshot)) as unknown;
}

function revisionOf(value: unknown): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new PersistenceCorruptionError("persistent revision is not an integer");
  try {
    const revision = BigInt(value);
    if (revision < 0n) throw new PersistenceCorruptionError("persistent revision cannot be negative");
    return revision;
  } catch (error) {
    if (error instanceof PersistenceCorruptionError) throw error;
    throw new PersistenceCorruptionError("persistent revision is not an integer");
  }
}

function snapshotFromJson(raw: unknown, expectedDigest: string): StoreSnapshot {
  let snapshot: StoreSnapshot;
  try {
    snapshot = parseSnapshot(JSON.stringify(raw));
  } catch (error) {
    throw new PersistenceCorruptionError(`persistent snapshot failed validation: ${error instanceof Error ? error.message : String(error)}`);
  }
  const actualDigest = digest(canonicalSnapshot(snapshot));
  if (actualDigest !== expectedDigest) {
    const rawDigest = digest(raw);
    const legacy = raw && typeof raw === "object" && rawDigest === expectedDigest;
    if (!legacy) throw new PersistenceCorruptionError("persistent snapshot digest mismatch");
  }
  return snapshot;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error; rollback failure is telemetry for the caller.
  }
}

async function projectIdentity(client: PoolClient, snapshot: StoreSnapshot): Promise<void> {
  for (const organization of snapshot.organizations) {
    await client.query(
      "insert into organizations(id, name, slug, status, authorization_revision, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set name = excluded.name, slug = excluded.slug, status = excluded.status, authorization_revision = excluded.authorization_revision",
      [organization.id, organization.name, organization.slug, organization.status, organization.authorizationRevision.toString(), organization.createdAt]
    );
    await client.query(
      "insert into authorization_state(organization_id, revision, updated_at) values ($1, $2, now()) on conflict (organization_id) do update set revision = excluded.revision, updated_at = excluded.updated_at",
      [organization.id, organization.authorizationRevision.toString()]
    );
  }
  for (const unit of snapshot.units) {
    await client.query(
      "insert into units(id, organization_id, name, code, status) values ($1, $2, $3, $4, $5) on conflict (id) do update set organization_id = excluded.organization_id, name = excluded.name, code = excluded.code, status = excluded.status",
      [unit.id, unit.organizationId, unit.name, unit.code, unit.status]
    );
  }
  for (const workspace of snapshot.workspaces) {
    await client.query(
      "insert into workspaces(id, organization_id, unit_id, name, purpose, status) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name, purpose = excluded.purpose, status = excluded.status",
      [workspace.id, workspace.organizationId, workspace.unitId, workspace.name, workspace.purpose, workspace.status]
    );
  }
  for (const user of snapshot.users) {
    await client.query(
      "insert into users(id, organization_id, login, display_name, email, status, password_digest, last_login_at, password_changed_at, password_expires_at, credential_version, failed_login_attempts, locked_until, mfa_required, mfa_secret_ref, recovery_code_digests, recovery_codes_issued_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18) on conflict (id) do update set organization_id = excluded.organization_id, login = excluded.login, display_name = excluded.display_name, email = excluded.email, status = excluded.status, password_digest = excluded.password_digest, last_login_at = excluded.last_login_at, password_changed_at = excluded.password_changed_at, password_expires_at = excluded.password_expires_at, credential_version = excluded.credential_version, failed_login_attempts = excluded.failed_login_attempts, locked_until = excluded.locked_until, mfa_required = excluded.mfa_required, mfa_secret_ref = excluded.mfa_secret_ref, recovery_code_digests = excluded.recovery_code_digests, recovery_codes_issued_at = excluded.recovery_codes_issued_at",
      [user.id, user.organizationId, user.login, user.displayName, user.email, user.status, user.passwordDigest, user.lastLoginAt, user.security.passwordChangedAt, user.security.passwordExpiresAt, user.security.credentialVersion, user.security.failedLoginAttempts, user.security.lockedUntil, user.security.mfaRequired, user.security.mfaSecretRef, JSON.stringify(user.security.recoveryCodeDigests), user.security.recoveryCodesIssuedAt, user.createdAt]
    );
  }
  for (const assignment of snapshot.roleAssignments) {
    await client.query(
      "insert into role_assignments(id, organization_id, user_id, role, scope_type, unit_id, workspace_id, granted_at, revoked_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, user_id = excluded.user_id, role = excluded.role, scope_type = excluded.scope_type, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, granted_at = excluded.granted_at, revoked_at = excluded.revoked_at",
      [assignment.id, assignment.organizationId, assignment.userId, assignment.role, assignment.scopeType, assignment.unitId, assignment.workspaceId, assignment.grantedAt, assignment.revokedAt]
    );
  }
  for (const session of snapshot.sessions) {
    await client.query(
      "insert into sessions(id, organization_id, user_id, token_digest, csrf_token, expires_at, revoked_at, device_id_digest, user_agent_digest, ip_digest, last_seen_at, mfa_verified_at, credential_version, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) on conflict (id) do update set organization_id = excluded.organization_id, user_id = excluded.user_id, token_digest = excluded.token_digest, csrf_token = excluded.csrf_token, expires_at = excluded.expires_at, revoked_at = excluded.revoked_at, device_id_digest = excluded.device_id_digest, user_agent_digest = excluded.user_agent_digest, ip_digest = excluded.ip_digest, last_seen_at = excluded.last_seen_at, mfa_verified_at = excluded.mfa_verified_at, credential_version = excluded.credential_version",
      [session.id, session.organizationId, session.userId, session.tokenDigest, session.csrfToken, session.expiresAt, session.revokedAt, session.deviceIdDigest, session.userAgentDigest, session.ipDigest, session.lastSeenAt, session.mfaVerifiedAt, session.credentialVersion, session.createdAt]
    );
  }
  for (const challenge of snapshot.authChallenges) {
    await client.query(
      "insert into auth_challenges(id, organization_id, user_id, type, token_digest, credential_version, expires_at, attempts, max_attempts, status, consumed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, user_id = excluded.user_id, type = excluded.type, token_digest = excluded.token_digest, credential_version = excluded.credential_version, expires_at = excluded.expires_at, attempts = excluded.attempts, max_attempts = excluded.max_attempts, status = excluded.status, consumed_at = excluded.consumed_at",
      [challenge.id, challenge.organizationId, challenge.userId, challenge.type, challenge.tokenDigest, challenge.credentialVersion, challenge.expiresAt, challenge.attempts, challenge.maxAttempts, challenge.status, challenge.consumedAt, challenge.createdAt]
    );
  }
}

async function writeRows<T>(client: PoolClient, sql: string, rows: T[], values: (row: T) => unknown[]): Promise<void> {
  for (const row of rows) await client.query(sql, values(row));
}

async function writeScopedRows<T>(client: PoolClient, sql: string, rows: T[], scope: (row: T) => { unitId: OpaqueId | null; workspaceId: OpaqueId | null }, values: (row: T) => unknown[]): Promise<void> {
  for (const row of rows) {
    const selected = scope(row);
    if (!selected.unitId || !selected.workspaceId) {
      throw new PersistenceCorruptionError("contextual projection row has no complete unit/workspace scope");
    }
    await client.query("select set_config('cvg.unit_id', $1, true)", [selected.unitId]);
    await client.query("select set_config('cvg.workspace_id', $1, true)", [selected.workspaceId]);
    await client.query(sql, values(row));
  }
}

async function writeContextualRows<T>(client: PoolClient, sql: string, rows: T[], scope: (row: T) => { unitId: OpaqueId | null; workspaceId: OpaqueId | null }, values: (row: T) => unknown[]): Promise<void> {
  for (const row of rows) {
    const selected = scope(row);
    if ((selected.unitId === null) !== (selected.workspaceId === null)) {
      throw new PersistenceCorruptionError("contextual projection row has a partial unit/workspace scope");
    }
    await client.query("select set_config('cvg.unit_id', $1, true)", [selected.unitId ?? ""]);
    await client.query("select set_config('cvg.workspace_id', $1, true)", [selected.workspaceId ?? ""]);
    await client.query(sql, values(row));
  }
}

async function writeUnitRows<T>(client: PoolClient, sql: string, rows: T[], unit: (row: T) => OpaqueId | null, values: (row: T) => unknown[]): Promise<void> {
  for (const row of rows) {
    const unitId = unit(row);
    if (!unitId) throw new PersistenceCorruptionError("unit-scoped projection row has no unit scope");
    await client.query("select set_config('cvg.unit_id', $1, true)", [unitId]);
    await client.query("select set_config('cvg.workspace_id', '', true)");
    await client.query(sql, values(row));
  }
}

async function projectAiTurnUsage(client: PoolClient, snapshot: StoreSnapshot): Promise<void> {
  for (const turn of snapshot.aiTurns) {
    if ((turn.usage === undefined) !== (turn.provenance === undefined)) throw new PersistenceCorruptionError(`ai turn ${turn.id} has an incomplete provenance/usage pair`);
    if (!turn.usage || !turn.provenance) continue;
    const session = snapshot.aiSessions.find((candidate) => candidate.id === turn.sessionId);
    if (!session) throw new PersistenceCorruptionError(`ai turn ${turn.id} has no resolvable session for usage scope`);
    if (turn.provenance.usageRecordId !== turn.usage.id) throw new PersistenceCorruptionError(`ai turn ${turn.id} provenance does not bind its usage record`);
    const input: DurableUsageInput = {
      id: turn.usage.id,
      organizationId: session.organizationId,
      reservationId: turn.usage.reservationId,
      providerRequestId: turn.usage.providerRequestId,
      idempotencyKey: turn.usage.idempotencyKey,
      usageKind: turn.usage.usageKind,
      reservedUnits: turn.usage.reservedUnits,
      consumedUnits: turn.usage.consumedUnits,
      status: turn.usage.status,
      record: turn.usage.record
    };
    const result = await client.query<{ id: string }>(
      "insert into ai_usage_ledger(id, organization_id, reservation_id, provider_request_id, idempotency_key, usage_kind, reserved_units, consumed_units, status, record, record_digest, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) on conflict (organization_id, idempotency_key, usage_kind) do update set reserved_units = excluded.reserved_units, consumed_units = excluded.consumed_units, status = excluded.status, record = excluded.record, record_digest = excluded.record_digest, provider_request_id = excluded.provider_request_id, reservation_id = excluded.reservation_id where ai_usage_ledger.record_digest = excluded.record_digest returning id",
      [input.id, input.organizationId, input.reservationId, input.providerRequestId, input.idempotencyKey, input.usageKind, input.reservedUnits, input.consumedUnits, input.status, JSON.stringify(input.record), durableUsageDigest(input), turn.createdAt]
    );
    if (!result.rows[0]) throw new PersistenceCorruptionError(`ai turn usage ${input.id} conflicts with a different idempotency record`);
  }
}

async function writeAuthoritativePatient(client: PoolClient, patient: AnimalPatient): Promise<void> {
  if (!patient.unitId || !patient.workspaceId) throw new PersistenceCorruptionError(`patient ${patient.id} has no complete unit/workspace scope for authoritative write`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [patient.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [patient.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into patients(id, organization_id, unit_id, workspace_id, guardian_id, name, species, breed, sex, reproductive_status, birth_date, identifiers, data_class, status, merged_into_id, status_changed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, guardian_id = excluded.guardian_id, name = excluded.name, species = excluded.species, breed = excluded.breed, sex = excluded.sex, reproductive_status = excluded.reproductive_status, birth_date = excluded.birth_date, identifiers = excluded.identifiers, data_class = excluded.data_class, status = excluded.status, merged_into_id = excluded.merged_into_id, status_changed_at = excluded.status_changed_at where patients.organization_id = excluded.organization_id and patients.unit_id is not distinct from excluded.unit_id and patients.workspace_id is not distinct from excluded.workspace_id and patients.guardian_id = excluded.guardian_id and patients.name = excluded.name and patients.species = excluded.species and patients.breed is not distinct from excluded.breed and patients.sex = excluded.sex and patients.reproductive_status = excluded.reproductive_status and patients.birth_date is not distinct from excluded.birth_date and patients.identifiers = excluded.identifiers and patients.data_class = excluded.data_class and patients.status = excluded.status and patients.merged_into_id is not distinct from excluded.merged_into_id and patients.status_changed_at is not distinct from excluded.status_changed_at and patients.created_at = excluded.created_at returning id::text",
    [patient.id, patient.organizationId, patient.unitId, patient.workspaceId, patient.guardianId, patient.name, patient.species, patient.breed, patient.sex, patient.reproductiveStatus, patient.birthDate, JSON.stringify(patient.identifiers), patient.dataClass, patient.status, patient.mergedIntoId, patient.statusChangedAt, patient.createdAt]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative patient ${patient.id} conflicts with an existing normalized row`);
}

async function writeAuthoritativeAppointment(client: PoolClient, appointment: Appointment): Promise<void> {
  if (!appointment.unitId || !appointment.workspaceId) throw new PersistenceCorruptionError(`appointment ${appointment.id} has no complete unit/workspace scope for authoritative write`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [appointment.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [appointment.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into appointments(id, organization_id, unit_id, workspace_id, patient_id, provider_id, resource_id, service_id, starts_at, ends_at, purpose, status, version, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, provider_id = excluded.provider_id, resource_id = excluded.resource_id, service_id = excluded.service_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at, purpose = excluded.purpose, status = excluded.status, version = excluded.version where appointments.organization_id = excluded.organization_id and appointments.unit_id = excluded.unit_id and appointments.workspace_id = excluded.workspace_id and appointments.patient_id = excluded.patient_id and appointments.provider_id = excluded.provider_id and appointments.resource_id is not distinct from excluded.resource_id and appointments.service_id = excluded.service_id and appointments.starts_at = excluded.starts_at and appointments.ends_at = excluded.ends_at and appointments.purpose = excluded.purpose and appointments.status = excluded.status and appointments.version = excluded.version and appointments.created_at = excluded.created_at returning id::text",
    [appointment.id, appointment.organizationId, appointment.unitId, appointment.workspaceId, appointment.patientId, appointment.providerId, appointment.resourceId, appointment.serviceId, appointment.startsAt, appointment.endsAt, appointment.purpose, appointment.status, appointment.version, appointment.createdAt]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative appointment ${appointment.id} conflicts with an existing normalized row`);
}

async function writeAuthoritativeEncounter(client: PoolClient, encounter: Encounter): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw new PersistenceCorruptionError(`encounter ${encounter.id} has no complete unit/workspace scope for authoritative write`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into encounters(id, organization_id, unit_id, workspace_id, patient_id, appointment_id, chief_complaint, urgency, status, opened_at, closed_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, appointment_id = excluded.appointment_id, chief_complaint = excluded.chief_complaint, urgency = excluded.urgency, status = excluded.status, opened_at = excluded.opened_at, closed_at = excluded.closed_at where encounters.organization_id = excluded.organization_id and encounters.unit_id = excluded.unit_id and encounters.workspace_id = excluded.workspace_id and encounters.patient_id = excluded.patient_id and encounters.appointment_id is not distinct from excluded.appointment_id and encounters.chief_complaint = excluded.chief_complaint and encounters.urgency = excluded.urgency and encounters.status = excluded.status and encounters.opened_at = excluded.opened_at and encounters.closed_at is not distinct from excluded.closed_at returning id::text",
    [encounter.id, encounter.organizationId, encounter.unitId, encounter.workspaceId, encounter.patientId, encounter.appointmentId, encounter.chiefComplaint, encounter.urgency, encounter.status, encounter.openedAt, encounter.closedAt]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative encounter ${encounter.id} conflicts with an existing normalized row`);
}

async function writeAuthoritativeClinicalDocument(client: PoolClient, document: ClinicalDocument, encounter: Encounter): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw new PersistenceCorruptionError(`clinical document ${document.id} has no complete encounter scope for authoritative sign`);
  if (document.status !== "SIGNED" || document.version < 2 || !document.signedAt || !document.signedBy) throw new PersistenceCorruptionError(`authoritative clinical sign ${document.id} has an incomplete signed state`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "update clinical_documents set status = $1, version = $2, signed_at = $3, signed_by = $4 where id = $5 and organization_id = $6 and unit_id = $7 and workspace_id = $8 and encounter_id = $9 and patient_id = $10 and author_id = $11 and document_type = $12 and title = $13 and content = $14 and data_class = $15 and status in ('DRAFT', 'REVIEW') and version = $2 - 1 and signed_at is null and signed_by is null and created_at = $16 returning id::text",
    [document.status, document.version, document.signedAt, document.signedBy, document.id, document.organizationId, encounter.unitId, encounter.workspaceId, document.encounterId, document.patientId, document.authorId, document.documentType, document.title, document.content, document.dataClass, document.createdAt]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative clinical sign ${document.id} conflicts with an existing normalized row`);
}

async function writeAuthoritativeGuardian(client: PoolClient, guardian: Guardian): Promise<void> {
  if (!guardian.unitId || !guardian.workspaceId) throw new PersistenceCorruptionError(`guardian ${guardian.id} has no complete unit/workspace scope for authoritative write`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [guardian.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [guardian.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into guardians(id, organization_id, unit_id, workspace_id, display_name, phone, email, data_class, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, display_name = excluded.display_name, phone = excluded.phone, email = excluded.email, data_class = excluded.data_class, status = excluded.status where guardians.organization_id = excluded.organization_id and guardians.unit_id is not distinct from excluded.unit_id and guardians.workspace_id is not distinct from excluded.workspace_id and guardians.display_name = excluded.display_name and guardians.phone = excluded.phone and guardians.email is not distinct from excluded.email and guardians.data_class = excluded.data_class and guardians.status = excluded.status returning id::text",
    [guardian.id, guardian.organizationId, guardian.unitId, guardian.workspaceId, guardian.displayName, guardian.phone, guardian.email, guardian.dataClass, guardian.status]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative guardian ${guardian.id} conflicts with an existing normalized row`);
}

async function writeAuthoritativeDiagnosticRequest(client: PoolClient, request: DiagnosticRequest, encounter: Encounter): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw new PersistenceCorruptionError(`diagnostic request ${request.id} has no complete encounter scope for authoritative write`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into diagnostic_requests(id, organization_id, unit_id, workspace_id, patient_id, encounter_id, test_name, priority, status, requested_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, test_name = excluded.test_name, priority = excluded.priority, status = excluded.status, requested_by = excluded.requested_by where diagnostic_requests.organization_id = excluded.organization_id and diagnostic_requests.unit_id = excluded.unit_id and diagnostic_requests.workspace_id = excluded.workspace_id and diagnostic_requests.patient_id = excluded.patient_id and diagnostic_requests.encounter_id is not distinct from excluded.encounter_id and diagnostic_requests.test_name = excluded.test_name and diagnostic_requests.priority = excluded.priority and diagnostic_requests.status = excluded.status and diagnostic_requests.requested_by = excluded.requested_by and diagnostic_requests.created_at = excluded.created_at returning id::text",
    [request.id, request.organizationId, encounter.unitId, encounter.workspaceId, request.patientId, request.encounterId, request.testName, request.priority, request.status, request.requestedBy, request.createdAt]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative diagnostic request ${request.id} conflicts with an existing normalized row`);
}

async function writeAuthoritativeSpecimen(client: PoolClient, specimen: Specimen, encounter: Encounter): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw new PersistenceCorruptionError(`specimen ${specimen.id} has no complete encounter scope for authoritative write`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into specimens(id, organization_id, unit_id, workspace_id, request_id, patient_id, label, collected_at, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, request_id = excluded.request_id, patient_id = excluded.patient_id, label = excluded.label, collected_at = excluded.collected_at, status = excluded.status where specimens.organization_id = excluded.organization_id and specimens.unit_id = excluded.unit_id and specimens.workspace_id = excluded.workspace_id and specimens.request_id = excluded.request_id and specimens.patient_id = excluded.patient_id and specimens.label = excluded.label and specimens.collected_at = excluded.collected_at and specimens.status = excluded.status returning id::text",
    [specimen.id, specimen.organizationId, encounter.unitId, encounter.workspaceId, specimen.requestId, specimen.patientId, specimen.label, specimen.collectedAt, specimen.status]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative specimen ${specimen.id} conflicts with an existing normalized row`);
}

async function writeAuthoritativeDiagnosticResult(client: PoolClient, resultRow: DiagnosticResult, encounter: Encounter): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw new PersistenceCorruptionError(`diagnostic result ${resultRow.id} has no complete encounter scope for authoritative write`);
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into diagnostic_results(id, organization_id, unit_id, workspace_id, request_id, specimen_id, patient_id, value, source, source_version, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, request_id = excluded.request_id, specimen_id = excluded.specimen_id, patient_id = excluded.patient_id, value = excluded.value, source = excluded.source, source_version = excluded.source_version, status = excluded.status where diagnostic_results.organization_id = excluded.organization_id and diagnostic_results.unit_id = excluded.unit_id and diagnostic_results.workspace_id = excluded.workspace_id and diagnostic_results.request_id = excluded.request_id and diagnostic_results.specimen_id = excluded.specimen_id and diagnostic_results.patient_id = excluded.patient_id and diagnostic_results.value = excluded.value and diagnostic_results.source = excluded.source and diagnostic_results.source_version = excluded.source_version and diagnostic_results.status = excluded.status and diagnostic_results.created_at = excluded.created_at returning id::text",
    [resultRow.id, resultRow.organizationId, encounter.unitId, encounter.workspaceId, resultRow.requestId, resultRow.specimenId, resultRow.patientId, resultRow.value, resultRow.source, resultRow.sourceVersion, resultRow.status, resultRow.createdAt]
  );
  if (!result.rows[0]) throw new PersistenceCorruptionError(`authoritative diagnostic result ${resultRow.id} conflicts with an existing normalized row`);
}

async function projectDomain(client: PoolClient, snapshot: StoreSnapshot, normalizedPatientWrite: AnimalPatient | null = null, normalizedAppointmentWrite: Appointment | null = null, normalizedEncounterWrite: Encounter | null = null, normalizedClinicalSignWrite: ClinicalDocument | null = null, normalizedClinicalSignReplayId: OpaqueId | null = null, normalizedGuardianWrite: Guardian | null = null, normalizedGuardianReplayId: OpaqueId | null = null, normalizedDiagnosticRequestWrite: DiagnosticRequest | null = null, normalizedDiagnosticRequestReplayId: OpaqueId | null = null, normalizedSpecimenWrite: Specimen | null = null, normalizedSpecimenReplayId: OpaqueId | null = null, normalizedDiagnosticResultWrite: DiagnosticResult | null = null, normalizedDiagnosticResultReplayId: OpaqueId | null = null): Promise<void> {
  if (normalizedGuardianWrite && normalizedGuardianReplayId) throw new PersistenceCorruptionError("authoritative guardian write and replay cannot be requested together");
  if (normalizedDiagnosticRequestWrite && normalizedDiagnosticRequestReplayId) throw new PersistenceCorruptionError("authoritative diagnostic request write and replay cannot be requested together");
  if (normalizedSpecimenWrite && normalizedSpecimenReplayId) throw new PersistenceCorruptionError("authoritative specimen write and replay cannot be requested together");
  if (normalizedDiagnosticResultWrite && normalizedDiagnosticResultReplayId) throw new PersistenceCorruptionError("authoritative diagnostic result write and replay cannot be requested together");
  let guardians = snapshot.guardians;
  if (normalizedGuardianWrite) {
    const snapshotGuardian = snapshot.guardians.find((guardian) => guardian.id === normalizedGuardianWrite.id);
    const organization = snapshot.organizations.find((candidate) => candidate.id === normalizedGuardianWrite.organizationId);
    const unit = normalizedGuardianWrite.unitId ? snapshot.units.find((candidate) => candidate.id === normalizedGuardianWrite.unitId) : null;
    const workspace = normalizedGuardianWrite.workspaceId ? snapshot.workspaces.find((candidate) => candidate.id === normalizedGuardianWrite.workspaceId) : null;
    if (!snapshotGuardian || digest(snapshotGuardian) !== digest(normalizedGuardianWrite)) throw new PersistenceCorruptionError(`authoritative guardian ${normalizedGuardianWrite.id} is not identical to the canonical snapshot`);
    if (!organization || !unit || unit.organizationId !== normalizedGuardianWrite.organizationId || !workspace || workspace.organizationId !== normalizedGuardianWrite.organizationId || workspace.unitId !== normalizedGuardianWrite.unitId) throw new PersistenceCorruptionError(`authoritative guardian ${normalizedGuardianWrite.id} has unresolved organization or scope dependencies`);
    await writeAuthoritativeGuardian(client, normalizedGuardianWrite);
    guardians = snapshot.guardians.filter((guardian) => guardian.id !== normalizedGuardianWrite.id);
  }
  if (normalizedGuardianReplayId) {
    const replayed = snapshot.guardians.find((guardian) => guardian.id === normalizedGuardianReplayId);
    if (!replayed || !replayed.unitId || !replayed.workspaceId) throw new PersistenceCorruptionError(`guardian replay ${normalizedGuardianReplayId} has no durable scoped state`);
    guardians = snapshot.guardians.filter((guardian) => guardian.id !== normalizedGuardianReplayId);
  }
  await writeScopedRows(client,
    "insert into guardians(id, organization_id, unit_id, workspace_id, display_name, phone, email, data_class, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, display_name = excluded.display_name, phone = excluded.phone, email = excluded.email, data_class = excluded.data_class, status = excluded.status",
    guardians,
    (guardian) => ({ unitId: guardian.unitId, workspaceId: guardian.workspaceId }),
    (guardian) => [guardian.id, guardian.organizationId, guardian.unitId, guardian.workspaceId, guardian.displayName, guardian.phone, guardian.email, guardian.dataClass, guardian.status]
  );
  let patients = snapshot.patients;
  if (normalizedPatientWrite) {
    const snapshotPatient = snapshot.patients.find((patient) => patient.id === normalizedPatientWrite.id);
    if (!snapshotPatient || digest(snapshotPatient) !== digest(normalizedPatientWrite)) throw new PersistenceCorruptionError(`authoritative patient ${normalizedPatientWrite.id} is not identical to the canonical snapshot`);
    if (!snapshot.guardians.some((guardian) => guardian.id === normalizedPatientWrite.guardianId)) throw new PersistenceCorruptionError(`authoritative patient ${normalizedPatientWrite.id} has no guardian in the canonical snapshot`);
    await writeAuthoritativePatient(client, normalizedPatientWrite);
    patients = snapshot.patients.filter((patient) => patient.id !== normalizedPatientWrite.id);
  }
  await writeScopedRows(client,
    "insert into patients(id, organization_id, unit_id, workspace_id, guardian_id, name, species, breed, sex, reproductive_status, birth_date, identifiers, data_class, status, merged_into_id, status_changed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, guardian_id = excluded.guardian_id, name = excluded.name, species = excluded.species, breed = excluded.breed, sex = excluded.sex, reproductive_status = excluded.reproductive_status, birth_date = excluded.birth_date, identifiers = excluded.identifiers, data_class = excluded.data_class, status = excluded.status, merged_into_id = excluded.merged_into_id, status_changed_at = excluded.status_changed_at",
    patients,
    (patient) => ({ unitId: patient.unitId, workspaceId: patient.workspaceId }),
    (patient) => [patient.id, patient.organizationId, patient.unitId, patient.workspaceId, patient.guardianId, patient.name, patient.species, patient.breed, patient.sex, patient.reproductiveStatus, patient.birthDate, JSON.stringify(patient.identifiers), patient.dataClass, patient.status, patient.mergedIntoId, patient.statusChangedAt, patient.createdAt]
  );
  await client.query("select set_config('cvg.unit_id', '', true)");
  await client.query("select set_config('cvg.workspace_id', '', true)");
  await writeRows(client,
    "insert into service_catalog_items(id, organization_id, name, duration_minutes, price_cents, status) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set organization_id = excluded.organization_id, name = excluded.name, duration_minutes = excluded.duration_minutes, price_cents = excluded.price_cents, status = excluded.status",
    snapshot.services,
    (service) => [service.id, service.organizationId, service.name, service.durationMinutes, service.priceCents, service.status]
  );
  await writeUnitRows(client,
    "insert into providers(id, organization_id, unit_id, display_name, specialty, role, status) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, display_name = excluded.display_name, specialty = excluded.specialty, role = excluded.role, status = excluded.status",
    snapshot.providers,
    (provider) => provider.unitId,
    (provider) => [provider.id, provider.organizationId, provider.unitId, provider.displayName, provider.specialty, provider.role, provider.status]
  );
  await writeUnitRows(client,
    "insert into resources(id, organization_id, unit_id, name, kind, status) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name, kind = excluded.kind, status = excluded.status",
    snapshot.resources,
    (resource) => resource.unitId,
    (resource) => [resource.id, resource.organizationId, resource.unitId, resource.name, resource.kind, resource.status]
  );
  let appointments = snapshot.appointments;
  if (normalizedAppointmentWrite) {
    const snapshotAppointment = snapshot.appointments.find((appointment) => appointment.id === normalizedAppointmentWrite.id);
    if (!snapshotAppointment || digest(snapshotAppointment) !== digest(normalizedAppointmentWrite)) throw new PersistenceCorruptionError(`authoritative appointment ${normalizedAppointmentWrite.id} is not identical to the canonical snapshot`);
    const patient = snapshot.patients.find((candidate) => candidate.id === normalizedAppointmentWrite.patientId);
    const provider = snapshot.providers.find((candidate) => candidate.id === normalizedAppointmentWrite.providerId);
    const service = snapshot.services.find((candidate) => candidate.id === normalizedAppointmentWrite.serviceId);
    const resource = normalizedAppointmentWrite.resourceId ? snapshot.resources.find((candidate) => candidate.id === normalizedAppointmentWrite.resourceId) : null;
    if (!snapshot.organizations.some((organization) => organization.id === normalizedAppointmentWrite.organizationId) || !patient || patient.organizationId !== normalizedAppointmentWrite.organizationId || patient.unitId !== normalizedAppointmentWrite.unitId || patient.workspaceId !== normalizedAppointmentWrite.workspaceId || !provider || provider.organizationId !== normalizedAppointmentWrite.organizationId || provider.unitId !== normalizedAppointmentWrite.unitId || !service || service.organizationId !== normalizedAppointmentWrite.organizationId || (normalizedAppointmentWrite.resourceId && (!resource || resource.organizationId !== normalizedAppointmentWrite.organizationId || resource.unitId !== normalizedAppointmentWrite.unitId))) {
      throw new PersistenceCorruptionError(`authoritative appointment ${normalizedAppointmentWrite.id} has unresolved organization or scope dependencies`);
    }
    await writeAuthoritativeAppointment(client, normalizedAppointmentWrite);
    appointments = snapshot.appointments.filter((appointment) => appointment.id !== normalizedAppointmentWrite.id);
  }
  await writeScopedRows(client,
    "insert into appointments(id, organization_id, unit_id, workspace_id, patient_id, provider_id, resource_id, service_id, starts_at, ends_at, purpose, status, version, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, provider_id = excluded.provider_id, resource_id = excluded.resource_id, service_id = excluded.service_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at, purpose = excluded.purpose, status = excluded.status, version = excluded.version",
    appointments,
    (appointment) => ({ unitId: appointment.unitId, workspaceId: appointment.workspaceId }),
    (appointment) => [appointment.id, appointment.organizationId, appointment.unitId, appointment.workspaceId, appointment.patientId, appointment.providerId, appointment.resourceId, appointment.serviceId, appointment.startsAt, appointment.endsAt, appointment.purpose, appointment.status, appointment.version, appointment.createdAt]
  );
  await writeUnitRows(client,
    "insert into queue_entries(id, organization_id, unit_id, appointment_id, patient_id, status, priority, checked_in_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, appointment_id = excluded.appointment_id, patient_id = excluded.patient_id, status = excluded.status, priority = excluded.priority, checked_in_at = excluded.checked_in_at",
    snapshot.queueEntries,
    (entry) => entry.unitId,
    (entry) => [entry.id, entry.organizationId, entry.unitId, entry.appointmentId, entry.patientId, entry.status, entry.priority, entry.checkedInAt]
  );
  let encounters = snapshot.encounters;
  if (normalizedEncounterWrite) {
    const snapshotEncounter = snapshot.encounters.find((encounter) => encounter.id === normalizedEncounterWrite.id);
    if (!snapshotEncounter || digest(snapshotEncounter) !== digest(normalizedEncounterWrite)) throw new PersistenceCorruptionError(`authoritative encounter ${normalizedEncounterWrite.id} is not identical to the canonical snapshot`);
    const encounterPatient = snapshot.patients.find((patient) => patient.id === normalizedEncounterWrite.patientId);
    const encounterAppointment = normalizedEncounterWrite.appointmentId ? snapshot.appointments.find((appointment) => appointment.id === normalizedEncounterWrite.appointmentId) : null;
    if (!snapshot.organizations.some((organization) => organization.id === normalizedEncounterWrite.organizationId) || !encounterPatient || encounterPatient.organizationId !== normalizedEncounterWrite.organizationId || encounterPatient.unitId !== normalizedEncounterWrite.unitId || encounterPatient.workspaceId !== normalizedEncounterWrite.workspaceId || (normalizedEncounterWrite.appointmentId && (!encounterAppointment || encounterAppointment.organizationId !== normalizedEncounterWrite.organizationId || encounterAppointment.unitId !== normalizedEncounterWrite.unitId || encounterAppointment.workspaceId !== normalizedEncounterWrite.workspaceId || encounterAppointment.patientId !== normalizedEncounterWrite.patientId))) {
      throw new PersistenceCorruptionError(`authoritative encounter ${normalizedEncounterWrite.id} has unresolved organization or scope dependencies`);
    }
    await writeAuthoritativeEncounter(client, normalizedEncounterWrite);
    encounters = snapshot.encounters.filter((encounter) => encounter.id !== normalizedEncounterWrite.id);
  }
  await writeScopedRows(client,
    "insert into encounters(id, organization_id, unit_id, workspace_id, patient_id, appointment_id, chief_complaint, urgency, status, opened_at, closed_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, appointment_id = excluded.appointment_id, chief_complaint = excluded.chief_complaint, urgency = excluded.urgency, status = excluded.status, opened_at = excluded.opened_at, closed_at = excluded.closed_at",
    encounters,
    (encounter) => ({ unitId: encounter.unitId, workspaceId: encounter.workspaceId }),
    (encounter) => [encounter.id, encounter.organizationId, encounter.unitId, encounter.workspaceId, encounter.patientId, encounter.appointmentId, encounter.chiefComplaint, encounter.urgency, encounter.status, encounter.openedAt, encounter.closedAt]
  );
  const encounterById = new Map(snapshot.encounters.map((encounter) => [encounter.id, encounter]));
  const clinicalDocuments = snapshot.clinicalDocuments.map((document) => {
    const encounter = encounterById.get(document.encounterId);
    if (!encounter || encounter.organizationId !== document.organizationId || encounter.patientId !== document.patientId) throw new PersistenceCorruptionError(`clinical document ${document.id} has no organization-bound encounter`);
    return { document, encounter };
  });
  let clinicalDocumentRows = clinicalDocuments;
  if (normalizedClinicalSignWrite) {
    const signed = clinicalDocuments.find(({ document }) => document.id === normalizedClinicalSignWrite.id);
    if (!signed || digest(signed.document) !== digest(normalizedClinicalSignWrite)) throw new PersistenceCorruptionError(`authoritative clinical sign ${normalizedClinicalSignWrite.id} is not identical to the canonical snapshot`);
    const signer = snapshot.users.find((user) => user.id === normalizedClinicalSignWrite.signedBy);
    if (normalizedClinicalSignWrite.organizationId !== signed.encounter.organizationId || normalizedClinicalSignWrite.patientId !== signed.encounter.patientId || !signer || signer.organizationId !== normalizedClinicalSignWrite.organizationId) throw new PersistenceCorruptionError(`authoritative clinical sign ${normalizedClinicalSignWrite.id} has unresolved organization, patient or signer dependencies`);
    await writeAuthoritativeClinicalDocument(client, normalizedClinicalSignWrite, signed.encounter);
    clinicalDocumentRows = clinicalDocuments.filter(({ document }) => document.id !== normalizedClinicalSignWrite.id);
  }
  if (normalizedClinicalSignReplayId) {
    const replayed = clinicalDocuments.find(({ document }) => document.id === normalizedClinicalSignReplayId);
    if (!replayed || replayed.document.status !== "SIGNED" || replayed.document.version < 2 || !replayed.document.signedAt || !replayed.document.signedBy) throw new PersistenceCorruptionError(`clinical sign replay ${normalizedClinicalSignReplayId} has no durable signed state`);
    clinicalDocumentRows = clinicalDocumentRows.filter(({ document }) => document.id !== normalizedClinicalSignReplayId);
  }
  await writeScopedRows(client,
    "insert into clinical_documents(id, organization_id, unit_id, workspace_id, encounter_id, patient_id, author_id, document_type, title, content, data_class, status, version, signed_at, signed_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, encounter_id = excluded.encounter_id, patient_id = excluded.patient_id, author_id = excluded.author_id, document_type = excluded.document_type, title = excluded.title, content = excluded.content, data_class = excluded.data_class, status = excluded.status, version = excluded.version, signed_at = excluded.signed_at, signed_by = excluded.signed_by",
    clinicalDocumentRows,
    ({ encounter }) => ({ unitId: encounter.unitId, workspaceId: encounter.workspaceId }),
    ({ document, encounter }) => [document.id, document.organizationId, encounter.unitId, encounter.workspaceId, document.encounterId, document.patientId, document.authorId, document.documentType, document.title, document.content, document.dataClass, document.status, document.version, document.signedAt, document.signedBy, document.createdAt]
  );
  const documentById = new Map(clinicalDocuments.map(({ document, encounter }) => [document.id, { document, encounter }]));
  const clinicalAddendumRows = snapshot.clinicalAddenda.map((addendum) => {
    const scope = documentById.get(addendum.documentId);
    if (!scope) throw new PersistenceCorruptionError(`clinical addendum ${addendum.id} has no organization-bound document`);
    return { addendum, ...scope };
  });
  await writeScopedRows(client,
    "insert into clinical_addenda(id, organization_id, unit_id, workspace_id, document_id, author_id, reason, content, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, document_id = excluded.document_id, author_id = excluded.author_id, reason = excluded.reason, content = excluded.content",
    clinicalAddendumRows,
    ({ encounter }) => ({ unitId: encounter.unitId, workspaceId: encounter.workspaceId }),
    ({ addendum, document, encounter }) => [addendum.id, document.organizationId, encounter.unitId, encounter.workspaceId, addendum.documentId, addendum.authorId, addendum.reason, addendum.content, addendum.createdAt]
  );
  await client.query("select set_config('cvg.unit_id', '', true)");
  await client.query("select set_config('cvg.workspace_id', '', true)");
  let diagnosticRequests = snapshot.diagnosticRequests;
  if (normalizedDiagnosticRequestWrite) {
    const snapshotRequest = snapshot.diagnosticRequests.find((request) => request.id === normalizedDiagnosticRequestWrite.id);
    const patient = snapshot.patients.find((candidate) => candidate.id === normalizedDiagnosticRequestWrite.patientId);
    const encounter = normalizedDiagnosticRequestWrite.encounterId ? snapshot.encounters.find((candidate) => candidate.id === normalizedDiagnosticRequestWrite.encounterId) : null;
    const requester = snapshot.users.find((candidate) => candidate.id === normalizedDiagnosticRequestWrite.requestedBy);
    if (!snapshotRequest || digest(snapshotRequest) !== digest(normalizedDiagnosticRequestWrite)) throw new PersistenceCorruptionError(`authoritative diagnostic request ${normalizedDiagnosticRequestWrite.id} is not identical to the canonical snapshot`);
    if (!patient || patient.organizationId !== normalizedDiagnosticRequestWrite.organizationId || !encounter || encounter.organizationId !== normalizedDiagnosticRequestWrite.organizationId || encounter.patientId !== normalizedDiagnosticRequestWrite.patientId || patient.unitId !== encounter.unitId || patient.workspaceId !== encounter.workspaceId || !encounter.unitId || !encounter.workspaceId || !requester || requester.organizationId !== normalizedDiagnosticRequestWrite.organizationId) {
      throw new PersistenceCorruptionError(`authoritative diagnostic request ${normalizedDiagnosticRequestWrite.id} has unresolved organization or scope dependencies`);
    }
    await writeAuthoritativeDiagnosticRequest(client, normalizedDiagnosticRequestWrite, encounter);
    diagnosticRequests = snapshot.diagnosticRequests.filter((request) => request.id !== normalizedDiagnosticRequestWrite.id);
  }
  if (normalizedDiagnosticRequestReplayId) {
    const replayed = snapshot.diagnosticRequests.find((request) => request.id === normalizedDiagnosticRequestReplayId);
    const encounter = replayed?.encounterId ? snapshot.encounters.find((candidate) => candidate.id === replayed.encounterId) : null;
    if (!replayed || !encounter || !encounter.unitId || !encounter.workspaceId) throw new PersistenceCorruptionError(`diagnostic request replay ${normalizedDiagnosticRequestReplayId} has no durable scoped state`);
    diagnosticRequests = snapshot.diagnosticRequests.filter((request) => request.id !== normalizedDiagnosticRequestReplayId);
  }
  for (const request of diagnosticRequests) {
    const encounter = request.encounterId ? encounterById.get(request.encounterId) : null;
    if (request.encounterId && (!encounter || !encounter.unitId || !encounter.workspaceId || encounter.organizationId !== request.organizationId || encounter.patientId !== request.patientId)) {
      throw new PersistenceCorruptionError(`diagnostic request ${request.id} has no organization-bound encounter scope`);
    }
    await client.query("select set_config('cvg.unit_id', $1, true)", [encounter?.unitId ?? ""]);
    await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter?.workspaceId ?? ""]);
    await client.query(
      "insert into diagnostic_requests(id, organization_id, unit_id, workspace_id, patient_id, encounter_id, test_name, priority, status, requested_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, test_name = excluded.test_name, priority = excluded.priority, status = excluded.status, requested_by = excluded.requested_by",
      [request.id, request.organizationId, encounter?.unitId ?? null, encounter?.workspaceId ?? null, request.patientId, request.encounterId, request.testName, request.priority, request.status, request.requestedBy, request.createdAt]
    );
  }
  await client.query("select set_config('cvg.unit_id', '', true)");
  await client.query("select set_config('cvg.workspace_id', '', true)");
  const specimenScopes = snapshot.specimens.map((specimen) => {
    const request = snapshot.diagnosticRequests.find((candidate) => candidate.id === specimen.requestId);
    const encounter = request?.encounterId ? encounterById.get(request.encounterId) : null;
    const patient = snapshot.patients.find((candidate) => candidate.id === specimen.patientId);
    if (!request || request.organizationId !== specimen.organizationId || request.patientId !== specimen.patientId || !patient || patient.organizationId !== specimen.organizationId) {
      throw new PersistenceCorruptionError(`specimen ${specimen.id} has no organization-bound diagnostic request and patient`);
    }
    if (request.encounterId && (!encounter || encounter.organizationId !== request.organizationId || encounter.patientId !== request.patientId || !encounter.unitId || !encounter.workspaceId || patient.unitId !== encounter.unitId || patient.workspaceId !== encounter.workspaceId)) {
      throw new PersistenceCorruptionError(`specimen ${specimen.id} has no organization-bound encounter scope`);
    }
    return { specimen, request, encounter };
  });
  let specimenRows = specimenScopes;
  if (normalizedSpecimenWrite) {
    const scoped = specimenScopes.find(({ specimen }) => specimen.id === normalizedSpecimenWrite.id);
    if (!scoped || digest(scoped.specimen) !== digest(normalizedSpecimenWrite)) throw new PersistenceCorruptionError(`authoritative specimen ${normalizedSpecimenWrite.id} is not identical to the canonical snapshot`);
    if (!scoped.encounter || !scoped.encounter.unitId || !scoped.encounter.workspaceId || !["SPECIMEN_COLLECTED", "RESULTED", "REVIEWED"].includes(scoped.request.status)) throw new PersistenceCorruptionError(`authoritative specimen ${normalizedSpecimenWrite.id} has no valid durable encounter state`);
    await writeAuthoritativeSpecimen(client, normalizedSpecimenWrite, scoped.encounter);
    specimenRows = specimenScopes.filter(({ specimen }) => specimen.id !== normalizedSpecimenWrite.id);
  }
  if (normalizedSpecimenReplayId) {
    const replayed = specimenScopes.find(({ specimen }) => specimen.id === normalizedSpecimenReplayId);
    if (!replayed || !replayed.encounter || !replayed.encounter.unitId || !replayed.encounter.workspaceId || !["SPECIMEN_COLLECTED", "RESULTED", "REVIEWED"].includes(replayed.request.status)) throw new PersistenceCorruptionError(`specimen replay ${normalizedSpecimenReplayId} has no durable scoped state`);
    specimenRows = specimenRows.filter(({ specimen }) => specimen.id !== normalizedSpecimenReplayId);
  }
  await writeContextualRows(client,
    "insert into specimens(id, organization_id, unit_id, workspace_id, request_id, patient_id, label, collected_at, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, request_id = excluded.request_id, patient_id = excluded.patient_id, label = excluded.label, collected_at = excluded.collected_at, status = excluded.status",
    specimenRows,
    ({ encounter }) => ({ unitId: encounter?.unitId ?? null, workspaceId: encounter?.workspaceId ?? null }),
    ({ specimen, encounter }) => [specimen.id, specimen.organizationId, encounter?.unitId ?? null, encounter?.workspaceId ?? null, specimen.requestId, specimen.patientId, specimen.label, specimen.collectedAt, specimen.status]
  );
  const resultScopes = snapshot.diagnosticResults.map((resultRow) => {
    const request = snapshot.diagnosticRequests.find((candidate) => candidate.id === resultRow.requestId);
    const specimen = snapshot.specimens.find((candidate) => candidate.id === resultRow.specimenId);
    const encounter = request?.encounterId ? encounterById.get(request.encounterId) : null;
    const patient = snapshot.patients.find((candidate) => candidate.id === resultRow.patientId);
    if (!request || !specimen || request.organizationId !== resultRow.organizationId || specimen.organizationId !== resultRow.organizationId || resultRow.specimenId !== specimen.id || request.id !== specimen.requestId || request.patientId !== resultRow.patientId || specimen.patientId !== resultRow.patientId || !patient || patient.organizationId !== resultRow.organizationId) {
      throw new PersistenceCorruptionError(`diagnostic result ${resultRow.id} has inconsistent request, specimen or patient provenance`);
    }
    if (request.encounterId && (!encounter || encounter.organizationId !== request.organizationId || encounter.patientId !== request.patientId || !encounter.unitId || !encounter.workspaceId || patient.unitId !== encounter.unitId || patient.workspaceId !== encounter.workspaceId)) {
      throw new PersistenceCorruptionError(`diagnostic result ${resultRow.id} has no organization-bound encounter scope`);
    }
    return { resultRow, request, specimen, encounter };
  });
  let diagnosticResultRows = resultScopes;
  if (normalizedDiagnosticResultWrite) {
    const scoped = resultScopes.find(({ resultRow }) => resultRow.id === normalizedDiagnosticResultWrite.id);
    if (!scoped || digest(scoped.resultRow) !== digest(normalizedDiagnosticResultWrite)) throw new PersistenceCorruptionError(`authoritative diagnostic result ${normalizedDiagnosticResultWrite.id} is not identical to the canonical snapshot`);
    if (!scoped.encounter || !scoped.encounter.unitId || !scoped.encounter.workspaceId || scoped.request.status !== "RESULTED") throw new PersistenceCorruptionError(`authoritative diagnostic result ${normalizedDiagnosticResultWrite.id} has no valid durable encounter state`);
    await writeAuthoritativeDiagnosticResult(client, normalizedDiagnosticResultWrite, scoped.encounter);
    diagnosticResultRows = resultScopes.filter(({ resultRow }) => resultRow.id !== normalizedDiagnosticResultWrite.id);
  }
  if (normalizedDiagnosticResultReplayId) {
    const replayed = resultScopes.find(({ resultRow }) => resultRow.id === normalizedDiagnosticResultReplayId);
    if (!replayed || !replayed.encounter || !replayed.encounter.unitId || !replayed.encounter.workspaceId || replayed.request.status !== "RESULTED") throw new PersistenceCorruptionError(`diagnostic result replay ${normalizedDiagnosticResultReplayId} has no durable scoped state`);
    diagnosticResultRows = diagnosticResultRows.filter(({ resultRow }) => resultRow.id !== normalizedDiagnosticResultReplayId);
  }
  await writeContextualRows(client,
    "insert into diagnostic_results(id, organization_id, unit_id, workspace_id, request_id, specimen_id, patient_id, value, source, source_version, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, request_id = excluded.request_id, specimen_id = excluded.specimen_id, patient_id = excluded.patient_id, value = excluded.value, source = excluded.source, source_version = excluded.source_version, status = excluded.status",
    diagnosticResultRows,
    ({ encounter }) => ({ unitId: encounter?.unitId ?? null, workspaceId: encounter?.workspaceId ?? null }),
    ({ resultRow, encounter }) => [resultRow.id, resultRow.organizationId, encounter?.unitId ?? null, encounter?.workspaceId ?? null, resultRow.requestId, resultRow.specimenId, resultRow.patientId, resultRow.value, resultRow.source, resultRow.sourceVersion, resultRow.status, resultRow.createdAt]
  );
  await writeUnitRows(client,
    "insert into beds(id, organization_id, unit_id, name, status) values ($1, $2, $3, $4, $5) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name, status = excluded.status",
    snapshot.beds,
    (bed) => bed.unitId,
    (bed) => [bed.id, bed.organizationId, bed.unitId, bed.name, bed.status]
  );
  await writeUnitRows(client,
    "insert into hospital_episodes(id, organization_id, unit_id, patient_id, encounter_id, bed_id, status, admitted_at, discharged_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, bed_id = excluded.bed_id, status = excluded.status, admitted_at = excluded.admitted_at, discharged_at = excluded.discharged_at",
    snapshot.hospitalEpisodes,
    (episode) => episode.unitId,
    (episode) => [episode.id, episode.organizationId, episode.unitId, episode.patientId, episode.encounterId, episode.bedId, episode.status, episode.admittedAt, episode.dischargedAt]
  );
  await writeRows(client,
    "insert into products(id, organization_id, sku, name, category, unit, reorder_point, status) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, sku = excluded.sku, name = excluded.name, category = excluded.category, unit = excluded.unit, reorder_point = excluded.reorder_point, status = excluded.status",
    snapshot.products,
    (product) => [product.id, product.organizationId, product.sku, product.name, product.category, product.unit, product.reorderPoint, product.status]
  );
  await writeUnitRows(client,
    "insert into stock_locations(id, organization_id, unit_id, name) values ($1, $2, $3, $4) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name",
    snapshot.stockLocations,
    (location) => location.unitId,
    (location) => [location.id, location.organizationId, location.unitId, location.name]
  );
  await writeRows(client,
    "insert into lots(id, organization_id, product_id, lot_number, expires_on, quantity, location_id, status) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, product_id = excluded.product_id, lot_number = excluded.lot_number, expires_on = excluded.expires_on, quantity = excluded.quantity, location_id = excluded.location_id, status = excluded.status",
    snapshot.lots,
    (lot) => [lot.id, lot.organizationId, lot.productId, lot.lotNumber, lot.expiresOn, lot.quantity, lot.locationId, lot.status]
  );
  await writeRows(client,
    "insert into stock_movements(id, organization_id, product_id, lot_id, location_id, quantity, movement_type, reason, reference_id, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, product_id = excluded.product_id, lot_id = excluded.lot_id, location_id = excluded.location_id, quantity = excluded.quantity, movement_type = excluded.movement_type, reason = excluded.reason, reference_id = excluded.reference_id, created_by = excluded.created_by",
    snapshot.stockMovements,
    (movement) => [movement.id, movement.organizationId, movement.productId, movement.lotId, movement.locationId, movement.quantity, movement.movementType, movement.reason, movement.referenceId, movement.createdBy, movement.createdAt]
  );
  await writeRows(client,
    "insert into medication_orders(id, organization_id, patient_id, encounter_id, product_id, dose, route, frequency, status, prescribed_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do update set organization_id = excluded.organization_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, product_id = excluded.product_id, dose = excluded.dose, route = excluded.route, frequency = excluded.frequency, status = excluded.status, prescribed_by = excluded.prescribed_by",
    snapshot.medicationOrders,
    (order) => [order.id, order.organizationId, order.patientId, order.encounterId, order.productId, order.dose, order.route, order.frequency, order.status, order.prescribedBy]
  );
  await writeRows(client,
    "insert into dispensations(id, organization_id, medication_order_id, lot_id, quantity, dispensed_by, created_at) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, medication_order_id = excluded.medication_order_id, lot_id = excluded.lot_id, quantity = excluded.quantity, dispensed_by = excluded.dispensed_by",
    snapshot.dispensations,
    (dispensation) => [dispensation.id, dispensation.organizationId, dispensation.medicationOrderId, dispensation.lotId, dispensation.quantity, dispensation.dispensedBy, dispensation.createdAt]
  );
  await writeRows(client,
    "insert into administration_occurrences(id, organization_id, medication_order_id, administered_by, administered_at, status, note) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, medication_order_id = excluded.medication_order_id, administered_by = excluded.administered_by, administered_at = excluded.administered_at, status = excluded.status, note = excluded.note",
    snapshot.administrationOccurrences,
    (occurrence) => [occurrence.id, occurrence.organizationId, occurrence.medicationOrderId, occurrence.administeredBy, occurrence.administeredAt, occurrence.status, occurrence.note]
  );
  await writeUnitRows(client,
    "insert into charges(id, organization_id, unit_id, patient_id, description, amount_cents, currency, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, patient_id = excluded.patient_id, description = excluded.description, amount_cents = excluded.amount_cents, currency = excluded.currency, status = excluded.status",
    snapshot.charges,
    (charge) => charge.unitId,
    (charge) => [charge.id, charge.organizationId, charge.unitId, charge.patientId, charge.description, charge.amountCents, charge.currency, charge.status, charge.createdAt]
  );
  await writeRows(client,
    "insert into payments(id, organization_id, charge_id, amount_cents, method, external_reference, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, charge_id = excluded.charge_id, amount_cents = excluded.amount_cents, method = excluded.method, external_reference = excluded.external_reference, status = excluded.status",
    snapshot.payments,
    (payment) => [payment.id, payment.organizationId, payment.chargeId, payment.amountCents, payment.method, payment.externalReference, payment.status, payment.createdAt]
  );
  await writeRows(client,
    "insert into ledger_entries(id, organization_id, kind, reference_id, amount_cents, currency, description, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, kind = excluded.kind, reference_id = excluded.reference_id, amount_cents = excluded.amount_cents, currency = excluded.currency, description = excluded.description",
    snapshot.ledgerEntries,
    (entry) => [entry.id, entry.organizationId, entry.kind, entry.referenceId, entry.amountCents, entry.currency, entry.description, entry.createdAt]
  );
  await writeScopedRows(client,
    "insert into communication_messages(id, organization_id, unit_id, workspace_id, patient_id, channel, recipient, template, body, status, created_by, decided_by, decided_at, approved_by, approved_at, decision_reason, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, channel = excluded.channel, recipient = excluded.recipient, template = excluded.template, body = excluded.body, status = excluded.status, created_by = excluded.created_by, decided_by = excluded.decided_by, decided_at = excluded.decided_at, approved_by = excluded.approved_by, approved_at = excluded.approved_at, decision_reason = excluded.decision_reason",
    snapshot.messages,
    (message) => ({ unitId: message.unitId, workspaceId: message.workspaceId }),
    (message) => [message.id, message.organizationId, message.unitId, message.workspaceId, message.patientId, message.channel, message.recipient, message.template, message.body, message.status, message.createdBy ?? null, message.decidedBy ?? null, message.decidedAt ?? null, message.approvedBy ?? null, message.approvedAt ?? null, message.decisionReason ?? null, message.createdAt]
  );
  await writeScopedRows(client,
    "insert into knowledge_documents(id, organization_id, unit_id, workspace_id, title, source, data_class, version, status, content, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, title = excluded.title, source = excluded.source, data_class = excluded.data_class, version = excluded.version, status = excluded.status, content = excluded.content",
    snapshot.knowledgeDocuments,
    (document) => ({ unitId: document.unitId, workspaceId: document.workspaceId }),
    (document) => [document.id, document.organizationId, document.unitId, document.workspaceId, document.title, document.source, document.dataClass, document.version, document.status, document.content, document.createdAt]
  );
  await writeRows(client,
    "insert into budget_reservations(id, organization_id, session_id, category, reserved_units, consumed_units, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, session_id = excluded.session_id, category = excluded.category, reserved_units = excluded.reserved_units, consumed_units = excluded.consumed_units, status = excluded.status",
    snapshot.budgetReservations,
    (reservation) => [reservation.id, reservation.organizationId, reservation.sessionId, reservation.category, reservation.reservedUnits, reservation.consumedUnits, reservation.status, reservation.createdAt]
  );
  await writeScopedRows(client,
    "insert into ai_sessions(id, organization_id, actor_id, unit_id, workspace_id, patient_id, encounter_id, purpose, engine_commit, profile_digest, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, purpose = excluded.purpose, engine_commit = excluded.engine_commit, profile_digest = excluded.profile_digest, status = excluded.status",
    snapshot.aiSessions,
    (session) => ({ unitId: session.unitId, workspaceId: session.workspaceId }),
    (session) => [session.id, session.organizationId, session.actorId, session.unitId, session.workspaceId, session.patientId, session.encounterId, session.purpose, session.engineCommit, session.profileDigest, session.status, session.createdAt]
  );
  await projectAiTurnUsage(client, snapshot);
  await writeScopedRows(client,
    "insert into ai_turns(id, organization_id, unit_id, workspace_id, session_id, prompt, response, status, model, input_tokens, output_tokens, references_json, usage_record_id, provenance_json, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, session_id = excluded.session_id, prompt = excluded.prompt, response = excluded.response, status = excluded.status, model = excluded.model, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, references_json = excluded.references_json, usage_record_id = excluded.usage_record_id, provenance_json = excluded.provenance_json",
    snapshot.aiTurns,
    (turn) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === turn.sessionId);
      if (!session) throw new PersistenceCorruptionError(`ai turn ${turn.id} has no resolvable session scope`);
      return { unitId: session.unitId, workspaceId: session.workspaceId };
    },
    (turn) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === turn.sessionId);
      if (!session) throw new PersistenceCorruptionError(`ai turn ${turn.id} has no resolvable session scope`);
      return [turn.id, session.organizationId, session.unitId, session.workspaceId, turn.sessionId, turn.prompt, turn.response, turn.status, turn.model, turn.inputTokens, turn.outputTokens, JSON.stringify(turn.references), turn.usage?.id ?? null, JSON.stringify(turn.provenance ?? {}), turn.createdAt];
    }
  );
  await writeScopedRows(client,
    "insert into ai_drafts(id, organization_id, unit_id, workspace_id, session_id, encounter_id, draft_type, content, source_turn_id, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, session_id = excluded.session_id, encounter_id = excluded.encounter_id, draft_type = excluded.draft_type, content = excluded.content, source_turn_id = excluded.source_turn_id, status = excluded.status",
    snapshot.aiDrafts,
    (draft) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === draft.sessionId);
      if (!session) throw new PersistenceCorruptionError(`ai draft ${draft.id} has no resolvable session scope`);
      return { unitId: session.unitId, workspaceId: session.workspaceId };
    },
    (draft) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === draft.sessionId);
      if (!session) throw new PersistenceCorruptionError(`ai draft ${draft.id} has no resolvable session scope`);
      return [draft.id, session.organizationId, session.unitId, session.workspaceId, draft.sessionId, draft.encounterId, draft.draftType, draft.content, draft.sourceTurnId, draft.status, draft.createdAt];
    }
  );
  await writeScopedRows(client,
    "insert into ai_approvals(id, organization_id, actor_id, session_id, turn_id, tool_name, resource_id, patient_id, encounter_id, unit_id, workspace_id, purpose, request_digest, policy_revision, expires_at, decision, decided_by, reason, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, session_id = excluded.session_id, turn_id = excluded.turn_id, tool_name = excluded.tool_name, resource_id = excluded.resource_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, purpose = excluded.purpose, request_digest = excluded.request_digest, policy_revision = excluded.policy_revision, expires_at = excluded.expires_at, decision = excluded.decision, decided_by = excluded.decided_by, reason = excluded.reason",
    snapshot.aiApprovals,
    (approval) => ({ unitId: approval.unitId, workspaceId: approval.workspaceId }),
    (approval) => [approval.id, approval.organizationId, approval.actorId, approval.sessionId, approval.turnId, approval.toolName, approval.resourceId, approval.patientId, approval.encounterId, approval.unitId, approval.workspaceId, approval.purpose, approval.requestDigest, approval.policyRevision, approval.expiresAt, approval.decision, approval.decidedBy, approval.reason, approval.createdAt]
  );
}

async function projectOutbox(client: PoolClient, organizationId: OpaqueId, records: DurableOutboxInput[]): Promise<void> {
  for (const record of records) {
    if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`outbox record ${record.id} has a different organization scope`);
    const recordDigest = outboxDigest(record);
    const result = await client.query<{ id: string }>(
      "insert into outbox_records(id, organization_id, event_type, aggregate_id, payload, status, attempts, available_at, record_digest) values ($1, $2, $3, $4, $5::jsonb, 'PENDING', 0, coalesce($6::timestamptz, now()), $7) on conflict (id) do update set record_digest = outbox_records.record_digest where outbox_records.record_digest = excluded.record_digest returning id",
      [record.id, record.organizationId, record.eventType, record.aggregateId, JSON.stringify(record.payload), record.availableAt ?? null, recordDigest]
    );
    if (!result.rows[0]) throw new PersistenceCorruptionError(`outbox record ${record.id} changed after it was durably recorded`);
  }
}

async function projectRecoveredOutbox(client: PoolClient, organizationId: OpaqueId, records: DurableOutboxRecord[]): Promise<void> {
  for (const record of records) {
    if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`recovered outbox record ${record.id} has a different organization scope`);
    const result = await client.query<{ id: string }>(
      "insert into outbox_records(id, organization_id, event_type, aggregate_id, payload, status, attempts, available_at, claimed_by, lease_until, fence_token, last_error, created_at, processed_at, record_digest) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) on conflict (id) do update set status = excluded.status, attempts = excluded.attempts, available_at = excluded.available_at, claimed_by = excluded.claimed_by, lease_until = excluded.lease_until, fence_token = excluded.fence_token, last_error = excluded.last_error, processed_at = excluded.processed_at where outbox_records.record_digest = excluded.record_digest returning id",
      [record.id, record.organizationId, record.eventType, record.aggregateId, JSON.stringify(record.payload), record.status, record.attempts, record.availableAt, record.claimedBy, record.leaseUntil, record.fenceToken.toString(), record.lastError, record.createdAt, record.processedAt, record.recordDigest]
    );
    if (!result.rows[0]) throw new PersistenceCorruptionError(`recovered outbox record ${record.id} conflicts with a different immutable event`);
  }
}

async function projectRecoveredWorkerJobs(client: PoolClient, organizationId: OpaqueId, records: DurableWorkerJobRecord[]): Promise<void> {
  for (const record of records) {
    if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`recovered worker job ${record.id} has a different organization scope`);
    const result = await client.query<{ id: string }>(
      "insert into cvg_worker_jobs(id, organization_id, lane, job_type, idempotency_key, payload, status, attempts, max_attempts, available_at, claimed_by, lease_until, fence_token, last_error, created_at, processed_at, record_digest) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) on conflict (organization_id, lane, idempotency_key) do update set status = excluded.status, attempts = excluded.attempts, max_attempts = excluded.max_attempts, available_at = excluded.available_at, claimed_by = excluded.claimed_by, lease_until = excluded.lease_until, fence_token = excluded.fence_token, last_error = excluded.last_error, processed_at = excluded.processed_at where cvg_worker_jobs.record_digest = excluded.record_digest returning id",
      [record.id, record.organizationId, record.lane, record.jobType, record.idempotencyKey, JSON.stringify(record.payload), record.status, record.attempts, record.maxAttempts, record.availableAt, record.claimedBy, record.leaseUntil, record.fenceToken.toString(), record.lastError, record.createdAt, record.processedAt, record.recordDigest]
    );
    if (!result.rows[0]) throw new PersistenceCorruptionError(`recovered worker job ${record.id} conflicts with a different immutable admission`);
  }
}

async function projectRecoveredUsage(client: PoolClient, organizationId: OpaqueId, records: DurableUsageRecord[]): Promise<void> {
  for (const record of records) {
    if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`recovered usage record ${record.id} has a different organization scope`);
    const result = await client.query<{ id: string }>(
      "insert into ai_usage_ledger(id, organization_id, reservation_id, provider_request_id, idempotency_key, usage_kind, reserved_units, consumed_units, status, record, record_digest, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) on conflict (organization_id, idempotency_key, usage_kind) do update set reserved_units = excluded.reserved_units, consumed_units = excluded.consumed_units, status = excluded.status, record = excluded.record, record_digest = excluded.record_digest, provider_request_id = excluded.provider_request_id, reservation_id = excluded.reservation_id where ai_usage_ledger.record_digest = excluded.record_digest returning id",
      [record.id, record.organizationId, record.reservationId, record.providerRequestId, record.idempotencyKey, record.usageKind, record.reservedUnits, record.consumedUnits, record.status, JSON.stringify(record.record), record.recordDigest, record.createdAt]
    );
    if (!result.rows[0]) throw new PersistenceCorruptionError(`recovered usage record ${record.id} conflicts with a different immutable event`);
  }
}

async function projectRecoveredInbox(client: PoolClient, organizationId: OpaqueId, records: DurableInboxRecord[]): Promise<void> {
  for (const record of records) {
    if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`recovered inbox record ${record.id} has a different organization scope`);
    const result = await client.query<{ id: string }>(
      "insert into integration_inbox_records(id, organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18) on conflict (organization_id, consumer, provider, external_event_id) do update set status = excluded.status, conflict_digest = excluded.conflict_digest, last_error = excluded.last_error, processed_at = excluded.processed_at, last_seen_at = excluded.last_seen_at where integration_inbox_records.record_digest = excluded.record_digest returning id",
      [record.id, record.organizationId, record.consumer, record.provider, record.externalEventId, record.eventType, record.schemaVersion, record.signatureAlgorithm, record.signatureKeyRef, record.signature, JSON.stringify(record.payload), record.recordDigest, record.status, record.conflictDigest, record.lastError, record.receivedAt, record.processedAt, record.lastSeenAt]
    );
    if (!result.rows[0]) throw new PersistenceCorruptionError(`recovered inbox record ${record.id} conflicts with a different immutable event`);
  }
}

async function projectRecoveredExternalEffects(client: PoolClient, organizationId: OpaqueId, records: DurableExternalEffectRecord[]): Promise<void> {
  for (const record of records) {
    if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`recovered external effect ${record.id} has a different organization scope`);
    const result = await client.query<{ id: string }>(
      "insert into external_effects(id, organization_id, outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19, $20) on conflict (organization_id, integration_id, idempotency_key) do update set status = excluded.status, attempts = excluded.attempts, claimed_by = excluded.claimed_by, lease_until = excluded.lease_until, fence_token = excluded.fence_token, provider_request_id = excluded.provider_request_id, response = excluded.response, last_error = excluded.last_error, outcome_digest = excluded.outcome_digest, reconciliation_source = excluded.reconciliation_source, reconciled_at = excluded.reconciled_at, updated_at = excluded.updated_at where external_effects.request_digest = excluded.request_digest returning id",
      [record.id, record.organizationId, record.outboxId, record.integrationId, record.idempotencyKey, JSON.stringify(record.request), record.requestDigest, record.status, record.attempts, record.claimedBy, record.leaseUntil, record.fenceToken.toString(), record.providerRequestId, record.response === null ? null : JSON.stringify(record.response), record.lastError, record.outcomeDigest, record.reconciliationSource, record.reconciledAt, record.createdAt, record.updatedAt]
    );
    if (!result.rows[0]) throw new PersistenceCorruptionError(`recovered external effect ${record.id} conflicts with a different immutable request`);
  }
}

async function recordInboxWithinTransaction(client: PoolClient, input: DurableInboxInput): Promise<DurableInboxReceipt> {
  const recordDigest = inboxDigest(input);
  const inserted = await client.query<InboxRow>(
    "insert into integration_inbox_records(id, organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, 'RECEIVED') on conflict (organization_id, consumer, provider, external_event_id) do nothing returning id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at",
    [input.id, input.organizationId, input.consumer, input.provider, input.externalEventId, input.eventType, input.schemaVersion, input.signatureAlgorithm, input.signatureKeyRef, input.signature, JSON.stringify(input.payload), recordDigest]
  );
  if (inserted.rows[0]) return { ...mapInboxRow(inserted.rows[0]), duplicate: false };

  const existingResult = await client.query<InboxRow>(
    "select id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at from integration_inbox_records where organization_id = cvg_request_organization() and consumer = $1 and provider = $2 and external_event_id = $3 for update",
    [input.consumer, input.provider, input.externalEventId]
  );
  const existing = existingResult.rows[0];
  if (!existing) throw new PersistenceCorruptionError(`inbox event ${input.externalEventId} disappeared after a unique conflict`);
  if (existing.record_digest === recordDigest) {
    const seen = await client.query<InboxRow>(
      "update integration_inbox_records set last_seen_at = now() where id = $1 and organization_id = cvg_request_organization() returning id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at",
      [existing.id]
    );
    if (!seen.rows[0]) throw new PersistenceCorruptionError(`inbox event ${existing.id} could not record duplicate observation`);
    return { ...mapInboxRow(seen.rows[0]), duplicate: true };
  }
  const quarantined = await client.query<InboxRow>(
    "update integration_inbox_records set status = 'QUARANTINED', conflict_digest = $2, last_error = 'DIVERGENT_DUPLICATE_EVENT', last_seen_at = now() where id = $1 and organization_id = cvg_request_organization() returning id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at",
    [existing.id, recordDigest]
  );
  if (!quarantined.rows[0]) throw new PersistenceCorruptionError(`inbox event ${existing.id} could not be quarantined after a divergent duplicate`);
  return { ...mapInboxRow(quarantined.rows[0]), duplicate: false };
}

export interface PostgresPersistenceOptions {
  connectionString: string;
  max?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  pool?: Pool;
  inboxSignatureVerifier?: InboxSignatureVerifier;
}

export type InboxSignatureVerifier = (input: DurableInboxInput) => boolean | Promise<boolean>;

/**
 * Durable state boundary for the local modular monolith.
 *
 * The JSONB snapshot is an explicit aggregate projection while normalized
 * domain repositories are introduced incrementally. Identity and authorization
 * projections are kept in sync before audit/receipt writes. Every committed
 * projection is paired with an append-only journal row in the same transaction;
 * the advisory lock plus expected revision protects writers across processes.
 */
export class PostgresPersistence {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly inboxSignatureVerifier: InboxSignatureVerifier | null;

  constructor(options: PostgresPersistenceOptions) {
    const config: PoolConfig = {
      connectionString: options.connectionString,
      max: options.max ?? 10,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 2_500,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
      application_name: "cvg-corp-api"
    };
    this.pool = options.pool ?? new Pool(config);
    this.ownsPool = !options.pool;
    this.inboxSignatureVerifier = options.inboxSignatureVerifier ?? null;
  }

  private async assertInboxSignature(input: DurableInboxInput): Promise<void> {
    if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion !== 1) throw new PersistenceStateError("inbox event schema version is unsupported");
    if (input.signatureAlgorithm !== "HMAC-SHA256" || !input.signatureKeyRef.trim() || !input.signature.trim() || input.signature.length > 512) throw new PersistenceSignatureError("inbox event signature metadata is invalid");
    if (!this.inboxSignatureVerifier) throw new PersistenceUnavailableError("inbox signature verifier is not configured");
    if (!(await this.inboxSignatureVerifier(input))) throw new PersistenceSignatureError();
  }

  async check(): Promise<{ database: string; serverVersion: string }> {
    try {
      const result = await this.pool.query<{ database: string; server_version: string }>("select current_database() as database, current_setting('server_version') as server_version");
      const row = result.rows[0];
      if (!row) throw new PersistenceUnavailableError("PostgreSQL returned no health row");
      return { database: row.database, serverVersion: row.server_version };
    } catch (error) {
      if (error instanceof PersistenceUnavailableError) throw error;
      throw new PersistenceUnavailableError("PostgreSQL is unavailable", error);
    }
  }

  async assertSchema(): Promise<void> {
    try {
      const result = await this.pool.query<{ snapshots: boolean; journal: boolean; audit: boolean; receipts: boolean; communications: boolean; outbox: boolean; usage_ledger: boolean; inbox: boolean; external_effects: boolean; rate_limit_buckets: boolean; break_glass_grants: boolean; break_glass_lifecycle: boolean; runtime_role: boolean; runtime_scope_guards: boolean; auth_security: boolean; ai_turn_scope: boolean; ai_draft_scope: boolean; ai_turn_provenance_usage: boolean; audit_tamper_evident_chain: boolean; append_only_audit_guard: boolean; append_only_lock_privileges: boolean; worker_jobs: boolean; worker_heartbeats: boolean; worker_lane_schema: boolean }>("select to_regclass('public.cvg_state_snapshots') is not null as snapshots, to_regclass('public.cvg_event_journal') is not null as journal, to_regclass('public.cvg_audit_ledger') is not null as audit, to_regclass('public.cvg_command_receipt_ledger') is not null as receipts, to_regclass('public.communication_messages') is not null as communications, to_regclass('public.outbox_records') is not null as outbox, to_regclass('public.ai_usage_ledger') is not null as usage_ledger, to_regclass('public.integration_inbox_records') is not null as inbox, to_regclass('public.external_effects') is not null as external_effects, to_regclass('public.cvg_rate_limit_buckets') is not null as rate_limit_buckets, to_regclass('public.break_glass_grants') is not null as break_glass_grants, exists (select 1 from pg_roles where rolname = current_user and rolsuper = false and rolbypassrls = false and rolcreaterole = false and rolcreatedb = false) as runtime_role, exists (select 1 from schema_migrations where version = '019_runtime_scope_guards') as runtime_scope_guards, exists (select 1 from schema_migrations where version = '020_auth_security_boundary') and to_regclass('public.auth_challenges') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'mfa_secret_ref') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = 'device_id_digest') as auth_security, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_turns' and column_name in ('organization_id', 'unit_id', 'workspace_id') group by table_schema, table_name having count(*) = 3) as ai_turn_scope, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_drafts' and column_name in ('organization_id', 'unit_id', 'workspace_id') group by table_schema, table_name having count(*) = 3) as ai_draft_scope, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_turns' and column_name in ('usage_record_id', 'provenance_json') group by table_schema, table_name having count(*) = 2) and exists (select 1 from schema_migrations where version = '029_ai_turn_provenance_usage_and_dml_scope') as ai_turn_provenance_usage, exists (select 1 from schema_migrations where version = '026_audit_tamper_evident_chain') as audit_tamper_evident_chain, exists (select 1 from schema_migrations where version = '027_append_only_audit_guard') as append_only_audit_guard, exists (select 1 from schema_migrations where version = '028_append_only_lock_privileges') as append_only_lock_privileges, exists (select 1 from schema_migrations where version = '030_break_glass_durable_lifecycle') as break_glass_lifecycle, to_regclass('public.cvg_worker_jobs') is not null as worker_jobs, to_regclass('public.cvg_worker_heartbeats') is not null as worker_heartbeats, exists (select 1 from schema_migrations where version = '031_worker_jobs_and_heartbeats') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cvg_worker_jobs' and column_name in ('lane', 'job_type', 'idempotency_key', 'fence_token', 'record_digest') group by table_schema, table_name having count(*) = 5) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cvg_worker_heartbeats' and column_name in ('worker_id', 'status', 'last_seen_at', 'expires_at') group by table_schema, table_name having count(*) = 4) as worker_lane_schema");
      const snapshotKey = await this.pool.query<{ snapshot_scope_revision: boolean }>("select exists (select 1 from pg_constraint constraint_row join pg_class table_row on table_row.oid = constraint_row.conrelid join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace where namespace_row.nspname = 'public' and table_row.relname = 'cvg_state_snapshots' and constraint_row.contype = 'p' and pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (organization_id, revision)') as snapshot_scope_revision");
      const diagnosticChildScope = await this.pool.query<{ diagnostic_child_scope: boolean }>("select exists (select 1 from schema_migrations where version = '033_diagnostic_specimen_result_scope') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'specimens' and column_name in ('unit_id', 'workspace_id') group by table_schema, table_name having count(*) = 2) and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'diagnostic_results' and column_name in ('unit_id', 'workspace_id') group by table_schema, table_name having count(*) = 2) as diagnostic_child_scope");
      const row = result.rows[0];
      if (!row?.snapshots || !row.journal || !row.audit || !row.receipts || !row.communications || !row.outbox || !row.usage_ledger || !row.inbox || !row.external_effects || !row.rate_limit_buckets || !row.break_glass_grants || !row.break_glass_lifecycle || !row.runtime_role || !row.runtime_scope_guards || !row.auth_security || !row.ai_turn_scope || !row.ai_draft_scope || !row.ai_turn_provenance_usage || !row.audit_tamper_evident_chain || !row.append_only_audit_guard || !row.append_only_lock_privileges || !row.worker_jobs || !row.worker_heartbeats || !row.worker_lane_schema || diagnosticChildScope.rows[0]?.diagnostic_child_scope !== true || snapshotKey.rows[0]?.snapshot_scope_revision !== true) throw new PersistenceUnavailableError("CVG persistence schema or runtime database role is not ready; run migrations with a non-superuser DATABASE_URL");
    } catch (error) {
      if (error instanceof PersistenceUnavailableError) throw error;
      throw new PersistenceUnavailableError("CVG persistence schema could not be checked", error);
    }
  }

  async currentRevision(organizationId: OpaqueId): Promise<bigint> {
    try {
      return await this.organizationTransaction(organizationId, "persistence revision", async (client) => {
        const result = await client.query<RevisionRow>("select revision::text as revision from cvg_state_snapshots where organization_id = cvg_request_organization() order by cvg_state_snapshots.revision desc limit 1");
        return result.rows[0] ? revisionOf(result.rows[0].revision) : 0n;
      }, true);
    } catch (error) {
      if (error instanceof PersistenceUnavailableError) throw error;
      throw new PersistenceUnavailableError("CVG persistence revision could not be read", error);
    }
  }

  async loadLatest(organizationId: OpaqueId): Promise<DurableSnapshot | null> {
    try {
      return await this.organizationTransaction(organizationId, "persistence snapshot", async (client) => {
        const result = await client.query<SnapshotRow>("select s.revision::text as revision, s.organization_id::text as organization_id, s.schema_version, s.snapshot, s.snapshot_digest, s.event_id::text as event_id, j.snapshot_digest as journal_snapshot_digest from cvg_state_snapshots s left join cvg_event_journal j on j.event_id = s.event_id and j.organization_id = s.organization_id where s.organization_id = cvg_request_organization() order by s.revision desc limit 1");
        const row = result.rows[0];
        if (!row) return null;
        if (row.schema_version !== 1) throw new PersistenceCorruptionError(`unsupported persistent snapshot schema version: ${row.schema_version}`);
        if (row.journal_snapshot_digest === null) throw new PersistenceCorruptionError("persistent snapshot has no matching journal entry");
        if (row.snapshot_digest !== row.journal_snapshot_digest) throw new PersistenceCorruptionError("persistent snapshot and journal digests diverge");
        const snapshot = snapshotFromJson(row.snapshot, row.snapshot_digest);
        if (!snapshot.organizations.some((organization) => organization.id === organizationId)) throw new PersistenceCorruptionError(`persistent snapshot has no organization ${organizationId}`);
        return { revision: revisionOf(row.revision), snapshot, snapshotDigest: row.snapshot_digest, eventId: row.event_id };
      }, true);
    } catch (error) {
      if (error instanceof PersistenceCorruptionError) throw error;
      if (error instanceof PersistenceUnavailableError) throw error;
      throw new PersistenceUnavailableError("CVG persistence snapshot could not be loaded", error);
    }
  }

  /**
   * Reserves a command receipt before a high-impact command mutates the
   * runtime. The unique idempotency_lookup constraint is the cross-process
   * admission point; a committed IN_FLIGHT row is intentionally sticky until
   * the owner settles it or the durable command commit promotes it.
   */
  async claimCommandReceipt(input: IdempotencyInput): Promise<DurableCommandReceiptClaim> {
    const proposed = newCommandReceipt(input);
    return this.organizationTransaction(input.organizationId, "command receipt claim", async (client) => {
      const inserted = await client.query<CommandReceiptRow>(
        "insert into command_receipts(id, organization_id, actor_id, unit_id, workspace_id, audit_record_id, operation, idempotency_lookup, body_digest, status, result, created_at, completed_at) values ($1, $2, $3, $4, $5, null, $6, $7, $8, 'IN_FLIGHT', null, $9, null) on conflict (idempotency_lookup) do nothing returning id::text as id, organization_id::text as organization_id, actor_id::text as actor_id, unit_id::text as unit_id, workspace_id::text as workspace_id, audit_record_id::text as audit_record_id, operation, idempotency_lookup, body_digest, status, result, created_at, completed_at",
        [proposed.id, proposed.organizationId, proposed.actorId, proposed.unitId, proposed.workspaceId, proposed.operation, proposed.idempotencyLookup, proposed.bodyDigest, proposed.createdAt]
      );
      const row = inserted.rows[0] ?? (await client.query<CommandReceiptRow>(
        "select id::text as id, organization_id::text as organization_id, actor_id::text as actor_id, unit_id::text as unit_id, workspace_id::text as workspace_id, audit_record_id::text as audit_record_id, operation, idempotency_lookup, body_digest, status, result, created_at, completed_at from command_receipts where organization_id = cvg_request_organization() and idempotency_lookup = $1 for update",
        [proposed.idempotencyLookup]
      )).rows[0];
      if (!row) throw new PersistenceCorruptionError(`command receipt ${proposed.idempotencyLookup} disappeared after a unique conflict`);
      const receipt = mapCommandReceiptRow(row);
      if (receipt.organizationId !== proposed.organizationId || receipt.actorId !== proposed.actorId || receipt.unitId !== proposed.unitId || receipt.workspaceId !== proposed.workspaceId || receipt.operation !== proposed.operation || receipt.idempotencyLookup !== proposed.idempotencyLookup) throw new PersistenceCorruptionError(`command receipt ${receipt.id} immutable scope changed after it was durably recorded`);
      if (receipt.bodyDigest !== proposed.bodyDigest) return { status: "CONFLICT", receipt };
      if (inserted.rows[0]) {
        if (receipt.status !== "IN_FLIGHT") throw new PersistenceCorruptionError(`new command receipt ${receipt.id} was not admitted as IN_FLIGHT`);
        return { status: "CLAIMED", receipt };
      }
      if (receipt.status === "SUCCEEDED") return { status: "REPLAY", receipt };
      if (receipt.status === "IN_FLIGHT") return { status: "IN_FLIGHT", receipt };
      if (receipt.status === "OUTCOME_UNKNOWN") return { status: "OUTCOME_UNKNOWN", receipt };
      return { status: "FAILED", receipt };
    }, false, { unitId: input.unitId, workspaceId: input.workspaceId });
  }

  /** Settles a pre-admitted receipt when command execution fails before commit. */
  async settleCommandReceipt(receipt: CommandReceipt): Promise<void> {
    if ((receipt.status !== "FAILED" && receipt.status !== "OUTCOME_UNKNOWN") || receipt.result !== null || receipt.completedAt === null) throw new PersistenceStateError(`command receipt ${receipt.id} cannot be settled from its current state`);
    await this.organizationTransaction(receipt.organizationId, "command receipt settlement", async (client) => {
      const updated = await client.query<CommandReceiptRow>(
        "update command_receipts set status = $1, result = null, completed_at = $2 where id = $3 and organization_id = cvg_request_organization() and actor_id = $4 and unit_id is not distinct from $5::uuid and workspace_id is not distinct from $6::uuid and operation = $7 and idempotency_lookup = $8 and body_digest = $9 and status = 'IN_FLIGHT' returning id::text as id, organization_id::text as organization_id, actor_id::text as actor_id, unit_id::text as unit_id, workspace_id::text as workspace_id, audit_record_id::text as audit_record_id, operation, idempotency_lookup, body_digest, status, result, created_at, completed_at",
        [receipt.status, receipt.completedAt, receipt.id, receipt.actorId, receipt.unitId, receipt.workspaceId, receipt.operation, receipt.idempotencyLookup, receipt.bodyDigest]
      );
      let durable = updated.rows[0];
      if (!durable) {
        durable = (await client.query<CommandReceiptRow>(
          "select id::text as id, organization_id::text as organization_id, actor_id::text as actor_id, unit_id::text as unit_id, workspace_id::text as workspace_id, audit_record_id::text as audit_record_id, operation, idempotency_lookup, body_digest, status, result, created_at, completed_at from command_receipts where organization_id = cvg_request_organization() and id = $1 for update",
          [receipt.id]
        )).rows[0];
        if (!durable) throw new PersistenceCorruptionError(`command receipt ${receipt.id} disappeared before settlement`);
        const existing = mapCommandReceiptRow(durable);
        if (existing.status === receipt.status && existing.bodyDigest === receipt.bodyDigest) return;
        throw new PersistenceCorruptionError(`command receipt ${receipt.id} changed before settlement`);
      }
      const settled = mapCommandReceiptRow(durable);
      await client.query(
        "insert into cvg_command_receipt_ledger(receipt_id, organization_id, record, record_digest) values ($1, $2, $3::jsonb, $4) on conflict (receipt_id, record_digest) do nothing",
        [settled.id, settled.organizationId, JSON.stringify(settled), digest(settled)]
      );
    }, false, { unitId: receipt.unitId, workspaceId: receipt.workspaceId });
  }

  async exportRecoveryBundle(organizationId: OpaqueId): Promise<DurableRecoveryBundle | null> {
    return this.organizationTransaction(organizationId, "recovery bundle", async (client) => {
      const snapshotResult = await client.query<SnapshotRow>("select s.revision::text as revision, s.organization_id::text as organization_id, s.schema_version, s.snapshot, s.snapshot_digest, s.event_id::text as event_id, j.snapshot_digest as journal_snapshot_digest from cvg_state_snapshots s left join cvg_event_journal j on j.event_id = s.event_id and j.organization_id = s.organization_id where s.organization_id = cvg_request_organization() order by s.revision desc limit 1");
      const row = snapshotResult.rows[0];
      if (!row) return null;
      if (row.schema_version !== 1) throw new PersistenceCorruptionError(`unsupported persistent snapshot schema version: ${row.schema_version}`);
      if (row.journal_snapshot_digest === null) throw new PersistenceCorruptionError("persistent snapshot has no matching journal entry");
      if (row.snapshot_digest !== row.journal_snapshot_digest) throw new PersistenceCorruptionError("persistent snapshot and journal digests diverge");
      const snapshot = snapshotFromJson(row.snapshot, row.snapshot_digest);
      if (!snapshot.organizations.some((organization) => organization.id === organizationId)) throw new PersistenceCorruptionError(`recovery bundle snapshot has no organization ${organizationId}`);
      const outboxResult = await client.query<OutboxRow>("select id::text as id, organization_id::text as organization_id, event_type, aggregate_id::text as aggregate_id, payload, status, attempts, available_at, claimed_by, lease_until, fence_token::text as fence_token, last_error, created_at, processed_at, record_digest from outbox_records where organization_id = cvg_request_organization() order by created_at, id");
      const usageResult = await client.query<UsageRow>("select id::text as id, organization_id::text as organization_id, reservation_id::text as reservation_id, provider_request_id, idempotency_key, usage_kind, reserved_units, consumed_units, status, record, record_digest, created_at from ai_usage_ledger where organization_id = cvg_request_organization() order by created_at, id");
      const inboxResult = await client.query<InboxRow>("select id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at from integration_inbox_records where organization_id = cvg_request_organization() order by received_at, id");
      const effectsResult = await client.query<ExternalEffectRow>("select id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at from external_effects where organization_id = cvg_request_organization() order by created_at, id");
      const workerJobsResult = await client.query<WorkerJobRow>(`select ${WORKER_JOB_COLUMNS} from cvg_worker_jobs where organization_id = cvg_request_organization() order by created_at, id`);
      const migrationsResult = await client.query<MigrationRow>("select version, checksum from schema_migrations order by version");
      const migrationFingerprint = digest(migrationsResult.rows.map(({ version, checksum }) => ({ version, checksum })));
      const revision = revisionOf(row.revision);
      const outboxRecords = outboxResult.rows.map(mapOutboxRow);
      const usageRecords = usageResult.rows.map(mapUsageRow);
      const inboxRecords = inboxResult.rows.map(mapInboxRow);
      const externalEffects = effectsResult.rows.map(mapExternalEffectRow);
      const workerJobs = workerJobsResult.rows.map(mapWorkerJobRow);
      const bundle: DurableRecoveryBundle = {
        manifest: createRecoveryBundleManifest({ organizationId, revision, snapshotDigest: row.snapshot_digest, eventId: row.event_id, migrationFingerprint, outboxRecords, usageRecords, inboxRecords, externalEffects, workerJobs }),
        revision,
        snapshot,
        snapshotDigest: row.snapshot_digest,
        eventId: row.event_id,
        outboxRecords,
        usageRecords,
        inboxRecords,
        externalEffects,
        workerJobs
      };
      validateRecoveryBundle(bundle);
      return bundle;
    }, true);
  }

  async commit(input: DurableCommitInput): Promise<DurableSnapshot> {
    const client = await this.pool.connect().catch((error: unknown) => { throw new PersistenceUnavailableError("PostgreSQL writer connection could not be acquired", error); });
    try {
      await client.query("BEGIN");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK_KEY]);
      const organizationId = input.organizationId ?? input.snapshot.organizations[0]?.id;
      if (!organizationId) throw new PersistenceCorruptionError("durable commit has no organization scope for RLS");
      if (!input.snapshot.organizations.some((organization) => organization.id === organizationId)) throw new PersistenceCorruptionError(`durable commit snapshot has no organization ${organizationId}`);
      await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
      const currentResult = await client.query<RevisionRow>("select revision::text as revision from cvg_state_snapshots where organization_id = cvg_request_organization() order by cvg_state_snapshots.revision desc limit 1 for update");
      const currentRevision = currentResult.rows[0] ? revisionOf(currentResult.rows[0].revision) : 0n;
      if (input.expectedRevision === null ? currentRevision !== 0n : currentRevision !== input.expectedRevision) throw new PersistenceConflictError(input.expectedRevision, currentRevision);
      const nextRevision = currentRevision + 1n;
      const eventId = input.eventId ?? randomUUID();
      const snapshotJson = canonicalSnapshot(input.snapshot);
      const snapshotDigest = digest(snapshotJson);
      await projectIdentity(client, input.snapshot);
      await projectDomain(client, input.snapshot, input.normalizedPatientWrite ?? null, input.normalizedAppointmentWrite ?? null, input.normalizedEncounterWrite ?? null, input.normalizedClinicalSignWrite ?? null, input.normalizedClinicalSignReplayId ?? null, input.normalizedGuardianWrite ?? null, input.normalizedGuardianReplayId ?? null, input.normalizedDiagnosticRequestWrite ?? null, input.normalizedDiagnosticRequestReplayId ?? null, input.normalizedSpecimenWrite ?? null, input.normalizedSpecimenReplayId ?? null, input.normalizedDiagnosticResultWrite ?? null, input.normalizedDiagnosticResultReplayId ?? null);
      await projectOutbox(client, organizationId, input.outboxRecords ?? []);
      await projectRecoveredOutbox(client, organizationId, input.recoveredOutboxRecords ?? []);
      await projectRecoveredUsage(client, organizationId, input.recoveredUsageRecords ?? []);
      await projectRecoveredInbox(client, organizationId, input.recoveredInboxRecords ?? []);
      await projectRecoveredExternalEffects(client, organizationId, input.recoveredExternalEffects ?? []);
      await projectRecoveredWorkerJobs(client, organizationId, input.recoveredWorkerJobs ?? []);
      await client.query(
        "insert into cvg_event_journal(event_id, event_type, organization_id, actor_id, correlation_id, operation, aggregate_type, aggregate_id, payload, snapshot_digest) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)",
        [eventId, input.eventType, organizationId, input.actorId, input.correlationId, input.operation, input.aggregateType, input.aggregateId, JSON.stringify(input.payload), snapshotDigest]
      );
      const auditTail = await client.query<{ record_hash: string | null }>("select record_hash from cvg_audit_ledger where organization_id = cvg_request_organization() order by sequence_id desc limit 1 for update");
      let previousAuditHash = auditTail.rows[0]?.record_hash ?? null;
      for (const audit of input.auditRecords ?? []) {
        if (audit.chainVersion !== 2 || audit.previousHash !== previousAuditHash || audit.recordHash !== auditRecordHash(audit)) throw new PersistenceCorruptionError(`audit record ${audit.id} failed tamper-evident chain validation`);
        await client.query(
          "insert into audit_records(id, organization_id, actor_id, unit_id, workspace_id, action, resource_type, resource_id, result, reason, correlation_id, metadata, chain_version, previous_hash, record_hash, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16) on conflict (id) do nothing",
          [audit.id, audit.organizationId, audit.actorId, audit.unitId, audit.workspaceId, audit.action, audit.resourceType, audit.resourceId, audit.result, audit.reason, audit.correlationId, JSON.stringify(audit.metadata), audit.chainVersion, audit.previousHash, audit.recordHash, audit.createdAt]
        );
        const auditDigest = digest(audit);
        const result = await client.query<{ audit_id: string }>(
          "insert into cvg_audit_ledger(audit_id, organization_id, record, record_digest, previous_hash, record_hash, chain_version) values ($1, $2, $3::jsonb, $4, $5, $6, $7) on conflict (audit_id) do nothing returning audit_id",
          [audit.id, audit.organizationId, JSON.stringify(audit), auditDigest, audit.previousHash, audit.recordHash, audit.chainVersion]
        );
        if (!result.rows[0]) {
          const existing = await client.query<{ record_digest: string; previous_hash: string | null; record_hash: string; chain_version: number }>(
            "select record_digest, previous_hash, record_hash, chain_version from cvg_audit_ledger where audit_id = $1",
            [audit.id]
          );
          const row = existing.rows[0];
          if (!row || row.record_digest !== auditDigest || row.previous_hash !== audit.previousHash || row.record_hash !== audit.recordHash || row.chain_version !== audit.chainVersion) throw new PersistenceCorruptionError("audit record " + audit.id + " changed after it was durably recorded");
        }
        previousAuditHash = audit.recordHash;
      }
      for (const receipt of input.commandReceipts ?? []) {
        const receiptResult = await client.query<{ id: string }>(
          "insert into command_receipts(id, organization_id, actor_id, unit_id, workspace_id, audit_record_id, operation, idempotency_lookup, body_digest, status, result, created_at, completed_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13) on conflict (id) do update set unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, audit_record_id = excluded.audit_record_id, status = excluded.status, result = excluded.result, completed_at = excluded.completed_at where command_receipts.organization_id = excluded.organization_id and command_receipts.actor_id = excluded.actor_id and command_receipts.operation = excluded.operation and command_receipts.idempotency_lookup = excluded.idempotency_lookup and command_receipts.body_digest = excluded.body_digest and command_receipts.unit_id is not distinct from excluded.unit_id and command_receipts.workspace_id is not distinct from excluded.workspace_id returning id",
          [receipt.id, receipt.organizationId, receipt.actorId, receipt.unitId, receipt.workspaceId, receipt.auditRecordId, receipt.operation, receipt.idempotencyLookup, receipt.bodyDigest, receipt.status, receipt.result === null ? null : JSON.stringify(receipt.result), receipt.createdAt, receipt.completedAt]
        );
        if (!receiptResult.rows[0]) throw new PersistenceCorruptionError(`command receipt ${receipt.id} immutable fields changed after it was durably recorded`);
        await client.query(
          "insert into cvg_command_receipt_ledger(receipt_id, organization_id, record, record_digest) values ($1, $2, $3::jsonb, $4) on conflict (receipt_id, record_digest) do nothing",
          [receipt.id, receipt.organizationId, JSON.stringify(receipt), digest(receipt)]
        );
      }
      await client.query(
        "insert into cvg_state_snapshots(revision, organization_id, event_id, schema_version, snapshot, snapshot_digest, source) values ($1, $2, $3, $4, $5::jsonb, $6, $7)",
        [nextRevision.toString(), organizationId, eventId, 1, JSON.stringify(snapshotJson), snapshotDigest, input.eventType]
      );
      await client.query("COMMIT");
      return { revision: nextRevision, snapshot: input.snapshot, snapshotDigest, eventId };
    } catch (error) {
      await rollback(client);
      if (error instanceof PersistenceConflictError) throw error;
      if (error instanceof PersistenceCorruptionError) throw error;
      throw new PersistenceUnavailableError("CVG durable commit rolled back", error);
    } finally {
      client.release();
    }
  }

  private async scopedRead<T>(context: CvgContext, operation: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.organizationTransaction(context.organizationId, operation, callback, true, { unitId: context.unitId, workspaceId: context.workspaceId });
  }

  private async organizationTransaction<T>(organizationId: OpaqueId, operation: string, callback: (client: PoolClient) => Promise<T>, readOnly = false, scope: { unitId: OpaqueId | null; workspaceId: OpaqueId | null } | null = null): Promise<T> {
    const client = await this.pool.connect().catch((error: unknown) => { throw new PersistenceUnavailableError(`PostgreSQL ${operation} connection could not be acquired`, error); });
    try {
      await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
      if (scope) {
        await client.query("select set_config('cvg.unit_id', $1, true)", [scope.unitId ?? ""]);
        await client.query("select set_config('cvg.workspace_id', $1, true)", [scope.workspaceId ?? ""]);
      }
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await rollback(client);
      if (error instanceof PersistenceCorruptionError || error instanceof OutboxLeaseLostError || error instanceof PersistenceStateError || error instanceof PersistenceUnavailableError) throw error;
      throw new PersistenceUnavailableError(`PostgreSQL ${operation} transaction failed`, error);
    } finally {
      client.release();
    }
  }

  async listGuardians(context: CvgContext, query = ""): Promise<Guardian[]> {
    const normalized = query.trim();
    return this.scopedRead(context, "guardians", async (client) => {
      const result = await client.query<{
        id: string;
        unit_id: string | null;
        workspace_id: string | null;
        display_name: string;
        phone: string;
        email: string | null;
        data_class: "D2";
        status: "ACTIVE" | "INACTIVE";
      }>(
        "select g.id::text as id, g.unit_id::text as unit_id, g.workspace_id::text as workspace_id, g.display_name, g.phone, g.email, g.data_class, g.status from guardians g where g.organization_id = cvg_request_organization() and g.status = 'ACTIVE' and ($1::text = '' or g.display_name ilike '%' || $1 || '%' or g.phone ilike '%' || $1 || '%' or coalesce(g.email, '') ilike '%' || $1 || '%') and ($2::uuid is null or ((g.unit_id = $2::uuid) and ($3::uuid is null or g.workspace_id = $3::uuid)) or exists (select 1 from patients p where p.organization_id = g.organization_id and p.guardian_id = g.id and p.status = 'ACTIVE' and p.unit_id = $2::uuid and ($3::uuid is null or p.workspace_id = $3::uuid))) order by lower(g.display_name), g.id",
        [normalized, context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => ({ id: sqlId(row.id, "guardian.id"), organizationId: context.organizationId, unitId: row.unit_id ? sqlId(row.unit_id, "guardian.unit_id") : null, workspaceId: row.workspace_id ? sqlId(row.workspace_id, "guardian.workspace_id") : null, displayName: sqlText(row.display_name, "guardian.display_name"), phone: sqlText(row.phone, "guardian.phone"), email: row.email, dataClass: row.data_class, status: row.status }));
    });
  }

  async listPatients(context: CvgContext, query = ""): Promise<NormalizedPatientRead[]> {
    const normalized = query.trim();
    return this.scopedRead(context, "patients", async (client) => {
      const result = await client.query<{
        id: string;
        unit_id: string | null;
        workspace_id: string | null;
        guardian_id: string;
        name: string;
        species: string;
        breed: string | null;
        sex: "FEMALE" | "MALE" | "UNKNOWN";
        reproductive_status: "INTACT" | "NEUTERED" | "UNKNOWN";
        birth_date: string | null;
        identifiers: unknown;
        data_class: "D3";
        status: "ACTIVE" | "INACTIVE" | "MERGED";
        merged_into_id: string | null;
        status_changed_at: SqlTimestamp;
        created_at: SqlTimestamp;
        guardian_display_name: string | null;
        guardian_phone: string | null;
      }>(
        "select p.id::text as id, p.unit_id::text as unit_id, p.workspace_id::text as workspace_id, p.guardian_id::text as guardian_id, p.name, p.species, p.breed, p.sex, p.reproductive_status, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date, p.identifiers, p.data_class, p.status, p.merged_into_id::text as merged_into_id, p.status_changed_at, p.created_at, g.display_name as guardian_display_name, g.phone as guardian_phone from patients p left join guardians g on g.id = p.guardian_id and g.organization_id = p.organization_id where p.organization_id = cvg_request_organization() and p.status = 'ACTIVE' and ($1::text = '' or p.name ilike '%' || $1 || '%' or p.species ilike '%' || $1 || '%' or coalesce(p.breed, '') ilike '%' || $1 || '%') and ($2::uuid is null or (p.unit_id = $2::uuid and ($3::uuid is null or p.workspace_id = $3::uuid)) or exists (select 1 from appointments a where a.organization_id = p.organization_id and a.patient_id = p.id and a.unit_id = $2::uuid and ($3::uuid is null or a.workspace_id = $3::uuid)) or exists (select 1 from encounters e where e.organization_id = p.organization_id and e.patient_id = p.id and e.unit_id = $2::uuid and ($3::uuid is null or e.workspace_id = $3::uuid)) or exists (select 1 from communication_messages m where m.organization_id = p.organization_id and m.patient_id = p.id and m.unit_id = $2::uuid and ($3::uuid is null or m.workspace_id = $3::uuid))) order by lower(p.name), p.id",
        [normalized, context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => ({
        id: sqlId(row.id, "patient.id"),
        organizationId: context.organizationId,
        unitId: row.unit_id ? sqlId(row.unit_id, "patient.unit_id") : null,
        workspaceId: row.workspace_id ? sqlId(row.workspace_id, "patient.workspace_id") : null,
        guardianId: sqlId(row.guardian_id, "patient.guardian_id"),
        name: sqlText(row.name, "patient.name"),
        species: sqlText(row.species, "patient.species"),
        breed: row.breed,
        sex: row.sex,
        reproductiveStatus: row.reproductive_status,
        birthDate: row.birth_date,
        identifiers: sqlStringArray(row.identifiers, "patient.identifiers"),
        dataClass: row.data_class,
        status: row.status,
        mergedIntoId: row.merged_into_id ? sqlId(row.merged_into_id, "patient.merged_into_id") : null,
        statusChangedAt: sqlNullableTimestamp(row.status_changed_at),
        createdAt: sqlTimestamp(row.created_at, "patient.created_at"),
        guardian: row.guardian_display_name === null || row.guardian_phone === null ? null : { id: sqlId(row.guardian_id, "guardian.id"), displayName: row.guardian_display_name, phone: row.guardian_phone }
      }));
    });
  }

  async listAppointments(context: CvgContext, range: "today" | "week" = "today"): Promise<NormalizedAppointmentRead[]> {
    return this.scopedRead(context, "appointments", async (client) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + (range === "week" ? 7 : 1));
      const result = await client.query<{
        id: string;
        organization_id: string;
        unit_id: string;
        workspace_id: string;
        patient_id: string;
        provider_id: string;
        resource_id: string | null;
        service_id: string;
        starts_at: SqlTimestamp;
        ends_at: SqlTimestamp;
        purpose: string;
        status: Appointment["status"];
        version: number;
        created_at: SqlTimestamp;
        patient_name: string | null;
        provider_name: string | null;
      }>(
        "select a.id::text as id, a.organization_id::text as organization_id, a.unit_id::text as unit_id, a.workspace_id::text as workspace_id, a.patient_id::text as patient_id, a.provider_id::text as provider_id, a.resource_id::text as resource_id, a.service_id::text as service_id, a.starts_at, a.ends_at, a.purpose, a.status, a.version, a.created_at, p.name as patient_name, pr.display_name as provider_name from appointments a left join patients p on p.id = a.patient_id and p.organization_id = a.organization_id left join providers pr on pr.id = a.provider_id and pr.organization_id = a.organization_id where a.organization_id = cvg_request_organization() and ($1::uuid is null or a.unit_id = $1::uuid) and ($2::uuid is null or a.workspace_id = $2::uuid) and a.starts_at >= $3::timestamptz and a.starts_at < $4::timestamptz order by a.starts_at, a.id",
        [context.unitId, context.workspaceId, start, end]
      );
      return result.rows.map((row) => ({
        id: sqlId(row.id, "appointment.id"),
        organizationId: sqlId(row.organization_id, "appointment.organization_id"),
        unitId: sqlId(row.unit_id, "appointment.unit_id"),
        workspaceId: sqlId(row.workspace_id, "appointment.workspace_id"),
        patientId: sqlId(row.patient_id, "appointment.patient_id"),
        providerId: sqlId(row.provider_id, "appointment.provider_id"),
        resourceId: row.resource_id ? sqlId(row.resource_id, "appointment.resource_id") : null,
        serviceId: sqlId(row.service_id, "appointment.service_id"),
        startsAt: sqlTimestamp(row.starts_at, "appointment.starts_at"),
        endsAt: sqlTimestamp(row.ends_at, "appointment.ends_at"),
        purpose: sqlText(row.purpose, "appointment.purpose"),
        status: row.status,
        version: row.version,
        createdAt: sqlTimestamp(row.created_at, "appointment.created_at"),
        patient: row.patient_name === null ? null : { id: sqlId(row.patient_id, "patient.id"), name: row.patient_name },
        provider: row.provider_name
      }));
    });
  }

  async listQueue(context: CvgContext): Promise<NormalizedQueueRead[]> {
    return this.scopedRead(context, "queue", async (client) => {
      const result = await client.query<QueueReadRow>(
        "select q.id::text as id, q.organization_id::text as organization_id, q.unit_id::text as unit_id, q.appointment_id::text as appointment_id, q.patient_id::text as patient_id, q.status, q.priority, q.checked_in_at, a.workspace_id::text as appointment_workspace_id, p.name as patient_name from queue_entries q left join appointments a on a.id = q.appointment_id and a.organization_id = q.organization_id left join patients p on p.id = q.patient_id and p.organization_id = q.organization_id where q.organization_id = cvg_request_organization() and cvg_request_scope_allows(q.unit_id, null) and ($1::uuid is null or q.unit_id = $1::uuid) and ($2::uuid is null or a.workspace_id = $2::uuid) order by q.checked_in_at, q.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "queue.organization_id");
        const unitId = sqlId(row.unit_id, "queue.unit_id");
        const appointmentWorkspaceId = row.appointment_workspace_id ? sqlId(row.appointment_workspace_id, "queue.appointment_workspace_id") : null;
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && appointmentWorkspaceId !== context.workspaceId)) throw new PersistenceCorruptionError(`normalized queue entry ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "queue.id"),
          organizationId,
          unitId,
          appointmentId: row.appointment_id ? sqlId(row.appointment_id, "queue.appointment_id") : null,
          patientId: sqlId(row.patient_id, "queue.patient_id"),
          status: sqlEnum(row.status, ["WAITING", "TRIAGE", "IN_SERVICE", "DONE", "CANCELLED"] as const, "queue.status"),
          priority: sqlEnum(row.priority, ["ROUTINE", "URGENT", "EMERGENCY"] as const, "queue.priority"),
          checkedInAt: sqlTimestamp(row.checked_in_at, "queue.checked_in_at"),
          patient: row.patient_name === null ? null : { id: sqlId(row.patient_id, "queue.patient.id"), name: sqlText(row.patient_name, "queue.patient.name") }
        };
      });
    });
  }

  async listEncounters(context: CvgContext): Promise<NormalizedEncounterRead[]> {
    return this.scopedRead(context, "encounters", async (client) => {
      const result = await client.query<EncounterReadRow>(
        "select e.id::text as id, e.organization_id::text as organization_id, e.unit_id::text as unit_id, e.workspace_id::text as workspace_id, e.patient_id::text as patient_id, e.appointment_id::text as appointment_id, e.chief_complaint, e.urgency, e.status, e.opened_at, e.closed_at, p.name as patient_name from encounters e left join patients p on p.id = e.patient_id and p.organization_id = e.organization_id where e.organization_id = cvg_request_organization() and cvg_request_scope_allows(e.unit_id, e.workspace_id) and ($1::uuid is null or e.unit_id = $1::uuid) and ($2::uuid is null or e.workspace_id = $2::uuid) order by e.opened_at, e.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "encounter.organization_id");
        const unitId = sqlId(row.unit_id, "encounter.unit_id");
        const workspaceId = sqlId(row.workspace_id, "encounter.workspace_id");
        const patientId = sqlId(row.patient_id, "encounter.patient_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && workspaceId !== context.workspaceId)) throw new PersistenceCorruptionError(`normalized encounter ${row.id} is outside the requested scope`);
        if (row.patient_name === null) throw new PersistenceCorruptionError(`normalized encounter ${row.id} has no patient projection`);
        return {
          id: sqlId(row.id, "encounter.id"),
          organizationId,
          unitId,
          workspaceId,
          patientId,
          appointmentId: row.appointment_id ? sqlId(row.appointment_id, "encounter.appointment_id") : null,
          chiefComplaint: sqlText(row.chief_complaint, "encounter.chief_complaint"),
          urgency: sqlEnum(row.urgency, ["ROUTINE", "URGENT", "EMERGENCY"] as const, "encounter.urgency"),
          status: sqlEnum(row.status, ["OPEN", "IN_PROGRESS", "SIGNED", "CLOSED"] as const, "encounter.status"),
          openedAt: sqlTimestamp(row.opened_at, "encounter.opened_at"),
          closedAt: sqlNullableTimestamp(row.closed_at),
          patient: { id: patientId, name: sqlText(row.patient_name, "encounter.patient_name") }
        };
      });
    });
  }

  async listClinicalDocuments(context: CvgContext): Promise<ClinicalDocument[]> {
    return this.scopedRead(context, "clinical documents", async (client) => {
      const result = await client.query<ClinicalDocumentReadRow>(
        "select d.id::text as id, d.organization_id::text as organization_id, d.unit_id::text as unit_id, d.workspace_id::text as workspace_id, d.encounter_id::text as encounter_id, d.patient_id::text as patient_id, d.author_id::text as author_id, d.document_type, d.title, d.content, d.data_class, d.status, d.version, d.signed_at, d.signed_by::text as signed_by, d.created_at from clinical_documents d where d.organization_id = cvg_request_organization() and cvg_request_scope_allows(d.unit_id, d.workspace_id) and ($1::uuid is null or d.unit_id = $1::uuid) and ($2::uuid is null or d.workspace_id = $2::uuid) order by d.created_at, d.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "clinical.organization_id");
        const unitId = sqlId(row.unit_id, "clinical.unit_id");
        const workspaceId = sqlId(row.workspace_id, "clinical.workspace_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && workspaceId !== context.workspaceId)) throw new PersistenceCorruptionError(`normalized clinical document ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "clinical.id"),
          organizationId,
          encounterId: sqlId(row.encounter_id, "clinical.encounter_id"),
          patientId: sqlId(row.patient_id, "clinical.patient_id"),
          authorId: sqlId(row.author_id, "clinical.author_id"),
          documentType: sqlEnum(row.document_type, ["EVOLUTION", "TRIAGE", "DISCHARGE", "PRESCRIPTION", "REPORT"] as const, "clinical.document_type"),
          title: sqlText(row.title, "clinical.title"),
          content: sqlText(row.content, "clinical.content"),
          dataClass: sqlEnum(row.data_class, ["D2", "D3"] as const, "clinical.data_class"),
          status: sqlEnum(row.status, ["DRAFT", "REVIEW", "SIGNED", "PUBLISHED"] as const, "clinical.status"),
          version: sqlInteger(row.version, "clinical.version"),
          signedAt: sqlNullableTimestamp(row.signed_at),
          signedBy: row.signed_by ? sqlId(row.signed_by, "clinical.signed_by") : null,
          createdAt: sqlTimestamp(row.created_at, "clinical.created_at")
        };
      });
    });
  }

  async listDiagnosticRequests(context: CvgContext): Promise<DiagnosticRequest[]> {
    return this.scopedRead(context, "diagnostic requests", async (client) => {
      const result = await client.query<DiagnosticRequestReadRow>(
        "select r.id::text as id, r.organization_id::text as organization_id, r.patient_id::text as patient_id, r.encounter_id::text as encounter_id, r.test_name, r.priority, r.status, r.requested_by::text as requested_by, r.created_at, e.unit_id::text as unit_id, e.workspace_id::text as workspace_id from diagnostic_requests r join encounters e on e.id = r.encounter_id and e.organization_id = r.organization_id where r.organization_id = cvg_request_organization() and cvg_request_scope_allows(e.unit_id, e.workspace_id) and ($1::uuid is null or e.unit_id = $1::uuid) and ($2::uuid is null or e.workspace_id = $2::uuid) order by r.created_at, r.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "diagnostic.organization_id");
        const unitId = sqlId(row.unit_id, "diagnostic.unit_id");
        const workspaceId = sqlId(row.workspace_id, "diagnostic.workspace_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && workspaceId !== context.workspaceId)) throw new PersistenceCorruptionError(`normalized diagnostic request ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "diagnostic.id"),
          organizationId,
          patientId: sqlId(row.patient_id, "diagnostic.patient_id"),
          encounterId: sqlId(row.encounter_id, "diagnostic.encounter_id"),
          testName: sqlText(row.test_name, "diagnostic.test_name"),
          priority: sqlEnum(row.priority, ["ROUTINE", "URGENT", "STAT"] as const, "diagnostic.priority"),
          status: sqlEnum(row.status, ["REQUESTED", "SPECIMEN_COLLECTED", "RESULTED", "REVIEWED", "CANCELLED"] as const, "diagnostic.status"),
          requestedBy: sqlId(row.requested_by, "diagnostic.requested_by"),
          createdAt: sqlTimestamp(row.created_at, "diagnostic.created_at")
        };
      });
    });
  }

  async listSpecimens(context: CvgContext): Promise<Specimen[]> {
    return this.scopedRead(context, "specimens", async (client) => {
      const result = await client.query<SpecimenReadRow>(
        "select s.id::text as id, s.organization_id::text as organization_id, s.request_id::text as request_id, s.patient_id::text as patient_id, s.label, s.collected_at, s.status, s.unit_id::text as unit_id, s.workspace_id::text as workspace_id from specimens s join diagnostic_requests r on r.id = s.request_id and r.organization_id = s.organization_id join encounters e on e.id = r.encounter_id and e.organization_id = r.organization_id where s.organization_id = cvg_request_organization() and s.unit_id is not distinct from e.unit_id and s.workspace_id is not distinct from e.workspace_id and cvg_request_scope_allows(s.unit_id, s.workspace_id) and ($1::uuid is null or s.unit_id = $1::uuid) and ($2::uuid is null or s.workspace_id = $2::uuid) order by s.collected_at, s.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "specimen.organization_id");
        const unitId = sqlId(row.unit_id, "specimen.unit_id");
        const workspaceId = sqlId(row.workspace_id, "specimen.workspace_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && workspaceId !== context.workspaceId)) throw new PersistenceCorruptionError(`normalized specimen ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "specimen.id"),
          organizationId,
          requestId: sqlId(row.request_id, "specimen.request_id"),
          patientId: sqlId(row.patient_id, "specimen.patient_id"),
          label: sqlText(row.label, "specimen.label"),
          collectedAt: sqlTimestamp(row.collected_at, "specimen.collected_at"),
          status: sqlEnum(row.status, ["COLLECTED", "RECEIVED", "REJECTED"] as const, "specimen.status")
        };
      });
    });
  }

  async listDiagnosticResults(context: CvgContext): Promise<DiagnosticResult[]> {
    return this.scopedRead(context, "diagnostic results", async (client) => {
      const result = await client.query<DiagnosticResultReadRow>(
        "select dr.id::text as id, dr.organization_id::text as organization_id, dr.request_id::text as request_id, dr.specimen_id::text as specimen_id, dr.patient_id::text as patient_id, dr.value, dr.source, dr.source_version, dr.status, dr.created_at, dr.unit_id::text as unit_id, dr.workspace_id::text as workspace_id from diagnostic_results dr join diagnostic_requests r on r.id = dr.request_id and r.organization_id = dr.organization_id join encounters e on e.id = r.encounter_id and e.organization_id = r.organization_id where dr.organization_id = cvg_request_organization() and dr.unit_id is not distinct from e.unit_id and dr.workspace_id is not distinct from e.workspace_id and cvg_request_scope_allows(dr.unit_id, dr.workspace_id) and ($1::uuid is null or dr.unit_id = $1::uuid) and ($2::uuid is null or dr.workspace_id = $2::uuid) order by dr.created_at, dr.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "diagnostic-result.organization_id");
        const unitId = sqlId(row.unit_id, "diagnostic-result.unit_id");
        const workspaceId = sqlId(row.workspace_id, "diagnostic-result.workspace_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && workspaceId !== context.workspaceId)) throw new PersistenceCorruptionError(`normalized diagnostic result ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "diagnostic-result.id"),
          organizationId,
          requestId: sqlId(row.request_id, "diagnostic-result.request_id"),
          specimenId: sqlId(row.specimen_id, "diagnostic-result.specimen_id"),
          patientId: sqlId(row.patient_id, "diagnostic-result.patient_id"),
          value: sqlText(row.value, "diagnostic-result.value"),
          source: sqlText(row.source, "diagnostic-result.source"),
          sourceVersion: sqlText(row.source_version, "diagnostic-result.source_version"),
          status: sqlEnum(row.status, ["RECEIVED", "QUARANTINED", "VALID", "REJECTED"] as const, "diagnostic-result.status"),
          createdAt: sqlTimestamp(row.created_at, "diagnostic-result.created_at")
        };
      });
    });
  }

  async listBeds(context: CvgContext): Promise<Bed[]> {
    return this.scopedRead(context, "beds", async (client) => {
      const result = await client.query<BedReadRow>(
        "select b.id::text as id, b.organization_id::text as organization_id, b.unit_id::text as unit_id, b.name, b.status from beds b where b.organization_id = cvg_request_organization() and cvg_request_scope_allows(b.unit_id, null) and ($1::uuid is null or b.unit_id = $1::uuid) order by b.name, b.id",
        [context.unitId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "bed.organization_id");
        const unitId = sqlId(row.unit_id, "bed.unit_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId)) throw new PersistenceCorruptionError(`normalized bed ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "bed.id"),
          organizationId,
          unitId,
          name: sqlText(row.name, "bed.name"),
          status: sqlEnum(row.status, ["AVAILABLE", "OCCUPIED", "MAINTENANCE"] as const, "bed.status")
        };
      });
    });
  }

  async listHospitalEpisodes(context: CvgContext): Promise<HospitalEpisode[]> {
    return this.scopedRead(context, "hospital episodes", async (client) => {
      const result = await client.query<HospitalEpisodeReadRow>(
        "select h.id::text as id, h.organization_id::text as organization_id, h.unit_id::text as unit_id, h.patient_id::text as patient_id, h.encounter_id::text as encounter_id, h.bed_id::text as bed_id, h.status, h.admitted_at, h.discharged_at from hospital_episodes h where h.organization_id = cvg_request_organization() and cvg_request_scope_allows(h.unit_id, null) and ($1::uuid is null or h.unit_id = $1::uuid) order by h.admitted_at nulls last, h.id",
        [context.unitId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "hospital.organization_id");
        const unitId = sqlId(row.unit_id, "hospital.unit_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId)) throw new PersistenceCorruptionError(`normalized hospital episode ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "hospital.id"),
          organizationId,
          unitId,
          patientId: sqlId(row.patient_id, "hospital.patient_id"),
          encounterId: row.encounter_id ? sqlId(row.encounter_id, "hospital.encounter_id") : null,
          bedId: row.bed_id ? sqlId(row.bed_id, "hospital.bed_id") : null,
          status: sqlEnum(row.status, ["PLANNED", "ADMITTED", "PROCEDURE", "RECOVERY", "DISCHARGED"] as const, "hospital.status"),
          admittedAt: sqlNullableTimestamp(row.admitted_at),
          dischargedAt: sqlNullableTimestamp(row.discharged_at)
        };
      });
    });
  }

  async listMedicationOrders(context: CvgContext): Promise<NormalizedMedicationOrderRead[]> {
    return this.scopedRead(context, "medication orders", async (client) => {
      const result = await client.query<MedicationOrderReadRow>(
        "select m.id::text as id, m.organization_id::text as organization_id, m.patient_id::text as patient_id, m.encounter_id::text as encounter_id, m.product_id::text as product_id, m.dose, m.route, m.frequency, m.status, m.prescribed_by::text as prescribed_by, e.unit_id::text as unit_id, e.workspace_id::text as workspace_id, p.name as product_name, p.unit as product_unit from medication_orders m join encounters e on e.id = m.encounter_id and e.organization_id = m.organization_id left join products p on p.id = m.product_id and p.organization_id = m.organization_id where m.organization_id = cvg_request_organization() and cvg_request_scope_allows(e.unit_id, e.workspace_id) and ($1::uuid is null or e.unit_id = $1::uuid) and ($2::uuid is null or e.workspace_id = $2::uuid) order by m.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "medication.organization_id");
        const unitId = sqlId(row.unit_id, "medication.unit_id");
        const workspaceId = sqlId(row.workspace_id, "medication.workspace_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && workspaceId !== context.workspaceId)) throw new PersistenceCorruptionError(`normalized medication order ${row.id} is outside the requested scope`);
        if (row.product_name === null || row.product_unit === null) throw new PersistenceCorruptionError(`normalized medication order ${row.id} has no product projection`);
        const productId = sqlId(row.product_id, "medication.product_id");
        return {
          id: sqlId(row.id, "medication.id"),
          organizationId,
          patientId: sqlId(row.patient_id, "medication.patient_id"),
          encounterId: sqlId(row.encounter_id, "medication.encounter_id"),
          productId,
          dose: sqlText(row.dose, "medication.dose"),
          route: sqlText(row.route, "medication.route"),
          frequency: sqlText(row.frequency, "medication.frequency"),
          status: sqlEnum(row.status, ["DRAFT", "ACTIVE", "SUSPENDED", "COMPLETED"] as const, "medication.status"),
          prescribedBy: sqlId(row.prescribed_by, "medication.prescribed_by"),
          product: { id: productId, name: sqlText(row.product_name, "medication.product_name"), unit: sqlText(row.product_unit, "medication.product_unit") }
        };
      });
    });
  }

  async listStock(context: CvgContext): Promise<NormalizedStockRead[]> {
    return this.scopedRead(context, "stock", async (client) => {
      const result = await client.query<StockReadRow>(
        "select l.id::text as id, l.organization_id::text as organization_id, l.product_id::text as product_id, l.lot_number, to_char(l.expires_on, 'YYYY-MM-DD') as expires_on, l.quantity, l.location_id::text as location_id, l.status, p.sku as product_sku, p.name as product_name, p.category as product_category, p.unit as product_unit, p.reorder_point as product_reorder_point, p.status as product_status, sl.unit_id::text as location_unit_id, sl.name as location_name from lots l join stock_locations sl on sl.id = l.location_id and sl.organization_id = l.organization_id left join products p on p.id = l.product_id and p.organization_id = l.organization_id where l.organization_id = cvg_request_organization() and cvg_request_scope_allows(sl.unit_id, null) and ($1::uuid is null or sl.unit_id = $1::uuid) order by l.expires_on, l.id",
        [context.unitId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "stock.organization_id");
        const locationUnitId = sqlId(row.location_unit_id, "stock.location_unit_id");
        if (organizationId !== context.organizationId || (context.unitId !== null && locationUnitId !== context.unitId)) throw new PersistenceCorruptionError(`normalized stock lot ${row.id} is outside the requested scope`);
        const productId = sqlId(row.product_id, "stock.product_id");
        const locationId = sqlId(row.location_id, "stock.location_id");
        const product = row.product_name === null || row.product_sku === null || row.product_category === null || row.product_unit === null || row.product_reorder_point === null || row.product_status === null
          ? null
          : { id: productId, organizationId, sku: sqlText(row.product_sku, "stock.product.sku"), name: sqlText(row.product_name, "stock.product.name"), category: sqlText(row.product_category, "stock.product.category"), unit: sqlText(row.product_unit, "stock.product.unit"), reorderPoint: sqlInteger(row.product_reorder_point, "stock.product.reorder_point"), status: sqlEnum(row.product_status, ["ACTIVE", "INACTIVE"] as const, "stock.product.status") } satisfies Product;
        return {
          id: sqlId(row.id, "stock.id"),
          organizationId,
          productId,
          lotNumber: sqlText(row.lot_number, "stock.lot_number"),
          expiresOn: sqlText(row.expires_on, "stock.expires_on"),
          quantity: sqlInteger(row.quantity, "stock.quantity"),
          locationId,
          status: sqlEnum(row.status, ["AVAILABLE", "EXPIRED", "BLOCKED"] as const, "stock.status"),
          product,
          location: { id: locationId, organizationId, unitId: locationUnitId, name: sqlText(row.location_name, "stock.location.name") } satisfies StockLocation
        };
      });
    });
  }

  async listCharges(context: CvgContext, openOnly = false): Promise<Charge[]> {
    return this.scopedRead(context, "charges", async (client) => {
      const result = await client.query<ChargeReadRow>(
        `select c.id::text as id, c.organization_id::text as organization_id, c.unit_id::text as unit_id, c.patient_id::text as patient_id, c.description, c.amount_cents, c.currency, c.status, c.created_at from charges c where c.organization_id = cvg_request_organization() and cvg_request_scope_allows(c.unit_id, null) and c.unit_id is not distinct from $1::uuid${openOnly ? " and c.status not in ('PAID', 'REFUNDED')" : ""} order by c.created_at, c.id`,
        [context.unitId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "charge.organization_id");
        const unitId = row.unit_id ? sqlId(row.unit_id, "charge.unit_id") : null;
        if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId)) throw new PersistenceCorruptionError(`normalized charge ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "charge.id"),
          organizationId,
          unitId,
          patientId: row.patient_id ? sqlId(row.patient_id, "charge.patient_id") : null,
          description: sqlText(row.description, "charge.description"),
          amountCents: sqlInteger(row.amount_cents, "charge.amount_cents"),
          currency: sqlText(row.currency, "charge.currency"),
          status: sqlEnum(row.status, ["OPEN", "PARTIALLY_PAID", "PAID", "REFUNDED"] as const, "charge.status"),
          createdAt: sqlTimestamp(row.created_at, "charge.created_at")
        };
      });
    });
  }

  async listPayments(context: CvgContext): Promise<Payment[]> {
    return this.scopedRead(context, "payments", async (client) => {
      const result = await client.query<PaymentReadRow>(
        "select p.id::text as id, p.organization_id::text as organization_id, p.charge_id::text as charge_id, c.unit_id::text as scope_unit_id, p.amount_cents, p.method, p.external_reference, p.status, p.created_at from payments p join charges c on c.id = p.charge_id and c.organization_id = p.organization_id where p.organization_id = cvg_request_organization() and cvg_request_scope_allows(c.unit_id, null) and c.unit_id is not distinct from $1::uuid order by p.created_at, p.id",
        [context.unitId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "payment.organization_id");
        const scopeUnitId = row.scope_unit_id ? sqlId(row.scope_unit_id, "payment.scope_unit_id") : null;
        if (organizationId !== context.organizationId || scopeUnitId !== context.unitId) throw new PersistenceCorruptionError(`normalized payment ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "payment.id"),
          organizationId,
          chargeId: sqlId(row.charge_id, "payment.charge_id"),
          amountCents: sqlInteger(row.amount_cents, "payment.amount_cents"),
          method: sqlEnum(row.method, ["PIX", "CARD", "CASH", "TRANSFER"] as const, "payment.method"),
          externalReference: sqlNullableText(row.external_reference, "payment.external_reference"),
          status: sqlEnum(row.status, ["PENDING", "SETTLED", "UNKNOWN", "REFUNDED"] as const, "payment.status"),
          createdAt: sqlTimestamp(row.created_at, "payment.created_at")
        };
      });
    });
  }

  async listLedgerEntries(context: CvgContext): Promise<LedgerEntry[]> {
    return this.scopedRead(context, "ledger entries", async (client) => {
      const result = await client.query<LedgerEntryReadRow>(
        "select l.id::text as id, l.organization_id::text as organization_id, l.kind, l.reference_id::text as reference_id, l.amount_cents, l.currency, l.description, l.created_at, coalesce(direct_charge.unit_id, payment_charge.unit_id)::text as scope_unit_id from ledger_entries l left join charges direct_charge on l.kind = 'CHARGE' and direct_charge.id = l.reference_id and direct_charge.organization_id = l.organization_id left join payments payment_ref on l.kind in ('PAYMENT', 'REFUND') and payment_ref.id = l.reference_id and payment_ref.organization_id = l.organization_id left join charges payment_charge on payment_charge.id = payment_ref.charge_id and payment_charge.organization_id = payment_ref.organization_id where l.organization_id = cvg_request_organization() and l.kind in ('CHARGE', 'PAYMENT', 'REFUND') and coalesce(direct_charge.id, payment_charge.id) is not null and cvg_request_scope_allows(coalesce(direct_charge.unit_id, payment_charge.unit_id), null) and coalesce(direct_charge.unit_id, payment_charge.unit_id) is not distinct from $1::uuid order by l.created_at, l.id",
        [context.unitId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "ledger.organization_id");
        const scopeUnitId = row.scope_unit_id ? sqlId(row.scope_unit_id, "ledger.scope_unit_id") : null;
        if (organizationId !== context.organizationId || (context.unitId !== null && scopeUnitId !== context.unitId)) throw new PersistenceCorruptionError(`normalized ledger entry ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "ledger.id"),
          organizationId,
          kind: sqlEnum(row.kind, ["CHARGE", "PAYMENT", "REFUND", "ADJUSTMENT"] as const, "ledger.kind"),
          referenceId: sqlId(row.reference_id, "ledger.reference_id"),
          amountCents: sqlInteger(row.amount_cents, "ledger.amount_cents"),
          currency: sqlText(row.currency, "ledger.currency"),
          description: sqlText(row.description, "ledger.description"),
          createdAt: sqlTimestamp(row.created_at, "ledger.created_at")
        };
      });
    });
  }

  async listMessages(context: CvgContext): Promise<CommunicationMessage[]> {
    return this.scopedRead(context, "communication messages", async (client) => {
      const result = await client.query<CommunicationReadRow>(
        "select m.id::text as id, m.organization_id::text as organization_id, m.unit_id::text as unit_id, m.workspace_id::text as workspace_id, m.patient_id::text as patient_id, m.channel, m.recipient, m.template, m.body, m.status, m.created_by::text as created_by, m.decided_by::text as decided_by, m.decided_at, m.approved_by::text as approved_by, m.approved_at, m.decision_reason, m.created_at from communication_messages m where m.organization_id = cvg_request_organization() and cvg_request_scope_allows(m.unit_id, m.workspace_id) and m.unit_id is not distinct from $1::uuid and m.workspace_id is not distinct from $2::uuid order by m.created_at, m.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "communication.organization_id");
        const unitId = row.unit_id ? sqlId(row.unit_id, "communication.unit_id") : null;
        const workspaceId = row.workspace_id ? sqlId(row.workspace_id, "communication.workspace_id") : null;
        if (organizationId !== context.organizationId || unitId !== context.unitId || workspaceId !== context.workspaceId) throw new PersistenceCorruptionError(`normalized communication ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "communication.id"),
          organizationId,
          unitId,
          workspaceId,
          patientId: row.patient_id ? sqlId(row.patient_id, "communication.patient_id") : null,
          channel: sqlEnum(row.channel, ["SMS", "EMAIL", "WHATSAPP"] as const, "communication.channel"),
          recipient: sqlText(row.recipient, "communication.recipient"),
          template: sqlText(row.template, "communication.template"),
          body: sqlText(row.body, "communication.body"),
          status: sqlEnum(row.status, ["STAGED", "APPROVAL_REQUIRED", "QUEUED", "SENT", "FAILED"] as const, "communication.status"),
          ...(row.created_by ? { createdBy: sqlId(row.created_by, "communication.created_by") } : {}),
          ...(row.decided_by ? { decidedBy: sqlId(row.decided_by, "communication.decided_by") } : {}),
          ...(row.decided_at !== null ? { decidedAt: sqlTimestamp(row.decided_at, "communication.decided_at") } : {}),
          ...(row.approved_by ? { approvedBy: sqlId(row.approved_by, "communication.approved_by") } : {}),
          ...(row.approved_at !== null ? { approvedAt: sqlTimestamp(row.approved_at, "communication.approved_at") } : {}),
          ...(row.decision_reason !== null ? { decisionReason: sqlNullableText(row.decision_reason, "communication.decision_reason") } : {}),
          createdAt: sqlTimestamp(row.created_at, "communication.created_at")
        };
      });
    });
  }

  async listKnowledgeDocuments(context: CvgContext): Promise<KnowledgeDocument[]> {
    return this.scopedRead(context, "knowledge documents", async (client) => {
      const result = await client.query<KnowledgeReadRow>(
        "select d.id::text as id, d.organization_id::text as organization_id, d.unit_id::text as unit_id, d.workspace_id::text as workspace_id, d.title, d.source, d.data_class, d.version, d.status, d.content, d.created_at from knowledge_documents d where d.organization_id = cvg_request_organization() and cvg_request_scope_allows(d.unit_id, d.workspace_id) and d.unit_id is not distinct from $1::uuid and d.workspace_id is not distinct from $2::uuid order by d.created_at, d.id",
        [context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "knowledge.organization_id");
        const unitId = row.unit_id ? sqlId(row.unit_id, "knowledge.unit_id") : null;
        const workspaceId = row.workspace_id ? sqlId(row.workspace_id, "knowledge.workspace_id") : null;
        if (organizationId !== context.organizationId || unitId !== context.unitId || workspaceId !== context.workspaceId) throw new PersistenceCorruptionError(`normalized knowledge document ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "knowledge.id"),
          organizationId,
          unitId,
          workspaceId,
          title: sqlText(row.title, "knowledge.title"),
          source: sqlText(row.source, "knowledge.source"),
          dataClass: sqlEnum(row.data_class, ["D0", "D1", "D2", "D3", "D4", "D5"] as const, "knowledge.data_class"),
          version: sqlInteger(row.version, "knowledge.version"),
          status: sqlEnum(row.status, ["DRAFT", "APPROVED", "INDEXING", "INDEXED", "QUARANTINED"] as const, "knowledge.status"),
          content: sqlText(row.content, "knowledge.content"),
          createdAt: sqlTimestamp(row.created_at, "knowledge.created_at")
        };
      });
    });
  }

  async listAiSessions(context: CvgContext): Promise<NormalizedAiSessionRead[]> {
    return this.scopedRead(context, "ai sessions", async (client) => {
      const result = await client.query<AiSessionReadRow>(
        "select s.id::text as id, s.organization_id::text as organization_id, s.actor_id::text as actor_id, s.unit_id::text as unit_id, s.workspace_id::text as workspace_id, s.patient_id::text as patient_id, s.encounter_id::text as encounter_id, s.purpose, s.engine_commit, s.profile_digest, s.status, s.created_at, count(t.id)::int as turn_count from ai_sessions s left join ai_turns t on t.session_id = s.id and t.organization_id = s.organization_id and t.unit_id is not distinct from s.unit_id and t.workspace_id is not distinct from s.workspace_id where s.organization_id = cvg_request_organization() and s.actor_id = $1::uuid and cvg_request_scope_allows(s.unit_id, s.workspace_id) and s.unit_id is not distinct from $2::uuid and s.workspace_id is not distinct from $3::uuid group by s.id, s.organization_id, s.actor_id, s.unit_id, s.workspace_id, s.patient_id, s.encounter_id, s.purpose, s.engine_commit, s.profile_digest, s.status, s.created_at order by s.created_at, s.id",
        [context.actorId, context.unitId, context.workspaceId]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "ai-session.organization_id");
        const actorId = sqlId(row.actor_id, "ai-session.actor_id");
        const unitId = row.unit_id ? sqlId(row.unit_id, "ai-session.unit_id") : null;
        const workspaceId = row.workspace_id ? sqlId(row.workspace_id, "ai-session.workspace_id") : null;
        if (organizationId !== context.organizationId || actorId !== context.actorId || unitId !== context.unitId || workspaceId !== context.workspaceId) throw new PersistenceCorruptionError(`normalized ai session ${row.id} is outside the requested scope`);
        return {
          id: sqlId(row.id, "ai-session.id"),
          organizationId,
          actorId,
          unitId,
          workspaceId,
          patientId: row.patient_id ? sqlId(row.patient_id, "ai-session.patient_id") : null,
          encounterId: row.encounter_id ? sqlId(row.encounter_id, "ai-session.encounter_id") : null,
          purpose: sqlEnum(row.purpose, ["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"] as const, "ai-session.purpose"),
          engineCommit: sqlText(row.engine_commit, "ai-session.engine_commit"),
          profileDigest: sqlText(row.profile_digest, "ai-session.profile_digest"),
          status: sqlEnum(row.status, ["ACTIVE", "CLOSED", "QUARANTINED"] as const, "ai-session.status"),
          createdAt: sqlTimestamp(row.created_at, "ai-session.created_at"),
          turns: sqlInteger(row.turn_count, "ai-session.turn_count")
        };
      });
    });
  }

  async listAudit(context: CvgContext, limit = 25, cursor: string | null = null): Promise<AuditRecord[]> {
    const boundedLimit = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 25;
    return this.scopedRead(context, "audit", async (client) => {
      const result = await client.query<AuditReadRow>(
        "select a.id::text as id, a.organization_id::text as organization_id, a.actor_id::text as actor_id, a.unit_id::text as unit_id, a.workspace_id::text as workspace_id, a.action, a.resource_type, a.resource_id::text as resource_id, a.result, a.reason, a.correlation_id, a.metadata, a.chain_version, a.previous_hash, a.record_hash, a.created_at from audit_records a where a.organization_id = cvg_request_organization() and cvg_request_scope_allows(a.unit_id, a.workspace_id) and ($1::text is null or a.id::text > $1) order by a.id limit $2::integer",
        [cursor, boundedLimit]
      );
      return result.rows.map((row) => {
        const organizationId = sqlId(row.organization_id, "audit.organization_id");
        if (organizationId !== context.organizationId) throw new PersistenceCorruptionError(`normalized audit ${row.id} belongs to another organization`);
        return {
          id: sqlId(row.id, "audit.id"),
          organizationId,
          actorId: row.actor_id ? sqlId(row.actor_id, "audit.actor_id") : null,
          unitId: row.unit_id ? sqlId(row.unit_id, "audit.unit_id") : null,
          workspaceId: row.workspace_id ? sqlId(row.workspace_id, "audit.workspace_id") : null,
          action: sqlText(row.action, "audit.action"),
          resourceType: sqlText(row.resource_type, "audit.resource_type"),
          resourceId: row.resource_id ? sqlId(row.resource_id, "audit.resource_id") : null,
          result: sqlAuditResult(row.result),
          reason: row.reason,
          correlationId: sqlText(row.correlation_id, "audit.correlation_id"),
          metadata: sqlAuditMetadata(row.metadata),
          chainVersion: sqlAuditChainVersion(row.chain_version),
          previousHash: row.previous_hash,
          recordHash: sqlText(row.record_hash, "audit.record_hash"),
          createdAt: sqlTimestamp(row.created_at, "audit.created_at")
        };
      });
    });
  }

  async createBreakGlassGrant(input: DurableBreakGlassInput): Promise<DurableBreakGlassGrant> {
    validateBreakGlassInput(input);
    return this.organizationTransaction(input.organizationId, "break-glass activation record", async (client) => {
      const result = await client.query<BreakGlassRow>(
        `insert into break_glass_grants(id, organization_id, actor_id, approver_id, reason, target, mfa_method, issued_at, expires_at, status)
         values ($1, cvg_request_organization(), $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
         on conflict (id) do nothing
         returning ${BREAK_GLASS_COLUMNS}`,
        [input.grantId, input.actorId, input.approverId, input.reason.trim(), input.target.trim(), input.mfaMethod, input.issuedAt, input.expiresAt]
      );
      if (!result.rows[0]) throw new PersistenceStateError(`break-glass grant ${input.grantId} already exists or could not be recorded`);
      return mapBreakGlassRow(result.rows[0]);
    });
  }

  async getBreakGlassGrant(organizationId: OpaqueId, grantId: OpaqueId, atMs = Date.now()): Promise<DurableBreakGlassGrant | null> {
    const at = breakGlassInstant(atMs);
    return this.organizationTransaction(organizationId, "break-glass read", async (client) => {
      await client.query(
        "update break_glass_grants set status = 'EXPIRED' where organization_id = cvg_request_organization() and id = $1 and status = 'ACTIVE' and expires_at <= $2::timestamptz",
        [grantId, at]
      );
      const result = await client.query<BreakGlassRow>(`select ${BREAK_GLASS_COLUMNS} from break_glass_grants where organization_id = cvg_request_organization() and id = $1`, [grantId]);
      return result.rows[0] ? mapBreakGlassRow(result.rows[0]) : null;
    });
  }

  async assertActiveBreakGlassGrant(organizationId: OpaqueId, grantId: OpaqueId, atMs = Date.now()): Promise<DurableBreakGlassGrant> {
    const grant = await this.getBreakGlassGrant(organizationId, grantId, atMs);
    if (!grant) throw new PersistenceStateError(`break-glass grant ${grantId} was not found`);
    if (grant.status !== "ACTIVE") throw new PersistenceStateError(`break-glass grant ${grantId} is no longer active`);
    return grant;
  }

  async revokeBreakGlassGrant(organizationId: OpaqueId, grantId: OpaqueId, atMs = Date.now()): Promise<DurableBreakGlassGrant> {
    const at = breakGlassInstant(atMs);
    return this.organizationTransaction(organizationId, "break-glass revocation", async (client) => {
      await client.query(
        "update break_glass_grants set status = 'EXPIRED' where organization_id = cvg_request_organization() and id = $1 and status = 'ACTIVE' and expires_at <= $2::timestamptz",
        [grantId, at]
      );
      const result = await client.query<BreakGlassRow>(
        `update break_glass_grants set status = 'REVOKED', revoked_at = $2::timestamptz
         where organization_id = cvg_request_organization() and id = $1 and status = 'ACTIVE' and expires_at > $2::timestamptz
         returning ${BREAK_GLASS_COLUMNS}`,
        [grantId, at]
      );
      if (result.rows[0]) return mapBreakGlassRow(result.rows[0]);
      const current = await client.query<BreakGlassRow>(`select ${BREAK_GLASS_COLUMNS} from break_glass_grants where organization_id = cvg_request_organization() and id = $1`, [grantId]);
      if (!current.rows[0]) throw new PersistenceStateError(`break-glass grant ${grantId} was not found`);
      throw new PersistenceStateError(`break-glass grant ${grantId} is no longer active`);
    });
  }

  async reviewBreakGlassGrant(organizationId: OpaqueId, grantId: OpaqueId, reviewerId: OpaqueId, note: string, atMs = Date.now()): Promise<DurableBreakGlassGrant> {
    const trimmedNote = note.trim();
    if (trimmedNote.length < 10 || note.length > 2_000) throw new PersistenceStateError("break-glass review requires a bounded note");
    const at = breakGlassInstant(atMs);
    return this.organizationTransaction(organizationId, "break-glass review", async (client) => {
      await client.query(
        "update break_glass_grants set status = 'EXPIRED' where organization_id = cvg_request_organization() and id = $1 and status = 'ACTIVE' and expires_at <= $2::timestamptz",
        [grantId, at]
      );
      const result = await client.query<BreakGlassRow>(
        `update break_glass_grants as grant_row
         set status = 'REVIEWED', reviewed_by = $2, reviewed_at = $3::timestamptz, review_note = $4
         where grant_row.organization_id = cvg_request_organization() and grant_row.id = $1 and grant_row.status in ('EXPIRED', 'REVOKED') and grant_row.reviewed_by is null and grant_row.actor_id <> $2
         returning ${BREAK_GLASS_COLUMNS}`,
        [grantId, reviewerId, at, trimmedNote]
      );
      if (result.rows[0]) return mapBreakGlassRow(result.rows[0]);
      const current = await client.query<BreakGlassRow>(`select ${BREAK_GLASS_COLUMNS} from break_glass_grants where organization_id = cvg_request_organization() and id = $1`, [grantId]);
      if (!current.rows[0]) throw new PersistenceStateError(`break-glass grant ${grantId} was not found`);
      throw new PersistenceStateError(`break-glass grant ${grantId} cannot be reviewed in its current state`);
    });
  }

  async listBreakGlassGrants(organizationId: OpaqueId, atMs = Date.now()): Promise<DurableBreakGlassGrant[]> {
    const at = breakGlassInstant(atMs);
    return this.organizationTransaction(organizationId, "break-glass list", async (client) => {
      await client.query(
        "update break_glass_grants set status = 'EXPIRED' where organization_id = cvg_request_organization() and status = 'ACTIVE' and expires_at <= $1::timestamptz",
        [at]
      );
      const result = await client.query<BreakGlassRow>(`select ${BREAK_GLASS_COLUMNS} from break_glass_grants where organization_id = cvg_request_organization() order by issued_at desc, id`);
      return result.rows.map(mapBreakGlassRow);
    });
  }

  async enqueueWorkerJob(input: DurableWorkerJobInput): Promise<DurableWorkerJobRecord> {
    validateDurableWorkerJobInput(input);
    const maxAttempts = durableWorkerMaxAttempts(input.maxAttempts);
    const recordDigest = durableWorkerJobDigest(input);
    return this.organizationTransaction(input.organizationId, "worker job admission", async (client) => {
      const inserted = await client.query<WorkerJobRow>(
        `insert into cvg_worker_jobs(id, organization_id, lane, job_type, idempotency_key, payload, status, attempts, max_attempts, available_at, record_digest) values ($1, $2, $3, $4, $5, $6::jsonb, 'PENDING', 0, $7, coalesce($8::timestamptz, now()), $9) on conflict (organization_id, lane, idempotency_key) do nothing returning ${WORKER_JOB_COLUMNS}`,
        [input.id, input.organizationId, input.lane, input.jobType.trim(), input.idempotencyKey.trim(), JSON.stringify(input.payload), maxAttempts, input.availableAt ?? null, recordDigest]
      );
      if (inserted.rows[0]) return mapWorkerJobRow(inserted.rows[0]);
      const existingResult = await client.query<WorkerJobRow>(
        `select ${WORKER_JOB_COLUMNS} from cvg_worker_jobs where organization_id = cvg_request_organization() and lane = $1 and idempotency_key = $2 for update`,
        [input.lane, input.idempotencyKey.trim()]
      );
      const existing = existingResult.rows[0];
      if (!existing) throw new PersistenceCorruptionError(`worker job ${input.id} disappeared after an idempotent admission conflict`);
      const record = mapWorkerJobRow(existing);
      if (record.recordDigest !== recordDigest) throw new PersistenceCorruptionError(`worker job ${record.id} conflicts with a different immutable admission`);
      return record;
    });
  }

  async claimWorkerJobs(organizationId: OpaqueId, lane: DurableWorkerLane, workerId: string, limit = 10, leaseSeconds = 30): Promise<DurableWorkerJobRecord[]> {
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const boundedLease = Math.min(300, Math.max(1, Math.trunc(leaseSeconds)));
    if (!DURABLE_WORKER_LANES.includes(lane)) throw new PersistenceStateError("durable worker job lane is invalid");
    if (!workerId.trim() || workerId.length > 160) throw new PersistenceStateError("durable worker worker identity is invalid");
    const normalizedWorkerId = workerId.trim();
    return this.organizationTransaction(organizationId, "worker job claim", async (client) => {
      const result = await client.query<WorkerJobRow>(
        `with expired_poison as (update cvg_worker_jobs set status = 'QUARANTINED', claimed_by = null, lease_until = null, last_error = coalesce(last_error, 'MAX_ATTEMPTS_EXCEEDED'), processed_at = now() where organization_id = cvg_request_organization() and lane = $2 and attempts >= max_attempts and ((status = 'CLAIMED' and lease_until <= now()) or status = 'PENDING')), candidates as (select id from cvg_worker_jobs where organization_id = cvg_request_organization() and lane = $2 and attempts < max_attempts and ((status = 'PENDING' and available_at <= now()) or (status = 'CLAIMED' and lease_until <= now())) order by created_at, id for update skip locked limit $3) update cvg_worker_jobs as job set status = 'CLAIMED', claimed_by = $1, lease_until = now() + ($4::int * interval '1 second'), fence_token = job.fence_token + 1, attempts = job.attempts + 1 from candidates where job.id = candidates.id and job.organization_id = cvg_request_organization() returning ${WORKER_JOB_UPDATE_COLUMNS}`,
        [normalizedWorkerId, lane, boundedLimit, boundedLease]
      );
      return result.rows.map(mapWorkerJobRow).map((record) => {
        if (record.organizationId !== organizationId) throw new PersistenceCorruptionError(`worker job ${record.id} escaped its organization scope`);
        return record;
      });
    });
  }

  async completeWorkerJob(organizationId: OpaqueId, jobId: OpaqueId, workerId: string, fenceToken: bigint): Promise<void> {
    await this.organizationTransaction(organizationId, "worker job completion", async (client) => {
      const result = await client.query<{ id: string }>(
        "update cvg_worker_jobs set status = 'COMPLETED', claimed_by = null, lease_until = null, processed_at = now() where id = $1 and organization_id = cvg_request_organization() and status = 'CLAIMED' and claimed_by = $2 and fence_token = $3::bigint and lease_until > now() returning id::text as id",
        [jobId, workerId, fenceToken.toString()]
      );
      if (!result.rows[0]) throw new OutboxLeaseLostError(`worker job ${jobId} cannot be completed by this lease`);
    });
  }

  async failWorkerJob(organizationId: OpaqueId, jobId: OpaqueId, workerId: string, fenceToken: bigint, reason: string, quarantine = false, retryAfterSeconds = 5): Promise<DurableWorkerJobStatus> {
    if (!reason.trim() || reason.length > 2_000) throw new PersistenceStateError("durable worker job failure reason is invalid");
    const nextStatus: DurableWorkerJobStatus = quarantine ? "QUARANTINED" : "PENDING";
    const boundedRetry = Math.min(3_600, Math.max(1, Math.trunc(retryAfterSeconds)));
    return this.organizationTransaction(organizationId, "worker job failure", async (client) => {
      const result = await client.query<{ status: DurableWorkerJobStatus }>(
        "update cvg_worker_jobs set status = case when $4 = 'QUARANTINED' or attempts >= max_attempts then 'QUARANTINED' else 'PENDING' end, available_at = case when $4 = 'PENDING' and attempts < max_attempts then now() + ($5::int * interval '1 second') else available_at end, claimed_by = null, lease_until = null, last_error = left(trim($6), 2000), processed_at = case when $4 = 'QUARANTINED' or attempts >= max_attempts then now() else null end where id = $1 and organization_id = cvg_request_organization() and status = 'CLAIMED' and claimed_by = $2 and fence_token = $3::bigint and lease_until > now() returning status",
        [jobId, workerId, fenceToken.toString(), nextStatus, boundedRetry, reason]
      );
      if (!result.rows[0]) throw new OutboxLeaseLostError(`worker job ${jobId} cannot be failed by this lease`);
      return result.rows[0].status;
    });
  }

  async workerJobStats(organizationId: OpaqueId, lane?: DurableWorkerLane): Promise<{ depth: number; oldestAgeMs: number; poisonMessages: number }> {
    if (lane !== undefined && !DURABLE_WORKER_LANES.includes(lane)) throw new PersistenceStateError("durable worker job lane is invalid");
    return this.organizationTransaction(organizationId, "worker job stats", async (client) => {
      const result = await client.query<{ depth: number; oldest_age_ms: string | number; poison_messages: number }>(
        "select count(*) filter (where status in ('PENDING', 'CLAIMED'))::int as depth, coalesce((extract(epoch from (now() - min(created_at) filter (where status in ('PENDING', 'CLAIMED')))) * 1000)::bigint, 0)::text as oldest_age_ms, count(*) filter (where status = 'QUARANTINED')::int as poison_messages from cvg_worker_jobs where organization_id = cvg_request_organization() and ($1::text is null or lane = $1)",
        [lane ?? null]
      );
      const row = result.rows[0];
      return { depth: row?.depth ?? 0, oldestAgeMs: row ? Number(row.oldest_age_ms) : 0, poisonMessages: row?.poison_messages ?? 0 };
    }, true);
  }

  async recordWorkerHeartbeat(input: DurableWorkerHeartbeatInput): Promise<DurableWorkerHeartbeatRecord> {
    const lastSeenAt = input.lastSeenAt ?? now();
    validateDurableWorkerHeartbeatInput(input, lastSeenAt);
    return this.organizationTransaction(input.organizationId, "worker heartbeat", async (client) => {
      const result = await client.query<WorkerHeartbeatRow>(
        `insert into cvg_worker_heartbeats(organization_id, worker_id, status, lane, cycle_id, started_at, last_seen_at, expires_at, detail) values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9) on conflict (organization_id, worker_id) do update set status = excluded.status, lane = excluded.lane, cycle_id = excluded.cycle_id, started_at = excluded.started_at, last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at, detail = excluded.detail, updated_at = now() where cvg_worker_heartbeats.last_seen_at <= excluded.last_seen_at and cvg_worker_heartbeats.started_at <= excluded.started_at returning ${WORKER_HEARTBEAT_COLUMNS}`,
        [input.organizationId, input.workerId.trim(), input.status, input.lane, input.cycleId, input.startedAt, lastSeenAt, input.expiresAt, input.detail]
      );
      if (result.rows[0]) return mapWorkerHeartbeatRow(result.rows[0]);
      const currentResult = await client.query<WorkerHeartbeatRow>(`select ${WORKER_HEARTBEAT_COLUMNS} from cvg_worker_heartbeats where organization_id = cvg_request_organization() and worker_id = $1`, [input.workerId.trim()]);
      if (currentResult.rows[0]) throw new PersistenceStateError(`worker heartbeat ${input.workerId} is stale and cannot overwrite newer liveness evidence`);
      throw new PersistenceCorruptionError(`worker heartbeat ${input.workerId} disappeared after an upsert conflict`);
    });
  }

  async listWorkerHeartbeats(organizationId: OpaqueId): Promise<DurableWorkerHeartbeatRecord[]> {
    return this.organizationTransaction(organizationId, "worker heartbeat list", async (client) => {
      const result = await client.query<WorkerHeartbeatRow>(`select ${WORKER_HEARTBEAT_COLUMNS} from cvg_worker_heartbeats where organization_id = cvg_request_organization() order by worker_id`, []);
      return result.rows.map(mapWorkerHeartbeatRow);
    }, true);
  }

  async claimOutbox(organizationId: OpaqueId, workerId: string, limit = 10, leaseSeconds = 30): Promise<DurableOutboxRecord[]> {
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const boundedLease = Math.min(300, Math.max(1, Math.trunc(leaseSeconds)));
    if (!workerId.trim() || workerId.length > 120) throw new PersistenceUnavailableError("outbox worker identity is invalid");
    return this.organizationTransaction(organizationId, "outbox claim", async (client) => {
      const result = await client.query<OutboxRow>(
        "with candidates as (select id from outbox_records where organization_id = cvg_request_organization() and ((status = 'PENDING' and available_at <= now()) or (status = 'CLAIMED' and lease_until <= now())) order by created_at, id for update skip locked limit $2) update outbox_records as o set status = 'CLAIMED', claimed_by = $1, lease_until = now() + ($3::int * interval '1 second'), fence_token = o.fence_token + 1, attempts = o.attempts + 1 from candidates where o.id = candidates.id returning o.id::text as id, o.organization_id::text as organization_id, o.event_type, o.aggregate_id::text as aggregate_id, o.payload, o.status, o.attempts, o.available_at, o.claimed_by, o.lease_until, o.fence_token::text as fence_token, o.last_error, o.created_at, o.processed_at, o.record_digest",
        [workerId, boundedLimit, boundedLease]
      );
      return result.rows.map(mapOutboxRow);
    });
  }

  async completeOutbox(organizationId: OpaqueId, recordId: OpaqueId, workerId: string, fenceToken: bigint): Promise<void> {
    await this.organizationTransaction(organizationId, "outbox completion", async (client) => {
      const result = await client.query<{ id: string }>(
        "update outbox_records set status = 'DELIVERED', claimed_by = null, lease_until = null, processed_at = now() where id = $1 and organization_id = cvg_request_organization() and status = 'CLAIMED' and claimed_by = $2 and fence_token = $3::bigint and lease_until > now() returning id::text as id",
        [recordId, workerId, fenceToken.toString()]
      );
      if (!result.rows[0]) throw new OutboxLeaseLostError(`outbox record ${recordId} cannot be completed by this lease`);
    });
  }

  async failOutbox(organizationId: OpaqueId, recordId: OpaqueId, workerId: string, fenceToken: bigint, reason: string, quarantine = false, retryAfterSeconds = 5): Promise<DurableOutboxStatus> {
    const nextStatus: DurableOutboxStatus = quarantine ? "QUARANTINED" : "PENDING";
    const boundedRetry = Math.min(3_600, Math.max(1, Math.trunc(retryAfterSeconds)));
    return this.organizationTransaction(organizationId, "outbox failure", async (client) => {
      const result = await client.query<{ status: DurableOutboxStatus }>(
        "update outbox_records set status = $4, available_at = case when $4 = 'PENDING' then now() + ($5::int * interval '1 second') else available_at end, claimed_by = null, lease_until = null, last_error = left($6, 2000), processed_at = case when $4 = 'QUARANTINED' then now() else null end where id = $1 and organization_id = cvg_request_organization() and status = 'CLAIMED' and claimed_by = $2 and fence_token = $3::bigint and lease_until > now() returning status",
        [recordId, workerId, fenceToken.toString(), nextStatus, boundedRetry, reason]
      );
      if (!result.rows[0]) throw new OutboxLeaseLostError(`outbox record ${recordId} cannot be failed by this lease`);
      return result.rows[0].status;
    });
  }

  async outboxStats(organizationId: OpaqueId): Promise<{ depth: number; oldestAgeMs: number; poisonMessages: number }> {
    return this.organizationTransaction(organizationId, "outbox stats", async (client) => {
      const result = await client.query<{ depth: number; oldest_age_ms: string | number; poison_messages: number }>(
        "select count(*) filter (where status in ('PENDING', 'CLAIMED'))::int as depth, coalesce((extract(epoch from (now() - min(created_at) filter (where status in ('PENDING', 'CLAIMED')))) * 1000)::bigint, 0)::text as oldest_age_ms, count(*) filter (where status = 'QUARANTINED')::int as poison_messages from outbox_records where organization_id = cvg_request_organization()"
      );
      const row = result.rows[0];
      return { depth: row?.depth ?? 0, oldestAgeMs: row ? Number(row.oldest_age_ms) : 0, poisonMessages: row?.poison_messages ?? 0 };
    }, true);
  }

  async recordUsage(input: DurableUsageInput): Promise<DurableUsageRecord> {
    const recordDigest = durableUsageDigest(input);
    return this.organizationTransaction(input.organizationId, "usage ledger", async (client) => {
      const result = await client.query<UsageRow>(
        "insert into ai_usage_ledger(id, organization_id, reservation_id, provider_request_id, idempotency_key, usage_kind, reserved_units, consumed_units, status, record, record_digest) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11) on conflict (organization_id, idempotency_key, usage_kind) do update set record_digest = ai_usage_ledger.record_digest where ai_usage_ledger.record_digest = excluded.record_digest returning id::text as id, organization_id::text as organization_id, reservation_id::text as reservation_id, provider_request_id, idempotency_key, usage_kind, reserved_units, consumed_units, status, record, record_digest, created_at",
        [input.id, input.organizationId, input.reservationId, input.providerRequestId, input.idempotencyKey, input.usageKind, input.reservedUnits, input.consumedUnits, input.status, JSON.stringify(input.record), recordDigest]
      );
      if (result.rows[0]) return mapUsageRow(result.rows[0]);
      throw new PersistenceCorruptionError(`usage event ${input.id} conflicts with an existing idempotency key`);
    });
  }

  async recordInboxEvent(input: DurableInboxInput): Promise<DurableInboxReceipt> {
    if (!input.consumer.trim() || !input.provider.trim() || !input.externalEventId.trim() || !input.eventType.trim()) throw new PersistenceStateError("inbox identity fields are required");
    await this.assertInboxSignature(input);
    return this.organizationTransaction(input.organizationId, "inbox event", (client) => recordInboxWithinTransaction(client, input));
  }

  async processInboxEvent(input: DurableInboxInput, outboxRecords: DurableOutboxInput[] = []): Promise<DurableInboxReceipt> {
    if (!input.consumer.trim() || !input.provider.trim() || !input.externalEventId.trim() || !input.eventType.trim()) throw new PersistenceStateError("inbox identity fields are required");
    await this.assertInboxSignature(input);
    return this.organizationTransaction(input.organizationId, "inbox event processing", async (client) => {
      const receipt = await recordInboxWithinTransaction(client, input);
      if (receipt.duplicate || receipt.status !== "RECEIVED") return receipt;
      await projectOutbox(client, input.organizationId, outboxRecords);
      const processed = await client.query<InboxRow>(
        "update integration_inbox_records set status = 'PROCESSED', processed_at = coalesce(processed_at, now()), last_seen_at = now() where id = $1 and organization_id = cvg_request_organization() and status = 'RECEIVED' returning id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at",
        [receipt.id]
      );
      if (!processed.rows[0]) throw new PersistenceCorruptionError(`inbox event ${receipt.id} could not be acknowledged after local effect commit`);
      return { ...mapInboxRow(processed.rows[0]), duplicate: false };
    });
  }

  async markInboxProcessed(organizationId: OpaqueId, recordId: OpaqueId): Promise<DurableInboxRecord> {
    return this.organizationTransaction(organizationId, "inbox processing", async (client) => {
      const result = await client.query<InboxRow>(
        "update integration_inbox_records set status = 'PROCESSED', processed_at = coalesce(processed_at, now()), last_seen_at = now() where id = $1 and organization_id = cvg_request_organization() and status = 'RECEIVED' returning id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at",
        [recordId]
      );
      if (result.rows[0]) return mapInboxRow(result.rows[0]);
      const existing = await client.query<InboxRow>(
        "select id::text as id, organization_id::text as organization_id, consumer, provider, external_event_id, event_type, schema_version, signature_algorithm, signature_key_ref, signature, payload, record_digest, status, conflict_digest, last_error, received_at, processed_at, last_seen_at from integration_inbox_records where id = $1 and organization_id = cvg_request_organization()",
        [recordId]
      );
      if (!existing.rows[0]) throw new PersistenceStateError(`inbox event ${recordId} does not exist in this organization`);
      const record = mapInboxRow(existing.rows[0]);
      if (record.status !== "PROCESSED") throw new PersistenceStateError(`inbox event ${recordId} is ${record.status} and cannot be marked processed`);
      return record;
    });
  }

  async prepareExternalEffect(input: DurableExternalEffectInput, claim: { workerId: string; fenceToken: bigint; leaseSeconds?: number }): Promise<DurableExternalEffectRecord> {
    const workerId = claim.workerId.trim();
    if (!workerId || workerId.length > 120) throw new PersistenceStateError("external effect worker identity is invalid");
    const leaseSeconds = Math.min(300, Math.max(1, Math.trunc(claim.leaseSeconds ?? 30)));
      const requestDigest = externalEffectDigest(input);
    return this.organizationTransaction(input.organizationId, "external effect admission", async (client) => {
      const select = "select id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at from external_effects";
      const inserted = await client.query<ExternalEffectRow>(
        "insert into external_effects(id, organization_id, outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token) values ($1, $2, $3, $4, $5, $6::jsonb, $7, 'ADMISSION_PENDING', 0, $8, now() + ($9::int * interval '1 second'), $10) on conflict (organization_id, integration_id, idempotency_key) do nothing returning id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at",
        [input.id, input.organizationId, input.outboxId, input.integrationId, input.idempotencyKey, JSON.stringify(input.request), requestDigest, workerId, leaseSeconds, claim.fenceToken.toString()]
      );
      if (inserted.rows[0]) return mapExternalEffectRow(inserted.rows[0]);
      const currentResult = await client.query<ExternalEffectRow>(`${select} where organization_id = cvg_request_organization() and integration_id = $1 and idempotency_key = $2 for update`, [input.integrationId, input.idempotencyKey]);
      const current = currentResult.rows[0];
      if (!current) throw new PersistenceCorruptionError(`external effect ${input.id} disappeared after an idempotent admission conflict`);
      const existing = mapExternalEffectRow(current);
      if (existing.requestDigest !== requestDigest || existing.outboxId !== input.outboxId) throw new PersistenceCorruptionError(`external effect ${existing.id} changed its immutable request or outbox binding`);
      if (existing.status === "SUCCEEDED" || existing.status === "OUTCOME_UNKNOWN" || existing.status === "RECONCILIATION_REQUIRED" || existing.status === "QUARANTINED") return existing;
      if (existing.status === "DISPATCHED") {
        await client.query(
          "update external_effects set status = 'OUTCOME_UNKNOWN', claimed_by = null, lease_until = null, last_error = 'DISPATCH_MARKER_RECOVERED_WITHOUT_OUTCOME', outcome_digest = $2, reconciliation_source = null, reconciled_at = null, updated_at = now() where id = $1 and organization_id = cvg_request_organization()",
          [existing.id, digest({ status: "OUTCOME_UNKNOWN", reason: "dispatch marker recovered without provider outcome" })]
        );
        const after = await client.query<ExternalEffectRow>(`${select} where id = $1 and organization_id = cvg_request_organization()`, [existing.id]);
        if (!after.rows[0]) throw new PersistenceCorruptionError(`external effect ${existing.id} disappeared while entering reconciliation`);
        return mapExternalEffectRow(after.rows[0]);
      }
      if (existing.status === "ADMISSION_PENDING") {
        if (existing.claimedBy === workerId && existing.fenceToken === claim.fenceToken) return existing;
        await client.query(
          "update external_effects set status = 'OUTCOME_UNKNOWN', claimed_by = null, lease_until = null, last_error = 'ADMISSION_MARKER_RECOVERED_WITHOUT_DISPATCH_PROOF', outcome_digest = $2, reconciliation_source = null, reconciled_at = null, updated_at = now() where id = $1 and organization_id = cvg_request_organization()",
          [existing.id, digest({ status: "OUTCOME_UNKNOWN", reason: "admission marker recovered without dispatch proof" })]
        );
        const after = await client.query<ExternalEffectRow>(`${select} where id = $1 and organization_id = cvg_request_organization()`, [existing.id]);
        if (!after.rows[0]) throw new PersistenceCorruptionError(`external effect ${existing.id} disappeared while entering reconciliation`);
        return mapExternalEffectRow(after.rows[0]);
      }
      const retry = await client.query<ExternalEffectRow>(
        "update external_effects set status = 'ADMISSION_PENDING', claimed_by = $2, lease_until = now() + ($3::int * interval '1 second'), fence_token = $4, provider_request_id = null, response = null, last_error = null, outcome_digest = null, reconciliation_source = null, reconciled_at = null, updated_at = now() where id = $1 and organization_id = cvg_request_organization() and status = 'FAILED_RETRYABLE' returning id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at",
        [existing.id, workerId, leaseSeconds, claim.fenceToken.toString()]
      );
      if (!retry.rows[0]) throw new PersistenceStateError(`external effect ${existing.id} cannot transition from ${existing.status} to admission`);
      return mapExternalEffectRow(retry.rows[0]);
    });
  }

  async markExternalEffectDispatched(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, fenceToken: bigint): Promise<DurableExternalEffectRecord> {
    return this.organizationTransaction(organizationId, "external effect dispatch marker", async (client) => {
      const result = await client.query<ExternalEffectRow>(
        "update external_effects set status = 'DISPATCHED', attempts = attempts + 1, updated_at = now() where id = $1 and organization_id = cvg_request_organization() and status = 'ADMISSION_PENDING' and claimed_by = $2 and fence_token = $3::bigint and lease_until > now() returning id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at",
        [effectId, workerId, fenceToken.toString()]
      );
      if (!result.rows[0]) throw new OutboxLeaseLostError(`external effect ${effectId} cannot be marked dispatched by this lease`);
      return mapExternalEffectRow(result.rows[0]);
    });
  }

  async recordExternalEffectOutcome(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, fenceToken: bigint, outcome: DurableExternalEffectOutcome): Promise<DurableExternalEffectRecord> {
    if (outcome.status === "SUCCEEDED") validateExternalSuccess(outcome.providerRequestId, outcome.response);
    const error = outcome.error ? outcome.error.slice(0, 2000) : null;
    const outcomeDigest = digest({ status: outcome.status, providerRequestId: outcome.providerRequestId ?? null, response: outcome.response ?? null, error });
    return this.organizationTransaction(organizationId, "external effect outcome", async (client) => {
      const result = await client.query<ExternalEffectRow>(
        "update external_effects set status = $4, provider_request_id = $5, response = $6::jsonb, last_error = $7, outcome_digest = $8, reconciliation_source = null, reconciled_at = null, claimed_by = null, lease_until = null, updated_at = now() where id = $1 and organization_id = cvg_request_organization() and status = 'DISPATCHED' and claimed_by = $2 and fence_token = $3::bigint and lease_until > now() returning id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at",
        [effectId, workerId, fenceToken.toString(), outcome.status, outcome.providerRequestId ?? null, outcome.response === undefined || outcome.response === null ? null : JSON.stringify(outcome.response), error, outcomeDigest]
      );
      if (!result.rows[0]) throw new OutboxLeaseLostError(`external effect ${effectId} cannot record an outcome with this lease`);
      return mapExternalEffectRow(result.rows[0]);
    });
  }

  async claimExternalEffectForReconciliation(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, leaseSeconds = 30): Promise<DurableExternalEffectRecord | null> {
    const boundedLease = Math.min(300, Math.max(1, Math.trunc(leaseSeconds)));
    if (!workerId.trim() || workerId.length > 160) throw new PersistenceStateError("external effect reconciliation worker id is invalid");
    return this.organizationTransaction(organizationId, "claim external effect reconciliation", async (client) => {
      const claimed = await client.query<ExternalEffectRow>(
        "update external_effects set status = 'RECONCILING', claimed_by = $2, lease_until = now() + ($3::int * interval '1 second'), fence_token = fence_token + 1, updated_at = now() where id = $1 and organization_id = cvg_request_organization() and (status in ('OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED') or (status = 'RECONCILING' and (lease_until is null or lease_until <= now()))) returning id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at",
        [effectId, workerId, boundedLease]
      );
      return claimed.rows[0] ? mapExternalEffectRow(claimed.rows[0]) : null;
    });
  }

  async reconcileExternalEffect(organizationId: OpaqueId, effectId: OpaqueId, evidence: DurableExternalReconciliationEvidence, claim?: { workerId: string; fenceToken: bigint }): Promise<DurableExternalEffectRecord> {
    if (evidence.status === "SUCCEEDED") validateExternalSuccess(evidence.providerRequestId, evidence.response);
    if (!evidence.observedAt || Number.isNaN(Date.parse(evidence.observedAt))) throw new PersistenceStateError("external effect reconciliation requires a valid observation timestamp");
    const expectedQueryDigest = digest({ effectId, status: evidence.status, providerRequestId: evidence.providerRequestId, response: evidence.response, observedAt: evidence.observedAt });
    if (evidence.queryDigest !== expectedQueryDigest) throw new PersistenceStateError("external effect reconciliation evidence digest is invalid");
    const error = evidence.error ? evidence.error.slice(0, 2000) : null;
    const outcomeDigest = digest({ status: evidence.status, providerRequestId: evidence.providerRequestId, response: evidence.response, error, source: evidence.source, observedAt: evidence.observedAt, queryDigest: evidence.queryDigest });
    return this.organizationTransaction(organizationId, "external effect reconciliation", async (client) => {
      const currentResult = await client.query<ExternalEffectRow>(
        "select id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at from external_effects where id = $1 and organization_id = cvg_request_organization() for update",
        [effectId]
      );
      const current = currentResult.rows[0];
      if (!current) throw new PersistenceStateError(`external effect ${effectId} does not exist in this organization`);
      const currentRecord = mapExternalEffectRow(current);
      if (currentRecord.status === evidence.status && currentRecord.outcomeDigest === outcomeDigest) return currentRecord;
      if (currentRecord.status !== "OUTCOME_UNKNOWN" && currentRecord.status !== "RECONCILIATION_REQUIRED" && currentRecord.status !== "RECONCILING") throw new PersistenceStateError(`external effect ${effectId} is ${currentRecord.status} and cannot be reconciled`);
      if (claim && (currentRecord.status !== "RECONCILING" || currentRecord.claimedBy !== claim.workerId || currentRecord.fenceToken !== claim.fenceToken || !currentRecord.leaseUntil || Date.parse(currentRecord.leaseUntil) <= Date.now())) throw new OutboxLeaseLostError(`external effect ${effectId} reconciliation lease is no longer valid`);
      const claimPredicate = claim ? " and status = 'RECONCILING' and claimed_by = $9 and fence_token = $10::bigint and lease_until > now()" : "";
      const updated = await client.query<ExternalEffectRow>(
        `update external_effects set status = $2, provider_request_id = $3, response = $4::jsonb, last_error = $5, outcome_digest = $6, reconciliation_source = $7, reconciled_at = $8, claimed_by = null, lease_until = null, updated_at = now() where id = $1 and organization_id = cvg_request_organization()${claimPredicate} returning id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at`,
        claim ? [effectId, evidence.status, evidence.providerRequestId, evidence.response === null ? null : JSON.stringify(evidence.response), error, outcomeDigest, evidence.source, evidence.observedAt, claim.workerId, claim.fenceToken.toString()] : [effectId, evidence.status, evidence.providerRequestId, evidence.response === null ? null : JSON.stringify(evidence.response), error, outcomeDigest, evidence.source, evidence.observedAt]
      );
      if (!updated.rows[0]) throw new PersistenceCorruptionError(`external effect ${effectId} disappeared during reconciliation`);
      await client.query(
        "update outbox_records set status = $2, claimed_by = null, lease_until = null, processed_at = now(), fence_token = fence_token + 1 where organization_id = cvg_request_organization() and id = $1 and status in ('PENDING', 'CLAIMED', 'QUARANTINED')",
        [currentRecord.outboxId, evidence.status === "SUCCEEDED" ? "DELIVERED" : "QUARANTINED"]
      );
      return mapExternalEffectRow(updated.rows[0]);
    });
  }

  async listExternalEffects(organizationId: OpaqueId): Promise<DurableExternalEffectRecord[]> {
    return this.organizationTransaction(organizationId, "external effects", async (client) => {
      const result = await client.query<ExternalEffectRow>("select id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at from external_effects where organization_id = cvg_request_organization() order by created_at, id");
      return result.rows.map(mapExternalEffectRow);
    }, true);
  }

  async externalEffectStats(organizationId: OpaqueId): Promise<{ reconciliationRequired: number; dispatchInFlight: number; oldestReconciliationAgeMs: number }> {
    return this.organizationTransaction(organizationId, "external effect stats", async (client) => {
      const result = await client.query<{ reconciliation_required: number; dispatch_in_flight: number; oldest_reconciliation_age_ms: string | number }>(
        "select count(*) filter (where status in ('OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED'))::int as reconciliation_required, count(*) filter (where status = 'DISPATCHED')::int as dispatch_in_flight, coalesce((extract(epoch from (now() - min(updated_at) filter (where status in ('OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED')))) * 1000)::bigint, 0)::text as oldest_reconciliation_age_ms from external_effects where organization_id = cvg_request_organization()"
      );
      const row = result.rows[0];
      return { reconciliationRequired: row?.reconciliation_required ?? 0, dispatchInFlight: row?.dispatch_in_flight ?? 0, oldestReconciliationAgeMs: row ? Number(row.oldest_reconciliation_age_ms) : 0 };
    }, true);
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end();
  }
}
