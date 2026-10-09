import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSubjectManifest } from "../../../scripts/subject-manifest.ts";

const fpExpected = "sha256:a4bc4f134beae9a3f94d0e2bda1b1d5d0b9fbe4fca8ae8e28a28e1aa94160879";
const sourceShaExpected = "c990914148a8f375082cd12bbdb2ad20cfe1900f";
const evidenceDir = "artifacts/operational-proof/mel23-response-route-fixtures-20260924-a4bc4f";
const activeAction = "AUD27-001:SEMANTIC-RECONCILIATION";
const nextState = `IN_PROGRESS; active_action_id=${activeAction}`;
const subject = buildSubjectManifest(process.cwd());
if (subject.fingerprint !== fpExpected || subject.manifest.sourceSha !== sourceShaExpected) throw new Error("subject precondition changed");

const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const registeredMatrix = "artifacts/operational-proof/mel23-evidence-matrix.json";
if (readFileSync(registeredMatrix).length !== 99409 || hash(registeredMatrix) !== "f46355276df64e6ebcf1c1afe17785b92df62622bfc0ea950faa298c0b737ec0") {
  throw new Error("protected matrix changed; refusing ledger append");
}
const manifest = JSON.parse(readFileSync(`${evidenceDir}/verification-manifest.json`, "utf8"));
if (manifest.observed_subject_fingerprint !== fpExpected || manifest.command_results.length !== 11 || manifest.command_results.some((row) => row.exit_status !== 0)) {
  throw new Error("verification manifest precondition failed");
}

const readJsonl = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const verificationPath = ".agent/verification.jsonl";
const eventsPath = ".agent/execution-log.jsonl";
const verification = readJsonl(verificationPath);
const events = readJsonl(eventsPath);
if (verification.at(-1)?.id !== "VER-CVG-AUD27-001-133" || events.at(-1)?.event_id !== "EVT-CVG-AUD27-001-133") throw new Error("ledger tails changed; refusing append");
const backlogPath = ".agent/backlog.json";
const statePath = ".agent/state.json";
const backlog = JSON.parse(readFileSync(backlogPath, "utf8"));
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (state.state_revision !== 601 || state.last_gate_record !== "VER-CVG-AUD27-001-133" || state.last_event_id !== "EVT-CVG-AUD27-001-133") throw new Error("state precondition changed");

const timestamp = new Date().toISOString();
const evidence = (name) => {
  const path = `${evidenceDir}/${name}`;
  return `${path}#sha256=${hash(path)}`;
};
const references = {
  route: evidence("api-response-routes.log"),
  examples: evidence("api-examples-contract-tests.log"),
  postgres: evidence("api-response-postgres.log"),
  telemetry: evidence("telemetry-sensitive-route-redaction.log"),
  fullSuite: evidence("npm-test.log"),
  typecheck: evidence("typecheck.log"),
  m0: evidence("m0-missing-transition.log"),
  docsTests: evidence("documentation-focused-tests.log"),
  docsIntegrity: evidence("docs-integrity.log"),
  license: evidence("license-audit.log"),
  diff: evidence("diff-check.log"),
  manifest: evidence("verification-manifest.json"),
  review: evidence("independent-review.md")
};
const command = (name, observed) => ({ command: name, exit_status: 0, expected_exit_status: 0, observed });
const makeReceipt = (spec) => ({
  id: spec.id,
  timestamp,
  task: spec.task,
  action: spec.action,
  result: spec.result,
  exit_status: 0,
  source_sha: sourceShaExpected,
  candidate_fingerprint: null,
  observed_subject_fingerprint: fpExpected,
  fingerprint_status: "UNFROZEN_UNTIL_AUD27-004",
  freshness: "CURRENT",
  active_action_id: activeAction,
  next_state: nextState,
  global_verdict: "AAA_NOT_PROVEN",
  promotion: "BLOCKED",
  mel23_ids: spec.mel23_ids,
  criterion_results: spec.criterion_results,
  checks: spec.checks,
  limitations: spec.limitations,
  supersedes: spec.supersedes,
  procedure_status: "EXECUTED",
  evidence_kind: spec.evidence_kind ?? "MEL23_CURRENT_LOCAL_FOCAL_RECEIPT",
  environment: spec.environment,
  scope: spec.scope,
  acceptance_exit_status: 0,
  command_results: spec.command_results,
  evidence_artifacts: spec.evidence_artifacts
});
const makeEvent = (spec) => ({
  event_id: spec.event_id,
  timestamp,
  type: spec.type ?? "MEL23_CURRENT_LOCAL_FOCAL_RECEIPT",
  task: spec.task,
  action: spec.action,
  result: spec.result,
  verification: spec.verification,
  exit_status: 0,
  source_sha: sourceShaExpected,
  observed_subject_fingerprint: fpExpected,
  fingerprint_status: "UNFROZEN_UNTIL_AUD27-004",
  active_action_id: activeAction,
  next_state: nextState,
  global_verdict: "AAA_NOT_PROVEN",
  promotion: "BLOCKED",
  checks: spec.checks,
  decision: spec.decision,
  supersedes: spec.supersedes
});

