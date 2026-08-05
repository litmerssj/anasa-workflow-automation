#!/usr/bin/env node
import { createLinearClient } from "./lib/linear.mjs";
import { classificationSummary, classifyIssue } from "./classify.mjs";

const client = createLinearClient();
const issues = await client.listIssues({
  labels: { name: { eq: "자동분류-미확정" } },
  state: { type: { nin: ["completed", "canceled"] } },
});
console.log(JSON.stringify(classificationSummary(issues), null, 2));

const tier3 = issues
  .map((issue) => ({ issue, result: classifyIssue(issue) }))
  .filter(({ result }) => result.tier === "tier-3");
for (const { issue, result } of tier3) {
  console.log(`${issue.identifier}\t${result.reasons.join("|")}\t${issue.title}`);
}
