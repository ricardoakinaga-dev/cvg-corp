import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PressureControl = { id: string; file: string; required: string[]; minOccurrences?: Record<string, number>; testFile?: string; testName?: string };
const controls: readonly PressureControl[] = [
  { id: "compose-cpu-memory-limits", file: "docker-compose.yml", required: ["deploy:", "limits:", "cpus:", "memory:"], minOccurrences: { "limits:": 6, "cpus:": 6, "memory:": 6 } },
  { id: "compose-file-descriptor-limits", file: "docker-compose.yml", required: ["ulimits:", "nofile:"], minOccurrences: { "ulimits:": 6, "nofile:": 6 } },
  { id: "worker-bulkheads", file: "apps/worker/src/runtime-controls.ts", required: ["RejectingBulkhead", "database", "provider", "ai"], testFile: "tests/unit/worker.test.ts", testName: "worker resource bulkheads reject excess AI/provider work without an in-memory wait queue" },
  { id: "worker-admission", file: "apps/worker/src/worker.ts", required: ["enqueueWorkerJob", "assertWorkerJobAdmissionCapacity", "producer admission is blocked", "BUDGET_EXCEEDED", "maxOutstandingJobs"], testFile: "tests/unit/worker.test.ts", testName: "worker queue admission rejects producers at capacity while the consumer lane remains runnable" },
  { id: "pool-saturation", file: "apps/worker/src/runtime-controls.ts", required: ["databasePoolSaturated", "waiting", "max"], testFile: "tests/unit/worker.test.ts", testName: "worker degrades before heartbeat or claim when the database pool is saturated" },
  { id: "pressure-observability", file: "apps/worker/src/worker.ts", required: ["worker.backpressure", "poisonMessages", "backpressureEvents"], testFile: "tests/unit/worker.test.ts", testName: "worker exposes outbox backpressure while allowing consumers to drain" }
] as const;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, "artifacts/operational-proof/resource-pressure-local.json");

function executeFixtures(): { status: "PASS" | "FAIL"; command: string; detail?: string } {
  const files = ["tests/unit/worker.test.ts", "tests/integration/worker-jobs.test.ts"];
  const command = `${process.execPath} --import tsx --test ${files.join(" ")}`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status === 0) return { status: "PASS", command };
  const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim().split("\n").slice(-3).join(" | ");
  return { status: "FAIL", command, ...(detail ? { detail } : {}) };
}

function executeControl(control: PressureControl): { status: "PASS" | "STATIC" | "FAIL"; command?: string; detail?: string } {
  if (!control.testFile || !control.testName) return { status: "STATIC" };
  const pattern = `^${control.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
  const command = `${process.execPath} --import tsx --test --test-name-pattern ${JSON.stringify(pattern)} ${control.testFile}`;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-name-pattern", pattern, control.testFile], { cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0 && !/ℹ tests 0/.test(output)) return { status: "PASS", command };
  const detail = output.trim().split("\n").slice(-3).join(" | ");
  return { status: "FAIL", command, ...(detail ? { detail } : {}) };
}

async function main(): Promise<void> {
  const results = [] as Array<PressureControl & { status: "VERIFIED_LOCAL_EXECUTION" | "VERIFIED_STATIC_CONTRACT" | "MISSING"; execution: { status: "PASS" | "STATIC" | "FAIL"; command?: string; detail?: string }; limitation: string }>;
  for (const control of controls) {
    const source = await readFile(join(root, control.file), "utf8").catch(() => "");
    const execution = executeControl(control);
    const sourcePresent = control.required.every((fragment) => source.includes(fragment)) && Object.entries(control.minOccurrences ?? {}).every(([fragment, minimum]) => source.split(fragment).length - 1 >= minimum);
    const status = !sourcePresent || execution.status === "FAIL" ? "MISSING" : execution.status === "PASS" ? "VERIFIED_LOCAL_EXECUTION" : "VERIFIED_STATIC_CONTRACT";
    results.push({ ...control, status, execution, limitation: execution.status === "STATIC" ? "static deployment contract only; CPU, memory, file descriptor and backlog pressure require authorized production-like staging" : "focused local fixture execution only; CPU, memory, file descriptor and backlog pressure require authorized production-like staging" });
  }
  const missing = results.filter((result) => result.status === "MISSING");
  const fixtureExecution = executeFixtures();
  const report = { schemaVersion: 1, status: missing.length === 0 && fixtureExecution.status === "PASS" ? "RESOURCE_PRESSURE_LOCAL_CONTRACT_VERIFIED" : "RESOURCE_PRESSURE_LOCAL_CONTRACT_INCOMPLETE", observedAt: new Date().toISOString(), controls: results, fixtureExecution, externalLimitations: ["No cgroup CPU/memory/file-descriptor pressure, k6 arrival rate, managed PostgreSQL pool saturation, or multi-instance worker exercise was run."] };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${report.status} controls=${results.length} missing=${missing.length} artifact=${output}\n`);
  if (missing.length || fixtureExecution.status !== "PASS") process.exitCode = 1;
}

await main();
