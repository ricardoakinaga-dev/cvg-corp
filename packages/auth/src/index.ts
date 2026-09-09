import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  rejectIdentifier: boolean;
}

export interface PasswordPolicyContext {
  identifier?: string;
}

export const DEFAULT_PASSWORD_POLICY: Readonly<PasswordPolicy> = Object.freeze({
  minLength: 12,
  maxLength: 256,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
  rejectIdentifier: true
});

export function passwordPolicyIssues(password: string, policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY, context: PasswordPolicyContext = {}): string[] {
  const issues: string[] = [];
  if (password.length < policy.minLength) issues.push(`password must contain at least ${policy.minLength} characters`);
  if (password.length > policy.maxLength) issues.push(`password must contain at most ${policy.maxLength} characters`);
  if (policy.requireUppercase && !/[A-Z]/.test(password)) issues.push("password must contain an uppercase letter");
  if (policy.requireLowercase && !/[a-z]/.test(password)) issues.push("password must contain a lowercase letter");
  if (policy.requireNumber && !/[0-9]/.test(password)) issues.push("password must contain a number");
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push("password must contain a symbol");
  const identifier = context.identifier?.trim().toLowerCase();
  if (policy.rejectIdentifier && identifier && identifier.length >= 3 && password.toLowerCase().includes(identifier)) issues.push("password must not contain the account identifier");
  return issues;
}

export function isPasswordCompliant(password: string, policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY, context: PasswordPolicyContext = {}): boolean {
  return passwordPolicyIssues(password, policy, context).length === 0;
}

export function generateOpaqueToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 24 || bytes > 96) throw new Error("opaque token size is outside the safe range");
  return randomBytes(bytes).toString("base64url");
}

export function digestRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function generateRecoveryCodes(count = 8): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("recovery code count is outside the safe range");
  return Array.from({ length: count }, () => {
    const value = randomBytes(10).toString("hex").toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
  });
}

function decodeBase32(value: string): Buffer | null {
  const normalized = value.trim().toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) return null;
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    if (code < 0) return null;
    buffer = (buffer << 5) | code;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totpAt(secret: Buffer, counter: number): Buffer {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return Buffer.from(String(binary % 1_000_000).padStart(6, "0"));
}

export function verifyTotpCode(secretText: string, code: string, atMs = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code.trim()) || !Number.isInteger(window) || window < 0 || window > 2) return false;
  const secret = decodeBase32(secretText);
  if (!secret || secret.length < 10) return false;
  const counter = Math.floor(atMs / 30_000);
  const expected = Buffer.from(code.trim());
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateCounter = counter + offset;
    if (candidateCounter < 0) continue;
    const candidate = totpAt(secret, candidateCounter);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

export interface MfaSecretResolver {
  resolve(secretRef: string): Promise<string | null> | string | null;
}

/**
 * Provider-neutral phishing-resistant MFA seam. The CVG auth boundary owns
 * challenge lifecycle and policy; a WebAuthn implementation owns the
 * authenticator cryptography and credential store.
 */
export type MfaMethod = "TOTP" | "WEBAUTHN" | "RECOVERY_CODE";

export interface WebAuthnChallenge {
  challengeId: string;
  userId: string;
  challenge: string;
  rpId: string;
  origin: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  status: "PENDING" | "CONSUMED" | "EXPIRED" | "LOCKED";
}

export interface WebAuthnAssertionEnvelope {
  challengeId: string;
  credentialId: string;
  clientDataJson: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
  userVerified: boolean;
}

export interface WebAuthnProvider {
  begin(input: { userId: string; rpId: string; origin: string }): Promise<WebAuthnChallenge>;
  verify(input: { challenge: WebAuthnChallenge; assertion: WebAuthnAssertionEnvelope }): Promise<{ userId: string; credentialId: string; signCount: number }>;
}

