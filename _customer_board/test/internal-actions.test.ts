import assert from "node:assert/strict";
import test from "node:test";

async function core() {
  return import("../lib/workflow-core.mjs");
}

const completeEvidence = `**[개발완료]**
- PR/커밋: https://github.com/example/repo/pull/123
- 스모크: 주문 조회와 저장 성공
- 수정 전: ![before](https://example.com/before.png)
- 수정 후: ![after](https://example.com/after.png)`;

test("QA evidence requires code, smoke, before and after proof", async () => {
  const { qaEvidence } = await core();
  assert.deepEqual(qaEvidence([{ body: completeEvidence }]), {
    complete: true,
    missing: [],
  });
  assert.deepEqual(qaEvidence([{ body: "**[개발완료]** PR/커밋: abc123" }]).missing, [
    "스모크",
    "수정 전",
    "수정 후",
  ]);
});

test("QA pass completes the same ticket", async () => {
  const { internalWorkflowDecision } = await core();
  assert.deepEqual(
    internalWorkflowDecision(
      { state: { name: "QA In Progress" }, comments: [{ body: completeEvidence }] },
      "qa_pass",
    ),
    {
      tag: "**[QA:통과]**",
      state: "Done",
      returnToDeveloper: false,
    },
  );
});

test("QA pass is rejected when proof is incomplete", async () => {
  const { internalWorkflowDecision } = await core();
  assert.throws(
    () => internalWorkflowDecision(
      { state: { name: "QA In Progress" }, comments: [] },
      "qa_pass",
    ),
    /증빙/,
  );
});

test("QA reject returns the original developer to In Progress", async () => {
  const { internalWorkflowDecision } = await core();
  assert.deepEqual(
    internalWorkflowDecision(
      { state: { name: "QA In Progress" }, comments: [] },
      "qa_reject",
      "재현 실패",
    ),
    {
      tag: "**[QA:반려]**",
      state: "In Progress",
      returnToDeveloper: true,
    },
  );
});

test("QA actions are rejected outside QA In Progress", async () => {
  const { internalWorkflowDecision } = await core();
  assert.throws(
    () => internalWorkflowDecision(
      { state: { name: "QA Request" }, comments: [{ body: completeEvidence }] },
      "qa_pass",
    ),
    /QA In Progress/,
  );
  assert.throws(
    () => internalWorkflowDecision(
      { state: { name: "Done" }, comments: [] },
      "final_pass",
    ),
    /지원하지 않는/,
  );
});

test("latest query draft is parsed into editable customer-safe fields", async () => {
  const { latestQueryDraft } = await core();
  assert.deepEqual(
    latestQueryDraft([
      { body: "**[질의초안]**\n이전 질문\n\n이전 설명\n선택지: A, B\n검토사유: 계약" },
      {
        body: [
          "**[질의초안]**",
          "적용 범위를 선택해 주세요.",
          "",
          "현재 요청만으로 적용 범위를 확정하기 어렵습니다.",
          "두 줄 설명도 보존합니다.",
          "선택지: 현재 화면만, ORD 전체 화면",
          "",
          "검토사유: 일정 확약 포함",
        ].join("\n"),
      },
    ]),
    {
      question: "적용 범위를 선택해 주세요.",
      detail: "현재 요청만으로 적용 범위를 확정하기 어렵습니다.\n두 줄 설명도 보존합니다.",
      options: ["현재 화면만", "ORD 전체 화면"],
      reviewReasons: ["일정 확약 포함"],
    },
  );
});

test("reviewed query requires the review lane and 2 to 5 unique options", async () => {
  const { reviewedQuestionDecision } = await core();
  assert.deepEqual(
    reviewedQuestionDecision(["질의검토필요"], {
      question: "적용 범위를 선택해 주세요.",
      detail: "고객 확인이 필요합니다.",
      options: ["현재 화면만", "ORD 전체 화면"],
    }),
    {
      body: '**[질의]**\n적용 범위를 선택해 주세요.\n\n고객 확인이 필요합니다.\n선택지(JSON): ["현재 화면만","ORD 전체 화면"]',
      add: ["질의이력", "고객확인"],
      remove: ["질의검토필요", "고객질의필요"],
    },
  );
  assert.throws(
    () => reviewedQuestionDecision(["질의검토필요"], {
      question: "질문",
      detail: "설명",
      options: ["같음", "같음"],
    }),
    /중복/,
  );
  assert.throws(
    () => reviewedQuestionDecision([], {
      question: "질문",
      detail: "설명",
      options: ["A", "B"],
    }),
    /질의검토필요/,
  );
});
