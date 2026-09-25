import type { OpaqueId } from "@cvg/contracts";
import type { StoreSnapshot } from "@cvg/domain";
import type { Aud27RemovedDomainRecord, Aud27SnapshotPrimaryKey } from "./aud27-domain-writes.js";

const removalOrder = new Map<Aud27SnapshotPrimaryKey, number>([
  ["aiApprovals", 0], ["aiDrafts", 1], ["aiTurns", 2], ["budgetReservations", 3], ["aiSessions", 4],
  ["knowledgeDocuments", 5], ["messages", 6], ["ledgerEntries", 7], ["payments", 8], ["charges", 9],
  ["administrationOccurrences", 10], ["dispensations", 11], ["medicationOrders", 12], ["stockMovements", 13],
  ["lots", 14], ["stockLocations", 15], ["products", 16], ["hospitalEpisodes", 17], ["beds", 18],
  ["clinicalAddenda", 19], ["queueEntries", 20], ["resources", 21], ["services", 22], ["providers", 23]
]);

export function orderAud27Removals(removals: readonly Aud27RemovedDomainRecord[]): Aud27RemovedDomainRecord[] {
  return [...removals].sort((left, right) => (removalOrder.get(left.snapshotKey)! - removalOrder.get(right.snapshotKey)!) || left.id.localeCompare(right.id));
}

function rowsFor(snapshot: StoreSnapshot, key: Aud27SnapshotPrimaryKey): readonly { id: string }[] {
  return snapshot[key] as unknown as readonly { id: string }[];
}

export function aud27RemovalScope(before: StoreSnapshot, snapshotKey: Aud27SnapshotPrimaryKey, id: string): Pick<Aud27RemovedDomainRecord, "organizationId" | "unitId" | "workspaceId"> {
  const row = rowsFor(before, snapshotKey).find((candidate) => candidate.id === id) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`AUD27 removal ${snapshotKey}:${id} has no organization scope`);
  const unitId = typeof row.unitId === "string" ? row.unitId as OpaqueId : null;
  const workspaceId = typeof row.workspaceId === "string" ? row.workspaceId as OpaqueId : null;
  if (snapshotKey === "clinicalAddenda") {
    const document = before.clinicalDocuments.find((candidate) => candidate.id === row.documentId);
    const encounter = document ? before.encounters.find((candidate) => candidate.id === document.encounterId) : null;
    if (!document || !encounter) throw new Error(`AUD27 removal ${snapshotKey}:${id} has no resolvable document scope`);
    return { organizationId: document.organizationId, unitId: encounter.unitId, workspaceId: encounter.workspaceId };
  }
  if (snapshotKey === "aiTurns" || snapshotKey === "aiDrafts") {
    const session = typeof row.sessionId === "string" ? before.aiSessions.find((candidate) => candidate.id === row.sessionId) : undefined;
    if (!session) throw new Error(`AUD27 removal ${snapshotKey}:${id} has no resolvable session scope`);
    return { organizationId: session.organizationId, unitId: session.unitId, workspaceId: session.workspaceId };
  }
  if (typeof row.organizationId !== "string") throw new Error(`AUD27 removal ${snapshotKey}:${id} has no organization scope`);
  return { organizationId: row.organizationId as OpaqueId, unitId, workspaceId };
}
