import assert from "node:assert/strict";
import test from "node:test";
import { applyMutationToSource, MUTATION_PLAN, MUTATION_POLICY, mutationScore, type MutationResult } from "../../scripts/verify-mutation.ts";

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
  for (const lane of ["auth", "pdp", "finance", "clinical", "migration"]) assert.ok(lanes.has(lane), `missing mutation lane ${lane}`);
  assert.ok(MUTATION_PLAN.some((entry) => entry.id === "MEL23-026-FINANCE-001" && entry.tests?.includes("tests/unit/finance-balance.test.ts")));
  assert.ok(MUTATION_PLAN.some((entry) => entry.id === "MEL23-026-CLINICAL-001" && entry.tests?.includes("tests/unit/domain.test.ts")));
  assert.equal(MUTATION_POLICY.minimumPlanSize, MUTATION_PLAN.length);
});
