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

test("PDP boundary guard rejects syntactic enforcement that does not guard execution", () => {
  const cases = {
    unusedCallback: 'read(context: unknown) { const unused = () => enforceApplicationPolicy(context, "patients.read"); return this.repository.list(); }',
    conditional: 'read(context: unknown) { if (false) enforceApplicationPolicy(context, "patients.read"); return this.repository.list(); }',
    latePolicy: 'read(context: unknown) { this.repository.list(); enforceApplicationPolicy(context, "patients.read"); }',
    earlyReturn: 'read(context: unknown) { return this.repository.list(); enforceApplicationPolicy(context, "patients.read"); }',
    swallowedDenial: 'read(context: unknown) { try { enforceApplicationPolicy(context, "patients.read"); } catch {} return this.repository.list(); }',
    fakeDelegate: 'read(context: unknown) { return this.run(context, "patients.read"); } private run() { return this.repository.list(); }',
    eagerArgument: 'read(context: unknown) { enforceApplicationPolicy(this.repository.list(), "patients.read"); }',
    eagerDefault: 'read(context = this.repository.list()) { enforceApplicationPolicy(context, "patients.read"); }',
    nestedObjectDefault: 'read({ context = this.repository.list() } = {}) { enforceApplicationPolicy(context, "patients.read"); }',
    nestedArrayDefault: 'read([context = this.repository.list()] = []) { enforceApplicationPolicy(context, "patients.read"); }',
    deeplyNestedDefault: 'read({ input: { context = this.repository.list() } = {} } = {}) { enforceApplicationPolicy(context, "patients.read"); }',
    computedBinding: 'read({ [this.repository.list()]: context }) { enforceApplicationPolicy(context, "patients.read"); }',
    constructorProperty: 'constructor(public read: () => unknown) {}',
    readonlyConstructorProperty: 'constructor(readonly read: () => unknown) {}',
    shadowedImport: 'read(context: unknown, enforceApplicationPolicy: Function) { enforceApplicationPolicy(context, "patients.read"); return this.repository.list(); }',
    stringExemption: 'read(context: unknown) { const marker = "@pdp-exempt health"; return this.repository.list(); }',
    commentExemption: '/** @pdp-exempt health */ read(context: unknown) { return this.repository.list(); }',
    arrowProperty: 'read = (context: unknown) => this.repository.list();',
    functionProperty: 'read = function(context: unknown) { return this.repository.list(); };',
    aliasedProperty: 'read = this.repository.list;',
    getter: 'get read() { return this.repository.list(); }',
    setter: 'set read(context: unknown) { this.repository.write(context); }',
    staticMethod: 'static read(context: unknown) { return this.repository.list(); }',
    computedMethod: '["read"](context: unknown) { return this.repository.list(); }'
  };
  for (const [name, method] of Object.entries(cases)) {
    const inspection = inspectApplicationPdpBoundaries([{
      path: `fixture/${name}.ts`,
      source: `import { enforceApplicationPolicy } from "@cvg/agent-policy";
        class BadApplicationService {
          safe(context: unknown) { enforceApplicationPolicy(context, "patients.read"); }
          ${method}
        }`
    }]);
    assert.ok(inspection.findings.some((finding) => finding.code === "METHOD_BYPASS"), name);
  }
});

test("PDP boundary guard verifies DomainCommandService delegation implementations", () => {
  for (const [name, run, authorize] of [
    ["fakeAuthorize", 'this.authorize(context, operation); return work();', 'return this.repository.list();'],
    ["lateAuthorize", 'work(); this.authorize(context, operation);', 'enforceApplicationPolicy(context, operation);'],
    ["wrongOperation", 'this.authorize(context, "patients.read"); return work();', 'enforceApplicationPolicy(context, operation);'],
    ["unusedAuthorize", 'const unused = () => this.authorize(context, operation); return work();', 'enforceApplicationPolicy(context, operation);']
  ]) {
    const inspection = inspectApplicationPdpBoundaries([{
      path: `fixture/${name}.ts`,
      source: `import { enforceApplicationPolicy } from "@cvg/agent-policy";
        class DomainCommandService {
          create(context: unknown) { return this.run(context, "patients.create", () => this.repository.create()); }
          private run(context: unknown, operation: string, work: Function) { ${run} }
          private authorize(context: unknown, operation: string) { ${authorize} }
        }`
    }]);
    assert.ok(inspection.findings.some((finding) => finding.code === "METHOD_BYPASS" && finding.method === "create"), name);
  }
});

