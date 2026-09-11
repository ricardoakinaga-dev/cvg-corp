import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { WORKER_POLICY_REGISTRY } from "@cvg/agent-policy";

const root = new URL("../", import.meta.url);
const workerSource = readFileSync(new URL("apps/worker/src/worker.ts", root), "utf8");
const controlsSource = readFileSync(new URL("apps/worker/src/runtime-controls.ts", root), "utf8");
const requiredPolicies = [
  "outbox/outbox.dispatch",
  "jobs/storage.verify",
  "schedule/schedule.tick",
  "reconciliation/external.reconcile",
  "notifications/communication.dispatch",
  "maintenance/maintenance.cleanup"
];
const registered = new Set(WORKER_POLICY_REGISTRY.map((rule) => `${rule.lane}/${rule.jobType}`));
const failures: string[] = [];

for (const identity of requiredPolicies) if (!registered.has(identity)) failures.push(`missing worker policy ${identity}`);
if (WORKER_POLICY_REGISTRY.length !== requiredPolicies.length) failures.push(`production worker policy registry must contain exactly ${requiredPolicies.length} entries; found ${WORKER_POLICY_REGISTRY.length}`);
if ([...registered].some((identity) => identity.includes("synthetic."))) failures.push("synthetic worker policy leaked into production registry");
for (const marker of ["createProductionWorkerJobHandlers", "assertWorkerJobAdmissionCapacity", "producer admission is blocked", "withAbortableTimeout", "timeoutDisposition", "retryBaseSeconds", "requiresIdempotencyKey", "requiresDurableAudit", "emitsMetrics", "quarantineOnExhaustion", "recordAudit", "databasePoolSaturated", "maintainWorkerRecords", "resources.run(\"provider\""]) {
  if (!workerSource.includes(marker)) failures.push(`worker runtime is missing ${marker}`);
}
for (const marker of ["RejectingBulkhead", "WorkerResourceController", "work was not queued", "databasePoolSaturated"]) {
  if (!controlsSource.includes(marker)) failures.push(`worker controls are missing ${marker}`);
}

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

const tests = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/unit/worker.test.ts", "tests/integration/worker-jobs.test.ts"], {
  cwd: new URL(".", root),
  encoding: "utf8",
  stdio: "pipe"
});
if (tests.status !== 0) {
  process.stderr.write(tests.stdout);
  process.stderr.write(tests.stderr);
  process.exit(tests.status ?? 1);
}

const passed = (tests.stdout.match(/^✔ /gmu) ?? []).length;
process.stdout.write(`WORKER_RUNTIME_VERIFIED policies=${requiredPolicies.length} focusedTests=${passed} resources=database,provider,ai queueing=REJECT\n`);
