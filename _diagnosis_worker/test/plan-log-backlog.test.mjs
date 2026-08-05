import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkflowEvent, workflowEventBody } from "../../_customer_board/lib/workflow-core.mjs";

const env = {
  DEV_SEUNGHYUN_ID: "ian",
  DEV_VN_A_ID: "jin",
  DEV_VN_B_ID: "roger",
};

function logIssues(count) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `issue-${number}`,
      identifier: `ANA-${number}`,
      title: `[LOG] 티켓 ${number}`,
      labels: { nodes: [{ id: number === 2 ? "tier3" : "tier2", name: number === 2 ? "tier-3" : "tier-2" }] },
      comments: { nodes: [] },
    };
  });
}

function fakeClient(issues, comments) {
  return {
    listIssues: async () => issues,
    createComment: async (issueId, body) => comments.push({ issueId, body }),
  };
}

test("LOG planner dry-run returns a 42/42/42 manifest without comments", async () => {
  const { runLogBacklogPlan } = await import("../plan-log-backlog.mjs");
  const comments = [];
  const result = await runLogBacklogPlan({
    client: fakeClient(logIssues(126), comments),
    env,
    dryRun: true,
  });

  assert.deepEqual(result.counts, { ian: 42, jin: 42, roger: 42 });
  assert.equal(result.planned, 126);
  assert.equal(result.recorded, 0);
  assert.equal(comments.length, 0);
});

test("LOG planner does not duplicate an existing batch plan", async () => {
  const { runLogBacklogPlan, LOG_BATCH } = await import("../plan-log-backlog.mjs");
  const comments = [];
  const issues = logIssues(126);
  issues[0].comments.nodes.push({
    body: workflowEventBody({
      event: "log_backlog_planned",
      batch: LOG_BATCH,
      issueId: issues[0].id,
      developerId: "ian",
    }),
    createdAt: "2026-08-04T07:00:00Z",
  });

  const result = await runLogBacklogPlan({ client: fakeClient(issues, comments), env });

  assert.equal(result.recorded, 125);
  assert.equal(comments.some((call) => call.issueId === issues[0].id), false);
  assert.deepEqual(
    Object.fromEntries(["ian", "jin", "roger"].map((id) => [
      id,
      comments.filter((call) => parseWorkflowEvent(call.body)?.developerId === id).length + (id === "ian" ? 1 : 0),
    ])),
    { ian: 42, jin: 42, roger: 42 },
  );
});
