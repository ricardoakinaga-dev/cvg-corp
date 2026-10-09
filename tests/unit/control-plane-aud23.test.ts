import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { observeSourceLineage, validateControlPlane, type ControlPlaneInput } from "../../scripts/verify-control-plane.ts";
import { buildSubjectManifest } from "../../scripts/subject-manifest.ts";

const root = resolve(".");

function loadLiveInput(): ControlPlaneInput {
  const state = JSON.parse(readFileSync(resolve(root, ".agent/state.json"), "utf8")) as ControlPlaneInput["state"];
  const backlog = JSON.parse(readFileSync(resolve(root, ".agent/backlog.json"), "utf8")) as ControlPlaneInput["backlog"];
  const verificationRecords = readFileSync(resolve(root, ".agent/verification.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const executionEvents = readFileSync(resolve(root, ".agent/execution-log.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const planExists = Boolean(state.active_execplan && existsSync(resolve(root, state.active_execplan)));
  return {
    backlog,
    state,
    verificationRecords,
    executionEvents,
    now: new Date().toISOString(),
    planExists,
    planContent: planExists ? readFileSync(resolve(root, state.active_execplan!), "utf8") : "",
    subject: buildSubjectManifest(root),
    sourceLineage: observeSourceLineage(root, state.current_audit_addendum?.sourceSha)
  };
}

function copy(input: ControlPlaneInput): ControlPlaneInput {
  return structuredClone(input);
}

function activeItem(input: ControlPlaneInput): Record<string, unknown> {
  const task = input.state.active_action_id?.split(":")[0];
  const item = input.backlog.items.find((candidate) => candidate.id === task);
  assert.ok(item, `active backlog item ${task ?? "(missing)"} must exist`);
  return item as unknown as Record<string, unknown>;
}

function pointedVerification(input: ControlPlaneInput): Record<string, unknown> {
  const recordId = input.state.last_gate_record;
  const record = input.verificationRecords.find((candidate) => candidate.id === recordId);
  assert.ok(record, `state.last_gate_record ${recordId ?? "(missing)"} must resolve`);
  return record as Record<string, unknown>;
}

function lastEvent(input: ControlPlaneInput): Record<string, unknown> {
  const record = input.executionEvents.at(-1);
  assert.ok(record, "live execution tail must exist");
  return record as Record<string, unknown>;
}

function pointedEvent(input: ControlPlaneInput): Record<string, unknown> {
  const eventId = input.state.last_event_id;
  // validateControlPlane builds a Map from the ledger in order, so the last
  // duplicate ID is the record it actually reads. Mirror that selection here.
  const record = input.executionEvents.filter((event) => event.event_id === eventId).at(-1);
  assert.ok(record, `state.last_event_id ${eventId ?? "(missing)"} must resolve`);
  return record as Record<string, unknown>;
}

function knownBads(input: ControlPlaneInput): Record<string, ControlPlaneInput> {
  const action = input.state.active_action_id!;
  return {
    unsatisfied_dependency: (() => {
      const mutant = copy(input);
      (activeItem(mutant).dependencies as string[]).push("CVG-AUD22-004");
      return mutant;
    })(),
    blocked_active_item: (() => {
      const mutant = copy(input);
      const item = activeItem(mutant);
      item.status = "BLOCKED_BY_DEPENDENCIES";
      (item.next_action as Record<string, unknown>).kind = "BLOCK";
      return mutant;
    })(),
    duplicated_action: (() => {
      const mutant = copy(input);
      const program = action.split(":")[0]!.replace(/-\d{3}$/, "");
      const other = mutant.backlog.items.find((item) => item.id.startsWith(`${program}-`) && item.id !== action.split(":")[0] && item.next_action?.id);
      assert.ok(other, "a second action is required for the duplicate-action mutant");
      other.next_action!.id = action;
      return mutant;
    })(),
    broad_active_task: (() => {
      const mutant = copy(input);
      mutant.state.active_task = "CVG-AUD22";
      return mutant;
    })(),
    missing_transition: (() => {
      const mutant = copy(input);
      delete pointedEvent(mutant).next_state;
      return mutant;
    })(),
    receipt_task_action_result_divergence: (() => {
      const mutant = copy(input);
      const receipt = pointedVerification(mutant);
      receipt.task = "CVG-AUD22-001";
      receipt.result = "PASS";
      return mutant;
    })(),
    stale_receipt: (() => {
      const mutant = copy(input);
      pointedVerification(mutant).freshness = "STALE";
      return mutant;
    })(),
    divergent_fingerprint: (() => {
      const mutant = copy(input);
      pointedVerification(mutant).candidate_fingerprint = "f".repeat(64);
      return mutant;
    })(),
    non_tail_state_pointer: (() => {
      const mutant = copy(input);
      const tail = lastEvent(mutant);
      mutant.executionEvents.push({ ...tail, event_id: "EVT-CVG-AUD23-BASELINE-TAIL", timestamp: "2026-09-20T17:59:00-03:00" });
      return mutant;
    })(),
    incoherent_timestamps: (() => {
      const mutant = copy(input);
      pointedVerification(mutant).timestamp = "2026-09-20T17:36:56-03:00";
      pointedEvent(mutant).timestamp = "2026-09-20T17:36:57-03:00";
      mutant.state.updated_at = "2026-09-20T17:36:58-03:00";
      return mutant;
    })(),
    composite_exit_hides_failure: (() => {
      const mutant = copy(input);
      const receipt = pointedVerification(mutant);
      receipt.exit_status = 0;
      receipt.command_results = [{ command: "npm run verify:postgres:restore", exit_status: 2 }];
      return mutant;
    })()
  };
}

test("CVG-AUD23 strict verifier rejects each semantic known-bad", () => {
  const input = loadLiveInput();
  const baselineFindings = validateControlPlane(input);
  const missingEvidenceRoot = input.state.active_action_id?.startsWith("AUD27-") && (
    !input.subject?.manifest.evidenceRoot || !existsSync(resolve(input.subject.manifest.evidenceRoot))
  );
  const expectedBaselineCodes = missingEvidenceRoot ? ["EVIDENCE_ROOT_MISSING"] : [];
  assert.deepEqual(
    baselineFindings.map(({ code }) => code).sort(),
    expectedBaselineCodes,
    "known-good control-plane input must pass without unexpected findings"
  );
  const expectedCodes: Record<string, string> = {
    unsatisfied_dependency: "ACTIVE_DEPENDENCY_UNSATISFIED",
    blocked_active_item: "ACTIVE_ITEM_BLOCKED",
    duplicated_action: "DUPLICATE_ACTION_ID",
    broad_active_task: "ACTIVE_TASK_DIVERGENT",
    missing_transition: "MISSING_ACTIVE_TRANSITION",
    receipt_task_action_result_divergence: "LAST_GATE_TASK_DIVERGENT",
    stale_receipt: "LAST_GATE_STALE",
    divergent_fingerprint: "FINGERPRINT_DIVERGENT",
    non_tail_state_pointer: "LAST_EVENT_NOT_TAIL",
    incoherent_timestamps: "TIMESTAMP_ORDER_DIVERGENT",
    composite_exit_hides_failure: "COMPOSITE_EXIT_DIVERGENT"
  };
  for (const [name, mutant] of Object.entries(knownBads(input))) {
    const codes = validateControlPlane(mutant).map(({ code }) => code);
    assert.ok(codes.includes(expectedCodes[name]!), `${name} was not rejected by the strict verifier`);
  }
});

test("CVG-AUD24 rejects a satisfied dependency left blocked", () => {
  const input = loadLiveInput();
  const predecessor = input.backlog.items.find((item) => item.id === "CVG-AUD24-001");
  const blocked = input.backlog.items.find((item) => item.id === "CVG-AUD24-002");
  assert.ok(predecessor);
  assert.ok(blocked);
  predecessor.status = "DONE";
  input.state.active_action_id = "CVG-AUD24-001:EXACT-SUBJECT-CONTROL-RECONCILIATION";
  input.state.active_task = "CVG-AUD24-001";
  input.state.next_gate = input.state.active_action_id;
  blocked.status = "BLOCKED_BY_DEPENDENCIES";
  assert.ok(validateControlPlane(input).some(({ code }) => code === "SATISFIED_DEPENDENCY_BLOCKED"));
});

test("CVG-AUD24 rejects an opaque subject fingerprint", () => {
  const input = loadLiveInput();
  input.subject!.fingerprint = `sha256:${"0".repeat(64)}`;
  assert.ok(validateControlPlane(input).some(({ code }) => code === "SUBJECT_MANIFEST_INVALID" || code === "FINGERPRINT_DIVERGENT"));
});

test("the audit addendum source may trail HEAD only through control and evidence commits", () => {
  const input = loadLiveInput();
  const qualified = "a".repeat(40);
  input.state.current_audit_addendum = { ...input.state.current_audit_addendum, sourceSha: qualified };
  const divergent = (lineage: ControlPlaneInput["sourceLineage"]) => validateControlPlane({ ...copy(input), sourceLineage: lineage })
    .some(({ code }) => code === "CURRENT_AUDIT_ADDENDUM_SOURCE_DIVERGENT");
  assert.equal(divergent({ sourceSha: qualified, isAncestor: true, changedPaths: [".agent/state.json", "artifacts/run/receipt.json"] }), false);
  assert.equal(divergent({ sourceSha: qualified, isAncestor: true, changedPaths: [".agent/state.json", "apps/api/src/app.ts"] }), true);
  assert.equal(divergent({ sourceSha: qualified, isAncestor: true, changedPaths: [] }), true);
  assert.equal(divergent({ sourceSha: qualified, isAncestor: false, changedPaths: [".agent/state.json"] }), true);
  assert.equal(divergent({ sourceSha: "b".repeat(40), isAncestor: true, changedPaths: [".agent/state.json"] }), true);
  assert.equal(divergent(undefined), true);
});

test("source lineage is observed from the real Git history", () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const parent = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: root, encoding: "utf8" }).trim();
  const changed = execFileSync("git", ["diff", "--name-only", parent, "HEAD"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  assert.deepEqual(observeSourceLineage(root, parent), { sourceSha: parent, isAncestor: true, changedPaths: changed });
  assert.deepEqual(observeSourceLineage(root, head), { sourceSha: head, isAncestor: true, changedPaths: [] });
  assert.equal(observeSourceLineage(root, "f".repeat(40))?.isAncestor, false);
  assert.equal(observeSourceLineage(root, "not-a-sha"), undefined);
});
