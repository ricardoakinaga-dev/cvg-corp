import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { AnimalPatient, Appointment, AuditRecord, CommandReceipt, CvgContext, Guardian, OpaqueId } from "@cvg/contracts";
import { id } from "@cvg/contracts";
import { digest, parseSnapshot, serializeSnapshot, type StoreSnapshot } from "@cvg/domain";

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
  eventId?: string;
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
  payload: Record<string, unknown>;
}

export type DurableInboxSignatureAlgorithm = "HMAC-SHA256" | "UNVERIFIED";

export interface DurableInboxRecord extends Omit<DurableInboxInput, "signatureAlgorithm"> {
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

export type DurableExternalEffectStatus = "ADMISSION_PENDING" | "DISPATCHED" | "FAILED_RETRYABLE" | "SUCCEEDED" | "OUTCOME_UNKNOWN" | "RECONCILIATION_REQUIRED" | "QUARANTINED";

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

export type DurableExternalEffectOutcomeStatus = "SUCCEEDED" | "FAILED_RETRYABLE" | "OUTCOME_UNKNOWN" | "QUARANTINED";

export interface DurableExternalEffectOutcome {
  status: DurableExternalEffectOutcomeStatus;
  providerRequestId?: string | null;
  response?: Record<string, unknown> | null;
  error?: string | null;
}

export interface DurableExternalReconciliationEvidence {
  status: "SUCCEEDED" | "QUARANTINED";
  providerRequestId: string | null;
  response: Record<string, unknown> | null;
  error?: string | null;
  source: "SYNTHETIC_PROVIDER_QUERY" | "PROVIDER_QUERY" | "MANUAL_REVIEW";
  observedAt: string;
  queryDigest: string;
}

export interface DurableRecoveryBundle extends DurableSnapshot {
  outboxRecords: DurableOutboxRecord[];
  usageRecords: DurableUsageRecord[];
  inboxRecords: DurableInboxRecord[];
  externalEffects: DurableExternalEffectRecord[];
}

export interface EncryptedRecoveryBundle {
  format: "CVG-RECOVERY-BUNDLE";
  version: 1;
  algorithm: "AES-256-GCM";
  keyRef: string;
  payloadDigest: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
}

const RECOVERY_BUNDLE_FORMAT = "CVG-RECOVERY-BUNDLE" as const;
const RECOVERY_BUNDLE_VERSION = 1 as const;
const RECOVERY_BUNDLE_ALGORITHM = "AES-256-GCM" as const;

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

function recoveryAssociatedData(keyRef: string, payloadDigest: string): Buffer {
  return Buffer.from(JSON.stringify({ format: RECOVERY_BUNDLE_FORMAT, version: RECOVERY_BUNDLE_VERSION, algorithm: RECOVERY_BUNDLE_ALGORITHM, keyRef, payloadDigest }), "utf8");
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

function parseEncryptedRecoveryBundle(value: unknown): EncryptedRecoveryBundle {
  const envelope = recoveryRecord(value, "envelope");
  if (envelope.format !== RECOVERY_BUNDLE_FORMAT || envelope.version !== RECOVERY_BUNDLE_VERSION || envelope.algorithm !== RECOVERY_BUNDLE_ALGORITHM) throw new PersistenceCorruptionError("encrypted recovery bundle format is unsupported");
  const keyRef = recoveryKeyRef(recoveryString(envelope.keyRef, "keyRef"));
  const payloadDigest = recoveryString(envelope.payloadDigest, "payloadDigest");
  if (!/^[a-f0-9]{64}$/.test(payloadDigest)) throw new PersistenceCorruptionError("encrypted recovery bundle payload digest is invalid");
  return {
    format: RECOVERY_BUNDLE_FORMAT,
    version: RECOVERY_BUNDLE_VERSION,
    algorithm: RECOVERY_BUNDLE_ALGORITHM,
    keyRef,
    payloadDigest,
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
  const snapshotDigest = recoveryString(bundle.snapshotDigest, "snapshotDigest");
  if (digest(canonicalSnapshot(snapshot)) !== snapshotDigest) throw new PersistenceCorruptionError("encrypted recovery bundle snapshot digest mismatch");
  const outboxRecords = recoveryRecords(bundle.outboxRecords, "outboxRecords").map((record) => ({ ...record, fenceToken: recoveryBigInt(record.fenceToken, "outboxRecords.fenceToken") }) as unknown as DurableOutboxRecord);
  const usageRecords = recoveryRecords(bundle.usageRecords, "usageRecords") as unknown as DurableUsageRecord[];
  const inboxRecords = recoveryRecords(bundle.inboxRecords, "inboxRecords") as unknown as DurableInboxRecord[];
  const externalEffects = recoveryRecords(bundle.externalEffects, "externalEffects").map((record) => ({ ...record, fenceToken: recoveryBigInt(record.fenceToken, "externalEffects.fenceToken") }) as unknown as DurableExternalEffectRecord);
  return {
    revision: recoveryBigInt(bundle.revision, "revision"),
    snapshot,
    snapshotDigest,
    eventId: recoveryString(bundle.eventId, "eventId"),
    outboxRecords,
    usageRecords,
    inboxRecords,
    externalEffects
  };
}

export function encryptRecoveryBundle(bundle: DurableRecoveryBundle, key: Uint8Array, keyRef: string): EncryptedRecoveryBundle {
  const safeKey = recoveryKey(key);
  const safeKeyRef = recoveryKeyRef(keyRef);
  const plaintext = Buffer.from(recoveryPlaintext(bundle), "utf8");
  const payloadDigest = digest(JSON.parse(plaintext.toString("utf8")));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", safeKey, nonce);
  cipher.setAAD(recoveryAssociatedData(safeKeyRef, payloadDigest));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: RECOVERY_BUNDLE_FORMAT,
    version: RECOVERY_BUNDLE_VERSION,
    algorithm: RECOVERY_BUNDLE_ALGORITHM,
    keyRef: safeKeyRef,
    payloadDigest,
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
    decipher.setAAD(recoveryAssociatedData(envelope.keyRef, envelope.payloadDigest));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    if (digest(parsed) !== envelope.payloadDigest) throw new PersistenceCorruptionError("encrypted recovery bundle payload digest mismatch");
    return hydrateRecoveryBundle(parsed);
  } catch (error) {
    if (error instanceof PersistenceCorruptionError) throw error;
    throw new PersistenceCorruptionError("encrypted recovery bundle authentication failed");
  }
}

interface RevisionRow {
  revision: string;
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

type SqlTimestamp = string | Date | null;

export interface NormalizedPatientRead extends AnimalPatient {
  guardian: Pick<Guardian, "id" | "displayName" | "phone"> | null;
}

export interface NormalizedAppointmentRead extends Appointment {
  patient: { id: OpaqueId; name: string } | null;
  provider: string | null;
}

function sqlId(value: unknown, field: string): OpaqueId {
  if (typeof value !== "string") throw new PersistenceCorruptionError(`normalized ${field} is not a UUID string`);
  return id(value);
}

function sqlText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new PersistenceCorruptionError(`normalized ${field} is not text`);
  return value;
}

function sqlTimestamp(value: SqlTimestamp, field: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new PersistenceCorruptionError(`normalized ${field} is null`);
}

function sqlNullableTimestamp(value: SqlTimestamp): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function sqlStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new PersistenceCorruptionError(`normalized ${field} is not a string array`);
  return [...value];
}

function sqlObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PersistenceCorruptionError(`durable ${field} is not an object`);
  return { ...(value as Record<string, unknown>) };
}