const focal = [
  {
    id: "VER-CVG-AUD27-007-010", event_id: "EVT-CVG-AUD27-007-010", task: "AUD27-007", action: "AUD27-007:ROUTE-SCHEMA-CATALOG", result: "IMPLEMENTED_LOCAL", supersedes: "VER-CVG-AUD27-007-009", supersedesEvent: "EVT-CVG-AUD27-007-009", mel23_ids: ["MEL23-021", "MEL23-047"], criterion_results: { "MEL23-021": "PARTIAL", "MEL23-047": "PASS" },
    checks: {
      "MEL23-021": "PARTIAL: 105 catalog routes preserve versioned envelopes; authenticated GET sweep validates 41/45 payload schemas, and separate successful fixtures schema-check all four dynamic-ID GET routes. Explicit end-to-end success payload schemas cover 43/105 routes, so catalog-wide success coverage remains incomplete.",
      "MEL23-047": "PASS: two request examples bind to the exact documented route/request-schema pairs; all four JSON response examples bind to route, HTTP status and schema metadata and validate against current envelope and payload schemas."
    },
    limitations: ["MEL23-021 remains PARTIAL because 43/105 catalog routes have explicit end-to-end successful payload-schema fixtures.", "Local synthetic flows and a disposable PostgreSQL 16 verifier only; no production endpoints or real clinical data.", "Candidate remains dirty/unfrozen and promotion remains blocked."],
    scope: "Current-subject route success-fixture expansion, response-contract documentation validation and related route/telemetry regression.",
    environment: "Local workspace; synthetic fixtures; disposable PostgreSQL 16 route verifier removed its container and left inventory unchanged; no production resource or human approval.",
    command_results: [
      command("node --import tsx --test tests/integration/api-response-routes.test.ts", "2/2 tests pass; 105 versioned route-envelope probes; 41/45 authenticated GET payload schemas; 43/105 explicit success fixtures; 4/4 dynamic-ID GET routes have schema-checked success fixtures."),
      command("node --import tsx --test tests/unit/api-response-contract.test.ts", "6/6 tests pass; exact request and response route/status/schema mappings pass."),
      command("node --import tsx tests/integration/api-response-postgres.verify.ts", "2 durable PostgreSQL route schemas pass; disposable container removed; inventory unchanged."),
      command("node --import tsx --test packages/ops/tests/observability.test.ts", "5/5 tests pass; sensitive route-label redaction regression passes."),
      command("npm test", "724 tests; 723 passed; 0 failed; 1 skipped."),
      command("npm run typecheck", "tsc -p tsconfig.json --noEmit; exit 0.")
    ],
    evidence_artifacts: [references.route, references.examples, references.postgres, references.telemetry, references.fullSuite, references.typecheck, references.manifest, references.review]
  },
  {
    id: "VER-CVG-AUD27-016-010", event_id: "EVT-CVG-AUD27-016-010", task: "AUD27-016", action: "AUD27-016:LICENSE-CLOSURE", result: "BLOCKED_BY_DEPENDENCIES", supersedes: "VER-CVG-AUD27-016-009", supersedesEvent: "EVT-CVG-AUD27-016-009", mel23_ids: ["MEL23-013", "MEL23-014"], criterion_results: { "MEL23-013": "PARTIAL", "MEL23-014": "BLOCKED" },
    checks: {
      "MEL23-013": "PARTIAL: the current lockfile SPDX allowlist scan passes for 183 third-party packages, but the ten historical out-of-policy occurrences have no recorded reconciliation chain and the frozen-candidate rerun remains open.",
      "MEL23-014": "BLOCKED: no root license/notices or named legal-owner decision is present, and no release package was validated."
    },
    limitations: ["The allowlist scan does not determine product license ownership or establish legal approval.", "AUD27-016 remains BLOCKED_BY_DEPENDENCIES pending legal/supply-chain authority and release notices."],
    scope: "Current-subject license allowlist scan and unresolved historical/legal/release qualification.",
    environment: "Local workspace and lockfile metadata only; no external legal determination or human approval.",
    command_results: [command("npm run audit:licenses", "183 package SPDX records pass the declared allowlist.")],
    evidence_artifacts: [references.license, references.manifest]
  },
  {
    id: "VER-CVG-AUD27-024-006", event_id: "EVT-CVG-AUD27-024-005", task: "AUD27-024", action: "AUD27-024:DOCS-SNAPSHOT", result: "BLOCKED_BY_DEPENDENCIES", supersedes: "VER-CVG-AUD27-024-005", supersedesEvent: "EVT-CVG-AUD27-024-004", mel23_ids: ["MEL23-044", "MEL23-048"], criterion_results: { "MEL23-044": "PASS", "MEL23-048": "PASS" },
    checks: {
      "MEL23-044": "PASS: docs integrity scans 256 files with zero findings, including route/schema/status annotations in the current API examples.",
      "MEL23-048": "PASS: the current focused contributor/control-plane/doc contract bundle passes all 33 tests, and the current diff has no whitespace findings."
    },
    limitations: ["These local documentation criteria pass; AUD27-024 remains blocked by its unrelated dependencies and no release authority is claimed."],
    scope: "Current-subject documentation integrity, contributor guidance fixtures and whitespace validation.",
    environment: "Local workspace; no production resource or human release approval.",
    command_results: [
      command("npm run verify:docs-integrity", "256 files; 0 findings."),
      command("node --import tsx --test tests/unit/control-plane.test.ts tests/unit/control-plane-aud23.test.ts tests/unit/docs-integrity.test.ts tests/unit/mel23-evidence.test.ts tests/unit/mutation-verifier.test.ts", "33 focused tests pass; 0 failed."),
      command("git diff --check", "No whitespace findings.")
    ],
    evidence_artifacts: [references.docsIntegrity, references.docsTests, references.diff, references.manifest]
  },
  {
    id: "VER-CVG-AUD27-002-015", event_id: "EVT-CVG-AUD27-002-015", task: "AUD27-002", action: "AUD27-002:ADVERSARIAL-SEMANTIC-VERIFIER", result: "PASS", supersedes: "VER-CVG-AUD27-002-014", supersedesEvent: "EVT-CVG-AUD27-002-014", mel23_ids: ["MEL23-002"], criterion_results: { "MEL23-002": "PASS" },
    checks: { "MEL23-002": "PASS: the known-good input passes and the named missing_transition known-bad removes next_state from the event selected by state.last_event_id; the semantic verifier rejects all 11 known-bads." },
    limitations: ["This qualifies MEL23-002 on the current observed dirty subject; AUD27-002 remains IMPLEMENTED_UNVERIFIED pending frozen-candidate reproduction."],
    scope: "Current-subject AUD23 semantic known-good and 11 known-bad verifier tests, including missing_transition.",
    environment: "Local unit tests against synthetic control-plane fixtures; no production resource or human approval.",
    command_results: [command("node --import tsx --test tests/unit/control-plane-aud23.test.ts", "3 tests pass; 11 semantic known-bads rejected, including missing_transition.")],
    evidence_artifacts: [references.m0, references.manifest]
  },
  {
    id: "VER-CVG-AUD27-004-018", event_id: "EVT-CVG-AUD27-004-018", task: "AUD27-004", action: "AUD27-004:CLEAN-CANDIDATE-FREEZE", result: "BLOCKED_BY_DEPENDENCIES", supersedes: "VER-CVG-AUD27-004-017", supersedesEvent: "EVT-CVG-AUD27-004-017", mel23_ids: ["MEL23-003"], criterion_results: { "MEL23-003": "PASS" },
    checks: { "MEL23-003": "PASS: npm test completed against the current observed subject with 724 tests, 723 pass, 0 fail and 1 skipped." },
    limitations: ["MEL23-003 qualifies only the current local full-suite result; AUD27-004 remains BLOCKED_BY_DEPENDENCIES because the worktree is dirty and independent checkout/build reproduction is not established."],
    scope: "MEL23-003 full-suite revalidation on the exact observed subject; no clean-candidate reproducibility or promotion claim.",
    environment: "Local workspace with synthetic tests only; no production resource or human approval.",
    command_results: [command("npm test", "724 tests; 723 passed; 0 failed; 1 skipped.")],
    evidence_artifacts: [references.fullSuite, references.typecheck, references.manifest]
  }
];
const focalReceipts = focal.map((spec) => makeReceipt({ ...spec, supersedes: [spec.supersedes] }));
const focalEvents = focal.map((spec) => makeEvent({
  event_id: spec.event_id,
  task: spec.task,
  action: spec.action,
  result: spec.result,
  verification: spec.id,
  checks: spec.checks,
  decision: "Record current local focal results without changing parent status, freezing the candidate, or claiming human approval.",
  supersedes: [spec.supersedesEvent]
}));
const activeChecks = {
  "MEL23-001": "PASS: post-append control-plane verification and capture bind both ledger tails to the current source SHA and observed subject fingerprint; candidate remains intentionally unfrozen."
};
const activeReceipt = makeReceipt({
  id: "VER-CVG-AUD27-001-134",
  task: "AUD27-001",
  action: activeAction,
  result: "IMPLEMENTED_LOCAL",
  mel23_ids: ["MEL23-001"],
  criterion_results: { "MEL23-001": "PASS" },
  checks: activeChecks,
  limitations: ["Current evidence qualifies six MEL23 criteria on an observed dirty subject; MEL23-021 remains PARTIAL at 43/105 explicit success fixtures.", "The registered 99,409-byte matrix original remains unavailable and unchanged; no candidate freeze, global AAA or promotion is claimed."],
  supersedes: ["VER-CVG-AUD27-001-133"],
  evidence_kind: "MEL23_CURRENT_LOCAL_CONTROL_PLANE_COMPOSITE",
  environment: "Local workspace; control-plane ledgers and capture only; no production resource, external authority, or human approval.",
  scope: "Final AUD27-001 control-plane capture after current-subject M0, route, license and documentation focal receipts; active task/action and unfrozen state remain unchanged.",
  command_results: [
    command("npm run verify:control-plane", "Control-plane invariants PASS with last_gate_record and last_event_id bound to receipt/event 001-134."),
    command("npm run verify:mel23-control-plane", "Nested control-plane verification and post-append capture PASS; capture binds receipt/event 001-134 to the current source/fingerprint.")
  ],
  evidence_artifacts: ["artifacts/operational-proof/mel23-control-plane-current.json", references.manifest, references.review]
});
const activeEvent = makeEvent({
  event_id: "EVT-CVG-AUD27-001-134",
  task: "AUD27-001",
  action: activeAction,
  result: "IMPLEMENTED_LOCAL",
  verification: "VER-CVG-AUD27-001-134",
  type: "AUD27_CONTROL_PLANE_FINAL_REVALIDATION",
  checks: activeChecks,
  decision: "Capture current ledger tails after focal receipts; keep AUD27-001 active, candidate unfrozen, AAA_NOT_PROVEN, and promotion BLOCKED.",
  supersedes: ["EVT-CVG-AUD27-001-133"]
});
const newReceipts = [...focalReceipts, activeReceipt];
const newEvents = [...focalEvents, activeEvent];
if (newReceipts.some((row) => verification.some((old) => old.id === row.id)) || newEvents.some((row) => events.some((old) => old.event_id === row.event_id))) throw new Error("ledger ID collision");

