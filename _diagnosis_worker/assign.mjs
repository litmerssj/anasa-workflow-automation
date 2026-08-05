function rotateCandidates(candidates, lastAssignedId) {
  if (!lastAssignedId) return candidates;
  const index = candidates.findIndex((member) => member.id === lastAssignedId);
  if (index < 0) return candidates;
  return [...candidates.slice(index + 1), ...candidates.slice(0, index + 1)];
}

function leastLoaded(candidates, load, lastAssignedId) {
  if (candidates.length === 0) return null;
  const minimum = Math.min(...candidates.map((member) => load[member.id] ?? 0));
  const tiedIds = new Set(
    candidates.filter((member) => (load[member.id] ?? 0) === minimum).map((member) => member.id),
  );
  return rotateCandidates(candidates, lastAssignedId).find((member) => tiedIds.has(member.id)) ?? null;
}

export function selectDeveloper(issue, pool, load, lastAssignedId = null) {
  if (issue.tier === "tier-3") {
    const senior = pool.find((member) => member.role === "senior") ?? null;
    return senior && (load[senior.id] ?? 0) < 3 ? senior : null;
  }
  const available = pool.filter((member) => (load[member.id] ?? 0) < 3);
  return leastLoaded(available, load, lastAssignedId);
}

export function selectQa(issue, pool, load, lastAssignedId = null) {
  return selectQaMember(issue, pool, load, lastAssignedId);
}

const DEV_WIP_EXCLUDED_LABELS = new Set(["고객확인"]);
const DEV_WIP_EXCLUDED_STATES = new Set(["QA Request", "QA In Progress"]);
const QA_WIP_STATES = new Set(["QA Request", "QA In Progress"]);

function labelNames(issue) {
  return issue.labels.nodes.map((label) => label.name);
}

function tierOf(issue) {
  return labelNames(issue).find((name) => /^tier-[123]$/.test(name)) ?? null;
}

function isDevWipExcluded(issue) {
  return DEV_WIP_EXCLUDED_STATES.has(issue.state?.name) ||
    labelNames(issue).some((name) => DEV_WIP_EXCLUDED_LABELS.has(name));
}

function loadFor(issues, ids, predicate) {
  const load = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const issue of issues) {
    const id = issue.assignee?.id;
    if (id in load && predicate(issue)) load[id] += 1;
  }
  return load;
}

function latestAssignmentId(issues, eventName, idField) {
  const events = issues
    .flatMap((issue) => issue.comments.nodes)
    .map((comment) => ({ comment, event: parseWorkflowEvent(comment) }))
    .filter(({ event }) => event?.event === eventName && typeof event[idField] === "string")
    .sort((a, b) => String(a.comment.createdAt ?? "").localeCompare(String(b.comment.createdAt ?? "")));
  return events.at(-1)?.event?.[idField] ?? null;
}

function latestEvent(issue, eventName) {
  return issue.comments.nodes
    .map((comment) => ({ comment, event: parseWorkflowEvent(comment) }))
    .filter(({ event }) => event?.event === eventName)
    .sort((a, b) =>
      String(a.comment.createdAt ?? a.event?.at ?? "")
        .localeCompare(String(b.comment.createdAt ?? b.event?.at ?? "")),
    )
    .at(-1) ?? null;
}

function hasCurrentQaAssignment(issue) {
  const latestQa = latestEvent(issue, "qa_assigned");
  if (!latestQa || typeof latestQa.event?.qaId !== "string") return false;
  const latestCompletion = latestEvent(issue, "dev_completed");
  const qaTime = String(latestQa.comment.createdAt ?? latestQa.event.at ?? "");
  const completionTime = String(
    latestCompletion?.comment.createdAt ?? latestCompletion?.event?.at ?? "",
  );
  return issue.assignee?.id === latestQa.event.qaId && qaTime >= completionTime;
}

function plannedDeveloperId(issue) {
  const events = issue.comments.nodes
    .map((comment) => ({ comment, event: parseWorkflowEvent(comment) }))
    .filter(({ event }) =>
      event?.event === "log_backlog_planned" && typeof event.developerId === "string",
    )
    .sort((a, b) =>
      String(a.comment.createdAt ?? "").localeCompare(String(b.comment.createdAt ?? "")),
    );
  return events.at(-1)?.event.developerId ?? null;
}

function poolFromEnv(env) {
  const developers = [
    { id: env.DEV_SEUNGHYUN_ID, role: "senior" },
    { id: env.DEV_VN_A_ID, role: "developer" },
    { id: env.DEV_VN_B_ID, role: "developer" },
    { id: env.DEV_VN_C_ID, role: "developer" }, // Brian, Lê Nam Bình (brian@litmers.com)
  ];
  const qa = [
    { id: env.QA_INTERN_A_ID, role: "intern", cap: 3 },
    { id: env.QA_INTERN_B_ID, role: "intern", cap: 3 },
    { id: env.QA_YOONA_ID, role: "lead", cap: 2 },
    { id: env.DEV_SEUNGHYUN_ID, role: "senior", cap: 2 },
  ];
  return { developers, qa };
}

