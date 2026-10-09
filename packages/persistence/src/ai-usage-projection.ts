import type { PoolClient } from "pg";
import type { OpaqueId } from "@cvg/contracts";
import { digest, type StoreSnapshot } from "@cvg/domain";

export interface AiUsageInput {
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

export function aiUsageDigest(input: AiUsageInput): string {
  const { id: _id, ...immutable } = input;
  return digest(immutable);
}

export async function projectAiTurnUsage(client: PoolClient, snapshot: StoreSnapshot, corruption: (message: string) => Error): Promise<void> {
  for (const turn of snapshot.aiTurns) {
    if ((turn.usage === undefined) !== (turn.provenance === undefined)) throw corruption(`ai turn ${turn.id} has an incomplete provenance/usage pair`);
    if (!turn.usage || !turn.provenance) continue;
    const session = snapshot.aiSessions.find((candidate) => candidate.id === turn.sessionId);
    if (!session) throw corruption(`ai turn ${turn.id} has no resolvable session for usage scope`);
    if (turn.provenance.usageRecordId !== turn.usage.id) throw corruption(`ai turn ${turn.id} provenance does not bind its usage record`);
    const input: AiUsageInput = {
      id: turn.usage.id,
      organizationId: session.organizationId,
      reservationId: turn.usage.reservationId,
      providerRequestId: turn.usage.providerRequestId,
      idempotencyKey: turn.usage.idempotencyKey,
      usageKind: turn.usage.usageKind,
      reservedUnits: turn.usage.reservedUnits,
      consumedUnits: turn.usage.consumedUnits,
      status: turn.usage.status,
      record: { ...turn.usage.record, settlement: turn.usage.settlement ?? null }
    };
    const result = await client.query<{ id: string }>(
      "insert into ai_usage_ledger(id, organization_id, reservation_id, provider_request_id, idempotency_key, usage_kind, reserved_units, consumed_units, status, record, record_digest, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) on conflict (organization_id, idempotency_key, usage_kind) do update set reserved_units = excluded.reserved_units, consumed_units = excluded.consumed_units, status = excluded.status, record = excluded.record, record_digest = excluded.record_digest, provider_request_id = excluded.provider_request_id, reservation_id = excluded.reservation_id where ai_usage_ledger.record_digest = excluded.record_digest returning id",
      [input.id, input.organizationId, input.reservationId, input.providerRequestId, input.idempotencyKey, input.usageKind, input.reservedUnits, input.consumedUnits, input.status, JSON.stringify(input.record), aiUsageDigest(input), turn.createdAt]
    );
    if (!result.rows[0]) throw corruption(`ai turn usage ${input.id} conflicts with a different idempotency record`);
  }
}
