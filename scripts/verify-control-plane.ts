import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildSubjectManifest, validateSubjectManifest, evidenceRootIsExternal, type SubjectManifestResult } from "./subject-manifest.ts";
import { validateAud27Semantics } from "./verify-aud27-semantics.ts";

/**
 * CVG-AUD20-001/021: deterministic control-plane validation.
 *
 * Verifies that the canonical backlog, state, ExecPlan pointer and append-only
 * logs describe one coherent program. Semantic checks intentionally stay here,
 * rather than in the shell wrapper, so mutants exercise the same contract as
 * the live verifier.
 */

export const ALLOWED_STATUSES = [
  "READY",
  "IN_PROGRESS",
  "IMPLEMENTED_UNVERIFIED",
  "PARTIAL",
  "DONE",
  "REOPEN",
  "BLOCKED_BY_DEPENDENCIES",
  "BLOCKED_EXTERNAL",
  "BLOCKED_HUMAN",
  "CANCELLED"
] as const;

export interface ControlPlaneItem {
  id: string;
  title?: string;
  status: string;
  priority?: string;
  dependencies?: string[];
  findings?: string[];
  semantic_subject?: string;
  evidence_refs?: string[];
  candidate_fingerprint?: string | null;
  observed?: unknown;
  remaining?: unknown;
  evidence_state?: string;
  blocker_type?: string | null;
  blocker_owner?: string | null;
  next_action?: { id?: string; kind?: string };
}

export interface ControlPlaneCheckpoint {
  task?: string;
  action?: string;
  plan?: string;
  fingerprint?: string | null;
  fingerprint_status?: string;
  sourceSha?: string;
}

export interface ControlPlaneState {
  active_action_id?: string;
  active_execplan?: string;
  active_task?: string;
  updated_at?: string;
  verification_state?: string;
  next_gate?: string;
  last_gate_record?: string;
  last_event_id?: string;
  candidate_fingerprint?: string | null;
  evidence_kind?: string;
  scope?: string;
  mel23_ids?: string[];
  fingerprint_status?: string;
  current_checkpoint?: ControlPlaneCheckpoint;
  active_checkpoint?: ControlPlaneCheckpoint;
  current_audit_addendum?: { record?: string; sourceSha?: string; globalVerdict?: string; promotion?: string };
}

export interface ControlPlaneRecord {
  id?: string;
  event_id?: string;
  timestamp?: string;
  task?: string;
  action?: string;
  result?: string;
  exit_status?: number | null;
  command_results?: Array<{ command?: string; exit_status?: number | null }> | null;
  next_state?: string;
  active_action_id?: string;
  fingerprint?: string | null;
  freshness?: string;
  evidence_kind?: string;
  scope?: string;
  mel23_ids?: string[];
  candidate_fingerprint?: string | null;
  fingerprint_status?: string;
  supersedes?: string[];
  supersededTimestamps?: string[];
}

export interface ControlPlaneInput {
  backlog: { items: ControlPlaneItem[]; updated_at?: string };
  state: ControlPlaneState;
  verificationRecords: ControlPlaneRecord[];
  executionEvents: ControlPlaneRecord[];
  now: string;
  planExists: boolean;
  planContent?: string;
  subject?: SubjectManifestResult;
  semanticManifest?: Parameters<typeof validateAud27Semantics>[0] | undefined;
}

export interface ControlPlaneFinding {
  code: string;
  detail: string;
}

const CURRENT_PROGRAM_ITEM = /^(?:CVG-AUD(?:21|22|23|24|25|26)|AUD27)-\d{3}$/;
const CURRENT_PROGRAM_ACTION = /^(?:CVG-AUD(?:21|22|23|24|25|26)|AUD27)-\d{3}:[A-Z0-9-]+$/;

const AUD25_INVALIDATED_AUD24_ITEMS = [
  "CVG-AUD24-004",
  "CVG-AUD24-005",
  "CVG-AUD24-006",
  "CVG-AUD24-007",
  "CVG-AUD24-008",
  "CVG-AUD24-016",
  "CVG-AUD24-017",
  "CVG-AUD24-018",
  "CVG-AUD24-019",
  "CVG-AUD24-020",
  "CVG-AUD24-021",
  "CVG-AUD24-022",
  "CVG-AUD24-023"
] as const;

function taskFromAction(action: string): string {
  return action.split(":")[0] ?? "";
}

function actionFromStateText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.match(/active_action_id=([^;\s]+)/)?.[1];
}

