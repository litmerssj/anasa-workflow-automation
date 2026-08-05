function countWithState(issues, state) {
  return issues.filter((issue) => issue.state === state).length;
}

function aggregateDescription(milestone, issues) {
  const done = countWithState(issues, "Done");
  const qaRequest = countWithState(issues, "QA Request");
  const qaInProgress = countWithState(issues, "QA In Progress");
  const developmentIncomplete = issues.length - done - qaRequest - qaInProgress;
  const lines = [
    `<!-- final-review:${milestone.id} -->`,
    `- 내부 QA 완료 ${done}건`,
    `- QA 요청 ${qaRequest}건`,
    `- QA 진행 중 ${qaInProgress}건`,
    `- 개발 미완료 ${developmentIncomplete}건`,
  ];
  if (!milestone.targetDate) {
    lines.push("- 미팅 일정이 정해지기 전에는 자동 고객 발행하지 않습니다.");
  }
  lines.push("", "## 대상 티켓");
  for (const issue of issues) {
    lines.push(`- [${issue.identifier} · ${issue.title}](${issue.url}) — ${issue.state}`);
  }
  return lines.join("\n");
}

export function aggregatePlan(milestone, issues, existingAggregates, asOf = new Date()) {
  const scheduled = Boolean(milestone.targetDate);
  if (scheduled) {
    const threshold = new Date(`${milestone.targetDate}T09:00:00+09:00`).getTime() - 2 * 86_400_000;
    if (asOf.getTime() < threshold) return { operation: "none" };
  }
  if (issues.length === 0) return { operation: "none" };

  const title = scheduled
    ? `[최종검수] ${milestone.name} — ${milestone.targetDate} 미팅`
    : "[최종검수] 일정 미정";
  const description = aggregateDescription(milestone, issues);
  const existing = existingAggregates.find((issue) =>
    issue.projectMilestone?.id === milestone.id ||
    (!scheduled && issue.title === "[최종검수] 일정 미정"),
  );
  if (!existing) return { operation: "create", title, description };
  if (existing.title === title && existing.description === description) return { operation: "none" };
  return { operation: "update", issueId: existing.id, title, description };
}

export async function runFinalReview({
  client = createLinearClient(),
  env = process.env,
  asOf = new Date(),
  dryRun = false,
} = {}) {
  const teamId = env.LINEAR_TEAM_ID || requireEnv("LINEAR_TEAM_ID");
  const yoonaId = env.QA_YOONA_ID || requireEnv("QA_YOONA_ID");
  const all = await client.listIssues({ state: { type: { nin: ["canceled"] } } });
  const aggregates = all.filter((issue) => issue.labels.nodes.some((label) => label.name === "최종검수"));
  const candidates = all.filter((issue) =>
    !aggregates.includes(issue) && issue.projectMilestone,
  );
  const groups = new Map();
  for (const issue of candidates) {
    const milestone = issue.projectMilestone ?? { id: "unscheduled", name: "일정 미정", targetDate: null };
    if (!groups.has(milestone.id)) {
      groups.set(milestone.id, {
        milestone,
        projectId: issue.project?.id ?? null,
        issues: [],
      });
    }
    groups.get(milestone.id).issues.push({
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      state: issue.state.name,
    });
  }

  const result = { groups: groups.size, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const [finalLabelId] = groups.size > 0 && !dryRun
    ? await client.ensureLabels(["최종검수"])
    : ["dry-run-final-review"];
  for (const { milestone, projectId, issues } of groups.values()) {
    try {
      const plan = aggregatePlan(milestone, issues, aggregates, asOf);
      if (plan.operation === "none") {
        result.unchanged += 1;
        continue;
      }
      if (plan.operation === "create") {
        if (!dryRun) {
          await client.createIssue({
            teamId,
            title: plan.title,
            description: plan.description,
            assigneeId: yoonaId,
            labelIds: [finalLabelId],
            ...(milestone.id !== "unscheduled"
              ? { projectId, projectMilestoneId: milestone.id }
              : {}),
          });
        }
        result.created += 1;
      } else {
        if (!dryRun) {
          await client.updateIssue(plan.issueId, {
            title: plan.title,
            description: plan.description,
            assigneeId: yoonaId,
          });
        }
        result.updated += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error(`[최종검수] ${milestone.name} 실패:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
import { createLinearClient } from "./lib/linear.mjs";
import { requireEnv } from "./lib/env.mjs";