test("PDP boundary guard rejects policy bindings shadowed by enclosing scopes", () => {
  for (const [name, imported, before, call, after] of [
    ["factory parameter", 'import { enforceApplicationPolicy } from "@cvg/agent-policy";', 'function outer(enforceApplicationPolicy: Function) {', 'enforceApplicationPolicy', '}'],
    ["destructured factory parameter", 'import { enforceApplicationPolicy } from "@cvg/agent-policy";', 'function outer({ enforceApplicationPolicy }: { enforceApplicationPolicy: Function }) {', 'enforceApplicationPolicy', '}'],
    ["factory local", 'import { enforceApplicationPolicy } from "@cvg/agent-policy";', 'function outer() { const enforceApplicationPolicy = () => {};', 'enforceApplicationPolicy', '}'],
    ["block local", 'import { enforceApplicationPolicy } from "@cvg/agent-policy";', '{ const enforceApplicationPolicy = () => {};', 'enforceApplicationPolicy', '}'],
    ["namespace parameter", 'import * as policy from "@cvg/agent-policy";', 'function outer(policy: any) {', 'policy.enforceApplicationPolicy', '}'],
    ["aliased import parameter", 'import { enforceApplicationPolicy as guard } from "@cvg/agent-policy";', 'function outer(guard: Function) {', 'guard', '}']
  ]) {
    const inspection = inspectApplicationPdpBoundaries([{
      path: `fixture/${name}.ts`,
      source: `${imported} ${before}
        class ShadowedApplicationService {
          read(context: unknown) { ${call}(context, "patients.read"); return this.repository.list(); }
        }
      ${after}`
    }]);
    assert.ok(inspection.findings.some((finding) => finding.code === "METHOD_BYPASS" && finding.method === "read"), name);
  }
});

test("PDP boundary guard accepts enforced callable properties, accessors and static methods", () => {
  const inspection = inspectApplicationPdpBoundaries([{
    path: "fixture/callable-service.ts",
    source: `import { enforceApplicationPolicy as enforce } from "@cvg/agent-policy";
      class CallableApplicationService {
        read = (context: unknown) => { enforce(context, "patients.read"); return this.repository.list(); };
        get patient() { enforce(this.context, "patients.read"); return this.repository.list(); }
        static read(context: unknown) { enforce(context, "patients.read"); return this.repository.list(); }
      }`
  }]);
  assert.deepEqual(inspection.findings, []);
});

test("authorization delegates cannot defer their policy through async or generator bodies", () => {
  for (const modifier of ["async ", "*"]) {
    const inspection = inspectApplicationPdpBoundaries([{
      path: "fixture/deferred-command-service.ts",
      source: `import { enforceApplicationPolicy } from "@cvg/agent-policy";
        class DomainCommandService {
          create(context: unknown) { return this.run(context, "patients.create", () => this.repository.create()); }
          private run(context: unknown, operation: string, work: Function) { this.authorize(context, operation); return work(); }
          private ${modifier}authorize(context: unknown, operation: string) { enforceApplicationPolicy(context, operation); }
        }`
    }]);
    assert.ok(inspection.findings.some((finding) => finding.code === "METHOD_BYPASS" && finding.method === "create"), modifier);
  }
});

test("readiness exemptions are pinned to audited identities and unchanged bodies", async () => {
  for (const path of ["packages/harness/src/index.ts", "apps/api/src/application/agent-service.ts"]) {
    const source = await readFile(path, "utf8");
    const relocated = inspectApplicationPdpBoundaries([{ path: "fixture/renamed.ts", source }]);
    assert.ok(relocated.findings.some((finding) => finding.code === "METHOD_BYPASS" && finding.method === "health"));
    const changed = source.replace(/(health\(\): [^{]+\{)/, "$1 this.repository.list();");
    assert.notEqual(changed, source);
    const inspection = inspectApplicationPdpBoundaries([{ path, source: changed }]);
    assert.ok(inspection.findings.some((finding) => finding.code === "METHOD_BYPASS" && finding.method === "health"));
  }
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
