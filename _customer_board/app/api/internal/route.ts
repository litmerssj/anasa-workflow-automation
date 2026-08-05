import { NextRequest, NextResponse } from "next/server";
import {
  createComment,
  createIssue,
  getIssue,
  updateIssue,
  updateIssueLabels,
  updateIssueState,
} from "@/lib/linear";
import { TAG } from "@/lib/board-logic";
import { cookies } from "next/headers";
import {
  INTERNAL_SESSION_COOKIE,
  requireInternalSessionSecret,
  verifyInternalSession,
} from "@/lib/internal-session";
import {
  internalWorkflowDecision,
  latestDeveloperId,
  reviewedQuestionDecision,
} from "@/lib/workflow-core.mjs";

export async function POST(req: NextRequest) {
  try {
    const store = await cookies();
    const token = store.get(INTERNAL_SESSION_COOKIE)?.value;
    if (!verifyInternalSession(token, requireInternalSessionSecret())) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const payload = await req.json();
    const { type } = payload as {
      type: "unblock" | "requery" | "publish_query" | "spawn_ticket" | "workflow_action";
    };

    if (type === "unblock") {
      // 고객 회신을 감사셀이 읽고 판정 → 해당 건 Blocked 해제
      const { issueId } = payload as { issueId: string };
      await updateIssueLabels(issueId, { remove: ["고객확인"] });
      return NextResponse.json({ ok: true });
    }

    if (type === "requery") {
      // 답변이 모호하거나 역질문 필요 → 같은 이슈에 새 질의 코멘트 (카드 유지, 계속 Blocked)
      const { issueId, question, options } = payload as {
        issueId: string;
        question: string;
        options?: string[];
      };
      const body = [
        TAG.질의,
        question,
        options && options.length > 0 ? `선택지(JSON): ${JSON.stringify(options)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await createComment(issueId, body);
      // 영구 마커 부착 — 나중에 고객확인 라벨이 사라지면 이 마커로 '반영됨' 판정
      await updateIssueLabels(issueId, { add: ["질의이력", "고객확인"] });
      return NextResponse.json({ ok: true });
    }

    if (type === "publish_query") {
      const { issueId, question, detail, options } = payload as {
        issueId: string;
        question: string;
        detail: string;
        options: string[];
      };
      if (!issueId) {
        return NextResponse.json({ error: "티켓은 필수입니다." }, { status: 400 });
      }
      const issue = await getIssue(issueId);
      const decision = reviewedQuestionDecision(
        issue.labels.nodes.map((label) => label.name),
        { question, detail, options },
      );
      await createComment(issueId, decision.body);
      await updateIssueLabels(issueId, { add: decision.add, remove: decision.remove });
      return NextResponse.json({ ok: true });
    }

    if (type === "spawn_ticket") {
      // 순수 질의(❓46 유형)의 답변이 도착 → draft 티켓 생성, 자동분류-미확정으로 감사셀 확정 대기
      const { title, description } = payload as {
        title: string;
        description: string;
      };
      const teamId = process.env.LINEAR_TEAM_ID;
      if (!teamId) throw new Error("LINEAR_TEAM_ID가 설정되지 않았습니다");
      const issue = await createIssue({
        title,
        description,
        teamId,
        labelNames: ["자동분류-미확정"],
      });
      return NextResponse.json({ ok: true, identifier: issue.identifier, url: issue.url });
    }

    if (type === "workflow_action") {
      const { issueId, action, feedback } = payload as {
        issueId: string;
        action: "qa_pass" | "qa_reject";
        feedback?: string;
      };
      if (!issueId || !action) {
        return NextResponse.json({ error: "티켓과 동작은 필수입니다." }, { status: 400 });
      }
      const issue = await getIssue(issueId);
      const decision = internalWorkflowDecision(
        {
          state: issue.state,
          comments: issue.comments.nodes,
        },
        action,
        feedback,
      );
      const detail = feedback?.trim() || "내부 확인 완료";
      await createComment(issueId, `${decision.tag} ${detail}`);
      if (decision.returnToDeveloper) {
        const developerId = latestDeveloperId(issue.comments.nodes);
        if (developerId) await updateIssue({ issueId, assigneeId: developerId });
      }
      await updateIssueState(issueId, decision.state);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "알 수 없는 action type" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
