import assert from "node:assert/strict";
import test from "node:test";
import {
  customerQueryLaneOf,
  latestAnswerComment,
  latestQuestionComment,
  latestReviewComment,
  parseQuestion,
} from "../lib/board-logic.ts";

function issue(comments: { body: string; createdAt: string }[]) {
  return {
    labels: { nodes: [{ name: "질의이력" }, { name: "고객확인" }] },
    comments: { nodes: comments },
  } as never;
}

test("customer board hides a query marker until an actual question is published", () => {
  assert.equal(customerQueryLaneOf(issue([])), null);
  assert.equal(
    customerQueryLaneOf(issue([{ body: "**[질의초안]** 내부 검토 중", createdAt: "2026-08-04" }])),
    null,
  );
  assert.equal(
    customerQueryLaneOf(issue([{ body: "**[질의]** 범위를 선택해 주세요\n선택지: 현재 화면, 전체 화면", createdAt: "2026-08-04" }])),
    "질의대기",
  );
});

test("published question renders question, business context, and closed options", () => {
  const published = {
    body: [
      "**[질의]**",
      "제외 규칙을 선택해 주세요.",
      "",
      "마감 계산 기준을 확정하기 위한 질문입니다.",
      "선택지: 둘 다 제외, 25일 거래처만 제외, 둘 다 포함",
    ].join("\n"),
    createdAt: "2026-08-04",
  };
  assert.deepEqual(parseQuestion(published as never), {
    title: "제외 규칙을 선택해 주세요.",
    detail: "마감 계산 기준을 확정하기 위한 질문입니다.",
    options: ["둘 다 제외", "25일 거래처만 제외", "둘 다 포함"],
  });
  assert.equal(latestQuestionComment(issue([published]) as never), published);
});

test("JSON option contract preserves commas inside one option", () => {
  const comment = {
    body: [
      "**[질의]**",
      "편집 방식을 골라주세요.",
      "설명",
      '선택지(JSON): ["헤더는 팝업, 상세는 화면 내 편집", "모두 팝업"]',
    ].join("\n"),
    createdAt: "2026-08-04",
  };
  assert.deepEqual(parseQuestion(comment as never)?.options, [
    "헤더는 팝업, 상세는 화면 내 편집",
    "모두 팝업",
  ]);
});

test("latest question uses createdAt when Linear returns comments newest-first", () => {
  const newest = { body: "**[질의]** 새 질문", createdAt: "2026-08-04T02:00:00Z" };
  const older = { body: "**[질의]** 이전 질문", createdAt: "2026-08-04T01:00:00Z" };
  assert.equal(latestQuestionComment(issue([newest, older]) as never), newest);
});

test("latest answer and review feedback use createdAt instead of array order", () => {
  const answerNewest = { body: "**[답변]** 새 답변", createdAt: "2026-08-04T03:00:00Z" };
  const answerOlder = { body: "**[답변]** 이전 답변", createdAt: "2026-08-04T01:00:00Z" };
  const rejectNewest = { body: "**[검수:반려]** 새 사유", createdAt: "2026-08-04T04:00:00Z" };
  const rejectOlder = { body: "**[검수:반려]** 이전 사유", createdAt: "2026-08-04T02:00:00Z" };
  const target = issue([answerNewest, rejectNewest, rejectOlder, answerOlder]);
  assert.equal(latestAnswerComment(target as never), answerNewest);
  assert.equal(latestReviewComment(target as never), rejectNewest);
});
