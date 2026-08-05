import { cookies } from "next/headers";
import { listIssuesByLabel, listIssuesByState } from "@/lib/linear";
import { latestReviewComment, queryLaneOf } from "@/lib/board-logic";
import { InternalReplyCard } from "@/components/InternalReplyCard";
import { InternalLoginForm } from "@/components/InternalLoginForm";
import { InternalWorkflowCard } from "@/components/InternalWorkflowCard";
import { InternalQueryReviewCard } from "@/components/InternalQueryReviewCard";
import { latestQueryDraft } from "@/lib/workflow-core.mjs";
import {
  INTERNAL_SESSION_COOKIE,
  requireInternalSessionSecret,
  verifyInternalSession,
} from "@/lib/internal-session";

export const dynamic = "force-dynamic";

async function isAuthed() {
  const store = await cookies();
  const token = store.get(INTERNAL_SESSION_COOKIE)?.value;
  try {
    return verifyInternalSession(token, requireInternalSessionSecret());
  } catch {
    return false;
  }
}

export default async function InternalQueuePage() {
  if (!(await isAuthed())) {
    return (
      <div>
        <p className="text-[15px] font-medium mb-4">내부 변환 큐</p>
        <InternalLoginForm />
      </div>
    );
  }

  const teamId = process.env.LINEAR_TEAM_ID ?? "";
  const [queryIssues, queryReviewIssues, rejectedIssues, qaWaitingIssues, qaIssues, finalIssues] = await Promise.all([
    listIssuesByLabel("질의이력"),
    listIssuesByLabel("질의검토필요"),
    listIssuesByLabel("검수반려"),
    listIssuesByState("QA Request", teamId),
    listIssuesByState("QA In Progress", teamId),
    listIssuesByLabel("최종검수", teamId),
  ]);
  const replied = queryIssues.filter((i) => queryLaneOf(i) === "회신완료");

  return (
    <div>
      <p className="text-[15px] font-medium mb-1">내부 변환 큐</p>
      <p className="text-xs text-[var(--sub)] mb-6">
        고객 회신이 이 티켓에 그대로 반영되지 않는다 — 여기서 판정 후 처리한다.
      </p>

      <p className="text-[13px] text-[var(--sub)] mb-2">고객 회신 대기 ({replied.length})</p>
      <div className="grid grid-cols-2 gap-3 mb-8">
        {replied.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {replied.map((issue) => (
          <InternalReplyCard
            key={issue.id}
            issueId={issue.id}
            identifier={issue.identifier}
            title={issue.title}
            url={issue.url}
            comments={issue.comments.nodes}
            teamId={teamId}
          />
        ))}
      </div>

      <p className="mb-2 text-[13px] text-[var(--sub)]">질의 초안 검토 ({queryReviewIssues.length})</p>
      <div className="mb-8 grid grid-cols-2 gap-3">
        {queryReviewIssues.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {queryReviewIssues.map((issue) => (
          <InternalQueryReviewCard
            key={issue.id}
            issueId={issue.id}
            identifier={issue.identifier}
            title={issue.title}
            url={issue.url}
            draft={latestQueryDraft(issue.comments.nodes)}
          />
        ))}
      </div>

      <p className="text-[13px] text-[var(--sub)] mb-2">고객 검수 반려 — 재작업 라우팅 대기 ({rejectedIssues.length})</p>
      <div className="flex flex-col gap-2">
        {rejectedIssues.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {rejectedIssues.map((issue) => (
          <a
            key={issue.id}
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="block bg-white border border-[var(--line)] rounded-xl p-3 hover:border-[var(--border-strong)]"
          >
            <p className="text-[13px] font-medium">{issue.identifier} · {issue.title}</p>
            <p className="text-xs text-[var(--sub)] mt-1">
              {latestReviewComment(issue)?.body.replace("**[검수:반려]**", "").trim()}
            </p>
          </a>
        ))}
      </div>

      <p className="mt-8 mb-2 text-[13px] text-[var(--sub)]">QA 요청·미착수 ({qaWaitingIssues.length})</p>
      <div className="mb-8 flex flex-col gap-2">
        {qaWaitingIssues.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {qaWaitingIssues.map((issue) => (
          <a
            key={issue.id}
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[var(--line)] bg-white p-3 text-[13px] font-medium hover:border-[var(--border-strong)]"
          >
            {issue.identifier} · {issue.title}
          </a>
        ))}
      </div>

      <p className="mb-2 text-[13px] text-[var(--sub)]">QA 진행 중 ({qaIssues.length})</p>
      <div className="mb-8 grid grid-cols-2 gap-3">
        {qaIssues.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {qaIssues.map((issue) => (
          <InternalWorkflowCard
            key={issue.id}
            issueId={issue.id}
            identifier={issue.identifier}
            title={issue.title}
            url={issue.url}
          />
        ))}
      </div>

      <p className="mb-2 text-[13px] text-[var(--sub)]">모듈 최종검수 ({finalIssues.length})</p>
      <div className="flex flex-col gap-2">
        {finalIssues.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {finalIssues.map((issue) => (
          <a
            key={issue.id}
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[var(--line)] bg-white p-3 text-[13px] font-medium hover:border-[var(--border-strong)]"
          >
            {issue.identifier} · {issue.title}
          </a>
        ))}
      </div>
    </div>
  );
}
