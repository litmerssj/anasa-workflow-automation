// Jin의 LOG 백로그 중 패킹(PKG)+재고(STK)+미납(UND) 화면군을 Brian에게 이관.
// 비꼬임 원칙: (1) log_backlog_planned=Brian 이벤트를 먼저 append(latest-wins) → 자동배정 워커가 되돌리지 못함,
//             (2) 그 다음 assignee=Brian 설정. 순서 중요.
// 기본은 DRY-RUN. 실제 반영은 `node scripts/split_jin_to_brian.mjs --apply`.
import { createLinearClient } from "../../_diagnosis_worker/lib/linear.mjs";
import { workflowEventBody, parseWorkflowEvent } from "../lib/workflow-core.mjs";

const APPLY = process.argv.includes("--apply");
const BRIAN = "a36c010e-f7da-42b2-8af9-bde3375788b3"; // brian@litmers.com
const JIN = "3cb11d64-2f43-4b48-839d-c91bc7179231";   // jin@litmers.com (DEV_VN_A)
const BATCH = "2026-08-04-brian-split-v1";
const TARGETS = [
  "ANA-60","ANA-61","ANA-62","ANA-63","ANA-64","ANA-65", // PKG
  "ANA-66","ANA-67","ANA-68","ANA-69","ANA-70","ANA-71","ANA-72","ANA-73","ANA-74", // STK
  "ANA-76","ANA-77","ANA-78","ANA-79","ANA-80", // UND
];

const client = createLinearClient();

function plannedDev(issue) {
  const evts = issue.comments.nodes
    .map((c) => ({ c, e: parseWorkflowEvent(c) }))
    .filter(({ e }) => e?.event === "log_backlog_planned" && typeof e.developerId === "string")
    .sort((a, b) => String(a.c.createdAt).localeCompare(String(b.c.createdAt)));
  return evts.at(-1)?.e.developerId ?? null;
}

// 대상 이슈 로드 (identifier로 조회)
const all = await client.listIssues({ state: { type: { nin: ["completed", "canceled"] } } });
const byId = new Map(all.map((i) => [i.identifier, i]));

console.log(APPLY ? "=== APPLY 모드 ===" : "=== DRY-RUN (미반영) ===");
let ok = 0, warn = 0;
for (const ident of TARGETS) {
  const issue = byId.get(ident);
  if (!issue) { console.log(`${ident}\t❌ 이슈 없음(완료/취소?)`); warn++; continue; }
  const curAssignee = issue.assignee?.id ?? null;
  const curPlanned = plannedDev(issue);
  const assigneeStr = curAssignee === JIN ? "Jin" : curAssignee === BRIAN ? "Brian" : (curAssignee ?? "없음");
  const plannedStr = curPlanned === JIN ? "Jin" : curPlanned === BRIAN ? "Brian" : (curPlanned ?? "없음");
  const alreadyDone = curAssignee === BRIAN && curPlanned === BRIAN;
  if (alreadyDone) { console.log(`${ident}\t✔ 이미 Brian (스킵)`); ok++; continue; }
  if (curAssignee !== JIN) { console.log(`${ident}\t⚠ 현재 담당=${assigneeStr}, planned=${plannedStr} — Jin 아님, 건너뜀`); warn++; continue; }

  console.log(`${ident}\t${issue.title.slice(0,42)}\t담당:${assigneeStr}→Brian, planned:${plannedStr}→Brian`);
  if (APPLY) {
    // (1) planned=Brian 먼저
    await client.createComment(issue.id, workflowEventBody({
      event: "log_backlog_planned", batch: BATCH, issueId: issue.id, developerId: BRIAN,
    }));
    // (2) assignee=Brian
    await client.updateIssue(issue.id, { assigneeId: BRIAN });
    ok++;
  } else {
    ok++;
  }
}
console.log(`\n대상 ${TARGETS.length}건 → 처리예정/완료 ${ok}, 경고 ${warn}. Brian=${BRIAN}`);
if (!APPLY) console.log("반영하려면: node scripts/split_jin_to_brian.mjs --apply");
