import { createHash } from "node:crypto";
import type { AiSession, AiTurn } from "@cvg/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical JSON used for replay evidence. Object key order is irrelevant,
 * array order is part of the ledger, and the resulting digest is always a
 * lowercase SHA-256 hex string.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function replayDigest(session: Pick<AiSession, "engineCommit" | "profileDigest">, turns: readonly AiTurn[]): string {
  return createHash("sha256").update(canonicalJson({ engineCommit: session.engineCommit, profileDigest: session.profileDigest, turns }), "utf8").digest("hex");
}
