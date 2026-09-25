import { createHash } from "node:crypto";

/** Hash sensitive request identifiers before using them in durable keys or logs. */
export function tokenDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
