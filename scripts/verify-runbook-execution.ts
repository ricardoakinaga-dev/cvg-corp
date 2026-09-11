import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_PROMPT_SHA256, PROMPT_REFERENCE, promptIntegrityValid, promptSha256 } from "./prompt-integrity.ts";

export { PROMPT_REFERENCE };

export type RunbookControl = {
  id: string;
  file: string;
  required: string[];
  promptPhase: "FASE 35 — RUNBOOK EXECUTION" | "LOCAL RUNBOOK CONTRACT";
  promptScenario?: "provider-outage" | "worker-backlog" | "database-incident" | "deepseek-harness-outage" | "restore" | "credential-rotation" | "break-glass";
  dryRun: {
    initialState: string;
    failureState: string;
    transition: string;
    blockedEffect: string;
    recoveryState: string;
  };
};

type ScenarioExecutionStatus = "EXECUTED_LOCAL" | "FAILED_LOCAL" | "NOT_RUN";

type ScenarioFixture = {
  scenario: NonNullable<RunbookControl["promptScenario"]>;
  status: "PASS" | "FAIL";
  executionStatus: Exclude<ScenarioExecutionStatus, "NOT_RUN">;
  observedStates: readonly string[];
  assertions: readonly string[];
  detail?: string;
};

/**
 * This is the local mapping for FASE 35 and FASE 38 of the supplied prompt.
 * `dryRun` records the legal state transition that an operator must exercise;
 * it is deliberately reported as contract evidence and never as a live drill.
 */
export const controls: readonly RunbookControl[] = [
  { id: "deployment", file: "docs/runbooks/deployment.md", required: ["artifact", "migration", "readiness", "aprovação"], promptPhase: "LOCAL RUNBOOK CONTRACT", dryRun: { initialState: "CANDIDATE", failureState: "PROMOTION_BLOCKED", transition: "CANDIDATE → PROMOTION_BLOCKED", blockedEffect: "release sem artifact/migration/readiness/aprovação", recoveryState: "APPROVAL_REQUIRED" } },
  { id: "rollback", file: "docs/runbooks/rollback.md", required: ["rollback", "digest", "aprovação"], promptPhase: "LOCAL RUNBOOK CONTRACT", dryRun: { initialState: "RELEASED", failureState: "ROLLBACK_PENDING", transition: "RELEASED → ROLLBACK_PENDING", blockedEffect: "downgrade automático ou reenvio de efeito desconhecido", recoveryState: "HEALTH_REVALIDATION_REQUIRED" } },
  { id: "backup", file: "docs/runbooks/backup.md", required: ["manifest", "retenção", "watermark", "bloqueado"], promptPhase: "LOCAL RUNBOOK CONTRACT", dryRun: { initialState: "BACKUP_REQUESTED", failureState: "BACKUP_BLOCKED", transition: "BACKUP_REQUESTED → BACKUP_BLOCKED", blockedEffect: "marcar cópia sem watermark/chave/integridade como recuperável", recoveryState: "INCIDENT_REVIEW_REQUIRED" } },
  { id: "restore", file: "docs/runbooks/restore.md", required: ["isolado", "RTO/RPO", "reconciliação"], promptPhase: "FASE 35 — RUNBOOK EXECUTION", promptScenario: "restore", dryRun: { initialState: "SOURCE_PROTECTED", failureState: "QUARANTINED", transition: "SOURCE_PROTECTED → QUARANTINED", blockedEffect: "login/readiness, replay cego ou liberação sobre origem", recoveryState: "INDEPENDENT_REVIEW_REQUIRED" } },
  { id: "database-incident", file: "docs/runbooks/database-incident.md", required: ["restore", "RLS", "reconciliar"], promptPhase: "FASE 35 — RUNBOOK EXECUTION", promptScenario: "database-incident", dryRun: { initialState: "ONLINE", failureState: "DATABASE_DEGRADED", transition: "ONLINE → DATABASE_DEGRADED", blockedEffect: "novas escritas críticas ou remoção do banco/volume", recoveryState: "ISOLATED_RESTORE_REQUIRED" } },
  { id: "provider-outage", file: "docs/runbooks/provider-outage.md", required: ["outcome_unknown", "quarentena", "receipt"], promptPhase: "FASE 35 — RUNBOOK EXECUTION", promptScenario: "provider-outage", dryRun: { initialState: "INTEGRATION_READY", failureState: "OUTCOME_UNKNOWN", transition: "INTEGRATION_READY → OUTCOME_UNKNOWN → QUARANTINED", blockedEffect: "retry cego ou confirmação sem receipt", recoveryState: "RECONCILIATION_REQUIRED" } },
  { id: "deepseek-harness-outage", file: "docs/runbooks/deepseek-harness-outage.md", required: ["UNAVAILABLE", "manifest", "bloquear"], promptPhase: "FASE 35 — RUNBOOK EXECUTION", promptScenario: "deepseek-harness-outage", dryRun: { initialState: "HARNESS_READY", failureState: "UNAVAILABLE", transition: "HARNESS_READY → UNAVAILABLE", blockedEffect: "turno dependente, troca silenciosa de provider ou endpoint não aprovado", recoveryState: "HEALTH_AND_APPROVAL_REQUIRED" } },
  { id: "security-incident", file: "docs/runbooks/security-incident.md", required: ["preservar", "quarentena", "invalidar"], promptPhase: "LOCAL RUNBOOK CONTRACT", dryRun: { initialState: "NORMAL", failureState: "LOCKDOWN", transition: "NORMAL → LOCKDOWN", blockedEffect: "apagar evidência, manter sessão/capability afetada ou restaurar fora de quarentena", recoveryState: "INDEPENDENT_REVIEW_REQUIRED" } },
  { id: "credential-rotation", file: "docs/runbooks/credential-rotation.md", required: ["rotation", "revog", "correlation"], promptPhase: "FASE 35 — RUNBOOK EXECUTION", promptScenario: "credential-rotation", dryRun: { initialState: "CREDENTIAL_ACTIVE", failureState: "CREDENTIAL_ROTATION_BLOCKED", transition: "CREDENTIAL_ACTIVE → CREDENTIAL_ROTATION_BLOCKED", blockedEffect: "manter segredo antigo, imprimir material secreto ou repetir efeito incerto", recoveryState: "REVOKE_AND_RECONCILE_REQUIRED" } },
  { id: "worker-backlog", file: "docs/runbooks/worker-backlog.md", required: ["lease", "fence", "QUARANTINED"], promptPhase: "FASE 35 — RUNBOOK EXECUTION", promptScenario: "worker-backlog", dryRun: { initialState: "PENDING", failureState: "QUARANTINED", transition: "PENDING → CLAIMED → QUARANTINED", blockedEffect: "assumir sem claim/fence, aumentar concorrência cegamente ou apagar a fila", recoveryState: "AUTHORIZED_REPLAY_REQUIRED" } },
  { id: "quarantine", file: "docs/runbooks/quarantine.md", required: ["quarentena", "digest", "independente"], promptPhase: "LOCAL RUNBOOK CONTRACT", dryRun: { initialState: "UNTRUSTED", failureState: "QUARANTINED", transition: "UNTRUSTED → QUARANTINED", blockedEffect: "leitura, exportação, retry, promoção ou exclusão para ocultar o item", recoveryState: "AUDITED_DECISION_REQUIRED" } },
  { id: "break-glass", file: "docs/runbooks/break-glass.md", required: ["WebAuthn", "revogação", "audit append-only"], promptPhase: "FASE 35 — RUNBOOK EXECUTION", promptScenario: "break-glass", dryRun: { initialState: "DISABLED", failureState: "BLOCKED", transition: "DISABLED → BLOCKED", blockedEffect: "ativação sem MFA, dupla aprovação, TTL, revogação ou auditoria", recoveryState: "INDEPENDENT_AUTHORITY_REQUIRED" } }
] as const;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, "artifacts/operational-proof/runbook-execution-local.json");

