import { NextRequest, NextResponse } from "next/server";
import { deleteComment, updateIssue, updateIssueLabels, updateIssueState } from "@/lib/linear";
import { sanitizeUndoToken } from "@/lib/workflow-core.mjs";

// 제출(답변/검수) 직후 좁은 시간창 안에서만 호출되는 되돌리기. 원장은 Linear뿐이라
// 서버가 상태를 재추론하지 않고, 제출이 돌려준 undo 토큰을 그대로 역재생한다.
export async function POST(req: NextRequest) {
  try {
    const { issueId, undo } = (await req.json()) as { issueId: string; undo: unknown };
    if (!issueId) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const token = sanitizeUndoToken(undo) as {
      commentId: string;
      addLabels: string[];
      removeLabels: string[];
      setAssignee?: string | null;
      state?: string;
    };

    // 1) 방금 만든 [답변]/[검수] 코멘트 제거 — 이게 레인 판정을 되돌리는 핵심.
    await deleteComment(token.commentId);

    // 2) 라벨 원복.
    if (token.addLabels.length || token.removeLabels.length) {
      await updateIssueLabels(issueId, { add: token.addLabels, remove: token.removeLabels });
    }

    // 3) 담당자 원복(제출이 바꿨을 때만 토큰에 존재).
    if ("setAssignee" in token) {
      await updateIssue({ issueId, assigneeId: token.setAssignee ?? null });
    }

    // 4) 상태 원복(검수 되돌리기에서만 존재).
    if (token.state) {
      await updateIssueState(issueId, token.state);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
