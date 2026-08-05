import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function lockModule() {
  try {
    return await import("../lib/lock.mjs");
  } catch {
    return {};
  }
}

test("worker lock prevents an overlapping live pass and releases cleanly", async () => {
  const { acquireWorkerLock } = await lockModule();
  assert.equal(typeof acquireWorkerLock, "function");
  const dir = mkdtempSync(path.join(tmpdir(), "anasa-worker-lock-"));
  const lockPath = path.join(dir, "worker.lock");
  const release = acquireWorkerLock(lockPath, {
    now: 1_000,
    pid: 10,
    isAlive: () => true,
  });
  assert.equal(typeof release, "function");
  assert.equal(acquireWorkerLock(lockPath, { now: 2_000, pid: 11, isAlive: () => true }), null);
  release();
  const nextRelease = acquireWorkerLock(lockPath, { now: 3_000, pid: 11, isAlive: () => true });
  assert.equal(typeof nextRelease, "function");
  nextRelease();
});

test("worker lock recovers a stale dead owner after thirty minutes", async () => {
  const { acquireWorkerLock } = await lockModule();
  const dir = mkdtempSync(path.join(tmpdir(), "anasa-worker-stale-"));
  const lockPath = path.join(dir, "worker.lock");
  writeFileSync(lockPath, JSON.stringify({ pid: 10, startedAt: 1_000 }));
  const release = acquireWorkerLock(lockPath, {
    now: 1_000 + 30 * 60 * 1000 + 1,
    pid: 11,
    isAlive: () => false,
  });
  assert.equal(typeof release, "function");
  release();
});
