import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRuntime } from "@cvg/api";
import { passwordHasher, verifyTotpCode } from "@cvg/auth";
import { CvgStore, DomainError } from "@cvg/domain";
import { tokenDigest } from "../../apps/api/src/sensitive-identifiers.ts";

const password = "Synthetic-Mfa-Race-123!";
const secretRef = "synthetic.mfa.race";
// Public, synthetic TOTP fixture: base32 of the ASCII key below.
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const secretBytes = Buffer.from("12345678901234567890");

function totpCode(atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const hmac = createHmac("sha1", secretBytes).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-03T12:00:00.000Z") });
  const store = new CvgStore({ bootstrapPassword: password });
  const userId = store.bootstrapCredentials.userId;
  store.configureMfaFactor(userId, secretRef);
  const gates: Array<{ entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }> = [];
  const queuedGates: typeof gates = [];
  const requests: Promise<unknown>[] = [];
  const runtime = await createRuntime({
    store,
    config: {
      nodeEnv: "test", storageMode: "memory", demoMode: false, secretProvider: "none",
      agentRuntimeMode: "disabled", authMfaMode: "required",
      authChallengeTtlSeconds: 60, authMaxChallengeAttempts: 3,
      authMaxFailedAttempts: 3, authLockoutMinutes: 5
    },
    mfaSecretResolver: {
      resolve: async (reference) => {
        assert.equal(reference, secretRef);
        const gate = queuedGates.shift();
        if (gate) {
          gate.entered.resolve();
          await gate.release.promise;
        }
        return secret;
      }
    }
  });
  t.after(async () => {
    for (const gate of gates) gate.release.resolve();
    await Promise.allSettled(requests);
    await runtime.app.close();
  });
  const login = await runtime.app.inject({
    method: "POST", url: "/api/v1/auth/login",
    payload: { login: store.getUser(userId).login, password }
  });
  assert.equal(login.statusCode, 202);
  assert.equal(login.headers["set-cookie"], undefined);
  const data = login.json<{ data: { mfaRequired: boolean; challengeId: string } }>().data;
  assert.equal(data.mfaRequired, true);
  const challenge = store.findAuthChallenge("MFA", tokenDigest(data.challengeId));
  assert.ok(challenge);
  assert.equal(store.sessions.size, 0);

  const verify = (code = totpCode()) => {
    const request = runtime.app.inject({
      method: "POST", url: "/api/v1/auth/mfa/verify",
      payload: { challengeId: data.challengeId, code }
    }).then((response) => response);
    requests.push(request);
    return request;
  };
  const pauseVerification = async (code = totpCode()) => {
    const gate = { entered: deferred(), release: deferred() };
    gates.push(gate);
    queuedGates.push(gate);
    const result = verify(code);
    await Promise.race([
      gate.entered.promise,
      result.then(() => { assert.fail("verification returned before reaching the resolver barrier"); })
    ]);
    return { result, release: gate.release.resolve };
  };
  return { store, runtime, userId, challenge, verify, pauseVerification };
}

type VerificationResponse = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["verify"]>>;

async function lockAccount(f: Awaited<ReturnType<typeof fixture>>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await f.runtime.app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { login: f.store.getUser(f.userId).login, password: "Synthetic-Wrong-Password-123!" }
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers["set-cookie"], undefined);
  }
  const user = f.store.getUser(f.userId);
  assert.equal(user.status, "ACTIVE");
  assert.equal(f.store.isAccountLocked(user), true);
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "PENDING");
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.attempts, 0);
  return user.security;
}

function assertDenied(response: VerificationResponse, store: CvgStore, sessionCount = 0): void {
  assert.equal(response.statusCode, 401);
  assert.equal(response.json<{ error: { code: string } }>().error.code, "MFA_INVALID");
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(store.sessions.size, sessionCount);
}

