import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface NodeTestRun {
  status: number | null;
  passed: number;
  stdout: string;
  stderr: string;
}

/** Runs a focused node:test file list and returns the real result. */
export function runNodeTests(files: readonly string[], cwd = fileURLToPath(new URL("../../", import.meta.url))): NodeTestRun {
  const tests = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { cwd, encoding: "utf8", stdio: "pipe" });
  return {
    status: tests.status,
    passed: (tests.stdout?.match(/^✔ /gmu) ?? []).length,
    stdout: tests.stdout ?? "",
    stderr: tests.stderr ?? ""
  };
}

/** Fails the current script with the real test output preserved. */
export function requireTests(files: readonly string[], label: string): number {
  const result = runNodeTests(files);
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${label}: focused tests failed`);
  }
  return result.passed;
}
