import type { ApiClient } from "./client";
import type { ContextOption, MeResponse } from "../state/types";

export type SessionContextResponse = { me: MeResponse; contexts: ContextOption[] };

export async function fetchSessionAndContexts(client: ApiClient, context: ContextOption | null): Promise<SessionContextResponse> {
  const me = await client.get<MeResponse>("/me", context);
  const contexts = await client.get<ContextOption[]>("/contexts", context);
  return { me, contexts };
}
