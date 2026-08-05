import {
  TAG,
  isQaRequestState,
  latestDeveloperId,
  parseWorkflowEvent,
  workflowEventBody,
} from "./workflow-core.mjs";

type LifecycleIssue = {
  id: string;
  identifier: string;
  state: { name: string; type: string };
  labels: { nodes: { name: string }[] };
  comments: { nodes: { body: string; createdAt?: string }[] };
};

type LifecycleDeps = {
  getIssue(issueId: string): Promise<LifecycleIssue>;
  createComment(issueId: string, body: string): Promise<unknown>;
};

const REWORK_TAGS = [TAG.qaReject, TAG.finalHold, TAG.reviewReject];

function commentTime(comment: { body: string; createdAt?: string }): number {
  const event = parseWorkflowEvent(comment);
  const value = comment.createdAt ?? event?.at ?? "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function currentCompletionIsRecorded(comments: { body: string; createdAt?: string }[]): boolean {
  const completions = comments.filter(
    (comment) => parseWorkflowEvent(comment)?.event === "dev_completed",
  );
  if (completions.length === 0) return false;
  const latestCompletionTime = Math.max(...completions.map(commentTime));
  return !comments.some(
    (comment) =>
      REWORK_TAGS.some((tag) => comment.body.startsWith(tag)) &&
      commentTime(comment) > latestCompletionTime,
  );
}

export async function transitionQaRequest(
  issueId: string,
  deps: LifecycleDeps,
  now = new Date(),
): Promise<{ status: "ignored" } | { status: "ready"; developerId: string }> {
  const issue = await deps.getIssue(issueId);
  if (!isQaRequestState(issue.state)) return { status: "ignored" };

  const developerId = latestDeveloperId(issue.comments.nodes);
  if (!developerId) return { status: "ignored" };

  if (!currentCompletionIsRecorded(issue.comments.nodes)) {
    const completedCycles = issue.comments.nodes.filter(
      (comment) => parseWorkflowEvent(comment)?.event === "dev_completed",
    ).length;
    await deps.createComment(
      issueId,
      `${TAG.developerDone} Linear QA Request 전환 감지 · 같은 티켓을 내부 QA로 넘깁니다.`,
    );
    await deps.createComment(
      issueId,
      workflowEventBody({
        event: "dev_completed",
        issueId,
        developerId,
        cycle: completedCycles + 1,
        at: now.toISOString(),
      }),
    );
  }

  return { status: "ready", developerId };
}
