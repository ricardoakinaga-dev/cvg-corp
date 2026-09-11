import test from "node:test";
import assert from "node:assert/strict";
import { API_ROUTE_CATALOG, id } from "@cvg/contracts";
import { CvgStore } from "@cvg/domain";
import { GovernedHarness } from "@cvg/harness";
import { StaticPolicyDecisionPoint, applicationPolicyFor, assertPolicyAllowed, authorizeApplicationRequest } from "@cvg/agent-policy";
import { InMemoryToolExecutionLedger, ToolGateway, ToolGatewayError, toolRegistryDigest, type ToolDescriptor } from "@cvg/agent-tools";
import { DeepSeekHarnessAdapter, MockHarnessAdapter } from "@cvg/harness-adapters";
import { ConfigError, WorkerConfigError, loadCvgConfig, loadWorkerConfig } from "@cvg/config";
import { assertProductionRuntimeOverrides, createRuntime, MemoryRateLimiter } from "@cvg/api";
import { EnvironmentSecretProvider } from "@cvg/integrations";
import { ApiError, createApiClient, isContextRevalidationError, isPermissionDeniedError, isStaleDataError } from "../../apps/web/src/api/client.ts";
import { canRenderContextData, isWriteAllowed, RUNTIME_STATES, runtimeStateReducer, type RuntimeSnapshot } from "../../apps/web/src/state/runtime-state.ts";

function contextFor(store: CvgStore, purpose: string) {
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const session = store.createSession(store.bootstrapCredentials.userId, `synthetic-${purpose}`, "synthetic-csrf", 60);
  return store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, purpose, "vnext-test", null, null, session.id);
}

test("vNext PDP rejects foreign scope and requires independent approval", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = contextFor(store, "stock.dispense");
  const policy = new StaticPolicyDecisionPoint(context.policyRevision);
  const gateway = new ToolGateway(policy, new InMemoryToolExecutionLedger());
  const descriptor: ToolDescriptor<{ message: string }> = {
    name: "cvg.stock.dispense",
    version: "1.0.0",
    description: "tool fixture",
    operation: "stock.dispense",
    capability: "stock:write",
    risk: "CRITICAL",
    approvalMode: "INDEPENDENT",
    allowedRoles: ["admin", "estoque"],
    acceptedDataClasses: ["D2"],
    scope: "UNIT",
    resourceRequired: true,
    requiresApproval: true,
    idempotency: "REQUIRED",
    auditAction: "stock.dispense",
    secretRefs: [],
    timeoutMs: 1_000,
    egress: "LOCAL_ONLY",
    parseInput: (value) => {
      if (typeof value !== "object" || value === null || typeof (value as { message?: unknown }).message !== "string") throw new Error("message required");
      return value as { message: string };
    }
  };
  gateway.register(descriptor);
  const resource = { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, resourceId: id("resource-1"), dataClass: "D2" as const };
  let calls = 0;
  await assert.rejects(() => gateway.execute(descriptor.name, { context, sessionId: id("00000000-0000-4000-8000-000000000990"), resource, input: { message: "send" }, idempotencyKey: "session-conflict" }, async () => { calls += 1; return true; }), (error: unknown) => error instanceof ToolGatewayError && error.code === "POLICY_DENIED");
  await assert.rejects(() => gateway.execute(descriptor.name, { context, sessionId: context.sessionId!, resource, input: { message: "send" }, idempotencyKey: "digest-conflict", requestDigest: "0".repeat(64) }, async () => { calls += 1; return true; }), (error: unknown) => error instanceof ToolGatewayError && error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(calls, 0);
  await assert.rejects(() => gateway.execute(descriptor.name, { context, sessionId: context.sessionId!, resource, input: { message: "send" }, idempotencyKey: "approval-1" }, async () => { calls += 1; return true; }), (error: unknown) => error instanceof ToolGatewayError && error.code === "APPROVAL_REQUIRED");
  assert.equal(calls, 0);

  const pendingError = await gateway.execute(descriptor.name, { context, sessionId: context.sessionId!, resource, input: { message: "send" }, idempotencyKey: "approval-1" }, async () => true).catch((error: unknown) => error);
  assert.ok(pendingError instanceof ToolGatewayError);
  const requestDigest = String(pendingError.details.requestDigest);
  const allowed = await gateway.execute(descriptor.name, {
    context,
    sessionId: context.sessionId!,
    resource,
    input: { message: "send" },
    idempotencyKey: "approval-1",
    approval: { approvalId: id("00000000-0000-4000-8000-000000000901"), actorId: context.actorId, approverId: id("00000000-0000-4000-8000-000000000902"), requestDigest, policyRevision: context.policyRevision, expiresAt: new Date(Date.now() + 60_000).toISOString(), oneShot: true, consumed: false }
  }, async (input: { message: string }) => { calls += 1; return input.message; });
  assert.equal(allowed.result, "send");
  const replay = await gateway.execute(descriptor.name, {
    context,
    sessionId: context.sessionId!,
    resource,
    input: { message: "send" },
    idempotencyKey: "approval-1",
    approval: { approvalId: id("00000000-0000-4000-8000-000000000901"), actorId: context.actorId, approverId: id("00000000-0000-4000-8000-000000000902"), requestDigest, policyRevision: context.policyRevision, expiresAt: new Date(Date.now() + 60_000).toISOString(), oneShot: true, consumed: false }
  }, async () => "must-not-run");
  assert.equal(replay.result, "send");
  assert.equal(calls, 1);

  const foreign = policy.evaluate({ context, operation: descriptor.operation, sessionId: null, purpose: context.purpose, capability: descriptor.capability, risk: "LOW", requiresApproval: false, approvalMode: "NONE", allowedRoles: descriptor.allowedRoles, acceptedDataClasses: descriptor.acceptedDataClasses, resource: { ...resource, organizationId: id("00000000-0000-4000-8000-000000009999") }, requestDigest: "a".repeat(64), constraints: {} });
  assert.equal(foreign.status, "DENY");
  assert.throws(() => assertPolicyAllowed(foreign));
});

