/**
 * Deliberately narrow remote probe for a deployed Compose artifact. It proves
 * only the transport, release binding and edge headers it can observe. Login,
 * writes, worker effects and provider/DeepSeek behaviour remain blocked until
 * an approved non-production smoke identity and scenario are supplied.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

type HeaderName = "strict-transport-security" | "content-security-policy" | "x-content-type-options" | "referrer-policy" | "permissions-policy" | "x-frame-options";
const sha40 = /^[a-f0-9]{40}$/;
const artifactDigest = /^sha256:[a-f0-9]{64}$/;
const timeoutMs = 10_000;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at >= 0) return process.argv[at + 1]?.trim();
  return process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1).trim();
}
function block(message: string): never { throw new Error(message); }
export function securityHeadersValid(headers: Headers): string[] {
  const failures: string[] = [];
  const requirements: Array<[HeaderName, (value: string) => boolean]> = [
    ["strict-transport-security", (value) => /max-age=\d{6,}/i.test(value) && /includesubdomains/i.test(value)],
    ["content-security-policy", (value) => /default-src 'self'/.test(value) && /frame-ancestors 'none'/.test(value)],
    ["x-content-type-options", (value) => value.toLowerCase() === "nosniff"],
    ["referrer-policy", (value) => /no-referrer|same-origin/i.test(value)],
    ["permissions-policy", (value) => /camera=\(\)/.test(value) && /microphone=\(\)/.test(value)],
    ["x-frame-options", (value) => value.toUpperCase() === "DENY"]
  ];
  for (const [name, condition] of requirements) {
    const value = headers.get(name);
    if (!value || !condition(value)) failures.push(`security header ${name} is missing or weak`);
  }
  return failures;
}

export function cookieFlagsValid(values: readonly string[]): string[] {
  const failures: string[] = [];
  const sessionCookies = values.filter((candidate) => /(?:^|;)\s*cvg_session=/i.test(candidate));
  const csrfCookies = values.filter((candidate) => /(?:^|;)\s*cvg_csrf=/i.test(candidate));
  for (const value of sessionCookies) {
    if (!/;\s*secure(?:;|$)/i.test(value)) failures.push("session cookie is missing Secure");
    if (!/;\s*httponly(?:;|$)/i.test(value)) failures.push("session cookie is missing HttpOnly");
    if (!/;\s*samesite=strict(?:;|$)/i.test(value)) failures.push("session cookie is missing SameSite=Strict");
  }
  for (const value of csrfCookies) {
    if (!/;\s*secure(?:;|$)/i.test(value)) failures.push("CSRF cookie is missing Secure");
    if (!/;\s*samesite=strict(?:;|$)/i.test(value)) failures.push("CSRF cookie is missing SameSite=Strict");
  }
  if (values.includes("__cvg_require_session__") && sessionCookies.length === 0) failures.push("authenticated smoke did not receive a cvg_session cookie");
  return failures;
}

/** The controlled provider endpoint must prove a durable external effect. */
export function providerScenarioValid(body: Record<string, unknown>): boolean {
  const data = responseData(body);
  return typeof data.receiptId === "string"
    && data.receiptId.trim().length > 0
    && typeof data.effectId === "string"
    && data.effectId.trim().length > 0
    && typeof data.auditRecordId === "string"
    && data.auditRecordId.trim().length > 0
    && typeof data.outboxId === "string"
    && data.outboxId.trim().length > 0
    && typeof data.reconciliationId === "string"
    && data.reconciliationId.trim().length > 0
    && data.outboxDurable === true
    && data.replayIdempotent === true
    && typeof data.outcome === "string"
    && ["DELIVERED", "RECONCILED", "OUTCOME_UNKNOWN"].includes(data.outcome);
}

async function response(url: URL): Promise<Response> {
  const result = await fetch(url, { redirect: "manual", headers: { accept: "application/json", "user-agent": "cvg-corp-container-smoke/1" }, signal: AbortSignal.timeout(timeoutMs) });
  if (result.status < 200 || result.status >= 300) block(`${url.pathname} returned HTTP ${result.status}`);
  if (new URL(result.url).origin !== url.origin) block(`${url.pathname} resolved outside the explicitly configured origin`);
  return result;
}

function setCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") return withGetSetCookie.getSetCookie();
  return (headers.get("set-cookie") ?? "").split(/,(?=[^;]+=[^;]+)/).filter(Boolean);
}

function cookiePair(value: string): string {
  return value.split(";", 1)[0]!.trim();
}

function updateCookieJar(jar: Map<string, string>, headers: Headers): void {
  for (const value of setCookies(headers)) {
    const pair = cookiePair(value);
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function authenticatedRequest(url: URL, jar: Map<string, string>, init: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ response: Response; body: Record<string, unknown>; setCookie: string[] }> {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "cvg-corp-container-smoke/1", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) };
  const cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookie) headers.cookie = cookie;
  const result = await fetch(url, { method: init.method ?? "GET", redirect: "manual", headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }), signal: AbortSignal.timeout(timeoutMs) });
  if (new URL(result.url).origin !== url.origin) block(`${url.pathname} resolved outside the explicitly configured origin`);
  const observedCookies = setCookies(result.headers);
  updateCookieJar(jar, result.headers);
  let body: unknown = {};
  try { body = await result.json(); } catch { body = {}; }
  return { response: result, body: jsonRecord(body), setCookie: observedCookies };
}

function responseData(body: Record<string, unknown>): Record<string, unknown> {
  return jsonRecord(body.data);
}

function baseEndpoint(base: URL, path: string): URL {
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return new URL(`${prefix}${path.replace(/^\/+/, "")}`, base.origin);
}

function requiredSmokeValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) block(`${name} is required for the authenticated container smoke scenario`);
  return value;
}

function assertReleaseHeaders(headers: Headers, expectedSha: string, expectedArtifact: string, label: string): void {
  if (headers.get("x-cvg-release-sha") !== expectedSha) block(`${label} release SHA response header does not match the requested audited SHA`);
  if (headers.get("x-cvg-release-artifact-digest") !== expectedArtifact) block(`${label} release artifact response header does not match the requested immutable artifact`);
  const failures = securityHeadersValid(headers);
  if (failures.length) block(`${label}: ${failures.join("; ")}`);
}

function secureSmokeUrl(raw: string, label: string): URL {
  const value = new URL(raw);
  if (value.protocol !== "https:" || value.username || value.password || value.search || value.hash) block(`${label} must be a credential-free HTTPS URL without query or fragment`);
  return value;
}

function cleartextSmokeUrl(raw: string, label: string): URL {
  const value = new URL(raw);
  if (value.protocol !== "http:" || value.username || value.password || value.search || value.hash) block(`${label} must be a credential-free HTTP URL without query or fragment`);
  return value;
}

async function verifyHttpRedirect(httpUrl: URL, httpsBase: URL): Promise<void> {
  const result = await fetch(httpUrl, { redirect: "manual", headers: { accept: "application/json", "user-agent": "cvg-corp-container-smoke/1" }, signal: AbortSignal.timeout(timeoutMs) });
  if (result.status !== 308) block(`${httpUrl.pathname} returned HTTP ${result.status}; expected an HTTP-to-HTTPS 308 redirect`);
  if (result.headers.has("strict-transport-security")) block("HTTP redirect emitted Strict-Transport-Security; HSTS is valid only over HTTPS");
  const locationHeader = result.headers.get("location");
  if (!locationHeader) block("HTTP redirect did not include a Location header");
  const location = new URL(locationHeader, httpUrl);
  if (location.origin !== httpsBase.origin || location.pathname !== httpUrl.pathname || location.search !== httpUrl.search) block("HTTP redirect did not preserve the configured HTTPS origin and request path");
}

