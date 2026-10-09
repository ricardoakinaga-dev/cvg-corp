import type { PoolClient } from "pg";
import type { StoreSnapshot } from "@cvg/domain";

/**
 * Projects the identity and authorization boundary before contextual domain
 * rows. Keeping this seam independent prevents the durable transaction owner
 * from accumulating unrelated identity DML while preserving ordering.
 */
export async function projectIdentity(client: PoolClient, snapshot: StoreSnapshot): Promise<void> {
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
      "select set_config('cvg.unit_id', $1, true), set_config('cvg.workspace_id', $2, true)",
      [assignment.unitId ?? "", assignment.workspaceId ?? ""]
    );
    await client.query(
      "insert into role_assignments(id, organization_id, user_id, role, scope_type, unit_id, workspace_id, granted_at, revoked_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, user_id = excluded.user_id, role = excluded.role, scope_type = excluded.scope_type, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, granted_at = excluded.granted_at, revoked_at = excluded.revoked_at",
      [assignment.id, assignment.organizationId, assignment.userId, assignment.role, assignment.scopeType, assignment.unitId, assignment.workspaceId, assignment.grantedAt, assignment.revokedAt]
    );
  }
  await client.query("select set_config('cvg.unit_id', '', true), set_config('cvg.workspace_id', '', true)");
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
