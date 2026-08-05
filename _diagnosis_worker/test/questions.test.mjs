import assert from "node:assert/strict";
import test from "node:test";

async function questions() {
  try {
    return await import("../questions.mjs");
  } catch {
    return {};
  }
}

const safeQuestion = {
  question: "주문 목록의 기본 표시 범위를 골라주세요.",
  detail: "처음 화면을 열었을 때 보여드릴 주문 범위를 확인하려고 합니다.",
  options: ["최근 30일 주문", "올해 전체 주문", "기간을 선택하기 전에는 표시하지 않음"],
};

test("safe closed business question is eligible for automatic publication", async () => {
  const { questionDecision } = await questions();
  assert.equal(typeof questionDecision, "function");
  assert.deepEqual(questionDecision(safeQuestion), { action: "publish", reasons: [] });
});

test("mentioning the 납기요청일 field is safe unless it promises a delivery date", async () => {
  const { questionDecision } = await questions();
  const value = {
    ...safeQuestion,
    detail: "수량·네고·납기요청일의 다건 수정 방식을 정하려고 합니다.",
  };
  assert.deepEqual(questionDecision(value), { action: "publish", reasons: [] });
  assert.equal(
    questionDecision({ ...value, question: "납기를 8월 10일로 확약할까요?" }).action,
    "review",
  );
});

test("freeform, technical, contractual, schedule and security questions require review", async () => {
  const { questionDecision } = await questions();
  const risky = [
    { ...safeQuestion, options: [] },
    { ...safeQuestion, detail: "SP와 API 중 무엇을 바꿀까요?" },
    { ...safeQuestion, question: "이 변경을 8월 10일까지 확약할까요?" },
    { ...safeQuestion, question: "추가 비용과 계약 범위를 승인할까요?" },
    { ...safeQuestion, detail: "보안 취약점과 인증 우회 내용을 고객에게 공개할까요?" },
  ];
  for (const value of risky) {
    assert.equal(questionDecision(value).action, "review", JSON.stringify(value));
  }
});

test("question limits reject too many, duplicate and oversized options", async () => {
  const { questionDecision } = await questions();
  assert.equal(questionDecision({ ...safeQuestion, options: ["A", "A"] }).action, "review");
  assert.equal(questionDecision({ ...safeQuestion, options: ["A", "B", "C", "D", "E", "F"] }).action, "review");
  assert.equal(questionDecision({ ...safeQuestion, options: ["A".repeat(121), "B"] }).action, "review");
});

test("published question body follows the customer board parser contract", async () => {
  const { publishedQuestionBody } = await questions();
  const body = publishedQuestionBody(safeQuestion);
  assert.match(body, /^\*\*\[질의\]\*\*/);
  assert.match(body, /선택지\(JSON\): \["최근 30일 주문","올해 전체 주문","기간을 선택하기 전에는 표시하지 않음"\]$/);
});

test("question pass auto-publishes a safe developer question and updates customer labels", async () => {
  const { runQuestions } = await questions();
  const updates = [];
  const comments = [];
  const client = {
    listIssues: async () => [{
      id: "issue-1",
      identifier: "ANA-20",
      title: "주문 기본 범위",
      description: "",
      state: { type: "started" },
      labels: { nodes: [
        { id: "customer", name: "고객보드" },
        { id: "question-needed", name: "고객질의필요" },
      ] },
      comments: { nodes: [{
        body: "**[개발자질문]**\n- 막힌 지점: 기본 조회 기간 결정 필요\n- 고객이 결정할 내용: 처음 보여줄 범위",
        createdAt: "2026-08-04T00:00:00Z",
      }] },
    }],
    ensureLabels: async (names) => names.map((name) => ({
      "질의이력": "history", "고객확인": "customer-wait",
    }[name] ?? `id-${name}`)),
    updateIssue: async (issueId, input) => updates.push({ issueId, input }),
    createComment: async (issueId, body) => comments.push({ issueId, body }),
  };
  const result = await runQuestions({
    client,
    generate: async () => JSON.stringify(safeQuestion),
  });
  assert.deepEqual(result, { scanned: 1, published: 1, review: 0, failed: 0 });
  assert.match(comments[0].body, /^\*\*\[질의\]\*\*/);
  assert.deepEqual(updates[0].input.labelIds.sort(), ["customer", "customer-wait", "history"].sort());
});

test("question dry-run generates a decision without Linear mutation", async () => {
  const { runQuestions } = await questions();
  const result = await runQuestions({
    client: {
      listIssues: async () => [{
        id: "i", identifier: "ANA-3", title: "질문", description: "",
        state: { type: "started" },
        labels: { nodes: [{ id: "need", name: "고객질의필요" }] },
        comments: { nodes: [{ body: "**[개발자질문]** 범위 확인", createdAt: "2026-08-04" }] },
      }],
      ensureLabels: async () => assert.fail("dry-run must not ensure labels"),
      updateIssue: async () => assert.fail("dry-run must not update"),
      createComment: async () => assert.fail("dry-run must not comment"),
    },
    generate: async () => JSON.stringify(safeQuestion),
    dryRun: true,
  });
  assert.equal(result.published, 1);
});
