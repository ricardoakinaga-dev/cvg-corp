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
