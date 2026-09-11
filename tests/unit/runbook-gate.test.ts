import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { controls, executeScenarioFixtures, PROMPT_REFERENCE } from "../../scripts/verify-runbook-execution.ts";

test("runbook gate covers the prompt scenarios and the complete local runbook contract", async () => {
  const expectedFiles = [
    "docs/runbooks/deployment.md",
    "docs/runbooks/rollback.md",
    "docs/runbooks/backup.md",
    "docs/runbooks/restore.md",
    "docs/runbooks/database-incident.md",
    "docs/runbooks/provider-outage.md",
    "docs/runbooks/deepseek-harness-outage.md",
    "docs/runbooks/security-incident.md",
    "docs/runbooks/credential-rotation.md",
    "docs/runbooks/worker-backlog.md",
    "docs/runbooks/quarantine.md",
    "docs/runbooks/break-glass.md"
  ];
  assert.deepEqual(controls.map((control) => control.file), expectedFiles);
  assert.equal(new Set(controls.map((control) => control.id)).size, controls.length);
  assert.deepEqual(
    controls.filter((control) => control.promptScenario).map((control) => control.promptScenario).sort(),
    ["break-glass", "credential-rotation", "database-incident", "deepseek-harness-outage", "provider-outage", "restore", "worker-backlog"]
  );
  assert.ok(controls.every((control) => control.required.length > 0 && control.dryRun.transition.includes("→")));

  const fixtures = executeScenarioFixtures();
  assert.equal(fixtures.length, 7);
  assert.deepEqual(fixtures.map((fixture) => fixture.scenario).sort(), ["break-glass", "credential-rotation", "database-incident", "deepseek-harness-outage", "provider-outage", "restore", "worker-backlog"]);
  assert.ok(fixtures.every((fixture) => fixture.status === "PASS" && fixture.executionStatus === "EXECUTED_LOCAL" && fixture.observedStates.length >= 2));

  const prompt = await readFile(PROMPT_REFERENCE, "utf8");
  assert.match(prompt, /# FASE 35 — RUNBOOK EXECUTION/);
  assert.match(prompt, /# FASE 38 — HUMAN APPROVAL GATE/);
});
