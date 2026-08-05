# LOG Backlog Three-Way Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 활성 LOG 개발 티켓 126건을 Ian, Jin, Roger에게 42건씩 고정 계획하고, 활성 사용자는 즉시 배정하며 Roger는 수락 직후 예약분 전체를 받게 한다.

**Architecture:** `log-backlog.mjs`가 대상 선정과 결정적 42/42/42 계획만 담당한다. 일회성 `plan-log-backlog.mjs`가 계획을 Linear 워크플로 코멘트에 기록하고, 기존 `assign.mjs`가 활성 멤버에게 계획된 담당자를 적용한다. Linear 코멘트가 원장이므로 로컬 별도 티켓 DB는 만들지 않는다.

**Tech Stack:** Node.js ESM, Node test runner, Linear GraphQL API, 기존 `workflowEventBody`/`parseWorkflowEvent` 계약

---

### Task 1: 결정적 LOG 대상 선정과 42/42/42 계획

**Files:**
- Create: `log-backlog.mjs`
- Create: `test/log-backlog.test.mjs`

- [ ] **Step 1: 대상 제외와 Tier 3 선배정을 재현하는 실패 테스트 작성**

```js
test("LOG backlog plan excludes customer lanes and balances all developers", async () => {
  const { planLogBacklog } = await import("../log-backlog.mjs");
  const issues = [
    issue(6, ["tier-2"]), issue(1, ["tier-2"]), issue(4, ["tier-2"]),
    issue(2, ["tier-3"]), issue(5, []), issue(3, ["tier-1"]),
    issue(7, ["고객확인"]), { ...issue(8, ["tier-2"]), title: "[BAS] 제외" },
  ];
  const plan = planLogBacklog(issues, {
    seniorId: "ian", developerIds: ["ian", "jin", "roger"], expectedTotal: 6,
  });
  assert.deepEqual(Object.fromEntries(["ian", "jin", "roger"].map((id) => [id, plan.filter((x) => x.developerId === id).length])), {
    ian: 2, jin: 2, roger: 2,
  });
  assert.equal(plan.find((x) => x.issue.identifier === "ANA-2").developerId, "ian");
});
```

- [ ] **Step 2: 테스트가 모듈 부재로 실패하는지 확인**

Run: `node --test test/log-backlog.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `log-backlog.mjs`.

- [ ] **Step 3: 최소 계획 함수 구현**

```js
const EXCLUDED = new Set(["고객확인", "QA대기", "QA중", "최종검수대기", "검수요청"]);

export function isLogBacklogTarget(issue) {
  const labels = issue.labels.nodes.map((label) => label.name);
  return /^\[LOG\]/i.test(issue.title) && !labels.some((name) => EXCLUDED.has(name));
}