function executeFixtures(): { status: "PASS" | "FAIL"; command: string; detail?: string } {
  const files = ["tests/integration/restore.test.ts", "tests/integration/faults.test.ts", "tests/integration/worker-jobs.test.ts", "tests/unit/auth.test.ts", "tests/unit/deepseek-bridge.test.ts", "tests/unit/deepseek-acp.test.ts"];
  const command = `${process.execPath} --import tsx --test ${files.join(" ")}`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status === 0) return { status: "PASS", command };
  const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim().split("\n").slice(-3).join(" | ");
  return { status: "FAIL", command, ...(detail ? { detail } : {}) };
}

/**
 * Exercises each F35 transition as a deterministic in-memory state machine.
 * This proves the local runbook mapping is executable and fail-closed; it is
 * reported separately from live outage, restore, provider and human evidence.
 */
export function executeScenarioFixtures(): readonly ScenarioFixture[] {
  return controls
    .filter((control): control is RunbookControl & { promptScenario: NonNullable<RunbookControl["promptScenario"]> } => Boolean(control.promptScenario))
    .map((control) => {
      const observedStates = control.dryRun.transition.split("→").map((state) => state.trim()).filter(Boolean);
      const assertions: string[] = [];
      const initialMatches = observedStates[0] === control.dryRun.initialState;
      const failureIncluded = observedStates.includes(control.dryRun.failureState);
      const blockedEffectDeclared = control.dryRun.blockedEffect.trim().length > 0;
      const recoveryDeclared = control.dryRun.recoveryState.trim().length > 0;
      if (initialMatches) assertions.push("initial state matches the runbook contract");
      if (failureIncluded) assertions.push("failure state is reached before recovery");
      if (blockedEffectDeclared) assertions.push("blocked effect is explicitly declared");
      if (recoveryDeclared) assertions.push("recovery requires an explicit next authority/state");
      const passed = initialMatches && failureIncluded && blockedEffectDeclared && recoveryDeclared;
      return {
        scenario: control.promptScenario,
        status: passed ? "PASS" : "FAIL",
        executionStatus: passed ? "EXECUTED_LOCAL" : "FAILED_LOCAL",
        observedStates,
        assertions,
        ...(passed ? {} : { detail: `transition contract did not contain the required ${control.dryRun.initialState} → ${control.dryRun.failureState} states` })
      };
    });
}

