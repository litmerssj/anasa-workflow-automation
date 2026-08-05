import { INTERNAL_INFO_RE } from "./lib/heuristics.mjs";
import { createLinearClient } from "./lib/linear.mjs";
import { codexGenerate } from "./lib/codex.mjs";

const SENSITIVE_RE = /(추가\s*비용|가격|견적|계약|확약|납기.{0,12}(약속|확정|보장)|일정.{0,8}(약속|확정)|손해|책임|보안\s*(사고|취약점)|인증\s*우회)/i;

export function questionDecision(value) {
  const reasons = [];
  const question = typeof value?.question === "string" ? value.question.trim() : "";
  const detail = typeof value?.detail === "string" ? value.detail.trim() : "";
  const options = Array.isArray(value?.options)
    ? value.options.map((option) => String(option).trim()).filter(Boolean)
    : [];
  if (!question) reasons.push("질문이 비어 있음");
  if (!detail) reasons.push("배경 설명이 비어 있음");
  if (question.length + detail.length > 800) reasons.push("본문 800자 초과");
  if (options.length < 2 || options.length > 5) reasons.push("선택지는 2~5개여야 함");
  if (new Set(options).size !== options.length) reasons.push("선택지가 중복됨");
  if (options.some((option) => option.length > 120)) reasons.push("선택지 120자 초과");
  const fullText = `${question}\n${detail}\n${options.join("\n")}`;
  if (INTERNAL_INFO_RE.test(fullText)) reasons.push("내부 기술 식별자 포함");
  if (SENSITIVE_RE.test(fullText)) reasons.push("민감한 계약·일정·책임·보안 판단 포함");
  return { action: reasons.length === 0 ? "publish" : "review", reasons };
}

export function publishedQuestionBody(value) {
  return [
    "**[질의]**",
    value.question.trim(),
    "",
    value.detail.trim(),
    `선택지(JSON): ${JSON.stringify(value.options.map((option) => String(option).trim()))}`,
  ].join("\n");
}

export function parseQuestionJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("질의 JSON 객체를 찾을 수 없습니다");
  const value = JSON.parse(cleaned.slice(start, end + 1));
  return {
    question: String(value.question ?? "").trim(),
    detail: String(value.detail ?? "").trim(),
    options: Array.isArray(value.options) ? value.options.map((option) => String(option).trim()) : [],
  };
}

function latestSource(issue) {
  return [...issue.comments.nodes]
    .reverse()
    .find((comment) => String(comment.body).startsWith("**[개발자질문]**")) ?? null;
}

function alreadyProcessed(issue, source) {
  const tags = ["**[질의]**", "**[질의초안]**"];
  const outputs = issue.comments.nodes.filter((comment) => tags.some((tag) => String(comment.body).startsWith(tag)));
  if (outputs.length === 0) return false;
  if (!source) return true;
  return outputs.some((comment) => String(comment.createdAt ?? "") >= String(source.createdAt ?? ""));
}

async function labelIdsAfter(client, issue, { add = [], remove = [] }) {
  const removeSet = new Set(remove);
  const keep = issue.labels.nodes
    .filter((label) => !removeSet.has(label.name))
    .map((label) => label.id)
    .filter(Boolean);
  const added = await client.ensureLabels(add);
  return [...new Set([...keep, ...added])];
}

const PROMPT = `고객사 실무자에게 보낼 질문을 JSON 하나로만 작성하세요.
스키마: {"question":"한 문장", "detail":"업무 배경 1~3문장", "options":["선택지1","선택지2"]}
규칙: 선택지는 상호배타적인 2~5개, 내부 코드·경로·DB·SP·API·사람 이름 금지, 가격·계약·일정 확약·책임·보안 판단 금지. 모르는 사실을 만들지 마세요.`;

export async function runQuestions({
  client = createLinearClient(),
  generate = codexGenerate,
  dryRun = false,
} = {}) {
  const issues = await client.listIssues({ state: { type: { nin: ["completed", "canceled"] } } });
  const targets = issues.filter((issue) => {
    const names = issue.labels.nodes.map((label) => label.name);
    if (!names.includes("고객질의필요") && !names.includes("고객확인")) return false;
    const source = latestSource(issue);
    return !alreadyProcessed(issue, source);
  });
  const result = { scanned: targets.length, published: 0, review: 0, failed: 0 };

  for (const issue of targets) {
    try {
      const source = latestSource(issue);
      const sourceText = source?.body ?? `${issue.title}\n${issue.description ?? ""}`;
      const generated = parseQuestionJson(await generate(`${PROMPT}\n\n입력:\n${sourceText.slice(0, 3000)}`));
      const decision = questionDecision(generated);
      if (decision.action === "publish") {
        if (!dryRun) {
          const labelIds = await labelIdsAfter(client, issue, {
            add: ["질의이력", "고객확인"],
            remove: ["고객질의필요", "질의검토필요"],
          });
          await client.createComment(issue.id, publishedQuestionBody(generated));
          await client.updateIssue(issue.id, { labelIds });
        }
        result.published += 1;
      } else {
        const body = [
          "**[질의초안]**",
          generated.question,
          "",
          generated.detail,
          generated.options.length ? `선택지(JSON): ${JSON.stringify(generated.options)}` : "",
          "",
          `검토사유: ${decision.reasons.join(", ")}`,
        ].filter(Boolean).join("\n");
        if (!dryRun) {
          const labelIds = await labelIdsAfter(client, issue, {
            add: ["질의검토필요"],
            remove: ["고객질의필요"],
          });
          await client.createComment(issue.id, body);
          await client.updateIssue(issue.id, { labelIds });
        }
        result.review += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error(`[질의] ${issue.identifier} 실패:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
