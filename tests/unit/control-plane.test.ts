import test from "node:test";
import assert from "node:assert/strict";
import { buildSubjectManifest } from "../../scripts/subject-manifest.ts";
import { validateControlPlane, type ControlPlaneInput } from "../../scripts/verify-control-plane.ts";

const now = "2026-09-20T17:00:00-03:00";
const plan = (action: string, task = action.split(":")[0]) => `<!-- status: ACTIVE; active_action_id: ${action} -->\n\n## Next Action - ${task}\n- action_id: ${action}\n`;

function input(overrides: Partial<ControlPlaneInput> = {}): ControlPlaneInput {
  const action = "CVG-AUD22-001:CONTROL-PLANE-RECONCILIATION";
  const receipt = {
    id: "VER-CVG-AUD22-001-001",
    timestamp: "2026-09-20T16:59:00-03:00",
    task: "CVG-AUD22-001",
    action,
    result: "IN_PROGRESS",
    freshness: "CURRENT",
    candidate_fingerprint: null,
    active_action_id: action
  };
  const event = {
    event_id: "EVT-CVG-AUD22-001-001",
    timestamp: "2026-09-20T16:59:00-03:00",
    task: "CVG-AUD22-001",
    action,
    result: "IN_PROGRESS",
    active_action_id: action,
    next_state: `IN_PROGRESS; active_action_id=${action}`
  };
  return {
    backlog: {
      items: [{
        id: "CVG-AUD22-001",
        status: "IN_PROGRESS",
        priority: "P0",
        dependencies: [],
        next_action: { id: action, kind: "IMPLEMENT" },
        evidence_refs: [receipt.id]
      }]
    },
    state: {
      active_action_id: action,
      active_execplan: ".agent/plans/aud22.md",
      active_task: "CVG-AUD22-001",
      next_gate: action,
      updated_at: now,
      verification_state: "PROMOTION_BLOCKED_P0_P1_OPEN",
      last_gate_record: receipt.id,
      last_event_id: event.event_id,
      current_checkpoint: { task: "CVG-AUD22-001", action, plan: ".agent/plans/aud22.md" },
      active_checkpoint: { task: "CVG-AUD22-001", action, plan: ".agent/plans/aud22.md" }
    },
    verificationRecords: [receipt],
    executionEvents: [event],
    now,
    planExists: true,
    planContent: plan(action),
    ...overrides
  };
}

function coherentDoneTransition(): ControlPlaneInput {
  const current = input();
  const previousAction = "CVG-AUD22-001:CONTROL-PLANE-RECONCILIATION";
  const nextAction = "CVG-AUD22-002:POSTGRES-RESTORE-PROOF";
  const fingerprint = "a".repeat(64);
  const receipt = current.verificationRecords[0]!;
  const event = current.executionEvents[0]!;
  receipt.result = "PASS";
  receipt.candidate_fingerprint = fingerprint;
  receipt.active_action_id = nextAction;
  receipt.next_state = `READY; active_action_id=${nextAction}`;
  receipt.exit_status = 0;
  receipt.command_results = [{ command: "gate", exit_status: 0 }];
  event.result = "PASS";
  event.candidate_fingerprint = fingerprint;
  event.active_action_id = nextAction;
  event.next_state = `READY; active_action_id=${nextAction}`;
  current.backlog.items[0] = {
    ...current.backlog.items[0]!,
    status: "DONE",
    candidate_fingerprint: fingerprint,
    next_action: { id: previousAction, kind: "VERIFY" },
    evidence_refs: [receipt.id!]
  };
  current.backlog.items.push({
    id: "CVG-AUD22-002",
    status: "READY",
    priority: "P0",
    dependencies: ["CVG-AUD22-001"],
    candidate_fingerprint: fingerprint,
    next_action: { id: nextAction, kind: "START" }
  });
  current.state = {
    ...current.state,
    active_action_id: nextAction,
    active_task: "CVG-AUD22-002",
    next_gate: nextAction,
    updated_at: "2026-09-20T17:00:01-03:00",
    current_checkpoint: { task: "CVG-AUD22-002", action: nextAction, plan: ".agent/plans/aud22.md", fingerprint },
    active_checkpoint: { task: "CVG-AUD22-002", action: nextAction, plan: ".agent/plans/aud22.md", fingerprint },
    candidate_fingerprint: fingerprint
  };
  current.now = "2026-09-20T17:01:00-03:00";
  current.planContent = plan(nextAction, "CVG-AUD22-002");
  return current;
}

