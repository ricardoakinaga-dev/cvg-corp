import { id, type OpaqueId } from "@cvg/contracts";
import { configuredSecretProvider } from "@cvg/integrations";
import type { CvgWorkerConfig } from "@cvg/config";
import { OperationalBackupJob, PersistenceCorruptionError, PersistenceUnavailableError, type OperationalBackupJobOptions, type PostgresPersistence } from "@cvg/persistence";

type BackupWorkerConfig = Pick<CvgWorkerConfig, "nodeEnv" | "backupEnabled" | "backupOrganizationId" | "backupDirectory" | "backupIntervalMs" | "backupKeepLast" | "recoveryEncryptionKeyRef" | "secretProvider" | "secretDir">;

export interface OperationalBackupFactoryOptions {
  persistence: Pick<PostgresPersistence, "exportRecoveryBundle">;
  config: BackupWorkerConfig;
  environment?: NodeJS.ProcessEnv;
  onFailure?: OperationalBackupJobOptions["onFailure"];
}

function decodeRecoveryKey(value: string): Uint8Array | null {
  const normalized = value.trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) return Buffer.from(normalized, "hex");
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.byteLength === 32) return decoded;
  }
  return null;
}

function missingProductionBackupContract(config: BackupWorkerConfig): never {
  throw new Error(`production worker backup contract is incomplete: enabled=${config.backupEnabled} organization=${Boolean(config.backupOrganizationId)} directory=${Boolean(config.backupDirectory)} keyRef=${Boolean(config.recoveryEncryptionKeyRef)}`);
}

/**
 * Composes the periodic backup at the worker boundary. The scope is
 * deliberately one explicit organization per process; a deployment that
 * needs more organizations must run one explicitly configured worker for
 * each organization instead of silently producing a partial database copy.
 */
export function createOperationalBackupJob(options: OperationalBackupFactoryOptions): OperationalBackupJob | null {
  const { config } = options;
  const complete = config.backupEnabled && Boolean(config.backupOrganizationId && config.backupDirectory && config.recoveryEncryptionKeyRef);
  if (!complete) {
    if (config.nodeEnv === "production") missingProductionBackupContract(config);
    return null;
  }
  const organizationId = id(config.backupOrganizationId as string) as OpaqueId;
  const keyRef = config.recoveryEncryptionKeyRef as string;
  const provider = configuredSecretProvider(config.secretProvider, options.environment ?? process.env, config.secretDir);
  const resolveKey = async (candidateKeyRef: string): Promise<Uint8Array | null> => {
    if (candidateKeyRef !== keyRef || !provider || provider.status() !== "READY" || !provider.has(candidateKeyRef) || !provider.resolve) return null;
    let raw: string | null;
    try {
      raw = await provider.resolve(candidateKeyRef);
    } catch {
      return null;
    }
    return raw ? decodeRecoveryKey(raw) : null;
  };
  return new OperationalBackupJob({
    directory: config.backupDirectory as string,
    keyRef,
    intervalMs: config.backupIntervalMs,
    createBundle: async () => {
      const bundle = await options.persistence.exportRecoveryBundle(organizationId);
      if (!bundle) throw new PersistenceUnavailableError(`no durable state exists for configured backup organization ${organizationId}`);
      if (bundle.manifest.organizationId !== organizationId) throw new PersistenceCorruptionError("operational backup bundle escaped its configured organization scope");
      return bundle;
    },
    resolveKey,
    retention: { keepLast: config.backupKeepLast },
    ...(options.onFailure ? { onFailure: options.onFailure } : {})
  });
}
