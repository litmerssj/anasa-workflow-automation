"use client";

import { useMemo, useState } from "react";
import screens from "@/lib/data/screens.json";

type Screen = { code: string; module: string; name: string; file: string };

export function ReferenceViewer() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Screen | null>(null);

  const results = useMemo(() => {
    const list = screens as Screen[];
    if (!q.trim()) return list; // 전체 노출 — 20건 캡은 알파벳순 첫 모듈(BAS)만 보이는 착시를 만든다
    const needle = q.trim().toLowerCase();
    return list.filter((s) => s.code.toLowerCase().includes(needle) || s.name.includes(q.trim()));
  }, [q]);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="화면코드 또는 화면명으로 검색 (예: PDT-OSC-002M, 발주현황)"
        className="w-full h-10 px-3 text-sm rounded-md border border-[var(--line)] bg-white mb-4"
      />

      <div className="grid grid-cols-[240px_1fr] gap-4">
        <div className="flex flex-col gap-1 max-h-[560px] overflow-y-auto">
          {results.map((s) => (
            <button
              key={s.code}
              onClick={() => setSelected(s)}
              className={
                "text-left px-2.5 py-1.5 rounded-md text-xs " +
                (selected?.code === s.code ? "bg-[var(--blue-soft)] text-[var(--blue)]" : "hover:bg-white")
              }
            >
              <span className="text-gray-400 mr-1">{s.code}</span>
              {s.name}
            </button>
          ))}
          {results.length === 0 && <p className="text-xs text-gray-400 px-2">검색 결과 없음</p>}
        </div>

        <div>
          {!selected ? (
            <div className="h-64 rounded-xl border border-dashed border-[var(--line)] flex items-center justify-center text-xs text-gray-400">
              왼쪽에서 화면을 선택해 주세요
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium mb-3">
                {selected.code} · {selected.name}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-[var(--sub)] mb-1.5">화면설계서</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/design-spec/${encodeURIComponent(selected.file)}`}
                    alt={selected.name}
                    className="w-full rounded-md border border-[var(--line)]"
                  />
                </div>
                <div>
                  <p className="text-xs text-[var(--sub)] mb-1.5">라이브 화면</p>
                  <div className="h-64 rounded-md border border-dashed border-[var(--line)] flex flex-col items-center justify-center gap-2 text-center px-4">
                    <p className="text-xs text-gray-400">
                      라이브 스크린샷 자동 연동은 다음 버전에서 제공됩니다.
                    </p>
                    <p className="text-xs text-gray-400">
                      현재는 라벨 전수 스윕 리포트를 참고해 주세요.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
