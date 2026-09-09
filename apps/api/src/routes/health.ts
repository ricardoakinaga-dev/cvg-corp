import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { success, type ApiResponse } from "@cvg/contracts";
import type { CvgStore } from "@cvg/domain";
import type { AgentRuntime } from "@cvg/agent-runtime";
import type { PostgresPersistence } from "@cvg/persistence";
import type { SecretProviderStatus } from "@cvg/integrations";

export interface HealthRouteDependencies {
  store: CvgStore;
  persistence: PostgresPersistence | null;
  agentRuntime: AgentRuntime;
  secretProviderStatus: SecretProviderStatus;
  config: { demoMode: boolean; storageMode: "memory" | "postgres" };
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
    const agentHealth = await dependencies.agentRuntime.health();
    const checks = { database, policyStore: "READY" as const, secretProvider: dependencies.secretProviderStatus, agentRuntime: agentHealth.status, outbox: "NOT_CONFIGURED" as const, auditLedger: dependencies.persistence ? "READY" as const : "DEGRADED" as const };
    const ready = dependencies.store.healthStatus === "READY" && database !== "UNAVAILABLE" && checks.secretProvider !== "UNAVAILABLE" && checks.agentRuntime === "READY";
    return send(reply, success({ ready, status: dependencies.store.healthStatus, checks }, randomUUID()), ready ? 200 : 503);
  });
}