function coherentAud27DoneTransition(): ControlPlaneInput {
  const current = input();
  const task = "AUD27-001";
  const doneAction = `${task}:QUALIFY-LOCAL-EVIDENCE`;
  const activeTask = "AUD27-002";
  const activeAction = `${activeTask}:RECONCILE-EVIDENCE`;
  const fingerprint = "b".repeat(64);
  const receipt = {
    id: "VER-AUD27-001-001",
    timestamp: "2026-09-20T16:59:00-03:00",
    task,
    action: doneAction,
    result: "PASS",
    freshness: "CURRENT",
    candidate_fingerprint: fingerprint,
    active_action_id: activeAction,
    exit_status: 0,
    command_results: [{ command: "qualification", exit_status: 0 }],
    evidence_kind: "LOCAL_TEST",
    scope: "MEL23-021 local route response contracts",
    mel23_ids: ["MEL23-021"]
  };
  const event = {
    event_id: "EVT-AUD27-001-001",
    timestamp: receipt.timestamp,
    task,
    action: doneAction,
    result: "PASS",
    candidate_fingerprint: fingerprint,
    active_action_id: activeAction,
    next_state: `READY; active_action_id=${activeAction}`
  };
  current.backlog.items = [
    {
      id: task,
      status: "DONE",
      priority: "P1",
      dependencies: [],
      next_action: { id: doneAction, kind: "VERIFY" },
      evidence_refs: [receipt.id],
      candidate_fingerprint: fingerprint,
      observed: "Local route schemas and fixtures passed.",
      remaining: "Human and production qualification remain open.",
      evidence_state: "LOCAL_PASS_EXTERNAL_BLOCKED"
    },
    {
      id: activeTask,
      status: "READY",
      priority: "P1",
      dependencies: [],
      next_action: { id: activeAction, kind: "START" },
      observed: "Not started.",
      remaining: "Reconcile the next local evidence slice.",
      evidence_state: "NOT_STARTED"
    }
  ];
  current.state = {
    ...current.state,
    active_action_id: activeAction,
    active_task: activeTask,
    next_gate: activeAction,
    updated_at: "2026-09-20T17:00:00-03:00",
    verification_state: "PROMOTION_BLOCKED_EXTERNAL_AND_HUMAN_GATES",
    last_gate_record: receipt.id,
    last_event_id: event.event_id,
    candidate_fingerprint: fingerprint,
    current_checkpoint: { task: activeTask, action: activeAction, plan: ".agent/plans/aud27.md", fingerprint },
    active_checkpoint: { task: activeTask, action: activeAction, plan: ".agent/plans/aud27.md", fingerprint }
  };
  current.verificationRecords = [receipt];
  current.executionEvents = [event];
  current.now = "2026-09-20T17:01:00-03:00";
  current.planContent = plan(activeAction, activeTask);
  return current;
}

test("rejects a plan marker that still points to AUD21-013 while state points to AUD21-014", () => {
  const bad = input({
    state: {
      ...input().state,
      active_action_id: "CVG-AUD21-014:SCHEMA-REQUALIFICATION",
      next_gate: "CVG-AUD21-014:SCHEMA-REQUALIFICATION"
    },
    planContent: plan("CVG-AUD21-013:SEMANTIC-RECOVERY")
  });
  const codes = validateControlPlane(bad).map(({ code }) => code);
  assert.ok(codes.includes("PLAN_ACTIVE_ACTION_DIVERGENT"));
  assert.ok(codes.includes("PLAN_FIRST_STEP_DIVERGENT"));
});

