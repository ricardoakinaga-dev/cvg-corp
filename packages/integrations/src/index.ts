import type { OpaqueId } from "@cvg/contracts";
import { DomainError, digest, makeId, now } from "@cvg/domain";
import type { DurableExternalEffectInput, DurableExternalEffectOutcome, DurableExternalEffectRecord, DurableExternalReconciliationEvidence, DurableInboxInput, DurableOutboxInput, DurableOutboxRecord, PostgresPersistence } from "@cvg/persistence";

export interface IntegrationContract {
  integrationId: string;
  owner: string;
  purpose: string;
  sourceOfTruth: string;
  serviceIdentity: string;
  credentialRef: string | null;
  allowedScopes: string[];
  endpointAndRegion: string | null;
  apiVersion: string | null;
  timeoutMs: number;
  retryBudget: number;
  idempotencyKey: string;
  dataClasses: string[];
  killSwitch: boolean;
  status: "PROPOSED" | "ENABLED" | "DISABLED" | "QUARANTINED";
}

export type SecretProviderStatus = "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" | "DEGRADED";

/**
 * A provider exposes only the ability to resolve an approved reference. The
 * gateway never stores or returns the secret value, and an integration still
 * owns the actual authenticated transport in its provider adapter.
 */
export interface SecretProvider {
  status(): SecretProviderStatus;
  has(reference: string): boolean;
}

/** Synthetic-only reference registry for tests and local wiring. */
export class StaticSecretProvider implements SecretProvider {
  private readonly references: ReadonlySet<string>;

  constructor(references: readonly string[]) {
    this.references = new Set(references.filter((reference) => /^[A-Za-z0-9._:-]{1,160}$/.test(reference)));
  }

  status(): SecretProviderStatus {
    return this.references.size ? "READY" : "UNAVAILABLE";
  }

  has(reference: string): boolean {
    return this.references.has(reference);
  }
}

export interface IntegrationAttempt {
  id: OpaqueId;
  integrationId: string;
  idempotencyKey: string;
  status: "BLOCKED" | "OUTCOME_UNKNOWN";
  reason: string;
  createdAt: string;
}

export interface OutboxDeliveryReceipt {
  status: "DELIVERED";
  providerRequestId: string;
  receipt: Record<string, unknown>;
}

export interface OutboxDeliveryUnknown {
  status: "OUTCOME_UNKNOWN";
  providerRequestId?: string | null;
  evidence?: Record<string, unknown> | null;
  reason?: string;
}

export type OutboxDeliveryDecision = "DELIVERED" | "RETRY" | "QUARANTINE" | "OUTCOME_UNKNOWN" | OutboxDeliveryReceipt | OutboxDeliveryUnknown;

export interface OutboxDispatchContext {
  effectId: OpaqueId;
  integrationId: string;
  idempotencyKey: string;
  fenceToken: bigint;
}

export interface OutboxSink {
  deliver(record: DurableOutboxRecord, context?: OutboxDispatchContext): Promise<OutboxDeliveryDecision>;
}

/**
 * Converts a verified provider event into the local effect that acknowledges
 * it. The inbox row and this outbox row are committed by the persistence
 * adapter in one transaction; the provider payload never becomes an audit or
 * log field implicitly.
 */
export function inboxEventToOutbox(input: DurableInboxInput): DurableOutboxInput {
  const segment = (value: string): boolean => /^[A-Za-z0-9._:-]{1,160}$/.test(value);
  if (!segment(input.provider) || !segment(input.eventType)) throw new DomainError("INVALID_INPUT", "O evento externo não possui uma identidade transportável.", 400);
  const eventType = `integration.inbox.${input.provider}.${input.eventType}`;
  if (eventType.length > 240) throw new DomainError("INVALID_INPUT", "O tipo do evento externo excede o limite do contrato.", 400);
  return {
    id: makeId(),
    organizationId: input.organizationId,
    eventType,
    aggregateId: input.id,
    payload: {
      source: "SIGNED_INBOX",
      provider: input.provider,
      consumer: input.consumer,
      externalEventId: input.externalEventId,
      eventType: input.eventType,
      schemaVersion: input.schemaVersion,
      payload: input.payload
    }
  };
}

export interface OutboxWorkerResult {
  claimed: number;
  delivered: number;
  retried: number;
  quarantined: number;
  outcomeUnknown: number;
}