test("MFA succeeds after asynchronous verification and rejects replay without issuing more cookies", async (t) => {
  const f = await fixture(t);
  const pending = await f.pauseVerification();
  pending.release();
  const response = await pending.result;
  assert.equal(response.statusCode, 200);
  const body = response.json<{ schemaVersion: number; data: { user: { id: string }; contexts: unknown[]; csrfToken: string }; correlationId: string }>();
  assert.equal(body.schemaVersion, 1);
  assert.ok(body.correlationId);
  assert.deepEqual(Object.keys(body.data).sort(), ["contexts", "csrfToken", "user"]);
  assert.equal(body.data.user.id, f.userId);
  assert.ok(Array.isArray(body.data.contexts));
  const cookie = response.cookies.find((item) => item.name === "cvg_session");
  assert.ok(cookie);
  assert.equal(response.cookies.find((item) => item.name === "cvg_csrf")?.value, body.data.csrfToken);
  const session = f.store.findSession(tokenDigest(cookie.value));
  assert.ok(session);
  assert.equal(session.credentialVersion, f.challenge.credentialVersion);
  assert.ok(session.mfaVerifiedAt);
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "CONSUMED");
  const me = await f.runtime.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: `cvg_session=${cookie.value}` } });
  assert.equal(me.statusCode, 200);
  assertDenied(await f.verify(), f.store, 1);
  assert.ok(f.store.findSession(tokenDigest(cookie.value)));
});

test("two MFA verifications already inside the resolver can create only one session", async (t) => {
  const f = await fixture(t);
  const first = await f.pauseVerification();
  const second = await f.pauseVerification();
  second.release();
  const winner = await second.result;
  assert.equal(winner.statusCode, 200);
  first.release();
  assertDenied(await first.result, f.store, 1);
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "CONSUMED");
  const cookie = winner.cookies.find((item) => item.name === "cvg_session");
  assert.ok(cookie);
  assert.ok(f.store.findSession(tokenDigest(cookie.value)));
});

test("password rotation while the MFA resolver awaits cannot stamp a stale challenge with the new credential version", async (t) => {
  const f = await fixture(t);
  const rotatedDigest = await passwordHasher.hash("Synthetic-Mfa-Rotated-456!");
  const pending = await f.pauseVerification();
  f.store.rotatePassword(f.userId, rotatedDigest, null);
  assert.equal(f.store.getUser(f.userId).security.credentialVersion, f.challenge.credentialVersion + 1);
  pending.release();
  assertDenied(await pending.result, f.store);
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "EXPIRED");
  assert.equal([...f.store.auditRecords.values()].some((record) => record.action === "auth.login" && record.result === "ALLOWED"), false);
});

test("a challenge expiring during MFA verification is rejected even with a valid TOTP at completion", async (t) => {
  const f = await fixture(t);
  const expiresAt = Date.parse(f.challenge.expiresAt);
  t.mock.timers.setTime(expiresAt - 1);
  const code = totpCode(expiresAt);
  const pending = await f.pauseVerification(code);
  t.mock.timers.setTime(expiresAt);
  assert.equal(verifyTotpCode(secret, code), true);
  pending.release();
  assertDenied(await pending.result, f.store);
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "EXPIRED");
});

test("disabling the authoritative user while the MFA resolver awaits prevents sessions and cookies", async (t) => {
  const f = await fixture(t);
  const pending = await f.pauseVerification();
  const snapshot = f.store.snapshot();
  const currentUser = snapshot.users.find((user) => user.id === f.userId);
  assert.ok(currentUser);
  currentUser.status = "DISABLED";
  f.store.hydrate(snapshot);
  assert.equal(f.store.getUser(f.userId).status, "DISABLED");
  pending.release();
  assertDenied(await pending.result, f.store);
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "EXPIRED");
});

