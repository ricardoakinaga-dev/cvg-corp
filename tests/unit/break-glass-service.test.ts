import assert from "node:assert/strict";
import test from "node:test";
import { id, type AuditRecord, type CvgContext, type OpaqueId } from "@cvg/contracts";
import { DomainError } from "@cvg/domain";
import type { DurableBreakGlassActivationRecord, DurableBreakGlassAuditInput, DurableBreakGlassGrant, DurableBreakGlassInput } from "@cvg/persistence";
import {
  BreakGlassApplicationService,
  BreakGlassAuthorityUnavailableError,
  type BreakGlassActivationInput,
  type BreakGlassScope,
  type BreakGlassScopeAuthority,
  type BreakGlassWebAuthnAuthority,
  WebAuthnProviderBreakGlassAuthority,
  type BreakGlassPersistencePort
} from "../../apps/api/src/application/break-glass-service.ts";

const organizationId = id("00000000-0000-4000-8000-000000000010");
const actorId = id("00000000-0000-4000-8000-000000000011");
const approverId = id("00000000-0000-4000-8000-000000000012");
const unitId = id("00000000-0000-4000-8000-000000000013");
const workspaceId = id("00000000-0000-4000-8000-000000000014");
const sessionId = id("00000000-0000-4000-8000-000000000015");

const scope: BreakGlassScope = { type: "WORKSPACE", unitId, workspaceId };

function contextFor(purpose: "security.break_glass.activate" | "security.break_glass.assert", correlationId: string): CvgContext {
  return {
    organizationId,
    unitId,
    workspaceId,
    actorId,
    sessionId,
    actorRoleSnapshot: ["admin"],
    patientId: null,
    encounterId: null,
    purpose,
    policyRevision: "fixture-policy",
    correlationId
  };
}

function input(overrides: Partial<BreakGlassActivationInput> = {}, now = Date.now()): BreakGlassActivationInput {
  return {
    context: contextFor("security.break_glass.activate", "break-glass-test-correlation"),
    organizationId,
    actorId,
    approverId,
    reason: "incidente clínico que exige acesso emergencial",
    target: "patient:00000000-0000-4000-8000-000000000099",
    scope,
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    correlationId: "break-glass-test-correlation",
    challenge: {
      challengeId: "challenge-0000000001",
      userId: approverId,
      challenge: "challenge-value-001",
      rpId: "cvg.example.test",
      origin: "https://cvg.example.test/",
      expiresAt: new Date(now + 60_000).toISOString(),
      attempts: 0,
      maxAttempts: 3,
      status: "PENDING"
    },
    assertion: {
      challengeId: "challenge-0000000001",
      credentialId: "credential-0000000001",
      clientDataJson: "eyJ0eXBlIjoid2ViaXV0aG4uZ2V0In0",
      authenticatorData: "A".repeat(64),
      signature: "B".repeat(64),
      userHandle: null,
      userVerified: true
    },
    ...overrides
  };
}

class OneShotWebAuthn implements BreakGlassWebAuthnAuthority {
  calls = 0;
  private consumed = false;

  async verifyAndConsume({ challenge, assertion }: Parameters<BreakGlassWebAuthnAuthority["verifyAndConsume"]>[0]) {
    this.calls += 1;
    if (this.consumed) throw new Error("challenge already consumed");
    this.consumed = true;
    return { userId: challenge.userId, credentialId: assertion.credentialId, signCount: 7 };
  }
}

class AllowScope implements BreakGlassScopeAuthority {
  calls = 0;
  async assertTargetAllowed(): Promise<void> {
    this.calls += 1;
  }
}

class InMemoryBreakGlassPersistence implements BreakGlassPersistencePort {
  activation: DurableBreakGlassActivationRecord | null = null;
  calls = 0;

  async createBreakGlassGrantWithAudit(grantInput: DurableBreakGlassInput, auditInput: DurableBreakGlassAuditInput): Promise<DurableBreakGlassActivationRecord> {
    this.calls += 1;
    const grant: DurableBreakGlassGrant = {
      ...grantInput,
      scope: grantInput.scope ?? "ORGANIZATION",
      status: "ACTIVE",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      revokedAt: null,
      createdAt: grantInput.issuedAt
    };
    const audit: AuditRecord = {
      ...auditInput,
      id: id("00000000-0000-4000-8000-000000000099"),
      chainVersion: 2,
      previousHash: null,
      recordHash: "audit-record-hash",
      createdAt: grantInput.issuedAt
    };
    this.activation = { grant, audit };
    return this.activation;
  }

  async assertActiveBreakGlassGrant(_organization: OpaqueId, grantId: OpaqueId, atMs = Date.now()): Promise<DurableBreakGlassGrant> {
    const grant = this.activation?.grant;
    if (!grant || grant.grantId !== grantId) throw new DomainError("NOT_FOUND", "grant not found", 404);
    if (Date.parse(grant.expiresAt) <= atMs) throw new DomainError("INVALID_STATE", "grant expired", 409);
    if (grant.status !== "ACTIVE") throw new DomainError("INVALID_STATE", "grant inactive", 409);
    return grant;
  }
}

