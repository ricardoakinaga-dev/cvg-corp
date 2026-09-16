import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { success, type ApiResponse } from "@cvg/contracts";
import type { CvgStore } from "@cvg/domain";
import type { AgentRuntime } from "@cvg/agent-runtime";
import type { PostgresPersistence } from "@cvg/persistence";
import type { SecretProviderStatus } from "@cvg/integrations";

export type HealthDependencyStatus = SecretProviderStatus | "NOT_REQUIRED";

export interface HealthRouteDependencies {
  store: CvgStore;
  persistence: PostgresPersistence | null;
  agentRuntime: AgentRuntime;
  secretProviderStatus: SecretProviderStatus;
  authMfaStatus: HealthDependencyStatus;
  deepseekBearerTokenStatus: HealthDependencyStatus;
  deepseekContextSignatureStatus: HealthDependencyStatus;
  secretProviderRequired: boolean;
  config: { demoMode: boolean; storageMode: "memory" | "postgres" };
  /** Dynamic probes prevent a startup snapshot from masquerading as readiness. */
  probes?: {
    secretProviderStatus?: () => SecretProviderStatus | Promise<SecretProviderStatus>;
    authMfaStatus?: () => HealthDependencyStatus | Promise<HealthDependencyStatus>;
    deepseekBearerTokenStatus?: () => HealthDependencyStatus | Promise<HealthDependencyStatus>;
    deepseekContextSignatureStatus?: () => HealthDependencyStatus | Promise<HealthDependencyStatus>;
    policyStoreStatus?: () => "READY" | "UNAVAILABLE" | "DEGRADED" | Promise<"READY" | "UNAVAILABLE" | "DEGRADED">;
  };
  operationalMetrics?: {
    readInternal(organizationId: string): Promise<{ queueSignals: { outboxDepth: number; oldestAgeMs: number; poisonMessages: number; reconciliationLag: number; workerHeartbeatAgeMs: number; workerHeartbeatCount: number }; outboxDependency: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" }>;
  };
}

function send<T>(reply: FastifyReply, payload: ApiResponse<T>, statusCode = 200): FastifyReply {
  return reply.code(statusCode).send(payload);
}

/** Liveness/readiness is isolated from business routes and checks every dependency used for admission. */
export async function registerHealthRoutes(app: FastifyInstance, dependencies: HealthRouteDependencies): Promise<void> {
  app.get("/api/v1/health", async (_request, reply) => send(reply, success({
    live: true,
    status: dependencies.store.healthStatus,
    capabilities: {
      demoOnly: dependencies.config.demoMode && dependencies.config.storageMode === "memory",
      realProvidersBlocked: dependencies.config.demoMode,
      realDataBlocked: true
    }
  }, randomUUID())));

  app.get("/api/v1/ready", async (_request, reply) => {
    let database: "READY" | "NOT_CONFIGURED" | "UNAVAILABLE" = dependencies.persistence ? "READY" : "NOT_CONFIGURED";
    if (dependencies.persistence) {
      try { await dependencies.persistence.check(); } catch { database = "UNAVAILABLE"; }
    }
    const [secretProvider, authMfa, deepseekBearerToken, deepseekContextSignature, policyStore] = await Promise.all([
      dependencies.probes?.secretProviderStatus?.() ?? dependencies.secretProviderStatus,
      dependencies.probes?.authMfaStatus?.() ?? dependencies.authMfaStatus,
      dependencies.probes?.deepseekBearerTokenStatus?.() ?? dependencies.deepseekBearerTokenStatus,
      dependencies.probes?.deepseekContextSignatureStatus?.() ?? dependencies.deepseekContextSignatureStatus,
      dependencies.probes?.policyStoreStatus?.() ?? "READY"
    ]);
    const agentHealth = await dependencies.agentRuntime.health();
    let outbox: "READY" | "UNAVAILABLE" | "NOT_CONFIGURED" = dependencies.persistence ? "UNAVAILABLE" : "NOT_CONFIGURED";
    let queueSignals = { outboxDepth: 0, oldestAgeMs: 0, poisonMessages: 0, reconciliationLag: 0, workerHeartbeatAgeMs: 0, workerHeartbeatCount: 0 };
    if (dependencies.operationalMetrics) {
      try {
        const operational = await dependencies.operationalMetrics.readInternal(dependencies.store.bootstrapCredentials.organizationId);
        outbox = operational.outboxDependency;
        queueSignals = operational.queueSignals;
      } catch {
        outbox = dependencies.persistence ? "UNAVAILABLE" : "NOT_CONFIGURED";
      }
    }
    const checks = {
      database,
      policyStore,
      secretProvider,
      secretReferences: { deepseekBearerToken, deepseekContextSignature },
      authMfa,
      agentRuntime: agentHealth.status,
      outbox,
      auditLedger: dependencies.persistence && database === "READY" ? "READY" as const : dependencies.persistence ? "UNAVAILABLE" as const : "DEGRADED" as const,
      queue: queueSignals
    };
    const demoOnly = dependencies.config.demoMode && dependencies.config.storageMode === "memory";
    // Memory runtimes are valid only as explicit local/test boundaries. They
    // report NOT_CONFIGURED/DEGRADED rather than READY, but those states do
    // not become failures until a durable dependency was actually configured;
    // an unavailable configured dependency always blocks readiness.
    const persistenceReady = checks.database !== "UNAVAILABLE";
    const outboxReady = checks.outbox !== "UNAVAILABLE";
    const auditReady = checks.auditLedger !== "UNAVAILABLE";
    const providerReady = !dependencies.secretProviderRequired || checks.secretProvider === "READY" || demoOnly;
    const referencesReady = Object.values(checks.secretReferences).every((status) => status === "READY" || status === "NOT_REQUIRED");
    const mfaReady = checks.authMfa === "READY" || checks.authMfa === "NOT_REQUIRED";
    // AI availability is reported but never gates core readiness: a model or
    // runtime outage degrades the assistant, not the hospital.
    const ready = dependencies.store.healthStatus === "READY" && persistenceReady && outboxReady && auditReady && checks.policyStore === "READY" && providerReady && referencesReady && mfaReady;
    const aiDegraded = checks.agentRuntime !== "READY";
    return send(reply, success({ ready, status: dependencies.store.healthStatus, checks, ai: { status: checks.agentRuntime, degraded: aiDegraded } }, randomUUID()), ready ? 200 : 503);
  });

  app.get("/api/v1/ai/ready", async (_request, reply) => {
    const agentHealth = await dependencies.agentRuntime.health();
    const ready = agentHealth.status === "READY";
    const aiState = ready ? "READY" : agentHealth.status === "DISABLED" ? "DISABLED" : "AI_DEGRADED";
    return send(reply, success({
      ready,
      aiState,
      status: agentHealth.status,
      reason: agentHealth.reason,
      checkedAt: agentHealth.checkedAt,
      capabilities: agentHealth.capabilities
    }, randomUUID()), ready ? 200 : 503);
  });
}
