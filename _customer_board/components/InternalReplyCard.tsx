"use client";

import { useState } from "react";

type Comment = { body: string; createdAt: string; user: { name: string } | null };

type Props = {
  issueId: string;
  identifier: string;
  title: string;
  url: string;
  comments: Comment[];
  teamId: string;
};

type Mode = "idle" | "requery" | "spawn" | "done";

export function InternalReplyCard({ issueId, identifier, title, url, comments, teamId }: Props) {
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("");
  const [spawnTitle, setSpawnTitle] = useState("");
  const [spawnDesc, setSpawnDesc] = useState("");

  async function call(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "처리 실패");
      setMode("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "done") {
    return (
      <div className="bg-white border border-[var(--line)] rounded-xl p-3 opacity-60">
        <p className="text-[13px] font-medium">{identifier} · {title}</p>
        <p className="text-xs text-[var(--green)] mt-1">처리되었습니다.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <a href={url} target="_blank" rel="noreferrer" className="text-[13px] font-medium hover:underline">
          {identifier} · {title}
        </a>
      </div>
      <div className="bg-[var(--soft)] rounded-md p-2 mb-2 max-h-40 overflow-y-auto">
        {comments.map((c, i) => (
          <p key={i} className="text-xs text-[var(--sub)] mb-1.5 whitespace-pre-wrap">
            <span className="text-gray-400">{c.user?.name ?? "?"}:</span> {c.body}
          </p>
        ))}
      </div>

      {mode === "idle" && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => call({ type: "unblock", issueId })}
            disabled={busy}
            className="h-7 px-2.5 text-xs rounded-md bg-[var(--ink)] text-white disabled:opacity-40"
          >
            기존 갱신
          </button>
          <button
            onClick={() => setMode("requery")}
            className="h-7 px-2.5 text-xs rounded-md border border-[var(--line)]"
          >
            재질의
          </button>
          <button
            onClick={() => setMode("spawn")}
            className="h-7 px-2.5 text-xs rounded-md border border-[var(--line)]"
          >
            티켓 생성
          </button>
        </div>
      )}

      {mode === "requery" && (
        <div className="space-y-1.5">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="추가로 여쭤볼 질문"
            className="w-full h-14 px-2 py-1.5 text-xs rounded-md border border-[var(--line)] resize-none"
          />
          <input
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder="선택지 (쉼표로 구분, 없으면 비워둠)"
            className="w-full h-7 px-2 text-xs rounded-md border border-[var(--line)]"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() =>
                call({
                  type: "requery",
                  issueId,
                  question,
                  options: options ? options.split(",").map((s) => s.trim()).filter(Boolean) : [],
                })
              }
              disabled={busy || !question.trim()}
              className="h-7 px-2.5 text-xs rounded-md bg-[var(--ink)] text-white disabled:opacity-40"
            >
              발송
            </button>
            <button onClick={() => setMode("idle")} className="h-7 px-2.5 text-xs rounded-md border border-[var(--line)]">
              취소
            </button>
          </div>
        </div>
      )}

      {mode === "spawn" && (
        <div className="space-y-1.5">
          <input
            value={spawnTitle}
            onChange={(e) => setSpawnTitle(e.target.value)}
            placeholder="[모듈] 화면코드 · 요약"
            className="w-full h-7 px-2 text-xs rounded-md border border-[var(--line)]"
          />
          <textarea
            value={spawnDesc}
            onChange={(e) => setSpawnDesc(e.target.value)}
            placeholder="답변 반영한 신규 티켓 설명"
            className="w-full h-14 px-2 py-1.5 text-xs rounded-md border border-[var(--line)] resize-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => call({ type: "spawn_ticket", title: spawnTitle, description: spawnDesc, teamId })}
              disabled={busy || !spawnTitle.trim()}
              className="h-7 px-2.5 text-xs rounded-md bg-[var(--ink)] text-white disabled:opacity-40"
            >
              생성
            </button>
            <button onClick={() => setMode("idle")} className="h-7 px-2.5 text-xs rounded-md border border-[var(--line)]">
              취소
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-[var(--red)] mt-1.5">{error}</p>}
    </div>
  );
}
