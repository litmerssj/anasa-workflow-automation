"use client";

import { useEffect, useMemo, useState } from "react";
import {
  filterScreens,
  moduleCounts,
  MODULE_KR,
  updateRecentCodes,
  type Screen,
} from "@/lib/screen-picker";

const RECENT_STORAGE_KEY = "anasa-customer-board.recent-screens";
const MODULE_ORDER = ["BAS", "PUR", "PDT", "LOG", "SAL", "QC", "ORD", "TO", "COM"];

type Props = {
  screens: readonly Screen[];
  value: string;
  onSelect: (screen: Screen) => void;
  onCancel: () => void;
};

function readRecentCodes(): string[] {
  try {
    const stored = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function writeRecentCodes(codes: string[]) {
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // 최근 선택 저장이 막혀도 화면 선택 자체는 계속 동작한다.
  }
}

export function ScreenPicker({ screens, value, onSelect, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [selectedModule, setSelectedModule] = useState("ALL");
  const [recentCodes, setRecentCodes] = useState<string[]>([]);

  useEffect(() => {
    setRecentCodes(readRecentCodes());
  }, []);

  const counts = useMemo(() => moduleCounts(screens), [screens]);
  const recentScreens = useMemo(() => {
    const byCode = new Map(screens.map((screen) => [screen.code, screen]));
    return recentCodes.map((code) => byCode.get(code)).filter((screen): screen is Screen => !!screen);
  }, [recentCodes, screens]);

  const visibleScreens = useMemo(() => {
    if (selectedModule === "RECENT") {
      return filterScreens(recentScreens, { query, module: "ALL" });
    }
    return filterScreens(screens, { query, module: selectedModule });
  }, [query, recentScreens, screens, selectedModule]);

  const modules = MODULE_ORDER.filter((module) => counts[module]);

  function choose(screen: Screen) {
    const nextRecent = updateRecentCodes(recentCodes, screen.code);
    setRecentCodes(nextRecent);
    writeRecentCodes(nextRecent);
    onSelect(screen);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 id="intake-dialog-title" className="text-sm font-medium">화면 선택</h2>
          <p className="text-xs text-[var(--sub)] mt-1">화면명이나 코드를 검색하거나 모듈에서 찾아보세요.</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 shrink-0 text-xs rounded-md border border-[var(--line)] hover:border-[var(--border-strong)]"
        >
          요청 작성으로
        </button>
      </div>

      <label htmlFor="screen-picker-search" className="sr-only">화면명 또는 화면코드 검색</label>
      <input
        id="screen-picker-search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="화면명 또는 화면코드 검색 (예: 주문상태, ORD-SGP-003M)"
        className="w-full h-10 px-3 text-sm rounded-md border border-[var(--line)] focus:outline-none focus:border-[var(--border-strong)]"
      />

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-[160px_minmax(0,1fr)] gap-3">
        <div className="flex sm:flex-col gap-1 overflow-x-auto sm:overflow-visible pb-1 sm:pb-0" aria-label="모듈 필터">
          <button
            type="button"
            onClick={() => setSelectedModule("ALL")}
            aria-pressed={selectedModule === "ALL"}
            className={`h-9 px-3 rounded-md text-xs text-left whitespace-nowrap flex items-center justify-between gap-3 ${
              selectedModule === "ALL" ? "bg-[var(--ink)] text-white" : "hover:bg-[var(--soft)]"
            }`}
          >
            <span>전체</span><span className="opacity-60">{screens.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedModule("RECENT")}
            aria-pressed={selectedModule === "RECENT"}
            className={`h-9 px-3 rounded-md text-xs text-left whitespace-nowrap flex items-center justify-between gap-3 ${
              selectedModule === "RECENT" ? "bg-[var(--ink)] text-white" : "hover:bg-[var(--soft)]"
            }`}
          >
            <span>최근 선택</span><span className="opacity-60">{recentScreens.length}</span>
          </button>
          <div className="hidden sm:block h-px bg-[var(--line)] my-1" />
          {modules.map((module) => (
            <button
              key={module}
              type="button"
              onClick={() => setSelectedModule(module)}
              aria-pressed={selectedModule === module}
              className={`h-9 px-3 rounded-md text-xs text-left whitespace-nowrap flex items-center justify-between gap-3 ${
                selectedModule === module ? "bg-[var(--ink)] text-white" : "hover:bg-[var(--soft)]"
              }`}
            >
              <span>{MODULE_KR[module] ?? module} <span className="opacity-60">{module}</span></span>
              <span className="opacity-60">{counts[module]}</span>
            </button>
          ))}
        </div>

        <div className="min-h-[320px] max-h-[430px] overflow-y-auto rounded-lg border border-[var(--line)] bg-white p-1.5">
          {visibleScreens.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center px-6 text-center">
              <p className="text-xs text-[var(--sub)]">
                {selectedModule === "RECENT" && recentScreens.length === 0
                  ? "아직 최근 선택 화면이 없습니다. 전체 또는 모듈에서 화면을 선택해 주세요."
                  : "검색 조건에 맞는 화면이 없습니다. 화면명이나 코드를 다시 확인해 주세요."}
              </p>
            </div>
          ) : (
            visibleScreens.map((screen) => (
              <button
                key={screen.code}
                type="button"
                onClick={() => choose(screen)}
                aria-pressed={value === screen.code}
                className={`w-full px-3 py-2.5 rounded-md text-left flex items-center justify-between gap-4 hover:bg-[var(--soft)] ${
                  value === screen.code ? "bg-[var(--blue-soft)]" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm truncate">{screen.name}</span>
                  <span className="block text-[11px] text-[var(--sub)] mt-0.5 font-mono">{screen.code}</span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--sub)]">
                  {MODULE_KR[screen.module] ?? screen.module}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
