import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { knownBadCoverageMutation } from "./fixtures/coverage-known-bad-mutation.ts";

export const STATEMENTS_SOURCE = "node-native-line-coverage" as const;
export const STATEMENTS_JUSTIFICATION =
  "Node's native test-coverage report exposes line, branch, and function metrics but no statement count; statements is therefore an explicit line-coverage equivalent derived from the emitted coverage data, not an unreported native statement count.";

export type CoverageMetric = "line" | "branch" | "functions" | "statements";
export type CoverageThresholds = Record<CoverageMetric, number>;

export type StatementMetric = {
  value: number;
  source: typeof STATEMENTS_SOURCE;
  justification: string;
};

export type CoverageSummary = {
  line: number;
  branch: number;
  functions: number;
  statements: number;
  statementMetric: StatementMetric;
};

export type CoverageFile = CoverageSummary & {
  path: string;
};

export type CoverageReport = {
  summary: CoverageSummary;
  files: CoverageFile[];
};

export type CoveragePolicy = {
  global: CoverageThresholds;
  criticalAreas: Record<string, CoverageThresholds & { paths: string[] }>;
};

export type CoverageRatchet = {
  schemaVersion: 1;
  kind: "CVG-AUD27-COVERAGE-RATCHET";
  baselineSourceSha: string;
  baselineCapturedAt: string;
  fingerprintStatus: "OBSERVED_ONLY_UNFROZEN_UNTIL_AUD27-004";
  global: CoverageThresholds;
  criticalAreas: Record<string, CoverageThresholds>;
};

export const COVERAGE_POLICY: CoveragePolicy = {
  global: {
    line: 80,
    branch: 65,
    functions: 75,
    statements: 80,
  },
  criticalAreas: {
    security: {
      paths: ["packages/auth/src", "packages/agent-policy/src"],
      line: 90,
      branch: 65,
      functions: 85,
      statements: 90,
    },
    contracts: {
      paths: ["packages/contracts/src"],
      line: 85,
      branch: 60,
      functions: 70,
      statements: 85,
    },
    persistence: {
      paths: ["packages/persistence/src"],
      line: 80,
      branch: 60,
      functions: 80,
      statements: 80,
    },
    domain: {
      paths: ["packages/domain/src"],
      line: 90,
      branch: 75,
      functions: 85,
      statements: 90,
    },
  },
};

export const COVERAGE_RATCHET = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "coverage-ratchet.json"), "utf8")) as CoverageRatchet;

const METRICS: readonly CoverageMetric[] = ["line", "branch", "functions", "statements"];

function testFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...testFiles(path));
    else if (entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

function numberFrom(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricRow(line: string): { indent: number; label: string; values: Omit<CoverageSummary, "statementMetric" | "statements"> } | null {
  const match = line.match(/^ℹ (?<indent> *)(?<label>[^|]+?)\s+\|\s+(?<line>[0-9.]+)\s+\|\s+(?<branch>[0-9.]+)\s+\|\s+(?<functions>[0-9.]+)\s+\|/);
  const groups = match?.groups;
  if (!groups || groups.indent === undefined || groups.label === undefined || groups.line === undefined || groups.branch === undefined || groups.functions === undefined) return null;
  const lineValue = numberFrom(groups.line);
  const branchValue = numberFrom(groups.branch);
  const functionsValue = numberFrom(groups.functions);
  if (lineValue === null || branchValue === null || functionsValue === null) return null;
  return {
    indent: groups.indent.length,
    label: groups.label.trim(),
    values: { line: lineValue, branch: branchValue, functions: functionsValue },
  };
}

function withStatementMetric(values: Omit<CoverageSummary, "statementMetric" | "statements">): CoverageSummary {
  return {
    ...values,
    statements: values.line,
    statementMetric: {
      value: values.line,
      source: STATEMENTS_SOURCE,
      justification: STATEMENTS_JUSTIFICATION,
    },
  };
}

export function parseCoverageOutput(output: string): CoverageReport | null {
  const hierarchy: Array<{ indent: number; label: string }> = [];
  const files: CoverageFile[] = [];
  let summary: CoverageSummary | null = null;

  for (const line of output.split("\n")) {
    const tableLabel = line.match(/^ℹ (?<indent> *)(?<label>[^|]+?)\s+\|/);
    const row = metricRow(line);
    const tableGroups = tableLabel?.groups;
    if (!tableGroups || tableGroups.indent === undefined || tableGroups.label === undefined) continue;
    const indent = row?.indent ?? tableGroups.indent.length;
    const label = row?.label ?? tableGroups.label.trim();
    while (hierarchy.at(-1)?.indent !== undefined && (hierarchy.at(-1)?.indent ?? -1) >= indent) hierarchy.pop();
    hierarchy.push({ indent, label });
    if (!row) continue;
    const values = withStatementMetric(row.values);
    if (row.label.toLowerCase() === "all files") {
      summary = values;
      continue;
    }
    files.push({ ...values, path: hierarchy.map(({ label }) => label).join("/") });
  }

  return summary ? { summary, files } : null;
}

// Node pads the uncovered-lines column of the coverage table with trailing
// spaces. The artifact is tracked and CI checks `git diff --check` after this
// gate, so it is written without them; parsing always uses the raw output.
export function coverageArtifactText(output: string): string {
  return output.replace(/[ \t]+$/gm, "");
}

export function parseSummary(output: string): CoverageSummary | null {
  return parseCoverageOutput(output)?.summary ?? null;
}

function metricValue(summary: CoverageSummary, metric: CoverageMetric): number {
  return summary[metric];
}

export function globalCoverageFailures(summary: CoverageSummary, thresholds = COVERAGE_POLICY.global): string[] {
  return METRICS
    .filter((metric) => metricValue(summary, metric) < thresholds[metric])
    .map((metric) => `global.${metric}=${metricValue(summary, metric).toFixed(2)}%<${thresholds[metric]}%`);
}

function pathMatches(path: string, prefix: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

function areaSummary(files: CoverageFile[], paths: string[]): CoverageSummary | null {
  const selected = files.filter((file) => paths.some((prefix) => pathMatches(file.path, prefix)));
  if (selected.length === 0) return null;
  return withStatementMetric({
    line: Math.min(...selected.map((file) => file.line)),
    branch: Math.min(...selected.map((file) => file.branch)),
    functions: Math.min(...selected.map((file) => file.functions)),
  });
}

export type CoverageEvaluation = {
  failures: string[];
  areas: Record<string, { files: number; summary: CoverageSummary | null; thresholds: CoverageThresholds }>;
  knownBadMutationRejected: boolean;
  ratchetFailures: string[];
  knownBadRatchetRejected: boolean;
};

export function coverageRatchetFailures(
  summary: CoverageSummary,
  areas: Record<string, { summary: CoverageSummary | null }>
): string[] {
  const failures = globalCoverageFailures(summary, COVERAGE_RATCHET.global).map((failure) => failure.replace("global.", "ratchet.global."));
  for (const [area, thresholds] of Object.entries(COVERAGE_RATCHET.criticalAreas)) {
    const areaSummary = areas[area]?.summary;
    if (!areaSummary) {
      failures.push(`ratchet.${area}.files=0<1`);
      continue;
    }
    failures.push(...globalCoverageFailures(areaSummary, thresholds).map((failure) => failure.replace("global.", `ratchet.${area}.`)));
  }
  return failures;
}

export function evaluateCoverage(report: CoverageReport): CoverageEvaluation {
  const failures = globalCoverageFailures(report.summary);
  const areas: CoverageEvaluation["areas"] = {};

  for (const [area, policy] of Object.entries(COVERAGE_POLICY.criticalAreas)) {
    const selectedFiles = report.files.filter((file) => policy.paths.some((prefix) => pathMatches(file.path, prefix)));
    const areaResult = areaSummary(report.files, policy.paths);
    areas[area] = { files: selectedFiles.length, summary: areaResult, thresholds: policy };
    if (!areaResult) {
      failures.push(`${area}.files=0<1`);
      continue;
    }
    failures.push(...globalCoverageFailures(areaResult, policy).map((failure) => failure.replace("global.", `${area}.`)));
  }

  const knownBadMutationRejected = globalCoverageFailures(knownBadCoverageMutation.mutatedSummary).length > 0;
  if (!knownBadMutationRejected) failures.push(`known-bad-mutation=${knownBadCoverageMutation.id} was accepted`);
  const ratchetFailures = coverageRatchetFailures(report.summary, areas);
  failures.push(...ratchetFailures);
  const knownBadRatchetRejected = globalCoverageFailures(knownBadCoverageMutation.mutatedSummary, COVERAGE_RATCHET.global).length > 0;
  if (!knownBadRatchetRejected) failures.push(`known-bad-ratchet=${knownBadCoverageMutation.id} was accepted`);

  return { failures, areas, knownBadMutationRejected, ratchetFailures, knownBadRatchetRejected };
}

function artifactDirectory(root: string): string {
  return process.env.CVG_COVERAGE_ARTIFACT_DIR || join(root, "artifacts");
}

export function runCoverageVerification(): void {
  const root = process.cwd();
  const files = [
    ...testFiles(join(root, "tests", "unit")),
    ...testFiles(join(root, "tests", "integration")),
  ].sort();
  // Node's native coverage is collected per test worker. Serial execution keeps
  // the same TypeScript module from producing run-to-run union/replacement
  // differences in the emitted line map, which would make the ratchet flaky.
  const result = spawnSync(process.execPath, ["--experimental-test-coverage", "--import", "tsx", "--test-concurrency=1", "--test", ...files.map((file) => relative(root, file))], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const report = parseCoverageOutput(output);
  const evaluation = report ? evaluateCoverage(report) : null;
  const outputDirectory = artifactDirectory(root);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "coverage-output.txt"), coverageArtifactText(output), { mode: 0o600 });
  writeFileSync(join(outputDirectory, "coverage-summary.json"), `${JSON.stringify({
    schemaVersion: 2,
    policy: COVERAGE_POLICY,
    ratchetPolicy: COVERAGE_RATCHET,
    summary: report?.summary ?? null,
    criticalAreas: evaluation?.areas ?? null,
    knownBadMutation: {
      id: knownBadCoverageMutation.id,
      result: evaluation?.knownBadMutationRejected ? "REJECTED" : "ACCEPTED",
      mutationTesting: "NOT_RUN",
      note: "This is a deterministic gate fixture, not a mutation-testing execution or mutation score.",
    },
    ratchet: {
      result: evaluation?.ratchetFailures.length === 0 ? "PASS" : "FAIL",
      failures: evaluation?.ratchetFailures ?? [],
      knownBad: evaluation?.knownBadRatchetRejected ? "REJECTED" : "ACCEPTED",
    },
    exitStatus: result.status,
    signal: result.signal,
  }, null, 2)}\n`, { mode: 0o600 });

  const failures = [...(evaluation?.failures ?? ["coverage statements unavailable: native report did not emit an all-files line metric, so the explicit line-equivalent statements metric cannot be derived"] )];
  if (result.error) failures.unshift(`coverage_run=${result.error.message}`);
  if (result.status !== 0) failures.unshift(`tests_exit=${result.status ?? "signal"}`);

  if (report) {
    process.stdout.write(`COVERAGE line=${report.summary.line.toFixed(2)}% branch=${report.summary.branch.toFixed(2)}% functions=${report.summary.functions.toFixed(2)}% statements=${report.summary.statements.toFixed(2)}% source=${report.summary.statementMetric.source} basis=line-equivalent\n`);
    for (const [area, value] of Object.entries(evaluation?.areas ?? {})) {
      const summary = value.summary;
      process.stdout.write(`COVERAGE_AREA ${area} files=${value.files} line=${summary?.line.toFixed(2) ?? "n/a"}% branch=${summary?.branch.toFixed(2) ?? "n/a"}% functions=${summary?.functions.toFixed(2) ?? "n/a"}% statements=${summary?.statements.toFixed(2) ?? "n/a"}%\n`);
    }
  }
  process.stdout.write(`COVERAGE_RATCHET baselineSourceSha=${COVERAGE_RATCHET.baselineSourceSha} capturedAt=${COVERAGE_RATCHET.baselineCapturedAt} status=${COVERAGE_RATCHET.fingerprintStatus} result=${evaluation?.ratchetFailures.length === 0 ? "PASS" : "FAIL"} known_bad=${evaluation?.knownBadRatchetRejected ? "REJECTED" : "UNVERIFIED"}\n`);
  process.stdout.write(`MUTATION_FIXTURE id=${knownBadCoverageMutation.id} result=${evaluation?.knownBadMutationRejected ? "REJECTED" : "UNVERIFIED"} mutationTesting=NOT_RUN\n`);
  if (failures.length > 0) {
    process.stderr.write(`COVERAGE_FAIL ${failures.join(" ")} artifact=${relative(root, join(outputDirectory, "coverage-output.txt"))}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("COVERAGE_VERIFIED thresholds=PASS ratchet=PASS mutation_fixture=REJECTED mutation_testing=NOT_RUN\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCoverageVerification();