test("application policy catalog denies an unlisted role before a durable read", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const operator = [...store.users.values()].find((user) => user.login === "ops@cvg.local");
  assert.ok(operator);
  const option = store.contextOptions(operator.id)[0];
  assert.ok(option);
  const session = store.createSession(operator.id, "synthetic-application-policy", "synthetic-csrf", 60);
  const context = store.resolveContext(operator.id, { unitId: option.unit.id, workspaceId: option.workspace.id }, "guardians.read", "application-policy-test", null, null, session.id);
  const rule = applicationPolicyFor("guardians.read");
  assert.ok(rule);
  const decision = authorizeApplicationRequest(context, "guardians.read", { dataClass: "D2" });
  assert.equal(decision.status, "DENY");
  assert.match(decision.reason, /role/i);
});

test("application PDP binds the authenticated session, registered capability and patient target", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const patient = [...store.patients.values()][0];
  assert.ok(patient);
  const context = contextFor(store, "patients.read");
  const targetContext = store.resolveContext(context.actorId, { unitId: context.unitId, workspaceId: context.workspaceId }, "patients.read", "patient-pdp-test", patient.id, null, context.sessionId);
  const policy = new StaticPolicyDecisionPoint(targetContext.policyRevision);
  const request = {
    context: targetContext,
    operation: "patients.read",
    sessionId: targetContext.sessionId,
    purpose: targetContext.purpose,
    capability: "patients:read",
    risk: "LOW" as const,
    requiresApproval: false,
    approvalMode: "NONE" as const,
    allowedRoles: ["admin", "veterinario", "recepcao", "financeiro", "estoque"] as const,
    acceptedDataClasses: ["D3"] as const,
    resource: { organizationId: targetContext.organizationId, unitId: targetContext.unitId, workspaceId: targetContext.workspaceId, resourceId: patient.id, dataClass: "D3" as const },
    requestDigest: "a".repeat(64),
    constraints: { resourceRequired: true }
  };
  assert.equal(policy.evaluate(request).status, "ALLOW");
  assert.equal(policy.evaluate({ ...request, sessionId: null }).status, "DENY");
  assert.equal(policy.evaluate({ ...request, capability: "patients:write" }).status, "DENY");
  assert.equal(policy.evaluate({ ...request, resource: { ...request.resource, resourceId: null } }).status, "DENY");
  assert.equal(policy.evaluate({ ...request, context: { ...targetContext, patientId: id("00000000-0000-4000-8000-000000009999") } }).status, "DENY");
});

