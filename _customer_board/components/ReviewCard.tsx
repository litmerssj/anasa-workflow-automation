"use client";

import { useState } from "react";
import { UndoBanner } from "./UndoBanner";

type Props = {
  issueId: string;
  title: string;
  howTo: string;
  screenshotUrl: string | null;
  rejected: boolean; // 재수정요청 레인이면 true → 읽기 전용
  lastFeedback?: string;
};

export function ReviewCard({ issueId, title, howTo, screenshotUrl, rejected, lastFeedback }: Props) {
  const [mode, setMode] = useState<"idle" | "confirming" | "rejecting">("idle");
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "done" | "error">("idle");
  const [undoToken, setUndoToken] = useState<unknown>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function act(action: "pass" | "reject") {
    if (action === "reject" && !feedback.trim()) {
      setMode("rejecting");
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, action, feedback: feedback.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "제출 실패");
      setUndoToken(data.undo ?? null);
      setStatus(data.undo ? "sent" : "done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "알 수 없는 오류");
      setStatus("error");
    }
  }

  if (rejected) {
    return (
      <div className="bg-white border border-[var(--line)] rounded-xl p-3">
        <p className="text-[13px] font-medium mb-1.5">{title}</p>
        <p className="text-xs text-[var(--sub)]">{lastFeedback}</p>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <div className="bg-white border border-[var(--line)] rounded-xl p-3">
        <p className="text-[13px] font-medium mb-1.5">{title}</p>
        <UndoBanner
          issueId={issueId}
          undo={undoToken}
          onUndone={() => {
            setMode("idle");
            setFeedback("");
            setUndoToken(null);
            setStatus("idle");
          }}
          onExpire={() => setStatus("done")}
        />
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="bg-white border border-[var(--line)] rounded-xl p-3 opacity-70">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-xs text-[var(--green)] mt-1">처리되었습니다.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-3">
      <p className="text-[13px] font-medium mb-1.5">{title}</p>
      {screenshotUrl && (
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={screenshotUrl} alt="수정 전" className="rounded-md h-12 w-full object-cover bg-[var(--soft)]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={screenshotUrl} alt="수정 후" className="rounded-md h-12 w-full object-cover bg-[var(--soft)]" />
        </div>
      )}
      {howTo && <p className="text-xs text-[var(--sub)] mb-2.5 leading-relaxed whitespace-pre-wrap">{howTo}</p>}

      {mode === "rejecting" ? (
        <>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="어떤 점이 다른지 적어주세요"
            className="w-full h-14 px-2 py-1.5 text-xs rounded-md border border-[var(--line)] resize-none mb-1.5"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => act("reject")}
              disabled={status === "submitting" || !feedback.trim()}
              className="flex-1 h-8 text-xs rounded-md bg-[var(--ink)] text-white disabled:opacity-40"
            >
              재수정 요청 보내기
            </button>
            <button
              onClick={() => setMode("idle")}
              className="h-8 px-3 text-xs rounded-md border border-[var(--line)]"
            >
              취소
            </button>
          </div>
        </>
      ) : mode === "confirming" ? (
        <div className="rounded-md bg-[var(--soft)] px-2.5 py-2">
          <p className="text-[11px] text-[var(--sub)] mb-1.5">검수를 확인 완료로 처리할까요? 완료 후 되돌릴 수 있습니다.</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => act("pass")}
              disabled={status === "submitting"}
              className="flex-1 h-8 text-xs rounded-md bg-[var(--green)] text-white disabled:opacity-40"
            >
              예, 확인 완료
            </button>
            <button
              onClick={() => setMode("idle")}
              disabled={status === "submitting"}
              className="h-8 px-3 text-xs rounded-md border border-[var(--line)]"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            onClick={() => setMode("confirming")} // 클릭=확인 단계 진입, 즉시 확정 아님
            disabled={status === "submitting"}
            className="flex-1 h-8 text-xs rounded-md bg-[var(--green)] text-white disabled:opacity-40"
          >
            확인 완료
          </button>
          <button
            onClick={() => setMode("rejecting")}
            className="flex-1 h-8 text-xs rounded-md border border-[var(--line)] text-[var(--sub)]"
          >
            재수정 요청
          </button>
        </div>
      )}
      {status === "error" && <p className="text-[11px] text-[var(--red)] mt-1">{errorMsg}</p>}
    </div>
  );
}