export interface ExternalEffectLedger {
  prepareExternalEffect(input: DurableExternalEffectInput, claim: { workerId: string; fenceToken: bigint; leaseSeconds?: number }): Promise<DurableExternalEffectRecord>;
  markExternalEffectDispatched(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, fenceToken: bigint): Promise<DurableExternalEffectRecord>;
  recordExternalEffectOutcome(organizationId: OpaqueId, effectId: OpaqueId, workerId: string, fenceToken: bigint, outcome: DurableExternalEffectOutcome): Promise<DurableExternalEffectRecord>;
}

export interface ExternalEffectQueryContext {
  effectId: OpaqueId;
  integrationId: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ExternalEffectQueryResult {
  status: "SUCCEEDED" | "QUARANTINED";
  providerRequestId: string | null;
  response: Record<string, unknown> | null;
  error?: string | null;
  source: "SYNTHETIC_PROVIDER_QUERY" | "PROVIDER_QUERY";
}

export interface ExternalEffectQueryAdapter {
  integrationIds: readonly string[];
  query(effect: ExternalEffectQueryContext): Promise<ExternalEffectQueryResult>;
}

/**
 * Bounded relay orchestration. Persistence owns the lease/fence transaction;
 * the worker only receives claimed records and calls a governed sink. A lost
 * lease is allowed to fail loudly so no worker can acknowledge stale work.
 */
export class OutboxWorker {
  constructor(private readonly persistence: Pick<PostgresPersistence, "claimOutbox" | "completeOutbox" | "failOutbox">, private readonly effects: ExternalEffectLedger | null = null) {}

