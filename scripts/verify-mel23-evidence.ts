import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubjectManifest } from "./subject-manifest.ts";
import { ALLOWED_STATUSES } from "./verify-control-plane.ts";
import { MEL23_CONTROL_PLANE_CAPTURE_PATH, validateControlPlaneCapture, type ControlPlaneCapture } from "./capture-mel23-control-plane.ts";

export const MEL23_TASK_STATUSES = [...ALLOWED_STATUSES, "PLANNED", "SUPERSEDED"] as const;

export const MEL23_EVIDENCE_STATES = [
  "BLOCKED_BY_DIRTY_WORKTREE", "BLOCKED_EXTERNAL", "BLOCKED_HUMAN_REVIEW", "HISTORICAL_SUBJECT_REBIND_ONLY",
  "IMPLEMENTED_UNVERIFIED", "PARTIAL_CLASSIFIED_NO_EXECUTION_PROOF", "PARTIAL_LOCAL_BROWSER_ENVIRONMENT",
  "PARTIAL_LOCAL_REAL", "PARTIAL_LOCAL_WITH_EXTERNAL_GAP", "PARTIAL_LOCAL_WITH_SEAMS_REMAINING", "PLANNED"
] as const;

export const MEL23_RECEIPT_RESULTS = ["PASS", "PARTIAL", "BLOCKED"] as const;

export interface Mel23Requirement {
  readonly id: string;
  readonly milestone: string;
  readonly target: string;
  readonly aud27_ids: readonly string[];
  readonly primary_aud27_id?: string;
  readonly coverage: string;
  readonly acceptance_additions?: readonly string[];
  readonly new_aud27_task?: boolean;
}

export interface Mel23Task {
  readonly id: string;
  readonly status?: string;
  readonly evidence_state?: string;
  readonly evidence_refs?: readonly string[];
  readonly next_action?: { readonly target?: string };
}

export interface Mel23CommandResult {
  readonly command?: string;
  readonly exit_status?: number | null;
  readonly expected_exit_status?: number;
  readonly observed?: string;
}

export interface Mel23Receipt {
  readonly id?: string;
  readonly timestamp?: string;
  readonly task?: string;
  readonly evidence_kind?: string;
  readonly environment?: string;
  readonly result?: string;
  readonly exit_status?: number | null;
  readonly command_results?: readonly Mel23CommandResult[];
  readonly evidence_artifacts?: readonly string[];
  readonly source_sha?: string;
  readonly candidate_fingerprint?: string | null;
  readonly observed_subject_fingerprint?: string;
  readonly freshness?: string;
  readonly mel23_ids?: readonly string[];
  readonly criterion_results?: Readonly<Record<string, (typeof MEL23_RECEIPT_RESULTS)[number]>>;
}

export interface Mel23EvidenceRow {
  readonly id: string;
  readonly milestone: string;
  readonly target: string;
  readonly coverage: string;
  readonly acceptance_additions: readonly string[];
  readonly aud27: readonly { id: string; status: string | null; evidence_state: string | null; implementation_targets: readonly string[] }[];
  readonly test_commands: readonly string[];
  readonly evidence_artifacts: readonly string[];
  readonly receipt_id: string | null;
  readonly environment: string | null;
  readonly result: string;
  readonly receipt_result: string;
  readonly fingerprint: string | null;
  readonly candidate_fingerprint: string | null;
  readonly fingerprint_status: string;
  readonly issues: readonly string[];
}

export interface Mel23EvidenceReport {
  readonly summary: { requirements: number; mapped: number; qualified: number; blocked: number };
  readonly rows: readonly Mel23EvidenceRow[];
  readonly global_issues: readonly string[];
}

export const MEL23_EVIDENCE_REPORT_PATH = "artifacts/operational-proof/mel23-evidence-matrix-current.json";
const REGISTERED_GAUNTLET_MATRIX_PATH = "artifacts/operational-proof/mel23-evidence-matrix.json";

