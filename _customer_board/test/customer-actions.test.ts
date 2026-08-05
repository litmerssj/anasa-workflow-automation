import assert from "node:assert/strict";
import test from "node:test";

async function workflowCore() {
  return import("../lib/workflow-core.mjs");
}

const queryIssue = {
  labels: ["질의이력", "고객확인"],
  comments: [{ body: "**[질의]** 표시할 방식을 골라주세요\n선택지: A안, B안" }],
};

test("customer reply decision derives option matching from the published Linear question", async () => {
  const { customerReplyDecision } = await workflowCore();
  assert.deepEqual(customerReplyDecision(queryIssue, "A안"), {
    matchedOption: true,
    removeCustomerWait: true,
  });
  assert.deepEqual(customerReplyDecision(queryIssue, "별도 의견"), {
    matchedOption: false,
    removeCustomerWait: false,
  });
});

test("customer reply decision rejects an issue outside the query lane", async () => {
  const { customerReplyDecision } = await workflowCore();
  assert.throws(
    () => customerReplyDecision({ ...queryIssue, labels: ["질의이력"] }, "A안"),
    /고객확인/,
  );
});

test("customer review decision requires 검수요청 and rejection feedback", async () => {
  const { customerReviewDecision } = await workflowCore();
  assert.deepEqual(customerReviewDecision(["검수요청"], "pass", ""), {
    tag: "**[검수:통과]**",
    remove: ["검수요청", "검수반려"],
    add: [],
    done: true,
  });
  assert.throws(() => customerReviewDecision(["검수요청"], "reject", ""), /사유/);
  assert.throws(() => customerReviewDecision(["고객보드"], "pass", ""), /검수요청/);
});
