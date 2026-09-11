import test from "node:test";
import assert from "node:assert/strict";
import { loadWorkerConfig, WorkerConfigError } from "@cvg/config";
import { id } from "@cvg/contracts";
import { createOperationalBackupJob } from "../../apps/worker/src/operational-backup.ts";

const organizationId = "00000000-0000-4000-8000-000000000010";

function workerEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    CVG_STORAGE: "postgres",
    DATABASE_URL: "postgresql://cvg_runtime:secret@db.example.test:5432/cvg",
    CVG_WORKER_ORGANIZATION_ID: organizationId,
    CVG_BACKUP_ENABLED: "true",
    CVG_BACKUP_ORGANIZATION_ID: organizationId,
    CVG_BACKUP_DIRECTORY: "/var/lib/cvg/backups",
    CVG_BACKUP_INTERVAL_MS: "3600000",
    CVG_BACKUP_KEEP_LAST: "7",
    CVG_RECOVERY_ENCRYPTION_KEY_REF: "backup-key",
    CVG_SECRET_PROVIDER: "env",
    ...overrides
  };
}

test("worker backup configuration binds one explicit organization and rejects partial or cross-tenant scope", () => {
  const configured = loadWorkerConfig(workerEnvironment());
  assert.equal(configured.backupOrganizationId, organizationId);
  assert.equal(configured.backupEnabled, true);
  assert.throws(() => loadWorkerConfig(workerEnvironment({ CVG_BACKUP_DIRECTORY: "" })), WorkerConfigError);
  assert.throws(() => loadWorkerConfig(workerEnvironment({ CVG_BACKUP_ORGANIZATION_ID: "00000000-0000-4000-8000-000000000011" })), WorkerConfigError);
});

test("operational backup composition resolves the named key before exporting the bound organization", async () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  let requestedOrganization: string | null = null;
  const job = createOperationalBackupJob({
    environment: { CVG_SECRET_BACKUP_KEY: key },
    config: loadWorkerConfig(workerEnvironment()),
    persistence: {
      exportRecoveryBundle: async (requested) => {
        requestedOrganization = requested;
        return null;
      }
    }
  });
  assert.ok(job);
  await assert.rejects(() => job.runOnce(), /no durable state exists for configured backup organization/);
  assert.equal(requestedOrganization, id(organizationId));
  assert.match(job.status().lastFailure ?? "", /no durable state exists/);
});