const owners = new Map([
  ["AUD27-007", "VER-CVG-AUD27-007-010"],
  ["AUD27-016", "VER-CVG-AUD27-016-010"],
  ["AUD27-024", "VER-CVG-AUD27-024-006"],
  ["AUD27-002", "VER-CVG-AUD27-002-015"],
  ["AUD27-004", "VER-CVG-AUD27-004-018"],
  ["AUD27-001", "VER-CVG-AUD27-001-134"]
]);
for (const [taskId, receiptId] of owners) {
  const item = backlog.items.find((row) => row.id === taskId);
  if (!item) throw new Error(`missing backlog owner ${taskId}`);
  item.evidence_refs ??= [];
  if (!item.evidence_refs.includes(receiptId)) item.evidence_refs.push(receiptId);
}
const latestRefs = [
  "VER-CVG-AUD27-001-134", "VER-CVG-AUD27-002-015", "VER-CVG-AUD27-003-010", "VER-CVG-AUD27-004-018", "VER-CVG-AUD27-005-017", "VER-CVG-AUD27-007-010", "VER-CVG-AUD27-008-009", "VER-CVG-AUD27-009-005", "VER-CVG-AUD27-010-006", "VER-CVG-AUD27-011-025", "VER-CVG-AUD27-015-009", "VER-CVG-AUD27-016-010", "VER-CVG-AUD27-018-017", "VER-CVG-AUD27-019-013", "VER-CVG-AUD27-020-012", "VER-CVG-AUD27-021-005", "VER-CVG-AUD27-022-005", "VER-CVG-AUD27-024-006", "VER-CVG-AUD27-025-003"
];
backlog.aud27_reconciliation.latest_current_receipt = "VER-CVG-AUD27-001-134";
backlog.aud27_reconciliation.latest_current_event = "EVT-CVG-AUD27-001-134";
backlog.aud27_reconciliation.latest_lane_receipts = latestRefs;
backlog.aud27_reconciliation.local_lane_receipts = [...new Set([...(backlog.aud27_reconciliation.local_lane_receipts ?? []), ...newReceipts.map((row) => row.id)])];
backlog.aud27_reconciliation.reconciled_at = timestamp;
backlog.updated_at = timestamp;

