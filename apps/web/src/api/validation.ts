/**
 * Semantic payload validation for the first-journey endpoints.
 *
 * The HTTP envelope is checked in `client.ts`; this registry closes the gap
 * where a valid envelope carried a payload that did not match the resource
 * contract (audit H02/H03). Registered paths are fail-closed: an incompatible
 * payload never reaches component state. Unregistered paths keep the previous
 * pass-through behavior so endpoints still migrating to ADR030 are explicit
 * and do not silently gain or lose validation.
 */
import {
  contextOptionSchema,
  financeChargesResponseSchema,
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  type ContextOptionPayload,
  type FinanceChargesResponse,
  type LoginResponsePayload,
  type LogoutResponse,
  type MeResponsePayload
} from "@cvg/contracts";
import { z } from "zod";

type ParseResult<T> = { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
type PayloadSchema<T> = { safeParse(value: unknown): ParseResult<T> };

export type PayloadValidation =
  | { status: "validated"; data: unknown }
  | { status: "passthrough"; data: unknown }
  | { status: "invalid"; issues: string };

const registry = new Map<string, PayloadSchema<unknown>>([
  ["POST /auth/login", loginResponseSchema as unknown as PayloadSchema<unknown>],
  ["POST /auth/demo", loginResponseSchema as unknown as PayloadSchema<unknown>],
  ["POST /auth/mfa/verify", loginResponseSchema as unknown as PayloadSchema<unknown>],
  ["GET /me", meResponseSchema as unknown as PayloadSchema<unknown>],
  ["GET /contexts", { safeParse: (value) => parseArray(contextOptionSchema, value) }],
  ["POST /auth/logout", logoutResponseSchema as unknown as PayloadSchema<unknown>],
  ["GET /finance/charges", financeChargesResponseSchema as unknown as PayloadSchema<unknown>],
  ["GET /operations/reports", z.object({
    kind: z.enum(["operation", "quality", "cost", "audit", "incidents"]),
    source: z.object({
      boundary: z.literal("ReadApplicationService"),
      storageMode: z.enum(["memory", "postgres"]),
      organizationId: z.string().min(1),
      unitId: z.string().nullable(),
      workspaceId: z.string().nullable(),
      generatedAt: z.string().datetime({ offset: true }),
      filters: z.object({ kind: z.string(), from: z.string().datetime({ offset: true }).nullable(), to: z.string().datetime({ offset: true }).nullable(), limit: z.number().int().min(1).max(100) }).strict(),
      bounded: z.literal(true)
    }).strict(),
    report: z.record(z.string(), z.unknown())
  }).strict() as unknown as PayloadSchema<unknown>]
]);

function parseArray<T>(schema: PayloadSchema<T>, value: unknown): ParseResult<unknown> {
  if (!Array.isArray(value)) return { success: false, error: { issues: [{ path: [], message: "expected an array" }] } };
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = schema.safeParse(value[index]);
    if (!parsed.success) return { success: false, error: { issues: parsed.error.issues.map((issue) => ({ path: [index, ...issue.path], message: issue.message })) } };
    items.push(parsed.data);
  }
  return { success: true, data: items };
}

export function validatePayload(method: string, path: string, value: unknown): PayloadValidation {
  const schema = registry.get(`${method.toUpperCase()} ${path.split("?", 1)[0]}`);
  if (!schema) return { status: "passthrough", data: value };
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`).join("; ");
    return { status: "invalid", issues };
  }
  return { status: "validated", data: parsed.data };
}

export type { ContextOptionPayload, FinanceChargesResponse, LoginResponsePayload, MeResponsePayload };