function sqlNullableObject(value: unknown, field: string): Record<string, unknown> | null {
  return value === null ? null : sqlObject(value, field);
}

function outboxDigest(input: DurableOutboxInput): string {
  return digest({ organizationId: input.organizationId, eventType: input.eventType, aggregateId: input.aggregateId, payload: input.payload });
}

function inboxDigest(input: DurableInboxInput): string {
  return digest({ organizationId: input.organizationId, consumer: input.consumer, provider: input.provider, externalEventId: input.externalEventId, eventType: input.eventType, schemaVersion: input.schemaVersion, signatureAlgorithm: input.signatureAlgorithm, signatureKeyRef: input.signatureKeyRef, payload: input.payload });
}

function externalEffectDigest(input: DurableExternalEffectInput): string {
  return digest({ organizationId: input.organizationId, outboxId: input.outboxId, integrationId: input.integrationId, idempotencyKey: input.idempotencyKey, request: input.request });
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
      "insert into users(id, organization_id, login, display_name, email, status, password_digest, last_login_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, login = excluded.login, display_name = excluded.display_name, email = excluded.email, status = excluded.status, password_digest = excluded.password_digest, last_login_at = excluded.last_login_at",
      [user.id, user.organizationId, user.login, user.displayName, user.email, user.status, user.passwordDigest, user.lastLoginAt, user.createdAt]
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
      "insert into sessions(id, organization_id, user_id, token_digest, csrf_token, expires_at, revoked_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, user_id = excluded.user_id, token_digest = excluded.token_digest, csrf_token = excluded.csrf_token, expires_at = excluded.expires_at, revoked_at = excluded.revoked_at",
      [session.id, session.organizationId, session.userId, session.tokenDigest, session.csrfToken, session.expiresAt, session.revokedAt, session.createdAt]
    );
  }
}

