import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubjectManifest } from "./subject-manifest.ts";

export type MutationSpec = {
  id: string;
  file: string;
  find: string;
  replace: string;
  rationale: string;
  lane?: string;
  tests?: readonly string[];
};

export type MutationResult = MutationSpec & {
  status: "KILLED" | "SURVIVED" | "INVALID";
  exitStatus: number | null;
  signal: NodeJS.Signals | null;
  output: string;
};

export const MUTATION_PLAN: readonly MutationSpec[] = [
  {
    id: "AUD27-018-RC-001",
    file: "apps/api/src/response-contract.ts",
    find: "if (versionedApiPath && !route && input.statusCode !== 404)",
    replace: "if (versionedApiPath && !route && input.statusCode === 404)",
    rationale: "An unregistered successful API route must remain fail-closed."
  },
  {
    id: "AUD27-018-RC-002",
    file: "apps/api/src/response-contract.ts",
    find: "if (input.statusCode === 204)",
    replace: "if (input.statusCode !== 204)",
    rationale: "Only a 204 response receives the empty-body contract."
  },
  {
    id: "AUD27-018-RC-003",
    file: "apps/api/src/response-contract.ts",
    find: "if (mode === \"TEXT\")",
    replace: "if (mode !== \"TEXT\")",
    rationale: "JSON payloads must reach envelope and payload validation instead of the text budget branch."
  },
  {
    id: "AUD27-018-RC-004",
    file: "apps/api/src/response-contract.ts",
    find: "if (!success.success) throw new ApiResponseContractError(route.responseSchema, \"response envelope failed schema validation\");",
    replace: "if (success.success) throw new ApiResponseContractError(route.responseSchema, \"response envelope failed schema validation\");",
    rationale: "A valid success envelope must not be rejected as an invalid envelope."
  },
  {
    id: "AUD27-018-RC-005",
    file: "apps/api/src/response-contract.ts",
    find: "if (!visit(value, 0)) throw new ApiResponseContractError(responseSchema, \"response contains unsafe or non-serializable output fields\");",
    replace: "if (visit(value, 0)) throw new ApiResponseContractError(responseSchema, \"response contains unsafe or non-serializable output fields\");",
    rationale: "Unsafe output must be rejected while safe output remains serializable."
  },
  {
    id: "AUD27-018-RC-006",
    file: "apps/api/src/response-contract.ts",
    find: "if (!route) return;",
    replace: "if (route) return;",
    rationale: "Registered routes must not bypass their envelope and payload validators."
  },
  {
    id: "AUD27-018-SCHEMA-001",
    file: "apps/api/src/response-schemas/clinical.ts",
    find: "const MAX_PAGE_ITEMS = 100;",
    replace: "const MAX_PAGE_ITEMS = 99;",
    rationale: "Clinical list contracts must preserve the tested 100-item page boundary."
  },
  {
    id: "AUD27-018-SCHEMA-002",
    file: "apps/api/src/response-schemas/clinical.ts",
    find: "const versionSchema = z.number().int().min(1).max(1_000_000_000);",
    replace: "const versionSchema = z.number().int().min(2).max(1_000_000_000);",
    rationale: "Clinical document and appointment versions must accept the initial version 1."
  },
  {
    id: "AUD27-018-SCHEMA-003",
    file: "apps/api/src/response-schemas/clinical.ts",
    find: "const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);",
    replace: "const boundedText = (maximum: number) => z.string().trim().min(0).max(maximum);",
    rationale: "Clinical bounded text fields must reject empty labels and descriptions."
  },
  {
    id: "AUD27-018-SCHEMA-004",
    file: "apps/api/src/response-schemas/remaining.ts",
    find: "const MAX_PAGE_ITEMS = 200;",
    replace: "const MAX_PAGE_ITEMS = 199;",
    rationale: "Remaining list contracts must preserve the tested 200-item page boundary."
  },
  {
    id: "AUD27-018-SCHEMA-005",
    file: "apps/api/src/response-schemas/auth-ops.ts",
    find: "live: z.literal(true),",
    replace: "live: z.literal(false),",
    rationale: "Health responses must advertise liveness only with the true literal."
  },
  {
    id: "AUD27-018-SCHEMA-006",
    file: "apps/api/src/response-schemas/auth-ops.ts",
    find: "const nonNegativeIntegerSchema = z.number().int().nonnegative();",
    replace: "const nonNegativeIntegerSchema = z.number().int().positive();",
    rationale: "Operational counters and revoked-session counts must allow zero."
  },
  {
    id: "AUD27-018-SCHEMA-007",
    file: "apps/api/src/response-schemas/auth-ops.ts",
    find: "challengeId: z.string().trim().regex(/^[A-Za-z0-9_-]{32,160}$/),",
    replace: "challengeId: z.string().trim().regex(/^[A-Za-z0-9_-]{32,39}$/),",
    rationale: "Recovery challenge identifiers must preserve the tested 40-character valid boundary."
  },
  {
    id: "AUD27-018-AUTH-001",
    file: "packages/auth/src/index.ts",
    find: "if (password.length < policy.minLength)",
    replace: "if (password.length > policy.minLength)",
    rationale: "Password policy must reject values below the minimum length, not values above it.",
    lane: "auth",
    tests: ["tests/unit/auth.test.ts"]
  },
  {
    id: "AUD27-018-AUTH-002",
    file: "packages/auth/src/index.ts",
    find: "if (policy.requireUppercase && !/[A-Z]/.test(password))",
    replace: "if (policy.requireUppercase && !/[a-z]/.test(password))",
    rationale: "Password policy must enforce an uppercase character independently of the lowercase rule.",
    lane: "auth",
    tests: ["tests/unit/auth.test.ts"]
  },
  {
    id: "AUD27-018-AUTH-003",
    file: "packages/auth/src/index.ts",
    find: "if (challenge.status !== \"PENDING\")",
    replace: "if (challenge.status === \"PENDING\")",
    rationale: "WebAuthn assertions must be rejected once the challenge is no longer pending.",
    lane: "auth",
    tests: ["tests/unit/auth.test.ts"]
  },
  {
    id: "AUD27-018-AUTH-004",
    file: "packages/auth/src/index.ts",
    find: "if (credential.signCount !== 0 && signCount !== 0 && signCount <= credential.signCount)",
    replace: "if (credential.signCount !== 0 && signCount !== 0 && signCount > credential.signCount)",
    rationale: "A nonzero WebAuthn counter must advance strictly beyond the registered counter.",
    lane: "auth",
    tests: ["tests/unit/auth.test.ts"]
  },
  {
    id: "AUD27-018-PDP-001",
    file: "packages/agent-policy/src/index.ts",
    find: "if (registeredRule.capability !== request.capability)",
    replace: "if (registeredRule.capability === request.capability)",
    rationale: "The PDP must deny a request whose capability differs from the canonical operation rule.",
    lane: "pdp",
    tests: ["tests/unit/vnext.test.ts"]
  },
  {
    id: "AUD27-018-PDP-002",
    file: "packages/agent-policy/src/index.ts",
    find: "if (!request.approval) return approvalRequired(this.revision, request);",
    replace: "if (request.approval) return approvalRequired(this.revision, request);",
    rationale: "High-impact requests without a bound approval must remain approval-required.",
    lane: "pdp",
    tests: ["tests/unit/vnext.test.ts"]
  },
  {
    id: "AUD27-018-PDP-003",
    file: "packages/agent-policy/src/index.ts",
    find: "if (!context.actorRoleSnapshot.some((role) => request.allowedRoles.includes(role)))",
    replace: "if (context.actorRoleSnapshot.some((role) => request.allowedRoles.includes(role)))",
    rationale: "The PDP must allow only actors whose current role snapshot intersects the descriptor roles.",
    lane: "pdp",
    tests: ["tests/unit/vnext.test.ts"]
  },
  {
    id: "AUD27-018-MIG-001",
    file: "packages/persistence/src/migration-harness.ts",
    find: "if (current && current.sourceDigest !== sourceDigest)",
    replace: "if (current && current.sourceDigest === sourceDigest)",
    rationale: "A resumed migration run must quarantine source drift instead of accepting the changed source.",
    lane: "migration",
    tests: ["tests/unit/aud27-migration-harness.test.ts"]
  },
  {
    id: "AUD27-018-MIG-002",
    file: "packages/persistence/src/migration-harness.ts",
    find: "if (input.signal?.aborted) throw new Aud27MigrationError(\"ABORTED\", \"migration was aborted before start\");",
    replace: "if (!input.signal?.aborted) throw new Aud27MigrationError(\"ABORTED\", \"migration was aborted before start\");",
    rationale: "A migration without an aborted signal must be allowed to enter the execution protocol.",
    lane: "migration",
    tests: ["tests/unit/aud27-migration-harness.test.ts"]
  },
  {
    id: "AUD27-018-MIG-003",
    file: "packages/persistence/src/migration-harness.ts",
    find: "if (target.length !== source.length || targetDigest !== sourceDigest)",
    replace: "if (target.length !== source.length && targetDigest !== sourceDigest)",
    rationale: "Migration parity must reject a digest mismatch even when row counts happen to match.",
    lane: "migration",
    tests: ["tests/unit/aud27-migration-harness.test.ts"]
  },
  {
    id: "MEL23-026-FINANCE-001",
    file: "packages/domain/src/index.ts",
    find: "if (currencies.size > 1) return unresolved(\"UNKNOWN\");",
    replace: "if (currencies.size > 2) return unresolved(\"UNKNOWN\");",
    rationale: "A single-currency financial balance must reject mixed currencies instead of reporting a settled amount.",
    lane: "finance",
    tests: ["tests/unit/finance-balance.test.ts"]
  },
  {
    id: "MEL23-026-CLINICAL-001",
    file: "packages/domain/src/index.ts",
    find: "if (document.status !== \"REVIEW\") throw new DomainError(\"INVALID_STATE\", \"O documento precisa passar por revisão explícita antes da assinatura.\", 409, { status: document.status });",
    replace: "if (document.status === \"REVIEW\") throw new DomainError(\"INVALID_STATE\", \"O documento precisa passar por revisão explícita antes da assinatura.\", 409, { status: document.status });",
    rationale: "Clinical signing must require an explicitly reviewed document while rejecting draft signatures.",
    lane: "clinical",
    tests: ["tests/unit/domain.test.ts"]
  }
];

