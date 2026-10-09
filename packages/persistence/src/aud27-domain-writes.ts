import type {
  AdministrationOccurrence,
  AiApproval,
  AiDraft,
  AiSession,
  AiTurn,
  Bed,
  BudgetReservation,
  Charge,
  ClinicalAddendum,
  CommunicationMessage,
  Dispensation,
  HospitalEpisode,
  KnowledgeDocument,
  LedgerEntry,
  Lot,
  MedicationOrder,
  Payment,
  Product,
  Provider,
  QueueEntry,
  Resource,
  ServiceCatalogItem,
  StockLocation,
  StockMovement
} from "@cvg/contracts";
import type { OpaqueId } from "@cvg/contracts";
import { digest, type StoreSnapshot } from "@cvg/domain";
import { aud27RemovalScope } from "./aud27-removals.js";

/**
 * AUD27-011..014: the residual snapshot collections have one explicit
 * normalized-write seam.  The snapshot remains the durable aggregate while a
 * slice is being qualified, but a changed row must identify the relational
 * owner instead of silently falling through the whole-snapshot projector.
 */
export const AUD27_SNAPSHOT_PRIMARY_KEYS = [
  "providers",
  "services",
  "resources",
  "queueEntries",
  "clinicalAddenda",
  "beds",
  "hospitalEpisodes",
  "products",
  "stockLocations",
  "lots",
  "stockMovements",
  "medicationOrders",
  "dispensations",
  "administrationOccurrences",
  "charges",
  "payments",
  "ledgerEntries",
  "messages",
  "knowledgeDocuments",
  "aiSessions",
  "budgetReservations",
  "aiTurns",
  "aiDrafts",
  "aiApprovals"
] as const satisfies ReadonlyArray<keyof StoreSnapshot>;

export type Aud27SnapshotPrimaryKey = (typeof AUD27_SNAPSHOT_PRIMARY_KEYS)[number];

type Aud27SnapshotPrimaryRecordMap = {
  providers: Provider;
  services: ServiceCatalogItem;
  resources: Resource;
  queueEntries: QueueEntry;
  clinicalAddenda: ClinicalAddendum;
  beds: Bed;
  hospitalEpisodes: HospitalEpisode;
  products: Product;
  stockLocations: StockLocation;
  lots: Lot;
  stockMovements: StockMovement;
  medicationOrders: MedicationOrder;
  dispensations: Dispensation;
  administrationOccurrences: AdministrationOccurrence;
  charges: Charge;
  payments: Payment;
  ledgerEntries: LedgerEntry;
  messages: CommunicationMessage;
  knowledgeDocuments: KnowledgeDocument;
  aiSessions: AiSession;
  aiTurns: AiTurn;
  aiDrafts: AiDraft;
  aiApprovals: AiApproval;
  budgetReservations: BudgetReservation;
};

export type Aud27NormalizedDomainWrite = {
  [K in Aud27SnapshotPrimaryKey]: {
    snapshotKey: K;
    record: Aud27SnapshotPrimaryRecordMap[K];
  }
}[Aud27SnapshotPrimaryKey];

export type Aud27RemovedDomainRecord = {
  snapshotKey: Aud27SnapshotPrimaryKey;
  id: string;
  organizationId: OpaqueId;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
};

export type Aud27NormalizedWritePlan = {
  writes: readonly Aud27NormalizedDomainWrite[];
  removed: readonly Aud27RemovedDomainRecord[];
};

const writeOrder = new Map<Aud27SnapshotPrimaryKey, number>(AUD27_SNAPSHOT_PRIMARY_KEYS.map((key, index) => [key, index]));
const earlyNormalizedKeys = new Set<Aud27SnapshotPrimaryKey>([
  "providers",
  "services",
  "resources",
  "beds",
  "products",
  "stockLocations",
  "lots",
  "charges",
  "knowledgeDocuments"
]);

function rowsFor(snapshot: StoreSnapshot, key: Aud27SnapshotPrimaryKey): readonly { id: string }[] {
  return snapshot[key] as unknown as readonly { id: string }[];
}

/**
 * Builds a deterministic, content-bound plan for the rows changed by one
 * command commit.  Deletions are returned separately so callers cannot
 * accidentally treat an absent row as a successful upsert; each deletion
 * requires an explicit slice-specific policy before cutover.
 */
export function buildAud27NormalizedWritePlan(before: StoreSnapshot, after: StoreSnapshot): Aud27NormalizedWritePlan {
  const writes: Aud27NormalizedDomainWrite[] = [];
  const removed: Aud27RemovedDomainRecord[] = [];
  for (const snapshotKey of AUD27_SNAPSHOT_PRIMARY_KEYS) {
    const beforeRows = new Map(rowsFor(before, snapshotKey).map((row) => [row.id, row]));
    const afterRows = rowsFor(after, snapshotKey);
    for (const row of afterRows) {
      const previous = beforeRows.get(row.id);
      if (!previous || digest(previous) !== digest(row)) {
        writes.push({ snapshotKey, record: row } as Aud27NormalizedDomainWrite);
      }
      beforeRows.delete(row.id);
    }
    for (const id of beforeRows.keys()) removed.push({ snapshotKey, id, ...aud27RemovalScope(before, snapshotKey, id) });
  }
  writes.sort((left, right) => (writeOrder.get(left.snapshotKey)! - writeOrder.get(right.snapshotKey)!) || String(left.record.id).localeCompare(String(right.record.id)));
  removed.sort((left, right) => (writeOrder.get(left.snapshotKey)! - writeOrder.get(right.snapshotKey)!) || left.id.localeCompare(right.id));
  return { writes, removed };
}

export function validateAud27NormalizedWrites(snapshot: StoreSnapshot, writes: readonly Aud27NormalizedDomainWrite[], corruption: (message: string) => Error): Map<Aud27SnapshotPrimaryKey, Set<string>> {
  const normalizedIds = new Map<Aud27SnapshotPrimaryKey, Set<string>>();
  for (const write of writes) {
    const ids = normalizedIds.get(write.snapshotKey) ?? new Set<string>();
    if (ids.has(write.record.id)) throw corruption(`duplicate AUD27 normalized write ${write.snapshotKey}:${write.record.id}`);
    const snapshotRows = rowsFor(snapshot, write.snapshotKey);
    const snapshotRow = snapshotRows.find((row) => row.id === write.record.id);
    if (!snapshotRow || digest(snapshotRow) !== digest(write.record)) throw corruption(`AUD27 normalized write ${write.snapshotKey}:${write.record.id} is not identical to the canonical snapshot`);
    ids.add(write.record.id);
    normalizedIds.set(write.snapshotKey, ids);
  }
  return normalizedIds;
}

export function isEarlyAud27SnapshotKey(snapshotKey: Aud27SnapshotPrimaryKey): boolean {
  return earlyNormalizedKeys.has(snapshotKey);
}

/**
 * AUD27-011: transitional command seams for collections that remain
 * SNAPSHOT_PRIMARY. Each entry keeps an explicit owner and must match a
 * declared snapshot-primary collection; it is not a second command registry
 * and cannot survive a cutover without moving to AUTHORITATIVE_COMMAND_REGISTRY.
 */
export const AUD27_TRANSITIONAL_WRITE_FIELDS = [
  { inputField: "normalizedProductWrite", snapshotKey: "products", owner: "stock" }
] as const satisfies ReadonlyArray<{ inputField: string; snapshotKey: Aud27SnapshotPrimaryKey; owner: string }>;
