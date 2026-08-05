import assert from "node:assert/strict";
import test from "node:test";

async function sessionModule() {
  try {
    return await import("../lib/internal-session.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

test("internal session accepts an untampered unexpired token", async () => {
  const session = await sessionModule();
  assert.equal(typeof session.signInternalSession, "function");
  assert.equal(typeof session.verifyInternalSession, "function");
  const token = session.signInternalSession("test-secret", 2_000);
  assert.equal(session.verifyInternalSession(token, "test-secret", 1_999), true);
});

test("internal session rejects tampering, another secret, and expiry", async () => {
  const session = await sessionModule();
  assert.equal(typeof session.signInternalSession, "function");
  const token = session.signInternalSession("test-secret", 2_000);
  assert.equal(session.verifyInternalSession(`${token}x`, "test-secret", 1_999), false);
  assert.equal(session.verifyInternalSession(token, "wrong-secret", 1_999), false);
  assert.equal(session.verifyInternalSession(token, "test-secret", 2_001), false);
});

test("internal session secret is required", async () => {
  const session = await sessionModule();
  assert.throws(() => session.requireInternalSessionSecret({}), /INTERNAL_SESSION_SECRET/);
});
