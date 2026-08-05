const TIER3_SIGNALS = [
  { name: "SQL/저장 프로시저 변경", pattern: /\bSQL\b|저장\s*프로시저|stored\s+procedure|프로시저|\bALTER\b|CREATE\s+TABLE|DROP\s+TABLE/i },
  { name: "공유 DB 쓰기", pattern: /공유\s*(DB|데이터베이스).{0,20}(쓰기|변경|수정)|운영\s*(DB|데이터베이스).{0,20}(변경|수정)/i },
  { name: "일괄 데이터 변경", pattern: /일괄.{0,12}(데이터|재고|금액).{0,12}(변경|수정|삭제)|스키마.{0,12}(변경|마이그레이션)/i },
  { name: "인증·권한·보안 경계", pattern: /인증\s*우회|권한\s*경계|다른\s*고객.{0,12}(보이|노출)|보안\s*(취약점|사고)|소유권/i },
  { name: "되돌리기 어려운 쓰기", pattern: /복구\s*불가|롤백\s*불가|되돌리기\s*(어렵|불가)/i },
];

const TIER1_SIGNALS = [
  { name: "문구·명칭", pattern: /문구|오타|라벨|명칭|컬럼명|표기/ },
  { name: "레이아웃", pattern: /레이아웃|정렬|색상|간격|겹치|잘림|스크롤|테두리|행\s*높이|그리드\s*(크기|밀도)|셀\s*폭|모달\s*(크기|위치)/ },
  { name: "순수 표시", pattern: /아이콘|폰트|글꼴|버튼\s*(문구|색상|위치|크기)/ },
];

const TIER2_SIGNALS = [
  { name: "저장·등록 동작", pattern: /저장.{0,8}(안|않|실패|오류)|등록.{0,8}(안|않|실패|오류)/ },
  { name: "조회·검색", pattern: /조회|검색|필터|드롭다운|선택지|페이지네이션/ },
  { name: "데이터·업무 동작", pattern: /값이?\s*(다르|틀리)|데이터|금액|집계|계산|장바구니|다운로드|출력/ },
  { name: "클릭 동작", pattern: /클릭.{0,8}(안|않|실패)|버튼.{0,8}(안 눌|동작 안)/ },
];

function hits(signals, text) {
  return signals.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

export function classifyIssue(issue) {
  const text = `${issue.title ?? ""}\n${issue.description ?? ""}`;
  const tier3 = hits(TIER3_SIGNALS, text);
  if (tier3.length > 0) {
    return {
      tier: "tier-3",
      lowConfidence: false,
      blockAssignment: false,
      autoFix: false,
      reasons: tier3,
    };
  }
  const tier2 = hits(TIER2_SIGNALS, text);
  const tier1 = hits(TIER1_SIGNALS, text);
  if (tier2.length === 0 && tier1.length > 0) {
    return {
      tier: "tier-1",
      lowConfidence: false,
      blockAssignment: false,
      autoFix: false,
      reasons: tier1,
    };
  }
  return {
    tier: "tier-2",
    lowConfidence: tier2.length === 0,
    blockAssignment: false,
    autoFix: false,
    reasons: tier2.length > 0 ? tier2 : ["결정적 신호 부족"],
  };
}

export function classificationSummary(issues) {
  const summary = {
    total: issues.length,
    tiers: { "tier-1": 0, "tier-2": 0, "tier-3": 0 },
    lowConfidence: 0,
    reasons: {},
  };
  for (const issue of issues) {
    const result = classifyIssue(issue);
    summary.tiers[result.tier] += 1;
    if (result.lowConfidence) summary.lowConfidence += 1;
    for (const reason of result.reasons) {
      summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
    }
  }
  return summary;
}

const CLASSIFICATION_LABELS = new Set([
  "자동분류-미확정",
  "tier-1",
  "tier-2",
  "tier-3",
  "분류신뢰도-낮음",
]);

export async function runClassification({
  client = createLinearClient(),
  anasaTeamId = process.env.LINEAR_TEAM_ID || requireEnv("LINEAR_TEAM_ID"),
  coreTeamId = process.env.LINEAR_CORE_TEAM_ID || requireEnv("LINEAR_CORE_TEAM_ID"),
  dryRun = false,
  now = new Date(),
} = {}) {
  const issues = await client.listIssues({
    labels: { name: { eq: "자동분류-미확정" } },
    state: { type: { nin: ["completed", "canceled"] } },
  });
  const result = { scanned: issues.length, classified: 0, failed: 0 };

  for (const issue of issues) {
    try {
      const classification = classifyIssue(issue);
      const addNames = [classification.tier];
      if (classification.lowConfidence) addNames.push("분류신뢰도-낮음");
      if (dryRun) {
        console.log(`[분류·dry] ${issue.identifier} → ${classification.tier}${classification.lowConfidence ? " (저신뢰)" : ""}`);
      } else {
        const addIds = await client.ensureLabels(addNames);
        const keepIds = issue.labels.nodes
          .filter((label) => !CLASSIFICATION_LABELS.has(label.name))
          .map((label) => label.id)
          .filter(Boolean);
        const input = {
          teamId: classification.tier === "tier-3" ? coreTeamId : anasaTeamId,
          labelIds: [...new Set([...keepIds, ...addIds])],
        };
        await client.updateIssue(issue.id, input);
        await client.createComment(
          issue.id,
          workflowEventBody({
            event: "classified",
            issueId: issue.id,
            tier: classification.tier,
            lowConfidence: classification.lowConfidence,
            reasons: classification.reasons,
            at: now.toISOString(),
          }),
        );
      }
      result.classified += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[분류] ${issue.identifier} 실패:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
import { fileURLToPath } from "node:url";
import { createLinearClient } from "./lib/linear.mjs";
import { requireEnv } from "./lib/env.mjs";
import { workflowEventBody } from "../_customer_board/lib/workflow-core.mjs";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runClassification({ dryRun: process.argv.includes("--dry") });
  console.log(JSON.stringify(result));
}