test("failed HTTP verifications can lock a challenge while an earlier valid MFA request awaits", async (t) => {
  const f = await fixture(t);
  const pending = await f.pauseVerification();
  const invalidCode = ["000000", "000001", "000002", "000003"].find((code) => !verifyTotpCode(secret, code));
  assert.ok(invalidCode);
  for (let attempt = 1; attempt <= f.challenge.maxAttempts; attempt += 1) {
    const response = await f.verify(invalidCode);
    const locked = attempt === f.challenge.maxAttempts;
    assert.equal(response.statusCode, locked ? 429 : 401);
    assert.equal(response.json<{ error: { code: string } }>().error.code, locked ? "ACCOUNT_LOCKED" : "MFA_INVALID");
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal(f.store.sessions.size, 0);
  }
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "LOCKED");
  pending.release();
  assertDenied(await pending.result, f.store);
  assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "LOCKED");
});

for (const timing of ["before verification", "while the resolver awaits"] as const) {
  test(`an account locked ${timing} cannot complete MFA or clear its lockout`, async (t) => {
    const f = await fixture(t);
    const pending = timing === "while the resolver awaits" ? await f.pauseVerification() : null;
    const lockedSecurity = await lockAccount(f);
    pending?.release();
    assertDenied(await (pending ? pending.result : f.verify()), f.store);
    assert.deepEqual(f.store.getUser(f.userId).security, lockedSecurity);
    assert.equal(f.store.authChallenges.get(f.challenge.id)?.status, "EXPIRED");
    assert.equal([...f.store.auditRecords.values()].some((record) => record.action === "auth.login" && record.result === "ALLOWED"), false);
    assertDenied(await f.verify(), f.store);
  });
}

test("account lockout preserves the recovery challenge path", () => {
  const store = new CvgStore({ bootstrapPassword: password });
  const userId = store.bootstrapCredentials.userId;
  const challenge = store.createAuthChallenge("RECOVERY", userId, "synthetic-locked-recovery", 120, 3);
  store.recordLoginFailure(userId, 1, 5);
  assert.equal(store.isAccountLocked(store.getUser(userId)), true);
  const current = store.findAuthChallenge("RECOVERY", challenge.tokenDigest);
  assert.ok(current);
  store.consumeAuthChallenge(current);
  assert.equal(store.authChallenges.get(challenge.id)?.status, "CONSUMED");
});

test("a lockout that has elapsed does not invalidate a still-pending MFA challenge", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-03T12:00:00.000Z") });
  const store = new CvgStore({ bootstrapPassword: password });
  const userId = store.bootstrapCredentials.userId;
  const challenge = store.createAuthChallenge("MFA", userId, "synthetic-expired-lockout", 120, 3);
  const locked = store.recordLoginFailure(userId, 1, 1);
  assert.ok(locked.security.lockedUntil);
  t.mock.timers.setTime(Date.parse(locked.security.lockedUntil));
  assert.equal(store.isAccountLocked(store.getUser(userId)), false);
  const current = store.findAuthChallenge("MFA", challenge.tokenDigest);
  assert.ok(current);
  store.consumeAuthChallenge(current);
  assert.equal(store.authChallenges.get(challenge.id)?.status, "CONSUMED");
});

test("challenge consumption checks stored credentials even when the caller rewrites its challenge copy", () => {
  const store = new CvgStore({ bootstrapPassword: password });
  const userId = store.bootstrapCredentials.userId;
  const challenge = store.createAuthChallenge("MFA", userId, "synthetic-mutable-challenge", 60, 3);
  store.rotatePassword(userId, store.getUser(userId).passwordDigest, null);
  challenge.credentialVersion = store.getUser(userId).security.credentialVersion;
  challenge.expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  assert.throws(() => store.consumeAuthChallenge(challenge), (error: unknown) => error instanceof DomainError && error.code === "MFA_INVALID" && error.statusCode === 401);
  assert.equal(store.authChallenges.get(challenge.id)?.status, "EXPIRED");
  assert.equal(store.sessions.size, 0);
});
