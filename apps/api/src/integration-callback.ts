import { verifyMessagingCallback } from "@cvg/integrations";
import type { InboxSignatureVerifier } from "@cvg/persistence";

/**
 * SEC-AI-03: a callback names its signature key, but cannot choose which
 * provider that key speaks for. Each `provider=keyRef` binding is held by the
 * server; rotation adds another binding for the same provider. An unbound pair
 * is rejected before the secret authority is consulted or anything is written.
 */
export function createInboxSignatureVerifier(resolveSecret: (reference: string) => Promise<string | null>, bindings: readonly string[]): InboxSignatureVerifier {
  const allowed = new Set(bindings);
  return async (input) => {
    if (!input.rawBody || !allowed.has(`${input.provider}=${input.signatureKeyRef}`)) return false;
    const secret = await resolveSecret(input.signatureKeyRef);
    return Boolean(secret && verifyMessagingCallback(input.rawBody, input.signature, secret));
  };
}
