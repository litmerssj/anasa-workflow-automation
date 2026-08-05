"use client";

import { useState } from "react";

type Draft = {
  question: string;
  detail: string;
  options: string[];
  reviewReasons: string[];
};

type Props = {
  issueId: string;
  identifier: string;
  title: string;
  url: string;
  draft: Draft | null;
};

export function InternalQueryReviewCard({ issueId, identifier, title, url, draft }: Props) {
  const [question, setQuestion] = useState(draft?.question ?? "");
  const [detail, setDetail] = useState(draft?.detail ?? "");
  const [options, setOptions] = useState(draft?.options.join("\n") ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function publish() {
    setBusy(true);
    setError("");
    try {
      const values = options.split("\n").map((value) => value.trim()).filter(Boolean);
      const response = await fetch("/api/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "publish_query", issueId, question, detail, options: values }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "질의 공개 실패");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "질의 공개 실패");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white p-3 opacity-60">
        <p className="text-[13px] font-medium">{identifier} · {title}</p>
        <p className="mt-1 text-xs text-[var(--green)]">고객에게 공개되었습니다.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-3">
      <a href={url} target="_blank" rel="noreferrer" className="text-[13px] font-medium hover:underline">
        {identifier} · {title}
      </a>
      {draft?.reviewReasons.length ? (
        <p className="mt-1 text-[11px] text-[var(--red)]">검토 사유: {draft.reviewReasons.join(", ")}</p>
      ) : null}
      <div className="mt-2 space-y-1.5">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="고객에게 보여줄 질문"
          className="h-8 w-full rounded-md border border-[var(--line)] px-2 text-xs"
        />
        <textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder="내부 식별자를 제거한 고객용 설명"
          className="h-16 w-full resize-none rounded-md border border-[var(--line)] px-2 py-1.5 text-xs"
        />
        <textarea
          value={options}
          onChange={(event) => setOptions(event.target.value)}
          placeholder={"선택지 2~5개 (한 줄에 하나)"}
          className="h-20 w-full resize-none rounded-md border border-[var(--line)] px-2 py-1.5 text-xs"
        />
        <button
          onClick={publish}
          disabled={busy || !question.trim() || !detail.trim()}
          className="h-7 rounded-md bg-[var(--ink)] px-2.5 text-xs text-white disabled:opacity-40"
        >
          검토 후 고객 공개
        </button>
        {error ? <p className="text-[11px] text-[var(--red)]">{error}</p> : null}
      </div>
    </div>
  );
}
