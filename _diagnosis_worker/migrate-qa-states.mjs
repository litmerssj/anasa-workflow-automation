#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createLinearClient } from "./lib/linear.mjs";
import { requireEnv } from "./lib/env.mjs";

const QA_STATE_DEFINITIONS = [
  {
    name: "QA Request",
    type: "started",
    color: "#F2C94C",
    description: "개발 완료 후 QA 담당자 배정 완료 또는 대기, QA 미착수",
    position: 2.25,
  },
  {
    name: "QA In Progress",
    type: "started",
    color: "#5E6AD2",
    description: "QA 담당자가 실제 내부 검수를 수행 중",
    position: 2.5,
  },
];

const LEGACY_QA_LABELS = new Set(["QA대기", "QA중"]);

export function buildQaStateMigrationPlan(issues, stateIds) {
  if (!stateIds["QA Request"]) throw new Error("QA Request 상태를 확인할 수 없습니다");
  if (!stateIds["QA In Progress"]) throw new Error("QA In Progress 상태를 확인할 수 없습니다");
  const plan = [];
  for (const issue of issues) {
    const names = new Set(issue.labels.nodes.map((label) => label.name));
    const state = names.has("QA중")
      ? "QA In Progress"
      : names.has("QA대기")
        ? "QA Request"
        : null;
    if (!state) continue;
    const labelIds = issue.labels.nodes
      .filter((label) => !LEGACY_QA_LABELS.has(label.name))
      .map((label) => label.id)
      .filter(Boolean);
    plan.push({
      issueId: issue.id,
      identifier: issue.identifier,
      state,
      input: { stateId: stateIds[state], labelIds },
    });
  }
  return plan;
}

export async function ensureQaStates({ client, teamId, createMissing = false }) {
  const existing = await client.listWorkflowStates(teamId);
  const byName = new Map(existing.map((state) => [state.name, state]));
  for (const definition of QA_STATE_DEFINITIONS) {
    const state = byName.get(definition.name);
    if (state) {
      if (state.type !== "started") {
        throw new Error(`${definition.name} 상태 유형이 started가 아닙니다`);
      }
      continue;
    }
    if (!createMissing) throw new Error(`${definition.name} 상태가 없습니다`);
    const created = await client.createWorkflowState({ teamId, ...definition });
    byName.set(created.name, created);
  }
  return Object.fromEntries(
    QA_STATE_DEFINITIONS.map(({ name }) => [name, byName.get(name)?.id]),
  );
}

export async function runQaStateMigration({
  client = createLinearClient(),
  teamId = process.env.LINEAR_TEAM_ID || requireEnv("LINEAR_TEAM_ID"),
  dryRun = false,
  createMissing = false,
} = {}) {
  const stateIds = await ensureQaStates({ client, teamId, createMissing });
  const issues = await client.listIssues({
    team: { id: { eq: teamId } },
    state: { type: { nin: ["completed", "canceled"] } },
  });
  const manifest = buildQaStateMigrationPlan(issues, stateIds);
  const result = { scanned: issues.length, changed: manifest.length, failed: 0, manifest };
  if (dryRun) return result;
  for (const item of manifest) {
    try {
      await client.updateIssue(item.issueId, item.input);
    } catch (error) {
      result.failed += 1;
      console.error(
        `[QA 상태 이관] ${item.identifier} 실패:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const client = createLinearClient();
  const teamId = process.env.LINEAR_TEAM_ID || requireEnv("LINEAR_TEAM_ID");
  if (process.argv.includes("--provision")) {
    const states = await ensureQaStates({ client, teamId, createMissing: true });
    console.log(JSON.stringify({ provisioned: states }, null, 2));
  } else {
    const result = await runQaStateMigration({
      client,
      teamId,
      dryRun: process.argv.includes("--dry"),
      createMissing: false,
    });
    for (const item of result.manifest) {
      console.log(`${item.identifier}: ${item.state}`);
    }
    console.log(JSON.stringify({
      scanned: result.scanned,
      changed: result.changed,
      failed: result.failed,
    }));
  }
}