test("break-glass activation verifies one-shot WebAuthn, scope, TTL and atomic audit input", async () => {
  const persistence = new InMemoryBreakGlassPersistence();
  const authority = new OneShotWebAuthn();
  const scopeAuthority = new AllowScope();
  const service = new BreakGlassApplicationService(persistence, authority, scopeAuthority);
  const now = Date.now();

  const result = await service.activate(input({}, now), now);

  assert.equal(result.grant.status, "ACTIVE");
  assert.equal(result.scope.type, "WORKSPACE");
  assert.equal(result.target, "patient:00000000-0000-4000-8000-000000000099");
  assert.equal(result.grant.scope, "WORKSPACE");
  assert.match(result.grant.target, /"scope":"WORKSPACE"/);
  assert.equal(result.audit.action, "security.break_glass.activate");
  assert.equal(result.audit.result, "ALLOWED");
  assert.equal(result.audit.metadata.scope, "WORKSPACE");
  assert.equal(result.audit.metadata.scopeWorkspaceId, workspaceId);
  assert.equal(result.audit.metadata.approverId, approverId);
  assert.equal(authority.calls, 1);
  assert.equal(scopeAuthority.calls, 1);
  assert.equal(persistence.calls, 1);

  const active = await service.assertActive({ context: contextFor("security.break_glass.assert", "break-glass-assert-correlation"), organizationId, actorId, grantId: result.grant.grantId, target: result.target, scope, atMs: now });
  assert.equal(active.grantId, result.grant.grantId);
  assert.equal(active.target, result.target);
});

test("break-glass rejects self approval before WebAuthn or persistence", async () => {
  const persistence = new InMemoryBreakGlassPersistence();
  const authority = new OneShotWebAuthn();
  const service = new BreakGlassApplicationService(persistence, authority, new AllowScope());

  await assert.rejects(() => service.activate(input({ approverId: actorId })), (error: unknown) => error instanceof DomainError && error.code === "POLICY_DENIED");
  assert.equal(authority.calls, 0);
  assert.equal(persistence.calls, 0);
});

test("break-glass remains disabled without a real WebAuthn, scope or persistence authority", async () => {
  const authority = new OneShotWebAuthn();
  const scopeAuthority = new AllowScope();
  const persistence = new InMemoryBreakGlassPersistence();

  await assert.rejects(() => new BreakGlassApplicationService(persistence, null, scopeAuthority).activate(input()), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
  await assert.rejects(() => new BreakGlassApplicationService(persistence, authority, null).activate(input()), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
  await assert.rejects(() => new BreakGlassApplicationService(null, authority, scopeAuthority).activate(input()), (error: unknown) => error instanceof DomainError && error.code === "CAPABILITY_DISABLED");
  assert.equal(persistence.calls, 0);
});

test("break-glass denies wrong scope, wrong target, expiry and assertion reuse", async () => {
  const persistence = new InMemoryBreakGlassPersistence();
  const authority = new OneShotWebAuthn();
  const service = new BreakGlassApplicationService(persistence, authority, new AllowScope());
  const now = Date.now();
  const result = await service.activate(input({}, now), now);

  await assert.rejects(() => service.assertActive({ context: contextFor("security.break_glass.assert", "break-glass-assert-correlation"), organizationId, actorId, grantId: result.grant.grantId, target: "patient:wrong", scope }), (error: unknown) => error instanceof DomainError && error.code === "POLICY_DENIED");
  await assert.rejects(() => service.assertActive({ context: contextFor("security.break_glass.assert", "break-glass-assert-correlation"), organizationId, actorId, grantId: result.grant.grantId, target: result.target, scope: { type: "UNIT", unitId, workspaceId: null } }), (error: unknown) => error instanceof DomainError && error.code === "POLICY_DENIED");
  await assert.rejects(() => service.assertActive({ context: contextFor("security.break_glass.assert", "break-glass-assert-correlation"), organizationId, actorId, grantId: result.grant.grantId, target: result.target, scope, atMs: now + 11 * 60_000 }), (error: unknown) => error instanceof DomainError && error.code === "INVALID_STATE");
  await assert.rejects(() => service.activate(input({}, now), now), (error: unknown) => error instanceof DomainError && error.code === "POLICY_DENIED");
  assert.equal(authority.calls, 2);
  assert.equal(persistence.calls, 1);
});

test("the provider adapter blocks when either WebAuthn authority half is absent", async () => {
  const adapter = new WebAuthnProviderBreakGlassAuthority(null, null);
  await assert.rejects(() => adapter.verifyAndConsume({ challenge: input().challenge, assertion: input().assertion }), (error: unknown) => error instanceof BreakGlassAuthorityUnavailableError);
});

test("break-glass requires the registered purpose and context binding", async () => {
  const persistence = new InMemoryBreakGlassPersistence();
  const service = new BreakGlassApplicationService(persistence, new OneShotWebAuthn(), new AllowScope());

  await assert.rejects(
    () => service.activate(input({ context: contextFor("security.break_glass.assert", "break-glass-test-correlation") })),
    (error: unknown) => error instanceof DomainError && error.code === "POLICY_DENIED"
  );
  await assert.rejects(
    () => service.activate(input({ context: { ...contextFor("security.break_glass.activate", "break-glass-test-correlation"), actorId: approverId } })),
    (error: unknown) => error instanceof DomainError && error.code === "POLICY_DENIED"
  );
  assert.equal(persistence.calls, 0);
});
