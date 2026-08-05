import { createHash } from "node:crypto";

export const TAG = Object.freeze({
  query: "**[질의]**",
  queryDraft: "**[질의초안]**",
  answer: "**[답변]**",
  workflow: "**[워크플로]**",
  developerQuestion: "**[개발자질문]**",
  developerDone: "**[개발완료]**",
  qaPass: "**[QA:통과]**",
  qaReject: "**[QA:반려]**",
  finalPass: "**[최종검수:통과]**",
  finalHold: "**[최종검수:보류]**",
  reviewPass: "**[검수:통과]**",
  reviewReject: "**[검수:반려]**",
});

function stableEventInput(event) {
  const keys = Object.keys(event)
    .filter((key) => key !== "at" && key !== "fingerprint")
    .sort();
  return Object.fromEntries(keys.map((key) => [key, event[key]]));
}

export function eventFingerprint(event) {
  const stable = stableEventInput(event);
  const digest = createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
  return `${event.event}:${event.issueId ?? "unknown"}:${digest}`;
}

export function workflowEventBody(event) {
  const value = {
    ...event,
    fingerprint: event.fingerprint ?? eventFingerprint(event),
  };
  return `${TAG.workflow} ${JSON.stringify(value)}`;
}

export function parseWorkflowEvent(value) {
  const body = typeof value === "string" ? value : value?.body;
  if (typeof body !== "string" || !body.startsWith(TAG.workflow)) return null;
  try {
    const parsed = JSON.parse(body.slice(TAG.workflow.length).trim());
    return parsed && typeof parsed.event === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function latestMatchingComment(comments, predicate) {
  let latest = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  let latestIndex = -1;
  let latestHasTime = false;

  comments.forEach((comment, index) => {
    if (!predicate(comment)) return;
    const time = Date.parse(comment?.createdAt ?? "");
    const hasTime = Number.isFinite(time);
    const isLater = hasTime
      ? !latestHasTime || time > latestTime || (time === latestTime && index > latestIndex)
      : !latestHasTime && index > latestIndex;
    if (!latest || isLater) {
      latest = comment;
      latestTime = time;
      latestIndex = index;
      latestHasTime = hasTime;
    }
  });

  return latest;
}

export function latestDeveloperId(comments) {
  const comment = latestMatchingComment(comments, (candidate) => {
    const event = parseWorkflowEvent(candidate);
    return event?.event === "dev_assigned" && typeof event.developerId === "string";
  });
  return parseWorkflowEvent(comment)?.developerId ?? null;
}

export function isExactOption(answer, options) {
  if (!Array.isArray(options) || options.length === 0) return false;
  return options.includes(String(answer ?? "").trim());
}

function parseOptions(body) {
  const optionLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("선택지(JSON):") || line.startsWith("선택지:"));
  if (!optionLine) return [];
  if (optionLine.startsWith("선택지(JSON):")) {
    try {
      const parsed = JSON.parse(optionLine.slice("선택지(JSON):".length).trim());
      return Array.isArray(parsed) ? parsed.map(String).map((option) => option.trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return optionLine
    .slice("선택지:".length)
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
}

export function latestPublishedOptions(comments) {
  const comment = latestMatchingComment(comments, (candidate) => {
    const body = candidate?.body;
    return typeof body === "string" && body.startsWith(TAG.query);
  });
  return comment ? parseOptions(comment.body) : [];
}

export function latestQueryDraft(comments) {
  const comment = latestMatchingComment(comments, (candidate) => {
    const body = candidate?.body;
    return typeof body === "string" && body.startsWith(TAG.queryDraft);
  });
  if (comment) {
    const body = comment.body;
    const lines = body.slice(TAG.queryDraft.length).trim().split("\n");
    const optionIndex = lines.findIndex((line) => {
      const value = line.trim();
      return value.startsWith("선택지(JSON):") || value.startsWith("선택지:");
    });
    const reasonIndex = lines.findIndex((line) => line.trim().startsWith("검토사유:"));
    const contentEnd = optionIndex >= 0 ? optionIndex : reasonIndex >= 0 ? reasonIndex : lines.length;
    const content = lines.slice(0, contentEnd).map((line) => line.trim());
    while (content[0] === "") content.shift();
    while (content.at(-1) === "") content.pop();
    const question = content.shift() ?? "";
    while (content[0] === "") content.shift();
    const detail = content.join("\n").trim();
    const options = optionIndex >= 0 ? parseOptions(lines[optionIndex].trim()) : [];
    const reviewReasons = reasonIndex >= 0
      ? lines[reasonIndex].trim().slice("검토사유:".length).split(",").map((value) => value.trim()).filter(Boolean)
      : [];
    return { question, detail, options, reviewReasons };
  }
  return null;
}

export function reviewedQuestionDecision(labels, value) {
  requireLabelNames(labels, ["질의검토필요"]);
  const question = String(value?.question ?? "").trim();
  const detail = String(value?.detail ?? "").trim();
  const options = Array.isArray(value?.options)
    ? value.options.map((option) => String(option).trim()).filter(Boolean)
    : [];
  if (!question) throw new Error("질문은 필수입니다");
  if (!detail) throw new Error("고객용 설명은 필수입니다");
  if (options.length < 2 || options.length > 5) throw new Error("선택지는 2~5개여야 합니다");
  if (new Set(options).size !== options.length) throw new Error("선택지가 중복되었습니다");
  if (options.some((option) => option.length > 120)) throw new Error("선택지는 120자 이하여야 합니다");
  return {
    body: [TAG.query, question, "", detail, `선택지(JSON): ${JSON.stringify(options)}`].join("\n"),
    add: ["질의이력", "고객확인"],
    remove: ["질의검토필요", "고객질의필요"],
  };
}

export function hasTaggedComment(comments, tag) {
  return comments.some((comment) => typeof comment?.body === "string" && comment.body.startsWith(tag));
}

export function isQaRequestState(state) {
  return state?.name === "QA Request" && state?.type === "started";
}

function rotateQaCandidates(candidates, lastAssignedId) {
  if (!lastAssignedId) return candidates;
  const index = candidates.findIndex((member) => member.id === lastAssignedId);
  if (index < 0) return candidates;
  return [...candidates.slice(index + 1), ...candidates.slice(0, index + 1)];
}

function leastLoadedQa(candidates, load, lastAssignedId) {
  if (candidates.length === 0) return null;
  const minimum = Math.min(...candidates.map((member) => load[member.id] ?? 0));
  const tiedIds = new Set(
    candidates.filter((member) => (load[member.id] ?? 0) === minimum).map((member) => member.id),
  );
  return rotateQaCandidates(candidates, lastAssignedId)
    .find((member) => tiedIds.has(member.id)) ?? null;
}

export function selectQaMember(issue, pool, load, lastAssignedId = null) {
  const notSelf = pool.filter((member) => member.id !== issue.developerId);
  const preferred = issue.tier === "tier-3"
    ? notSelf.filter((member) => member.role === "lead" || member.role === "senior")
    : notSelf.filter((member) => member.role === "intern");
  const preferredAvailable = preferred.filter(
    (member) => (load[member.id] ?? 0) < (member.cap ?? (member.role === "intern" ? 3 : 2)),
  );
  if (preferredAvailable.length > 0) {
    return leastLoadedQa(preferredAvailable, load, lastAssignedId);
  }
  const fallback = notSelf.filter(
    (member) =>
      (member.role === "lead" || member.role === "senior") &&
      (load[member.id] ?? 0) < (member.cap ?? 2),
  );
  return leastLoadedQa(fallback, load, lastAssignedId);
}

function requireLabelNames(labels, required) {
  const names = new Set(labels);
  for (const label of required) {
    if (!names.has(label)) throw new Error(`라벨 '${label}'이 없는 티켓입니다`);
  }
}

export function customerReplyDecision(issue, answer) {
  requireLabelNames(issue.labels, ["질의이력", "고객확인"]);
  const matchedOption = isExactOption(answer, latestPublishedOptions(issue.comments));
  return { matchedOption, removeCustomerWait: matchedOption };
}

/** 되돌리기 토큰: 제출이 만든 변화를 그대로 역재생하기 위한 자기완결 명세.
 * commentId=삭제할 [답변]/[검수] 코멘트, addLabels/removeLabels=라벨 원복,
 * setAssignee(있을 때만)=담당자 원복, state(있을 때만)=상태 원복.
 * 원장은 Linear뿐이라 서버가 재추론하지 않고 이 토큰만으로 정확히 되돌린다. */
export function buildReplyUndo({ commentId, removeCustomerWait, priorAssigneeId }) {
  const undo = { kind: "reply", commentId, addLabels: [], removeLabels: [] };
  if (removeCustomerWait) {
    undo.addLabels = ["고객확인"];
    undo.setAssignee = priorAssigneeId ?? null; // 제출이 담당자를 바꿨으므로 이전 값(미지정=null)으로 복원
  }
  return undo;
}

export function buildReviewUndo({ commentId, action, priorLabels, priorState }) {
  const had = (name) => (Array.isArray(priorLabels) ? priorLabels.includes(name) : false);
  if (action === "pass") {
    // pass: [검수:통과] + 검수요청/검수반려 제거 + Done. 역: 코멘트 삭제 + 있던 라벨 복원 + 상태 복원.
    return {
      kind: "review",
      commentId,
      addLabels: ["검수요청", "검수반려"].filter(had),
      removeLabels: [],
      state: priorState,
    };
  }
  if (action === "reject") {
    // reject: [검수:반려] + 검수요청 제거 + 검수반려 추가 + In Progress. 역: 되돌림.
    return {
      kind: "review",
      commentId,
      addLabels: ["검수요청"].filter(had),
      removeLabels: ["검수반려"],
      state: priorState,
    };
  }
  throw new Error("지원하지 않는 검수 동작입니다");
}

/** undo 토큰 검증: 신뢰 못 할 클라이언트 입력을 최소한으로 정규화한다.
 * 알려진 필드만 통과시켜 임의 라벨/상태 주입을 제한한다. */
export function sanitizeUndoToken(value) {
  if (!value || typeof value !== "object") throw new Error("되돌리기 정보가 없습니다");
  const commentId = String(value.commentId ?? "").trim();
  if (!commentId) throw new Error("되돌릴 코멘트를 찾을 수 없습니다");
  const strList = (v) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];
  const token = {
    commentId,
    addLabels: strList(value.addLabels),
    removeLabels: strList(value.removeLabels),
  };
  if ("setAssignee" in value) {
    token.setAssignee = value.setAssignee == null ? null : String(value.setAssignee);
  }
  if (value.state != null && String(value.state).trim()) {
    token.state = String(value.state).trim();
  }
  return token;
}

export function customerReviewDecision(labels, action, feedback = "") {
  requireLabelNames(labels, ["검수요청"]);
  if (action === "pass") {
    return {
      tag: TAG.reviewPass,
      remove: ["검수요청", "검수반려"],
      add: [],
      done: true,
    };
  }
  if (action === "reject") {
    if (!String(feedback).trim()) throw new Error("재수정 사유는 필수입니다");
    return {
      tag: TAG.reviewReject,
      remove: ["검수요청"],
      add: ["검수반려"],
      done: false,
    };
  }
  throw new Error("지원하지 않는 검수 동작입니다");
}

export function qaEvidence(comments) {
  const body = comments.map((comment) => String(comment?.body ?? "")).join("\n");
  const checks = [
    ["PR/커밋", /PR\/커밋\s*:\s*\S+/i],
    ["스모크", /스모크\s*:\s*\S+/],
    ["수정 전", /수정\s*전\s*:\s*\S+/],
    ["수정 후", /수정\s*후\s*:\s*\S+/],
  ];
  const missing = checks.filter(([, pattern]) => !pattern.test(body)).map(([name]) => name);
  return { complete: missing.length === 0, missing };
}

export function internalWorkflowDecision(issue, action, feedback = "") {
  if (action === "qa_pass") {
    if (issue.state?.name !== "QA In Progress") {
      throw new Error("QA In Progress 상태의 티켓만 QA 처리할 수 있습니다");
    }
    const evidence = qaEvidence(issue.comments);
    if (!evidence.complete) throw new Error(`QA 전환 증빙이 부족합니다: ${evidence.missing.join(", ")}`);
    return {
      tag: TAG.qaPass,
      state: "Done",
      returnToDeveloper: false,
    };
  }
  if (action === "qa_reject") {
    if (issue.state?.name !== "QA In Progress") {
      throw new Error("QA In Progress 상태의 티켓만 QA 처리할 수 있습니다");
    }
    if (!String(feedback).trim()) throw new Error("QA 반려 사유는 필수입니다");
    return {
      tag: TAG.qaReject,
      state: "In Progress",
      returnToDeveloper: true,
    };
  }
  throw new Error("지원하지 않는 내부 워크플로 동작입니다");
}
