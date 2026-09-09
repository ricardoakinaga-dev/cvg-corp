export {};

type GateStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
type EvidenceClass = "REMOTE_HEALTH" | "REMOTE_READINESS" | "HTTPS_TRANSPORT" | "NO_EVIDENCE" | "CONFIGURATION";

type GateResult = {
  gate: string;
  status: GateStatus;
  evidence: EvidenceClass;
  detail?: string;
};

type JsonRecord = Record<string, unknown>;

type Probe = {
  transportOk: boolean;
  sameOrigin: boolean;
  status: number | null;
  body: unknown;
  detail?: string;
};

const timeoutMs = 10_000;
const results: GateResult[] = [];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redact(value: string): string {
  return value
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/((?:password|secret|token|credential|authorization|cookie)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[REDACTED]")
    .replace(/\r?\n/g, " | ")
    .trim()
    .slice(0, 1_000);
}

function record(gate: string, status: GateStatus, evidence: EvidenceClass, detail?: string): void {
  const result: GateResult = { gate, status, evidence };
  if (detail) result.detail = redact(detail);
  results.push(result);
  const suffix = result.detail ? ` detail=${JSON.stringify(result.detail)}` : "";
  process.stdout.write(`${status} ${gate} evidence=${evidence}${suffix}\n`);
}

function optionValue(names: string[]): string | undefined {
  for (const name of names) {
    const exactIndex = process.argv.indexOf(name);
    if (exactIndex >= 0) return process.argv[exactIndex + 1]?.trim();
    const prefix = `${name}=`;
    const inline = process.argv.find((argument) => argument.startsWith(prefix));
    if (inline) return inline.slice(prefix.length).trim();
  }
  return undefined;
}

function configuredStagingUrl(): string | undefined {
  return optionValue(["--url", "--staging-url"]) ?? process.env.CVG_STAGING_URL?.trim();
}

function parseStagingUrl(raw: string | undefined): URL | null {
  if (!raw) {
    record("staging-url", "BLOCKED", "CONFIGURATION", "provide --url or CVG_STAGING_URL explicitly");
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) URLs are allowed");
    if (url.username || url.password) throw new Error("credentials in the staging URL are forbidden");
    if (url.search || url.hash) throw new Error("query strings and fragments are forbidden in the staging URL");
    record("staging-url", "PASS", "CONFIGURATION", `explicit target accepted: ${url.origin}${url.pathname}`);
    return url;
  } catch (error) {
    record("staging-url", "BLOCKED", "CONFIGURATION", `invalid staging URL: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function endpoint(base: URL, resource: "health" | "ready"): URL {
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return new URL(`${base.origin}${prefix}api/v1/${resource}`);
}

async function probe(base: URL, resource: "health" | "ready"): Promise<Probe> {
  const url = endpoint(base, resource);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json", "user-agent": "cvg-corp-staging-verifier/1" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const sameOrigin = response.url.length === 0 || new URL(response.url).origin === base.origin;
    const bodyText = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      return { transportOk: true, sameOrigin, status: response.status, body: null, detail: `non-JSON response from ${url.pathname}` };
    }
    if (response.status >= 300 && response.status < 400) {
      return { transportOk: false, sameOrigin, status: response.status, body, detail: "redirect refused; verifier never follows a redirect outside the configured URL" };
    }
    return { transportOk: response.status >= 200 && response.status < 300, sameOrigin, status: response.status, body };
  } catch (error) {
    return { transportOk: false, sameOrigin: false, status: null, body: null, detail: error instanceof Error ? error.message : String(error) };
  }
}

function responseData(body: unknown): JsonRecord | null {
  if (!isRecord(body)) return null;
  if (isRecord(body.data)) return body.data;
  return body;
}

function validEnvelope(body: unknown): boolean {
  return isRecord(body) && body.schemaVersion === 1 && typeof body.correlationId === "string" && body.correlationId.length > 0;
}

function validateHealth(probeResult: Probe): void {
  const data = responseData(probeResult.body);
  if (!probeResult.transportOk || !probeResult.sameOrigin || probeResult.status !== 200) {
    record("health", "FAIL", "REMOTE_HEALTH", probeResult.detail ?? `unexpected HTTP status ${probeResult.status ?? "unavailable"}`);
    return;
  }
  if (!validEnvelope(probeResult.body) || data?.live !== true) {
    record("health", "FAIL", "REMOTE_HEALTH", "response did not prove schemaVersion=1 and data.live=true");
    return;
  }
  record("health", "PASS", "REMOTE_HEALTH", "remote liveness response validated");
}

function validateReadiness(probeResult: Probe): void {
  const data = responseData(probeResult.body);
  if (!probeResult.transportOk || !probeResult.sameOrigin || probeResult.status !== 200) {
    record("readiness", "FAIL", "REMOTE_READINESS", probeResult.detail ?? `readiness is not HTTP 200 (${probeResult.status ?? "unavailable"})`);
    return;
  }
  if (!validEnvelope(probeResult.body) || data?.ready !== true || !isRecord(data.checks)) {
    record("readiness", "FAIL", "REMOTE_READINESS", "response did not prove schemaVersion=1, data.ready=true and dependency checks");
    return;
  }
  record("readiness", "PASS", "REMOTE_READINESS", "remote readiness response validated; self-reported checks are not independent AAA evidence");
}

function recordUnexecutedEvidence(): void {
  const missingEvidence: Array<[string, string]> = [
    ["provider", "no provider sandbox transaction/receipt/callback/reconciliation evidence was supplied"],
    ["secret", "no secret authority/rotation/fail-closed evidence was supplied"],
    ["observability", "no collector/metrics/traces/alerts/SLO evidence was supplied"],
    ["browser", "no staging browser matrix or accessibility run was supplied"],
    ["recovery", "no staging backup/restore/replay evidence was supplied"],
    ["load", "no staging performance/load/error-budget evidence was supplied"]
  ];
  for (const [gate, detail] of missingEvidence) record(gate, "NOT_RUN", "NO_EVIDENCE", detail);
}

async function main(): Promise<void> {
  const base = parseStagingUrl(configuredStagingUrl());
  if (!base) {
    record("health", "BLOCKED", "NO_EVIDENCE", "staging URL is required before any request can be made");
    record("readiness", "BLOCKED", "NO_EVIDENCE", "staging URL is required before any request can be made");
    record("TLS", "NOT_RUN", "NO_EVIDENCE", "no HTTPS staging URL was configured");
    recordUnexecutedEvidence();
    process.stdout.write("VERDICT STAGING_EVIDENCE_INCOMPLETE\n");
    process.stderr.write("FAIL-CLOSED staging URL/configuration is missing or invalid; no network request was made\n");
    process.exitCode = 2;
    return;
  }

  if (typeof fetch !== "function") {
    record("health", "BLOCKED", "NO_EVIDENCE", "this Node runtime does not provide fetch");
    record("readiness", "BLOCKED", "NO_EVIDENCE", "this Node runtime does not provide fetch");
  } else {
    const healthProbe = await probe(base, "health");
    const readinessProbe = await probe(base, "ready");
    validateHealth(healthProbe);
    validateReadiness(readinessProbe);

    if (base.protocol === "https:" && healthProbe.transportOk && healthProbe.sameOrigin && readinessProbe.transportOk && readinessProbe.sameOrigin) {
      record("TLS", "PASS", "HTTPS_TRANSPORT", "both probes completed over the explicitly configured HTTPS origin; proxy policy remains unverified");
    } else {
      record("TLS", "NOT_RUN", "NO_EVIDENCE", "an HTTPS transport probe was not proven");
    }
  }

  recordUnexecutedEvidence();
  process.stdout.write("VERDICT STAGING_EVIDENCE_INCOMPLETE\n");
  process.stdout.write("PROMOTION BLOCKED health/readiness alone cannot promote provider, secret, TLS, observability, browser, recovery or load evidence\n");

  const hasFailure = results.some((result) => result.status === "FAIL");
  const hasBlocked = results.some((result) => result.status === "BLOCKED");
  process.exitCode = hasFailure ? 1 : hasBlocked || results.some((result) => result.status === "NOT_RUN") ? 2 : 0;
}

await main();
