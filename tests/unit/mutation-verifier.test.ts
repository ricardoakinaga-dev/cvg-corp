import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMutationToSource, classifyMutationRun, MUTATION_PLAN, MUTATION_POLICY, mutationScore, observeTestRun, type MutationResult, type TestRunEvent } from "../../scripts/verify-mutation.ts";

const mutation = {
  id: "TEST-MUTANT",
  file: "fixture.ts",
  find: "return true;",
  replace: "return false;",
  rationale: "fixture"
} as const;

test("mutation application requires one unambiguous production anchor", () => {
  assert.equal(applyMutationToSource("function value() { return true; }", mutation), "function value() { return false; }");
  assert.throws(() => applyMutationToSource("return true; return true;", mutation), /expected exactly one/);
  assert.throws(() => applyMutationToSource("return false;", mutation), /expected exactly one/);
});

test("mutation score excludes invalid mutants but exposes them", () => {
  const results = [
    { ...mutation, status: "KILLED", exitStatus: 1, signal: null, output: "" },
    { ...mutation, id: "SURVIVED", status: "SURVIVED", exitStatus: 0, signal: null, output: "" },
    { ...mutation, id: "INVALID", status: "INVALID", exitStatus: null, signal: null, output: "" }
  ] satisfies MutationResult[];
  assert.deepEqual(mutationScore(results), { killed: 1, survived: 1, invalid: 1, score: 0.5 });
});

test("MEL23-026 mutation plan covers authorization, finance, clinical, and persistence seams", () => {
  const lanes = new Set(MUTATION_PLAN.map((entry) => entry.lane).filter((lane): lane is string => Boolean(lane)));
  for (const lane of ["auth", "pdp", "finance", "clinical", "migration", "agenda", "audit", "idempotency", "persistence"]) assert.ok(lanes.has(lane), `missing mutation lane ${lane}`);
  assert.ok(MUTATION_PLAN.some((entry) => entry.id === "MEL23-026-FINANCE-001" && entry.tests?.includes("tests/unit/finance-balance.test.ts")));
  assert.ok(MUTATION_PLAN.some((entry) => entry.id === "MEL23-026-CLINICAL-001" && entry.tests?.includes("tests/unit/domain.test.ts")));
  assert.equal(MUTATION_POLICY.minimumPlanSize, MUTATION_PLAN.length);
});

test("FQ-04: only a failure thrown inside a running test kills a mutant", () => {
  const thrown: TestRunEvent = { outcome: "fail", kind: "test", failureType: "testCodeFailure", processExit: false, thrown: true };
  const passed: TestRunEvent = { outcome: "pass", kind: "test", failureType: null, processExit: false, thrown: false };
  const fileCrash: TestRunEvent = { outcome: "fail", kind: "test", failureType: "testCodeFailure", processExit: true, thrown: false };
  const run = { status: 1, signal: null, timedOut: false, spawnFailed: false, output: "ℹ fail 1", events: [thrown, passed] } as const;
  assert.equal(classifyMutationRun(run), "KILLED");
  assert.equal(classifyMutationRun({ ...run, events: [thrown, { ...thrown, outcome: "fail", kind: "suite", failureType: "subtestsFailed", thrown: false }] }), "KILLED");
  assert.equal(classifyMutationRun({ ...run, status: 0, events: [passed] }), "SURVIVED");
  assert.equal(classifyMutationRun({ ...run, status: 0, events: [] }), "INVALID");
  assert.equal(classifyMutationRun({ ...run, timedOut: true, status: null }), "INVALID");
  assert.equal(classifyMutationRun({ ...run, signal: "SIGKILL", status: null }), "INVALID");
  assert.equal(classifyMutationRun({ ...run, spawnFailed: true, status: null }), "INVALID");
  assert.equal(classifyMutationRun({ ...run, events: null }), "INVALID");
  assert.equal(classifyMutationRun({ ...run, events: [fileCrash] }), "INVALID");
  assert.equal(classifyMutationRun({ ...run, events: [thrown, fileCrash] }), "INVALID");
  for (const failureType of ["testTimeoutFailure", "hookFailed", "unhandledRejection", "uncaughtException", "cancelledByParent"]) {
    assert.equal(classifyMutationRun({ ...run, events: [{ ...thrown, failureType }] }), "INVALID", failureType);
    // A side effect of the mutant next to a real assertion failure does not hide the kill.
    assert.equal(classifyMutationRun({ ...run, events: [thrown, { ...thrown, failureType }] }), "KILLED", failureType);
  }
  assert.equal(classifyMutationRun({ ...run, events: [passed] }), "INVALID");
  assert.equal(classifyMutationRun({ ...run, status: 13 }), "INVALID");
});

test("FQ-04: the real runner separates assertion failures from files that never ran an assertion", () => {
  const directory = mkdtempSync(join(tmpdir(), "cvg-mutation-classifier-"));
  const fixtures: Record<string, { source: string; expected: MutationResult["status"] }> = {
    "assertion.test.ts": { source: 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("a", () => { assert.equal(1, 2); });\ntest("b", () => {});\n', expected: "KILLED" },
    "runtime-error.test.ts": { source: 'import test from "node:test";\ntest("a", () => { (undefined as unknown as { x: number }).x; });\n', expected: "KILLED" },
    "passing.test.ts": { source: 'import test from "node:test";\ntest("a", () => {});\n', expected: "SURVIVED" },
    "syntax-error.test.ts": { source: 'import test from "node:test";\nconst broken = ;\ntest("a", () => {});\n', expected: "INVALID" },
    "process-exit.test.ts": { source: 'import test from "node:test";\nprocess.exit(1);\ntest("a", () => {});\n', expected: "INVALID" },
    "top-level-throw.test.ts": { source: 'import test from "node:test";\nthrow new Error("synthetic load failure");\n', expected: "INVALID" }
  };
  try {
    for (const [name, fixture] of Object.entries(fixtures)) writeFileSync(join(directory, name), fixture.source);
    for (const [name, fixture] of Object.entries(fixtures)) {
      const run = observeTestRun(process.cwd(), [join(directory, name)], 60_000);
      // The text summary cannot tell these cases apart; only the events can.
      if (fixture.expected !== "SURVIVED") assert.match(run.output, /^ℹ fail 1$/m, name);
      assert.equal(classifyMutationRun(run), fixture.expected, name);
    }
    const mixed = observeTestRun(process.cwd(), [join(directory, "assertion.test.ts"), join(directory, "process-exit.test.ts")], 60_000);
    assert.equal(classifyMutationRun(mixed), "INVALID");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
