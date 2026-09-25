import type { StoreSnapshot } from "@cvg/domain";
import { AUD27_SNAPSHOT_PRIMARY_KEYS } from "@cvg/persistence";

export type Aud27SliceSnapshotKey = (typeof AUD27_SNAPSHOT_PRIMARY_KEYS)[number];

export const AUD27_NORMALIZED_TABLE_BY_KEY: Readonly<Record<Aud27SliceSnapshotKey, string>> = Object.freeze({
  providers: "providers",
  services: "service_catalog_items",
  resources: "resources",
  queueEntries: "queue_entries",
  clinicalAddenda: "clinical_addenda",
  beds: "beds",
  hospitalEpisodes: "hospital_episodes",
  products: "products",
  stockLocations: "stock_locations",
  lots: "lots",
  stockMovements: "stock_movements",
  medicationOrders: "medication_orders",
  dispensations: "dispensations",
  administrationOccurrences: "administration_occurrences",
  charges: "charges",
  payments: "payments",
  ledgerEntries: "ledger_entries",
  messages: "communication_messages",
  knowledgeDocuments: "knowledge_documents",
  aiSessions: "ai_sessions",
  budgetReservations: "budget_reservations",
  aiTurns: "ai_turns",
  aiDrafts: "ai_drafts",
  aiApprovals: "ai_approvals"
});

export function expectedAud27SnapshotRowCounts(snapshot: Pick<StoreSnapshot, Aud27SliceSnapshotKey>): ReadonlyMap<string, number> {
  return new Map(AUD27_SNAPSHOT_PRIMARY_KEYS.map((key) => [AUD27_NORMALIZED_TABLE_BY_KEY[key], snapshot[key].length]));
}

export function assertAud27SnapshotCountParity(
  snapshot: Pick<StoreSnapshot, Aud27SliceSnapshotKey>,
  observed: ReadonlyMap<string, number>,
  phase: string
): void {
  const expected = expectedAud27SnapshotRowCounts(snapshot);
  const failures: string[] = [];
  for (const [table, expectedCount] of expected) {
    const actualCount = observed.get(table);
    if (!Number.isSafeInteger(actualCount) || actualCount !== expectedCount) failures.push(`${table} expected=${expectedCount} actual=${actualCount === undefined ? "missing" : actualCount}`);
  }
  for (const table of observed.keys()) if (!expected.has(table)) failures.push(`${table} expected=unmapped actual=${observed.get(table)}`);
  if (observed.size !== expected.size && failures.length === 0) failures.push(`table_count expected=${expected.size} actual=${observed.size}`);
  if (failures.length > 0) throw new Error(`AUD27 snapshot row-count parity failed during ${phase}: ${failures.join(", ")}`);
}
