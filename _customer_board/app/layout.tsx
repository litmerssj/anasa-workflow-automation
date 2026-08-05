import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { listIssuesByLabels } from "@/lib/linear";
import { customerQueryLaneOf } from "@/lib/board-logic";
import "./globals.css";

export const metadata: Metadata = {
  title: "아나사 ERP 검수",
  description: "아나사 ERP 검수 진행 · 질의 · 검수 보드",
};

// 배지가 매 요청 실시간이어야 하므로 전 라우트 동적 렌더 (원장=Linear, 캐시 없음 원칙과 동일)
export const dynamic = "force-dynamic";

/** 내부 변환 큐 처리 대기 배지 — 고객 회신(회신완료) + 검수 반려(라우팅 대기).
 * 내부 페이지의 두 목록과 같은 판정을 쓴다. 실패 시 배지만 조용히 생략(내비는 항상 뜬다). */
async function InternalQueueBadge() {
  try {
    if (!process.env.LINEAR_API_KEY) return null;
    const byLabel = await listIssuesByLabels(["질의이력", "검수반려"]);
    const pending =
      byLabel["질의이력"].filter((i) => customerQueryLaneOf(i) === "회신완료").length +
      byLabel["검수반려"].length;
    if (pending === 0) return null;
    return (
      <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[var(--red)] text-white text-[10px] leading-none font-medium">
        {pending}
      </span>
    );
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <nav className="flex gap-4 mb-6 text-xs text-[var(--sub)]">
            <Link href="/" className="hover:text-[var(--ink)]">
              고객 보드
            </Link>
            <Link href="/viewer" className="hover:text-[var(--ink)]">
              레퍼런스 뷰어
            </Link>
            <Link href="/internal" className="hover:text-[var(--ink)] inline-flex items-center">
              내부 변환 큐
              <Suspense fallback={null}>
                <InternalQueueBadge />
              </Suspense>
            </Link>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
