import assert from "node:assert/strict";
import test from "node:test";

async function assignmentModule() {
  try {
    return await import("../lib/qa-assignment.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

const env = {
  QA_INTERN_A_ID: "intern-a",
  QA_INTERN_B_ID: "intern-b",
  QA_YOONA_ID: "yoona",
  DEV_SEUNGHYUN_ID: "seunghyun",
};

function requestIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "ANA-1",
    state: { name: "QA Request", type: "started" },
    assignee: { id: "dev-1", name: "Developer" },
    labels: { nodes: [{ name: "tier-2" }] },
    comments: { nodes: [{
      body: '**[워크플로]** {"event":"dev_assigned","developerId":"dev-1","at":"2026-08-05T00:00:00Z"}',
      createdAt: "2026-08-05T00:00:00Z",
    }] },
    ...overrides,
  };
}

function depsFor(issue = requestIssue()) {
  const updates: unknown[] = [];
  const comments: string[] = [];
  return {
    updates,
    comments,
    deps: {
      getIssue: async () => issue,
      listQaWork: async () => [issue],
      listActiveMembers: async () => [
        { id: "intern-a" }, { id: "intern-b" }, { id: "yoona" }, { id: "seunghyun" },
      ],
      updateIssue: async (input: unknown) => updates.push(input),
      createComment: async (_issueId: string, body: string) => comments.push(body),
    },
  };
}

test("QA Request assigns a QA owner immediately without changing state", async () => {
  const module = await assignmentModule();
  assert.equal(typeof module.assignQaRequest, "function");
  const { deps, updates, comments } = depsFor();

  const result = await module.assignQaRequest(
    "issue-1",
    deps,
    env,
    new Date("2026-08-05T01:00:00Z"),
  );

  assert.deepEqual(result, {
    status: "assigned",
    qaId: "intern-a",
    developerId: "dev-1",
  });
  assert.deepEqual(updates, [{ issueId: "issue-1", assigneeId: "intern-a" }]);
  assert.equal(comments.length, 1);
  assert.match(comments[0], /"event":"qa_assigned"/);
});

test("webhook retries do not reassign the current QA owner", async () => {
  const { assignQaRequest } = await assignmentModule();
  const issue = requestIssue({
    assignee: { id: "intern-a", name: "Intern A" },
    comments: { nodes: [
      {
        body: '**[워크플로]** {"event":"dev_assigned","developerId":"dev-1","at":"2026-08-05T00:00:00Z"}',
        createdAt: "2026-08-05T00:00:00Z",
      },
      {
        body: '**[워크플로]** {"event":"qa_assigned","developerId":"dev-1","qaId":"intern-a","at":"2026-08-05T01:00:00Z"}',
        createdAt: "2026-08-05T01:00:00Z",
      },
    ] },
  });
  const { deps, updates, comments } = depsFor(issue);

  assert.deepEqual(await assignQaRequest("issue-1", deps, env), {
    status: "already_assigned",
    qaId: "intern-a",
    developerId: "dev-1",
  });
  assert.deepEqual(updates, []);
  assert.deepEqual(comments, []);
});

test("QA assignment fails closed outside QA Request or without a valid pool", async () => {
  const { assignQaRequest } = await assignmentModule();
  const inProgress = depsFor(requestIssue({ state: { name: "In Progress", type: "started" } }));
  assert.deepEqual(await assignQaRequest("issue-1", inProgress.deps, env), { status: "ignored" });

  const missingPool = depsFor();
  assert.deepEqual(await assignQaRequest("issue-1", missingPool.deps, {}), { status: "waiting" });
  assert.deepEqual(missingPool.updates, []);
});

test("Tier 3 never assigns Seunghyun to his own QA", async () => {
  const { assignQaRequest } = await assignmentModule();
  const issue = requestIssue({
    labels: { nodes: [{ name: "tier-3" }] },
    assignee: { id: "seunghyun", name: "Seunghyun" },
    comments: { nodes: [{
      body: '**[워크플로]** {"event":"dev_assigned","developerId":"seunghyun","at":"2026-08-05T00:00:00Z"}',
      createdAt: "2026-08-05T00:00:00Z",
    }] },
  });
  const { deps, updates } = depsFor(issue);

  const result = await assignQaRequest("issue-1", deps, env);
  assert.equal(result.qaId, "yoona");
  assert.deepEqual(updates, [{ issueId: "issue-1", assigneeId: "yoona" }]);
});
