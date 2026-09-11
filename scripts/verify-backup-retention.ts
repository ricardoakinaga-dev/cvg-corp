import { readFile } from "node:fs/promises";
import { verifyOperationalBackupDirectory } from "@cvg/persistence";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeKey(value: string): Uint8Array {
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    const decoded = Buffer.from(value, "base64");
    if (decoded.byteLength === 32) return decoded;
  }
  throw new Error("CVG_BACKUP_KEY_FILE must contain a 256-bit hex or base64 key");
}

async function main(): Promise<void> {
  let directory: string;
  let keyFile: string;
  let keyRef: string;
  try {
    directory = requiredEnvironment("CVG_BACKUP_DIRECTORY");
    keyFile = requiredEnvironment("CVG_BACKUP_KEY_FILE");
    keyRef = requiredEnvironment("CVG_RECOVERY_ENCRYPTION_KEY_REF");
  } catch (error) {
    process.stdout.write(`BACKUP_RETENTION_BLOCKED_EXTERNAL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
    return;
  }
  let key: Uint8Array;
  try {
    key = decodeKey((await readFile(keyFile, "utf8")).trim());
  } catch (error) {
    process.stderr.write(`BACKUP_RETENTION_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const retentionRaw = process.env.CVG_BACKUP_RETENTION_COUNT ?? "7";
    const keepLast = Number(retentionRaw);
    const result = await verifyOperationalBackupDirectory({
      directory,
      resolveKey: (candidate) => candidate === keyRef ? key : null,
      retention: { keepLast }
    });
    process.stdout.write(`BACKUP_RETENTION_VERIFIED backups=${result.verified.length} removed=${result.removed.length}\n`);
  } catch (error) {
    process.stderr.write(`BACKUP_RETENTION_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
