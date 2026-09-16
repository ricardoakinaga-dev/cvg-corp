import assert from "node:assert/strict";
import { createRuntime } from "../../repo/apps/api/src/app.ts";
import { CvgStore } from "../../repo/packages/domain/src/index.ts";
const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
const runtime = await createRuntime({ store, config: { storageMode: "memory", demoMode: true, webOrigin: "http://127.0.0.1:5173" } });
function makeClient() {
  let localCookies = "";
  let localCsrf = "";
  let localContext: { unit: { id: string }; workspace: { id: string } } | null = null;
  const saveLocalCookies = (value: unknown): void => {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    const pairs = values.map((item) => typeof item === "string" ? item.split(";")[0] : "").filter((item): item is string => Boolean(item));
    const map = new Map<string, string>();
    for (const item of localCookies.split("; ").filter(Boolean)) { const separator = item.indexOf("="); if (separator > 0) map.set(item.slice(0, separator), item.slice(separator + 1)); }
    for (const pair of pairs) { const separator = pair.indexOf("="); if (separator > 0) map.set(pair.slice(0, separator), pair.slice(separator + 1)); }
    localCookies = [...map.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    localCsrf = decodeURIComponent(map.get("cvg_csrf") ?? "");
  };
  const request = async (path: string, init: { method?: string; payload?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(init.payload ? { "content-type": "application/json" } : {}), cookie: localCookies, ...(localContext ? { "x-cvg-unit-id": localContext.unit.id, "x-cvg-workspace-id": localContext.workspace.id } : {}), ...(init.headers ?? {}) };
    if (init.method && init.method !== "GET" && localCsrf) headers["x-csrf-token"] = localCsrf;
    const injectRequest = runtime.app.inject.bind(runtime.app) as unknown as (options: { method: string; url: string; headers: Record<string, string>; payload?: string }) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
    const options: { method: string; url: string; headers: Record<string, string>; payload?: string } = { method: init.method ?? "GET", url: `/api/v1${path}`, headers };
    if (init.payload) options.payload = JSON.stringify(init.payload);
    const result = await injectRequest(options);
    saveLocalCookies(result.headers["set-cookie"]);
    return { statusCode: result.statusCode, body: JSON.parse(result.body) as { schemaVersion: number; data?: unknown; error?: { code: string; message: string }; correlationId: string } };
  };
  return { request, login: async (login: string, password: string) => { const result = await request("/auth/login", { method: "POST", payload: { login, password } }); assert.equal(result.statusCode, 200); const data = result.body.data as { contexts?: Array<{ unit: { id: string }; workspace: { id: string } }> } | undefined; localContext = data?.contexts?.[0] ?? null; } };
}

try {
 const vet=makeClient(), stock=makeClient();
 await vet.login("ana.vet@cvg.local","veterinario-synthetic-0002");
 await stock.login("leo.estoque@cvg.local","estoque-synthetic-0004");
 const patient=[...store.patients.values()][0], lot=[...store.lots.values()][0];
 let n=0;
 const post=(c,p,b,k=`critic-${++n}`)=>c.request(p,{method:"POST",payload:b,headers:{"idempotency-key":k}});
 const encounter=await post(vet,"/encounters",{patientId:patient.id,appointmentId:null,chiefComplaint:"critic terminal replay",urgency:"ROUTINE"});
 assert.equal(encounter.statusCode,201,JSON.stringify(encounter));
 const er=encounter.body.data.encounter.id;
 const order=await post(vet,"/medications/orders",{patientId:patient.id,encounterId:er,productId:lot.productId,dose:"1",route:"oral",frequency:"12h"});
 assert.equal(order.statusCode,201);
 const oid=order.body.data.order.id, path=`/medications/orders/${oid}`;
 const first=await post(stock,path+"/dispense",{lotId:lot.id,quantity:1},"critic-original");assert.equal(first.statusCode,201);
 await post(vet,path+"/status",{status:"COMPLETED"});
 const state=()=>JSON.stringify({lots:[...store.lots.values()],d:[...store.dispensations.values()],m:[...store.stockMovements.values()],o:store.medicationOrders.get(oid)});
 const before=state();
 const replay=await post(stock,path+"/dispense",{lotId:lot.id,quantity:1},"critic-original");
 assert.equal(replay.statusCode,201);assert.equal(replay.body.data.receiptId,first.body.data.receiptId);assert.equal(state(),before);
 for(const status of ["ACTIVE","SUSPENDED"]){assert.equal((await post(vet,path+"/status",{status})).statusCode,409);assert.equal(state(),before);}
 assert.equal((await post(stock,path+"/dispense",{lotId:lot.id,quantity:1})).statusCode,409);assert.equal(state(),before);
 assert.equal((await post(stock,path+"/dispense",{lotId:lot.id,quantity:2},"critic-original")).statusCode,409);assert.equal(state(),before);
 for(const movementType of ["DISPENSE","ADJUSTMENT_OUT","TRANSFER_OUT"]){assert.equal((await post(stock,"/stock/movements",{productId:lot.productId,lotId:lot.id,locationId:lot.locationId,quantity:1,movementType,reason:"critic indirect terminal",referenceId:oid})).statusCode,409);assert.equal(state(),before);}
 console.log(JSON.stringify({verdict:"PASS",checks:["completed order replay returns original receipt without mutation","completed to ACTIVE and SUSPENDED denied","new-key terminal dispense denied","changed-body replay conflicts","all three referenced subtractive movement types denied with unchanged domain state"],dispensations:store.dispensations.size,movements:store.stockMovements.size}));
} finally {await runtime.app.close();}