function encodedField(value: string, field: string, minLength: number, maxLength: number): void {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${field} must be a bounded base64url value`);
}

/** Shape and state validation before delegating cryptographic verification. */
export function validateWebAuthnAssertion(challenge: WebAuthnChallenge, assertion: WebAuthnAssertionEnvelope, atMs = Date.now()): void {
  if (challenge.status !== "PENDING") throw new Error("WebAuthn challenge is not pending");
  if (Date.parse(challenge.expiresAt) <= atMs) throw new Error("WebAuthn challenge expired");
  if (!Number.isInteger(challenge.attempts) || !Number.isInteger(challenge.maxAttempts) || challenge.attempts >= challenge.maxAttempts) throw new Error("WebAuthn challenge attempt budget exhausted");
  if (assertion.challengeId !== challenge.challengeId || !assertion.userVerified) throw new Error("WebAuthn assertion is not bound to the pending challenge");
  encodedField(assertion.credentialId, "credentialId", 8, 512);
  encodedField(assertion.clientDataJson, "clientDataJson", 8, 16_384);
  encodedField(assertion.authenticatorData, "authenticatorData", 8, 16_384);
  encodedField(assertion.signature, "signature", 8, 16_384);
  if (assertion.userHandle !== null) encodedField(assertion.userHandle, "userHandle", 1, 512);
}

export interface BreakGlassRequest {
  actorId: string;
  approverId: string | null;
  reason: string;
  target: string;
  mfaMethod: MfaMethod;
  issuedAt: string;
  expiresAt: string;
}

export type BreakGlassDecision = { status: "ALLOW" | "DENY"; reason: "approved" | "missing_independent_approval" | "weak_mfa" | "invalid_window" | "missing_reason_or_target" };

/**
 * Pure fail-closed policy for an emergency lane. Activation, audit and
 * revocation remain owned by the application/persistence boundary.
 */
export function evaluateBreakGlass(request: BreakGlassRequest, atMs = Date.now(), maxWindowMs = 15 * 60_000): BreakGlassDecision {
  if (!request.reason.trim() || !request.target.trim()) return { status: "DENY", reason: "missing_reason_or_target" };
  if (!request.approverId || request.approverId === request.actorId) return { status: "DENY", reason: "missing_independent_approval" };
  if (request.mfaMethod !== "WEBAUTHN") return { status: "DENY", reason: "weak_mfa" };
  const issuedAt = Date.parse(request.issuedAt);
  const expiresAt = Date.parse(request.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > atMs || expiresAt <= atMs || expiresAt - issuedAt > maxWindowMs) return { status: "DENY", reason: "invalid_window" };
  return { status: "ALLOW", reason: "approved" };
}

export type BreakGlassGrantStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "REVIEWED";

export interface BreakGlassGrant extends BreakGlassRequest {
  grantId: string;
  organizationId: string;
  status: BreakGlassGrantStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  revokedAt: string | null;
}

export class BreakGlassError extends Error {
  readonly code: "DENIED" | "NOT_FOUND" | "INVALID_STATE";

  constructor(code: BreakGlassError["code"], message: string) {
    super(message);
    this.name = "BreakGlassError";
    this.code = code;
  }
}

/**
 * Provider-neutral emergency-access lifecycle. It owns no authorization or
 * persistence authority; callers must persist the grant and its audit trail.
 * Expiry is lazy and deterministic so a request can never use an expired grant.
 */
export class BreakGlassRegistry {
  private readonly grants = new Map<string, BreakGlassGrant>();

  activate(organizationId: string, request: BreakGlassRequest, atMs = Date.now()): BreakGlassGrant {
    const decision = evaluateBreakGlass(request, atMs);
    if (decision.status !== "ALLOW") throw new BreakGlassError("DENIED", `Break-glass activation denied: ${decision.reason}`);
    const grant: BreakGlassGrant = {
      ...request,
      grantId: generateOpaqueToken(24),
      organizationId,
      status: "ACTIVE",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      revokedAt: null
    };
    this.grants.set(grant.grantId, grant);
    return { ...grant };
  }

  get(grantId: string, atMs = Date.now()): BreakGlassGrant | null {
    const grant = this.grants.get(grantId);
    if (!grant) return null;
    if (grant.status === "ACTIVE" && Date.parse(grant.expiresAt) <= atMs) grant.status = "EXPIRED";
    return { ...grant };
  }

  assertActive(grantId: string, atMs = Date.now()): BreakGlassGrant {
    const grant = this.get(grantId, atMs);
    if (!grant) throw new BreakGlassError("NOT_FOUND", "Break-glass grant not found.");
    if (grant.status !== "ACTIVE") throw new BreakGlassError("INVALID_STATE", "Break-glass grant is no longer active.");
    return grant;
  }

  revoke(grantId: string, atMs = Date.now()): BreakGlassGrant {
    const grant = this.get(grantId, atMs);
    if (!grant) throw new BreakGlassError("NOT_FOUND", "Break-glass grant not found.");
    if (grant.status !== "ACTIVE") throw new BreakGlassError("INVALID_STATE", "Only an active break-glass grant can be revoked.");
    const stored = this.grants.get(grantId)!;
    stored.status = "REVOKED";
    stored.revokedAt = new Date(atMs).toISOString();
    return { ...stored };
  }

  review(grantId: string, reviewerId: string, note: string, atMs = Date.now()): BreakGlassGrant {
    const grant = this.get(grantId, atMs);
    if (!grant) throw new BreakGlassError("NOT_FOUND", "Break-glass grant not found.");
    if (grant.status === "ACTIVE") throw new BreakGlassError("INVALID_STATE", "An active break-glass grant cannot be reviewed yet.");
    if (!reviewerId || reviewerId === grant.actorId || note.trim().length < 10 || note.length > 2_000) throw new BreakGlassError("DENIED", "Break-glass review requires an independent reviewer and a bounded note.");
    const stored = this.grants.get(grantId)!;
    stored.status = "REVIEWED";
    stored.reviewedBy = reviewerId;
    stored.reviewedAt = new Date(atMs).toISOString();
    stored.reviewNote = note.trim();
    return { ...stored };
  }

  list(atMs = Date.now()): BreakGlassGrant[] {
    return [...this.grants.keys()].map((grantId) => this.get(grantId, atMs)).filter((grant): grant is BreakGlassGrant => grant !== null);
  }
}
