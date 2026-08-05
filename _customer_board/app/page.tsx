import { listIssuesByLabels, type BoardIssue } from "@/lib/linear";
import {
  customerQueryLaneOf,
  latestAnswerComment,
  latestQuestionComment,
  latestReviewComment,
  parseQuestion,
  reviewLaneOf,
} from "@/lib/board-logic";
import { IntakeForm } from "@/components/IntakeForm";
import { QueryCard } from "@/components/QueryCard";
import { ReviewCard } from "@/components/ReviewCard";

export const dynamic = "force-dynamic"; // 원장은 Linear — 매 요청 실시간 조회, 이 앱은 상태를 캐시하지 않는다

function extractImage(desc: string | null): string | null {
  if (!desc) return null;
  const m = desc.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  return m ? m[1] : null;
}

async function loadBoard() {
  const byLabel = await listIssuesByLabels(["질의이력", "검수요청", "검수반려"]);
  const query = { 질의대기: [] as BoardIssue[], 회신완료: [] as BoardIssue[], 반영됨: [] as BoardIssue[] };
  for (const issue of byLabel["질의이력"]) {
    const lane = customerQueryLaneOf(issue);
    if (lane) query[lane].push(issue);
  }
  const review = { 검수요청: [] as BoardIssue[], 재수정요청: [] as BoardIssue[] };
  for (const issue of [...byLabel["검수요청"], ...byLabel["검수반려"]]) {
    const lane = reviewLaneOf(issue);
    if (lane) review[lane].push(issue);
  }
  return { query, review };
}

function QueryColumn({ label, issues }: { label: string; issues: BoardIssue[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[13px] font-medium text-[var(--sub)]">{label}</span>
        <span className="text-xs text-gray-400">{issues.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {issues.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {issues.map((issue) => {
          const q = parseQuestion(latestQuestionComment(issue));
          const answered = label !== "질의대기" && label !== "회신완료" ? false : label === "회신완료";
          const lastAnswer = latestAnswerComment(issue);
          return (
            <QueryCard
              key={issue.id}
              issueId={issue.id}
              title={q?.title || issue.title}
              detail={q?.detail || ""}
              options={q?.options || []}
              answered={answered}
              lastAnswer={answered ? lastAnswer?.body.replace("**[답변]**", "").trim() : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReviewColumn({ label, issues }: { label: string; issues: BoardIssue[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[13px] font-medium text-[var(--sub)]">{label}</span>
        <span className="text-xs text-gray-400">{issues.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {issues.length === 0 && <p className="text-xs text-gray-400">없음</p>}
        {issues.map((issue) => {
          const rejected = label === "재수정요청";
          const fb = latestReviewComment(issue);
          return (
            <ReviewCard
              key={issue.id}
              issueId={issue.id}
              title={issue.title}
              howTo={issue.description?.split("\n").slice(0, 2).join(" ") ?? ""}
              screenshotUrl={extractImage(issue.description)}
              rejected={rejected}
              lastFeedback={rejected ? fb?.body.replace("**[검수:반려]**", "").trim() : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export default async function CustomerBoardPage() {
  if (!process.env.LINEAR_API_KEY) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white p-6">
        <p className="text-sm font-medium mb-2">설정이 필요합니다</p>
        <p className="text-xs text-[var(--sub)]">
          .env.local에 LINEAR_API_KEY를 넣어주세요. README.md 참조.
        </p>
      </div>
    );
  }

  const { query, review } = await loadBoard();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-[var(--blue-soft)] flex items-center justify-center text-[var(--blue)] font-medium text-sm">
            아
          </div>
          <span className="font-medium text-[15px]">아나사 ERP 검수</span>
        </div>
        <IntakeForm />
      </div>

      <p className="text-[13px] text-[var(--sub)] mb-2">질의</p>
      <div className="grid grid-cols-3 gap-3 mb-8">
        <QueryColumn label="질의대기" issues={query.질의대기} />
        <QueryColumn label="회신완료" issues={query.회신완료} />
        <QueryColumn label="반영됨" issues={query.반영됨} />
      </div>

      <p className="text-[13px] text-[var(--sub)] mb-2">검수</p>
      <div className="grid grid-cols-2 gap-3">
        <ReviewColumn label="검수요청" issues={review.검수요청} />
        <ReviewColumn label="재수정요청" issues={review.재수정요청} />
      </div>
    </div>
  );
}
