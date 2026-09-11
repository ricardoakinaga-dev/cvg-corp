import {
  validateWebAuthnAssertion,
  type WebAuthnAssertionEnvelope,
  type WebAuthnChallenge,
  type WebAuthnProvider
} from "@cvg/auth";
import { enforceApplicationPolicy } from "@cvg/agent-policy";
import type { AuditRecord, CvgContext, OpaqueId, ScopeType } from "@cvg/contracts";
import { id, scopeTypes } from "@cvg/contracts";
import { digest, DomainError } from "@cvg/domain";
import type {
  DurableBreakGlassActivationRecord,
  DurableBreakGlassAuditInput,
  DurableBreakGlassGrant,
  DurableBreakGlassInput
} from "@cvg/persistence";
import { randomUUID } from "node:crypto";

export interface BreakGlassScope {
  type: ScopeType;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
}

export interface BreakGlassActivationInput {
  context: CvgContext;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  approverId: OpaqueId | null;
  reason: string;
  target: string;
  scope: BreakGlassScope;
  issuedAt: string;
  expiresAt: string;
  correlationId: string;
  challenge: WebAuthnChallenge;
  assertion: WebAuthnAssertionEnvelope;
}

export interface BreakGlassGrantAccessInput {
  context: CvgContext;
  organizationId: OpaqueId;
  actorId: OpaqueId;
  grantId: OpaqueId;
  target: string;
  scope: BreakGlassScope;
  atMs?: number;
}

export interface BreakGlassVerifiedAssertion {
  userId: string;
  credentialId: string;
  signCount: number;
}

/**
 * This is deliberately stronger than the generic WebAuthn provider port:
 * verification must consume the challenge before a durable grant is admitted.
 * A production adapter must implement this against the real challenge store.
 */
export interface BreakGlassWebAuthnAuthority {
  verifyAndConsume(input: { challenge: WebAuthnChallenge; assertion: WebAuthnAssertionEnvelope }): Promise<BreakGlassVerifiedAssertion>;
}

export class BreakGlassAuthorityUnavailableError extends Error {
  constructor(message = "break-glass authority is unavailable") {
    super(message);
    this.name = "BreakGlassAuthorityUnavailableError";
  }
}

/** Adapter for an external WebAuthn provider plus its one-shot challenge store. */
export class WebAuthnProviderBreakGlassAuthority implements BreakGlassWebAuthnAuthority {
  constructor(
    private readonly provider: WebAuthnProvider | null,
    private readonly consumeChallenge: ((challengeId: string) => Promise<void>) | null
  ) {}

  async verifyAndConsume(input: { challenge: WebAuthnChallenge; assertion: WebAuthnAssertionEnvelope }): Promise<BreakGlassVerifiedAssertion> {
    if (!this.provider || !this.consumeChallenge) throw new BreakGlassAuthorityUnavailableError();
    const verified = await this.provider.verify(input);
    if (verified.userId !== input.challenge.userId || verified.credentialId !== input.assertion.credentialId || !Number.isSafeInteger(verified.signCount) || verified.signCount < 0) {
      throw new Error("WebAuthn authority returned an invalid verified identity");
    }
    // Consume before durable admission. If persistence later fails, the safe
    // outcome is a blocked request that cannot be replayed into a grant.
    await this.consumeChallenge(input.challenge.challengeId);
    return verified;
  }
}

export interface BreakGlassScopeAuthority {
  assertTargetAllowed(input: {
    organizationId: OpaqueId;
    actorId: OpaqueId;
    scope: BreakGlassScope;
    target: string;
  }): Promise<void>;
}

export interface BreakGlassPersistencePort {
  createBreakGlassGrantWithAudit(input: DurableBreakGlassInput, auditInput: DurableBreakGlassAuditInput): Promise<DurableBreakGlassActivationRecord>;
  assertActiveBreakGlassGrant(organizationId: OpaqueId, grantId: OpaqueId, atMs?: number): Promise<DurableBreakGlassGrant>;
}

export interface BreakGlassActivationResult extends DurableBreakGlassActivationRecord {
  scope: BreakGlassScope;
  target: string;
}

