import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { API_RESPONSE_SCHEMA_CATALOG, API_ROUTE_CATALOG, ApiCatalogError, apiErrorEnvelopeSchema, apiSuccessEnvelopeSchema, guardianInputSchema, loginInputSchema, validateApiRouteCatalog } from "@cvg/contracts";
import { ApiResponseContractError, API_RESPONSE_CONTRACT_METADATA, API_RESPONSE_CONTRACT_REGISTRY, MAX_API_JSON_RESPONSE_BYTES, MAX_API_TEXT_RESPONSE_BYTES, assertCatalogResponseContracts, validateApiResponseEgress } from "../../apps/api/src/response-contract.ts";
import { API_PAYLOAD_RESPONSE_SCHEMAS } from "../../apps/api/src/response-schemas/index.ts";

const correlationId = "cvg-aud26-contract";

test("every cataloged API response has an executable egress contract", () => {
  const descriptors = assertCatalogResponseContracts();
  assert.equal(descriptors.length, API_ROUTE_CATALOG.length);
  assert.equal(descriptors.every((descriptor) => API_RESPONSE_CONTRACT_REGISTRY.has(descriptor.responseSchema)), true);
  assert.equal(API_ROUTE_CATALOG.length, 106);
  assert.equal(API_RESPONSE_SCHEMA_CATALOG.length, 81);
  assert.equal(new Set(API_ROUTE_CATALOG.map((route) => route.responseSchema)).size, API_RESPONSE_SCHEMA_CATALOG.length);
  assert.equal(API_RESPONSE_CONTRACT_METADATA.get("LoginResponse")?.strength, "PAYLOAD_SCHEMA");
  assert.equal(API_RESPONSE_CONTRACT_METADATA.get("LoginResponse")?.coverage, "PAYLOAD_AND_ENVELOPE");
  assert.equal(API_RESPONSE_CONTRACT_METADATA.get("HealthResponse")?.strength, "PAYLOAD_SCHEMA");
  assert.equal(API_RESPONSE_CONTRACT_METADATA.get("HealthResponse")?.coverage, "PAYLOAD_AND_ENVELOPE");
  assert.equal(API_RESPONSE_CONTRACT_METADATA.get("HealthResponse")?.legacyStatus, "CURRENT");
  assert.equal(API_RESPONSE_CONTRACT_METADATA.get("HealthResponse")?.consumers.length, 1);
  assert.equal([...API_RESPONSE_CONTRACT_REGISTRY.values()].filter((strength) => strength === "PAYLOAD_SCHEMA").length, 81);
});

