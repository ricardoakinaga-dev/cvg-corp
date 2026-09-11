import test from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance, type FastifySchema } from "fastify";
import { API_ROUTE_CATALOG } from "@cvg/contracts";
import { createRuntime } from "@cvg/api";
import { CvgStore } from "@cvg/domain";
import { installRuntimeRouteCatalog, runtimeRouteCatalog, RouteCatalogError } from "../../apps/api/src/route-catalog.js";

const patients = API_ROUTE_CATALOG.find((route) => route.method === "GET" && route.path === "/patients")!;
const catalog = runtimeRouteCatalog([patients], false);
const path = "/api/v1/patients";

async function assertCannotServe(app: FastifyInstance, url = path): Promise<void> {
  try {
    const response = await app.inject({ method: "GET", url });
    assert.ok(response.statusCode >= 400, `poisoned router served ${response.statusCode}`);
  } catch (error) {
    assert.ok(error instanceof RouteCatalogError, String(error));
  }
}

test("runtime inventory is unavailable until readiness and captures the actual GET and derived HEAD", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const guard = installRuntimeRouteCatalog(app, catalog);
  assert.throws(() => guard.snapshot(), RouteCatalogError);
  app.get(path, async () => ({ patient: "synthetic" }));
  await app.ready();
  const inventory = guard.snapshot();
  assert.equal(inventory.status, "VERIFIED");
  assert.equal(inventory.scope, "REGISTRATION_ONLY");
  assert.match(inventory.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(inventory.routes, catalog);
  assert.ok(Object.isFrozen(inventory));
  assert.ok(Object.isFrozen(inventory.routes));
  assert.ok(inventory.routes.every(Object.isFrozen));
  assert.equal((await app.inject(path)).statusCode, 200);
  const head = await app.inject({ method: "HEAD", url: path });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  assert.throws(() => app.post("/api/v1/late", async () => "late"), /already started|already listening|Cannot add route/i);
});

for (const [method, url] of [["GET", "/api/v1/uncataloged"], ["GET", "/api/v2/patients"], ["GET", "/outside"], ["POST", path], ["OPTIONS", path], ["OPTIONS", "*"]] as const) {
  test(`registration rejects undocumented ${method} ${url} and a caught violation cannot serve handlers`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    installRuntimeRouteCatalog(app, catalog);
    let effects = 0;
    app.get(path, async () => { effects++; return "sensitive"; });
    assert.throws(() => app.route({ method, url, schema: { hide: true } as FastifySchema & { hide: boolean }, handler: async () => { effects++; return "leak"; } }), RouteCatalogError);
    await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
    await assertCannotServe(app);
    assert.equal(effects, 0);
  });
}

test("missing catalog routes prevent readiness", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  await assert.rejects(async () => { await app.ready(); }, /missing registration/);
});

test("suppressing an expected implicit HEAD prevents readiness and GET effects", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  let effects = 0;
  app.get(path, { exposeHeadRoute: false }, async () => { effects++; return "sensitive"; });
  await assert.rejects(async () => { await app.ready(); }, /missing registration HEAD/);
  await assertCannotServe(app);
  assert.equal(effects, 0);
});

test("explicit HEAD must use its GET handler", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  let effects = 0;
  app.get(path, { exposeHeadRoute: false }, async () => { effects++; return "sensitive"; });
  assert.throws(() => app.head(path, async () => { effects++; return "different"; }), /HEAD does not derive/);
  await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
  await assertCannotServe(app);
  assert.equal(effects, 0);
});

test("HEAD before its GET cannot claim derived status", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  assert.throws(() => app.head(path, async () => "head"), /HEAD does not derive/);
  await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
});

test("a rejected generated HEAD poisons the GET that Fastify already registered", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog.filter((route) => route.method === "GET"));
  let effects = 0;
  assert.throws(() => app.get(path, async () => { effects++; return "sensitive"; }), /unregistered HEAD/);
  assert.equal(app.hasRoute({ method: "GET", url: path }), true);
  await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
  await assertCannotServe(app);
  assert.equal(effects, 0);
});

test("GET and HEAD in a method array preserve one shared handler", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const guard = installRuntimeRouteCatalog(app, catalog);
  app.route({ method: ["HEAD", "GET"], url: path, handler: async () => "synthetic" });
  await app.ready();
  assert.deepEqual(guard.snapshot().routes, catalog);
});

test("method arrays reject every undocumented member", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  let effects = 0;
  assert.throws(() => app.route({ method: ["GET", "POST"], url: path, handler: async () => { effects++; return "sensitive"; } }), /unregistered POST/);
  await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
  await assertCannotServe(app);
  assert.equal(effects, 0);
});