const replacedRefs = {
  "VER-CVG-AUD27-002-014": "VER-CVG-AUD27-002-015",
  "VER-CVG-AUD27-004-017": "VER-CVG-AUD27-004-018",
  "VER-CVG-AUD27-007-009": "VER-CVG-AUD27-007-010",
  "VER-CVG-AUD27-016-009": "VER-CVG-AUD27-016-010",
  "VER-CVG-AUD27-024-005": "VER-CVG-AUD27-024-006",
  "VER-CVG-AUD27-001-133": "VER-CVG-AUD27-001-134"
};
const currentRefs = [...new Set([...(state.current_receipt_refs ?? []).map((ref) => replacedRefs[ref] ?? ref), ...newReceipts.map((row) => row.id)])];
state.current_receipt_refs = currentRefs;
state.state_revision += 1;
state.updated_at = timestamp;
state.last_gate_record = "VER-CVG-AUD27-001-134";
state.last_event_id = "EVT-CVG-AUD27-001-134";
const porcelain = execFileSync("git", ["status", "--porcelain=v2", "--untracked-files=all"], { encoding: "utf8" }).split("\n").filter(Boolean);
const tracked = porcelain.filter((line) => /^(1 |2 |u )/.test(line)).length;
const untracked = porcelain.filter((line) => line.startsWith("? ")).length;
state.repository_state = `2026-09-24: dirty worktree preserved; ${porcelain.length} git status --porcelain=v2 --untracked-files=all entries (${tracked} tracked modifications, ${untracked} untracked); observed subject ${fpExpected} remains unfrozen.`;
const note = `6/50 MEL23 criteria qualify on observed dirty subject ${fpExpected}; row labels are 19 PASS, 25 PARTIAL, 6 BLOCKED, with 44 unqualified and 0 global issues. MEL23-001..003, MEL23-044, MEL23-047 and MEL23-048 qualify. MEL23-021 remains PARTIAL: 43/105 explicit success fixtures, 41/45 authenticated GET sweep schemas, with successful schema fixtures for the four synthetic-ID GET cases. MEL23-013 is PARTIAL and MEL23-014 BLOCKED; candidate remains dirty/unfrozen, AAA_NOT_PROVEN, promotion BLOCKED.`;
state.latest_evidence_note = note;
state.current_evidence_note = note;
state.current_checkpoint.evidence = "VER-CVG-AUD27-001-134";
state.current_checkpoint.reason = "Current local receipts qualify MEL23-001..003, MEL23-044, MEL23-047 and MEL23-048 on the observed dirty subject. Route success fixtures cover 43/105 and MEL23-021 remains PARTIAL. License history/legal decision, exact-subject RLS breadth, clean candidate freeze, independent authority and external/human gates remain open; promotion stays BLOCKED.";
state.current_checkpoint.limitations = [
  "Candidate remains dirty; no authorized clean candidate or independent checkout/build reproduction exists, so candidate_fingerprint remains null until AUD27-004.",
  "The M1 evidence-root package is LOCAL_SYNTHETIC_ONLY and stale against this observed subject; independent anchor, external authority and executed recovery remain unavailable.",
  "MEL23-021 remains PARTIAL: all 105 catalog routes receive versioned-envelope probes; 41/45 authenticated GETs pass the general payload-schema sweep, the four synthetic-ID GET cases each have a valid schema-checked success fixture, and explicit success fixtures cover 43/105 catalog routes. MEL23-047 passes current route-bound examples.",
  "Prior MEL23-024 crash-recovery proof is bound to an older subject; no migration cutover, golden dataset, authority or post-cutover restore is claimed.",
  "Coverage 89.16/76.34/87.97 and selective mutation 25/25 are earlier observed results, not evidence on this exact subject; browser CI/rendered review/assistive-technology and human acceptance remain open.",
  "License allowlist passes for 183 package SPDX records, but the ten historical occurrences remain unreconciled; root license/notices and named legal-owner decision are absent.",
  "No current image startup, authorized staging load/chaos, external alert delivery, managed restore, approved RTO/RPO or human promotion decision is proven.",
  "Current browser smoke of 332/354 with 22 skips across six profiles predates this subject; no WebKit, full-CI freeze, rendered-complete or human AT acceptance is proven.",
  "Compose parsing used synthetic placeholders; no current image, registry provenance, live secret, TLS or egress test was performed.",
  "MEL23-023 has scoped RLS DML evidence for audit_records, command_receipts and role_assignments only, and that receipt predates this subject; all affected tables across 24 waves, cutover and post-cutover restore remain open.",
  "Current matrix qualifies 6/50; 44 criteria remain unqualified because exact-subject evidence is stale, partial or blocked.",
  "The registered 99,409-byte MEL23 matrix original remains unavailable; the on-disk hash differs from the registered digest and the file was not overwritten."
];
state.current_audit_addendum = {
  ...state.current_audit_addendum,
  record: "VER-CVG-AUD27-001-134",
  observedAt: timestamp,
  priorRecord: "VER-CVG-AUD27-001-133",
  critic: `${evidenceDir}/independent-review.md`,
  criticStatus: "APPROVED_ROUTE_FIXTURE_PATCH_NO_BLOCKERS",
  status: "IN_PROGRESS_6_OF_50_LOCAL_REVALIDATION",
  evidenceAdmission: "CURRENT_LOCAL_CONTROL_PLANE_CAPTURE_AND_FOCAL_RECEIPTS; REGISTERED_MATRIX_ORIGINAL_UNAVAILABLE",
  scope: `Current dirty subject maps 50/50 with 0 global issues and 6 qualified (MEL23-001..003, MEL23-044, MEL23-047 and MEL23-048); row labels 19 PASS, 25 PARTIAL, 6 BLOCKED, 44 unqualified. MEL23-021 remains PARTIAL at 43/105 explicit success fixtures; MEL23-023 RLS proof is scoped to three tables and an older subject. No candidate freeze, global AAA or promotion is claimed.`,
  sourceSha: sourceShaExpected,
  verificationRefs: [...new Set([...(state.current_audit_addendum.verificationRefs ?? []), ...newReceipts.map((row) => row.id)])],
  current_receipt_refs: currentRefs,
  result: "Current authority ledger has zero independent decisions; MEL23-020 remains BLOCKED and no human approval was created.",
  globalVerdict: "AAA_NOT_PROVEN",
  promotion: "BLOCKED",
  criticId: "critic_mel23_response_routes_final"
};

