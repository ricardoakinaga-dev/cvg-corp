import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const LOAD_SCRIPT_PATH = "tests/load/cvg-staging.k6.js";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function inspectLoadScript(source: string): string[] {
  const requiredMarkers = [
    "users_50",
    "users_100",
    "burst",
    "http_req_duration",
    "http_req_failed",
    "CVG_LOAD_BASE_URL",
    "CVG_LOAD_BEARER_TOKEN",
    "deepseek_turn",
    "provider_ack",
    "worker_backlog",
    "doubleDuration",
    "startTime: doubleDuration(duration)"
  ];
  return requiredMarkers.filter((marker) => !source.includes(marker));
}

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  const source = await readFile(resolve(root, LOAD_SCRIPT_PATH), "utf8");
  const missing = inspectLoadScript(source);
  if (missing.length) {
    process.stderr.write(`LOAD_CONTRACT_INVALID missing=${missing.join(",")}\n`);
    process.exitCode = 1;
  } else if (!process.env.CVG_LOAD_BASE_URL || !process.env.CVG_LOAD_BEARER_TOKEN || !process.env.CVG_LOAD_P95_MS) {
    process.stdout.write("LOAD_EVIDENCE_BLOCKED_EXTERNAL explicit staging URL, secret-authority token and approved observed p95 are required\n");
    process.exitCode = 2;
  } else {
    const result = spawnSync("k6", ["run", LOAD_SCRIPT_PATH], { cwd: root, stdio: "inherit", env: process.env });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      process.stderr.write("LOAD_EVIDENCE_BLOCKED_EXTERNAL k6 is not installed\n");
      process.exitCode = 2;
    } else {
      process.exitCode = result.status ?? 1;
    }
  }
}
