import assert from "node:assert/strict";
import test from "node:test";

async function workflowCore() {
  return import("../lib/workflow-core.mjs");
}

test("reply undo restores 고객확인 and prior assignee only when the submit unblocked", async () => {
  const { buildReplyUndo } = await workflowCore();
  // 선택지 정확일치 → 제출이 고객확인 제거 + 담당자 재지정 → 되돌리기는 둘 다 원복
  assert.deepEqual(
    buildReplyUndo({ commentId: "c1", removeCustomerWait: true, priorAssigneeId: "u9" }),
    { kind: "reply", commentId: "c1", addLabels: ["고객확인"], removeLabels: [], setAssignee: "u9" },
  );
  // 이전 담당자가 없었으면 미지정(null)으로 원복
  assert.deepEqual(
    buildReplyUndo({ commentId: "c1", removeCustomerWait: true, priorAssigneeId: null }),
    { kind: "reply", commentId: "c1", addLabels: ["고객확인"], removeLabels: [], setAssignee: null },
  );
  // 자유서술 등 라벨 변화가 없던 제출 → 코멘트만 삭제, 라벨/담당자 무변경
  const noop = buildReplyUndo({ commentId: "c1", removeCustomerWait: false, priorAssigneeId: "u9" });
  assert.deepEqual(noop, { kind: "reply", commentId: "c1", addLabels: [], removeLabels: [] });
  assert.ok(!("setAssignee" in noop));
});

test("review undo re-adds only the labels that were actually present before", async () => {
  const { buildReviewUndo } = await workflowCore();
  // pass: 제출이 검수요청 제거 + Done → 되돌리기는 있던 라벨만 복원 + 이전 상태 복원
  assert.deepEqual(
    buildReviewUndo({ commentId: "c2", action: "pass", priorLabels: ["검수요청"], priorState: "In Review" }),
    { kind: "review", commentId: "c2", addLabels: ["검수요청"], removeLabels: [], state: "In Review" },
  );
  // 없던 라벨은 복원하지 않음
  assert.deepEqual(
    buildReviewUndo({ commentId: "c2", action: "pass", priorLabels: [], priorState: "In Review" }).addLabels,
    [],
  );
  // reject: 제출이 검수반려 추가 + 검수요청 제거 → 되돌리기는 반대로
  assert.deepEqual(
    buildReviewUndo({ commentId: "c3", action: "reject", priorLabels: ["검수요청"], priorState: "In Review" }),
    { kind: "review", commentId: "c3", addLabels: ["검수요청"], removeLabels: ["검수반려"], state: "In Review" },
  );
});

test("undo token sanitizer keeps only known fields and requires a comment id", async () => {
  const { sanitizeUndoToken } = await workflowCore();
  assert.throws(() => sanitizeUndoToken(null), /되돌리기 정보/);
  assert.throws(() => sanitizeUndoToken({ addLabels: ["x"] }), /코멘트/);
  const clean = sanitizeUndoToken({
    commentId: "  c1  ",
    addLabels: ["고객확인", "", 7],
    removeLabels: "nope",
    setAssignee: null,
    state: "  Done  ",
    hacker: "drop table",
  });
  assert.deepEqual(clean, {
    commentId: "c1",
    addLabels: ["고객확인", "7"],
    removeLabels: [],
    setAssignee: null,
    state: "Done",
  });
  assert.ok(!("hacker" in clean));
  // setAssignee 키가 없으면 결과에도 없어야 한다(담당자 무변경)
  assert.ok(!("setAssignee" in sanitizeUndoToken({ commentId: "c1" })));
});
