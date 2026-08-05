const EXCLUDED_LABELS = new Set([
  "고객확인",
  "QA대기",
  "QA중",
  "최종검수대기",
  "검수요청",
]);
const EXCLUDED_STATES = new Set(["QA Request", "QA In Progress", "Done"]);

function labelNames(issue) {
  return issue.labels.nodes.map((label) => label.name);
}

function issueNumber(issue) {
  const value = Number(String(issue.identifier).split("-").at(-1));
  if (!Number.isFinite(value)) throw new Error(`이슈 번호 파싱 실패: ${issue.identifier}`);
  return value;
}

export function isLogBacklogTarget(issue) {
  const labels = labelNames(issue);
  return /^\[LOG\]/i.test(issue.title) &&
    !EXCLUDED_STATES.has(issue.state?.name) &&
    !labels.some((name) => EXCLUDED_LABELS.has(name));
}

export function planLogBacklog(issues, {
  seniorId,
  developerIds,
  expectedTotal,
}) {
  if (!seniorId || !developerIds.includes(seniorId)) {
    throw new Error("Ian 개발자 ID가 분할 풀에 없습니다");
  }
  if (new Set(developerIds).size !== developerIds.length || developerIds.some((id) => !id)) {
    throw new Error("개발자 3명의 ID가 모두 고유하게 설정되어야 합니다");
  }
  const targets = issues
    .filter(isLogBacklogTarget)
    .sort((a, b) => issueNumber(a) - issueNumber(b));
  if (targets.length !== expectedTotal) {
    throw new Error(`LOG 대상 수 불일치: expected=${expectedTotal}, actual=${targets.length}`);
  }
  if (expectedTotal % developerIds.length !== 0) {
    throw new Error(`LOG 대상 ${expectedTotal}건을 ${developerIds.length}명에게 동일 분할할 수 없습니다`);
  }

  const perDeveloper = expectedTotal / developerIds.length;
  const tier3 = targets.filter((issue) => labelNames(issue).includes("tier-3"));
  if (tier3.length > perDeveloper) throw new Error("Tier 3가 Ian 할당량을 초과합니다");
  const tier3Ids = new Set(tier3.map((issue) => issue.id));
  const rest = targets.filter((issue) => !tier3Ids.has(issue.id));
  const buckets = new Map(developerIds.map((id) => [id, []]));
  buckets.get(seniorId).push(...tier3);

  for (const developerId of developerIds) {
    while (buckets.get(developerId).length < perDeveloper) {
      buckets.get(developerId).push(rest.shift());
    }
  }

  return developerIds.flatMap((developerId) =>
    buckets.get(developerId).map((issue) => ({ issue, developerId })),
  );
}