export function planLogBacklog(issues, { seniorId, developerIds, expectedTotal }) {
  const issueNumber = (issue) => Number(String(issue.identifier).split("-").at(-1));
  const targets = issues.filter(isLogBacklogTarget).sort((a, b) => issueNumber(a) - issueNumber(b));
  if (targets.length !== expectedTotal || expectedTotal % developerIds.length !== 0) {
    throw new Error(`LOG 대상 수 불일치: expected=${expectedTotal}, actual=${targets.length}`);
  }
  const perDeveloper = expectedTotal / developerIds.length;
  const tier3 = targets.filter((issue) => issue.labels.nodes.some((label) => label.name === "tier-3"));
  if (tier3.length > perDeveloper) throw new Error("Tier 3가 Ian 할당량을 초과합니다");
  const rest = targets.filter((issue) => !tier3.includes(issue));
  const buckets = new Map(developerIds.map((id) => [id, []]));
  buckets.get(seniorId).push(...tier3);
  for (const developerId of developerIds) {
    while (buckets.get(developerId).length < perDeveloper) buckets.get(developerId).push(rest.shift());
  }
  return developerIds.flatMap((developerId) => buckets.get(developerId).map((issue) => ({ issue, developerId })));
}
```

- [ ] **Step 4: 단일 테스트 통과 확인**

Run: `node --test test/log-backlog.test.mjs`

Expected: PASS, 1 test.

### Task 2: 고정 계획 우선 적용과 활성 풀 분리

**Files:**
- Modify: `assign.mjs`
- Modify: `test/assign.test.mjs`

- [ ] **Step 1: 활성 Jin 계획은 적용하고 비활성 Roger 계획은 기다리는 실패 테스트 작성**

```js
test("planned LOG tickets apply to active developers without waiting for inactive invitees", async () => {
  const issues = [plannedIssue("jin-ticket", "jin"), plannedIssue("roger-ticket", "roger")];
  const updates = [];
  const result = await runAssignment({
    client: fakeClient({ issues, activeMembers: ["ian", "jin", "yoona"], updates }),
    env: fullPoolEnv,
    now: new Date("2026-08-04T07:00:00Z"),
  });
  assert.deepEqual(updates, [{ issueId: "jin-ticket", input: { assigneeId: "jin" } }]);
  assert.equal(result.devAssigned, 1);
  assert.equal(result.waiting, 1);
});
```

- [ ] **Step 2: 기존 전역 멤버 게이트 때문에 실패하는지 확인**

Run: `node --test test/assign.test.mjs`

Expected: FAIL because `runAssignment` returns before assigning Jin.

- [ ] **Step 3: 계획 이벤트 추출과 활성 풀별 적용 구현**

```js
function plannedDeveloperId(issue) {
  return issue.comments.nodes
    .map((comment) => ({ comment, event: parseWorkflowEvent(comment) }))
    .filter(({ event }) => event?.event === "log_backlog_planned")
    .sort((a, b) => String(a.comment.createdAt ?? "").localeCompare(String(b.comment.createdAt ?? "")))
    .at(-1)?.event?.developerId ?? null;
}

const memberIds = new Set((await client.listMembers()).map((member) => member.id));
const activeDevelopers = pools.developers.filter((member) => member.id && memberIds.has(member.id));
const activeQa = pools.qa.filter((member) => member.id && memberIds.has(member.id));

for (const issue of issues.filter((candidate) => plannedDeveloperId(candidate))) {
  const developerId = plannedDeveloperId(issue);
  if (!memberIds.has(developerId)) { result.waiting += 1; continue; }
  if (issue.assignee?.id === developerId) continue;
  await client.updateIssue(issue.id, { assigneeId: developerId });
  await client.createComment(issue.id, workflowEventBody({
    event: "dev_assigned", issueId: issue.id, developerId, at: now.toISOString(),
  }));
  result.devAssigned += 1;
}
```

일반 `devTargets`에서는 `plannedDeveloperId(issue)`가 있는 티켓을 제외하고 `activeDevelopers`를 사용한다. QA는 `activeQa`를 사용해 미수락 인턴이 개발 배정을 막지 않게 한다.

- [ ] **Step 4: 배정 테스트 전체 통과 확인**

Run: `node --test test/assign.test.mjs`

Expected: 모든 배정 테스트 PASS.

### Task 3: 일회성 계획 기록기

**Files:**
- Create: `plan-log-backlog.mjs`
- Modify: `package.json`
- Create: `test/plan-log-backlog.test.mjs`

- [ ] **Step 1: dry-run이 42/42/42 manifest만 만들고 Linear를 변경하지 않는 실패 테스트 작성**

```js
test("LOG planner dry-run returns a 42/42/42 manifest without comments", async () => {
  const comments = [];
  const result = await runLogBacklogPlan({
    client: fakeClient(logIssues(126), comments), env: poolEnv, dryRun: true,
  });
  assert.deepEqual(result.counts, { ian: 42, jin: 42, roger: 42 });
  assert.equal(comments.length, 0);
});

test("LOG planner does not duplicate an existing batch plan", async () => {
  const comments = [];
  const issues = logIssues(126);
  issues[0].comments.nodes.push(workflowComment({
    event: "log_backlog_planned", batch: "2026-08-04-log-126-v1",
    issueId: issues[0].id, developerId: "ian",
  }));
  await runLogBacklogPlan({ client: fakeClient(issues, comments), env: poolEnv });
  assert.equal(comments.some((call) => call.issueId === issues[0].id), false);
});
```

- [ ] **Step 2: 기록기 부재로 실패하는지 확인**

Run: `node --test test/plan-log-backlog.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: batch 코멘트 기록 구현**

