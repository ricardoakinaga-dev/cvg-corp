import { createHmac } from "node:crypto";

/** Bind identity, arguments, destination and a one-shot nonce to a short-lived authenticated request. */
export function bridgeRequestSignature(secret: string, method: string, path: string, issuedAt: string, payload: unknown, nonce?: string): string {
  return createHmac("sha256", secret).update(JSON.stringify({ version: 3, method, path, issuedAt, nonce: nonce ?? null, payload }), "utf8").digest("hex");
}

export const BRIDGE_REQUEST_MAX_AGE_MS = 60_000;
export const BRIDGE_REQUEST_CLOCK_SKEW_MS = 5_000;