test("plugin prefixes are checked as resolved URLs", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const guard = installRuntimeRouteCatalog(app, catalog);
  app.register(async (child) => { child.get("/patients", async () => "synthetic"); }, { prefix: "/api/v1" });
  await app.ready();
  assert.deepEqual(guard.snapshot().routes, catalog);
});

test("a plugin prefix cannot smuggle a v2 route", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  app.register(async (child) => { child.get("/patients", async () => "sensitive"); }, { prefix: "/api/v2" });
  await assert.rejects(async () => { await app.ready(); }, /unregistered GET \/api\/v2\/patients/);
});

test("prefix-root registrations cannot add an uncataloged trailing-slash alias", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  let effects = 0;
  app.register(async (child) => { child.get("/", async () => { effects++; return "sensitive"; }); }, { prefix: path });
  await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
  await assertCannotServe(app, `${path}/`);
  assert.equal(effects, 0);
});

test("host-constrained variants cannot reuse catalog membership", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  assert.throws(() => app.get(path, { constraints: { host: "private.example" } }, async () => "sensitive"), /constraints are not cataloged/);
  await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
});

test("duplicate canonical keys are rejected before installing the guard", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  assert.throws(() => installRuntimeRouteCatalog(app, [...catalog, catalog[0]!]), /duplicate contract/);
});

test("duplicate runtime registration poisons an already populated router", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  let effects = 0;
  const handler = async () => { effects++; return "sensitive"; };
  app.get(path, handler);
  assert.throws(() => app.get(path, handler), /duplicate registration/);
  await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
  await assertCannotServe(app);
  assert.equal(effects, 0);
});

for (const mutation of ["url", "method", "handler", "constraints"] as const) {
  test(`later onRoute ${mutation} mutation cannot bypass admission`, async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    installRuntimeRouteCatalog(app, catalog);
    let effects = 0;
    app.addHook("onRoute", (options) => {
      if (options.method !== "GET") return;
      if (mutation === "url") options.url = "/api/v1/changed";
      else if (mutation === "method") options.method = "POST";
      else if (mutation === "handler") options.handler = async () => { effects++; return "changed"; };
      else options.constraints = { host: "private.example" };
    });
    app.get(path, async () => { effects++; return "sensitive"; });
    await assert.rejects(async () => { await app.ready(); }, RouteCatalogError);
    await assertCannotServe(app, mutation === "url" ? "/api/v1/changed" : path);
    assert.equal(effects, 0);
  });
}

test("late plugin registrations before readiness are still admitted against the catalog", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  installRuntimeRouteCatalog(app, catalog);
  app.get(path, async () => "synthetic");
  app.register(async (child) => { child.post("/api/v1/late", async () => "sensitive"); });
  await assert.rejects(async () => { await app.ready(); }, /unregistered POST/);
});

test("createRuntime exposes the complete sealed inventory while HEAD and CORS preserve authorization", async (t) => {
  const runtime = await createRuntime({
    store: new CvgStore({ bootstrapPassword: "synthetic-route-catalog-password" }),
    config: { nodeEnv: "test", host: "127.0.0.1", storageMode: "memory", demoMode: true, webOrigin: "http://127.0.0.1:5173" }
  });
  t.after(() => runtime.app.close());
  const expected = [...runtimeRouteCatalog()].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
  assert.deepEqual(runtime.routeInventory.routes, expected);
  assert.equal(runtime.routeInventory.scope, "REGISTRATION_ONLY");
  assert.ok(Object.isFrozen(runtime.routeInventory));
  assert.ok(Object.isFrozen(runtime.routeInventory.routes));
  for (const route of expected) assert.ok(runtime.app.hasRoute({ method: route.method, url: route.path === "*" ? "/*" : route.path }));
  const beforePatients = JSON.stringify([...runtime.store.patients.values()]);
  const beforeReceipts = JSON.stringify([...runtime.store.commandReceipts.values()]);
  const get = await runtime.app.inject({ method: "GET", url: path });
  assert.equal(get.statusCode, 401);
  const head = await runtime.app.inject({ method: "HEAD", url: path });
  assert.equal(head.statusCode, 401);
  assert.equal(head.body, "");
  const preflight = await runtime.app.inject({ method: "OPTIONS", url: path, headers: { origin: "http://127.0.0.1:5173", "access-control-request-method": "GET" } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  assert.equal(preflight.body, "");
  assert.equal(JSON.stringify([...runtime.store.patients.values()]), beforePatients);
  assert.equal(JSON.stringify([...runtime.store.commandReceipts.values()]), beforeReceipts);
  assert.equal((await runtime.app.inject("/api/v2/patients")).statusCode, 404);
  assert.throws(() => runtime.app.get("/api/v1/late", async () => "sensitive"), /already started|already listening|Cannot add route/i);
});