export interface BreakGlassGrantAccess extends DurableBreakGlassGrant {
  scopeBinding: BreakGlassScope;
  target: string;
}

function deny(message: string): never {
  throw new DomainError("POLICY_DENIED", message, 403);
}

function capabilityUnavailable(message: string): never {
  throw new DomainError("CAPABILITY_DISABLED", message, 503);
}

function validateScope(scope: BreakGlassScope): void {
  if (!scopeTypes.includes(scope.type)) throw new DomainError("INVALID_INPUT", "O escopo de break-glass é inválido.", 400);
  if (scope.type === "ORGANIZATION" && (scope.unitId !== null || scope.workspaceId !== null)) throw new DomainError("INVALID_INPUT", "O escopo organizacional não pode conter unidade ou workspace.", 400);
  if (scope.type === "UNIT" && (!scope.unitId || scope.workspaceId !== null)) throw new DomainError("INVALID_INPUT", "O escopo de unidade exige somente uma unidade.", 400);
  if (scope.type === "WORKSPACE" && (!scope.unitId || !scope.workspaceId)) throw new DomainError("INVALID_INPUT", "O escopo de workspace exige unidade e workspace.", 400);
}

function normalizeTarget(target: string): string {
  const normalized = target.trim();
  if (!normalized || normalized.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(normalized)) throw new DomainError("INVALID_INPUT", "O alvo de break-glass é inválido.", 400);
  return normalized;
}

function durableTarget(scope: BreakGlassScope, target: string): string {
  return JSON.stringify({ schemaVersion: 1, scope: scope.type, unitId: scope.unitId, workspaceId: scope.workspaceId, target });
}

function validateRequest(input: BreakGlassActivationInput, atMs: number): string {
  if (!input.organizationId || !input.actorId || !input.correlationId.trim() || input.correlationId.length > 200) throw new DomainError("INVALID_INPUT", "A invocação de break-glass não tem identidade ou correlação válidas.", 400);
  if (!input.approverId || input.approverId === input.actorId) deny("Break-glass exige um aprovador independente.");
  if (input.challenge.userId !== input.approverId) deny("O desafio WebAuthn não pertence ao aprovador informado.");
  if (input.reason.trim().length < 10 || input.reason.length > 2_000) throw new DomainError("INVALID_INPUT", "O motivo de break-glass deve ser explícito e limitado.", 400);
  validateScope(input.scope);
  const target = normalizeTarget(input.target);
  validateWebAuthnAssertion(input.challenge, input.assertion, atMs);
  const issuedAt = Date.parse(input.issuedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > atMs || expiresAt <= atMs || expiresAt - issuedAt > 15 * 60_000) throw new DomainError("INVALID_INPUT", "A janela de break-glass é inválida ou excede o TTL permitido.", 400);
  return target;
}

function activationAudit(input: BreakGlassActivationInput, target: string, grantId: OpaqueId, verified: BreakGlassVerifiedAssertion): DurableBreakGlassAuditInput {
  const metadata: AuditRecord["metadata"] = {
    grantId,
    scope: input.scope.type,
    scopeUnitId: input.scope.unitId,
    scopeWorkspaceId: input.scope.workspaceId,
    targetDigest: digest(target),
    reasonDigest: digest(input.reason.trim()),
    approverId: input.approverId,
    credentialIdDigest: digest(verified.credentialId),
    challengeIdDigest: digest(input.challenge.challengeId),
    signCount: verified.signCount,
    expiresAt: input.expiresAt,
    mfaMethod: "WEBAUTHN"
  };
  return {
    organizationId: input.organizationId,
    actorId: input.actorId,
    unitId: input.scope.unitId,
    workspaceId: input.scope.workspaceId,
    action: "security.break_glass.activate",
    resourceType: "BreakGlassGrant",
    resourceId: grantId,
    result: "ALLOWED",
    reason: "independent WebAuthn approval verified",
    correlationId: input.correlationId,
    metadata
  };
}

/**
 * Application boundary for emergency access. It never manufactures an
 * approval, scope decision, persistence adapter or audit record. Missing real
 * authorities leave the capability disabled.
 */