test("rejects state updated before its referenced event and receipt", () => {
  const bad = input({ state: { ...input().state, updated_at: "2026-09-20T15:39:00-03:00" } });
  assert.ok(validateControlPlane(bad).some(({ code }) => code === "STATE_UPDATED_BEFORE_LAST_RECORD"));
});

test("rejects a DONE item without a current exact-subject receipt", () => {
  const bad = input({
    backlog: {
      items: [{
        id: "CVG-AUD21-013",
        status: "DONE",
        priority: "P1",
        dependencies: [],
        next_action: { id: "CVG-AUD21-013:SEMANTIC-RECOVERY", kind: "VERIFY" },
        evidence_refs: ["VER-CVG-AUD21-013-002"],
        candidate_fingerprint: null
      }]
    }
  });
  assert.ok(validateControlPlane(bad).some(({ code }) => code === "DONE_WITHOUT_EXACT_SUBJECT"));
});

test("rejects DONE when a referenced receipt fails, is unrelated, action-mismatched, duplicated or unresolved", () => {
  const mutations: Array<[string, (current: ControlPlaneInput) => void]> = [
    ["FAIL receipt", (current) => { current.verificationRecords[0]!.result = "FAIL"; }],
    ["unrelated task", (current) => { current.verificationRecords[0]!.task = "CVG-AUD22-002"; }],
    ["unrelated action on same task", (current) => { current.verificationRecords[0]!.action = "CVG-AUD22-001:OTHER-RECEIPT"; }],
    ["missing action", (current) => { delete current.verificationRecords[0]!.action; }],
    ["duplicate receipt ID", (current) => { current.verificationRecords.push({ ...current.verificationRecords[0]! }); }],
    ["unresolved reference", (current) => { current.backlog.items[0]!.evidence_refs!.push("VER-MISSING"); }]
  ];
  for (const [name, mutate] of mutations) {
    const bad = coherentDoneTransition();
    mutate(bad);
    assert.ok(
      validateControlPlane(bad).some(({ code }) => code === "DONE_WITHOUT_EXACT_SUBJECT"),
      `${name} was accepted as exact DONE evidence`
    );
  }
});

test("rejects an event whose composite exit hides a failed command", () => {
  const bad = coherentDoneTransition();
  bad.executionEvents[0]!.exit_status = 0;
  bad.executionEvents[0]!.command_results = [{ command: "gate", exit_status: 2 }];
  assert.ok(validateControlPlane(bad).some(({ code }) => code === "COMPOSITE_EXIT_DIVERGENT"));
});

test("rejects tail command results with missing statuses on both gate and event", () => {
  for (const label of ["gate", "event"] as const) {
    const bad = coherentDoneTransition();
    const tail = label === "gate" ? bad.verificationRecords[0]! : bad.executionEvents[0]!;
    tail.exit_status = 0;
    tail.command_results = [{ command: "qualification" }];
    assert.ok(
      validateControlPlane(bad).some(({ code }) => code === "COMPOSITE_EXIT_DIVERGENT"),
      `the last ${label} accepted a command without an exit status`
    );
  }
});

test("rejects empty command-results lists when a tail declares a composite result", () => {
  const bad = coherentDoneTransition();
  bad.verificationRecords[0]!.exit_status = 0;
  bad.verificationRecords[0]!.command_results = [];
  assert.ok(validateControlPlane(bad).some(({ code }) => code === "COMPOSITE_EXIT_DIVERGENT"));
});