export function resolveMel23EvidenceReportDestination(root: string, reportPath = MEL23_EVIDENCE_REPORT_PATH): string {
  const destination = resolve(root, reportPath);
  if (destination === resolve(root, REGISTERED_GAUNTLET_MATRIX_PATH)) {
    throw new Error(`refusing to overwrite registered Gauntlet evidence ${REGISTERED_GAUNTLET_MATRIX_PATH}; choose a new report path`);
  }
  return destination;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;

export function isCanonicalTaskStatus(value: unknown): value is (typeof MEL23_TASK_STATUSES)[number] {
  return typeof value === "string" && (MEL23_TASK_STATUSES as readonly string[]).includes(value);
}

export function validateStatusVocabularyDocument(content: string): string[] {
  const values = [
    ...MEL23_TASK_STATUSES,
    ...MEL23_EVIDENCE_STATES,
    ...MEL23_RECEIPT_RESULTS,
    "PROMOTION_BLOCKED", "PROMOTION_ELIGIBLE", "AAA_NOT_PROVEN"
  ];
  return values.filter((value) => !content.includes(`\`${value}\``)).map((value) => `status vocabulary document omits ${value}`);
}

export function validateMel23EvidenceMatrix(
  requirements: readonly Mel23Requirement[],
  tasks: readonly Mel23Task[],
  receipts: readonly Mel23Receipt[],
  currentSubject?: { readonly sourceSha: string; readonly fingerprint: string },
): Mel23EvidenceReport {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const globalIssues: string[] = [];
  if (taskById.size !== tasks.length) globalIssues.push("AUD27 backlog contains duplicate task IDs");
  for (const task of tasks) {
    if (!isCanonicalTaskStatus(task.status)) globalIssues.push(`${task.id} uses unknown task status ${String(task.status)}`);
    if (task.evidence_state && !(MEL23_EVIDENCE_STATES as readonly string[]).includes(task.evidence_state)) globalIssues.push(`${task.id} uses unknown evidence_state ${task.evidence_state}`);
    if (task.id.startsWith("MEL23-")) globalIssues.push(`${task.id} duplicates a MEL23 requirement as an active task`);
  }
  const requirementIds = requirements.map((requirement) => requirement.id);
  if (new Set(requirementIds).size !== requirementIds.length) globalIssues.push("crosswalk contains duplicate MEL23 requirement IDs");
  const rows: Mel23EvidenceRow[] = requirements.map((requirement) => {
    const issues: string[] = [];
    if (requirement.new_aud27_task !== false) issues.push("crosswalk must link to an existing AUD27 task instead of creating a duplicate task");
    if (!requirement.aud27_ids.length) issues.push("no existing AUD27 task is mapped");
    if (requirement.primary_aud27_id && !requirement.aud27_ids.includes(requirement.primary_aud27_id)) issues.push("primary AUD27 task is not in aud27_ids");
    const mapped = requirement.aud27_ids.map((id) => taskById.get(id));
    for (const id of requirement.aud27_ids) if (!taskById.has(id)) issues.push(`mapped AUD27 task ${id} is missing`);
    const aud27 = requirement.aud27_ids.map((id, index) => {
      const task = mapped[index];
      if (task && !isCanonicalTaskStatus(task.status)) issues.push(`${id} has ambiguous or unknown task status ${String(task.status)}`);
      if (task?.evidence_state && !(MEL23_EVIDENCE_STATES as readonly string[]).includes(task.evidence_state)) issues.push(`${id} has unknown evidence_state ${task.evidence_state}`);
      const implementationTargets = (task?.next_action?.target ?? "").split(/\s*[;+]\s*/).map((value) => value.trim()).filter(Boolean);
      return { id, status: task?.status ?? null, evidence_state: task?.evidence_state ?? null, implementation_targets: implementationTargets };
    });
    const matching = receipts
      .filter((receipt) => receipt.mel23_ids?.includes(requirement.id))
      .slice()
      .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""));
    const receipt = matching[0];
    if (!receipt?.id) issues.push("focal receipt is missing");
    if (receipt?.task && receipt.task !== requirement.primary_aud27_id) issues.push("focal receipt task does not match the primary AUD27 owner");
    const primaryTask = requirement.primary_aud27_id ? taskById.get(requirement.primary_aud27_id) : undefined;
    if (!requirement.primary_aud27_id || !primaryTask) issues.push("primary AUD27 owner is missing");
    else if (receipt?.id && !primaryTask.evidence_refs?.includes(receipt.id)) issues.push(`${requirement.primary_aud27_id} does not reference focal receipt ${receipt.id}`);
    const commands = (receipt?.command_results ?? []).filter((entry) => typeof entry.command === "string" && entry.command.trim());
    if (commands.length === 0) issues.push("test command is missing");
    if (commands.some((entry) => typeof entry.exit_status !== "number")) issues.push("test command result is missing");
    if (!receipt?.environment?.trim()) issues.push("environment is missing");
    if (!receipt?.timestamp || Number.isNaN(Date.parse(receipt.timestamp))) issues.push("valid timestamp is missing");
    const explicitCriterionResult = receipt?.criterion_results?.[requirement.id];
    const criterionResult = receipt?.criterion_results?.[requirement.id] ?? receipt?.result;
    if (!receipt?.result) issues.push("receipt result is missing");
    else if (explicitCriterionResult === undefined && !(MEL23_RECEIPT_RESULTS as readonly string[]).includes(receipt.result)) issues.push("receipt result uses a noncanonical alias");
    if (explicitCriterionResult !== undefined && !(MEL23_RECEIPT_RESULTS as readonly string[]).includes(explicitCriterionResult)) issues.push("criterion result is missing or uses a noncanonical alias");
    if (receipt && (receipt.exit_status !== 0 || commands.some((entry) => entry.exit_status !== (entry.expected_exit_status ?? 0)))) issues.push("a command exit status differs from its declared expected result");
    const fingerprint = receipt?.observed_subject_fingerprint;
    if (!fingerprint || !SHA256.test(fingerprint)) issues.push("observed subject fingerprint is missing or malformed");
    if (receipt?.candidate_fingerprint && !SHA256.test(receipt.candidate_fingerprint)) issues.push("candidate fingerprint is malformed");
    if (receipt?.freshness !== "CURRENT") issues.push("receipt is not marked current");
    if (currentSubject && receipt?.source_sha !== currentSubject.sourceSha) issues.push("receipt source SHA does not match the current checkout");
    if (currentSubject && fingerprint !== currentSubject.fingerprint) issues.push("receipt fingerprint does not match the current observed subject");
    if (criterionResult !== "PASS") issues.push("criterion is not proven PASS by its focal receipt");
    if (receipt?.id && primaryTask && !primaryTask.evidence_refs?.includes(receipt.id)) issues.push(`${requirement.primary_aud27_id} does not reference focal receipt ${receipt.id}`);
    const row: Mel23EvidenceRow = {
      id: requirement.id,
      milestone: requirement.milestone,
      target: requirement.target,
      coverage: requirement.coverage,
      acceptance_additions: requirement.acceptance_additions ?? [],
      aud27,
      test_commands: commands.map((entry) => entry.command!),
      evidence_artifacts: receipt?.evidence_artifacts ?? [],
      receipt_id: receipt?.id ?? null,
      environment: receipt?.environment ?? null,
      result: criterionResult ?? "NOT_PROVEN",
      receipt_result: receipt?.result ?? "NOT_PROVEN",
      fingerprint: fingerprint && SHA256.test(fingerprint) ? fingerprint : null,
      candidate_fingerprint: receipt?.candidate_fingerprint ?? null,
      fingerprint_status: !receipt || receipt.freshness !== "CURRENT" ? "NOT_CURRENT" : receipt.candidate_fingerprint ? "FROZEN_CANDIDATE" : "UNFROZEN_OBSERVED_SUBJECT",
      issues
    };
    return row;
  });
  const mapped = rows.filter((row) => row.aud27.length > 0 && row.aud27.every((task) => task.status !== null)).length;
  const qualified = rows.filter((row) => row.issues.length === 0).length;
  return { summary: { requirements: rows.length, mapped, qualified, blocked: rows.length - qualified }, rows, global_issues: globalIssues };
}

