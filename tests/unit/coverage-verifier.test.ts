import assert from "node:assert/strict";
import test from "node:test";
import { COVERAGE_POLICY, STATEMENTS_JUSTIFICATION, evaluateCoverage, parseCoverageOutput, type CoverageReport } from "../../scripts/verify-coverage.ts";
import { knownBadCoverageMutation } from "../../scripts/fixtures/coverage-known-bad-mutation.ts";

const sampleCoverage = [
  "ℹ packages                           |        |          |         |",
  "ℹ  contracts                         |        |          |         |",
  "ℹ   src                              |        |          |         |",
  "ℹ    index.ts                        |  91.00 |    61.00 |   71.00 |",
  "ℹ all files                          |  88.00 |    75.00 |   86.00 |",
].join("\n");

test("coverage parser reports the explicit statements line-equivalent and its justification", () => {
  const report = parseCoverageOutput(sampleCoverage);
  assert.ok(report);
  assert.equal(report.summary.statements, 88);
  assert.equal(report.summary.statementMetric.source, "node-native-line-coverage");
  assert.equal(report.summary.statementMetric.justification, STATEMENTS_JUSTIFICATION);
  assert.equal(report.files[0]?.path, "packages/contracts/src/index.ts");
});

test("coverage policy declares global and all required critical-area thresholds", () => {
  assert.deepEqual(Object.keys(COVERAGE_POLICY.criticalAreas).sort(), ["contracts", "domain", "persistence", "security"]);
  for (const thresholds of Object.values(COVERAGE_POLICY.criticalAreas)) {
    assert.equal(typeof thresholds.line, "number");
    assert.equal(typeof thresholds.branch, "number");
    assert.equal(typeof thresholds.functions, "number");
    assert.equal(typeof thresholds.statements, "number");
    assert.ok(thresholds.paths.length > 0);
  }
});

test("known-bad coverage mutation is deterministically rejected", () => {
  const result = evaluateCoverage({ summary: knownBadCoverageMutation.mutatedSummary, files: [] });
  assert.ok(result.failures.some((failure) => failure.startsWith("global.line=")));
  assert.equal(result.knownBadMutationRejected, true);
  assert.ok(result.failures.some((failure) => failure.startsWith("ratchet.global.line=")));
  assert.equal(result.knownBadRatchetRejected, true);
});

test("global and critical-area thresholds accept a complete report at policy headroom", () => {
  const summary = {
    line: 96,
    branch: 90,
    functions: 96,
    statements: 96,
    statementMetric: {
      value: 96,
      source: "node-native-line-coverage" as const,
      justification: STATEMENTS_JUSTIFICATION,
    },
  };
  const report: CoverageReport = {
    summary,
    files: [
      "packages/auth/src/index.ts",
      "packages/agent-policy/src/index.ts",
      "packages/contracts/src/index.ts",
      "packages/domain/src/index.ts",
      "packages/persistence/src/index.ts",
    ].map((path) => ({ ...summary, path })),
  };
  assert.deepEqual(evaluateCoverage(report).failures, []);
});
