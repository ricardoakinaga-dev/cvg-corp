import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../../apps/web/src/api/client.ts";
import {
  approvalPreview,
  availabilityFromReadiness,
  availabilityPresentation,
  failureMessageForError,
  outcomeFromTurn,
  outcomePresentation,
  type ApprovalLike
} from "../../apps/web/src/features/copilot/assistant-state.ts";

test("AI availability never collapses into a generic error", () => {
  assert.equal(availabilityFromReadiness({ aiState: "READY" }), "READY");
  assert.equal(availabilityFromReadiness({ aiState: "AI_DEGRADED" }), "AI_DEGRADED");
  assert.equal(availabilityFromReadiness({ aiState: "DISABLED" }), "DISABLED");
  assert.equal(availabilityFromReadiness({ status: "UNAVAILABLE" }), "AI_DEGRADED");
  assert.equal(availabilityFromReadiness({ status: "DISABLED" }), "DISABLED");
  assert.equal(availabilityFromReadiness(null), "UNKNOWN");
  const degraded = availabilityPresentation("AI_DEGRADED");
  assert.match(degraded.label, /indisponível/);
  assert.match(degraded.message, /seguem operacionais/);
});

test("turn outcomes map to actionable states instead of a single failure", () => {
  assert.equal(outcomeFromTurn({ status: "COMPLETED", approval: false, quarantined: false }), "NEEDS_REVIEW");
  assert.equal(outcomeFromTurn({ status: "RECEIVED", approval: true, quarantined: false }), "WAITING_APPROVAL");
  assert.equal(outcomeFromTurn({ status: "DENIED", approval: false, quarantined: false }), "POLICY_BLOCKED");
  assert.equal(outcomeFromTurn({ status: "OUTCOME_UNKNOWN", approval: false, quarantined: false }), "RECONCILIATION_REQUIRED");
  assert.equal(outcomeFromTurn({ status: "QUARANTINED", approval: false, quarantined: true }), "QUARANTINED");
  assert.match(outcomePresentation("WAITING_APPROVAL").message, /Nenhum efeito/);
  assert.match(outcomePresentation("RECONCILIATION_REQUIRED").message, /retry cego/);
});

test("API failure codes are translated to operator distinctions", () => {
  const build = (code: string, status = 403) => new ApiError("interno", { status, code, correlationId: "c", details: null });
  assert.match(failureMessageForError(build("BUDGET_EXCEEDED", 429)), /Limite de uso/);
  assert.match(failureMessageForError(build("APPROVAL_REQUIRED", 409)), /aprovação humana/);
  assert.match(failureMessageForError(build("OUTCOME_UNKNOWN", 503)), /reconciliação/);
  assert.match(failureMessageForError(build("DEPENDENCY_UNAVAILABLE", 503)), /temporariamente indisponível/);
  assert.match(failureMessageForError(build("POLICY_DENIED")), /não permitida/);
  assert.match(failureMessageForError(new TypeError("fetch failed")), /Falha de rede/);
});

test("approval preview exposes effect, target, scope, digest and expiry", () => {
  const approval: ApprovalLike = {
    id: "approval-1",
    toolName: "cvg.communication.stage",
    resourceId: "resource-9",
    patientId: "patient-1234567890ab",
    encounterId: null,
    unitId: "unit-1",
    workspaceId: "workspace-2",
    purpose: "OPERATIONS",
    requestDigest: "a".repeat(64),
    policyRevision: "local-synthetic-v1",
    expiresAt: "2026-09-16T20:00:00.000Z"
  };
  const preview = approvalPreview(approval, "Olá, sua consulta está confirmada.");
  assert.equal(preview.risk, "REVERSIBLE");
  assert.match(preview.effect, /comunicação/);
  assert.match(preview.target, /paciente patient-1234/);
  assert.match(preview.scope, /unit-1 \/ workspace-2/);
  assert.equal(preview.requestDigest.length, 16);
  assert.match(preview.preview, /consulta está confirmada/);
  assert.equal(preview.expiresAt, "2026-09-16T20:00:00.000Z");
});

test("unknown tools are presented as unknown risk, never as safe", () => {
  const approval: ApprovalLike = {
    id: "approval-2",
    toolName: "cvg.unknown.effect",
    resourceId: null,
    patientId: null,
    encounterId: null,
    unitId: null,
    workspaceId: null,
    purpose: "OPERATIONS",
    requestDigest: "b".repeat(64),
    policyRevision: "local-synthetic-v1",
    expiresAt: "2026-09-16T20:00:00.000Z"
  };
  const preview = approvalPreview(approval, null);
  assert.equal(preview.risk, "UNKNOWN");
  assert.match(preview.effect, /desconhecido/);
  assert.match(preview.preview, /sem conteúdo/);
});
