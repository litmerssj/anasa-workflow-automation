"use client";

import { useState } from "react";
import { UndoBanner } from "./UndoBanner";

type Props = {
  issueId: string;
  title: string;
  detail: string;
  options: string[];
  answered: boolean; // 회신완료 레인이면 true → 읽기 전용으로 표시
  lastAnswer?: string;
};

export function QueryCard({ issueId, title, detail, options, answered, lastAnswer }: Props) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null); // 빠른 선택: 확정 전 대기 중인 선택지
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "done" | "error">("idle");
  const [undoToken, setUndoToken] = useState<unknown>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function submit(value: string) {
    if (!value.trim()) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, answer: value.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "제출 실패");
      setUndoToken(data.undo ?? null);
      setStatus(data.undo ? "sent" : "done"); // undo 토큰 있으면 되돌리기 창 → 없으면 바로 확정
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "알 수 없는 오류");
      setStatus("error");
    }
  }

  const isObjective = options.length > 0;

  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[13px] font-medium">{title}</p>
        {!answered && status !== "done" && status !== "sent" && (
          <span
            className={
              "text-[10px] whitespace-nowrap px-1.5 py-0.5 rounded-md " +
              (isObjective
                ? "text-[var(--blue)] bg-[var(--blue-soft)]"
                : "text-[var(--sub)] bg-[var(--soft)]")
            }
          >
            {isObjective ? "빠른 선택" : "자유 서술"}
          </span>
        )}
      </div>
      {detail && <p className="text-xs text-[var(--sub)] mb-2.5 leading-relaxed whitespace-pre-wrap">{detail}</p>}

      {answered ? (
        <p className="text-xs text-[var(--sub)]">답변: {lastAnswer}</p>
      ) : status === "sent" ? (
        <UndoBanner
          issueId={issueId}
          undo={undoToken}
          onUndone={() => {
            // 되돌리기 성공 → 다시 답변할 수 있게 초기화
            setSelected(null);
            setText("");
            setUndoToken(null);
            setStatus("idle");
          }}
          onExpire={() => setStatus("done")}
        />
      ) : status === "done" ? (
        <p className="text-xs text-[var(--green)]">답변이 접수되었습니다.</p>
      ) : (
        <>
          {isObjective && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {options.map((opt) => {
                const isSel = selected === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => setSelected(isSel ? null : opt)} // 클릭=선택만, 제출 아님
                    disabled={status === "submitting"}
                    aria-pressed={isSel}
                    className={
                      "h-7 px-2.5 text-xs rounded-md border disabled:opacity-50 " +
                      (isSel
                        ? "border-[var(--blue)] bg-[var(--blue-soft)] text-[var(--blue)] font-medium"
                        : "border-[var(--line)] hover:bg-[var(--soft)]")
                    }
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          )}

          {isObjective && selected && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-[var(--blue-soft)] px-2.5 py-1.5 mb-2">
              <span className="text-[11px] text-[var(--sub)] truncate">
                선택: <span className="text-[var(--ink)] font-medium">{selected}</span>
              </span>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => submit(selected)}
                  disabled={status === "submitting"}
                  className="h-6 px-2.5 text-[11px] rounded-md bg-[var(--ink)] text-white disabled:opacity-40"
                >
                  이대로 제출
                </button>
                <button
                  onClick={() => setSelected(null)}
                  disabled={status === "submitting"}
                  className="h-6 px-2 text-[11px] rounded-md border border-[var(--line)]"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={isObjective ? "다른 의견이 있으면 자유롭게 적어주세요" : "편하게 적어주세요"}
            className="w-full h-14 px-2 py-1.5 text-xs rounded-md border border-[var(--line)] resize-none"
          />
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-[var(--sub)]">
              {isObjective ? "선택 후 확인하면 반영" : "답변 검토 후 반영"}
            </p>
            <button
              onClick={() => submit(text)}
              disabled={status === "submitting" || !text.trim()}
              className="h-7 px-3 text-xs rounded-md bg-[var(--ink)] text-white disabled:opacity-40"
            >
              제출
            </button>
          </div>
          {status === "error" && <p className="text-[11px] text-[var(--red)] mt-1">{errorMsg}</p>}
        </>
      )}
    </div>
  );
}