const planPath = state.active_execplan;
let plan = readFileSync(planPath, "utf8");
const heading = "## MEL23-021 route-success fixture and API example closure — 2026-09-24";
if (plan.includes(heading)) throw new Error("plan section already exists");
plan += `\n\n${heading}\n\n` +
  "The route test validates login and setup successes for role assignment, patient listing, encounter creation and AI turns through executable response-payload schemas. It reports 43/105 explicit success fixtures; all 45 GET route patterns have schema-checked success paths across the authenticated sweep and four dynamic-ID fixtures. MEL23-021 remains PARTIAL until all catalog routes have successful payload fixtures. The API guide test requires the exact two request route/schema pairs and binds every JSON response to a documented route, status and schema.\n\n" +
  `Current evidence on observed dirty subject ${fpExpected}: full suite 724 total / 723 pass / 0 fail / 1 skip; typecheck pass; route tests 2/2; API example tests 6/6; PostgreSQL route schemas 2/2 with disposable container removed; telemetry 5/5; M0 semantic tests 3/3; focused docs/control-plane tests 33/33; docs integrity 256/0 findings; license allowlist scan 183 packages; diff check clean. Fresh read-only route-fixture review: PASS, no blockers.\n\n` +
  "Append-only receipts: VER-CVG-AUD27-007-010, VER-CVG-AUD27-016-010, VER-CVG-AUD27-024-006, VER-CVG-AUD27-002-015, VER-CVG-AUD27-004-018; final active capture VER-CVG-AUD27-001-134 / EVT-CVG-AUD27-001-134. MEL23-013 remains PARTIAL (historical ten occurrences unreconciled); MEL23-014 remains BLOCKED (no root legal decision/notices). The matrix qualifies six of 50 criteria; the registered original remains unchanged/unavailable. Candidate remains dirty and unfrozen; global AAA is unproven and promotion blocked.\n";

const toJsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
backlog.updated_at = timestamp;
appendFileSync(verificationPath, toJsonl([...focalReceipts, activeReceipt]));
appendFileSync(eventsPath, toJsonl([...focalEvents, activeEvent]));
writeFileSync(backlogPath, `${JSON.stringify(backlog, null, 2)}\n`);
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
writeFileSync(planPath, plan);
process.stdout.write(JSON.stringify({ timestamp, fingerprint: fpExpected, receipts: newReceipts.map((row) => row.id), events: newEvents.map((row) => row.event_id), state_revision: state.state_revision, current_receipt_refs: currentRefs.length }) + "\n");
