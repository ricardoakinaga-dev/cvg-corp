import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSubjectManifest } from "./subject-manifest.ts";

export interface ControlPlaneCapture {
  readonly schema_version: 1;
  readonly requirement_id: "MEL23-001";
  readonly command: "npm run verify:control-plane";
  readonly exit_status: number;
  readonly result: "PASS" | "BLOCKED";
  readonly executed_at: string;
  readonly environment: string;
  readonly source_sha: string;
  readonly observed_subject_fingerprint: string;
  readonly last_gate_record: string | null;
  readonly verification_tail: string | null;
  readonly last_event_id: string | null;
  readonly event_tail: string | null;
  readonly output: string;
}

export const MEL23_CONTROL_PLANE_CAPTURE_PATH = "artifacts/operational-proof/mel23-control-plane-current.json";

interface PointerState {
  readonly last_gate_record?: string;
  readonly last_event_id?: string;
}

export function validateControlPlaneCapture(
  capture: ControlPlaneCapture,
  state: PointerState,
  verificationTail: string | null,
  eventTail: string | null,
  currentSubject: { readonly sourceSha: string; readonly fingerprint: string },
): string[] {
  const issues: string[] = [];
  if (capture.requirement_id !== "MEL23-001") issues.push("capture is not scoped to MEL23-001");
  if (capture.command !== "npm run verify:control-plane") issues.push("capture command is not the required control-plane gate");
  if (capture.exit_status !== 0 || capture.result !== "PASS") issues.push("control-plane gate did not pass");
  if (capture.last_gate_record !== state.last_gate_record || capture.verification_tail !== verificationTail || capture.last_gate_record !== verificationTail) issues.push("captured verification pointer does not match the current ledger tail");
  if (capture.last_event_id !== state.last_event_id || capture.event_tail !== eventTail || capture.last_event_id !== eventTail) issues.push("captured event pointer does not match the current ledger tail");
  if (capture.source_sha !== currentSubject.sourceSha) issues.push("capture source SHA does not match the current checkout");
  if (capture.observed_subject_fingerprint !== currentSubject.fingerprint) issues.push("capture fingerprint does not match the current observed subject");
  if (!capture.executed_at || Number.isNaN(Date.parse(capture.executed_at))) issues.push("capture timestamp is invalid");
  if (!capture.environment.trim()) issues.push("capture environment is missing");
  return issues;
}

function lastJsonlId(path: string, key: "id" | "event_id"): string | null {
  if (!existsSync(path)) return null;
  const rows = readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  if (rows.length === 0) return null;
  const row = JSON.parse(rows.at(-1)!) as Record<string, unknown>;
  return typeof row[key] === "string" ? row[key] as string : null;
}

export function captureControlPlane(root: string, outputPath = MEL23_CONTROL_PLANE_CAPTURE_PATH): ControlPlaneCapture {
  const subject = buildSubjectManifest(root);
  const result = spawnSync("npm", ["run", "verify:control-plane"], {
    cwd: root,
    env: { ...process.env, CVG_CONTROL_PLANE_ROOT: root },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  const statePath = resolve(root, ".agent/state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as PointerState;
  const capture: ControlPlaneCapture = {
    schema_version: 1,
    requirement_id: "MEL23-001",
    command: "npm run verify:control-plane",
    exit_status: result.status ?? 1,
    result: result.status === 0 ? "PASS" : "BLOCKED",
    executed_at: new Date().toISOString(),
    environment: `local workspace; ${process.platform}; Node ${process.version}; npm subprocess; no production resources`,
    source_sha: subject.manifest.sourceSha,
    observed_subject_fingerprint: subject.fingerprint,
    last_gate_record: state.last_gate_record ?? null,
    verification_tail: lastJsonlId(resolve(root, ".agent/verification.jsonl"), "id"),
    last_event_id: state.last_event_id ?? null,
    event_tail: lastJsonlId(resolve(root, ".agent/execution-log.jsonl"), "event_id"),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  };
  const destination = resolve(root, outputPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(capture, null, 2)}\n`);
  process.stdout.write(capture.output ? `${capture.output}\n` : "");
  process.stdout.write(`MEL23_CONTROL_PLANE_CAPTURE_${capture.result} artifact=${outputPath} pointer=${capture.last_gate_record} event=${capture.last_event_id}\n`);
  return capture;
}

function main(): void {
  const root = resolve(process.env.CVG_REPO_ROOT?.trim() || process.cwd());
  const capture = captureControlPlane(root);
  process.exitCode = capture.exit_status === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
