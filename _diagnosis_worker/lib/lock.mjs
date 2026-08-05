import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

const STALE_AFTER_MS = 30 * 60 * 1000;

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireWorkerLock(lockPath, {
  now = Date.now(),
  pid = process.pid,
  isAlive = processIsAlive,
} = {}) {
  const token = randomUUID();
  const value = JSON.stringify({ pid, startedAt: now, token });
  const write = () => writeFileSync(lockPath, value, { flag: "wx", encoding: "utf8" });

  try {
    write();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let existing;
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      existing = null;
    }
    const active = existing &&
      Number.isFinite(existing.pid) &&
      Number.isFinite(existing.startedAt) &&
      now - existing.startedAt <= STALE_AFTER_MS &&
      isAlive(existing.pid);
    if (active) return null;
    try {
      unlinkSync(lockPath);
    } catch (unlinkError) {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    }
    write();
  }

  return () => {
    try {
      const current = JSON.parse(readFileSync(lockPath, "utf8"));
      if (current.token === token) unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };
}
