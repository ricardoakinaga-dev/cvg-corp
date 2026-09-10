import { enforceApplicationPolicy } from "@cvg/agent-policy";
import type { CvgContext, GovernedExportInput, OpaqueId } from "@cvg/contracts";
import { DomainError, digest, idempotentAsync, makeId, now, type CvgStore } from "@cvg/domain";
import { encryptRecoveryBundle, type EncryptedRecoveryBundle, type PostgresPersistence } from "@cvg/persistence";
import type { SecretProvider } from "@cvg/integrations";

export interface GovernedExportResult {
  exportId: OpaqueId;
  createdAt: string;
  expiresAt: string;
  scope: { organizationId: OpaqueId; unitId: OpaqueId | null; workspaceId: OpaqueId | null };
  manifest: { format: "CVG-RECOVERY-MANIFEST"; version: 1; revision: string; snapshotDigest: string; eventId: string; migrationFingerprint: string };
  envelope: EncryptedRecoveryBundle;
}

function recoveryKey(value: string): Uint8Array {
  const normalized = value.trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) return Buffer.from(normalized, "hex");
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.byteLength === 32) return decoded;
  }
  throw new DomainError("CREDENTIAL_UNAVAILABLE", "A chave de exportação não possui 256 bits válidos; a exportação foi bloqueada.", 503);
}

/** Application boundary for organization-scoped encrypted recovery exports. */
export class ExportApplicationService {
  constructor(
    private readonly store: CvgStore,
    private readonly persistence: PostgresPersistence | null,
    private readonly secretProvider: SecretProvider | null,
    private readonly keyRef: string | null
  ) {}

  async create(context: CvgContext, input: GovernedExportInput, idempotencyKey: string): Promise<{ receipt: Awaited<ReturnType<typeof idempotentAsync<GovernedExportResult>>>["receipt"]; value: GovernedExportResult; replayed: boolean }> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ops.export", { dataClass: "D4" });
    return idempotentAsync(this.store, {
      organizationId: context.organizationId,
      actorId: context.actorId,
      sessionId: context.sessionId,
      operation: "ops.export",
      key: idempotencyKey,
      resourceId: null,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      body: input
    }, async () => {
      if (!this.persistence) throw new DomainError("CAPABILITY_DISABLED", "A exportação governada exige persistência PostgreSQL durável.", 503);
      if (!this.secretProvider || this.secretProvider.status() !== "READY" || !this.keyRef || !this.secretProvider.has(this.keyRef) || !this.secretProvider.resolve) throw new DomainError("CREDENTIAL_UNAVAILABLE", "A referência da chave de exportação não está disponível; nenhum dado foi exportado.", 503);
      let rawKey: string | null;
      try {
        rawKey = await this.secretProvider.resolve(this.keyRef);
      } catch {
        throw new DomainError("CREDENTIAL_UNAVAILABLE", "A chave de exportação não pôde ser resolvida; nenhum dado foi exportado.", 503);
      }
      if (!rawKey) throw new DomainError("CREDENTIAL_UNAVAILABLE", "A chave de exportação não pôde ser resolvida; nenhum dado foi exportado.", 503);
      const bundle = await this.persistence.exportRecoveryBundle(context.organizationId);
      if (!bundle) throw new DomainError("DEPENDENCY_UNAVAILABLE", "Não existe um estado durável confirmado para exportar.", 503);
      const createdAt = now();
      const expiresAt = new Date(Date.parse(createdAt) + input.ttlSeconds * 1_000).toISOString();
      const envelope = encryptRecoveryBundle(bundle, recoveryKey(rawKey), this.keyRef);
      return {
        exportId: makeId(),
        createdAt,
        expiresAt,
        scope: { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId },
        manifest: { format: bundle.manifest.format, version: bundle.manifest.version, revision: bundle.revision.toString(), snapshotDigest: bundle.snapshotDigest, eventId: bundle.eventId, migrationFingerprint: bundle.manifest.migrationFingerprint },
        envelope
      };
    });
  }
}

export function governedExportDigest(result: GovernedExportResult): string {
  return digest({ exportId: result.exportId, expiresAt: result.expiresAt, payloadDigest: result.envelope.payloadDigest, snapshotDigest: result.manifest.snapshotDigest });
}
