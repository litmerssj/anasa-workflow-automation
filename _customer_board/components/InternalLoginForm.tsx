"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InternalLoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit() {
    const res = await fetch("/api/internal/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError("비밀번호가 틀렸습니다.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-6 max-w-sm">
      <p className="text-sm font-medium mb-3">감사셀 전용 — 비밀번호 필요</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-full h-9 px-2 text-sm rounded-md border border-[var(--line)] mb-2"
      />
      {error && <p className="text-xs text-[var(--red)] mb-2">{error}</p>}
      <button onClick={submit} className="h-8 px-3 text-xs rounded-md bg-[var(--ink)] text-white">
        입장
      </button>
    </div>
  );
}