test("rejects malformed or missing aggregate exits when a tail has command results", () => {
  for (const label of ["gate", "event"] as const) {
    const malformed = coherentDoneTransition();
    const malformedTail = label === "gate" ? malformed.verificationRecords[0]! : malformed.executionEvents[0]!;
    malformedTail.exit_status = "0" as unknown as number;
    malformedTail.command_results = [{ command: "qualification", exit_status: 2 }];
    assert.ok(
      validateControlPlane(malformed).some(({ code }) => code === "COMPOSITE_EXIT_DIVERGENT"),
      `the last ${label} accepted a malformed aggregate exit status`
    );

    const missing = coherentDoneTransition();
    const missingTail = label === "gate" ? missing.verificationRecords[0]! : missing.executionEvents[0]!;
    delete missingTail.exit_status;
    missingTail.command_results = [{ command: "qualification", exit_status: 2 }];
    assert.ok(
      validateControlPlane(missing).some(({ code }) => code === "COMPOSITE_EXIT_DIVERGENT"),
      `the last ${label} accepted command results without an aggregate exit status`
    );
  }
});

test("accepts a valid standalone exit status on an execution event", () => {
  const current = coherentDoneTransition();
  current.executionEvents[0]!.exit_status = 0;
  assert.deepEqual(validateControlPlane(current), []);
});

test("accepts one aligned append-only control-plane action", () => {
  assert.deepEqual(validateControlPlane(input()), []);
});

test("accepts a coherent append-only transition to the next action", () => {
  const current = coherentDoneTransition();
  assert.deepEqual(validateControlPlane(current), []);
});

test("requires active AUD27 DONE receipts to carry successful command and MEL23 evidence", () => {
  const valid = coherentAud27DoneTransition();
  assert.ok(!validateControlPlane(valid).some(({ code }) => code === "DONE_WITHOUT_EXACT_SUBJECT"));

  const mutations: Array<[string, (current: ControlPlaneInput) => void]> = [
    ["missing composite exit status", (current) => { delete current.verificationRecords[0]!.exit_status; }],
    ["missing command results", (current) => { delete current.verificationRecords[0]!.command_results; }],
    ["empty command results", (current) => { current.verificationRecords[0]!.command_results = []; }],
    ["failed command result", (current) => { current.verificationRecords[0]!.command_results = [{ command: "qualification", exit_status: 1 }]; }],
    ["missing evidence kind", (current) => { delete current.verificationRecords[0]!.evidence_kind; }],
    ["missing scope", (current) => { delete current.verificationRecords[0]!.scope; }],
    ["missing MEL23 link", (current) => { delete current.verificationRecords[0]!.mel23_ids; }],
    ["invalid MEL23 link", (current) => { current.verificationRecords[0]!.mel23_ids = ["AUD27-001"]; }]
  ];
  for (const [name, mutate] of mutations) {
    const bad = coherentAud27DoneTransition();
    mutate(bad);
    assert.ok(
      validateControlPlane(bad).some(({ code }) => code === "DONE_WITHOUT_EXACT_SUBJECT"),
      `${name} was accepted as exact AUD27 DONE evidence`
    );
  }
});