test("tool registry digest excludes parser functions and remains deterministic", () => {
  const parser = () => ({ ok: true });
  const descriptor = { name: "cvg.test.read", version: "1.0.0", description: "read", operation: "test.read", capability: "test:read", risk: "LOW" as const, approvalMode: "NONE" as const, allowedRoles: ["admin"] as const, acceptedDataClasses: ["D0"] as const, scope: "ORGANIZATION" as const, resourceRequired: false, requiresApproval: false, idempotency: "REQUIRED" as const, auditAction: "test.read", secretRefs: [] as const, timeoutMs: 1_000, egress: "NONE" as const, parseInput: parser };
  assert.equal(toolRegistryDigest([descriptor]), toolRegistryDigest([{ ...descriptor, parseInput: () => ({ ok: true }) }]));
});

test("ToolGateway denies a descriptor outside the canonical tool policy before registration", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = contextFor(store, "operations.unknown");
  const gateway = new ToolGateway(new StaticPolicyDecisionPoint(context.policyRevision), new InMemoryToolExecutionLedger());
  assert.throws(() => gateway.register({ name: "cvg.test.unregistered", version: "1.0.0", description: "unregistered fixture", operation: "operations.unknown", capability: "operations:unknown", risk: "LOW", approvalMode: "NONE", allowedRoles: ["admin"], acceptedDataClasses: ["D0"], scope: "ORGANIZATION", resourceRequired: false, requiresApproval: false, idempotency: "REQUIRED", auditAction: "operations.unknown", secretRefs: [], timeoutMs: 1_000, egress: "NONE", parseInput: (value: unknown) => value }), (error: unknown) => error instanceof ToolGatewayError && error.code === "CAPABILITY_DISABLED");
});

