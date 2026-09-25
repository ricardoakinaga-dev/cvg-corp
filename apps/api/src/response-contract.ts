import {
  API_RESPONSE_SCHEMA_CATALOG,
  API_ROUTE_CATALOG,
  apiErrorEnvelopeSchema,
  apiPartialEnvelopeSchema,
  apiSuccessEnvelopeSchema,
  type ApiResponseSchemaCoverage,
  type ApiResponseSchemaLegacyStatus,
  type ApiRouteDescriptor
} from "@cvg/contracts";
import { runtimeRouteCatalog, type RuntimeRouteDescriptor } from "./route-catalog.ts";
import { API_PAYLOAD_RESPONSE_SCHEMAS } from "./response-schemas/index.ts";

export const MAX_API_JSON_RESPONSE_BYTES = 512 * 1024;
export const MAX_API_TEXT_RESPONSE_BYTES = 128 * 1024;

export type ApiResponseContractStrength = "PAYLOAD_SCHEMA" | "ENVELOPE_BOUNDED";
export type ApiResponseContractCoverage = ApiResponseSchemaCoverage;
export type ApiResponseContractLegacyStatus = ApiResponseSchemaLegacyStatus;

export interface ApiResponseContractDescriptor {
  readonly method: string;
  readonly path: string;
  readonly responseSchema: string;
  readonly strength: ApiResponseContractStrength;
  readonly coverage: ApiResponseContractCoverage;
  readonly legacyStatus: ApiResponseContractLegacyStatus;
  readonly owner: string;
  readonly version: string;
  readonly consumers: readonly string[];
  readonly domain: string;
}

export class ApiResponseContractError extends Error {
  constructor(readonly responseSchema: string | null, readonly reason: string) {
    super("API response did not satisfy its egress contract");
    this.name = "ApiResponseContractError";
  }
}

const payloadSchemas = API_PAYLOAD_RESPONSE_SCHEMAS;

const responseSchemaMetadata = new Map(API_RESPONSE_SCHEMA_CATALOG.map((schema) => [schema.name, schema]));

function responseContractDescriptor(responseSchema: string): Omit<ApiResponseContractDescriptor, "method" | "path"> {
  const metadata = responseSchemaMetadata.get(responseSchema);
  if (!metadata) throw new ApiResponseContractError(responseSchema, "response schema is not registered in the nominal catalog");
  const payloadSchema = payloadSchemas.get(responseSchema);
  return {
    responseSchema,
    strength: payloadSchema ? "PAYLOAD_SCHEMA" : "ENVELOPE_BOUNDED",
    coverage: payloadSchema ? "PAYLOAD_AND_ENVELOPE" : "ENVELOPE_ONLY",
    legacyStatus: payloadSchema ? "CURRENT" : "LEGACY_UNMIGRATED",
    owner: metadata.owner,
    version: metadata.version,
    consumers: metadata.consumers,
    domain: metadata.domain
  };
}

/** Every catalog name has a real contract; legacy names stay explicit until migrated. */
export const API_RESPONSE_CONTRACT_REGISTRY: ReadonlyMap<string, ApiResponseContractStrength> = new Map(
  API_RESPONSE_SCHEMA_CATALOG.map((schema) => [schema.name, responseContractDescriptor(schema.name).strength])
);

export const API_RESPONSE_CONTRACT_METADATA: ReadonlyMap<string, Omit<ApiResponseContractDescriptor, "method" | "path">> = new Map(
  API_RESPONSE_SCHEMA_CATALOG.map((schema) => [schema.name, responseContractDescriptor(schema.name)])
);

export interface ApiResponseValidationInput {
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly contentType: string | null;
  readonly payload: unknown;
  readonly catalog?: readonly RuntimeRouteDescriptor[];
}

