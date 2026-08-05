"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  issueId: string;
  undo: unknown; // 제출 응답이 돌려준 되돌리기 토큰
  seconds?: number; // 되돌리기 가능 시간창 (기본 8초)
  onUndone: () => void; // 되돌리기 성공 → 카드를 다시 입력 가능 상태로
  onExpire: () => void; // 시간창 종료 → 확정 표시로
};

// 제출 직후 좁은 창에서만 뜨는 되돌리기 배너. 오클릭으로 넘어가도 여기서 원복한다.
export function UndoBanner({ issueId, undo, seconds = 8, onUndone, onExpire }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  const [status, setStatus] = useState<"idle" | "undoing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (remaining <= 0) {
      onExpireRef.current();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining]);

  async function undoNow() {
    setStatus("undoing");
    try {
      const res = await fetch("/api/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, undo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "되돌리기 실패");
      onUndone();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "알 수 없는 오류");
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-[var(--soft)] px-2.5 py-1.5">
      <span className="text-[11px] text-[var(--sub)]">
        {status === "error" ? errorMsg : "제출됨"}
      </span>
      <button
        onClick={undoNow}
        disabled={status === "undoing"}
        className="text-[11px] font-medium text-[var(--blue)] disabled:opacity-50"
      >
        {status === "undoing" ? "되돌리는 중…" : `되돌리기 ${remaining}s`}
      </button>
    </div>
  );
}