export const MUTATION_POLICY = {
  minimumPlanSize: 25,
  minimumScore: 1,
  maximumSurvived: 0,
  maximumInvalid: 0
} as const;

const EXCLUDED_COPY_PREFIXES = [".git", ".agent", "artifacts", "coverage", "dist", ".vite", "node_modules"] as const;
const TEST_PREFIX = "api-response-contract";

function shouldCopy(root: string, source: string): boolean {
  const path = relative(root, source).replaceAll("\\", "/");
  return !EXCLUDED_COPY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function applyMutationToSource(source: string, mutation: MutationSpec): string {
  const occurrences = source.split(mutation.find).length - 1;
  if (occurrences !== 1) throw new Error(`${mutation.id} expected exactly one mutation anchor, found ${occurrences}`);
  return source.replace(mutation.find, mutation.replace);
}

export function mutationScore(results: readonly MutationResult[]): { killed: number; survived: number; invalid: number; score: number } {
  const killed = results.filter((result) => result.status === "KILLED").length;
  const survived = results.filter((result) => result.status === "SURVIVED").length;
  const invalid = results.filter((result) => result.status === "INVALID").length;
  const denominator = killed + survived;
  return { killed, survived, invalid, score: denominator === 0 ? 0 : killed / denominator };
}

function testFiles(root: string, mutation: MutationSpec): string[] {
  if (mutation.tests) return [...mutation.tests];
  return readdirSync(join(root, "tests", "unit"))
    .filter((name) => name.startsWith(TEST_PREFIX) && name.endsWith(".test.ts"))
    .sort()
    .map((name) => join("tests", "unit", name));
}

function shortOutput(stdout: string, stderr: string): string {
  const output = `${stdout}\n${stderr}`.trim();
  return output.length <= 2_000 ? output : `${output.slice(-1_997)}...`;
}

function runMutation(sandbox: string, mutation: MutationSpec, tests: readonly string[]): MutationResult {
  const target = join(sandbox, mutation.file);
  const original = readFileSync(target, "utf8");
  let mutated: string;
  try {
    mutated = applyMutationToSource(original, mutation);
  } catch (error) {
    return { ...mutation, status: "INVALID", exitStatus: null, signal: null, output: error instanceof Error ? error.message : String(error) };
  }

  writeFileSync(target, mutated, "utf8");
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...tests], {
      cwd: sandbox,
      encoding: "utf8",
      env: { ...process.env, CI: "1", NODE_ENV: "test" },
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024
    });
    const spawnError = result.error as (NodeJS.ErrnoException | undefined);
    const timedOut = spawnError?.code === "ETIMEDOUT";
    return {
      ...mutation,
      status: result.status === 0 && !timedOut ? "SURVIVED" : "KILLED",
      exitStatus: result.status,
      signal: result.signal,
      output: shortOutput(result.stdout ?? "", result.stderr ?? (result.error ? String(result.error) : ""))
    };
  } finally {
    writeFileSync(target, original, "utf8");
  }
}