export function validateApiResponseEgress(input: ApiResponseValidationInput): void {
  const route = findRuntimeRoute(input.method, input.path, input.catalog ?? runtimeRouteCatalog());
  const versionedApiPath = input.path.split("?")[0]?.startsWith("/api/v1/") ?? false;
  // Fastify's not-found handler is intentionally outside the registered route
  // inventory. Keep that bounded 404 envelope observable while rejecting a
  // successful response that bypasses the catalog.
  if (versionedApiPath && !route && input.statusCode !== 404) throw new ApiResponseContractError(null, "unregistered API route has no response contract");
  if (versionedApiPath && route) responseContractDescriptor(route.responseSchema);
  const mode = responseMode(input.contentType, input.payload);
  if (input.statusCode === 204) {
    if (!isEmptyPayload(input.payload)) throw new ApiResponseContractError(route?.responseSchema ?? null, "204 responses must not carry a body");
    return;
  }
  if (mode === "TEXT") {
    const bytes = bodyByteLength(input.payload);
    if (bytes > MAX_API_TEXT_RESPONSE_BYTES) throw new ApiResponseContractError(route?.responseSchema ?? null, "text response exceeds the bounded egress budget");
    return;
  }
  if (mode === "BINARY") {
    const bytes = bodyByteLength(input.payload);
    if (bytes > MAX_API_JSON_RESPONSE_BYTES) throw new ApiResponseContractError(route?.responseSchema ?? null, "binary response exceeds the bounded egress budget");
    return;
  }
  if (!route) return;

  const value = parseJsonPayload(input.payload, route.responseSchema);
  assertSafeApiOutput(value, route.responseSchema);
  const encoded = safeJsonBytes(value, route.responseSchema);
  if (encoded > MAX_API_JSON_RESPONSE_BYTES) throw new ApiResponseContractError(route.responseSchema, "JSON response exceeds the bounded egress budget");

  const error = apiErrorEnvelopeSchema.safeParse(value);
  if (error.success) return;
  const partial = apiPartialEnvelopeSchema.safeParse(value);
  if (partial.success) return;
  const success = apiSuccessEnvelopeSchema.safeParse(value);
  if (!success.success) throw new ApiResponseContractError(route.responseSchema, "response envelope failed schema validation");

  const payloadSchema = payloadSchemas.get(route.responseSchema);
  if (payloadSchema) {
    const payloadResult = payloadSchema.safeParse(success.data.data);
    if (!payloadResult.success) {
      throw new ApiResponseContractError(route.responseSchema, "response payload failed schema validation");
    }
  }
}

/** Focused harness used by unit/integration tests and route-conformance jobs. */
export function assertCatalogResponseContracts(catalog: readonly ApiRouteDescriptor[] = API_ROUTE_CATALOG): readonly ApiResponseContractDescriptor[] {
  const descriptors = catalog.map((route) => ({
    method: route.method,
    path: `/api/v1${route.path}`,
    ...responseContractDescriptor(route.responseSchema)
  } satisfies ApiResponseContractDescriptor));
  if (descriptors.length !== catalog.length) throw new ApiResponseContractError(null, "catalog response contract coverage is incomplete");
  return Object.freeze(descriptors.map((descriptor) => Object.freeze(descriptor)));
}

function findRuntimeRoute(method: string, path: string, catalog: readonly RuntimeRouteDescriptor[]): RuntimeRouteDescriptor | null {
  const normalizedPath = path.split("?")[0] ?? path;
  return catalog.find((candidate) => candidate.method === method && routePattern(candidate.path).test(normalizedPath)) ?? null;
}

function routePattern(path: string): RegExp {
  if (path === "*") return /^\/?.*$/;
  const escaped = path.split("/").map((segment) => segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\/");
  return new RegExp(`^${escaped}$`);
}

function responseMode(contentType: string | null, payload: unknown): "JSON" | "TEXT" | "BINARY" {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("application/json") || normalized.includes("+json")) return "JSON";
  if (normalized.includes("text/") || normalized.includes("application/openmetrics")) return "TEXT";
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return "BINARY";
  return "JSON";
}

function parseJsonPayload(payload: unknown, responseSchema: string): unknown {
  if (typeof payload === "string") {
    try { return JSON.parse(payload) as unknown; } catch { throw new ApiResponseContractError(responseSchema, "JSON response is malformed"); }
  }
  if (Buffer.isBuffer(payload)) {
    try { return JSON.parse(payload.toString("utf8")) as unknown; } catch { throw new ApiResponseContractError(responseSchema, "JSON response is malformed"); }
  }
  if (payload && typeof payload === "object" && typeof (payload as { getReader?: unknown }).getReader === "function") throw new ApiResponseContractError(responseSchema, "streaming responses require an explicit non-JSON route contract");
  return payload;
}

function safeJsonBytes(value: unknown, responseSchema: string): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new ApiResponseContractError(responseSchema, "response is not safely serializable");
  }
}

function bodyByteLength(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  return safeJsonBytes(value, "non-json-response");
}

function isEmptyPayload(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Buffer.isBuffer(value) && value.length === 0) || (value instanceof Uint8Array && value.length === 0);
}

function assertSafeApiOutput(value: unknown, responseSchema: string): void {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, depth: number): boolean => {
    if (current === null || typeof current === "string" || typeof current === "boolean" || typeof current === "number") return Number.isFinite(current as number) || typeof current !== "number";
    if (typeof current !== "object" || depth > 32 || seen.has(current)) return false;
    seen.add(current);
    try {
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") return false;
        const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (["password", "passworddigest", "secret", "secretvalue", "apikey", "authorization", "bearertoken", "privatekey", "credential", "rawresponse", "providerbody", "providererror", "accesstoken", "refreshtoken"].includes(normalized)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !("value" in descriptor) || !visit(descriptor.value, depth + 1)) return false;
      }
      return true;
    } finally {
      seen.delete(current);
    }
  };
  if (!visit(value, 0)) throw new ApiResponseContractError(responseSchema, "response contains unsafe or non-serializable output fields");
}