test("API catalog covers the versioned surface without duplicate route keys", () => {
  const keys = API_ROUTE_CATALOG.map((route) => `${route.method} ${route.path}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(API_ROUTE_CATALOG.length >= 60);
  assert.equal(API_ROUTE_CATALOG.every((route) => route.version === "v1" && route.responseSchema.length > 0), true);
});

test("Mock adapter exposes the provider-neutral runtime lifecycle", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = contextFor(store, "OPERATIONS");
  const adapter = new MockHarnessAdapter(new GovernedHarness(store));
  const health = await adapter.health();
  assert.equal(health.status, "READY");
  const session = await adapter.createSession(context, { purpose: "OPERATIONS", patientId: null, encounterId: null });
  const result = await adapter.executeTurn(context, { sessionId: session.id, prompt: "organize a fila", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "mock-turn-1" });
  assert.equal(result.provenance.provider, "local-stub");
  assert.equal(result.provenance.manifestVersion, "0.1.1-rc.2");
  assert.equal(result.turn.usage?.settlement?.model, result.turn.model);
  assert.equal(result.turn.usage?.settlement?.inputTokens, result.turn.inputTokens);
  assert.equal(result.turn.usage?.settlement?.outputTokens, result.turn.outputTokens);
  assert.equal(result.turn.usage?.settlement?.estimatedCost.source, "LOCAL_SYNTHETIC");
  assert.equal(result.turn.usage?.settlement?.discrepancy.status, "MATCHED");
  const replay = await adapter.replay(context, session.id);
  assert.equal(replay.turns.length, 1);
  await adapter.shutdown();
});

test("DeepSeek adapter fails closed on unavailable or mismatched harness", async () => {
  const calls: string[] = [];
  const adapter = new DeepSeekHarnessAdapter({ baseUrl: "http://127.0.0.1:9999", expectedEngineCommit: "approved-commit", expectedManifestVersion: "approved-manifest", requestTimeoutMs: 500, allowInsecureHttp: true }, async (url) => {
    calls.push(url.toString());
    return { ok: true, status: 200, json: async () => ({ status: "READY", engineCommit: "other-commit", manifestVersion: "approved-manifest", tools: [], supports: { cancellation: true, approvals: true, replay: true, provenance: true } }) };
  });
  const health = await adapter.health();
  assert.equal(health.status, "UNAVAILABLE");
  assert.match(health.reason ?? "", /não corresponde/);
  await assert.rejects(() => adapter.createSession(contextFor(new CvgStore({ bootstrapPassword: "synthetic-password-123" }), "OPERATIONS"), { purpose: "OPERATIONS", patientId: null, encounterId: null }));
  assert.deepEqual(calls, ["http://127.0.0.1:9999/v1/health", "http://127.0.0.1:9999/v1/health"]);
});

test("DeepSeek adapter fails closed when the harness omits mandatory capabilities", async () => {
  const adapter = new DeepSeekHarnessAdapter({ baseUrl: "http://127.0.0.1:9997", expectedEngineCommit: "approved-commit", expectedManifestVersion: "approved-manifest", expectedToolNames: [], requestTimeoutMs: 500, allowInsecureHttp: true }, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: "READY", engineCommit: "approved-commit", manifestVersion: "approved-manifest", tools: [], supports: { cancellation: true, approvals: false, replay: false, provenance: true } })
  }));
  const health = await adapter.health();
  assert.equal(health.status, "UNAVAILABLE");
  assert.match(health.reason ?? "", /capabilities obrigatórias/i);
  await assert.rejects(() => adapter.createSession(contextFor(new CvgStore({ bootstrapPassword: "synthetic-password-123" }), "OPERATIONS"), { purpose: "OPERATIONS", patientId: null, encounterId: null }));
});

test("DeepSeek adapter never sends a request without a resolved credential", async () => {
  let calls = 0;
  const adapter = new DeepSeekHarnessAdapter({ baseUrl: "http://127.0.0.1:9998", expectedEngineCommit: "approved-commit", expectedManifestVersion: "approved-manifest", expectedToolNames: [], requestTimeoutMs: 500, allowInsecureHttp: true, resolveBearerToken: async () => null }, async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  });
  const health = await adapter.health();
  assert.equal(health.status, "UNAVAILABLE");
  assert.match(health.reason ?? "", /sem credencial resolvida/);
  assert.equal(calls, 0);
});

test("typed configuration rejects unknown CVG keys and insecure production", () => {
  const config = loadCvgConfig({ NODE_ENV: "test", CVG_DEMO_MODE: "false", CVG_API_PORT: "4321", CVG_WORKER_MAX_OUTSTANDING: "321" });
  assert.equal(config.demoMode, false);
  assert.equal(config.apiPort, 4321);
  assert.equal(config.workerMaxOutstandingOutbox, 321);
  assert.equal(loadCvgConfig({ NODE_ENV: "test", CVG_RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567", CVG_RELEASE_ARTIFACT_DIGEST: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }).releaseArtifactDigest, "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  assert.throws(() => loadCvgConfig({ CVG_UNSAFE_MODE: "true" }), (error: unknown) => error instanceof ConfigError);
  assert.throws(() => loadCvgConfig({ NODE_ENV: "production", CVG_DEMO_MODE: "false", CVG_WEB_ORIGIN: "http://example.test" }), (error: unknown) => error instanceof ConfigError);
  assert.throws(() => loadCvgConfig({ NODE_ENV: "production", CVG_DEMO_MODE: "false", CVG_WEB_ORIGIN: "https://example.test", CVG_STORAGE: "memory", CVG_SECRET_PROVIDER: "none", CVG_DEEPSEEK_RUNTIME_ENABLED: "false" }), (error: unknown) => error instanceof ConfigError);
  const production = {
    NODE_ENV: "production", CVG_HOST: "0.0.0.0", CVG_DEMO_MODE: "false", CVG_WEB_ORIGIN: "https://example.test", CVG_RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567", CVG_RELEASE_ARTIFACT_DIGEST: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", CVG_STORAGE: "postgres", DATABASE_URL: "postgresql://cvg_runtime:password@db.example.test/cvg", CVG_SECRET_PROVIDER: "file", CVG_AUTH_MFA_MODE: "required", CVG_DEEPSEEK_RUNTIME_ENABLED: "true", CVG_DEEPSEEK_BASE_URL: "https://harness.example.test", CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "abcdefabcdefabcdefabcdefabcdefabcdefabcd", CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION: "approved", CVG_DEEPSEEK_BEARER_TOKEN_REF: "harness.token", CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF: "harness.context", CVG_RATE_LIMIT_BACKEND: "distributed", CVG_TRUST_PROXY: "true", CVG_TRUSTED_PROXY_IPS: "loopback"
  };
  assert.doesNotThrow(() => loadCvgConfig(production));
  assert.deepEqual(loadCvgConfig({ ...production, CVG_TRUSTED_PROXY_IPS: "10.0.0.0/8,loopback" }).trustedProxyIps, ["10.0.0.0/8", "loopback"]);
  assert.throws(() => loadCvgConfig({ ...production, CVG_TRUSTED_PROXY_IPS: "" }), (error: unknown) => error instanceof ConfigError);
  assert.throws(() => loadCvgConfig({ ...production, CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "0000000000000000000000000000000000000000" }), (error: unknown) => error instanceof ConfigError);
  assert.throws(() => loadCvgConfig({ ...production, CVG_RELEASE_ARTIFACT_DIGEST: "sha256:not-a-digest" }), (error: unknown) => error instanceof ConfigError);
});

test("worker configuration has a role-specific production contract", () => {
  const worker = loadWorkerConfig({
    NODE_ENV: "production",
    CVG_STORAGE: "postgres",
    DATABASE_URL: "postgresql://cvg_runtime:password@db.example.test/cvg",
    CVG_WORKER_ORGANIZATION_ID: "00000000-0000-4000-0000-000000000010",
    CVG_BACKUP_ENABLED: "true",
    CVG_BACKUP_ORGANIZATION_ID: "00000000-0000-4000-0000-000000000010",
    CVG_BACKUP_DIRECTORY: "/var/lib/cvg/backups",
    CVG_BACKUP_INTERVAL_MS: "3600000",
    CVG_BACKUP_KEEP_LAST: "7",
    CVG_RECOVERY_ENCRYPTION_KEY_REF: "recovery.key",
    CVG_WORKER_SINK_MODE: "enabled",
    CVG_SECRET_PROVIDER: "file",
    CVG_MESSAGING_PROVIDER_ENDPOINT: "https://provider.example.test",
    CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS: "provider.example.test",
    CVG_MESSAGING_CREDENTIAL_REF: "provider.credential"
  });
  assert.equal(worker.nodeEnv, "production");
  assert.equal(worker.storageMode, "postgres");
  assert.equal(worker.workerSinkMode, "enabled");
  assert.throws(() => loadWorkerConfig({
    NODE_ENV: "production",
    CVG_STORAGE: "postgres",
    DATABASE_URL: "postgresql://cvg_runtime:password@db.example.test/cvg",
    CVG_WORKER_ORGANIZATION_ID: "00000000-0000-4000-0000-000000000010",
    CVG_WORKER_SINK_MODE: "enabled",
    CVG_SECRET_PROVIDER: "file",
    CVG_MESSAGING_PROVIDER_ENDPOINT: "http://provider.example.test",
    CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS: "provider.example.test",
    CVG_MESSAGING_CREDENTIAL_REF: "provider.credential"
  }), (error: unknown) => error instanceof WorkerConfigError);
  assert.throws(() => loadWorkerConfig({
    NODE_ENV: "production",
    CVG_STORAGE: "postgres",
    DATABASE_URL: "postgresql://cvg_runtime:password@db.example.test/cvg",
    CVG_WORKER_ORGANIZATION_ID: "00000000-0000-4000-0000-000000000010",
    CVG_WORKER_SINK_MODE: "enabled",
    CVG_SECRET_PROVIDER: "file",
    CVG_MESSAGING_PROVIDER_ENDPOINT: "https://provider.example.test",
    CVG_MESSAGING_PROVIDER_ALLOWED_HOSTS: "provider.example.test",
    CVG_MESSAGING_CREDENTIAL_REF: "provider.credential",
    CVG_UNSAFE_MODE: "true"
  }), (error: unknown) => error instanceof WorkerConfigError);
});

test("typed configuration accepts the explicit ACP boundary without enabling it implicitly", () => {
  const config = loadCvgConfig({
    NODE_ENV: "test",
    CVG_DEEPSEEK_ACP_COMMAND: "node",
    CVG_DEEPSEEK_ACP_ARGS_JSON: '["--version"]',
    CVG_DEEPSEEK_ACP_ENGINE_ROOT: "/srv/deepseek-harness",
    CVG_DEEPSEEK_ACP_WORKSPACE_ROOT: "/srv/cvg-workspace",
    CVG_DEEPSEEK_ACP_MANIFEST_PATH: "/srv/dsh-home/profiles/acp/package.json",
    CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "0000000000000000000000000000000000000000",
    CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION: "sha256:approved",
    CVG_DEEPSEEK_ACP_PERMISSION_MODE: "read-only"
  });
  assert.equal(config.deepseekAcpCommand, "node");
  assert.equal(config.deepseekAcpPermissionMode, "read-only");
  assert.equal(config.deepseekRuntimeEnabled, false);
  assert.throws(() => loadCvgConfig({ CVG_DEEPSEEK_ACP_PERMISSION_MODE: "workspace-write" }), (error: unknown) => error instanceof ConfigError);
});

test("local rate limiting is bounded and production requires a distributed seam", async () => {
  const limiter = new MemoryRateLimiter(2);
  assert.equal((await limiter.consume({ key: "route:test", limit: 2, windowMs: 60_000 })).allowed, true);
  assert.equal((await limiter.consume({ key: "route:test", limit: 2, windowMs: 60_000 })).allowed, true);
  const blocked = await limiter.consume({ key: "route:test", limit: 2, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.throws(() => loadCvgConfig({ NODE_ENV: "production", CVG_DEMO_MODE: "false", CVG_WEB_ORIGIN: "https://example.test", CVG_STORAGE: "postgres", CVG_SECRET_PROVIDER: "file", CVG_AUTH_MFA_MODE: "required", CVG_DEEPSEEK_RUNTIME_ENABLED: "true", CVG_DEEPSEEK_BASE_URL: "https://harness.example.test", CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "0000000000000000000000000000000000000000", CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION: "approved", CVG_DEEPSEEK_BEARER_TOKEN_REF: "harness.token", CVG_RATE_LIMIT_BACKEND: "local" }), (error: unknown) => error instanceof ConfigError);
});

test("production runtime rejects injected synthetic dependencies while preserving explicit authority seams", () => {
  assert.throws(
    () => assertProductionRuntimeOverrides("production", { store: {} as CvgStore }),
    (error: unknown) => error instanceof Error && /dependências injetadas/.test(error.message)
  );
  assert.throws(
    () => assertProductionRuntimeOverrides("production", { agentRuntime: {} as never }),
    (error: unknown) => error instanceof Error && /agentRuntime/.test(error.message)
  );
  assert.doesNotThrow(() => assertProductionRuntimeOverrides("production", { breakGlassWebAuthnAuthority: {} as never, breakGlassScopeAuthority: {} as never }));
  assert.doesNotThrow(() => assertProductionRuntimeOverrides("test", { store: {} as CvgStore, agentRuntime: {} as never }));
});

test("default runtime registers the complete tool catalog", async () => {
  const releaseSha = "0123456789abcdef0123456789abcdef01234567";
  const releaseArtifactDigest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const runtime = await createRuntime({ store: new CvgStore({ bootstrapPassword: "synthetic-password-123" }), config: { nodeEnv: "test", host: "127.0.0.1", port: 4310, webOrigin: "http://127.0.0.1:5173", releaseSha, releaseArtifactDigest, storageMode: "memory", demoMode: true } });
  const health = await runtime.agentRuntime.health();
  assert.equal(health.status, "READY");
  assert.equal(health.capabilities.toolNames.length, 6);
  const ready = await runtime.app.inject({ method: "GET", url: "/api/v1/ready" });
  assert.equal(ready.headers["x-cvg-release-sha"], releaseSha);
  assert.equal(ready.headers["x-cvg-release-artifact-digest"], releaseArtifactDigest);
  await runtime.app.close();
});

test("tool gateway reports an unknown outcome when an executor exceeds its deadline", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = contextFor(store, "timeout.test");
  const gateway = new ToolGateway(new StaticPolicyDecisionPoint(context.policyRevision), new InMemoryToolExecutionLedger());
  gateway.register({ name: "cvg.agenda.read", version: "1.0.0", description: "timeout fixture", operation: "appointments.read", capability: "appointments:read", risk: "LOW", approvalMode: "NONE", allowedRoles: ["admin", "veterinario", "recepcao"], acceptedDataClasses: ["D2"], scope: "WORKSPACE", resourceRequired: false, requiresApproval: false, idempotency: "REQUIRED", auditAction: "appointments.read", secretRefs: [], timeoutMs: 100, egress: "LOCAL_ONLY", parseInput: (value: unknown) => value });
  await assert.rejects(() => gateway.execute("cvg.agenda.read", { context, sessionId: context.sessionId!, resource: { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, resourceId: null, dataClass: "D2" }, input: {}, idempotencyKey: "timeout-1" }, async (_input, signal) => new Promise<boolean>((resolve) => setTimeout(() => resolve(signal.aborted), 500))), (error: unknown) => error instanceof ToolGatewayError && error.code === "OUTCOME_UNKNOWN");
});

test("secret providers resolve only approved references", async () => {
  const provider = new EnvironmentSecretProvider({ CVG_SECRET_DEEPSEEK_GATEWAY_TOKEN: "synthetic-only-secret" });
  assert.equal(provider.status(), "READY");
  assert.equal(provider.has("deepseek.gateway.token"), true);
  assert.equal(await provider.resolve?.("deepseek.gateway.token"), "synthetic-only-secret");
  assert.equal(provider.has("../escape"), false);
});

test("web runtime state machine never grants writes during reconnect or context loss", () => {
  const initial: RuntimeSnapshot = { state: RUNTIME_STATES.ONLINE, reconnectVersion: 0 };
  const offline = runtimeStateReducer(initial, { type: "NETWORK_OFFLINE" });
  assert.equal(offline.state, RUNTIME_STATES.OFFLINE_READ_ONLY);
  assert.equal(isWriteAllowed(offline.state), false);
  assert.equal(canRenderContextData(offline.state), false);

  const reconnecting = runtimeStateReducer(offline, { type: "NETWORK_ONLINE" });
  assert.equal(reconnecting.state, RUNTIME_STATES.REVALIDATING);
  assert.equal(reconnecting.reconnectVersion, 1);
  assert.equal(isWriteAllowed(reconnecting.state), false);
  assert.equal(canRenderContextData(reconnecting.state), false);

  const degraded = runtimeStateReducer(initial, { type: "REQUEST_DEGRADED", reason: "API indisponível" });
  const retrying = runtimeStateReducer(degraded, { type: "NETWORK_ONLINE" });
  assert.equal(retrying.state, RUNTIME_STATES.REVALIDATING);
  assert.equal(retrying.reconnectVersion, 1);
  assert.equal(isWriteAllowed(retrying.state), false);
  assert.equal(canRenderContextData(retrying.state), false);

  const invalid = runtimeStateReducer(reconnecting, { type: "CONTEXT_INVALIDATED", reason: "scope changed" });
  assert.equal(invalid.state, RUNTIME_STATES.CONTEXT_INVALID);
  assert.equal(isWriteAllowed(invalid.state), false);
  const reauthenticated = runtimeStateReducer(invalid, { type: "SESSION_VALIDATED" });
  assert.equal(reauthenticated.state, RUNTIME_STATES.ONLINE);
  assert.equal(isWriteAllowed(reauthenticated.state), true);
});

test("context authorization failures force a safe revalidation boundary", () => {
  const initial: RuntimeSnapshot = { state: RUNTIME_STATES.ONLINE, reconnectVersion: 2 };
  const forbidden = new ApiError("forbidden", { status: 403, code: "FORBIDDEN", correlationId: "corr-1", details: null });
  assert.equal(isPermissionDeniedError(forbidden), true);
  assert.equal(isContextRevalidationError(forbidden), false);
  assert.equal(isContextRevalidationError(new ApiError("conflict", { status: 409, code: "CONFLICT", correlationId: "corr-2", details: null })), false);
  assert.equal(isContextRevalidationError(new ApiError("policy", { status: 400, code: "POLICY_DENIED", correlationId: "corr-3", details: null })), true);
  assert.equal(isStaleDataError(new ApiError("revision", { status: 409, code: "REVISION_CONFLICT", correlationId: "corr-4", details: null })), true);
  const revalidating = runtimeStateReducer(initial, { type: "REQUEST_REVALIDATION", reason: "context authority changed" });
  assert.equal(revalidating.state, RUNTIME_STATES.REVALIDATING);
  assert.equal(revalidating.reconnectVersion, 3);
  assert.equal(runtimeStateReducer(revalidating, { type: "REQUEST_REVALIDATION", reason: "duplicate" }), revalidating);
  const blocked = runtimeStateReducer(revalidating, { type: "CONTEXT_INVALIDATED", reason: "revalidation failed" });
  assert.equal(runtimeStateReducer(blocked, { type: "REQUEST_REVALIDATION", reason: "retry later" }), blocked);
});

test("permission and stale states remain stable until an explicit retry", () => {
  const initial: RuntimeSnapshot = { state: RUNTIME_STATES.ONLINE, reconnectVersion: 2 };
  const denied = runtimeStateReducer(initial, { type: "REQUEST_PERMISSION_DENIED", reason: "role not allowed" });
  assert.equal(denied.state, RUNTIME_STATES.PERMISSION_DENIED);
  assert.equal(isWriteAllowed(denied.state), false);
  assert.equal(canRenderContextData(denied.state), false);
  const stale = runtimeStateReducer(initial, { type: "REQUEST_STALE", reason: "revision changed" });
  assert.equal(stale.state, RUNTIME_STATES.STALE);
  assert.equal(runtimeStateReducer(denied, { type: "REQUEST_PERMISSION_DENIED", reason: "same denial" }), denied);
  const retry = runtimeStateReducer(denied, { type: "NETWORK_ONLINE" });
  assert.equal(retry.state, RUNTIME_STATES.REVALIDATING);
  assert.equal(retry.reconnectVersion, 3);
  assert.equal(runtimeStateReducer(stale, { type: "NETWORK_ONLINE" }).state, RUNTIME_STATES.REVALIDATING);
});

test("initial authentication failure remains a login state instead of a session-expired state", async () => {
  const originalFetch = globalThis.fetch;
  let failures = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ schemaVersion: 1, error: { code: "UNAUTHENTICATED", message: "É necessário iniciar uma sessão." }, correlationId: "initial-auth" }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    const client = createApiClient(() => RUNTIME_STATES.ONLINE, () => { failures += 1; });
    await assert.rejects(() => client.get("/me"), (error: unknown) => error instanceof ApiError && error.status === 401);
    assert.equal(failures, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
