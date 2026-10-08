/**
 * Explicit PostgreSQL success verifier for routes that require durable storage.
 * Run with: node --import tsx tests/integration/api-response-postgres.verify.ts
 * Prerequisites: Docker running and postgres:16-alpine already available.
 * The verifier creates one uniquely named loopback-only, tmpfs container,
 * migrates its disposable database, and removes that exact container on exit.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { API_PAYLOAD_RESPONSE_SCHEMAS } from "../../apps/api/src/response-schemas/index.ts";
import { createRuntime } from "@cvg/api";
import { API_RESPONSE_SCHEMA_CATALOG, API_ROUTE_CATALOG, apiSuccessEnvelopeSchema } from "@cvg/contracts";
import { CvgStore } from "@cvg/domain";
import type { SecretProvider } from "@cvg/integrations";

const execFileAsync = promisify(execFile);
const image = "postgres:16-alpine";
const suffix = randomBytes(8).toString("hex");
const containerName = `cvg-api-response-${suffix}`;
const databaseName = `cvg_response_${suffix}`;
const ownerName = `cvg_response_owner_${suffix}`;
const ownerPassword = randomBytes(24).toString("base64url");
const runtimePassword = randomBytes(24).toString("base64url");
const bootstrapPassword = `Synthetic-response-${randomBytes(18).toString("base64url")}`;
const ownershipToken = randomBytes(24).toString("hex");
const inboxKey = randomBytes(32).toString("hex");
const recoveryKey = randomBytes(32).toString("hex");
const inboxKeyRef = "synthetic-response-inbox-key";
const recoveryKeyRef = "synthetic-response-recovery-key";
let containerStarted = false;
let containerId: string | null = null;
let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null;

type CommandResult = { stdout: string; stderr: string };

async function command(name: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  try {
    const result = await execFileAsync(name, args, { cwd: process.cwd(), env, maxBuffer: 4 * 1024 * 1024 });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const detail = `${failure.stderr ?? ""}\n${failure.stdout ?? ""}`.replace(/\s+/g, " ").trim();
    throw new Error(`${name} ${args.join(" ")} failed${failure.code ? ` (${String(failure.code)})` : ""}: ${detail || failure.message}`);
  }
}

async function docker(args: string[]): Promise<CommandResult> {
  return command("docker", args);
}

async function containerInventory(): Promise<string[]> {
  const result = await docker(["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}"]);
  return [...new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))].sort();
}

function connectionString(user: string, password: string, port: number): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${databaseName}`;
}

async function startDatabase(): Promise<{ port: number; ownerUrl: string; runtimeUrl: string }> {
  await docker(["info", "--format", "{{.ServerVersion}}"]);
  await docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  const started = await docker([
    "run", "--detach", "--name", containerName,
    "--label", "cvg.audit=API-RESPONSE-POSTGRES",
    "--label", `cvg.audit.run=${ownershipToken}`,
    "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,nodev",
    "--env", `POSTGRES_DB=${databaseName}`,
    "--env", `POSTGRES_USER=${ownerName}`,
    "--env", `POSTGRES_PASSWORD=${ownerPassword}`,
    "--publish", "127.0.0.1::5432",
    image
  ]);
  containerStarted = true;
  const startedContainerId = started.stdout.trim();
  containerId = startedContainerId;
  assert.match(startedContainerId, /^[0-9a-f]{64}$/i, "Docker did not return an exact container id");
  const portText = await docker(["port", containerName, "5432/tcp"]);
  const match = /:(\d+)\s*$/.exec(portText.stdout.trim().split(/\r?\n/)[0] ?? "");
  assert.ok(match, `could not parse published PostgreSQL port: ${portText.stdout}`);
  const port = Number(match[1]);
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const result = await docker(["exec", containerName, "pg_isready", "--username", ownerName, "--dbname", databaseName]);
      if (/accepting connections/i.test(result.stdout)) { ready = true; break; }
    } catch { /* PostgreSQL is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(ready, true, "PostgreSQL did not become ready within 30 seconds");

  const ownerUrl = connectionString(ownerName, ownerPassword, port);
  const runtimeUrl = connectionString("cvg_runtime", runtimePassword, port);
  await command("npm", ["run", "db:migrate"], {
    ...process.env,
    DATABASE_URL: ownerUrl,
    MIGRATION_DATABASE_URL: ownerUrl,
    CVG_RUNTIME_DB_USER: "cvg_runtime",
    CVG_RUNTIME_DB_PASSWORD: runtimePassword,
    CVG_BOOTSTRAP_PASSWORD: bootstrapPassword
  });
  return { port, ownerUrl, runtimeUrl };
}

async function cleanup(): Promise<void> {
  await runtime?.app.close().catch(() => undefined);
  runtime = null;
  if (!containerStarted) return;
  assert.ok(containerId, "the verifier must retain the exact disposable container id");
  const inspected = await docker(["inspect", "--format", '{{.Id}}\t{{index .Config.Labels "cvg.audit.run"}}', containerId]);
  const [observedId, observedToken, ...extra] = inspected.stdout.trim().split("\t");
  assert.equal(observedId, containerId, "the inspected disposable container id changed");
  assert.equal(observedToken, ownershipToken, "the inspected container is not owned by this verifier run");
  assert.equal(extra.length, 0, "the container ownership inspection returned unexpected fields");
  await docker(["rm", "--force", containerId]);
  const remains = await command("docker", ["inspect", "--format", "{{.Id}}", containerId]).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && /no such (?:object|container)/i.test(error.message)) return false;
      throw error;
    }
  );
  assert.equal(remains, false, `disposable container ${containerId} remained after cleanup`);
  containerStarted = false;
  containerId = null;
}

function responseData(result: { statusCode: number; body: string }, method: string, path: string, expectedStatus: number, responseSchema: string): Record<string, unknown> {
  assert.equal(result.statusCode, expectedStatus, `${method} ${path}: ${result.body}`);
  const envelope = JSON.parse(result.body) as unknown;
  const parsedEnvelope = apiSuccessEnvelopeSchema.safeParse(envelope);
  assert.equal(parsedEnvelope.success, true, `${method} ${path} must return a versioned success envelope`);
  if (!parsedEnvelope.success) throw new Error("unreachable envelope parse failure");
  assert.equal(parsedEnvelope.data.schemaVersion, 1);
  const descriptor = API_RESPONSE_SCHEMA_CATALOG.find((candidate) => candidate.name === responseSchema);
  assert.ok(descriptor, `missing response schema descriptor ${responseSchema}`);
  const payloadSchema = API_PAYLOAD_RESPONSE_SCHEMAS.get(responseSchema);
  assert.ok(payloadSchema, `missing executable payload schema ${responseSchema}`);
  const parsedPayload = payloadSchema.safeParse(parsedEnvelope.data.data);
  assert.equal(parsedPayload.success, true, `${method} ${path} payload failed ${responseSchema}: ${JSON.stringify(parsedPayload.success ? null : parsedPayload.error.issues)}`);
  if (!parsedPayload.success) throw new Error("unreachable payload parse failure");
  return parsedPayload.data as Record<string, unknown>;
}

async function login(): Promise<{ cookie: string; csrf: string; unitId: string; workspaceId: string }> {
  assert.ok(runtime);
  const result = await runtime.app.inject({
    method: "POST", url: "/api/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ login: "admin@cvg.local", password: bootstrapPassword })
  });
  assert.equal(result.statusCode, 200, `synthetic admin login failed: ${result.body}`);
  const body = result.json<{ data: { csrfToken: string; contexts: Array<{ unit: { id: string }; workspace: { id: string } }> } }>();
  const cookies = result.headers["set-cookie"];
  const cookieHeader = (Array.isArray(cookies) ? cookies : cookies ? [cookies] : []).map((value) => value.split(";", 1)[0]).join("; ");
  const context = body.data.contexts[0];
  assert.ok(context, "synthetic admin login must have an authorized unit/workspace");
  return { cookie: cookieHeader, csrf: body.data.csrfToken, unitId: context.unit.id, workspaceId: context.workspace.id };
}

async function main(): Promise<void> {
  const inventoryBefore = await containerInventory();
  try {
    const database = await startDatabase();
    const secretProvider: SecretProvider = {
      status: () => "READY",
      has: (reference) => reference === inboxKeyRef || reference === recoveryKeyRef,
      resolve: async (reference) => reference === inboxKeyRef ? inboxKey : reference === recoveryKeyRef ? recoveryKey : null
    };
    runtime = await createRuntime({
      store: new CvgStore({ bootstrapPassword }),
      secretProvider,
      config: {
        nodeEnv: "test",
        storageMode: "postgres",
        demoMode: true,
        webOrigin: "http://127.0.0.1:5173",
        databaseUrl: database.runtimeUrl,
        bootstrapPassword,
        recoveryEncryptionKeyRef: recoveryKeyRef,
        integrationCallbackKeyRefs: [`synthetic-provider=${inboxKeyRef}`]
      }
    });

    const integrationRoute = API_ROUTE_CATALOG.find((route) => route.method === "POST" && route.path === "/integrations/:provider/events");
    assert.ok(integrationRoute, "catalog must include integration inbox route");
    assert.equal(integrationRoute.responseSchema, "InboxReceipt");
    const inboxBody = JSON.stringify({
      organizationId: runtime.store.bootstrapCredentials.organizationId,
      consumer: "synthetic-response-verifier",
      provider: "synthetic-provider",
      externalEventId: `api-response-${randomUUID()}`,
      eventType: "synthetic.response.coverage",
      schemaVersion: 1,
      payload: { synthetic: true, verifier: "api-response-postgres" }
    });
    const inboxSignature = createHmac("sha256", inboxKey).update(inboxBody, "utf8").digest("hex");
    const inboxResponse = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/integrations/synthetic-provider/events",
      headers: {
        "content-type": "application/json",
        "x-cvg-signature-key-ref": inboxKeyRef,
        "x-cvg-signature": inboxSignature
      },
      payload: inboxBody
    });
    const inboxData = responseData(inboxResponse, integrationRoute.method, integrationRoute.path, 202, integrationRoute.responseSchema);
    assert.equal(inboxData.accepted, true);
    assert.equal(inboxData.duplicate, false);
    assert.equal(inboxData.status, "PROCESSED");

    // SEC-AI-03 through HTTP and PostgreSQL: the same key, correctly signing
    // another provider's body, is refused before any inbox write.
    const foreignBody = inboxBody.replace('"provider":"synthetic-provider"', '"provider":"foreign-provider"');
    assert.notEqual(foreignBody, inboxBody, "foreign-provider fixture must change the signed provider");
    const foreignResponse = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/integrations/foreign-provider/events",
      headers: {
        "content-type": "application/json",
        "x-cvg-signature-key-ref": inboxKeyRef,
        "x-cvg-signature": createHmac("sha256", inboxKey).update(foreignBody, "utf8").digest("hex")
      },
      payload: foreignBody
    });
    assert.equal(foreignResponse.statusCode, 403, `unbound provider/key pair must be refused: ${foreignResponse.body}`);

    const exportRoute = API_ROUTE_CATALOG.find((route) => route.method === "POST" && route.path === "/ops/export");
    assert.ok(exportRoute, "catalog must include governed export route");
    assert.equal(exportRoute.responseSchema, "EncryptedRecoveryBundle");
    const auth = await login();
    const exportResponse = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/ops/export",
      headers: {
        cookie: auth.cookie,
        "x-csrf-token": auth.csrf,
        "x-cvg-unit-id": auth.unitId,
        "x-cvg-workspace-id": auth.workspaceId,
        "content-type": "application/json",
        "idempotency-key": `api-response-export-${suffix}`
      },
      payload: JSON.stringify({ purpose: "INCIDENT_RECOVERY", scopeType: "ORGANIZATION", ttlSeconds: 300 })
    });
    const exportData = responseData(exportResponse, exportRoute.method, exportRoute.path, 201, exportRoute.responseSchema);
    assert.equal(exportData.purpose, "INCIDENT_RECOVERY");
    assert.equal((exportData.envelope as { algorithm?: string }).algorithm, "AES-256-GCM");
    assert.equal((exportData.envelope as { keyRef?: string }).keyRef, recoveryKeyRef);

    // FQ-01: a product with no lot is listed from the normalized table under RLS.
    const productRoute = API_ROUTE_CATALOG.find((route) => route.method === "GET" && route.path === "/stock/products");
    assert.ok(productRoute, "catalog must include the stock product list route");
    const scopedHeaders = { cookie: auth.cookie, "x-cvg-unit-id": auth.unitId, "x-cvg-workspace-id": auth.workspaceId };
    const orphanSku = `NOLOT-${suffix}`.slice(0, 40);
    const created = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/stock/products",
      headers: { ...scopedHeaders, "x-csrf-token": auth.csrf, "content-type": "application/json", "idempotency-key": `api-response-product-${suffix}` },
      payload: JSON.stringify({ sku: orphanSku, name: "Produto sem lote", category: "Sintético", unit: "unidade", reorderPoint: 0 })
    });
    assert.equal(created.statusCode, 201, `product creation failed: ${created.body}`);
    const productList = responseData(await runtime.app.inject({ method: "GET", url: "/api/v1/stock/products", headers: scopedHeaders }), productRoute.method, productRoute.path, 200, productRoute.responseSchema);
    // The domain normalizes SKUs to upper case; match the created identity.
    const createdId = created.json<{ data: { product: { id: string } } }>().data.product.id;
    const orphan = (productList.items as Array<{ id: string; sku: string }>).find((product) => product.id === createdId);
    assert.ok(orphan, `a product without lots must be listed; listed=${JSON.stringify((productList.items as Array<{ sku: string }>).map((product) => product.sku))}`);
    assert.equal(orphan.sku, orphanSku.toUpperCase());
    // A refused lot settles its idempotency key durably: the corrected entry
    // needs a new intent, which is why the stock dialog rotates its key.
    const locations = await runtime.app.inject({ method: "GET", url: "/api/v1/stock/locations", headers: scopedHeaders });
    const locationId = (locations.json<{ data: { items: Array<{ id: string }> } }>().data.items[0] ?? { id: "" }).id;
    assert.ok(locationId, "synthetic unit must have a stock location");
    const lotHeaders = (key: string) => ({ ...scopedHeaders, "x-csrf-token": auth.csrf, "content-type": "application/json", "idempotency-key": key });
    const lotBody = (expiresOn: string) => JSON.stringify({ productId: orphan.id, lotNumber: `LOT-${suffix}`.slice(0, 40), expiresOn, quantity: 3, locationId });
    const refusedKey = `api-response-lot-${suffix}`;
    const refused = await runtime.app.inject({ method: "POST", url: "/api/v1/stock/lots", headers: lotHeaders(refusedKey), payload: lotBody("2000-01-01") });
    assert.equal(refused.statusCode, 400, `expired lot must be refused: ${refused.body}`);
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const reusedKey = await runtime.app.inject({ method: "POST", url: "/api/v1/stock/lots", headers: lotHeaders(refusedKey), payload: lotBody(future) });
    assert.equal(reusedKey.statusCode, 409, `a refused key must not admit a different body: ${reusedKey.body}`);
    const corrected = await runtime.app.inject({ method: "POST", url: "/api/v1/stock/lots", headers: lotHeaders(`${refusedKey}-retry`), payload: lotBody(future) });
    assert.equal(corrected.statusCode, 201, `a corrected entry with a new intent must succeed: ${corrected.body}`);

    process.stdout.write(`API_RESPONSE_POSTGRES_VERIFIED routes=4 schemas=3 inbox=202/PROCESSED foreign-key=403 signature=HMAC-SHA256 export=201/AES-256-GCM products=200 lot-refused-key=409 lot-new-intent=201 organization=${runtime.store.bootstrapCredentials.organizationId} container=${containerName}\n`);
  } finally {
    await cleanup();
    const inventoryAfter = await containerInventory();
    assert.deepEqual(inventoryAfter, inventoryBefore, "Docker container inventory changed outside this disposable verifier");
    process.stdout.write(`API_RESPONSE_POSTGRES_CLEANUP_VERIFIED container_removed=true inventory_unchanged=true database=${databaseName}\n`);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`API_RESPONSE_POSTGRES_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