  async runOnce(organizationId: OpaqueId, workerId: string, sink: OutboxSink, options: { limit?: number; leaseSeconds?: number; maxAttempts?: number } = {}): Promise<OutboxWorkerResult> {
    const maxAttempts = Math.min(20, Math.max(1, Math.trunc(options.maxAttempts ?? 5)));
    const records = await this.persistence.claimOutbox(organizationId, workerId, options.limit ?? 10, options.leaseSeconds ?? 30);
    const result: OutboxWorkerResult = { claimed: records.length, delivered: 0, retried: 0, quarantined: 0, outcomeUnknown: 0 };
    for (const record of records) {
      const effectInput: DurableExternalEffectInput = { id: record.id, organizationId: record.organizationId, outboxId: record.id, integrationId: `outbox:${record.eventType}`, idempotencyKey: record.id, request: { eventType: record.eventType, aggregateId: record.aggregateId, payload: record.payload, recordDigest: record.recordDigest } };
      let effect: DurableExternalEffectRecord | null = null;
      if (this.effects) {
        effect = await this.effects.prepareExternalEffect(effectInput, { workerId, fenceToken: record.fenceToken, leaseSeconds: options.leaseSeconds ?? 30 });
        if (effect.status === "SUCCEEDED") {
          await this.persistence.completeOutbox(organizationId, record.id, workerId, record.fenceToken);
          result.delivered += 1;
          continue;
        }
        if (effect.status !== "ADMISSION_PENDING") {
          const quarantine = effect.status !== "FAILED_RETRYABLE";
          if (effect.status === "OUTCOME_UNKNOWN" || effect.status === "RECONCILIATION_REQUIRED" || effect.status === "DISPATCHED") result.outcomeUnknown += 1;
          await this.persistence.failOutbox(organizationId, record.id, workerId, record.fenceToken, `external effect is ${effect.status}; dispatch is blocked until reconciliation`, quarantine, 1);
          if (quarantine) result.quarantined += 1;
          else result.retried += 1;
          continue;
        }
        await this.effects.markExternalEffectDispatched(organizationId, effect.id, workerId, record.fenceToken);
      }
      let decision: OutboxDeliveryDecision = this.effects ? "OUTCOME_UNKNOWN" : "RETRY";
      let reason = "sink did not return a delivery decision";
      let providerRequestId: string | null = null;
      let providerReceipt: Record<string, unknown> | null = null;
      try {
        const delivery = await sink.deliver(record, { effectId: effect?.id ?? record.id, integrationId: effect?.integrationId ?? `outbox:${record.eventType}`, idempotencyKey: effect?.idempotencyKey ?? record.id, fenceToken: record.fenceToken });
        if (typeof delivery === "object" && delivery !== null) {
          if (delivery.status === "DELIVERED") {
            if (!delivery.providerRequestId.trim() || !delivery.receipt || typeof delivery.receipt !== "object" || Array.isArray(delivery.receipt)) {
              decision = "OUTCOME_UNKNOWN";
              reason = "sink returned success without a verifiable provider receipt";
            } else {
              decision = "DELIVERED";
              providerRequestId = delivery.providerRequestId;
              providerReceipt = delivery.receipt;
              reason = "";
            }
          } else {
            decision = "OUTCOME_UNKNOWN";
            providerRequestId = delivery.providerRequestId ?? null;
            providerReceipt = delivery.evidence ?? null;
            reason = delivery.reason ?? "sink returned an outcome that requires reconciliation";
          }
        } else {
          decision = delivery;
          reason = decision === "RETRY" ? "sink requested a bounded retry" : decision === "QUARANTINE" ? "sink quarantined the record" : decision === "OUTCOME_UNKNOWN" ? "sink returned an outcome that requires reconciliation" : decision === "DELIVERED" ? "" : "sink did not return a delivery decision";
          if (decision === "DELIVERED" && this.effects) {
            decision = "OUTCOME_UNKNOWN";
            reason = "sink returned success without a verifiable provider receipt";
          }
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
        decision = this.effects ? "OUTCOME_UNKNOWN" : "RETRY";
      }
      if (this.effects && effect) {
        const outcome: DurableExternalEffectOutcome = decision === "DELIVERED"
          ? { status: "SUCCEEDED", providerRequestId, response: providerReceipt }
          : decision === "RETRY"
            ? { status: "FAILED_RETRYABLE", error: reason }
            : decision === "QUARANTINE"
              ? { status: "QUARANTINED", error: reason }
              : { status: "OUTCOME_UNKNOWN", error: reason };
        await this.effects.recordExternalEffectOutcome(organizationId, effect.id, workerId, record.fenceToken, outcome);
      }
      if (decision === "DELIVERED") {
        await this.persistence.completeOutbox(organizationId, record.id, workerId, record.fenceToken);
        result.delivered += 1;
        continue;
      }
      const quarantine = decision === "QUARANTINE" || decision === "OUTCOME_UNKNOWN" || record.attempts >= maxAttempts;
      await this.persistence.failOutbox(organizationId, record.id, workerId, record.fenceToken, reason, quarantine, Math.min(300, 2 ** Math.min(record.attempts, 8)));
      if (quarantine) result.quarantined += 1;
      else result.retried += 1;
      if (decision === "OUTCOME_UNKNOWN") result.outcomeUnknown += 1;
    }
    return result;
  }
}

/**
 * Reconciliation is a trusted provider-query boundary, not an HTTP assertion.
 * The adapter supplies the observation; this function binds it to the exact
 * effect and computes the digest before persistence accepts the transition.
 */
export async function reconcileUnknownExternalEffect(
  persistence: Pick<PostgresPersistence, "listExternalEffects" | "reconcileExternalEffect">,
  organizationId: OpaqueId,
  effectId: OpaqueId,
  adapter: ExternalEffectQueryAdapter,
  options: { timeoutMs?: number } = {}
): Promise<DurableExternalEffectRecord> {
  const effect = (await persistence.listExternalEffects(organizationId)).find((candidate) => candidate.id === effectId);
  if (!effect) throw new DomainError("NOT_FOUND", "Efeito externo não encontrado nesta organização.", 404);
  if (effect.status !== "OUTCOME_UNKNOWN" && effect.status !== "RECONCILIATION_REQUIRED") throw new DomainError("INVALID_STATE", "Somente efeitos sem resultado confirmado podem ser reconciliados.", 409);
  if (!adapter.integrationIds.includes(effect.integrationId)) throw new DomainError("CAPABILITY_DISABLED", "Não há query adapter autorizado para esta integração.", 503);
  const timeoutMs = Math.min(30_000, Math.max(100, Math.trunc(options.timeoutMs ?? 3_000)));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: ExternalEffectQueryResult;
  try {
    const query = adapter.query({ effectId: effect.id, integrationId: effect.integrationId, idempotencyKey: effect.idempotencyKey, request: effect.request, signal: controller.signal });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DomainError("DEPENDENCY_UNAVAILABLE", "A consulta do provider excedeu o deadline de reconciliação.", 503));
      }, timeoutMs);
    });
    result = await Promise.race([query, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!result || (result.status !== "SUCCEEDED" && result.status !== "QUARANTINED") || (result.source !== "PROVIDER_QUERY" && result.source !== "SYNTHETIC_PROVIDER_QUERY") || (result.providerRequestId !== null && typeof result.providerRequestId !== "string") || (result.response !== null && (typeof result.response !== "object" || Array.isArray(result.response)))) {
    throw new DomainError("INVALID_STATE", "O query adapter retornou uma observação inválida.", 502);
  }
  const observedAt = now();
  const evidence: DurableExternalReconciliationEvidence = {
    status: result.status,
    providerRequestId: result.providerRequestId,
    response: result.response,
    error: result.error ?? null,
    source: result.source,
    observedAt,
    queryDigest: digest({ effectId: effect.id, status: result.status, providerRequestId: result.providerRequestId, response: result.response, observedAt })
  };
  return persistence.reconcileExternalEffect(organizationId, effect.id, evidence);
}

