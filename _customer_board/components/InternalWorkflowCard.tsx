"use client";

import { useState } from "react";

type Action = "qa_pass" | "qa_reject";

type Props = {
  issueId: string;
  identifier: string;
  title: string;
  url: string;
};

export function InternalWorkflowCard({ issueId, identifier, title, url }: Props) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function act(action: Action) {
    const needsFeedback = action === "qa_reject";
    if (needsFeedback && !feedback.trim()) {
      setError("반려·보류 사유를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "workflow_action",
          issueId,
          action,
          feedback: feedback.trim() || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "처리 실패");
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "처리 실패");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white p-3 opacity-60">
        <p className="text-[13px] font-medium">{identifier} · {title}</p>
        <p className="mt-1 text-xs text-[var(--green)]">처리되었습니다.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-3">
      <a href={url} target="_blank" rel="noreferrer" className="text-[13px] font-medium hover:underline">
        {identifier} · {title}
      </a>
      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="반려할 때 사유 입력"
        className="mt-2 h-14 w-full resize-none rounded-md border border-[var(--line)] px-2 py-1.5 text-xs"
      />
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => act("qa_pass")}
          className="h-8 flex-1 rounded-md bg-[var(--green)] text-xs text-white disabled:opacity-40"
        >
          QA 통과
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act("qa_reject")}
          className="h-8 flex-1 rounded-md border border-[var(--line)] text-xs disabled:opacity-40"
        >
          QA 반려
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-[var(--red)]">{error}</p>}
    </div>
  );
}
