// LOG 백로그 → Linear draft 티켓 일괄 이관 (1회성 마이그레이션 스크립트)
// 원칙: 티켓은 자동분류-미확정으로 생성 → 개발자 큐 비노출, 감사셀 확정 후 배정.
import { readFileSync } from "node:fs";
import { requireEnv } from "./lib/env.mjs";

const API = "https://api.linear.app/graphql";
const TEAM_ANASA = "f4837910-b73f-4908-b4d8-f25ad31c2f61";
const PROJECT = "f6b4cc99-9d5b-4b75-bf68-8b28ce1930d0"; // 아나사 안정화 6주
const MILESTONE_W2 = "52d319e0-4676-4633-a949-ae14df49d75a"; // W2 물류 미팅

// 기수정 가능성 높은 계열 — 확정 시 우선 재검증 힌트
const STALE_HINT = {
  "LOG-03d": "fe#382(총계행/SUM제거)에서 처리됐을 가능성 — 확정 전 화면 재확인",
  "LOG-10d": "fe#382(총계행/SUM제거)에서 처리됐을 가능성 — 확정 전 화면 재확인",
  "LOG-17g": "fe#382(총계행/SUM제거)에서 처리됐을 가능성 — 확정 전 화면 재확인",
  "LOG-GP31a": "fe#379(LOG GP 숨김)에서 처리됐을 가능성 — 메뉴 노출 여부 재확인",
  "LOG-GP32a": "fe#379(LOG GP 숨김)에서 처리됐을 가능성 — 메뉴 노출 여부 재확인",
  "LOG-GP33a": "fe#379(LOG GP 숨김)에서 처리됐을 가능성 — 메뉴 노출 여부 재확인",
};

async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: requireEnv("LINEAR_API_KEY") },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const labelIds = {};
{
  const data = await gql(`query { issueLabels(first: 200) { nodes { id name } } }`);
  for (const l of data.issueLabels.nodes) labelIds[l.name] = l.id;
}

const items = JSON.parse(readFileSync("/tmp/log_migration_candidates.json", "utf-8"));
const dryRun = process.argv.includes("--dry");
let created = 0, failed = [];

for (const it of items) {
  // 제목 분해: "LOG-02b · LOG_CLS_002M · 마감일자 YYYYMMDD 표기"
  const parts = it.title.split("·").map((s) => s.trim());
  const screen = (parts[1] || "").replace(/_/g, "-").replace(/^LOG-/, "LOG-");
  const summary = parts.slice(2).join(" · ") || parts[1] || it.cat;
  const title = `[LOG] ${screen && screen.startsWith("LOG") ? screen : "공통"} · ${summary} (${it.id}${it.status === "PARTIAL" ? "·잔여" : ""})`;

  const desc = [
    `> ⚠️ **노션 검수 백로그(2026-07-22 스냅샷) 일괄 이관** — 이후 머지가 다수 있었으므로 **착수 전 현재상태 재검증 필수**. 백로그 상태: ${it.status === "PARTIAL" ? "🟡부분완료(잔여작업)" : "🔴미착수"}`,
    STALE_HINT[it.id] ? `> 🔎 ${STALE_HINT[it.id]}` : "",
    "",
    `**분류**: ${it.cat || "-"}`,
    `**요청내용**: ${it.req || "-"}`,
    `**근거(07-22 감사)**: ${it.evidence || "-"}`,
    `**조치안(초안)**: ${it.plan || "-"}`,
    `**담당영역 추정**: ${it.owner || "-"}`,
  ].filter(Boolean).join("\n");

  if (dryRun) { console.log("[dry]", title); created++; continue; }
  try {
    const data = await gql(
      `mutation ($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { identifier } }
      }`,
      { input: {
          title: title.slice(0, 255), description: desc, teamId: TEAM_ANASA,
          projectId: PROJECT, projectMilestoneId: MILESTONE_W2,
          labelIds: [labelIds["노션검수"], labelIds["자동분류-미확정"]],
      } },
    );
    console.log(data.issueCreate.issue.identifier, "←", it.id);
    created++;
    await new Promise((r) => setTimeout(r, 250)); // rate limit 여유
  } catch (e) {
    failed.push([it.id, String(e.message).slice(0, 120)]);
  }
}
console.log(`\n생성 ${created} / 실패 ${failed.length}`);
for (const [id, err] of failed) console.log("실패:", id, err);
