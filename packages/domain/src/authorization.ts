import type { Role } from "@cvg/contracts";

/**
 * Server-side capability policy for the local CVG application.
 *
 * The API and the UI may expose a narrower view, but neither is allowed to
 * widen this matrix. Keeping the matrix in one module makes a capability
 * auditable and gives the domain one default-deny decision point.
 */
export const CAPABILITY_ROLES = Object.freeze({
  "users:read": ["admin"],
  "audit:read": ["admin"],
  "communication:read": ["admin", "recepcao", "veterinario"],
  "knowledge:read": ["admin", "veterinario", "recepcao"],
  "role:grant": ["admin"],
  "role:revoke": ["admin"],
  "guardians:read": ["admin", "veterinario", "recepcao"],
  "guardians:create": ["admin", "recepcao"],
  "patients:read": ["admin", "veterinario", "recepcao", "financeiro", "estoque"],
  "patients:create": ["admin", "recepcao", "veterinario"],
  "patients:disable": ["admin", "recepcao", "veterinario"],
  "patients:merge": ["admin", "veterinario"],
  "appointments:create": ["admin", "recepcao", "veterinario"],
  "appointments:read": ["admin", "recepcao", "veterinario", "estoque", "financeiro"],
  "queue:read": ["admin", "recepcao", "veterinario"],
  "encounters:create": ["admin", "veterinario"],
  "queue:check-in": ["admin", "recepcao", "veterinario"],
  "encounters:read": ["admin", "veterinario"],
  "clinical:read": ["admin", "veterinario"],
  "clinical:write": ["admin", "veterinario"],
  "clinical:draft": ["admin", "veterinario"],
  "clinical:sign": ["veterinario"],
  "clinical:addendum": ["veterinario"],
  "diagnostics:read": ["admin", "veterinario"],
  "diagnostics:create": ["veterinario"],
  "diagnostics:specimen": ["veterinario"],
  "diagnostics:result": ["veterinario"],
  "stock:read": ["admin", "estoque", "veterinario"],
  "stock:write": ["admin", "estoque"],
  "hospitalization:beds-read": ["admin", "veterinario"],
  "hospitalization:read": ["admin", "veterinario"],
  "hospitalization:create": ["veterinario"],
  "medication:read": ["admin", "veterinario", "estoque"],
  "medication:prescribe": ["veterinario"],
  "medication:dispense": ["admin", "estoque"],
  "medication:administer": ["veterinario"],
  "finance:read": ["admin", "financeiro"],
  "finance:charge": ["admin", "financeiro"],
  "finance:payment": ["admin", "financeiro"],
  "finance:refund": ["admin", "financeiro"],
  "knowledge:write": ["admin", "veterinario"],
  "communication:stage": ["admin", "recepcao", "veterinario"],
  "communication:approve": ["admin", "veterinario"],
  "ai:session": ["admin", "veterinario", "recepcao"],
  "ai:approval": ["admin", "veterinario", "recepcao", "estoque", "financeiro"],
  "ai:replay": ["admin", "veterinario", "recepcao"],
  "ai:health": ["admin", "veterinario", "recepcao"],
  "ai:sessions:read": ["admin", "veterinario", "recepcao"],
  "metrics:read": ["admin", "operador"],
  "ops:snapshot": ["admin"],
  "ops:export": ["admin"],
  "ops:restore": ["admin"]
} as const satisfies Record<string, readonly Role[]>);

/** Roles that organization administrators may grant through the M1 surface. */
export const GRANTABLE_ROLES = Object.freeze(["recepcao", "veterinario"] as const);

export function isGrantableRole(role: Role): boolean {
  return (GRANTABLE_ROLES as readonly Role[]).includes(role);
}

export type Capability = keyof typeof CAPABILITY_ROLES;

function normalizedRoles(roles: readonly Role[]): string[] {
  return [...new Set(roles)].sort();
}

export function sameRoleSet(left: readonly Role[], right: readonly Role[]): boolean {
  const a = normalizedRoles(left);
  const b = normalizedRoles(right);
  return a.length === b.length && a.every((role, index) => role === b[index]);
}

function isRoleSubset(subset: readonly Role[], superset: readonly Role[]): boolean {
  return subset.every((role) => superset.includes(role));
}

export type CapabilityDecision =
  | { allowed: true; roles: readonly Role[] }
  | { allowed: false; reason: "UNKNOWN_CAPABILITY" | "POLICY_CONFIGURATION_MISMATCH" | "ROLE_NOT_ALLOWED" };

/**
 * Evaluates the capability policy without knowing persistence details. The
 * caller must still validate tenant, scope, policy revision and actor binding
 * before using this result.
 */
export function evaluateCapability(capability: string, actorRoles: readonly Role[], declaredRoles: readonly Role[]): CapabilityDecision {
  const policy: readonly Role[] | undefined = CAPABILITY_ROLES[capability as Capability];
  if (!policy) return { allowed: false, reason: "UNKNOWN_CAPABILITY" };
  if (!isRoleSubset(declaredRoles, policy)) return { allowed: false, reason: "POLICY_CONFIGURATION_MISMATCH" };
  if (!actorRoles.some((role) => declaredRoles.includes(role))) return { allowed: false, reason: "ROLE_NOT_ALLOWED" };
  return { allowed: true, roles: policy };
}
