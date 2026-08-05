// 질의/검수 카드의 "상태"는 Linear에 별도 필드로 없다 — 라벨(레인) + 코멘트 접두태그(레인 내부 진행)로
// 판정한다. 이 파일이 그 판정 규칙의 단일 소스. 원장은 여전히 Linear — 여기는 순수 함수만 둔다.
import type { BoardIssue, BoardComment } from "./linear";

export const TAG = {
  질의: "**[질의]**",
  답변: "**[답변]**",
  검수통과: "**[검수:통과]**",
  검수반려: "**[검수:반려]**",
} as const;

export type QueryLane = "질의대기" | "회신완료" | "반영됨";
export type ReviewLane = "검수요청" | "재수정요청";

function lastTagged(comments: BoardComment[], tags: string[]): BoardComment | null {
  let latest: BoardComment | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  let latestIndex = -1;
  let latestHasTime = false;

  comments.forEach((comment, index) => {
    if (!tags.some((tag) => comment.body.startsWith(tag))) return;
    const time = Date.parse(comment.createdAt ?? "");
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

export function queryLaneOf(issue: BoardIssue): QueryLane {
  const hasFlag = issue.labels.nodes.some((l) => l.name === "고객확인");
  const comments = issue.comments.nodes;
  if (!hasFlag) return "반영됨";
  const last = lastTagged(comments, [TAG.질의, TAG.답변]);
  if (last && last.body.startsWith(TAG.답변)) return "회신완료";
  return "질의대기";
}

/** 고객 화면에는 실제 발행된 [질의]가 있는 티켓만 노출한다.
 * 라벨만 먼저 붙은 변환 대기 상태나 [질의초안]은 내부 큐에만 머문다. */
export function customerQueryLaneOf(issue: BoardIssue): QueryLane | null {
  if (!latestQuestionComment(issue)) return null;
  return queryLaneOf(issue);
}

export function reviewLaneOf(issue: BoardIssue): ReviewLane | null {
  const requesting = issue.labels.nodes.some((l) => l.name === "검수요청");
  const rejected = issue.labels.nodes.some((l) => l.name === "검수반려");
  if (requesting) return "검수요청";
  if (rejected) return "재수정요청";
  return null;
}

/** 질의 카드 본문 파싱: 첫 [질의] 코멘트에서 제목/설명/선택지를 뽑는다.
 * 작성 규칙(감사셀·워커가 지킴): 첫 줄=요약, 빈줄, 본문, 마지막 줄 "선택지: A, B" (선택형일 때만). */
export function parseQuestion(comment: BoardComment | null) {
  if (!comment) return null;
  const body = comment.body.replace(TAG.질의, "").trim();
  const lines = body.split("\n").filter((l) => l.trim().length > 0);
  const optLine = lines.find((l) => l.startsWith("선택지(JSON):") || l.startsWith("선택지:"));
  let options: string[] = [];
  if (optLine?.startsWith("선택지(JSON):")) {
    try {
      const parsed = JSON.parse(optLine.slice("선택지(JSON):".length).trim());
      if (Array.isArray(parsed)) options = parsed.map(String).map((value) => value.trim()).filter(Boolean);
    } catch {
      options = [];
    }
  } else if (optLine) {
    options = optLine.replace("선택지:", "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  const bodyLines = lines.filter((l) => l !== optLine);
  return {
    title: bodyLines[0] ?? "",
    detail: bodyLines.slice(1).join("\n"),
    options,
  };
}

export function latestQuestionComment(issue: BoardIssue): BoardComment | null {
  return lastTagged(issue.comments.nodes, [TAG.질의]);
}

export function latestAnswerComment(issue: BoardIssue): BoardComment | null {
  return lastTagged(issue.comments.nodes, [TAG.답변]);
}

export function latestReviewComment(issue: BoardIssue): BoardComment | null {
  return lastTagged(issue.comments.nodes, [TAG.검수통과, TAG.검수반려]);
}
