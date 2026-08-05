import assert from "node:assert/strict";
import test from "node:test";

import { createLinearClient } from "../lib/linear.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Linear client retries 429 and 5xx before returning data", async () => {
  const responses = [
    jsonResponse({ error: "busy" }, 500),
    jsonResponse({ error: "limited" }, 429),
    jsonResponse({ data: { viewer: { id: "user-1" } } }),
  ];
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async () => responses.shift(),
    sleep: async () => {},
  });
  assert.deepEqual(await client.request("query { viewer { id } }"), { viewer: { id: "user-1" } });
  assert.equal(responses.length, 0);
});

test("Linear client paginates workflow issues and includes assignment metadata", async () => {
  const pages = [
    {
      data: {
        issues: {
          pageInfo: { hasNextPage: true, endCursor: "next" },
          nodes: [{ id: "i-1", assignee: { id: "dev-1" }, team: { id: "anasa" } }],
        },
      },
    },
    {
      data: {
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ id: "i-2", projectMilestone: { targetDate: "2026-08-14" } }],
        },
      },
    },
  ];
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async () => jsonResponse(pages.shift()),
    sleep: async () => {},
  });
  const issues = await client.listIssues({ labels: { name: { eq: "자동분류-미확정" } } });
  assert.deepEqual(issues.map((issue) => issue.id), ["i-1", "i-2"]);
  assert.equal(issues[0].assignee.id, "dev-1");
  assert.equal(issues[1].projectMilestone.targetDate, "2026-08-14");
});

test("Linear client stops after the third retryable failure", async () => {
  let attempts = 0;
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ error: "busy" }, 503);
    },
    sleep: async () => {},
  });
  await assert.rejects(() => client.request("query { viewer { id } }"), /503/);
  assert.equal(attempts, 3);
});

test("Linear client creates missing workflow labels and returns all ids", async () => {
  const responses = [
    jsonResponse({ data: { issueLabels: { nodes: [{ id: "label-1", name: "tier-1" }] } } }),
    jsonResponse({ data: { issueLabelCreate: { success: true, issueLabel: { id: "label-2", name: "QA대기" } } } }),
  ];
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async () => responses.shift(),
    sleep: async () => {},
  });
  assert.deepEqual(await client.ensureLabels(["tier-1", "QA대기"]), ["label-1", "label-2"]);
});

test("Linear client updates issue assignment and team in one mutation", async () => {
  let sentBody;
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return jsonResponse({ data: { issueUpdate: { success: true } } });
    },
    sleep: async () => {},
  });
  await client.updateIssue("issue-1", { assigneeId: "dev-1", teamId: "anasa" });
  assert.deepEqual(sentBody.variables.input, { assigneeId: "dev-1", teamId: "anasa" });
});

test("Linear client lists active workspace members for pool validation", async () => {
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async () => jsonResponse({
      data: {
        users: {
          nodes: [
            { id: "u-1", name: "Active", email: "a@example.com", active: true },
            { id: "u-2", name: "Inactive", email: "i@example.com", active: false },
          ],
        },
      },
    }),
    sleep: async () => {},
  });
  assert.deepEqual((await client.listMembers()).map((member) => member.id), ["u-1"]);
});

test("Linear client creates a final-review issue with milestone and assignee", async () => {
  let sentBody;
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return jsonResponse({ data: { issueCreate: { success: true, issue: { id: "aggregate-1" } } } });
    },
    sleep: async () => {},
  });
  const issue = await client.createIssue({
    teamId: "anasa",
    title: "[최종검수] W2",
    description: "body",
    assigneeId: "yoona",
    projectMilestoneId: "ms-1",
    labelIds: ["final-label"],
  });
  assert.equal(issue.id, "aggregate-1");
  assert.equal(sentBody.variables.input.assigneeId, "yoona");
  assert.equal(sentBody.variables.input.projectMilestoneId, "ms-1");
});

test("Linear client lists and creates team workflow states", async () => {
  const sentBodies = [];
  const responses = [
    jsonResponse({ data: { team: { states: { nodes: [
      { id: "in-progress", name: "In Progress", type: "started", position: 2 },
    ] } } } }),
    jsonResponse({ data: { workflowStateCreate: {
      success: true,
      workflowState: { id: "qa-request", name: "QA Request", type: "started", position: 2.25 },
    } } }),
  ];
  const client = createLinearClient({
    token: "test-token",
    fetchImpl: async (_url, init) => {
      sentBodies.push(JSON.parse(init.body));
      return responses.shift();
    },
    sleep: async () => {},
  });

  assert.deepEqual((await client.listWorkflowStates("anasa")).map((state) => state.name), [
    "In Progress",
  ]);
  const created = await client.createWorkflowState({
    teamId: "anasa",
    name: "QA Request",
    type: "started",
    color: "#F2C94C",
    position: 2.25,
  });
  assert.equal(created.id, "qa-request");
  assert.equal(sentBodies[1].variables.input.name, "QA Request");
});