export function validateMel23Catalogue(requirements: readonly Mel23Requirement[], tasks: readonly Mel23Task[]): string[] {
  const issues: string[] = [];
  if (requirements.length !== 50) issues.push(`expected 50 MEL23 requirements; found ${requirements.length}`);
  const expected = new Set(Array.from({ length: 50 }, (_, index) => `MEL23-${String(index + 1).padStart(3, "0")}`));
  const actual = new Set(requirements.map((requirement) => requirement.id));
  for (const id of expected) if (!actual.has(id)) issues.push(`crosswalk is missing ${id}`);
  for (const id of actual) if (!expected.has(id)) issues.push(`crosswalk contains unexpected requirement ${id}`);
  for (const requirement of requirements) {
    if (requirement.new_aud27_task !== false) issues.push(`${requirement.id} is not reconciled to an existing AUD27 task`);
    if (!requirement.aud27_ids.length) issues.push(`${requirement.id} has no AUD27 task mapping`);
    for (const taskId of requirement.aud27_ids) if (!tasks.some((task) => task.id === taskId)) issues.push(`${requirement.id} references missing ${taskId}`);
    if (requirement.primary_aud27_id && !requirement.aud27_ids.includes(requirement.primary_aud27_id)) issues.push(`${requirement.id} primary AUD27 mapping is not listed`);
    if (!requirement.primary_aud27_id) issues.push(`${requirement.id} has no primary AUD27 owner`);
    if (!["DIRECT", "SUBSCOPE", "ACCEPTANCE_ADDITION"].includes(requirement.coverage)) issues.push(`${requirement.id} has invalid coverage ${requirement.coverage}`);
  }
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) issues.push("AUD27 backlog contains duplicate task IDs");
  for (const task of tasks) if (task.id.startsWith("MEL23-")) issues.push(`${task.id} duplicates a MEL23 requirement as an active task`);
  return issues;
}

function parseJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);
}

interface BacklogFile { readonly items: readonly Mel23Task[]; }
interface CrosswalkFile {
  readonly requirements: readonly Mel23Requirement[];
  readonly source_backlog: string;
  readonly source_sha256: string;
}

export function writeMel23EvidenceReport(root: string, reportPath = MEL23_EVIDENCE_REPORT_PATH): Mel23EvidenceReport {
  const crosswalkPath = resolve(root, "docs/mel23-aud27-reconciliation.json");
  const backlogPath = resolve(root, ".agent/backlog.json");
  const verificationPath = resolve(root, ".agent/verification.jsonl");
  for (const path of [crosswalkPath, backlogPath, verificationPath]) if (!existsSync(path)) throw new Error(`missing required evidence input ${path}`);
  const crosswalk = JSON.parse(readFileSync(crosswalkPath, "utf8")) as CrosswalkFile;
  const backlog = JSON.parse(readFileSync(backlogPath, "utf8")) as BacklogFile;
  const statePath = resolve(root, ".agent/state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as { last_gate_record?: string; last_event_id?: string };
  const vocabularyPath = resolve(root, "docs/mel23-status-vocabulary.md");
  const vocabularyIssues = existsSync(vocabularyPath)
    ? validateStatusVocabularyDocument(readFileSync(vocabularyPath, "utf8"))
    : ["docs/mel23-status-vocabulary.md is missing"];
  const subject = buildSubjectManifest(root);
  const verification = parseJsonl<Mel23Receipt>(verificationPath);
  const executionEvents = parseJsonl<{ event_id?: string }>(resolve(root, ".agent/execution-log.jsonl"));
  const report = validateMel23EvidenceMatrix(crosswalk.requirements, backlog.items, verification, {
    sourceSha: subject.manifest.sourceSha,
    fingerprint: subject.fingerprint
  });
  const capturePath = MEL23_CONTROL_PLANE_CAPTURE_PATH;
  const captureAbsolutePath = resolve(root, capturePath);
  const verificationTail = verification.at(-1)?.id ?? null;
  const eventTail = executionEvents.at(-1)?.event_id ?? null;
  const m001Index = report.rows.findIndex((row) => row.id === "MEL23-001");
  const rowsWithFinalGate = report.rows.slice();
  if (m001Index >= 0) {
    const row = rowsWithFinalGate[m001Index]!;
    const captureIssues = existsSync(captureAbsolutePath)
      ? validateControlPlaneCapture(JSON.parse(readFileSync(captureAbsolutePath, "utf8")) as ControlPlaneCapture, state, verificationTail, eventTail, {
        sourceSha: subject.manifest.sourceSha,
        fingerprint: subject.fingerprint
      })
      : ["post-append control-plane capture is missing"];
    rowsWithFinalGate[m001Index] = {
      ...row,
      test_commands: captureIssues.length === 0 ? [...row.test_commands, "npm run verify:control-plane"] : row.test_commands,
      evidence_artifacts: [...new Set([
        ...row.evidence_artifacts,
        ...(existsSync(captureAbsolutePath) ? [capturePath] : [])
      ])],
      issues: [...row.issues, ...captureIssues]
    };
  }
  const rowsQualified = rowsWithFinalGate.filter((row) => row.issues.length === 0).length;
  const reportWithFinalGate: Mel23EvidenceReport = {
    ...report,
    summary: { ...report.summary, qualified: rowsQualified, blocked: rowsWithFinalGate.length - rowsQualified },
    rows: rowsWithFinalGate
  };
  const catalogueIssues = [...validateMel23Catalogue(crosswalk.requirements, backlog.items), ...vocabularyIssues];
  const sourceBacklogPath = resolve(root, crosswalk.source_backlog);
  if (!existsSync(sourceBacklogPath)) catalogueIssues.push(`crosswalk source backlog is missing: ${crosswalk.source_backlog}`);
  else {
    const sourceDigest = createHash("sha256").update(readFileSync(sourceBacklogPath)).digest("hex");
    if (sourceDigest !== crosswalk.source_sha256) catalogueIssues.push("crosswalk source backlog digest does not match the MEL23 requirements");
  }
  const completeReport: Mel23EvidenceReport = { ...reportWithFinalGate, global_issues: [...report.global_issues, ...catalogueIssues] };
  const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_sha: subject.manifest.sourceSha,
    observed_subject_fingerprint: subject.fingerprint,
    candidate_fingerprint: null,
    fingerprint_status: "UNFROZEN_UNTIL_AUD27-004",
    status_source: ".agent/backlog.json#items (AUD27 only)",
    crosswalk_source: "docs/mel23-aud27-reconciliation.json (no task status fields)",
    catalogue_issues: catalogueIssues,
    report: completeReport
  };
  const destination = resolveMel23EvidenceReportDestination(root, reportPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`);
  return completeReport;
}

function main(): void {
  const root = resolve(process.env.CVG_REPO_ROOT?.trim() || process.cwd());
  try {
    const report = writeMel23EvidenceReport(root);
    const blocked = report.summary.blocked > 0 || report.global_issues.length > 0;
    process.stdout.write(`MEL23_EVIDENCE_${blocked ? "BLOCKED" : "PASS"} requirements=${report.summary.requirements} mapped=${report.summary.mapped} qualified=${report.summary.qualified} blocked=${report.summary.blocked} global_issues=${report.global_issues.length} report=${MEL23_EVIDENCE_REPORT_PATH}\n`);
    for (const row of report.rows.filter((entry) => entry.issues.length > 0)) process.stdout.write(`${row.id} status=${row.result} missing=${row.issues.join("; ")}\n`);
    for (const issue of report.global_issues) process.stdout.write(`CATALOGUE_INVALID detail=${issue}\n`);
    process.exitCode = blocked ? 1 : 0;
  } catch (error) {
    process.stderr.write(`MEL23_EVIDENCE_FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
