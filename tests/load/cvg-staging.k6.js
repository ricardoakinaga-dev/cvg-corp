/*
 * Production-like load contract for the CVG staging gate.
 *
 * This file is intentionally executable only by an explicitly configured k6
 * run. It never supplies a default endpoint, credential or capacity target.
 * Missing configuration must remain a blocked external gate.
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { doubleDuration } from "./duration.js";

const baseUrl = (__ENV.CVG_LOAD_BASE_URL ?? "").replace(/\/$/, "");
const bearer = __ENV.CVG_LOAD_BEARER_TOKEN ?? "";
const p95 = Number(__ENV.CVG_LOAD_P95_MS ?? "");
const duration = __ENV.CVG_LOAD_DURATION ?? "30s";
const clinicalReadPath = __ENV.CVG_LOAD_CLINICAL_READ_PATH ?? "";
const clinicalWritePath = __ENV.CVG_LOAD_CLINICAL_WRITE_PATH ?? "";
const aiPath = __ENV.CVG_LOAD_AI_PATH ?? "";
const providerSendPath = __ENV.CVG_LOAD_PROVIDER_SEND_PATH ?? "";
const receiptPath = __ENV.CVG_LOAD_RECEIPT_PATH ?? "";
const workerMetricsPath = __ENV.CVG_LOAD_WORKER_METRICS_PATH ?? "";

if (!baseUrl || !/^https:\/\//i.test(baseUrl)) throw new Error("CVG_LOAD_BASE_URL must be an explicit HTTPS staging URL");
if (!bearer) throw new Error("CVG_LOAD_BEARER_TOKEN must be supplied by the staging secret authority");
if (!Number.isFinite(p95) || p95 <= 0) throw new Error("CVG_LOAD_P95_MS must be an observed, approved threshold");
for (const [name, value] of [["CVG_LOAD_CLINICAL_READ_PATH", clinicalReadPath], ["CVG_LOAD_CLINICAL_WRITE_PATH", clinicalWritePath], ["CVG_LOAD_AI_PATH", aiPath], ["CVG_LOAD_PROVIDER_SEND_PATH", providerSendPath], ["CVG_LOAD_RECEIPT_PATH", receiptPath], ["CVG_LOAD_WORKER_METRICS_PATH", workerMetricsPath]]) {
  if (!value) throw new Error(`${name} must be supplied for the complete production-like workload`);
}

function jsonBody(name) {
  const raw = __ENV[name] ?? "";
  if (!raw) throw new Error(`${name} must be supplied as a JSON object`);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object");
    return JSON.stringify(parsed);
  } catch (error) {
    throw new Error(`${name} is invalid JSON: ${error.message}`);
  }
}

const clinicalWriteBody = jsonBody("CVG_LOAD_CLINICAL_WRITE_BODY");
const aiBody = jsonBody("CVG_LOAD_AI_BODY");
const providerSendBody = jsonBody("CVG_LOAD_PROVIDER_SEND_BODY");

export const options = {
  scenarios: {
    users_50: { executor: "constant-vus", vus: 50, duration },
    users_100: { executor: "constant-vus", vus: 100, duration, startTime: duration },
    burst: { executor: "ramping-arrival-rate", startRate: 0, timeUnit: "1s", preAllocatedVUs: 20, maxVUs: 150, stages: [{ target: 100, duration: "10s" }, { target: 0, duration: "10s" }], startTime: doubleDuration(duration) }
  },
  thresholds: {
    http_req_duration: [`p(95)<${p95}`],
    http_req_failed: ["rate<0.01"]
  }
};

const headers = { Authorization: `Bearer ${bearer}`, Accept: "application/json", "x-cvg-load-run": __ENV.CVG_LOAD_RUN_ID ?? "explicit-staging-run" };

function request(method, path, name, body = null, idempotencyKey = null) {
  const requestHeaders = { ...headers, ...(body ? { "Content-Type": "application/json" } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) };
  const response = http.request(method, `${baseUrl}${path}`, body, { headers: requestHeaders, tags: { operation: name } });
  let envelope = null;
  try { envelope = JSON.parse(response.body); } catch { /* semantic check below fails closed */ }
  const hasData = Boolean(envelope && Object.prototype.hasOwnProperty.call(envelope, "data"));
  const hasError = Boolean(envelope && Object.prototype.hasOwnProperty.call(envelope, "error"));
  const semanticEnvelope = Boolean(envelope && envelope.schemaVersion === 1 && typeof envelope.correlationId === "string" && ((hasData && !hasError) || (!hasData && hasError)));
  const successfulEnvelope = response.status >= 200 && response.status < 300 && semanticEnvelope && hasData;
  check(response, {
    [`${name} status is 2xx`]: () => response.status >= 200 && response.status < 300,
    [`${name} has a valid CVG envelope`]: () => semanticEnvelope,
    [`${name} is semantically successful`]: () => successfulEnvelope
  });
  return response;
}

export default function () {
  group("patient-and-appointment-read", () => {
    request("GET", __ENV.CVG_LOAD_PATIENT_PATH ?? "/api/v1/patients", "patient_lookup");
    request("GET", __ENV.CVG_LOAD_APPOINTMENT_PATH ?? "/api/v1/appointments", "appointment_listing");
  });

  group("clinical", () => {
    request("GET", clinicalReadPath, "clinical_read");
    request("POST", clinicalWritePath, "clinical_write", clinicalWriteBody, `clinical-${__ENV.CVG_LOAD_RUN_ID ?? "run"}-${__VU}-${__ITER}`);
  });

  group("ai-turn", () => request(__ENV.CVG_LOAD_AI_METHOD ?? "POST", aiPath, "deepseek_turn", aiBody, `ai-${__ENV.CVG_LOAD_RUN_ID ?? "run"}-${__VU}-${__ITER}`));
  group("provider-and-receipt", () => {
    request(__ENV.CVG_LOAD_PROVIDER_METHOD ?? "POST", providerSendPath, "provider_send", providerSendBody, `provider-${__ENV.CVG_LOAD_RUN_ID ?? "run"}-${__VU}-${__ITER}`);
    request("GET", receiptPath, "provider_receipt");
  });
  group("worker-backlog", () => request("GET", workerMetricsPath, "worker_backlog"));
  sleep(1);
}
