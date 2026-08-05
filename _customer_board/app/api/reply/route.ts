import { NextRequest, NextResponse } from "next/server";
import { createComment, getIssue, updateIssue, updateIssueLabels } from "@/lib/linear";
import { TAG } from "@/lib/board-logic";
import { buildReplyUndo, customerReplyDecision, latestDeveloperId } from "@/lib/workflow-core.mjs";

export async function POST(req: NextRequest) {
  try {
    const { issueId, answer } = (await req.json()) as {
      issueId: string;
      answer: string;
    };

    if (!issueId || !answer?.trim()) {
      return NextResponse.json({ error: "답변 내용이 비어 있습니다." }, { status: 400 });
    }

    const issue = await getIssue(issueId);
    const decision = customerReplyDecision(
      {
        labels: issue.labels.nodes.map((label) => label.name),
        comments: issue.comments.nodes,
      },
      answer,
    );

    const priorAssigneeId = issue.assignee?.id ?? null;
    const commentId = await createComment(issueId, `${TAG.답변} ${answer.trim()}`);

    if (decision.removeCustomerWait) {
      await updateIssueLabels(issueId, { remove: ["고객확인"] });
      const developerId = latestDeveloperId(issue.comments.nodes);
      if (developerId) await updateIssue({ issueId, assigneeId: developerId });
    }

    const undo = buildReplyUndo({
      commentId,
      removeCustomerWait: decision.removeCustomerWait,
      priorAssigneeId,
    });
    return NextResponse.json({ ok: true, autoUnblocked: decision.removeCustomerWait, undo });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
