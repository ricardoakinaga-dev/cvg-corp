import test from "node:test";
import assert from "node:assert/strict";
import {
  canRenderContextData,
  initialRuntimeState,
  isWriteAllowed,
  RUNTIME_STATES,
  runtimeStatePresentation,
  runtimeStateReducer,
  type RuntimeSnapshot
} from "../../apps/web/src/state/runtime-state.ts";

const online: RuntimeSnapshot = { state: RUNTIME_STATES.ONLINE, reconnectVersion: 3 };

test("initial runtime snapshot follows the reported connectivity and never allows writes elsewhere", () => {
  const initial = initialRuntimeState();
  // Node exposes a global navigator without onLine, so the initial state is
  // driven by the reported connectivity: online only when onLine is not false
  // and the browser check passes.
  const expected = typeof navigator === "undefined" || navigator.onLine ? RUNTIME_STATES.ONLINE : RUNTIME_STATES.OFFLINE_READ_ONLY;
  assert.equal(initial.state, expected);
  assert.equal(initial.reconnectVersion, 0);
  for (const state of Object.values(RUNTIME_STATES)) {
    if (state === RUNTIME_STATES.ONLINE) {
      assert.equal(isWriteAllowed(state), true);
      assert.equal(canRenderContextData(state), true);
    } else {
      assert.equal(isWriteAllowed(state), false);
      assert.equal(canRenderContextData(state), false);
    }
  }
});

test("runtime reducer guards each revalidation, degradation and permission transition", () => {
  // REQUEST_REVALIDATION only leaves states that can be revalidated
  const revalidating = runtimeStateReducer(online, { type: "REQUEST_REVALIDATION", reason: "autoridade mudou" });
  assert.equal(revalidating.state, RUNTIME_STATES.REVALIDATING);
  assert.equal(revalidating.reconnectVersion, online.reconnectVersion + 1);
  const offline: RuntimeSnapshot = { state: RUNTIME_STATES.OFFLINE_READ_ONLY, reconnectVersion: 1 };
  assert.equal(runtimeStateReducer(offline, { type: "REQUEST_REVALIDATION", reason: "ignored" }), offline);
  assert.equal(runtimeStateReducer(revalidating, { type: "REQUEST_REVALIDATION", reason: "ignored" }), revalidating);

  // degraded/stale/permission transitions carry the reason and stay idempotent
  const degraded = runtimeStateReducer(online, { type: "REQUEST_DEGRADED", reason: "leituras parciais" });
  assert.equal(degraded.state, RUNTIME_STATES.DEGRADED);
  assert.equal(degraded.reason, "leituras parciais");
  assert.equal(runtimeStateReducer(offline, { type: "REQUEST_DEGRADED", reason: "ignored" }), offline);
  const stale = runtimeStateReducer(online, { type: "REQUEST_STALE", reason: "autoridade nova" });
  assert.equal(stale.state, RUNTIME_STATES.STALE);
  assert.equal(runtimeStateReducer(stale, { type: "REQUEST_STALE", reason: "ignored" }), stale);
  const denied = runtimeStateReducer(online, { type: "REQUEST_PERMISSION_DENIED", reason: "sem alçada" });
  assert.equal(denied.state, RUNTIME_STATES.PERMISSION_DENIED);
  assert.equal(runtimeStateReducer(denied, { type: "REQUEST_PERMISSION_DENIED", reason: "ignored" }), denied);

  // NETWORK_ONLINE only revalidates from the recoverable states and bumps the version
  const recovered = runtimeStateReducer(denied, { type: "NETWORK_ONLINE" });
  assert.equal(recovered.state, RUNTIME_STATES.REVALIDATING);
  assert.equal(recovered.reconnectVersion, denied.reconnectVersion + 1);
  assert.equal(runtimeStateReducer(online, { type: "NETWORK_ONLINE" }), online);

  // session lifecycle
  assert.equal(runtimeStateReducer(recovered, { type: "SESSION_VALIDATED" }).state, RUNTIME_STATES.ONLINE);
  assert.equal(runtimeStateReducer(online, { type: "RECONNECT_STARTED" }).state, RUNTIME_STATES.REVALIDATING);
  const reauth = runtimeStateReducer(online, { type: "AUTH_REQUIRED" });
  assert.equal(reauth.state, RUNTIME_STATES.REAUTH_REQUIRED);
  assert.equal(reauth.reason, undefined);
  assert.equal(reauth.reconnectVersion, online.reconnectVersion);
  assert.equal(runtimeStateReducer(reauth, { type: "SIGNED_IN" }).state, RUNTIME_STATES.ONLINE);
  assert.equal(runtimeStateReducer(reauth, { type: "SIGNED_OUT" }).state, RUNTIME_STATES.ONLINE);
  assert.equal(runtimeStateReducer(offline, { type: "SIGNED_OUT" }), offline);
});

test("every runtime state presents an explicit label, message and tone", () => {
  for (const state of Object.values(RUNTIME_STATES)) {
    const presentation = runtimeStatePresentation(state);
    assert.ok(presentation.label.length > 0);
    assert.ok(presentation.message.length > 0);
    assert.ok(["teal", "amber", "coral"].includes(presentation.tone));
  }
  assert.equal(runtimeStatePresentation(RUNTIME_STATES.OFFLINE_READ_ONLY).tone, "coral");
  assert.equal(runtimeStatePresentation(RUNTIME_STATES.REVALIDATING).tone, "amber");
});
