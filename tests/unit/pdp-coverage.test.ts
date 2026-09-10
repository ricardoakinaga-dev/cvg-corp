import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CvgStore } from "@cvg/domain";
import { GovernedHarness } from "@cvg/harness";
import { PolicyEvaluationError } from "@cvg/agent-policy";
import { inspectApplicationPdpBoundaries, type PdpBoundarySource } from "../../scripts/pdp-boundary.ts";

async function collectSources(directory: string): Promise<PdpBoundarySource[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: PdpBoundarySource[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...await collectSources(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) sources.push({ path, source: await readFile(path, "utf8") });
  }
  return sources;
}

test("production application boundaries have universal PDP coverage", async () => {
  const inspection = inspectApplicationPdpBoundaries([
    ...await collectSources("apps/api/src/application"),
    { path: "packages/harness/src/index.ts", source: await readFile("packages/harness/src/index.ts", "utf8") }
  ]);
  assert.ok(inspection.boundaryCount >= 9);
  assert.deepEqual(inspection.findings, []);
  assert.ok(inspection.operations.includes("patients.read"));
  assert.ok(inspection.operations.includes("ai.turn.SYNTHETIC"));
  assert.ok(inspection.operations.includes("ai.approval.retry"));
});

test("PDP boundary guard reports a known-bad service without enforcement", () => {
  const inspection = inspectApplicationPdpBoundaries([{
    path: "fixture/broken-service.ts",
    source: `export class BrokenApplicationService {
      async create(context: unknown) { return context; }
    }`
  }]);
  assert.ok(inspection.findings.some((finding) => finding.code === "MISSING_PDP_IMPORT"));
  assert.ok(inspection.findings.some((finding) => finding.code === "MISSING_ENFORCEMENT"));
  assert.ok(inspection.findings.some((finding) => finding.code === "METHOD_BYPASS" && finding.method === "create"));
});

test("PDP boundary guard rejects an unknown operation and a dynamic bypass", () => {
  const unknown = inspectApplicationPdpBoundaries([{
    path: "fixture/unknown-service.ts",
    source: `import { enforceApplicationPolicy } from "@cvg/agent-policy";
      export class UnknownApplicationService {
        create(context: unknown) { enforceApplicationPolicy(context, "unknown.operation"); }
      }`
  }]);
  assert.ok(unknown.findings.some((finding) => finding.code === "UNKNOWN_OPERATION" && finding.operation === "unknown.operation"));

  const dynamic = inspectApplicationPdpBoundaries([{
    path: "fixture/dynamic-service.ts",
    source: `import { enforceApplicationPolicy } from "@cvg/agent-policy";
      export class DynamicApplicationService {
        create(context: unknown, operation: string) { enforceApplicationPolicy(context, operation); }
      }`
  }]);
  assert.ok(dynamic.findings.some((finding) => finding.code === "DYNAMIC_OPERATION" && finding.method === "create"));
});

test("PDP boundary guard accepts only an enumerated DomainCommandService delegation", () => {
  const inspection = inspectApplicationPdpBoundaries([{
    path: "fixture/domain-command-service.ts",
    source: `import { enforceApplicationPolicy } from "@cvg/agent-policy";
      export class DomainCommandService {
        create(context: unknown) { return this.run(context, "patients.create", () => true); }
        private run(context: unknown, operation: string, work: () => boolean) {
          this.authorize(context, operation);
          return work();
        }
        private authorize(context: unknown, operation: string) {
          enforceApplicationPolicy(context, operation);
        }
      }`
  }]);
  assert.deepEqual(inspection.findings, []);
  assert.deepEqual(inspection.operations, ["patients.create"]);
});

test("GovernedHarness fails closed before creating a session without an authenticated context", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", "pdp-harness-negative");
  const before = store.aiSessions.size;
  assert.throws(
    () => new GovernedHarness(store).createSession(context, { purpose: "SUMMARY", patientId: null, encounterId: null }),
    (error: unknown) => error instanceof PolicyEvaluationError && error.code === "POLICY_DENIED"
  );
  assert.equal(store.aiSessions.size, before);
});