test("recognizes AUD25 and requires the AUD24 authority closure to be reopened", () => {
  const current = input();
  const subject = buildSubjectManifest();
  const fingerprint = subject.fingerprint;
  const action = "CVG-AUD25-001:REOPEN-AUTHORITY-CONTROL";
  const receipt = {
    id: "VER-CVG-AUD25-001-001",
    timestamp: "2026-09-20T17:00:01-03:00",
    task: "CVG-AUD25-001",
    action,
    result: "IN_PROGRESS",
    freshness: "CURRENT",
    candidate_fingerprint: fingerprint,
    active_action_id: action
  };
  const event = {
    event_id: "EVT-CVG-AUD25-001-001",
    timestamp: "2026-09-20T17:00:01-03:00",
    task: "CVG-AUD25-001",
    action,
    result: "IN_PROGRESS",
    candidate_fingerprint: fingerprint,
    active_action_id: action,
    next_state: `IN_PROGRESS; active_action_id=${action}`
  };
  const invalidated = ["004", "005", "006", "007", "008", "016", "017", "018", "019", "020", "021", "022", "023"].map((suffix) => ({
    id: `CVG-AUD24-${suffix}`,
    status: "BLOCKED_BY_DEPENDENCIES",
    dependencies: [],
    next_action: { id: `CVG-AUD24-${suffix}:BLOCKED`, kind: "WAIT" }
  }));
  current.backlog.items = [
    ...invalidated,
    { id: "CVG-AUD24-003", status: "REOPEN", dependencies: [], next_action: { id: "CVG-AUD24-003:REOPEN", kind: "REOPEN" } },
    { id: "CVG-AUD25-001", status: "IN_PROGRESS", priority: "P0", dependencies: [], candidate_fingerprint: fingerprint, next_action: { id: action, kind: "IMPLEMENT" }, evidence_refs: [receipt.id] }
  ];
  current.state = {
    ...current.state,
    active_action_id: action,
    active_task: "CVG-AUD25-001",
    next_gate: action,
    last_gate_record: receipt.id,
    last_event_id: event.event_id,
    candidate_fingerprint: fingerprint,
    updated_at: "2026-09-20T17:00:02-03:00",
    current_checkpoint: { task: "CVG-AUD25-001", action, plan: ".agent/plans/aud25.md", fingerprint, sourceSha: subject.manifest.sourceSha },
    active_checkpoint: { task: "CVG-AUD25-001", action, plan: ".agent/plans/aud25.md", fingerprint, sourceSha: subject.manifest.sourceSha },
    active_execplan: ".agent/plans/aud25.md"
  };
  current.subject = subject;
  current.verificationRecords = [receipt];
  current.executionEvents = [event];
  current.now = "2026-09-20T17:01:00-03:00";
  current.planContent = plan(action, "CVG-AUD25-001");
  assert.deepEqual(validateControlPlane(current), []);

  const bad = structuredClone(current);
  bad.backlog.items[0]!.status = "READY";
  assert.ok(validateControlPlane(bad).some(({ code }) => code === "AUD25_PREDECESSOR_NOT_INVALIDATED"));
});

test("recognizes AUD26 as a current program with an exact subject manifest", () => {
  const current = input();
  const subject = buildSubjectManifest();
  const action = "CVG-AUD26-001:CONTROL-PLANE-RECONCILIATION";
  const receipt = { ...current.verificationRecords[0]!, id: "VER-CVG-AUD26-001-TEST", task: "CVG-AUD26-001", action, active_action_id: action, candidate_fingerprint: subject.fingerprint };
  const event = { ...current.executionEvents[0]!, event_id: "EVT-CVG-AUD26-001-TEST", task: "CVG-AUD26-001", action, active_action_id: action, candidate_fingerprint: subject.fingerprint, next_state: `IN_PROGRESS; active_action_id=${action}` };
  current.backlog.items = [{ id: "CVG-AUD26-001", status: "IN_PROGRESS", priority: "P0", dependencies: [], candidate_fingerprint: subject.fingerprint, next_action: { id: action, kind: "IMPLEMENT" }, evidence_refs: [receipt.id] }];
  current.state = { ...current.state, active_action_id: action, active_task: "CVG-AUD26-001", next_gate: action, last_gate_record: receipt.id, last_event_id: event.event_id, candidate_fingerprint: subject.fingerprint, active_execplan: ".agent/plans/aud26.md", current_checkpoint: { task: "CVG-AUD26-001", action, plan: ".agent/plans/aud26.md", fingerprint: subject.fingerprint, sourceSha: subject.manifest.sourceSha }, active_checkpoint: { task: "CVG-AUD26-001", action, plan: ".agent/plans/aud26.md", fingerprint: subject.fingerprint, sourceSha: subject.manifest.sourceSha } };
  current.verificationRecords = [receipt];
  current.executionEvents = [event];
  current.subject = subject;
  current.planContent = plan(action, "CVG-AUD26-001");
  assert.deepEqual(validateControlPlane(current), []);
});