export async function runAssignment({
  client = createLinearClient(),
  env = process.env,
  dryRun = false,
  now = new Date(),
} = {}) {
  const issues = await client.listIssues({ state: { type: { nin: ["completed", "canceled"] } } });
  const result = { scanned: issues.length, devAssigned: 0, qaAssigned: 0, waiting: 0, failed: 0 };
  const pools = poolFromEnv(env);
  const requiredIds = [...pools.developers, ...pools.qa].map((member) => member.id);
  if (requiredIds.some((id) => !id)) {
    result.waiting = issues.filter((issue) => !issue.assignee && tierOf(issue)).length +
      issues.filter((issue) => issue.state?.name === "QA Request" && !hasCurrentQaAssignment(issue)).length;
    console.error("[배정] 개발자/QA 풀 환경 변수가 모두 설정되지 않아 배정을 대기합니다");
    return result;
  }
  const memberIds = new Set((await client.listMembers()).map((member) => member.id));
  const activeDevelopers = pools.developers.filter((member) => memberIds.has(member.id));
  const activeQa = pools.qa.filter((member) => memberIds.has(member.id));
  const configuredDeveloperIds = new Set(pools.developers.map((member) => member.id));

  const plannedTargets = issues.filter((issue) => {
    const names = labelNames(issue);
    return plannedDeveloperId(issue) && !isDevWipExcluded(issue);
  });
  for (const issue of plannedTargets) {
    const developerId = plannedDeveloperId(issue);
    if (!configuredDeveloperIds.has(developerId)) {
      result.failed += 1;
      console.error(`[고정개발배정] ${issue.identifier} 실패: 계획 담당자가 개발자 풀에 없습니다`);
      continue;
    }
    if (!memberIds.has(developerId)) {
      result.waiting += 1;
      continue;
    }
    try {
      const needsAssignment = issue.assignee?.id !== developerId;
      const needsEvent = latestDeveloperId(issue.comments.nodes) !== developerId;
      if (!dryRun && needsAssignment) await client.updateIssue(issue.id, { assigneeId: developerId });
      if (!dryRun && needsEvent) {
        await client.createComment(issue.id, workflowEventBody({
          event: "dev_assigned",
          issueId: issue.id,
          developerId,
          at: now.toISOString(),
        }));
      }
      issue.assignee = { ...(issue.assignee ?? {}), id: developerId };
      if (needsAssignment) result.devAssigned += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[고정개발배정] ${issue.identifier} 실패:`, error instanceof Error ? error.message : error);
    }
  }

  const developerIds = activeDevelopers.map((member) => member.id);
  const qaIds = activeQa.map((member) => member.id);
  const devLoad = loadFor(
    issues,
    developerIds,
    (issue) => !isDevWipExcluded(issue),
  );
  const qaLoad = loadFor(issues, qaIds, (issue) => QA_WIP_STATES.has(issue.state?.name));
  let lastDeveloperId = latestAssignmentId(issues, "dev_assigned", "developerId");
  let lastQaId = latestAssignmentId(issues, "qa_assigned", "qaId");

  const devTargets = issues.filter((issue) => {
    const names = labelNames(issue);
    return !plannedDeveloperId(issue) && !issue.assignee && tierOf(issue) &&
      !isDevWipExcluded(issue);
  });
  for (const issue of devTargets) {
    try {
      const member = selectDeveloper({ tier: tierOf(issue) }, activeDevelopers, devLoad, lastDeveloperId);
      if (!member) {
        result.waiting += 1;
        continue;
      }
      if (!dryRun) {
        await client.updateIssue(issue.id, { assigneeId: member.id });
        await client.createComment(issue.id, workflowEventBody({
          event: "dev_assigned",
          issueId: issue.id,
          developerId: member.id,
          at: now.toISOString(),
        }));
      }
      devLoad[member.id] += 1;
      lastDeveloperId = member.id;
      result.devAssigned += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[개발배정] ${issue.identifier} 실패:`, error instanceof Error ? error.message : error);
    }
  }

  const qaTargets = issues.filter(
    (issue) => issue.state?.name === "QA Request" && !hasCurrentQaAssignment(issue),
  );
  for (const issue of qaTargets) {
    try {
      const developerId = latestDeveloperId(issue.comments.nodes);
      const member = selectQa(
        { tier: tierOf(issue), developerId },
        activeQa,
        qaLoad,
        lastQaId,
      );
      if (!member) {
        result.waiting += 1;
        continue;
      }
      if (!dryRun) {
        await client.updateIssue(issue.id, { assigneeId: member.id });
        await client.createComment(issue.id, workflowEventBody({
          event: "qa_assigned",
          issueId: issue.id,
          developerId,
          qaId: member.id,
          at: now.toISOString(),
        }));
      }
      qaLoad[member.id] += 1;
      lastQaId = member.id;
      result.qaAssigned += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[QA배정] ${issue.identifier} 실패:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
import { createLinearClient } from "./lib/linear.mjs";
import {
  latestDeveloperId,
  parseWorkflowEvent,
  selectQaMember,
  workflowEventBody,
} from "../_customer_board/lib/workflow-core.mjs";
