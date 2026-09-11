import test from "node:test";
import assert from "node:assert/strict";
import { API_ROUTE_CATALOG } from "@cvg/contracts";
import { inspectHttpRouteInventory } from "../../scripts/pdp-route-inventory.ts";

const patient = API_ROUTE_CATALOG.find((route) => route.path === "/patients" && route.method === "GET")!;
const inspect = (source: string) => inspectHttpRouteInventory([{ path: "apps/api/src/routes/fixture.ts", source: `import type { FastifyInstance } from 'fastify'; function routes(app: FastifyInstance) { ${source} }` }], [patient]);

test("HTTP inventory accepts cataloged handler-local operation and receiver alias", () => {
  const result = inspect(`const router = app; router.get('/api/v1/patients', async (request) => { const context = requestContext(request, 'patients.read'); return application.list(context); });`);
  assert.deepEqual(result.findings, []);
  assert.equal(result.routes.length, 1);
});

test("HTTP inventory rejects new nested-module routes even outside API prefix", () => {
  const result = inspect(`app.get('/private-export', async () => repository.exportAll());`);
  assert.ok(result.findings.some((finding) => finding.code === "UNREGISTERED_ROUTE"));
});

test("HTTP inventory ties operation to its handler instead of a global text set", () => {
  for (const body of [
    `/* requestContext(request, 'patients.read') */ return repository.list();`,
    `const unused = () => requestContext(request, 'patients.read'); return repository.list();`,
    `requestContext(request, 'stock.read'); return repository.list();`
  ]) {
    const result = inspect(`app.get('/api/v1/patients', async (request) => { ${body} });`);
    assert.ok(result.findings.some((finding) => finding.code === "ROUTE_OPERATION_MISMATCH"), body);
  }
});

test("HTTP inventory rejects dynamic URL, named handler, duplicate and missing registration", () => {
  assert.ok(inspect(`app.get(url, handler);`).findings.some((finding) => finding.code === "DYNAMIC_REGISTRATION"));
  assert.ok(inspect(`app.get('/api/v1/patients', handler);`).findings.some((finding) => finding.code === "UNRESOLVED_HANDLER"));
  assert.ok(inspect("").findings.some((finding) => finding.code === "MISSING_ROUTE"));
  const route = `app.get('/api/v1/patients', async (request) => requestContext(request, 'patients.read'));`;
  assert.ok(inspect(route + route).findings.some((finding) => finding.code === "DUPLICATE_ROUTE"));
});

test("HTTP inventory covers route objects, method arrays and bracket registration", () => {
  for (const source of [
    `app.route({method: ['GET'], url: '/api/v1/patients', handler: async (request) => requestContext(request, 'patients.read')});`,
    `app['get']('/api/v1/patients', async (request) => requestContext(request, 'patients.read'));`
  ]) assert.deepEqual(inspect(source).findings, []);
  assert.ok(inspect(`app.route({ ...options, method: 'GET', url: '/api/v1/patients', handler });`).findings.some((finding) => finding.code === "DYNAMIC_REGISTRATION"));
});

test("HTTP inventory includes inline plugins and rejects extracted route methods", () => {
  assert.ok(inspect(`app.register(async (plugin) => { plugin.get('/private', async () => repository.list()); });`).findings.some((finding) => finding.code === "UNREGISTERED_ROUTE"));
  for (const source of [`const { get } = app; get('/private', handler);`, `const get = app.get; get('/private', handler);`]) {
    assert.ok(inspect(source).findings.some((finding) => finding.code === "DYNAMIC_REGISTRATION"));
  }
});

test("HTTP inventory rejects chained unknown routes, bound methods and plugin prefixes", () => {
  assert.ok(inspect(`app['register'](async (plugin) => { plugin.get('/private', async () => repository.list()); });`).findings.some((finding) => finding.code === "UNREGISTERED_ROUTE"));
  assert.ok(inspect(`app.get('/api/v1/patients', async (request) => requestContext(request, 'patients.read')).get('/private', async () => repository.list());`).findings.some((finding) => finding.code === "UNREGISTERED_ROUTE"));
  assert.ok(inspect(`const get = app['get'].bind(app); get('/private', handler);`).findings.some((finding) => finding.code === "DYNAMIC_REGISTRATION"));
  assert.ok(inspect(`app.register(async (plugin) => { plugin.get('/api/v1/patients', async (request) => requestContext(request, 'patients.read')); }, { prefix: '/hidden' });`).findings.some((finding) => finding.code === "DYNAMIC_REGISTRATION"));
});

test("HTTP inventory rejects computed option overrides and inventories chained plugins", () => {
  assert.ok(inspect(`app.route({method:'GET', url:'/api/v1/patients', ['url']:'/private', handler: async (request) => requestContext(request, 'patients.read')});`).findings.some((finding) => finding.code === "DYNAMIC_REGISTRATION"));
  assert.ok(inspect(`app.register(async (plugin) => {}, { ['prefix']: '/hidden' });`).findings.some((finding) => finding.code === "DYNAMIC_REGISTRATION"));
  assert.ok(inspect(`app.get('/api/v1/patients', async (request) => requestContext(request, 'patients.read')).register(async (plugin) => { plugin.get('/private', async () => repository.list()); });`).findings.some((finding) => finding.code === "UNREGISTERED_ROUTE"));
});
