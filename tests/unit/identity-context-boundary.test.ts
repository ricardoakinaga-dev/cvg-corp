import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CvgStore } from "@cvg/domain";
import { createReadApplicationService } from "../../apps/api/src/application/read-services.ts";
import { inspectRouteIdentityContextReads } from "../../scripts/identity-context-boundary.ts";

test("route guard rejects direct identity/context reads and leaves auth bootstrap lookups explicit", () => {
  const findings = inspectRouteIdentityContextReads("fixture.ts", `
    const localStore = store;
    localStore.getUser(userId);
    store.resolveContext(userId, selector, "context.select", correlationId, null, null, sessionId);
    store.contextOptions(userId);
    store["listUsers"](context, "");
    store.getUserByLogin(login);
    store.findAuthChallenge("MFA", digest);
  `);
  assert.deepEqual(findings.map(({ method }) => method), ["getUser", "resolveContext", "contextOptions", "listUsers"]);
});

test("read application service keeps identity/context reads behind policy and the bounded pre-context seam", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const readApplication = createReadApplicationService(store, null);
  const user = readApplication.getUserForAuthentication(store.bootstrapCredentials.userId);
  const option = readApplication.listContextOptionsForAuthentication(user.id)[0];
  assert.ok(option);
  const session = store.createSession(user.id, "identity-context-token", "identity-context-csrf", 15);
  const context = readApplication.resolveContext(user.id, { unitId: option.unit.id, workspaceId: option.workspace.id }, "context.select", "identity-context-test", null, null, session.id);
  assert.equal(readApplication.getCurrentUser(context).id, user.id);
  assert.ok(readApplication.listContextOptions(context).some((candidate) => candidate.workspace.id === option.workspace.id));
  assert.ok(readApplication.listUsers(context).some((candidate) => candidate.id === user.id));
});

test("the production API composition contains no direct identity/context store reads", async () => {
  const source = await readFile("apps/api/src/app.ts", "utf8");
  assert.deepEqual(inspectRouteIdentityContextReads("apps/api/src/app.ts", source), []);
});
