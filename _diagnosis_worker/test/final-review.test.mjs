import assert from "node:assert/strict";
import test from "node:test";

async function finalReview() {
  try {
    return await import("../final-review.mjs");
  } catch {
    return {};
  }
}

const milestone = { id: "ms-1", name: "W2 LOG", targetDate: "2026-08-14" };
const issues = [
  { identifier: "ANA-1", title: "출고 조회", url: "https://linear.app/ana-1", state: "Done" },
  { identifier: "ANA-2", title: "패킹 저장", url: "https://linear.app/ana-2", state: "QA In Progress" },
  { identifier: "ANA-3", title: "미납 패킹", url: "https://linear.app/ana-3", state: "QA Request" },
  { identifier: "ANA-4", title: "출고 취소", url: "https://linear.app/ana-4", state: "In Progress" },
];

test("D-2 aggregate is not created before 09:00 Seoul", async () => {
  const { aggregatePlan } = await finalReview();
  assert.equal(typeof aggregatePlan, "function");
  assert.deepEqual(
    aggregatePlan(milestone, issues, [], new Date("2026-08-11T23:59:59Z")),
    { operation: "none" },
  );
});

test("D-2 aggregate creates one Yoona ticket with linked issue counts", async () => {
  const { aggregatePlan } = await finalReview();
  const plan = aggregatePlan(milestone, issues, [], new Date("2026-08-12T00:00:00Z"));
  assert.equal(plan.operation, "create");
  assert.equal(plan.title, "[최종검수] W2 LOG — 2026-08-14 미팅");
  assert.match(plan.description, /내부 QA 완료 1건/);
  assert.match(plan.description, /QA 요청 1건/);
  assert.match(plan.description, /QA 진행 중 1건/);
  assert.match(plan.description, /개발 미완료 1건/);
  assert.match(plan.description, /ANA-1/);
});

test("target date change updates the existing aggregate instead of creating another", async () => {
  const { aggregatePlan } = await finalReview();
  const existing = [{
    id: "aggregate-1",
    title: "[최종검수] W2 LOG — 2026-08-13 미팅",
    description: "old",
    projectMilestone: { id: "ms-1" },
  }];
  const plan = aggregatePlan(milestone, issues, existing, new Date("2026-08-12T00:00:00Z"));
  assert.equal(plan.operation, "update");
  assert.equal(plan.issueId, "aggregate-1");
});

test("unscheduled final-review items are accumulated without customer publication", async () => {
  const { aggregatePlan } = await finalReview();
  const plan = aggregatePlan({ id: "unscheduled", name: "일정 미정", targetDate: null }, issues, [], new Date());
  assert.equal(plan.operation, "create");
  assert.equal(plan.title, "[최종검수] 일정 미정");
  assert.match(plan.description, /자동 고객 발행하지 않습니다/);
});

test("final-review pass creates the D-2 aggregate assigned to Yoona", async () => {
  const { runFinalReview } = await finalReview();
  const created = [];
  const client = {
    listIssues: async () => [{
      id: "issue-1",
      identifier: "ANA-1",
      title: "출고 조회",
      description: "",
      url: "https://linear.app/ana-1",
      state: { name: "Done", type: "completed" },
      project: { id: "project-1", name: "아나사 안정화 6주" },
      projectMilestone: milestone,
      labels: { nodes: [{ id: "tier2", name: "tier-2" }] },
    }],
    ensureLabels: async () => ["final-label"],
    createIssue: async (input) => { created.push(input); return { id: "aggregate-1" }; },
    updateIssue: async () => assert.fail("should not update"),
  };
  const result = await runFinalReview({
    client,
    env: { LINEAR_TEAM_ID: "anasa", QA_YOONA_ID: "yoona" },
    asOf: new Date("2026-08-12T00:00:00Z"),
  });
  assert.deepEqual(result, { groups: 1, created: 1, updated: 0, unchanged: 0, failed: 0 });
  assert.equal(created[0].assigneeId, "yoona");
  assert.equal(created[0].projectId, "project-1");
  assert.equal(created[0].projectMilestoneId, "ms-1");
  assert.deepEqual(created[0].labelIds, ["final-label"]);
});

test("final-review dry-run plans creation without ensuring labels or creating issues", async () => {
  const { runFinalReview } = await finalReview();
  const result = await runFinalReview({
    client: {
      listIssues: async () => [{
        id: "i", identifier: "ANA-4", title: "검수", url: "https://linear/i",
        state: { name: "Done", type: "completed" }, projectMilestone: milestone,
        labels: { nodes: [{ id: "tier2", name: "tier-2" }] },
      }],
      ensureLabels: async () => assert.fail("dry-run must not ensure labels"),
      createIssue: async () => assert.fail("dry-run must not create"),
      updateIssue: async () => assert.fail("dry-run must not update"),
    },
    env: { LINEAR_TEAM_ID: "anasa", QA_YOONA_ID: "yoona" },
    asOf: new Date("2026-08-12T00:00:00Z"),
    dryRun: true,
  });
  assert.equal(result.created, 1);
});