async function runAuthenticatedScenario(base: URL, expectedSha: string, expectedArtifact: string): Promise<void> {
  const login = requiredSmokeValue("CVG_CONTAINER_SMOKE_LOGIN");
  const password = requiredSmokeValue("CVG_CONTAINER_SMOKE_PASSWORD");
  if (process.env.CVG_CONTAINER_SMOKE_ALLOW_WRITE !== "true") block("CVG_CONTAINER_SMOKE_ALLOW_WRITE=true is required before the controlled smoke database write");
  const jar = new Map<string, string>();
  const loginResult = await authenticatedRequest(baseEndpoint(base, "/api/v1/auth/login"), jar, { method: "POST", body: { login, password } });
  if (loginResult.response.status !== 200 && loginResult.response.status !== 202) block(`login returned HTTP ${loginResult.response.status}`);
  let observedCookies = [...loginResult.setCookie];
  let authData = responseData(loginResult.body);
  if (loginResult.response.status === 202 && authData.mfaRequired === true) {
    const code = requiredSmokeValue("CVG_CONTAINER_SMOKE_TOTP");
    const challengeId = typeof authData.challengeId === "string" ? authData.challengeId : "";
    if (!challengeId) block("login returned an MFA challenge without a challengeId");
    const mfa = await authenticatedRequest(baseEndpoint(base, "/api/v1/auth/mfa/verify"), jar, { method: "POST", body: { challengeId, code } });
    if (mfa.response.status !== 200) block(`MFA verification returned HTTP ${mfa.response.status}`);
    observedCookies = [...observedCookies, ...mfa.setCookie];
    authData = responseData(mfa.body);
  }
  const cookieFailures = cookieFlagsValid([...observedCookies, "__cvg_require_session__"]);
  if (cookieFailures.length) block(cookieFailures.join("; "));
  const contexts = Array.isArray(authData.contexts) ? authData.contexts : [];
  const firstContext = jsonRecord(contexts[0]);
  const unit = jsonRecord(firstContext.unit);
  const workspace = jsonRecord(firstContext.workspace);
  const unitId = process.env.CVG_CONTAINER_SMOKE_UNIT_ID?.trim() || (typeof unit.id === "string" ? unit.id : "");
  const workspaceId = process.env.CVG_CONTAINER_SMOKE_WORKSPACE_ID?.trim() || (typeof workspace.id === "string" ? workspace.id : "");
  if (!unitId || !workspaceId) block("authenticated smoke requires a unit and workspace context");
  const csrf = typeof authData.csrfToken === "string" ? authData.csrfToken : jar.get("cvg_csrf");
  if (!csrf) block("authenticated smoke did not receive a CSRF token");
  const scopedHeaders = { "x-cvg-unit-id": unitId, "x-cvg-workspace-id": workspaceId, "x-csrf-token": csrf };

  const patients = await authenticatedRequest(baseEndpoint(base, "/api/v1/patients"), jar, { headers: { "x-cvg-unit-id": unitId, "x-cvg-workspace-id": workspaceId } });
  if (patients.response.status !== 200 || !Array.isArray(responseData(patients.body).items)) block(`patient lookup returned HTTP ${patients.response.status} or an invalid item list`);

  const guardianName = requiredSmokeValue("CVG_CONTAINER_SMOKE_GUARDIAN_NAME");
  const guardianPhone = requiredSmokeValue("CVG_CONTAINER_SMOKE_GUARDIAN_PHONE");
  const write = await authenticatedRequest(baseEndpoint(base, "/api/v1/guardians"), jar, { method: "POST", headers: { ...scopedHeaders, "idempotency-key": `container-smoke-${expectedSha}` }, body: { displayName: guardianName, phone: guardianPhone, email: process.env.CVG_CONTAINER_SMOKE_GUARDIAN_EMAIL?.trim() || null } });
  if (write.response.status !== 201 || !jsonRecord(responseData(write.body).guardian).id) block(`controlled database write returned HTTP ${write.response.status}`);

  const metrics = await authenticatedRequest(baseEndpoint(base, "/api/v1/metrics"), jar, { headers: { "x-cvg-unit-id": unitId, "x-cvg-workspace-id": workspaceId } });
  const metricData = responseData(metrics.body);
  const queues = jsonRecord(metricData.queues);
  const dependencies = jsonRecord(metricData.dependencies);
  if (metrics.response.status !== 200 || typeof queues.workerHeartbeatCount !== "number" || queues.workerHeartbeatCount < 1) block("worker cycle was not observed through a durable heartbeat");
  if (dependencies.database !== "READY" || dependencies.outbox !== "READY") block("database/outbox did not report a ready production boundary");

  const deepseekHealthUrl = secureSmokeUrl(requiredSmokeValue("CVG_CONTAINER_SMOKE_DEEPSEEK_HEALTH_URL"), "DeepSeek health URL");
  const deepseekHealth = await response(deepseekHealthUrl);
  const deepseekBody = jsonRecord(await deepseekHealth.json().catch(() => ({})));
  if (jsonRecord(deepseekBody.data).status !== "READY" && deepseekBody.status !== "READY") block("DeepSeek health did not report READY");
  const providerHealthUrl = secureSmokeUrl(requiredSmokeValue("CVG_CONTAINER_SMOKE_PROVIDER_HEALTH_URL"), "provider health URL");
  const providerHealth = await response(providerHealthUrl);
  const providerHealthBody = jsonRecord(await providerHealth.json().catch(() => ({})));
  if (jsonRecord(providerHealthBody.data).status !== "READY" && providerHealthBody.status !== "READY") block("provider health did not report READY");

  if (process.env.CVG_CONTAINER_SMOKE_PROVIDER_SCENARIO_ALLOW !== "true") block("CVG_CONTAINER_SMOKE_PROVIDER_SCENARIO_ALLOW=true is required before the controlled provider transaction");
  const providerScenarioUrl = secureSmokeUrl(requiredSmokeValue("CVG_CONTAINER_SMOKE_PROVIDER_SCENARIO_URL"), "provider scenario URL");
  const providerScenario = await fetch(providerScenarioUrl, {
    method: "POST",
    redirect: "manual",
    headers: { accept: "application/json", "content-type": "application/json", "x-cvg-release-sha": expectedSha, "x-cvg-release-artifact-digest": expectedArtifact, "idempotency-key": `container-provider-smoke-${expectedSha}` },
    body: JSON.stringify({ releaseSha: expectedSha, artifactDigest: expectedArtifact, idempotencyKey: `container-provider-smoke-${expectedSha}` }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const providerScenarioBody = jsonRecord(await providerScenario.json().catch(() => ({})));
  if (providerScenario.status < 200 || providerScenario.status >= 300 || !providerScenarioValid(providerScenarioBody)) block("provider scenario did not return a durable receipt/effect/audit outcome");

  const shutdownUrl = secureSmokeUrl(requiredSmokeValue("CVG_CONTAINER_SMOKE_SHUTDOWN_URL"), "shutdown orchestrator URL");
  const shutdown = await fetch(shutdownUrl, { method: "POST", redirect: "manual", headers: { accept: "application/json", "content-type": "application/json", "x-cvg-release-sha": expectedSha, "x-cvg-release-artifact-digest": expectedArtifact }, body: JSON.stringify({ releaseSha: expectedSha, artifactDigest: expectedArtifact, outboxId: responseData(providerScenarioBody).outboxId }), signal: AbortSignal.timeout(timeoutMs) });
  const shutdownBody = jsonRecord(await shutdown.json().catch(() => ({})));
  const shutdownData = responseData(shutdownBody);
  if (shutdown.status < 200 || shutdown.status >= 300 || shutdownData.shutdownObserved !== true || shutdownData.outboxDurable !== true) block("shutdown orchestrator did not prove a graceful stop with a durable outbox cycle");

  const restartUrl = secureSmokeUrl(requiredSmokeValue("CVG_CONTAINER_SMOKE_RESTART_URL"), "restart orchestrator URL");
  const restart = await fetch(restartUrl, { method: "POST", redirect: "manual", headers: { accept: "application/json", "content-type": "application/json", "x-cvg-release-sha": expectedSha, "x-cvg-release-artifact-digest": expectedArtifact }, body: JSON.stringify({ releaseSha: expectedSha, artifactDigest: expectedArtifact }), signal: AbortSignal.timeout(timeoutMs) });
  if (restart.status < 200 || restart.status >= 300) block(`restart orchestrator returned HTTP ${restart.status}`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  const restartedHealth = await response(baseEndpoint(base, "/healthz"));
  assertReleaseHeaders(restartedHealth.headers, expectedSha, expectedArtifact, "health after restart");
  const restartedReady = await response(baseEndpoint(base, "/api/v1/ready"));
  assertReleaseHeaders(restartedReady.headers, expectedSha, expectedArtifact, "readiness after restart");
  const restartedReadyBody = jsonRecord(await restartedReady.clone().json().catch(() => ({})));
  if (jsonRecord(restartedReadyBody.data).ready !== true) block("readiness after restart did not report ready=true");
  const restartBody = jsonRecord(await restart.clone().json().catch(() => ({})));
  const restartData = responseData(restartBody);
  if (restartData.replayIdempotent !== true || restartData.outboxRecovered !== true) block("restart orchestrator did not prove durable outbox recovery and idempotent replay");
  const restartedDeepseek = await response(deepseekHealthUrl);
  const restartedDeepseekBody = jsonRecord(await restartedDeepseek.json().catch(() => ({})));
  if (jsonRecord(restartedDeepseekBody.data).status !== "READY" && restartedDeepseekBody.status !== "READY") block("DeepSeek health after restart did not report READY");
  const restartedProvider = await response(providerHealthUrl);
  const restartedProviderBody = jsonRecord(await restartedProvider.json().catch(() => ({})));
  if (jsonRecord(restartedProviderBody.data).status !== "READY" && restartedProviderBody.status !== "READY") block("provider health after restart did not report READY");
}

async function main(): Promise<void> {
  try {
    const rawUrl = option("--url") ?? process.env.CVG_CONTAINER_SMOKE_URL?.trim();
    const rawHttpUrl = option("--http-url") ?? process.env.CVG_CONTAINER_SMOKE_HTTP_URL?.trim();
    const expectedSha = option("--release-sha") ?? process.env.CVG_RELEASE_SHA?.trim();
    const expectedArtifact = option("--artifact-digest") ?? process.env.CVG_RELEASE_ARTIFACT_DIGEST?.trim();
    if (!rawUrl) block("provide --url or CVG_CONTAINER_SMOKE_URL explicitly");
    if (!expectedSha || !sha40.test(expectedSha)) block("provide an exact 40-character --release-sha");
    if (!expectedArtifact || !artifactDigest.test(expectedArtifact)) block("provide an immutable --artifact-digest");
    const base = new URL(rawUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) block("container smoke requires a credential-free HTTPS origin without query or fragment");
    if (rawHttpUrl) await verifyHttpRedirect(cleartextSmokeUrl(rawHttpUrl, "HTTP redirect URL"), base);
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    const health = await response(new URL(`${base.origin}${prefix}healthz`));
    const ready = await response(new URL(`${base.origin}${prefix}api/v1/ready`));
    const readyBody = jsonRecord(await ready.clone().json().catch(() => ({})));
    if (jsonRecord(readyBody.data).ready !== true) block("readiness did not report ready=true");
    const headers = ready.headers;
    assertReleaseHeaders(headers, expectedSha, expectedArtifact, "readiness");
    const setCookie = typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=[^;]+=[^;]+)/).filter(Boolean);
    const authenticatedRequested = Boolean(process.env.CVG_CONTAINER_SMOKE_LOGIN?.trim() || process.env.CVG_CONTAINER_SMOKE_PASSWORD?.trim());
    const cookieFailures = cookieFlagsValid(authenticatedRequested ? [...setCookie, "__cvg_require_session__"] : setCookie);
    if (cookieFailures.length) block(cookieFailures.join("; "));
    if (!authenticatedRequested) {
      process.stdout.write(`CONTAINER_EDGE_SMOKE_VERIFIED sha=${expectedSha} artifact=${expectedArtifact} health=200 ready=200 headers=verified${rawHttpUrl ? " httpRedirect=308" : ""}\n`);
      process.stderr.write("CONTAINER_SMOKE_INCOMPLETE login, database write, patient lookup, worker/outbox, provider, DeepSeek, shutdown and restart require an approved scenario and remain BLOCKED_EXTERNAL\n");
      process.exitCode = 2;
      return;
    }
    await runAuthenticatedScenario(base, expectedSha, expectedArtifact);
    process.stdout.write(`CONTAINER_FULL_SMOKE_VERIFIED sha=${expectedSha} artifact=${expectedArtifact} health=200 ready=200 login=200 patientLookup=200 databaseWrite=201 workerHeartbeat=observed provider=receipt+effect+audit+outbox shutdown=durable restart=headers+health+ready+replay-revalidated deepseek=READY\n`);
  } catch (error) {
    process.stderr.write(`CONTAINER_SMOKE_BLOCKED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
const entrypoint = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false;
if (entrypoint) await main();