async function writeRows<T>(client: PoolClient, sql: string, rows: T[], values: (row: T) => unknown[]): Promise<void> {
  for (const row of rows) await client.query(sql, values(row));
}

async function writeScopedRows<T>(client: PoolClient, sql: string, rows: T[], scope: (row: T) => { unitId: OpaqueId; workspaceId: OpaqueId }, values: (row: T) => unknown[]): Promise<void> {
  for (const row of rows) {
    const selected = scope(row);
    await client.query("select set_config('cvg.unit_id', $1, true)", [selected.unitId]);
    await client.query("select set_config('cvg.workspace_id', $1, true)", [selected.workspaceId]);
    await client.query(sql, values(row));
  }
}

async function projectDomain(client: PoolClient, snapshot: StoreSnapshot): Promise<void> {
  await writeRows(client,
    "insert into guardians(id, organization_id, unit_id, workspace_id, display_name, phone, email, data_class, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, display_name = excluded.display_name, phone = excluded.phone, email = excluded.email, data_class = excluded.data_class, status = excluded.status",
    snapshot.guardians,
    (guardian) => [guardian.id, guardian.organizationId, guardian.unitId, guardian.workspaceId, guardian.displayName, guardian.phone, guardian.email, guardian.dataClass, guardian.status]
  );
  await writeRows(client,
    "insert into patients(id, organization_id, unit_id, workspace_id, guardian_id, name, species, breed, sex, reproductive_status, birth_date, identifiers, data_class, status, merged_into_id, status_changed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, guardian_id = excluded.guardian_id, name = excluded.name, species = excluded.species, breed = excluded.breed, sex = excluded.sex, reproductive_status = excluded.reproductive_status, birth_date = excluded.birth_date, identifiers = excluded.identifiers, data_class = excluded.data_class, status = excluded.status, merged_into_id = excluded.merged_into_id, status_changed_at = excluded.status_changed_at",
    snapshot.patients,
    (patient) => [patient.id, patient.organizationId, patient.unitId, patient.workspaceId, patient.guardianId, patient.name, patient.species, patient.breed, patient.sex, patient.reproductiveStatus, patient.birthDate, JSON.stringify(patient.identifiers), patient.dataClass, patient.status, patient.mergedIntoId, patient.statusChangedAt, patient.createdAt]
  );
  await writeRows(client,
    "insert into service_catalog_items(id, organization_id, name, duration_minutes, price_cents, status) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set organization_id = excluded.organization_id, name = excluded.name, duration_minutes = excluded.duration_minutes, price_cents = excluded.price_cents, status = excluded.status",
    snapshot.services,
    (service) => [service.id, service.organizationId, service.name, service.durationMinutes, service.priceCents, service.status]
  );
  await writeRows(client,
    "insert into providers(id, organization_id, unit_id, display_name, specialty, role, status) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, display_name = excluded.display_name, specialty = excluded.specialty, role = excluded.role, status = excluded.status",
    snapshot.providers,
    (provider) => [provider.id, provider.organizationId, provider.unitId, provider.displayName, provider.specialty, provider.role, provider.status]
  );
  await writeRows(client,
    "insert into resources(id, organization_id, unit_id, name, kind, status) values ($1, $2, $3, $4, $5, $6) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name, kind = excluded.kind, status = excluded.status",
    snapshot.resources,
    (resource) => [resource.id, resource.organizationId, resource.unitId, resource.name, resource.kind, resource.status]
  );
  await writeRows(client,
    "insert into appointments(id, organization_id, unit_id, workspace_id, patient_id, provider_id, resource_id, service_id, starts_at, ends_at, purpose, status, version, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, provider_id = excluded.provider_id, resource_id = excluded.resource_id, service_id = excluded.service_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at, purpose = excluded.purpose, status = excluded.status, version = excluded.version",
    snapshot.appointments,
    (appointment) => [appointment.id, appointment.organizationId, appointment.unitId, appointment.workspaceId, appointment.patientId, appointment.providerId, appointment.resourceId, appointment.serviceId, appointment.startsAt, appointment.endsAt, appointment.purpose, appointment.status, appointment.version, appointment.createdAt]
  );
  await writeRows(client,
    "insert into queue_entries(id, organization_id, unit_id, appointment_id, patient_id, status, priority, checked_in_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, appointment_id = excluded.appointment_id, patient_id = excluded.patient_id, status = excluded.status, priority = excluded.priority, checked_in_at = excluded.checked_in_at",
    snapshot.queueEntries,
    (entry) => [entry.id, entry.organizationId, entry.unitId, entry.appointmentId, entry.patientId, entry.status, entry.priority, entry.checkedInAt]
  );
  await writeRows(client,
    "insert into encounters(id, organization_id, unit_id, workspace_id, patient_id, appointment_id, chief_complaint, urgency, status, opened_at, closed_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, appointment_id = excluded.appointment_id, chief_complaint = excluded.chief_complaint, urgency = excluded.urgency, status = excluded.status, opened_at = excluded.opened_at, closed_at = excluded.closed_at",
    snapshot.encounters,
    (encounter) => [encounter.id, encounter.organizationId, encounter.unitId, encounter.workspaceId, encounter.patientId, encounter.appointmentId, encounter.chiefComplaint, encounter.urgency, encounter.status, encounter.openedAt, encounter.closedAt]
  );
  const encounterById = new Map(snapshot.encounters.map((encounter) => [encounter.id, encounter]));
  const clinicalDocumentRows = snapshot.clinicalDocuments.map((document) => {
    const encounter = encounterById.get(document.encounterId);
    if (!encounter || encounter.organizationId !== document.organizationId) throw new PersistenceCorruptionError(`clinical document ${document.id} has no organization-bound encounter`);
    return { document, encounter };
  });
  await writeScopedRows(client,
    "insert into clinical_documents(id, organization_id, unit_id, workspace_id, encounter_id, patient_id, author_id, document_type, title, content, data_class, status, version, signed_at, signed_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, encounter_id = excluded.encounter_id, patient_id = excluded.patient_id, author_id = excluded.author_id, document_type = excluded.document_type, title = excluded.title, content = excluded.content, data_class = excluded.data_class, status = excluded.status, version = excluded.version, signed_at = excluded.signed_at, signed_by = excluded.signed_by",
    clinicalDocumentRows,
    ({ encounter }) => ({ unitId: encounter.unitId, workspaceId: encounter.workspaceId }),
    ({ document, encounter }) => [document.id, document.organizationId, encounter.unitId, encounter.workspaceId, document.encounterId, document.patientId, document.authorId, document.documentType, document.title, document.content, document.dataClass, document.status, document.version, document.signedAt, document.signedBy, document.createdAt]
  );
  const documentById = new Map(clinicalDocumentRows.map(({ document, encounter }) => [document.id, { document, encounter }]));
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
  await writeRows(client,
    "insert into diagnostic_requests(id, organization_id, patient_id, encounter_id, test_name, priority, status, requested_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, test_name = excluded.test_name, priority = excluded.priority, status = excluded.status, requested_by = excluded.requested_by",
    snapshot.diagnosticRequests,
    (request) => [request.id, request.organizationId, request.patientId, request.encounterId, request.testName, request.priority, request.status, request.requestedBy, request.createdAt]
  );
  await writeRows(client,
    "insert into specimens(id, organization_id, request_id, patient_id, label, collected_at, status) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set organization_id = excluded.organization_id, request_id = excluded.request_id, patient_id = excluded.patient_id, label = excluded.label, collected_at = excluded.collected_at, status = excluded.status",
    snapshot.specimens,
    (specimen) => [specimen.id, specimen.organizationId, specimen.requestId, specimen.patientId, specimen.label, specimen.collectedAt, specimen.status]
  );
  await writeRows(client,
    "insert into diagnostic_results(id, organization_id, request_id, specimen_id, patient_id, value, source, source_version, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do update set organization_id = excluded.organization_id, request_id = excluded.request_id, specimen_id = excluded.specimen_id, patient_id = excluded.patient_id, value = excluded.value, source = excluded.source, source_version = excluded.source_version, status = excluded.status",
    snapshot.diagnosticResults,
    (result) => [result.id, result.organizationId, result.requestId, result.specimenId, result.patientId, result.value, result.source, result.sourceVersion, result.status, result.createdAt]
  );
  await writeRows(client,
    "insert into beds(id, organization_id, unit_id, name, status) values ($1, $2, $3, $4, $5) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name, status = excluded.status",
    snapshot.beds,
    (bed) => [bed.id, bed.organizationId, bed.unitId, bed.name, bed.status]
  );
  await writeRows(client,
    "insert into hospital_episodes(id, organization_id, unit_id, patient_id, encounter_id, bed_id, status, admitted_at, discharged_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, bed_id = excluded.bed_id, status = excluded.status, admitted_at = excluded.admitted_at, discharged_at = excluded.discharged_at",
    snapshot.hospitalEpisodes,
    (episode) => [episode.id, episode.organizationId, episode.unitId, episode.patientId, episode.encounterId, episode.bedId, episode.status, episode.admittedAt, episode.dischargedAt]
  );
  await writeRows(client,
    "insert into products(id, organization_id, sku, name, category, unit, reorder_point, status) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, sku = excluded.sku, name = excluded.name, category = excluded.category, unit = excluded.unit, reorder_point = excluded.reorder_point, status = excluded.status",
    snapshot.products,
    (product) => [product.id, product.organizationId, product.sku, product.name, product.category, product.unit, product.reorderPoint, product.status]
  );
  await writeRows(client,
    "insert into stock_locations(id, organization_id, unit_id, name) values ($1, $2, $3, $4) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, name = excluded.name",
    snapshot.stockLocations,
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
  await writeRows(client,
    "insert into charges(id, organization_id, unit_id, patient_id, description, amount_cents, currency, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, patient_id = excluded.patient_id, description = excluded.description, amount_cents = excluded.amount_cents, currency = excluded.currency, status = excluded.status",
    snapshot.charges,
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
  await writeRows(client,
    "insert into communication_messages(id, organization_id, unit_id, workspace_id, patient_id, channel, recipient, template, body, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, channel = excluded.channel, recipient = excluded.recipient, template = excluded.template, body = excluded.body, status = excluded.status",
    snapshot.messages,
    (message) => [message.id, message.organizationId, message.unitId, message.workspaceId, message.patientId, message.channel, message.recipient, message.template, message.body, message.status, message.createdAt]
  );
  await writeRows(client,
    "insert into knowledge_documents(id, organization_id, unit_id, workspace_id, title, source, data_class, version, status, content, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, title = excluded.title, source = excluded.source, data_class = excluded.data_class, version = excluded.version, status = excluded.status, content = excluded.content",
    snapshot.knowledgeDocuments,
    (document) => [document.id, document.organizationId, document.unitId, document.workspaceId, document.title, document.source, document.dataClass, document.version, document.status, document.content, document.createdAt]
  );
  await writeRows(client,
    "insert into ai_sessions(id, organization_id, actor_id, unit_id, workspace_id, patient_id, encounter_id, purpose, engine_commit, profile_digest, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, purpose = excluded.purpose, engine_commit = excluded.engine_commit, profile_digest = excluded.profile_digest, status = excluded.status",
    snapshot.aiSessions,
    (session) => [session.id, session.organizationId, session.actorId, session.unitId, session.workspaceId, session.patientId, session.encounterId, session.purpose, session.engineCommit, session.profileDigest, session.status, session.createdAt]
  );
  await writeRows(client,
    "insert into ai_turns(id, session_id, prompt, response, status, model, input_tokens, output_tokens, references_json, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) on conflict (id) do update set session_id = excluded.session_id, prompt = excluded.prompt, response = excluded.response, status = excluded.status, model = excluded.model, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, references_json = excluded.references_json",
    snapshot.aiTurns,
    (turn) => [turn.id, turn.sessionId, turn.prompt, turn.response, turn.status, turn.model, turn.inputTokens, turn.outputTokens, JSON.stringify(turn.references), turn.createdAt]
  );
  await writeRows(client,
    "insert into ai_drafts(id, session_id, encounter_id, draft_type, content, source_turn_id, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set session_id = excluded.session_id, encounter_id = excluded.encounter_id, draft_type = excluded.draft_type, content = excluded.content, source_turn_id = excluded.source_turn_id, status = excluded.status",
    snapshot.aiDrafts,
    (draft) => [draft.id, draft.sessionId, draft.encounterId, draft.draftType, draft.content, draft.sourceTurnId, draft.status, draft.createdAt]
  );
  await writeRows(client,
    "insert into ai_approvals(id, organization_id, actor_id, session_id, turn_id, tool_name, resource_id, patient_id, encounter_id, unit_id, workspace_id, purpose, request_digest, policy_revision, expires_at, decision, decided_by, reason, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, session_id = excluded.session_id, turn_id = excluded.turn_id, tool_name = excluded.tool_name, resource_id = excluded.resource_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, purpose = excluded.purpose, request_digest = excluded.request_digest, policy_revision = excluded.policy_revision, expires_at = excluded.expires_at, decision = excluded.decision, decided_by = excluded.decided_by, reason = excluded.reason",
    snapshot.aiApprovals,
    (approval) => [approval.id, approval.organizationId, approval.actorId, approval.sessionId, approval.turnId, approval.toolName, approval.resourceId, approval.patientId, approval.encounterId, approval.unitId, approval.workspaceId, approval.purpose, approval.requestDigest, approval.policyRevision, approval.expiresAt, approval.decision, approval.decidedBy, approval.reason, approval.createdAt]
  );
  await writeRows(client,
    "insert into budget_reservations(id, organization_id, session_id, category, reserved_units, consumed_units, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, session_id = excluded.session_id, category = excluded.category, reserved_units = excluded.reserved_units, consumed_units = excluded.consumed_units, status = excluded.status",
    snapshot.budgetReservations,
    (reservation) => [reservation.id, reservation.organizationId, reservation.sessionId, reservation.category, reservation.reservedUnits, reservation.consumedUnits, reservation.status, reservation.createdAt]
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
      const result = await this.pool.query<{ snapshots: boolean; journal: boolean; audit: boolean; receipts: boolean; communications: boolean; outbox: boolean; usage_ledger: boolean; inbox: boolean; external_effects: boolean }>("select to_regclass('public.cvg_state_snapshots') is not null as snapshots, to_regclass('public.cvg_event_journal') is not null as journal, to_regclass('public.cvg_audit_ledger') is not null as audit, to_regclass('public.cvg_command_receipt_ledger') is not null as receipts, to_regclass('public.communication_messages') is not null as communications, to_regclass('public.outbox_records') is not null as outbox, to_regclass('public.ai_usage_ledger') is not null as usage_ledger, to_regclass('public.integration_inbox_records') is not null as inbox, to_regclass('public.external_effects') is not null as external_effects");
      const row = result.rows[0];
      if (!row?.snapshots || !row.journal || !row.audit || !row.receipts || !row.communications || !row.outbox || !row.usage_ledger || !row.inbox || !row.external_effects) throw new PersistenceUnavailableError("CVG persistence schema is not installed; run npm run db:migrate");
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
      return {
        revision: revisionOf(row.revision),
        snapshot,
        snapshotDigest: row.snapshot_digest,
        eventId: row.event_id,
        outboxRecords: outboxResult.rows.map(mapOutboxRow),
        usageRecords: usageResult.rows.map(mapUsageRow),
        inboxRecords: inboxResult.rows.map(mapInboxRow),
        externalEffects: effectsResult.rows.map(mapExternalEffectRow)
      };
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
      await projectDomain(client, input.snapshot);
      await projectOutbox(client, organizationId, input.outboxRecords ?? []);
      await projectRecoveredOutbox(client, organizationId, input.recoveredOutboxRecords ?? []);
      await projectRecoveredUsage(client, organizationId, input.recoveredUsageRecords ?? []);
      await projectRecoveredInbox(client, organizationId, input.recoveredInboxRecords ?? []);
      await projectRecoveredExternalEffects(client, organizationId, input.recoveredExternalEffects ?? []);
      await client.query(
        "insert into cvg_event_journal(event_id, event_type, organization_id, actor_id, correlation_id, operation, aggregate_type, aggregate_id, payload, snapshot_digest) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)",
        [eventId, input.eventType, organizationId, input.actorId, input.correlationId, input.operation, input.aggregateType, input.aggregateId, JSON.stringify(input.payload), snapshotDigest]
      );
      for (const audit of input.auditRecords ?? []) {
        await client.query(
          "insert into audit_records(id, organization_id, actor_id, unit_id, workspace_id, action, resource_type, resource_id, result, reason, correlation_id, metadata, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13) on conflict (id) do nothing",
          [audit.id, audit.organizationId, audit.actorId, audit.unitId, audit.workspaceId, audit.action, audit.resourceType, audit.resourceId, audit.result, audit.reason, audit.correlationId, JSON.stringify(audit.metadata), audit.createdAt]
        );
        const result = await client.query<{ audit_id: string }>(
          "insert into cvg_audit_ledger(audit_id, organization_id, record, record_digest) values ($1, $2, $3::jsonb, $4) on conflict (audit_id) do update set record_digest = cvg_audit_ledger.record_digest where cvg_audit_ledger.record_digest = excluded.record_digest returning audit_id",
          [audit.id, audit.organizationId, JSON.stringify(audit), digest(audit)]
        );
        if (!result.rows[0]) throw new PersistenceCorruptionError(`audit record ${audit.id} changed after it was durably recorded`);
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

  async listAppointments(context: CvgContext): Promise<NormalizedAppointmentRead[]> {
    return this.scopedRead(context, "appointments", async (client) => {
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
        "select a.id::text as id, a.organization_id::text as organization_id, a.unit_id::text as unit_id, a.workspace_id::text as workspace_id, a.patient_id::text as patient_id, a.provider_id::text as provider_id, a.resource_id::text as resource_id, a.service_id::text as service_id, a.starts_at, a.ends_at, a.purpose, a.status, a.version, a.created_at, p.name as patient_name, pr.display_name as provider_name from appointments a left join patients p on p.id = a.patient_id and p.organization_id = a.organization_id left join providers pr on pr.id = a.provider_id and pr.organization_id = a.organization_id where a.organization_id = cvg_request_organization() and ($1::uuid is null or a.unit_id = $1::uuid) and ($2::uuid is null or a.workspace_id = $2::uuid) order by a.starts_at, a.id",
        [context.unitId, context.workspaceId]
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
        "update outbox_records set status = $4, available_at = case when $4 = 'PENDING' then now() + ($5::int * interval '1 second') else available_at end, claimed_by = null, lease_until = null, last_error = left($6, 2000), processed_at = case when $4 = 'QUARANTINED' then now() else null end where id = $1 and organization_id = cvg_request_organization() and status = 'CLAIMED' and claimed_by = $2 and fence_token = $3::bigint returning status",
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
    const { id: _id, ...immutable } = input;
    const recordDigest = digest(immutable);
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

  async reconcileExternalEffect(organizationId: OpaqueId, effectId: OpaqueId, evidence: DurableExternalReconciliationEvidence): Promise<DurableExternalEffectRecord> {
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
      if (currentRecord.status !== "OUTCOME_UNKNOWN" && currentRecord.status !== "RECONCILIATION_REQUIRED") throw new PersistenceStateError(`external effect ${effectId} is ${currentRecord.status} and cannot be reconciled`);
      const updated = await client.query<ExternalEffectRow>(
        "update external_effects set status = $2, provider_request_id = $3, response = $4::jsonb, last_error = $5, outcome_digest = $6, reconciliation_source = $7, reconciled_at = $8, claimed_by = null, lease_until = null, updated_at = now() where id = $1 and organization_id = cvg_request_organization() returning id::text as id, organization_id::text as organization_id, outbox_id::text as outbox_id, integration_id, idempotency_key, request, request_digest, status, attempts, claimed_by, lease_until, fence_token::text as fence_token, provider_request_id, response, last_error, outcome_digest, reconciliation_source, reconciled_at, created_at, updated_at",
        [effectId, evidence.status, evidence.providerRequestId, evidence.response === null ? null : JSON.stringify(evidence.response), error, outcomeDigest, evidence.source, evidence.observedAt]
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
