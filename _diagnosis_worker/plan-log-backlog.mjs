#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAssignment } from "./assign.mjs";
import { planLogBacklog } from "./log-backlog.mjs";
import { WORKER_DIR } from "./lib/env.mjs";
import { acquireWorkerLock } from "./lib/lock.mjs";
import { createLinearClient } from "./lib/linear.mjs";
import { parseWorkflowEvent, workflowEventBody } from "../_customer_board/lib/workflow-core.mjs";

export const LOG_BATCH = "2026-08-04-log-126-v1";

function countByDeveloper(plan) {
  const counts = {};
  for (const { developerId } of plan) counts[developerId] = (counts[developerId] ?? 0) + 1;
  return counts;
}

function existingBatchPlan(issue) {
  return issue.comments.nodes
    .map((comment) => parseWorkflowEvent(comment))
    .find((event) => event?.event === "log_backlog_planned" && event.batch === LOG_BATCH) ?? null;
}

export async function runLogBacklogPlan({
  client = createLinearClient(),
  env = process.env,
  dryRun = false,
} = {}) {
  const developerIds = [env.DEV_SEUNGHYUN_ID, env.DEV_VN_A_ID, env.DEV_VN_B_ID];
  const issues = await client.listIssues({ state: { type: { nin: ["completed", "canceled"] } } });
  const plan = planLogBacklog(issues, {
    seniorId: env.DEV_SEUNGHYUN_ID,
    developerIds,
    expectedTotal: 126,
  });
  let recorded = 0;

  if (!dryRun) {
    for (const { issue, developerId } of plan) {
      const existing = existingBatchPlan(issue);
      if (existing) {
        if (existing.developerId !== developerId) {
          throw new Error(`${issue.identifier}의 기존 LOG 계획 담당자가 결정적 계획과 다릅니다`);
        }
        continue;
      }
      await client.createComment(issue.id, workflowEventBody({
        event: "log_backlog_planned",
        batch: LOG_BATCH,
        issueId: issue.id,
        developerId,
      }));
      recorded += 1;
    }
  }

  return { planned: plan.length, recorded, counts: countByDeveloper(plan) };
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const lockPath = path.join(WORKER_DIR, ".worker.lock");
  const release = acquireWorkerLock(lockPath);
  if (!release) throw new Error("다른 워커 패스가 실행 중입니다. 잠시 후 다시 실행하세요.");
  try {
    const client = createLinearClient();
    const plan = await runLogBacklogPlan({ client, dryRun });
    const assignment = dryRun ? null : await runAssignment({ client });
    console.log(JSON.stringify({ batch: LOG_BATCH, plan, assignment }, null, 2));
  } finally {
    release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
