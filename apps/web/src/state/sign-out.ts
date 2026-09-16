import { governedBrowserStorage } from "./persistence";

/**
 * Sign-out revocation bookkeeping (audit H01).
 *
 * A local sign-out is not proof of server revocation. When the server
 * observation is missing or uncertain, this non-sensitive record keeps the
 * risk visible across reloads until an explicit retry observes revocation or
 * the server reports that no session remains. No credential, token, draft or
 * clinical content is ever written here.
 */
export type SignOutRevocationState = "PENDING" | "UNKNOWN" | "CONFIRMED" | "NOT_REVOKED";
export type SignOutRecord = { state: SignOutRevocationState; attempted: boolean; updatedAt: string };

const STORAGE_KEY = "cvg.sign-out.revocation";

function storage() { return governedBrowserStorage(); }

export function readSignOutRecord(): SignOutRecord | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SignOutRecord> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.state !== "PENDING" && parsed.state !== "UNKNOWN" && parsed.state !== "CONFIRMED" && parsed.state !== "NOT_REVOKED") return null;
    if (typeof parsed.attempted !== "boolean" || typeof parsed.updatedAt !== "string") return null;
    return { state: parsed.state, attempted: parsed.attempted, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

export function writeSignOutRecord(record: SignOutRecord): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage quota or privacy mode: the risk stays only in memory */
  }
}

export function clearSignOutRecord(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function pendingRevocationRecord(attempted: boolean): SignOutRecord {
  return { state: attempted ? "UNKNOWN" : "PENDING", attempted, updatedAt: new Date().toISOString() };
}

export function revocationRisk(record: SignOutRecord | null): boolean {
  return record !== null && (record.state === "PENDING" || record.state === "UNKNOWN" || record.state === "NOT_REVOKED");
}
