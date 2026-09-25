import test from "node:test";
import assert from "node:assert/strict";
import { collectDirectStoreMutations, collectUniversalPdpFindings } from "../../scripts/verify-pdp-universal.ts";

test("universal PDP gate is green for the local route, application and worker boundary", async () => {
  const findings = await collectUniversalPdpFindings();
  assert.deepEqual(findings, []);
});

test("AST store guard follows aliases, bracket access, destructuring and casts", () => {
  const source = `
    const localStore = this.store;
    const patients = localStore["patients"];
    patients.set("patient-1", {});
    const { appointments: entries } = store;
    entries.delete("appointment-1");
    const { patients: { set: nestedMutate } } = store;
    nestedMutate("patient-nested", {});
    const { set: mutate } = store.patients;
    mutate("patient-2", {});
    const direct = (store as CvgStore).patients;
    direct.clear();
    // store.patients.set("comment", {});
    const text = "store.patients.delete('string')";
  `;
  assert.deepEqual(collectDirectStoreMutations(source, "fixture.ts").map(({ collection, operation }) => ({ collection, operation })), [
    { collection: "patients", operation: "set" },
    { collection: "appointments", operation: "delete" },
    { collection: "patients", operation: "set" },
    { collection: "patients", operation: "set" },
    { collection: "patients", operation: "clear" }
  ]);
});

test("AST store guard ignores unrelated maps and comments", () => {
  const source = `
    const buckets = new Map();
    buckets.set("key", {});
    // this.store.aiTurns.clear();
    const text = "store.aiTurns.delete('string')";
  `;
  assert.deepEqual(collectDirectStoreMutations(source, "fixture.ts"), []);
});

test("AST store guard fails closed on dynamic collection access", () => {
  const source = `
    const key = "patients";
    store[key].set("patient-1", {});
    const runtimeKey = getCollectionName();
    this.runtime.store[runtimeKey].delete("patient-2");
  `;
  assert.deepEqual(collectDirectStoreMutations(source, "fixture.ts").map(({ collection, operation }) => ({ collection, operation })), [
    { collection: "<dynamic>", operation: "set" },
    { collection: "<dynamic>", operation: "delete" }
  ]);
});

test("AST store guard follows function argument and return aliases", () => {
  const source = `
    function mutate(collection: unknown) { collection.set("patient-1", {}); }
    mutate(store.patients);
    const getAppointments = () => store.appointments;
    const appointments = getAppointments();
    appointments.delete("appointment-1");
    function nested({ patients: { set: nestedWrite } }: typeof store) { nestedWrite("patient-nested", {}); }
    nested(store);
    const unrelated = new Map();
    mutate(unrelated);
  `;
  assert.deepEqual(collectDirectStoreMutations(source, "fixture.ts").map(({ collection, operation }) => ({ collection, operation })), [
    { collection: "patients", operation: "set" },
    { collection: "appointments", operation: "delete" },
    { collection: "patients", operation: "set" }
  ]);
});

test("CVG-AUD20-007: route inventory follows verified wrappers and rejects deferred or unguarded ones", async () => {
  const { inspectHttpRouteInventory } = await import("../../scripts/pdp-route-inventory.ts");
  const catalog = [{ version: "v1", method: "POST", path: "/ai/turns", operation: "ai.turn", auth: "SESSION", requestSchema: null, responseSchema: "x", idempotent: true, deprecation: null }] as never;
  const verified = inspectHttpRouteInventory([{ path: "fixture-verified.ts", source: `import fastify from "fastify";\n    import { AsyncLocalStorage } from "node:async_hooks";\n    const storeScope = new AsyncLocalStorage();\n    const app = fastify();
     const runWithRequestFork = async (request, handler) => { return storeScope.run(fork, handler); };
     app.post("/api/v1/ai/turns", async (request, reply) => runWithRequestFork(request, async () => {
       const { context } = requestContext(request, \`ai.turn.\${input.purpose}\`);
       return context;
     }));
  ` }], catalog);
  assert.deepEqual(verified.findings, []);

  const deferred = inspectHttpRouteInventory([{ path: "fixture-deferred.ts", source: `import fastify from "fastify";\n    const app = fastify();
    const runWithRequestFork = (request, handler) => { setTimeout(handler, 0); };
    app.post("/api/v1/ai/turns", async (request, reply) => runWithRequestFork(request, async () => {
      const { context } = requestContext(request, \`ai.turn.\${input.purpose}\`);
      return context;
    }));
  ` }], catalog);
  assert.ok(deferred.findings.some((finding) => finding.code === "ROUTE_OPERATION_MISMATCH"), JSON.stringify(deferred.findings));

  const unguarded = inspectHttpRouteInventory([{ path: "fixture-unguarded.ts", source: `import fastify from "fastify";\n    const app = fastify();
    const runWithRequestFork = async (request, handler) => storeScope.run(fork, handler);
    app.post("/api/v1/ai/turns", async (request, reply) => runWithRequestFork(request, async () => {
      return { ok: true };
    }));
  ` }], catalog);
  assert.ok(unguarded.findings.some((finding) => finding.code === "ROUTE_OPERATION_MISMATCH"), JSON.stringify(unguarded.findings));

  const microtask = inspectHttpRouteInventory([{ path: "fixture-microtask.ts", source: `import fastify from "fastify";\n    const app = fastify();
    const runWithRequestFork = (request, handler) => Promise.resolve().then(handler);
    app.post("/api/v1/ai/turns", async (request, reply) => runWithRequestFork(request, async () => {
      const { context } = requestContext(request, \`ai.turn.\${input.purpose}\`);
      return context;
    }));
  ` }], catalog);
  assert.ok(microtask.findings.some((finding) => finding.code === "ROUTE_OPERATION_MISMATCH"), JSON.stringify(microtask.findings));

  const unknownCallback = inspectHttpRouteInventory([{ path: "fixture-unknown-callback.ts", source: `import fastify from "fastify";\n    const app = fastify();
    const runWithRequestFork = (request, handler) => unknownInvoker(handler);
    app.post("/api/v1/ai/turns", async (request, reply) => runWithRequestFork(request, async () => {
      const { context } = requestContext(request, \`ai.turn.\${input.purpose}\`);
      return context;
    }));
  ` }], catalog);
  assert.ok(unknownCallback.findings.some((finding) => finding.code === "ROUTE_OPERATION_MISMATCH"), JSON.stringify(unknownCallback.findings));
});
