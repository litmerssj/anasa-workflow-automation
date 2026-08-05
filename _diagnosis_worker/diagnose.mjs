// 진단 패스 — "발품은 자동, 판정은 사람".
// 대상: `자동분류-미확정` 라벨 + 아직 `**[진단]**` 코멘트 없는 이슈.
// 산출: 재현 결과·SSOT 대조·티어 추정(참고용)을 담은 진단 리포트 코멘트.
// 안전선: 라벨·상태를 절대 바꾸지 않는다. 개발자 큐 진입은 감사셀 확정 후에만 일어난다.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { WORKER_DIR } from "./lib/env.mjs";
import { issuesWithLabel, createComment, uploadPng } from "./lib/linear.mjs";
import { reproduce } from "./lib/repro.mjs";
import { codexGenerate } from "./lib/codex.mjs";
import { estimateTier, SCREEN_CODE_RE, SP_POLICY_NOTE, SP_SIGNAL_RE } from "./lib/heuristics.mjs";

const ROUTE_MAP_PATH = path.join(WORKER_DIR, "code_to_route.json");
const DB_COLUMNS_PATH = "/tmp/db_columns.json";

function findRoute(issueText, code) {
  const direct = issueText.match(/(\/d\/[a-z0-9-]+)/);
  if (direct) return { route: direct[1], source: "티켓 본문" };
  if (code && existsSync(ROUTE_MAP_PATH)) {
    const map = JSON.parse(readFileSync(ROUTE_MAP_PATH, "utf-8"));
    const entry = map[code];
    if (entry && !entry.ambiguous) return { route: entry.route, source: "정적 매핑" };
    if (entry?.ambiguous) return { route: null, source: `매핑 모호(${entry.all_routes.length}개 후보)` };
  }
  return { route: null, source: "매핑 없음" };
}

function ssotLabelDump(code) {
  if (!code || !existsSync(DB_COLUMNS_PATH)) return null;
  const db = JSON.parse(readFileSync(DB_COLUMNS_PATH, "utf-8"));
  const prefix = code.replace(/-/g, "_");
  const alt = code; // 하이픈 표기 테이블도 존재
  const rows = [];
  for (const [table, cols] of Object.entries(db)) {
    if (!table.startsWith(prefix) && !table.startsWith(alt)) continue;
    for (const c of cols) {
      if (c.v && c.dn) rows.push(`${table}.${c.f} = "${c.dn}"`);
    }
  }
  return rows.length ? rows : null;
}

export function shouldUploadEvidence({ dryRun, repro }) {
  return !dryRun && Boolean(repro?.ok && repro.screenshot);
}

// 우선순위: 감사셀 확정이 임박한 순 — W2 물류(차기 스프린트) → WEB(스코프 판정에 진단 필요) → W3 → W4 → W5 → 기타
function milestonePriority(issue) {
  const ms = issue.projectMilestone?.name ?? "";
  if (ms.startsWith("W2")) return 0;
  if (ms.startsWith("WEB")) return 1;
  if (ms.startsWith("W3")) return 2;
  if (ms.startsWith("W4")) return 3;
  if (ms.startsWith("W5")) return 4;
  return 5;
}