function planPointers(content: string): { marker?: string | undefined; headingTask?: string | undefined; firstStep?: string | undefined } {
  const marker = content.match(/active_action_id\s*:\s*([A-Z0-9-]+:[A-Z0-9-]+)/)?.[1];
  const headingTask = content.match(/^##\s+Next Action\s+(?:-|—)\s*((?:CVG-AUD(?:21|22|23|24|25|26)|AUD27)-\d{3})\s*$/m)?.[1];
  const headingIndex = content.search(/^##\s+Next Action\b/m);
  const section = headingIndex >= 0 ? content.slice(headingIndex) : "";
  const nextHeading = section.indexOf("\n## ", 1);
  const nextActionSection = nextHeading > 0 ? section.slice(0, nextHeading) : section;
  const firstStep = nextActionSection.match(/^\s*-\s*(?:action|action_id|first_step)\s*[:=]\s*((?:CVG-AUD(?:21|22|23|24|25|26)|AUD27)-\d{3}:[A-Z0-9-]+)/m)?.[1];
  return { marker, headingTask, firstStep };
}

function recordId(record: ControlPlaneRecord | undefined): string | undefined {
  return record?.id ?? record?.event_id;
}

function resultMatchesStatus(result: string | undefined, status: string): boolean {
  if (!result) return false;
  const normalizedResult = result.toUpperCase();
  if (status === "PARTIAL") return normalizedResult === "PARTIAL" || normalizedResult.includes("WITH_LIMITATION");
  if (status.startsWith("BLOCKED_")) return normalizedResult.includes("BLOCKED");
  if (status === "DONE") return normalizedResult === "PASS" || normalizedResult === "DONE" || normalizedResult.includes("COMPLETED");
  if (status === "IN_PROGRESS") return normalizedResult === "IN_PROGRESS" || normalizedResult === "STARTED" || normalizedResult === "IMPLEMENTED" || normalizedResult === "IMPLEMENTED_LOCAL";
  if (status === "READY") return normalizedResult === "READY" || normalizedResult === "STARTED";
  if (status === "IMPLEMENTED_UNVERIFIED") return normalizedResult === "IMPLEMENTED_UNVERIFIED" || normalizedResult === "IMPLEMENTED_LOCAL";
  if (status === "REOPEN") return normalizedResult === "REOPEN" || normalizedResult === "PARTIAL";
  return normalizedResult === status;
}

function recordFingerprint(record: ControlPlaneRecord | undefined): string | null | undefined {
  return record?.candidate_fingerprint ?? record?.fingerprint;
}

export function validateControlPlane(input: ControlPlaneInput): ControlPlaneFinding[] {
  const findings: ControlPlaneFinding[] = [];
  const items = Array.isArray(input.backlog.items) ? input.backlog.items : [];
  if (!Array.isArray(items) || items.length === 0) findings.push({ code: "EMPTY_BACKLOG", detail: "backlog has no items" });
  const activeProgram = input.state.active_action_id?.match(/^(?:CVG-AUD\d+|AUD27)/)?.[0];
  if (activeProgram === "AUD27") {
    // Unit callers historically supplied the live control-plane tuple without
    // the optional parsed manifest. Resolve the authoritative local file as a
    // compatibility fallback; the CLI still passes its root-scoped manifest
    // explicitly, and a genuinely missing file remains a hard finding.
    let semanticManifest = input.semanticManifest;
    if (!semanticManifest) {
      const fallbackPath = resolve("docs/aud27-semantic-manifest.json");
      if (existsSync(fallbackPath)) {
        semanticManifest = JSON.parse(readFileSync(fallbackPath, "utf8")) as Parameters<typeof validateAud27Semantics>[0];
      }
    }
    if (!semanticManifest) {
      findings.push({ code: "SEMANTIC_MANIFEST_MISSING", detail: "AUD27 control-plane verification requires docs/aud27-semantic-manifest.json" });
    } else {
      for (const detail of validateAud27Semantics(semanticManifest, input.backlog)) {
        findings.push({ code: `AUD27_SEMANTIC_${detail.code}`, detail: detail.detail });
      }
    }
  }
  if (input.subject) {
    for (const detail of validateSubjectManifest(input.subject)) findings.push({ code: "SUBJECT_MANIFEST_INVALID", detail });
    if (!input.subject.manifest.evidenceRoot || !evidenceRootIsExternal(input.subject.manifest.candidateRoot)) findings.push({ code: "EVIDENCE_ROOT_NOT_EXTERNAL", detail: "subject manifest evidence root is not outside the candidate root" });
    if (activeProgram === "AUD27" && (!input.subject.manifest.evidenceRoot || !existsSync(resolve(input.subject.manifest.evidenceRoot)))) {
      findings.push({ code: "EVIDENCE_ROOT_MISSING", detail: `AUD27 requires an existing external evidence root; got ${input.subject.manifest.evidenceRoot ?? "(missing)"}` });
    }
  } else if (activeProgram === "CVG-AUD24" || activeProgram === "CVG-AUD25" || activeProgram === "CVG-AUD26" || activeProgram === "AUD27") {
    findings.push({ code: "SUBJECT_MANIFEST_MISSING", detail: `${activeProgram} control-plane verification requires a recalculated subject manifest` });
  }
  const byId = new Map<string, ControlPlaneItem>();
  const verificationRecordsById = new Map<string, ControlPlaneRecord[]>();
  for (const record of input.verificationRecords) {
    if (!record.id) continue;
    const matches = verificationRecordsById.get(record.id) ?? [];
    matches.push(record);
    verificationRecordsById.set(record.id, matches);
  }
  for (const item of items) {
    if (byId.has(item.id)) findings.push({ code: "DUPLICATE_ITEM", detail: `duplicate backlog id ${item.id}` });
    byId.set(item.id, item);
    const scoped = item.id.startsWith("CVG-AUD19") || item.id.startsWith("CVG-AUD20") || CURRENT_PROGRAM_ITEM.test(item.id);
    if (scoped && !(ALLOWED_STATUSES as readonly string[]).includes(item.status)) {
      findings.push({ code: "INVALID_STATUS", detail: `${item.id} has status ${item.status}` });
    }
    if (item.status === "BLOCKED") findings.push({ code: "GENERIC_BLOCKED", detail: `${item.id} uses the forbidden generic BLOCKED status` });
    if (item.status === "DONE" && item.next_action?.kind === "IMPLEMENT") {
      findings.push({ code: "DONE_WITH_IMPLEMENT", detail: `${item.id} is DONE but its next action is IMPLEMENT` });
    }
    if (!item.next_action?.id) findings.push({ code: "MISSING_NEXT_ACTION", detail: `${item.id} has no next action id` });
    if (CURRENT_PROGRAM_ITEM.test(item.id) && item.status === "DONE") {
      const refs = Array.isArray(item.evidence_refs) ? item.evidence_refs : [];
      const uniqueRefs = new Set(refs);
      const recordsByRef = refs.map((ref) => typeof ref === "string" ? verificationRecordsById.get(ref) : undefined);
      const everyRefResolvesOnce = refs.length > 0 && uniqueRefs.size === refs.length && recordsByRef.every((matches) => matches?.length === 1);
      const exact = typeof item.candidate_fingerprint === "string" && item.candidate_fingerprint.length > 0 && everyRefResolvesOnce && recordsByRef.every((matches) => {
        const record = matches?.[0];
        if (!record) return false;
        const commandResultsPresent = Array.isArray(record.command_results) && record.command_results.length > 0;
        const commandsAreSuccessful = !record.command_results || (Array.isArray(record.command_results) && record.command_results.every((command) => command.exit_status === 0));
        const activeAud27ReceiptComplete = activeProgram !== "AUD27" || !item.id.startsWith("AUD27-") || (
          record.exit_status === 0 &&
          commandResultsPresent &&
          typeof record.evidence_kind === "string" && record.evidence_kind.trim().length > 0 &&
          typeof record.scope === "string" && record.scope.trim().length > 0 &&
          Array.isArray(record.mel23_ids) && record.mel23_ids.length > 0 &&
          record.mel23_ids.every((id) => /^MEL23-\d{3}$/.test(id))
        );
        return record.result === "PASS" &&
          record.task === item.id &&
          typeof item.next_action?.id === "string" &&
          item.next_action.id.trim().length > 0 &&
          record.action === item.next_action.id &&
          record.freshness === "CURRENT" &&
          typeof record.candidate_fingerprint === "string" &&
          record.candidate_fingerprint === item.candidate_fingerprint &&
          (record.exit_status === undefined || record.exit_status === null || record.exit_status === 0) &&
          commandsAreSuccessful &&
          activeAud27ReceiptComplete;
      });
      if (!exact) findings.push({ code: "DONE_WITHOUT_EXACT_SUBJECT", detail: `${item.id} is DONE without a current exact-subject PASS receipt for every evidence reference` });
    }
  }

  const visitState = new Map<string, "VISITING" | "VISITED">();
  const visit = (id: string, path: string[]): void => {
    const state = visitState.get(id);
    if (state === "VISITING") {
      findings.push({ code: "DEPENDENCY_CYCLE", detail: `dependency cycle ${[...path, id].join(" -> ")}` });
      return;
    }
    if (state === "VISITED") return;
    const item = byId.get(id);
    if (!item) return;
    visitState.set(id, "VISITING");
    for (const dependency of item.dependencies ?? []) {
      if (!byId.has(dependency)) findings.push({ code: "MISSING_DEPENDENCY", detail: `${id} depends on missing ${dependency}` });
      else visit(dependency, [...path, id]);
    }
    visitState.set(id, "VISITED");
  };
  for (const item of items) visit(item.id, []);

  const currentProgramItems = activeProgram ? items.filter((item) => item.id.startsWith(`${activeProgram}-`)) : [];
  for (const item of currentProgramItems) {
    const dependencies = item.dependencies ?? [];
    const allDependenciesDone = dependencies.every((dependency) => byId.get(dependency)?.status === "DONE");
    if (allDependenciesDone && item.status === "BLOCKED_BY_DEPENDENCIES") {
      findings.push({ code: "SATISFIED_DEPENDENCY_BLOCKED", detail: `${item.id} remains BLOCKED_BY_DEPENDENCIES although every dependency is DONE` });
    }
    if (!allDependenciesDone && ["READY", "IN_PROGRESS", "DONE"].includes(item.status)) {
      findings.push({ code: "UNSATISFIED_DEPENDENCY_STATUS", detail: `${item.id} is ${item.status} although not every dependency is DONE` });
    }
    if (activeProgram === "AUD27") {
      if (item.observed === undefined || item.observed === null || item.observed === "") findings.push({ code: "MISSING_OBSERVED_STATE", detail: `${item.id} has no observed state` });
      if (item.remaining === undefined || item.remaining === null) findings.push({ code: "MISSING_REMAINING_STATE", detail: `${item.id} has no remaining state` });
      if (!item.evidence_state) findings.push({ code: "MISSING_EVIDENCE_STATE", detail: `${item.id} has no evidence_state` });
      const blocked = item.status.startsWith("BLOCKED_");
      if (blocked && (!item.blocker_type || !item.blocker_owner)) findings.push({ code: "BLOCKER_OWNER_OR_TYPE_MISSING", detail: `${item.id} is ${item.status} without blocker_type and blocker_owner` });
      if (!blocked && item.blocker_type && item.blocker_type !== "NONE" && item.status === "DONE") findings.push({ code: "DONE_WITH_BLOCKER", detail: `${item.id} is DONE while blocker_type=${item.blocker_type}` });
    }
  }

  if (activeProgram === "CVG-AUD25") {
    const reopenedAuthority = byId.get("CVG-AUD24-003");
    if (!reopenedAuthority || !["REOPEN", "PARTIAL"].includes(reopenedAuthority.status)) {
      findings.push({ code: "AUD25_AUTHORITY_NOT_REOPENED", detail: "CVG-AUD24-003 must remain PARTIAL/REOPEN while AUD25 is active" });
    }
    for (const itemId of AUD25_INVALIDATED_AUD24_ITEMS) {
      const item = byId.get(itemId);
      if (!item || item.status !== "BLOCKED_BY_DEPENDENCIES") {
        findings.push({ code: "AUD25_PREDECESSOR_NOT_INVALIDATED", detail: `${itemId} must be BLOCKED_BY_DEPENDENCIES while AUD25 is active` });
      }
    }
  }

  const actionOwners = new Map<string, string>();
  for (const item of items) {
    const action = item.next_action?.id;
    if (!action || !activeProgram || !item.id.startsWith(`${activeProgram}-`)) continue;
    const previousOwner = actionOwners.get(action);
    if (previousOwner && previousOwner !== item.id) {
      findings.push({ code: "DUPLICATE_ACTION_ID", detail: `action ${action} is owned by both ${previousOwner} and ${item.id}` });
    } else {
      actionOwners.set(action, item.id);
    }
    if (CURRENT_PROGRAM_ITEM.test(item.id) && CURRENT_PROGRAM_ACTION.test(action) && taskFromAction(action) !== item.id) {
      findings.push({ code: "ACTION_OWNER_DIVERGENT", detail: `${item.id}.next_action ${action} belongs to ${taskFromAction(action)}` });
    }
  }

  const activeAction = input.state.active_action_id;
  if (!activeAction || !activeAction.trim()) findings.push({ code: "NO_ACTIVE_ACTION", detail: "state.active_action_id is empty" });
  else {
    const task = activeAction.split(":")[0] ?? "";
    const owner = byId.get(task);
    if (!owner) findings.push({ code: "ORPHAN_ACTIVE_ACTION", detail: `active_action_id ${activeAction} does not reference a backlog item` });
    else if (owner.status === "DONE") findings.push({ code: "ACTIVE_ACTION_DONE", detail: `active_action_id ${activeAction} points at a DONE item` });
    else if (owner.next_action?.id && owner.next_action.id !== activeAction) {
      findings.push({ code: "ACTIVE_ACTION_DIVERGENT", detail: `active_action_id ${activeAction} does not match ${owner.next_action.id}` });
    }
    if (actionOwners.get(activeAction) !== task) {
      findings.push({ code: "ACTIVE_ACTION_OWNERSHIP_DIVERGENT", detail: `active_action_id ${activeAction} is not uniquely owned by ${task}` });
    }
    if (owner && (owner.status.startsWith("BLOCKED_") || ["BLOCK", "WAIT"].includes(owner.next_action?.kind ?? ""))) {
      findings.push({ code: "ACTIVE_ITEM_BLOCKED", detail: `${task} is active but has status ${owner.status} and next action kind ${owner.next_action?.kind ?? "(missing)"}` });
    }
    if (owner) {
      for (const dependency of owner.dependencies ?? []) {
        const dependencyItem = byId.get(dependency);
        if (dependencyItem && dependencyItem.status !== "DONE") {
          findings.push({ code: "ACTIVE_DEPENDENCY_UNSATISFIED", detail: `${task} depends on ${dependency}, whose status is ${dependencyItem.status}` });
        }
      }
    }
    if (!CURRENT_PROGRAM_ACTION.test(activeAction)) findings.push({ code: "INVALID_ACTIVE_ACTION", detail: `active_action_id ${activeAction} is not a current AUD21/AUD22/AUD23/AUD24/AUD25/AUD26/AUD27 action` });
    if (input.state.active_task !== task) findings.push({ code: "ACTIVE_TASK_DIVERGENT", detail: `state.active_task ${input.state.active_task ?? "(missing)"} does not exactly match ${task}` });
    if (input.state.next_gate && input.state.next_gate !== activeAction) findings.push({ code: "NEXT_GATE_DIVERGENT", detail: `state.next_gate ${input.state.next_gate} does not match ${activeAction}` });
  }

  if (!input.state.active_execplan || !input.planExists) findings.push({ code: "MISSING_EXECPLAN", detail: "state.active_execplan is missing or does not exist" });
  else {
    const pointers = planPointers(input.planContent ?? "");
    if (!pointers.marker) findings.push({ code: "MISSING_PLAN_ACTIVE_ACTION", detail: "ExecPlan has no active_action_id marker" });
    else if (pointers.marker !== activeAction) findings.push({ code: "PLAN_ACTIVE_ACTION_DIVERGENT", detail: `ExecPlan marker ${pointers.marker} does not match ${activeAction}` });
    if (!pointers.headingTask) findings.push({ code: "MISSING_PLAN_NEXT_ACTION", detail: "ExecPlan has no Next Action heading" });
    else if (activeAction && pointers.headingTask !== taskFromAction(activeAction)) findings.push({ code: "PLAN_NEXT_ACTION_DIVERGENT", detail: `ExecPlan Next Action ${pointers.headingTask} does not match ${taskFromAction(activeAction)}` });
    if (!pointers.firstStep) findings.push({ code: "MISSING_PLAN_FIRST_STEP", detail: "ExecPlan Next Action has no concrete action step" });
    else if (pointers.firstStep !== activeAction) findings.push({ code: "PLAN_FIRST_STEP_DIVERGENT", detail: `ExecPlan first step ${pointers.firstStep} does not match ${activeAction}` });
  }

  const checkCheckpoint = (checkpoint: ControlPlaneCheckpoint | undefined, label: string): void => {
    if (!checkpoint) return;
    if (activeAction && checkpoint.action !== activeAction) findings.push({ code: "CHECKPOINT_ACTION_DIVERGENT", detail: `${label}.action ${checkpoint.action ?? "(missing)"} does not match ${activeAction}` });
    if (input.state.active_execplan && checkpoint.plan !== input.state.active_execplan) findings.push({ code: "CHECKPOINT_PLAN_DIVERGENT", detail: `${label}.plan ${checkpoint.plan ?? "(missing)"} does not match ${input.state.active_execplan}` });
    if (activeAction && checkpoint.task !== taskFromAction(activeAction)) findings.push({ code: "CHECKPOINT_TASK_DIVERGENT", detail: `${label}.task ${checkpoint.task ?? "(missing)"} does not exactly match ${taskFromAction(activeAction)}` });
  };
  checkCheckpoint(input.state.current_checkpoint, "state.current_checkpoint");
  checkCheckpoint(input.state.active_checkpoint, "state.active_checkpoint");

  const verificationById = new Map(input.verificationRecords.flatMap((record) => record.id ? [[record.id, record] as const] : []));
  const eventById = new Map(input.executionEvents.flatMap((record) => record.event_id ? [[record.event_id, record] as const] : []));
  const lastGate = input.state.last_gate_record ? verificationById.get(input.state.last_gate_record) : undefined;
  const lastEvent = input.state.last_event_id ? eventById.get(input.state.last_event_id) : undefined;
  if (!lastGate) findings.push({ code: "MISSING_LAST_GATE", detail: `state.last_gate_record ${input.state.last_gate_record ?? "(missing)"} is not in verification.jsonl` });
  if (!lastEvent) findings.push({ code: "MISSING_LAST_EVENT", detail: `state.last_event_id ${input.state.last_event_id ?? "(missing)"} is not in execution-log.jsonl` });
  if (lastGate?.active_action_id && lastGate.active_action_id !== activeAction) findings.push({ code: "LAST_GATE_DIVERGENT", detail: `last gate points to ${lastGate.active_action_id}, not ${activeAction}` });
  if (lastEvent?.active_action_id && lastEvent.active_action_id !== activeAction) findings.push({ code: "LAST_EVENT_DIVERGENT", detail: `last event points to ${lastEvent.active_action_id}, not ${activeAction}` });
  const tailGate = input.verificationRecords.at(-1);
  const tailEvent = input.executionEvents.at(-1);
  if (lastGate && recordId(tailGate ?? {}) !== input.state.last_gate_record) {
    findings.push({ code: "LAST_GATE_NOT_TAIL", detail: `state.last_gate_record ${input.state.last_gate_record ?? "(missing)"} is not the verification ledger tail ${recordId(tailGate ?? {}) ?? "(missing)"}` });
  }
  if (lastEvent && recordId(tailEvent ?? {}) !== input.state.last_event_id) {
    findings.push({ code: "LAST_EVENT_NOT_TAIL", detail: `state.last_event_id ${input.state.last_event_id ?? "(missing)"} is not the execution ledger tail ${recordId(tailEvent ?? {}) ?? "(missing)"}` });
  }
  const checkCurrentRecord = (record: ControlPlaneRecord | undefined, label: string): void => {
    if (!record || !activeAction) return;
    const recordTask = record.action ? taskFromAction(record.action) : undefined;
    const transitionAction = actionFromStateText(record.next_state);
    const isCurrentAction = record.action === activeAction;
    const isTransitionToActive = Boolean(record.action && transitionAction === activeAction);
    if (record.task !== recordTask) findings.push({ code: `${label.toUpperCase()}_TASK_DIVERGENT`, detail: `${label}.task ${record.task ?? "(missing)"} does not match its action owner ${recordTask ?? "(missing)"}` });
    if (!record.action || (!isCurrentAction && !isTransitionToActive)) findings.push({ code: `${label.toUpperCase()}_ACTION_DIVERGENT`, detail: `${label}.action ${record.action ?? "(missing)"} is neither the active action ${activeAction} nor a transition into it` });
    if (record.active_action_id && record.active_action_id !== activeAction) findings.push({ code: `${label.toUpperCase()}_ACTIVE_ACTION_DIVERGENT`, detail: `${label}.active_action_id ${record.active_action_id} does not match ${activeAction}` });
    const owner = recordTask ? byId.get(recordTask) : undefined;
    if (owner && !resultMatchesStatus(record.result, owner.status)) findings.push({ code: `${label.toUpperCase()}_RESULT_DIVERGENT`, detail: `${label}.result ${record.result ?? "(missing)"} is not compatible with ${recordTask} status ${owner.status}` });
  };
  checkCurrentRecord(lastGate, "last_gate");
  checkCurrentRecord(lastEvent, "last_event");
  if (lastGate && lastGate.freshness !== "CURRENT") findings.push({ code: "LAST_GATE_STALE", detail: `last gate ${recordId(lastGate) ?? "(missing)"} has freshness ${lastGate.freshness ?? "(missing)"}` });
  if (lastGate?.action) {
    const gateOwner = byId.get(taskFromAction(lastGate.action));
    if (gateOwner && recordId(lastGate) && !(gateOwner.evidence_refs ?? []).includes(recordId(lastGate)!)) {
      findings.push({ code: "LAST_GATE_UNREFERENCED", detail: `last gate ${recordId(lastGate)} is not referenced by ${gateOwner.id}` });
    }
  }
  if (lastEvent) {
    if (!lastEvent.next_state) findings.push({ code: "MISSING_ACTIVE_TRANSITION", detail: `last event ${recordId(lastEvent) ?? "(missing)"} has no next_state transition` });
    else {
      const nextStateAction = actionFromStateText(lastEvent.next_state);
      if (nextStateAction !== activeAction) findings.push({ code: "LAST_EVENT_NEXT_STATE_DIVERGENT", detail: `last event next_state points to ${nextStateAction ?? "(missing)"}, not ${activeAction}` });
    }
  }

  const currentAddendum = input.state.current_audit_addendum;
  if (currentAddendum) {
    if (!currentAddendum.record || currentAddendum.record !== recordId(lastGate)) findings.push({ code: "CURRENT_AUDIT_ADDENDUM_STALE", detail: `current_audit_addendum ${currentAddendum.record ?? "(missing)"} does not identify the current gate ${recordId(lastGate) ?? "(missing)"}` });
    if (input.subject && currentAddendum.sourceSha && currentAddendum.sourceSha !== input.subject.manifest.sourceSha) findings.push({ code: "CURRENT_AUDIT_ADDENDUM_SOURCE_DIVERGENT", detail: `current_audit_addendum source ${currentAddendum.sourceSha} does not match ${input.subject.manifest.sourceSha}` });
  }

  const fingerprintSources: Array<[string, string | null | undefined]> = [
    ["state", input.state.candidate_fingerprint],
    ["current checkpoint", input.state.current_checkpoint?.fingerprint],
    ["active checkpoint", input.state.active_checkpoint?.fingerprint],
    ["last gate", recordFingerprint(lastGate)],
    ["last event", recordFingerprint(lastEvent)]
  ];
  const ownerFingerprint = activeAction ? byId.get(taskFromAction(activeAction))?.candidate_fingerprint : undefined;
  fingerprintSources.push(["active item", ownerFingerprint]);
  const expectedSubjectFingerprint = input.subject?.fingerprint;
  const fingerprints = fingerprintSources.filter(([, fingerprint]) => typeof fingerprint === "string" && fingerprint.length > 0) as Array<[string, string]>;
  const subjectIsIntentionallyUnfrozen = activeProgram === "AUD27" && input.state.fingerprint_status === "UNFROZEN_UNTIL_AUD27-004";
  if (expectedSubjectFingerprint && !subjectIsIntentionallyUnfrozen) {
    const subject = input.subject;
    if (!subject) return findings;
    for (const [source, fingerprint] of fingerprintSources) {
      if (fingerprint !== expectedSubjectFingerprint) findings.push({ code: fingerprint === null ? "FINGERPRINT_MISSING" : "FINGERPRINT_DIVERGENT", detail: `${source} fingerprint ${fingerprint ?? "(missing)"} does not match recalculated subject ${expectedSubjectFingerprint}` });
    }
    for (const [label, checkpoint] of [["current checkpoint", input.state.current_checkpoint], ["active checkpoint", input.state.active_checkpoint]] as const) {
      if (!checkpoint?.sourceSha) findings.push({ code: "CHECKPOINT_SOURCE_MISSING", detail: `${label} does not bind the current HEAD ${subject.manifest.sourceSha}` });
      else if (checkpoint.sourceSha !== subject.manifest.sourceSha) findings.push({ code: "CHECKPOINT_SOURCE_DIVERGENT", detail: `${label}.sourceSha ${checkpoint.sourceSha} does not match ${subject.manifest.sourceSha}` });
    }
  } else if (subjectIsIntentionallyUnfrozen) {
    for (const [source, fingerprint] of fingerprintSources) {
      if (fingerprint !== null && fingerprint !== undefined && fingerprint !== "") {
        findings.push({ code: "FINGERPRINT_PRESENT_BEFORE_FREEZE", detail: `${source} carries ${fingerprint} before AUD27-004 freeze` });
        // Preserve the long-standing generic divergence code consumed by the
        // AUD23 adversarial fixtures while retaining the more precise AUD27
        // diagnostic above.
        findings.push({ code: "FINGERPRINT_DIVERGENT", detail: `${source} carries a candidate fingerprint before AUD27-004 freeze` });
      }
    }
  } else if (activeProgram === "CVG-AUD24" || activeProgram === "CVG-AUD25" || activeProgram === "CVG-AUD26") {
    findings.push({ code: "SUBJECT_FINGERPRINT_MISSING", detail: `${activeProgram} has no recalculated exact-subject fingerprint` });
  } else if (fingerprints.length > 0) {
    const firstFingerprint = fingerprints[0];
    if (!firstFingerprint) return findings;
    const expectedFingerprint = firstFingerprint[1];
    for (const [source, fingerprint] of fingerprints.slice(1)) {
      if (fingerprint !== expectedFingerprint) findings.push({ code: "FINGERPRINT_DIVERGENT", detail: `${source} fingerprint ${fingerprint} does not match ${expectedFingerprint}` });
    }
    for (const [source, fingerprint] of fingerprintSources) {
      if (source !== "last gate" && fingerprint === null) findings.push({ code: "FINGERPRINT_MISSING", detail: `${source} omits the current candidate fingerprint ${expectedFingerprint}` });
    }
  }

  const gateAt = lastGate?.timestamp ? Date.parse(lastGate.timestamp) : Number.NaN;
  const eventAt = lastEvent?.timestamp ? Date.parse(lastEvent.timestamp) : Number.NaN;
  if (Number.isFinite(gateAt) && Number.isFinite(eventAt) && eventAt > gateAt) {
    findings.push({ code: "TIMESTAMP_ORDER_DIVERGENT", detail: `last event ${lastEvent?.timestamp} is later than last gate ${lastGate?.timestamp}` });
  }
  const checkCompositeExit = (record: ControlPlaneRecord | undefined, label: string): void => {
    if (!record) return;
    const hasExitStatus = record.exit_status !== undefined && record.exit_status !== null;
    const hasCommandResults = record.command_results !== undefined && record.command_results !== null;
    if (!hasExitStatus && !hasCommandResults) return;
    if (hasExitStatus && (!Number.isSafeInteger(record.exit_status) || record.exit_status! < 0)) {
      findings.push({ code: "COMPOSITE_EXIT_DIVERGENT", detail: `${label} has an invalid aggregate exit status` });
      return;
    }
    // Some execution events record only the process exit status. When a command
    // list is present, however, it must be complete and agree with that status.
    if (!hasCommandResults) return;
    if (!Array.isArray(record.command_results) || record.command_results.length === 0) {
      findings.push({ code: "COMPOSITE_EXIT_DIVERGENT", detail: `${label} has an empty or invalid command-results list` });
      return;
    }
    const commandResults = record.command_results;
    if (commandResults.some((command) => !command || !Number.isSafeInteger(command.exit_status) || command.exit_status! < 0)) {
      findings.push({ code: "COMPOSITE_EXIT_DIVERGENT", detail: `${label} has a command result without a valid integer exit status` });
      return;
    }
    if (!hasExitStatus) {
      findings.push({ code: "COMPOSITE_EXIT_DIVERGENT", detail: `${label} has command results without an aggregate exit status` });
      return;
    }
    const hasFailure = commandResults.some((command) => command.exit_status !== 0);
    if ((record.exit_status ?? null) === 0 && hasFailure) {
      findings.push({ code: "COMPOSITE_EXIT_DIVERGENT", detail: `${label} reports exit 0 while a subprocess exited non-zero` });
    }
    if ((record.exit_status ?? null) !== 0 && !hasFailure) {
      findings.push({ code: "COMPOSITE_EXIT_DIVERGENT", detail: `${label} reports non-zero exit while every subprocess exited 0` });
    }
  };
  checkCompositeExit(lastGate, "last gate");
  checkCompositeExit(lastEvent, "last event");

  const openP0P1 = items.filter((item) => (item.priority === "P0" || item.priority === "P1") && item.status !== "DONE");
  if (openP0P1.length > 0) {
    const blocked = input.state.verification_state ?? "";
    if (!/BLOCK|PARTIAL|REOPEN|IN_PROGRESS|IMPLEMENTED_UNVERIFIED|READY/i.test(blocked)) {
      findings.push({ code: "PROMOTION_NOT_BLOCKED", detail: `${openP0P1.length} P0/P1 items are open but state does not declare a blocked/partial promotion state` });
    }
  }

  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) findings.push({ code: "INVALID_NOW", detail: `now is not a valid timestamp: ${input.now}` });
  const updatedAtMs = input.state.updated_at ? Date.parse(input.state.updated_at) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) findings.push({ code: "INVALID_STATE_TIMESTAMP", detail: `state.updated_at is not a valid timestamp: ${input.state.updated_at ?? "(missing)"}` });
  else if (updatedAtMs > nowMs) findings.push({ code: "FUTURE_STATE_TIMESTAMP", detail: `state.updated_at is dated ${input.state.updated_at}` });
  for (const [label, record] of [["last gate", lastGate], ["last event", lastEvent]] as const) {
    const recordAt = record?.timestamp ? Date.parse(record.timestamp) : Number.NaN;
    if (Number.isFinite(updatedAtMs) && Number.isFinite(recordAt) && recordAt > updatedAtMs) {
      findings.push({ code: "STATE_UPDATED_BEFORE_LAST_RECORD", detail: `${label} ${recordId(record!)} is dated after state.updated_at` });
    }
  }
  // Append-only reconciliation: a valid record may explicitly supersede an
  // earlier invalid receipt.  Superseded history is preserved but no longer
  // gates the control plane; it is never edited in place.
  const superseded = new Set<string>();
  const supersededTimestamps = new Set<string>();
  for (const record of [...input.verificationRecords, ...input.executionEvents]) {
    const at = record.timestamp ? Date.parse(record.timestamp) : Number.NaN;
    const valid = Number.isFinite(at) && at <= nowMs;
    if (!valid) continue;
    for (const id of record.supersedes ?? []) superseded.add(id);
    for (const timestamp of record.supersededTimestamps ?? []) supersededTimestamps.add(timestamp);
  }
  const checkTimestamps = (records: Array<{ id?: string; timestamp?: string }>, kind: string): void => {
    for (const record of records) {
      const id = record.id ?? "(missing id)";
      if (superseded.has(id)) continue;
      if (record.timestamp && supersededTimestamps.has(record.timestamp)) continue;
      const at = record.timestamp ? Date.parse(record.timestamp) : Number.NaN;
      if (!Number.isFinite(at)) findings.push({ code: "INVALID_TIMESTAMP", detail: `${kind} ${id} has no valid timestamp` });
      else if (at > nowMs) findings.push({ code: "FUTURE_TIMESTAMP", detail: `${kind} ${id} is dated ${record.timestamp}` });
    }
  };
  checkTimestamps(input.verificationRecords, "verification");
  checkTimestamps(input.executionEvents, "event");
  return findings;
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function main(): void {
  const root = process.env.CVG_CONTROL_PLANE_ROOT ?? ".";
  const backlog = JSON.parse(readFileSync(resolve(root, ".agent/backlog.json"), "utf8")) as ControlPlaneInput["backlog"];
  const state = JSON.parse(readFileSync(resolve(root, ".agent/state.json"), "utf8")) as ControlPlaneInput["state"];
  const verificationRecords = readJsonl(resolve(root, ".agent/verification.jsonl"));
  const executionEvents = readJsonl(resolve(root, ".agent/execution-log.jsonl"));
  const planExists = Boolean(state.active_execplan && existsSync(resolve(root, state.active_execplan)));
  const planContent = planExists ? readFileSync(resolve(root, state.active_execplan!), "utf8") : "";
  const semanticPath = resolve(root, "docs/aud27-semantic-manifest.json");
  const semanticManifest = state.active_action_id?.startsWith("AUD27-") && existsSync(semanticPath)
    ? JSON.parse(readFileSync(semanticPath, "utf8")) as Parameters<typeof validateAud27Semantics>[0]
    : undefined;
  const findings = validateControlPlane({ backlog, state, verificationRecords, executionEvents, now: new Date().toISOString(), planExists, planContent, subject: buildSubjectManifest(root), semanticManifest });
  if (findings.length > 0) {
    process.stderr.write(`CONTROL_PLANE_INVALID ${JSON.stringify(findings)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`CONTROL_PLANE_VERIFIED items=${backlog.items.length} active=${state.active_action_id}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("verify-control-plane.ts")) main();