export class BreakGlassApplicationService {
  constructor(
    private readonly persistence: BreakGlassPersistencePort | null,
    private readonly webAuthn: BreakGlassWebAuthnAuthority | null,
    private readonly scopeAuthority: BreakGlassScopeAuthority | null
  ) {}

  async activate(input: BreakGlassActivationInput, atMs?: number): Promise<BreakGlassActivationResult> {
    enforceApplicationPolicy(input.context, "security.break_glass.activate", { resourceUnitId: input.scope.unitId, resourceWorkspaceId: input.scope.workspaceId });
    if (input.context.purpose !== "security.break_glass.activate" || input.context.organizationId !== input.organizationId || input.context.actorId !== input.actorId || input.context.correlationId !== input.correlationId) deny("O contexto de break-glass não corresponde à operação, ator ou correlação solicitados.");
    const effectiveAtMs = atMs ?? Date.now();
    const target = validateRequest(input, effectiveAtMs);
    if (!this.persistence || !this.webAuthn || !this.scopeAuthority) capabilityUnavailable("Break-glass exige autoridade WebAuthn, escopo e persistência aprovadas.");
    try {
      await this.scopeAuthority.assertTargetAllowed({ organizationId: input.organizationId, actorId: input.actorId, scope: input.scope, target });
    } catch (error) {
      if (error instanceof BreakGlassAuthorityUnavailableError) capabilityUnavailable("A autoridade de escopo de break-glass está indisponível.");
      deny("O alvo de break-glass não pertence ao escopo autorizado.");
    }
    let verified: BreakGlassVerifiedAssertion;
    try {
      verified = await this.webAuthn.verifyAndConsume({ challenge: input.challenge, assertion: input.assertion });
    } catch (error) {
      if (error instanceof BreakGlassAuthorityUnavailableError) capabilityUnavailable("A autoridade WebAuthn de break-glass está indisponível.");
      deny("A assertion WebAuthn não foi verificada ou já foi consumida.");
    }
    if (verified.userId !== input.approverId || verified.credentialId !== input.assertion.credentialId) deny("A assertion verificada não pertence ao aprovador independente.");
    const grantId = id(randomUUID());
    const durableInput: DurableBreakGlassInput = {
      grantId,
      organizationId: input.organizationId,
      actorId: input.actorId,
      approverId: input.approverId,
      reason: input.reason.trim(),
      target: durableTarget(input.scope, target),
      scope: input.scope.type,
      mfaMethod: "WEBAUTHN",
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt
    };
    const persisted = await this.persistence.createBreakGlassGrantWithAudit(durableInput, activationAudit(input, target, grantId, verified));
    return { ...persisted, scope: input.scope, target };
  }

  async assertActive(input: BreakGlassGrantAccessInput): Promise<BreakGlassGrantAccess> {
    enforceApplicationPolicy(input.context, "security.break_glass.assert", { resourceUnitId: input.scope.unitId, resourceWorkspaceId: input.scope.workspaceId });
    if (input.context.purpose !== "security.break_glass.assert" || input.context.organizationId !== input.organizationId || input.context.actorId !== input.actorId) deny("O contexto de break-glass não corresponde à operação, ator ou organização solicitados.");
    validateScope(input.scope);
    const target = normalizeTarget(input.target);
    if (!this.persistence || !this.scopeAuthority) capabilityUnavailable("Break-glass exige autoridade de escopo e persistência aprovadas.");
    try {
      await this.scopeAuthority.assertTargetAllowed({ organizationId: input.organizationId, actorId: input.actorId, scope: input.scope, target });
    } catch (error) {
      if (error instanceof BreakGlassAuthorityUnavailableError) capabilityUnavailable("A autoridade de escopo de break-glass está indisponível.");
      deny("O alvo de break-glass não pertence ao escopo autorizado.");
    }
    const grant = await this.persistence.assertActiveBreakGlassGrant(input.organizationId, input.grantId, input.atMs);
    if (grant.actorId !== input.actorId || grant.scope !== input.scope.type || grant.target !== durableTarget(input.scope, target)) deny("O grant de break-glass não corresponde ao ator, escopo ou alvo solicitado.");
    return { ...grant, scopeBinding: input.scope, target };
  }
}
