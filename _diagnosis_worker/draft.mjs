// 질의 초안 패스 — 발행은 감사셀만 한다.
// 대상: `고객확인` 라벨 + 아직 발행된 `**[질의]**`도, 초안 `**[질의초안]**`도 없는 이슈.
// 산출: `**[질의초안]**` 코멘트. 고객 보드는 `**[질의]**`만 파싱하므로 초안은 고객에게 절대 노출되지 않는다.
// 감사셀이 초안을 검토→(수정 후) /internal의 재질의 버튼 또는 수동으로 `**[질의]**` 발행.
import { issuesWithLabel, createComment } from "./lib/linear.mjs";
import { codexGenerate } from "./lib/codex.mjs";
import { INTERNAL_INFO_RE } from "./lib/heuristics.mjs";

const TEMPLATE_RULES = `당신은 ERP 검수 프로젝트에서 고객사(제조업체 실무자)에게 보낼 질문의 초안을 작성합니다.

절대 규칙:
1. 업무 언어만 사용 — 기술 용어(테이블·SP·API·백엔드·스키마·seed 등) 전면 금지. 고객은 개발자가 아닙니다.
2. 가능하면 닫힌 선택지로: 마지막 줄에 "선택지: A안, B안" 형식. 선택지가 자연스럽지 않은 열린 질문이면 선택지 줄을 생략.
3. 숫자·계산이 관련되면 실제 숫자 예시를 반드시 포함 (예: "협가 1,000원 × 조정률 95% = 950원").
4. 첫 줄 = 질문 요약 한 문장. 빈 줄. 이어서 배경 설명 2-3문장(고객이 맥락을 몰라도 이해되게).
5. 내부 사정(누가 뭘 놓쳤는지, 코드가 어떤 상태인지)은 절대 언급 금지.
6. 텍스트만 출력. 명령 실행 금지. 인사말·서명 없이 질문 본문만.`;

function checklistViolations(draft) {
  const violations = [];
  const m = draft.match(INTERNAL_INFO_RE);
  if (m) violations.push(`내부 기술용어 노출: "${m[0]}"`);
  if (draft.length < 30) violations.push("본문이 너무 짧음");
  if (draft.length > 1500) violations.push("본문이 너무 김(고객 피로)");
  return violations;
}

export async function runDrafting({ dryRun = false } = {}) {
  const issues = await issuesWithLabel("고객확인");
  const targets = issues.filter(
    (i) =>
      !i.comments.nodes.some(
        (c) => c.body.startsWith("**[질의초안]**") || c.body.startsWith("**[질의]**"),
      ),
  );
  console.log(`[질의초안] 대상 ${targets.length}건 (고객확인 전체 ${issues.length}건)`);

  for (const issue of targets) {
    const context = `제목: ${issue.title}\n내부 메모(참고용 — 고객에게 그대로 노출 금지):\n${(issue.description ?? "").slice(0, 1500)}`;

    let draft;
    let violations;
    try {
      draft = await codexGenerate(`${TEMPLATE_RULES}\n\n### 질문이 필요한 사안\n${context}`);
      violations = checklistViolations(draft);
      if (violations.length > 0) {
        // 1회 재생성 — 위반 사항을 피드백으로
        draft = await codexGenerate(
          `${TEMPLATE_RULES}\n\n### 질문이 필요한 사안\n${context}\n\n### 이전 초안의 문제(반드시 해소할 것)\n${violations.join("\n")}\n\n### 이전 초안\n${draft}`,
        );
        violations = checklistViolations(draft);
      }
    } catch (e) {
      console.log(`[질의초안] ${issue.identifier} codex 실패: ${e.message} — 스킵`);
      continue;
    }

    const hasOptions = /선택지:/.test(draft);
    const body = [
      "**[질의초안]** (워커 v1 생성 — 감사셀 검토·발행 전까지 고객에게 보이지 않음)",
      violations.length > 0 ? `\n⚠️ **체크리스트 위반 잔존(재생성 후에도): ${violations.join(" / ")}** — 수동 수정 필요` : "",
      `\n유형: ${hasOptions ? "닫힌 선택지(답변 시 자동 반영 가능)" : "자유 서술(답변 후 감사셀 해석 필요)"}`,
      "\n---\n",
      draft,
      "\n---",
      "\n발행 방법: 내부 변환 큐(/internal)의 재질의 버튼에 위 본문 붙여넣기 → `**[질의]**` 코멘트로 발행되며 고객 보드에 노출됨.",
    ]
      .filter(Boolean)
      .join("\n");

    if (dryRun) {
      console.log(`[질의초안·dry] ${issue.identifier}\n${body}\n---`);
    } else {
      await createComment(issue.id, body);
      console.log(`[질의초안] ${issue.identifier} 초안 첨부 완료 (위반 ${violations.length}건)`);
    }
  }
  return targets.length;
}
