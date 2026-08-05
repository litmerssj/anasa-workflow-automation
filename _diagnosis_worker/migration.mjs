#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createLinearClient } from "./lib/linear.mjs";
import { requireEnv } from "./lib/env.mjs";

function labelNames(issue) {
  return issue.labels.nodes.map((label) => label.name);
}

export function migrationInput(issue, { anasaTeamId, coreTeamId }) {
  const input = {};
  if (String(issue.title ?? "").startsWith("[WEB]")) {
    input.title = issue.title.replace(/^\[WEB\]/, "[ORD]");
  }
  const labels = labelNames(issue);
  const customerIntake = labels.includes("고객보드");
  const tier3 = labels.includes("tier-3");
  if (customerIntake && !tier3 && issue.team?.id !== anasaTeamId) input.teamId = anasaTeamId;
  if (tier3 && issue.team?.id !== coreTeamId) input.teamId = coreTeamId;
  return input;
}

export async function runMigration({
  client = createLinearClient(),
  anasaTeamId = process.env.LINEAR_TEAM_ID || requireEnv("LINEAR_TEAM_ID"),
  coreTeamId = process.env.LINEAR_CORE_TEAM_ID || requireEnv("LINEAR_CORE_TEAM_ID"),
  dryRun = false,
} = {}) {
  const issues = await client.listIssues({ state: { type: { nin: ["completed", "canceled"] } } });
  const result = { scanned: issues.length, changed: 0, failed: 0, manifest: [] };
  for (const issue of issues) {
    const input = migrationInput(issue, { anasaTeamId, coreTeamId });
    if (Object.keys(input).length === 0) continue;
    result.manifest.push({ identifier: issue.identifier, input });
    try {
      if (!dryRun) await client.updateIssue(issue.id, input);
      result.changed += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[이관] ${issue.identifier} 실패:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runMigration({ dryRun: process.argv.includes("--dry") });
  for (const item of result.manifest) console.log(`${item.identifier}: ${JSON.stringify(item.input)}`);
  console.log(JSON.stringify({ scanned: result.scanned, changed: result.changed, failed: result.failed }));
}