test("MEL23-047 request, success, and error examples in the API guide match current schemas", () => {
  const guide = readFileSync(new URL("../../docs/api-examples-v1.md", import.meta.url), "utf8");
  const httpExamples = [...guide.matchAll(/```http\s*\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
  const jsonExamples = [...guide.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
  const requestSchemas = new Map<string, z.ZodTypeAny>([
    ["LoginInput", loginInputSchema],
    ["GuardianInput", guardianInputSchema]
  ]);
  const expectedRequestSchemas = new Map([
    ["POST /auth/login", "LoginInput"],
    ["POST /guardians", "GuardianInput"]
  ]);
  const seenRequestRoutes = new Set<string>();

  assert.equal(httpExamples.length, expectedRequestSchemas.size);
  for (const example of httpExamples) {
    const requestLine = example.match(/^([A-Z]+) (\S+) HTTP\/1\.1$/m);
    assert.ok(requestLine, `API guide request example has no HTTP request line: ${example}`);
    const method = requestLine[1];
    const documentedPath = requestLine[2] ?? "";
    assert.match(documentedPath, /^\/api\/v1\//, `${method} example must use the documented /api/v1 prefix`);
    const path = documentedPath.replace(/^\/api\/v1/, "");
    const route = API_ROUTE_CATALOG.find((candidate) => candidate.method === method && candidate.path === path);
    assert.ok(route, `API guide example route ${method} ${path} is not cataloged`);
    const routeKey = `${method} ${path}`;
    assert.equal(seenRequestRoutes.has(routeKey), false, `API guide request example duplicates ${routeKey}`);
    seenRequestRoutes.add(routeKey);
    assert.ok(route.requestSchema, `API guide example route ${method} ${path} has no request schema`);
    assert.equal(expectedRequestSchemas.get(routeKey), route.requestSchema, `API guide request example ${routeKey} must document its expected schema`);
    const schema = requestSchemas.get(route.requestSchema);
    assert.ok(schema, `API guide request schema ${route.requestSchema} has no executable example mapping`);
    const bodyStart = example.indexOf("\n\n");
    assert.notEqual(bodyStart, -1, `${method} ${path} example has no JSON request body`);
    assert.match(example, /^Content-Type: application\/json$/im, `${method} ${path} example must declare JSON content`);
    assert.match(example, /^Accept: application\/json$/im, `${method} ${path} example must request JSON`);
    const body = JSON.parse(example.slice(bodyStart + 2).trim()) as unknown;
    assert.equal(schema.safeParse(body).success, true, `${method} ${path} request example failed ${route.requestSchema}`);
  }
  assert.deepEqual([...seenRequestRoutes].sort(), [...expectedRequestSchemas.keys()].sort());

  const annotatedResponseExamples = [...guide.matchAll(/<!--\s*api-response-example:\s*([A-Z]+)\s+(\S+)\s+(\d{3})\s+([A-Za-z0-9_-]+)\s*-->\s*\n\s*```json\s*\n([\s\S]*?)```/g)];
  const expectedResponseExamples = new Map([
    ["POST /api/v1/auth/login 200", "LoginResponse"],
    ["POST /api/v1/guardians 201", "GuardianResponse"],
    ["GET /api/v1/guardians 200", "GuardianListResponse"],
    ["POST /api/v1/guardians 400", "ERROR"]
  ]);
  assert.equal(jsonExamples.length, expectedResponseExamples.size);
  assert.equal(annotatedResponseExamples.length, jsonExamples.length, "every API guide JSON response must be explicitly bound to a route, status and schema");
  let successExamples = 0;
  let errorExamples = 0;
  const seenResponseExamples = new Set<string>();
  for (const match of annotatedResponseExamples) {
    const method = match[1] ?? "";
    const documentedPath = match[2] ?? "";
    const statusCode = Number(match[3]);
    const documentedSchema = match[4] ?? "";
    const example = match[5] ?? "";
    const exampleKey = `${method} ${documentedPath} ${statusCode}`;
    assert.equal(seenResponseExamples.has(exampleKey), false, `API guide response example duplicates ${exampleKey}`);
    seenResponseExamples.add(exampleKey);
    assert.equal(expectedResponseExamples.get(exampleKey), documentedSchema, `API guide response example ${exampleKey} must document its expected payload schema`);
    assert.match(documentedPath, /^\/api\/v1\//, `${method} response example must use the documented /api/v1 prefix`);
    const path = documentedPath.replace(/^\/api\/v1/, "");
    const route = API_ROUTE_CATALOG.find((candidate) => candidate.method === method && candidate.path === path);
    assert.ok(route, `API guide response example route ${method} ${path} is not cataloged`);
    const envelope = JSON.parse(example) as { data?: unknown; error?: unknown };
    if (documentedSchema === "ERROR") {
      assert.ok(statusCode >= 400, `${exampleKey} error response must use an error HTTP status`);
      assert.equal(apiErrorEnvelopeSchema.safeParse(envelope).success, true, "API guide error example must match the versioned error envelope");
      errorExamples++;
      continue;
    }

    assert.ok(statusCode >= 200 && statusCode < 300, `${exampleKey} success response must use a 2xx HTTP status`);
    assert.equal(apiSuccessEnvelopeSchema.safeParse(envelope).success, true, "API guide success example must match the versioned success envelope");
    assert.equal(route.responseSchema, documentedSchema, `${exampleKey} does not match the route's cataloged response schema`);
    const schema = API_PAYLOAD_RESPONSE_SCHEMAS.get(documentedSchema);
    assert.ok(schema, `API guide response schema ${documentedSchema} is not executable`);
    assert.equal(schema.safeParse(envelope.data).success, true, `API guide success example failed ${documentedSchema}`);
    successExamples++;
  }

  assert.deepEqual([...seenResponseExamples].sort(), [...expectedResponseExamples.keys()].sort());
  assert.equal(successExamples, 3);
  assert.equal(errorExamples, 1);
});

test("known-bad response names fail closed and dead mappings stay unregistered", () => {
  const health = API_ROUTE_CATALOG.find((route) => route.path === "/health")!;
  const unregistered = { ...health, responseSchema: "UnregisteredResponse" };
  assert.throws(() => validateApiRouteCatalog([unregistered] as never), ApiCatalogError);
  assert.throws(() => assertCatalogResponseContracts([unregistered] as never), (error: unknown) => error instanceof ApiResponseContractError && error.responseSchema === "UnregisteredResponse");
  assert.equal(API_RESPONSE_CONTRACT_REGISTRY.has("FinanceChargesResponse"), false);
});

test("known-good JSON, error, text and empty responses cross the bounded boundary", () => {
  validateApiResponseEgress({ method: "GET", path: "/api/v1/health", statusCode: 200, contentType: "application/json; charset=utf-8", payload: { schemaVersion: 1, data: { live: true, status: "READY", capabilities: { demoOnly: true, realProvidersBlocked: true, realDataBlocked: true } }, correlationId } });
  validateApiResponseEgress({ method: "GET", path: "/api/v1/health", statusCode: 503, contentType: "application/json", payload: { schemaVersion: 1, error: { code: "DEPENDENCY_UNAVAILABLE", message: "indisponível" }, correlationId } });
  validateApiResponseEgress({ method: "GET", path: "/internal/metrics", statusCode: 200, contentType: "text/plain; version=0.0.4", payload: "cvg_api_requests_total 1\n" });
  validateApiResponseEgress({ method: "OPTIONS", path: "/*", statusCode: 204, contentType: null, payload: "" });
});

test("known-bad output is rejected before it can be serialized to the client", () => {
  assert.throws(
    () => validateApiResponseEgress({ method: "GET", path: "/api/v1/health", statusCode: 200, contentType: "application/json", payload: { schemaVersion: 1, data: { passwordDigest: "sensitive" }, correlationId } }),
    (error: unknown) => error instanceof ApiResponseContractError
  );
  assert.throws(
    () => validateApiResponseEgress({ method: "GET", path: "/api/v1/health", statusCode: 200, contentType: "application/json", payload: { schemaVersion: 1, data: 1n, correlationId } }),
    (error: unknown) => error instanceof ApiResponseContractError
  );
  assert.throws(
    () => validateApiResponseEgress({ method: "GET", path: "/internal/metrics", statusCode: 200, contentType: "text/plain", payload: "x".repeat(MAX_API_TEXT_RESPONSE_BYTES + 1) }),
    (error: unknown) => error instanceof ApiResponseContractError
  );
  assert.throws(
    () => validateApiResponseEgress({ method: "GET", path: "/api/v1/health", statusCode: 204, contentType: null, payload: "unexpected" }),
    (error: unknown) => error instanceof ApiResponseContractError
  );
  assert.throws(
    () => validateApiResponseEgress({ method: "GET", path: "/api/v1/unregistered", statusCode: 200, contentType: "application/json", payload: { schemaVersion: 1, data: {}, correlationId } }),
    (error: unknown) => error instanceof ApiResponseContractError && error.responseSchema === null
  );
});

test("rejects a schema-valid audit payload that exceeds the JSON response byte budget", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const metadata = Object.fromEntries(Array.from({ length: 1_100 }, (_, index) => [`field${index}`, "x".repeat(500)]));
  const auditRecord = {
    id: "00000000-0000-4000-8000-000000000003",
    organizationId,
    actorId,
    unitId: null,
    workspaceId: null,
    action: "patients.read",
    resourceType: "AnimalPatient",
    resourceId: null,
    result: "ALLOWED",
    reason: null,
    correlationId,
    metadata,
    chainVersion: 2,
    previousHash: null,
    recordHash: "a".repeat(64),
    createdAt: "2026-09-21T12:00:00.000Z"
  };
  const payload = {
    schemaVersion: 1,
    data: { items: [auditRecord], nextCursor: null, revision: "1" },
    correlationId
  };
  assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_API_JSON_RESPONSE_BYTES);

  assert.throws(
    () => validateApiResponseEgress({ method: "GET", path: "/api/v1/audit", statusCode: 200, contentType: "application/json", payload }),
    (error: unknown) => error instanceof ApiResponseContractError
      && error.responseSchema === "AuditListResponse"
      && error.reason === "JSON response exceeds the bounded egress budget"
  );
});
