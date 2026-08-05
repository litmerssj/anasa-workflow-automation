import {
  isQaRequestState,
  latestDeveloperId,
  parseWorkflowEvent,
  selectQaMember,
  workflowEventBody,
} from "./workflow-core.mjs";

type WorkflowComment = { body: string; createdAt?: string };
type QaIssue = {
  id: string;
  identifier: string;
  state: { name: string; type: string };
  assignee?: { id: string; name?: string } | null;
  labels: { nodes: { name: string }[] };
  comments: { nodes: WorkflowComment[] };
};

type QaAssignmentDeps = {
  getIssue(issueId: string): Promise<QaIssue>;
  listQaWork(): Promise<QaIssue[]>;
  listActiveMembers(): Promise<{ id: string }[]>;
  updateIssue(input: { issueId: string; assigneeId: string }): Promise<unknown>;
  createComment(issueId: string, body: string): Promise<unknown>;
};

type QaEnv = Record<string, string | undefined>;

function latestEvent(issue: QaIssue, eventName: string) {
  return issue.comments.nodes
    .map((comment) => ({ comment, event: parseWorkflowEvent(comment) }))
    .filter(({ event }) => event?.event === eventName)
    .sort((a, b) =>
      String(a.comment.createdAt ?? a.event?.at ?? "")
        .localeCompare(String(b.comment.createdAt ?? b.event?.at ?? "")),
    )
    .at(-1) ?? null;
}

function qaPool(env: QaEnv) {
  return [
    { id: env.QA_INTERN_A_ID, role: "intern", cap: 3 },
    { id: env.QA_INTERN_B_ID, role: "intern", cap: 3 },
    { id: env.QA_YOONA_ID, role: "lead", cap: 2 },
    { id: env.DEV_SEUNGHYUN_ID, role: "senior", cap: 2 },
  ];
}

function latestQaId(issue: QaIssue): string | null {
  const event = latestEvent(issue, "qa_assigned")?.event;
  return typeof event?.qaId === "string" ? event.qaId : null;
}

export async function assignQaRequest(
  issueId: string,
  deps: QaAssignmentDeps,
  env: QaEnv = process.env,
  now = new Date(),
): Promise<
  | { status: "ignored" | "waiting" }
  | { status: "assigned" | "already_assigned"; qaId: string; developerId: string }
> {
  const issue = await deps.getIssue(issueId);
  if (!isQaRequestState(issue.state)) return { status: "ignored" };

  const developerId = latestDeveloperId(issue.comments.nodes);
  if (!developerId) return { status: "waiting" };

  const currentQaId = latestQaId(issue);
  if (currentQaId && issue.assignee?.id === currentQaId) {
    return { status: "already_assigned", qaId: currentQaId, developerId };
  }

  const configuredPool = qaPool(env);
  if (configuredPool.some((member) => !member.id)) return { status: "waiting" };
  const activeIds = new Set((await deps.listActiveMembers()).map((member) => member.id));
  const activePool = configuredPool.filter(
    (member): member is { id: string; role: string; cap: number } =>
      typeof member.id === "string" && activeIds.has(member.id),
  );
  const work = await deps.listQaWork();
  const load = Object.fromEntries(activePool.map((member) => [member.id, 0]));
  for (const item of work) {
    if (!["QA Request", "QA In Progress"].includes(item.state?.name)) continue;
    const assigneeId = item.assignee?.id;
    if (assigneeId && assigneeId in load) load[assigneeId] += 1;
  }
  const lastAssignedId = work
    .flatMap((item) => item.comments.nodes)
    .map((comment) => ({ comment, event: parseWorkflowEvent(comment) }))
    .filter(({ event }) => event?.event === "qa_assigned" && typeof event.qaId === "string")
    .sort((a, b) =>
      String(a.comment.createdAt ?? a.event?.at ?? "")
        .localeCompare(String(b.comment.createdAt ?? b.event?.at ?? "")),
    )
    .at(-1)?.event?.qaId ?? null;
  const tier = issue.labels.nodes.find((label) => /^tier-[123]$/.test(label.name))?.name ?? null;
  const member = selectQaMember({ tier, developerId }, activePool, load, lastAssignedId);
  if (!member) return { status: "waiting" };

  await deps.updateIssue({ issueId, assigneeId: member.id });
  await deps.createComment(issueId, workflowEventBody({
    event: "qa_assigned",
    issueId,
    developerId,
    qaId: member.id,
    at: now.toISOString(),
  }));
  return { status: "assigned", qaId: member.id, developerId };
}
