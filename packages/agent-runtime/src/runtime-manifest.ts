import { createHash } from "node:crypto";

/**
 * Versioned AgentRuntime contract and deterministic runtime manifest.  The
 * manifest digest enters provenance so a replay can never claim equivalence to
 * a different runtime without evidence.
 */

export const AGENT_RUNTIME_CONTRACT_VERSION = "AgentRuntimeContract/v1";
export const SUPPORTED_AGENT_RUNTIME_CONTRACTS = [AGENT_RUNTIME_CONTRACT_VERSION] as const;

export interface RuntimeCompatibilityMatrix {
  cvgProductVersion: string;
  agentRuntimeContract: string;
  pluginApiVersion: string;
  skillSchemaVersion: string;
  toolSchemaVersion: string;
  modelProviderVersion: string;
}

export interface RuntimeManifest {
  runtimeVersion: string;
  runtimeCommit: string;
  agentContractVersion: string;
  pluginApiVersion: string;
  skillSchemaVersion: string;
  toolRegistryDigest: string;
  policyRevision: string;
  supportedModelProviders: readonly string[];
}

export function runtimeManifestDigest(manifest: RuntimeManifest): string {
  const canonical = {
    runtimeVersion: manifest.runtimeVersion,
    runtimeCommit: manifest.runtimeCommit,
    agentContractVersion: manifest.agentContractVersion,
    pluginApiVersion: manifest.pluginApiVersion,
    skillSchemaVersion: manifest.skillSchemaVersion,
    toolRegistryDigest: manifest.toolRegistryDigest,
    policyRevision: manifest.policyRevision,
    supportedModelProviders: [...manifest.supportedModelProviders].sort()
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function runtimeCompatibilitySupported(matrix: RuntimeCompatibilityMatrix, supported: { agentContract: readonly string[]; pluginApi: readonly string[]; skillSchema: readonly string[] }): boolean {
  return supported.agentContract.includes(matrix.agentRuntimeContract) && supported.pluginApi.includes(matrix.pluginApiVersion) && supported.skillSchema.includes(matrix.skillSchemaVersion);
}

export type ReplayEquivalence = "EXACT_REPLAY" | "COMPATIBLE_REPLAY" | "NON_EQUIVALENT_REPLAY";

export function classifyReplay(recorded: { runtimeVersion: string; manifestDigest: string }, current: { runtimeVersion: string; manifestDigest: string; agentContractVersion: string }, recordedContractVersion: string): ReplayEquivalence {
  if (recorded.manifestDigest === current.manifestDigest && recorded.runtimeVersion === current.runtimeVersion) return "EXACT_REPLAY";
  if (recordedContractVersion === current.agentContractVersion) return "COMPATIBLE_REPLAY";
  return "NON_EQUIVALENT_REPLAY";
}

/**
 * Builds the canonical AI usage settlement envelope.  Missing provider price
 * stays explicit (`null` / UNAVAILABLE) and is never treated as zero cost.
 */
export function buildAiUsageSettlement(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  providerResponseDigest: string | null;
  estimatedCostMicros: number | null;
  actualCostMicros: number | null;
  currency: string | null;
  costSource: "PROVIDER" | "LOCAL_SYNTHETIC" | "UNAVAILABLE";
  pricingRevision: string | null;
  discrepancy: "NOT_EVALUATED" | "MATCHED" | "MISMATCH";
  discrepancyDeltaMicros: number | null;
  discrepancyReason: string | null;
}): {
  model: string;
  inputTokens: number;
  outputTokens: number;
  providerResponseDigest: string | null;
  estimatedCost: { amountMicros: number | null; currency: string | null; source: "PROVIDER" | "LOCAL_SYNTHETIC" | "UNAVAILABLE"; pricingRevision: string | null };
  actualCost: { amountMicros: number | null; currency: string | null; source: "PROVIDER" | "LOCAL_SYNTHETIC" | "UNAVAILABLE"; pricingRevision: string | null };
  discrepancy: { status: "NOT_EVALUATED" | "MATCHED" | "MISMATCH"; deltaMicros: number | null; reason: string | null };
} {
  const cost = { amountMicros: input.actualCostMicros, currency: input.currency, source: input.costSource, pricingRevision: input.pricingRevision };
  return {
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    providerResponseDigest: input.providerResponseDigest,
    estimatedCost: { amountMicros: input.estimatedCostMicros, currency: input.currency, source: input.costSource, pricingRevision: input.pricingRevision },
    actualCost: cost,
    discrepancy: { status: input.discrepancy, deltaMicros: input.discrepancyDeltaMicros, reason: input.discrepancyReason }
  };
}
