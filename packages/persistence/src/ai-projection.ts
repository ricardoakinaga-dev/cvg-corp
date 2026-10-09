import type { PoolClient } from "pg";
import type { OpaqueId } from "@cvg/contracts";
import type { StoreSnapshot } from "@cvg/domain";

type ProjectionScope = { unitId: OpaqueId | null; workspaceId: OpaqueId | null };
type RowWriter = <T>(client: PoolClient, sql: string, rows: T[], values: (row: T) => unknown[]) => Promise<void>;
type ScopedRowWriter = <T>(client: PoolClient, sql: string, rows: T[], scope: (row: T) => ProjectionScope, values: (row: T) => unknown[]) => Promise<void>;

export interface AiProjectionDependencies {
  writeRows: RowWriter;
  writeScopedRows: ScopedRowWriter;
  corruption: (message: string) => Error;
}

/**
 * AUD27-020: projects the AI-owned normalized rows as a cohesive persistence
 * seam. Session scope is resolved from the canonical snapshot so the seam
 * cannot invent a second authorization policy.
 */
export async function projectAiRows(
  client: PoolClient,
  snapshot: StoreSnapshot,
  aiSessions: StoreSnapshot["aiSessions"],
  budgetReservations: StoreSnapshot["budgetReservations"],
  aiTurns: StoreSnapshot["aiTurns"],
  aiDrafts: StoreSnapshot["aiDrafts"],
  aiApprovals: StoreSnapshot["aiApprovals"],
  dependencies: AiProjectionDependencies
): Promise<void> {
  const { writeRows, writeScopedRows, corruption } = dependencies;
  await writeScopedRows(client,
    "insert into ai_sessions(id, organization_id, actor_id, unit_id, workspace_id, patient_id, encounter_id, purpose, engine_commit, profile_digest, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, purpose = excluded.purpose, engine_commit = excluded.engine_commit, profile_digest = excluded.profile_digest, status = excluded.status",
    aiSessions,
    (session) => ({ unitId: session.unitId, workspaceId: session.workspaceId }),
    (session) => [session.id, session.organizationId, session.actorId, session.unitId, session.workspaceId, session.patientId, session.encounterId, session.purpose, session.engineCommit, session.profileDigest, session.status, session.createdAt]
  );
  await writeRows(client,
    "insert into budget_reservations(id, organization_id, session_id, category, reserved_units, consumed_units, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, session_id = excluded.session_id, category = excluded.category, reserved_units = excluded.reserved_units, consumed_units = excluded.consumed_units, status = excluded.status",
    budgetReservations,
    (reservation) => [reservation.id, reservation.organizationId, reservation.sessionId, reservation.category, reservation.reservedUnits, reservation.consumedUnits, reservation.status, reservation.createdAt]
  );
  await writeScopedRows(client,
    "insert into ai_turns(id, organization_id, unit_id, workspace_id, session_id, prompt, response, status, model, input_tokens, output_tokens, references_json, usage_record_id, provenance_json, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, session_id = excluded.session_id, prompt = excluded.prompt, response = excluded.response, status = excluded.status, model = excluded.model, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, references_json = excluded.references_json, usage_record_id = excluded.usage_record_id, provenance_json = excluded.provenance_json",
    aiTurns, (turn) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === turn.sessionId);
      if (!session) throw corruption(`ai turn ${turn.id} has no resolvable session scope`);
      return { unitId: session.unitId, workspaceId: session.workspaceId };
    }, (turn) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === turn.sessionId);
      if (!session) throw corruption(`ai turn ${turn.id} has no resolvable session scope`);
      return [turn.id, session.organizationId, session.unitId, session.workspaceId, turn.sessionId, turn.prompt, turn.response, turn.status, turn.model, turn.inputTokens, turn.outputTokens, JSON.stringify(turn.references), turn.usage?.id ?? null, JSON.stringify(turn.provenance ?? {}), turn.createdAt];
    }
  );
  await writeScopedRows(client,
    "insert into ai_drafts(id, organization_id, unit_id, workspace_id, session_id, encounter_id, draft_type, content, source_turn_id, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, session_id = excluded.session_id, encounter_id = excluded.encounter_id, draft_type = excluded.draft_type, content = excluded.content, source_turn_id = excluded.source_turn_id, status = excluded.status",
    aiDrafts,
    (draft) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === draft.sessionId);
      if (!session) throw corruption(`ai draft ${draft.id} has no resolvable session scope`);
      return { unitId: session.unitId, workspaceId: session.workspaceId };
    },
    (draft) => {
      const session = snapshot.aiSessions.find((candidate) => candidate.id === draft.sessionId);
      if (!session) throw corruption(`ai draft ${draft.id} has no resolvable session scope`);
      return [draft.id, session.organizationId, session.unitId, session.workspaceId, draft.sessionId, draft.encounterId, draft.draftType, draft.content, draft.sourceTurnId, draft.status, draft.createdAt];
    }
  );
  await writeScopedRows(client,
    "insert into ai_approvals(id, organization_id, actor_id, session_id, turn_id, tool_name, resource_id, patient_id, encounter_id, unit_id, workspace_id, purpose, request_digest, policy_revision, expires_at, decision, decided_by, reason, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) on conflict (id) do update set organization_id = excluded.organization_id, actor_id = excluded.actor_id, session_id = excluded.session_id, turn_id = excluded.turn_id, tool_name = excluded.tool_name, resource_id = excluded.resource_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, purpose = excluded.purpose, request_digest = excluded.request_digest, policy_revision = excluded.policy_revision, expires_at = excluded.expires_at, decision = excluded.decision, decided_by = excluded.decided_by, reason = excluded.reason",
    aiApprovals,
    (approval) => ({ unitId: approval.unitId, workspaceId: approval.workspaceId }),
    (approval) => [approval.id, approval.organizationId, approval.actorId, approval.sessionId, approval.turnId, approval.toolName, approval.resourceId, approval.patientId, approval.encounterId, approval.unitId, approval.workspaceId, approval.purpose, approval.requestDigest, approval.policyRevision, approval.expiresAt, approval.decision, approval.decidedBy, approval.reason, approval.createdAt]
  );
}
