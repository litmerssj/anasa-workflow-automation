#!/usr/bin/env node
import path from "node:path";
import { runDiagnosis } from "./diagnose.mjs";
import { runClassification } from "./classify.mjs";
import { runQuestions } from "./questions.mjs";
import { runAssignment } from "./assign.mjs";
import { runFinalReview } from "./final-review.mjs";
import { WORKER_DIR } from "./lib/env.mjs";
import { acquireWorkerLock } from "./lib/lock.mjs";
import { runPasses } from "./orchestrator.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const loop = args.includes("--loop");
const intervalMs = Number(process.env.INTERVAL_MS || 5 * 60 * 1000);
const lockPath = path.join(WORKER_DIR, ".worker.lock");

if (loop && !process.env.MAX_PER_PASS) process.env.MAX_PER_PASS = "3";

async function executePass() {
  const release = acquireWorkerLock(lockPath);
  if (!release) {
    console.log("[워커] 이전 패스가 실행 중이라 이번 polling을 건너뜁니다");
    return [];
  }
  const startedAt = new Date();
  console.log(`\n=== 워커 패스 시작 ${startedAt.toISOString()} ${dryRun ? "(dry-run)" : ""} ===`);
  try {
    return await runPasses([
      { name: "진단", run: () => runDiagnosis({ dryRun }) },
      { name: "자동분류", run: () => runClassification({ dryRun }) },
      { name: "고객질의", run: () => runQuestions({ dryRun }) },
      { name: "자동배정", run: () => runAssignment({ dryRun }) },
      { name: "최종검수", run: () => runFinalReview({ dryRun }) },
    ]);
  } finally {
    release();
    console.log(`=== 패스 종료 (${Date.now() - startedAt.getTime()}ms) ===`);
  }
}

await executePass();
if (loop) {
  console.log(`루프 모드: ${intervalMs / 1000}초 간격`);
  setInterval(executePass, intervalMs);
}