export function runMutationVerification(): void {
  const root = resolve(process.cwd());
  const subject = buildSubjectManifest(root);
  if (MUTATION_PLAN.length === 0) throw new Error("mutation plan is empty");

  const sandbox = mkdtempSync(join(tmpdir(), "cvg-aud27-mutation-"));
  try {
    cpSync(root, sandbox, { recursive: true, filter: (source) => shouldCopy(root, source) });
    const nodeModules = join(root, "node_modules");
    if (existsSync(nodeModules)) symlinkSync(nodeModules, join(sandbox, "node_modules"), "dir");
    const results = MUTATION_PLAN.map((mutation) => runMutation(sandbox, mutation, testFiles(root, mutation)));
    const score = mutationScore(results);
    const policy = {
      ...MUTATION_POLICY,
      planSize: MUTATION_PLAN.length,
      pass: MUTATION_PLAN.length >= MUTATION_POLICY.minimumPlanSize
        && score.score >= MUTATION_POLICY.minimumScore
        && score.survived <= MUTATION_POLICY.maximumSurvived
        && score.invalid <= MUTATION_POLICY.maximumInvalid
    };
    const artifact = {
      schemaVersion: 1,
      kind: "AUD27-018-REAL-MUTATION-LOCAL",
      sourceSha: subject.manifest.sourceSha,
      observedSubjectFingerprint: subject.fingerprint,
      fingerprintStatus: "UNFROZEN_UNTIL_AUD27-004",
      testFiles: [...new Set(MUTATION_PLAN.flatMap((mutation) => testFiles(root, mutation)))],
      plan: MUTATION_PLAN.map((mutation) => ({ id: mutation.id, file: mutation.file, lane: mutation.lane ?? "api-response-contract", tests: testFiles(root, mutation), rationale: mutation.rationale })),
      results,
      score: { ...score, percentage: Number((score.score * 100).toFixed(2)) },
      policy,
      limitations: [
        "Selective local mutation lanes cover API response contracts, auth/PDP, finance, clinical signing, and persistence migration; this is not a whole-repository mutation score.",
        "The subject is dirty and not yet bound to an AUD27-004 candidate fingerprint.",
        "External staging, browser, license and human gates remain outside this local run."
      ]
    };
    const artifactDirectory = join(root, "artifacts");
    writeFileSync(join(artifactDirectory, "mutation-summary.json"), `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`MUTATION_VERIFIED total=${results.length} killed=${score.killed} survived=${score.survived} invalid=${score.invalid} score=${(score.score * 100).toFixed(2)}% policy=${policy.pass ? "PASS" : "FAIL"} fingerprint=${subject.fingerprint} status=${artifact.fingerprintStatus}\n`);
    if (!policy.pass) process.exitCode = 1;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) runMutationVerification();