export const integrationContracts: IntegrationContract[] = [
  { integrationId: "lab.synthetic", owner: "diagnostico", purpose: "Resultado sintético para testes de cadeia", sourceOfTruth: "CVG DiagnosticRequest/Result", serviceIdentity: "synthetic-only", credentialRef: null, allowedScopes: ["organization", "unit"], endpointAndRegion: null, apiVersion: "fixture-1", timeoutMs: 3_000, retryBudget: 0, idempotencyKey: "externalOrderId+specimenId", dataClasses: ["D3"], killSwitch: false, status: "ENABLED" },
  { integrationId: "payment.real", owner: "financeiro", purpose: "Pagamentos reais", sourceOfTruth: "provider/ledger reconciliation", serviceIdentity: "UNASSIGNED", credentialRef: null, allowedScopes: [], endpointAndRegion: null, apiVersion: null, timeoutMs: 0, retryBudget: 0, idempotencyKey: "paymentIntentId", dataClasses: ["D2"], killSwitch: true, status: "DISABLED" },
  { integrationId: "messaging.real", owner: "comunicacao", purpose: "Envio de mensagens reais", sourceOfTruth: "provider/message receipt", serviceIdentity: "UNASSIGNED", credentialRef: null, allowedScopes: [], endpointAndRegion: null, apiVersion: null, timeoutMs: 0, retryBudget: 0, idempotencyKey: "messageId", dataClasses: ["D2", "D3"], killSwitch: true, status: "DISABLED" },
  { integrationId: "calendar.real", owner: "agenda", purpose: "Calendário externo", sourceOfTruth: "CONTRACT_REQUIRED", serviceIdentity: "UNASSIGNED", credentialRef: null, allowedScopes: [], endpointAndRegion: null, apiVersion: null, timeoutMs: 0, retryBudget: 0, idempotencyKey: "appointmentId+version", dataClasses: ["D1"], killSwitch: true, status: "DISABLED" }
];

export class IntegrationGateway {
  readonly attempts: IntegrationAttempt[] = [];

  constructor(private readonly secretProvider: SecretProvider | null = null) {}

  getHealth(): { enabled: number; disabled: number; killSwitches: string[]; secretProvider: SecretProviderStatus } {
    return { enabled: integrationContracts.filter((contract) => contract.status === "ENABLED").length, disabled: integrationContracts.filter((contract) => contract.status !== "ENABLED").length, killSwitches: integrationContracts.filter((contract) => contract.killSwitch).map((contract) => contract.integrationId), secretProvider: this.secretProvider?.status() ?? "NOT_CONFIGURED" };
  }

  execute(integrationId: string, scope: string, payload: unknown, idempotencyKey: string): never {
    const contract = integrationContracts.find((candidate) => candidate.integrationId === integrationId);
    if (!contract || contract.status !== "ENABLED" || contract.killSwitch || !contract.allowedScopes.includes(scope)) {
      this.attempts.push({ id: makeId(), integrationId, idempotencyKey, status: "BLOCKED", reason: "Integration disabled, unconfigured or outside allowlist; no external dispatch occurred.", createdAt: now() });
      throw new DomainError("CAPABILITY_DISABLED", "A integração está bloqueada até existir contrato, credencial e autoridade.", 403, { integrationId, payloadDigest: digest(payload) });
    }
    if (contract.credentialRef && (!this.secretProvider || this.secretProvider.status() !== "READY" || !this.secretProvider.has(contract.credentialRef))) {
      this.attempts.push({ id: makeId(), integrationId, idempotencyKey, status: "BLOCKED", reason: "Credential reference is unavailable or outside the configured provider; no external dispatch occurred.", createdAt: now() });
      throw new DomainError("CREDENTIAL_UNAVAILABLE", "A credencial referenciada não está disponível; nenhum dispatch foi realizado.", 503, { integrationId });
    }
    throw new DomainError("DEPENDENCY_UNAVAILABLE", "A integração sintética não possui provider externo configurado.", 503, { integrationId, idempotencyKey });
  }
}