export async function runDiagnosis({ dryRun = false } = {}) {
  const issues = await issuesWithLabel("자동분류-미확정");
  let targets = issues.filter(
    (i) => !i.comments.nodes.some((c) => c.body.startsWith("**[진단]**")),
  );
  targets.sort(
    (a, b) =>
      milestonePriority(a) - milestonePriority(b) ||
      Number(a.identifier.split("-")[1]) - Number(b.identifier.split("-")[1]),
  );
  const cap = Number(process.env.MAX_PER_PASS || 0);
  if (cap > 0 && targets.length > cap) {
    console.log(`[진단] MAX_PER_PASS=${cap} — ${targets.length}건 중 상위 ${cap}건만 이번 패스에서 처리`);
    targets = targets.slice(0, cap);
  }
  console.log(`[진단] 대상 ${targets.length}건 (미확정 전체 ${issues.length}건)`);

  for (const issue of targets) {
    const text = `${issue.title}\n${issue.description ?? ""}`;
    const code = text.match(SCREEN_CODE_RE)?.[1]?.replace(/_/g, "-") ?? null; // 라우트맵 키는 하이픈 표기
    const { route, source: routeSource } = findRoute(text, code);

    // 1) 라이브 재현 (조회 전용)
    let repro = null;
    let screenshotUrl = null;
    if (route) {
      try {
        repro = await reproduce(route);
        if (shouldUploadEvidence({ dryRun, repro })) {
          screenshotUrl = await uploadPng(repro.screenshot, `diag-${issue.identifier}.png`);
        }
      } catch (e) {
        repro = { ok: false, reason: String(e.message ?? e) };
      }
    }

    // 2) SSOT 라벨 대조 (라벨성 증상일 때 유의미 — 항상 첨부하되 크기 제한)
    const ssot = ssotLabelDump(code);

    // 3) 티어 추정 (참고용)
    const tierEst = estimateTier(text, repro);

    // 4) codex로 근원 가설·확인 절차 작성 (사실만 주고 서술을 위임 — 사실 조작 여지 차단)
    const facts = [
      `제목: ${issue.title}`,
      `본문:\n${(issue.description ?? "").slice(0, 1500)}`,
      `화면코드: ${code ?? "추출 실패"}`,
      `라우트: ${route ?? "없음"} (출처: ${routeSource})`,
      repro
        ? repro.ok
          ? `재현 결과: 접속 성공 / 그리드 렌더 ${repro.gridVisible ? "됨" : "안 됨"} / 콘솔에러 ${repro.consoleErrors.length}건 ${JSON.stringify(repro.consoleErrors.slice(0, 3))} / HTTP 오류 ${JSON.stringify(repro.httpErrors.slice(0, 5))}`
          : `재현 실패: ${repro.reason}`
        : `재현 미수행 (${routeSource})`,
      ssot ? `DB(SSOT) 현재 라벨:\n${ssot.slice(0, 30).join("\n")}` : "DB 라벨 대조: 해당 없음/데이터 없음",
      `티어 휴리스틱: ${tierEst.tier} (신호: ${tierEst.why.join(", ") || "없음"})`,
      SP_SIGNAL_RE.test(text) ? SP_POLICY_NOTE : "",
    ].filter(Boolean).join("\n\n");

    let analysis;
    try {
      analysis = await codexGenerate(
        `당신은 ERP 검수 티켓의 진단 보조자입니다. 아래 실측 사실만 근거로 한국어 진단 메모를 작성하세요.
규칙: 실측에 없는 사실을 만들지 마세요. 확인 안 된 것은 "미확인"으로 표기. 명령 실행 금지, 텍스트만 출력.
형식: ## 근원 가설 (가능성 순 최대 3개, 각 1-2문장) / ## 다음 확인 절차 (구체적 단계 최대 4개)

${facts}`,
      );
    } catch (e) {
      analysis = `_(codex 분석 실패: ${e.message} — 아래 실측 데이터만 참고)_`;
    }

    const report = [
      "**[진단]** 자동 진단 리포트 (워커 v1 — 판정 아님, 감사셀 확정 필요)",
      "",
      `- 화면코드: ${code ?? "❓추출 실패"} / 라우트: ${route ?? "미확인"} (${routeSource})`,
      `- 재현: ${repro ? (repro.ok ? `성공 — 그리드 ${repro.gridVisible ? "렌더됨" : "미렌더"}, 콘솔에러 ${repro.consoleErrors.length}건, HTTP오류 ${repro.httpErrors.length}건` : `실패 — ${repro.reason}`) : "미수행"}`,
      `- **티어 추정(참고용): ${tierEst.tier}** — 신호: ${tierEst.why.join(", ") || "없음"}`,
      screenshotUrl ? `\n![재현 스크린샷](${screenshotUrl})` : "",
      "",
      analysis,
      "",
      ssot ? `<details><summary>DB(SSOT) 현재 라벨 덤프</summary>\n\n${ssot.slice(0, 40).join("\n")}\n</details>` : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (dryRun) {
      console.log(`[진단·dry] ${issue.identifier}\n${report}\n---`);
    } else {
      await createComment(issue.id, report);
      console.log(`[진단] ${issue.identifier} 리포트 첨부 완료`);
    }
  }
  return targets.length;
}
