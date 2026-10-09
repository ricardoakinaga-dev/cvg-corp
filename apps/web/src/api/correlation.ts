let lastCorrelationId: string | null = null;

/** CVG-AUD19-019: only sanitized correlation IDs are remembered for the UI. */
export function rememberCorrelationId(value: unknown): void {
  if (typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value)) lastCorrelationId = value;
}

export function currentCorrelationId(): string | null {
  return lastCorrelationId;
}
