import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileDurableLogSink, OpsTelemetry, readDurableLogFile } from "@cvg/ops";

export interface LocalDrResult {
  readonly status: "LOCAL_SYNTHETIC_PASS" | "LOCAL_SYNTHETIC_FAIL";
  readonly recoveredRecords: number;
  readonly localArtifactRecovery: "PASS" | "FAIL";
  readonly rto: { readonly status: "UNKNOWN"; readonly valueMs: null; readonly reason: string };
  readonly rpo: { readonly status: "UNKNOWN"; readonly valueMs: null; readonly reason: string };
  readonly externalEvidence: "BLOCKED_EXTERNAL";
}

/**
 * Copies a synthetic, redacted operational artifact between two disposable
 * directories. It proves local file survivability only; it is not a database,
 * object-storage or managed-backup restore and therefore cannot measure RTO/RPO.
 */
export async function runLocalDr(): Promise<LocalDrResult> {
  const directory = await mkdtemp(join(tmpdir(), "cvg-dr-"));
  const sourcePath = join(directory, "source.jsonl");
  const targetPath = join(directory, "target.jsonl");
  try {
    const sink = new FileDurableLogSink({ path: sourcePath, maxBytes: 8_192, maxBackups: 2 });
    const telemetry = new OpsTelemetry({ durableLogSink: sink });
    telemetry.log({ timestamp: new Date().toISOString(), level: "info", event: "dr.synthetic.checkpoint", correlationId: "dr-correlation", actorId: null, metadata: { dataset: "synthetic", records: 1 } });
    await telemetry.close();
    await copyFile(sourcePath, targetPath);
    const recoveredRecords = readDurableLogFile(targetPath).length;
    const localArtifactRecovery = recoveredRecords === 1 ? "PASS" : "FAIL";
    return {
      status: localArtifactRecovery === "PASS" ? "LOCAL_SYNTHETIC_PASS" : "LOCAL_SYNTHETIC_FAIL",
      recoveredRecords,
      localArtifactRecovery,
      rto: { status: "UNKNOWN", valueMs: null, reason: "equivalent external restore infrastructure is absent" },
      rpo: { status: "UNKNOWN", valueMs: null, reason: "approved backup watermark/object storage infrastructure is absent" },
      externalEvidence: "BLOCKED_EXTERNAL"
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("run-local-dr.ts")) process.stdout.write(`${JSON.stringify(await runLocalDr(), null, 2)}\n`);
