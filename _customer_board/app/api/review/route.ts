import { NextRequest, NextResponse } from "next/server";
import { createComment, getIssue, updateIssue, updateIssueLabels, updateIssueState } from "@/lib/linear";
import { buildReviewUndo, customerReviewDecision, latestDeveloperId } from "@/lib/workflow-core.mjs";

export async function POST(req: NextRequest) {
  try {
    const { issueId, action, feedback } = (await req.json()) as {
      issueId: string;
      action: "pass" | "reject";
      feedback?: string;
    };

    if (!issueId || (action !== "pass" && action !== "reject")) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const issue = await getIssue(issueId);
    const priorLabels = issue.labels.nodes.map((label) => label.name);
    const priorState = issue.state.name;
    const decision = customerReviewDecision(priorLabels, action, feedback);

    let commentId: string;
    if (action === "pass") {
      commentId = await createComment(issueId, `${decision.tag} 고객 확인 완료`);
      await updateIssueLabels(issueId, { remove: decision.remove });
      await updateIssueState(issueId, "Done");
    } else {
      commentId = await createComment(issueId, `${decision.tag} ${feedback!.trim()}`);
      await updateIssueLabels(issueId, { remove: decision.remove, add: decision.add });
      const developerId = latestDeveloperId(issue.comments.nodes);
      if (developerId) await updateIssue({ issueId, assigneeId: developerId });
      await updateIssueState(issueId, "In Progress");
    }

    const undo = buildReviewUndo({ commentId, action, priorLabels, priorState });
    return NextResponse.json({ ok: true, undo });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