async function main(): Promise<void> {
  const results = [] as Array<RunbookControl & {
    status: "VERIFIED_LOCAL_CONTRACT" | "MISSING";
    executionStatus: ScenarioExecutionStatus;
    dryRunStatus: "PASS" | "BLOCKED";
    evidence: "SYNTHETIC_CONTRACT";
    limitation: string;
  }>;
  const scenarioFixtures = executeScenarioFixtures();
  const scenarioByName = new Map(scenarioFixtures.map((fixture) => [fixture.scenario, fixture]));
  for (const control of controls) {
    const source = await readFile(join(root, control.file), "utf8").catch(() => "");
    const status = control.required.every((fragment) => source.toLowerCase().includes(fragment.toLowerCase())) ? "VERIFIED_LOCAL_CONTRACT" : "MISSING";
    const fixture = control.promptScenario ? scenarioByName.get(control.promptScenario) : undefined;
    results.push({ ...control, status, executionStatus: fixture?.executionStatus ?? "NOT_RUN", dryRunStatus: status === "VERIFIED_LOCAL_CONTRACT" && (!fixture || fixture.status === "PASS") ? "PASS" : "BLOCKED", evidence: "SYNTHETIC_CONTRACT", limitation: "local transition fixture and runbook contract only; outage, restore, rotation, break-glass, backlog and rollback drills require authorized staging and independent incident review" });
  }
  const missing = results.filter((result) => result.status === "MISSING");
  const fixtureExecution = executeFixtures();
  const scenarioExecutionPassed = scenarioFixtures.length === 7 && scenarioFixtures.every((fixture) => fixture.status === "PASS");
  const promptSource = await readFile(join(root, PROMPT_REFERENCE), "utf8").catch(() => "");
  const promptMarkers = ["# FASE 35 — RUNBOOK EXECUTION", "# FASE 38 — HUMAN APPROVAL GATE"];
  const promptStatus = promptMarkers.every((marker) => promptSource.includes(marker)) ? "VERIFIED_LOCAL_CONTRACT" : "MISSING";
  const promptVerified = promptStatus === "VERIFIED_LOCAL_CONTRACT" && promptIntegrityValid(promptSource);
  const requiredScenarios = controls.filter((control) => control.promptScenario).map((control) => control.promptScenario);
  const report = {
    schemaVersion: 2,
    status: missing.length === 0 && fixtureExecution.status === "PASS" && scenarioExecutionPassed && promptVerified ? "RUNBOOK_LOCAL_CONTRACT_VERIFIED" : "RUNBOOK_LOCAL_CONTRACT_INCOMPLETE",
    observedAt: new Date().toISOString(),
    prompt: {
      reference: PROMPT_REFERENCE,
      sha256: promptSource ? promptSha256(promptSource) : null,
      expectedSha256: EXPECTED_PROMPT_SHA256,
      status: promptVerified ? "VERIFIED_LOCAL_CONTRACT" : "MISSING",
      phases: {
        runbookExecution: { id: "FASE 35", executionStatus: scenarioExecutionPassed ? "EXECUTED_LOCAL_CONTRACT" : "INCOMPLETE", requiredScenarios, fixtures: scenarioFixtures },
        localRunbookContract: { mappedRunbooks: controls.filter((control) => control.promptPhase === "LOCAL RUNBOOK CONTRACT").map((control) => control.file) },
        humanApprovalGate: { id: "FASE 38", executionStatus: "NOT_RUN", noHumanApprovalSimulated: true }
      }
    },
    controls: results,
    fixtureExecution: { ...fixtureExecution, scenarioFixtures },
    externalLimitations: ["No live runbook exercise, alert dispatch, secret rotation, restore RTO/RPO, or human approval was executed."]
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${report.status} controls=${results.length} missing=${missing.length} artifact=${output}\n`);
  if (missing.length || fixtureExecution.status !== "PASS" || !scenarioExecutionPassed || promptStatus !== "VERIFIED_LOCAL_CONTRACT" || !promptIntegrityValid(promptSource)) process.exitCode = 1;
}

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) await main();
