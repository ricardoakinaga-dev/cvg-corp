import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const dockerFixture = `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const statePath = process.env.CVG_DOCKER_FIXTURE_STATE;
const logPath = process.env.CVG_DOCKER_FIXTURE_LOG;
const scenario = process.env.CVG_DOCKER_FIXTURE_SCENARIO;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
appendFileSync(logPath, JSON.stringify(args) + "\\n");
const save = () => writeFileSync(statePath, JSON.stringify(state));
const output = (text = "") => process.stdout.write(text + "\\n");
const fail = (text, code = 1) => { process.stderr.write(text + "\\n"); process.exit(code); };
if (args[0] === "info" || (args[0] === "image" && args[1] === "inspect")) { output("fixture"); process.exit(0); }
if (args[0] === "ps") {
  const rows = Object.values(state.containers).map((c) => [c.id, c.name, c.image, c.ports].join("\\t"));
  output(rows.join("\\n"));
  process.exit(0);
}
if (args[0] === "run") {
const name = args[args.indexOf("--name") + 1];
const label = args.filter((value) => value.startsWith("cvg.audit.run=")).at(-1)?.split("=").slice(1).join("=") ?? "";
if (scenario === "collision") {
    state.containers[name] = { id: "a".repeat(64), name, image: "postgres:16-alpine", ports: "", marker: "pre-existing-owner" };
    save();
  fail("Conflict. The container name is already in use", 125);
}
state.containers[name] = { id: "b".repeat(64), name, image: "postgres:16-alpine", ports: "127.0.0.1:15432->5432/tcp", marker: label };
save();
if (scenario === "run-partial") fail("Docker CLI lost the detached container response", 125);
output("b".repeat(64));
  process.exit(0);
}
if (args[0] === "inspect") {
  const name = args.at(-1);
  const container = state.containers[name];
  if (!container) fail("Error: No such object: " + name);
  if (args.includes("--format")) output(container.id + "\\t" + container.marker);
  else output(JSON.stringify([container]));
  process.exit(0);
}
if (args[0] === "port") {
  if (scenario === "partial-port") fail("Error: port mapping is temporarily unavailable");
  output("127.0.0.1:15432");
  process.exit(0);
}
if (args[0] === "exec") fail("PostgreSQL is not ready", 1);
if (args[0] === "rm") {
  const target = args.at(-1);
  if (scenario === "cleanup-fail") fail("fixture refused forced removal", 1);
  const name = Object.keys(state.containers).find((key) => key === target || state.containers[key].id === target);
  if (name) delete state.containers[name];
  save();
  output(target);
  process.exit(0);
}
fail("unexpected docker command: " + args.join(" "));
`;

async function runFixture(scenario: "collision" | "run-partial" | "partial-port" | "cleanup-fail", args: string[] = []): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
  commands: string[][];
  containers: Record<string, { id: string; name: string; image: string; ports: string; marker: string }>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "cvg-ephemeral-postgres-"));
  try {
    const binDirectory = join(directory, "bin");
    const dockerPath = join(binDirectory, "docker");
    const statePath = join(directory, "state.json");
    const logPath = join(directory, "commands.jsonl");
    await mkdir(binDirectory);
    await writeFile(dockerPath, dockerFixture, { mode: 0o755 });
    await chmod(dockerPath, 0o755);
    await writeFile(statePath, JSON.stringify({ containers: {} }));
    await writeFile(logPath, "");
    const env = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      CVG_DOCKER_FIXTURE_STATE: statePath,
      CVG_DOCKER_FIXTURE_LOG: logPath,
      CVG_DOCKER_FIXTURE_SCENARIO: scenario
    };
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-ephemeral-postgres.ts", "--rounds=1", ...args], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      timeout: 20_000
    });
    const state = JSON.parse(await readFile(statePath, "utf8")) as { containers: Record<string, { id: string; name: string; image: string; ports: string; marker: string }> };
    const log = await readFile(logPath, "utf8");
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      commands: log.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as string[]),
      containers: state.containers
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("startup name collision preserves the container that owns the conflicting name", async () => {
  const result = await runFixture("collision");
  assert.notEqual(result.status, 0);
  assert.equal(Object.keys(result.containers).length, 1);
  assert.equal(Object.values(result.containers)[0]?.marker, "pre-existing-owner");
  assert.equal(result.commands.some((args) => args[0] === "rm"), false, "cleanup must not remove an unowned name collision");
  assert.equal(result.commands.filter((args) => args[0] === "ps").length, 2, "inventory must be checked after the failed start");
  assert.match(result.stderr, /after-inventory: container inventory changed/);
});

test("partial startup is cleaned by ownership identity and followed by an inventory check", async () => {
  const result = await runFixture("partial-port");
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.containers, {});
  const inspect = result.commands.find((args) => args[0] === "inspect");
  assert.ok(inspect?.includes("--format"), "cleanup must inspect the container's immutable id and ownership label");
  assert.equal(result.commands.filter((args) => args[0] === "ps").length, 2);
  assert.match(result.stderr, /CONTRACT_FAILED/);
  assert.match(result.stderr, /published port lookup failed/);
});

test("container created before a failed detached-start response is found and removed by its run token", async () => {
  const result = await runFixture("run-partial");
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.containers, {});
  const removal = result.commands.find((args) => args[0] === "rm");
  assert.equal(removal?.at(-1), "b".repeat(64), "cleanup must target the container ID, not its reusable name");
  assert.equal(result.commands.filter((args) => args[0] === "ps").length, 2);
  assert.match(result.stderr, /container start failed/);
});

test("cleanup failure still captures the after inventory and reports the surviving container", async () => {
  const result = await runFixture("cleanup-fail", ["--ready-timeout-ms=1"]);
  assert.notEqual(result.status, 0);
  assert.equal(Object.keys(result.containers).length, 1);
  assert.equal(result.commands.filter((args) => args[0] === "ps").length, 2);
  assert.match(result.stderr, /CLEANUP_FAILED/);
  assert.match(result.stderr, /after-inventory: container inventory changed/);
});
