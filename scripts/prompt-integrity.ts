import { createHash } from "node:crypto";

export const PROMPT_REFERENCE = "docs/prompt-final-operational-proof-2026-09-10.txt";
export const EXPECTED_PROMPT_SHA256 = "39dfbb610267b61854b972bf8513f6562b0ee374aa308f7a79b38d21f2cdeae3";

/**
 * The active prompt is the source of truth for phase numbering. Keep this
 * inventory beside the prompt binding so a frozen quality bar cannot silently
 * retain labels from an older prompt revision while reusing the new digest.
 */
export const EXPECTED_PROMPT_PHASES = [
  "F0-reauditoria-final", "F1-pdp-universal-de-verdade", "F2-authoritative-writes-universais", "F3-deepseek-harness-real", "F4-deepseek-failure-matrix", "F5-provider-externo-real", "F6-provider-chaos", "F7-durable-idempotency-sob-concorrencia", "F8-postgresql-multi-instance", "F9-worker-handlers-reais", "F10-backpressure", "F11-secret-authority-real", "F12-webauthn-break-glass-real", "F13-observability-staging", "F14-alert-delivery-real", "F15-slo-measurements", "F16-load-test-production-like", "F17-chaos-infra", "F18-recovery-real", "F19-rto-rpo", "F20-backup-operacional", "F21-full-browser-matrix", "F22-accessibility-real", "F23-security-red-team", "F24-db-security-red-team", "F25-audit-immutability", "F26-usage-settlement", "F27-export-hardening", "F28-ci-do-mesmo-sha", "F29-release-provenance", "F30-container-smoke-real", "F31-resource-pressure-test", "F32-security-headers-real", "F33-production-config-fail-closed", "F34-staging-promotion-model", "F35-runbook-execution", "F36-final-gauntlet", "F37-repair-loop", "F38-human-approval-gate"
] as const;

/**
 * The quality bar is itself a release input.  Checking only its phase labels
 * leaves the thresholds and fail-closed policy mutable while retaining the
 * same prompt digest.  Keep the policy literals here so every verifier uses
 * one immutable contract.
 */
export const EXPECTED_QUALITY_BAR_POLICY = {
  schema_version: 2,
  bar_id: "CVG-BAR-2026-09-11-FINAL-PROMPT",
  scope_ref: "CVG-FULL-STATE-OF-THE-ART",
  immutable: true,
  evidence_rules: {
    no_claim_without_executable_evidence: true,
    source_inspection_is_not_runtime_proof: true,
    synthetic_fixture_is_not_real_provider_or_production_proof: true,
    not_run_must_remain_not_run: true,
    same_sha_required_for_promotion: true,
    external_evidence_root_must_be_outside_source: true,
    human_approval_must_be_cryptographically_attested: true,
    gate_execution_artifact_required: true,
    independent_review_signature_required: true,
    red_team_f23_f24_must_be_separate: true,
    container_smoke_must_prove_shutdown_outbox_replay_restart: true,
    ci_results_must_be_bound_with_sbom: true
  },
  scorecard: {
    scale: "0-100",
    minimum_candidate: 95,
    overall_threshold: 97,
    dimension_thresholds: {
      architecture: 97,
      domainIntegrity: 97,
      security: 97,
      authentication: 97,
      authorization: 97,
      pdp: 97,
      toolGateway: 97,
      database: 97,
      reliability: 97,
      workers: 96,
      deepseek: 95,
      aiGovernance: 97,
      providerIntegration: 95,
      frontend: 95,
      accessibility: 95,
      testing: 97,
      observability: 95,
      performance: 95,
      recovery: 97,
      devOps: 96,
      supplyChain: 95,
      productionReadiness: 95
    },
    partial_or_not_run_is_not_pass: true
  },
  aaa_policy: {
    eligible_only_if: ["all_required_phases_pass", "all_dimensions_meet_threshold", "overall_meets_threshold", "zero_hard_blockers", "fresh_independent_review", "human_approval_attested"],
    otherwise: "FAIL_WITH_LIMITATIONS"
  }
} as const;

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
};

export function qualityBarPhaseInventoryValid(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const bar = value as Record<string, unknown>;
  const source = bar.source;
  if (typeof source !== "object" || source === null || Array.isArray(source)) return false;
  const sourceRecord = source as Record<string, unknown>;
  const phaseRange = sourceRecord.phase_range;
  if (typeof phaseRange !== "object" || phaseRange === null || Array.isArray(phaseRange)) return false;
  const range = phaseRange as Record<string, unknown>;
  if (sourceRecord.prompt !== PROMPT_REFERENCE
    || sourceRecord.prompt_sha256 !== EXPECTED_PROMPT_SHA256
    || range.first !== 0
    || range.last !== EXPECTED_PROMPT_PHASES.length - 1
    || range.required !== true
    || !Array.isArray(bar.required_phases)
    || bar.required_phases.length !== EXPECTED_PROMPT_PHASES.length
    || !bar.required_phases.every((phase, index) => phase === EXPECTED_PROMPT_PHASES[index])) return false;

  const policy = {
    schema_version: bar.schema_version,
    bar_id: bar.bar_id,
    scope_ref: bar.scope_ref,
    immutable: bar.immutable,
    evidence_rules: bar.evidence_rules,
    scorecard: bar.scorecard,
    aaa_policy: bar.aaa_policy
  };
  const expectedPolicy = {
    schema_version: EXPECTED_QUALITY_BAR_POLICY.schema_version,
    bar_id: EXPECTED_QUALITY_BAR_POLICY.bar_id,
    scope_ref: EXPECTED_QUALITY_BAR_POLICY.scope_ref,
    immutable: EXPECTED_QUALITY_BAR_POLICY.immutable,
    evidence_rules: EXPECTED_QUALITY_BAR_POLICY.evidence_rules,
    scorecard: EXPECTED_QUALITY_BAR_POLICY.scorecard,
    aaa_policy: EXPECTED_QUALITY_BAR_POLICY.aaa_policy
  };
  return canonical(policy) === canonical(expectedPolicy);
}

export function promptSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function promptIntegrityValid(content: string | Buffer): boolean {
  return promptSha256(content) === EXPECTED_PROMPT_SHA256;
}
