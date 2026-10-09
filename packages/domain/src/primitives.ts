import { createHash, randomUUID } from "node:crypto";
import { id, type OpaqueId } from "@cvg/contracts";

export const now = (): string => new Date().toISOString();

function canonicalReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, canonicalReplacer)).digest("hex");
}

export function makeId(): OpaqueId {
  return id(randomUUID());
}