```js
export async function runLogBacklogPlan({ client, env, dryRun = false }) {
  const issues = await client.listIssues({ state: { type: { nin: ["completed", "canceled"] } } });
  const plan = planLogBacklog(issues, {
    seniorId: env.DEV_SEUNGHYUN_ID,
    developerIds: [env.DEV_SEUNGHYUN_ID, env.DEV_VN_A_ID, env.DEV_VN_B_ID],
    expectedTotal: 126,
  });
  if (!dryRun) {
    for (const { issue, developerId } of plan) {
      const exists = issue.comments.nodes.some((comment) => {
        const event = parseWorkflowEvent(comment);
        return event?.event === "log_backlog_planned" && event.batch === "2026-08-04-log-126-v1";
      });
      if (exists) continue;
      await client.createComment(issue.id, workflowEventBody({
        event: "log_backlog_planned", batch: "2026-08-04-log-126-v1",
        issueId: issue.id, developerId,
      }));
    }
  }
  return { planned: plan.length, counts: countByDeveloper(plan) };
}
```

`package.json`에 `"plan:log": "node plan-log-backlog.mjs"`와 `"plan:log:dry": "node plan-log-backlog.mjs --dry"`를 추가한다.

- [ ] **Step 4: 기록기 테스트 통과 확인**

Run: `node --test test/plan-log-backlog.test.mjs`

Expected: PASS.

메인 진입점은 기존 `lib/lock.mjs`의 `acquireWorkerLock()`으로 `.worker.lock`을 잡은 상태에서 계획 기록과 `runAssignment()`를 연속 실행해 5분 워커와의 경합을 막는다.

### Task 4: 운영 계획 및 실제 배정 적용

**Files:**
- Modify externally: Linear issue comments and assignees
- Read: `_customer_board/.env.local`

- [ ] **Step 1: 전체 회귀 테스트 실행**

Run: `npm test`

Expected: 기존 44개와 새 테스트가 모두 PASS.

- [ ] **Step 2: dry-run manifest 확인**

Run: `npm run plan:log:dry`

Expected: `planned: 126`, Ian/Jin/Roger 각각 42.

- [ ] **Step 3: 동일 프로세스 락 안에서 고정 계획 기록 후 활성 담당자 적용**

Run: `npm run plan:log`

Expected: Ian 42건과 Jin 42건이 실제 담당자로 설정되고 Roger 42건은 waiting으로 남는다.

- [ ] **Step 4: 워커 재시작**

Run: `launchctl kickstart -k gui/501/com.litmers.anasa-linear-worker`

Expected: `launchctl print`에서 `state = running`.

- [ ] **Step 5: 운영 API로 정확한 결과 재집계**

활성 LOG 대상에서 계획 이벤트 기준 Ian 42, Jin 42, Roger 42를 확인한다. 실제 담당자는 Ian 42, Jin 42이며 Roger는 수락 전 0이어야 한다. 고객확인 4건은 세 계획 어디에도 없어야 한다.

### Task 5: 운영 문서와 최종 회귀

**Files:**
- Modify: `README.md`
- Test: `test/*.test.mjs`

- [ ] **Step 1: README의 전원 활성화 게이트 설명을 역할별 활성 풀 및 LOG 고정 예약 정책으로 교체**

```md
개발·QA 풀은 각각 활성 Linear 멤버만 사용한다. 미수락 사용자는 자신의 고정 예약분만 대기하며 다른 활성 사용자의 배정을 막지 않는다. 2026-08-04 LOG 백로그 126건은 Ian/Jin/Roger에게 42건씩 고정 계획됐고 기존 WIP 3건 제한의 예외다.
```

- [ ] **Step 2: 워커와 고객보드 전체 검증**

Run: `npm test` in `_diagnosis_worker`

Run: `npm test && npm run build` in `_customer_board`

Expected: 모든 테스트 PASS, Next.js production build PASS.

- [ ] **Step 3: 저장소 부재 기록**

이 디렉터리는 Git 저장소가 아니므로 커밋은 만들 수 없다. 변경 파일, 테스트 결과, Linear 재집계 결과를 최종 인계에 명시한다.
