import assert from "node:assert/strict";
import test from "node:test";

async function assignment() {
  try {
    return await import("../assign.mjs");
  } catch {
    return {};
  }
}

const developers = [
  { id: "seunghyun", role: "senior" },
  { id: "vn-a", role: "developer" },
  { id: "vn-b", role: "developer" },
];

const fullPoolEnv = {
  DEV_SEUNGHYUN_ID: "seunghyun",
  DEV_VN_A_ID: "vn-a",
  DEV_VN_B_ID: "vn-b",
  DEV_VN_C_ID: "vn-c",
  QA_INTERN_A_ID: "intern-a",
  QA_INTERN_B_ID: "intern-b",
  QA_YOONA_ID: "yoona",
};

function plannedIssue(id, developerId) {
  return {
    id,
    identifier: id === "jin-ticket" ? "ANA-20" : "ANA-21",
    title: `[LOG] ${id}`,
    state: { type: "backlog" },
    team: { id: "anasa" },
    assignee: null,
    labels: { nodes: [{ id: "tier2", name: "tier-2" }] },
    comments: { nodes: [{
      body: `**[워크플로]** {"event":"log_backlog_planned","batch":"2026-08-04-log-126-v1","issueId":"${id}","developerId":"${developerId}","fingerprint":"plan:${id}"}`,
      createdAt: "2026-08-04T07:00:00Z",
    }] },
  };
}

test("tier 1 and 2 select the least-loaded developer under WIP three", async () => {
  const { selectDeveloper } = await assignment();
  assert.equal(typeof selectDeveloper, "function");
  assert.equal(
    selectDeveloper(
      { tier: "tier-2" },
      developers,
      { seunghyun: 2, "vn-a": 3, "vn-b": 1 },
      "vn-a",
    ).id,
    "vn-b",
  );
});

test("tier 3 is assigned only to the senior developer", async () => {
  const { selectDeveloper } = await assignment();
  assert.equal(
    selectDeveloper({ tier: "tier-3" }, developers, { seunghyun: 2, "vn-a": 0, "vn-b": 0 }).id,
    "seunghyun",
  );
  assert.equal(
    selectDeveloper({ tier: "tier-3" }, developers, { seunghyun: 3, "vn-a": 0, "vn-b": 0 }),
    null,
  );
});

test("equal developer load rotates after the last assignment", async () => {
  const { selectDeveloper } = await assignment();
  const load = { seunghyun: 1, "vn-a": 1, "vn-b": 1 };
  assert.equal(selectDeveloper({ tier: "tier-2" }, developers, load, "seunghyun").id, "vn-a");
  assert.equal(selectDeveloper({ tier: "tier-2" }, developers, load, "vn-a").id, "vn-b");
});

test("QA prioritizes interns and prevents Seunghyun from checking his own ticket", async () => {
  const { selectQa } = await assignment();
  const qaPool = [
    { id: "intern-a", role: "intern", cap: 3 },
    { id: "intern-b", role: "intern", cap: 3 },
    { id: "yoona", role: "lead", cap: 2 },
    { id: "seunghyun", role: "senior", cap: 2 },
  ];
  assert.equal(
    selectQa({ tier: "tier-2", developerId: "vn-a" }, qaPool, {
      "intern-a": 2, "intern-b": 1, yoona: 0, seunghyun: 0,
    }).id,
    "intern-b",
  );
  assert.equal(
    selectQa({ tier: "tier-3", developerId: "seunghyun" }, qaPool, {
      "intern-a": 0, "intern-b": 0, yoona: 1, seunghyun: 0,
    }).id,
    "yoona",
  );
});

test("assignment pass assigns one developer ticket and one QA ticket on the same issues", async () => {
  const { runAssignment } = await assignment();
  const issues = [
    {
      id: "dev-ticket",
      identifier: "ANA-10",
      state: { type: "backlog" },
      team: { id: "anasa" },
      assignee: null,
      labels: { nodes: [{ id: "tier2", name: "tier-2" }] },
      comments: { nodes: [] },
    },
    {
      id: "qa-ticket",
      identifier: "ANA-11",
      state: { name: "QA Request", type: "started" },
      team: { id: "anasa" },
      assignee: { id: "vn-a" },
      labels: { nodes: [{ id: "tier2", name: "tier-2" }] },
      comments: { nodes: [{
        body: '**[워크플로]** {"event":"dev_assigned","developerId":"vn-a","fingerprint":"dev:qa-ticket"}',
        createdAt: "2026-08-04T00:00:00Z",
      }] },
    },
  ];
  const updates = [];
  const comments = [];
  const client = {
    listIssues: async () => issues,
    listMembers: async () => [
      { id: "seunghyun" }, { id: "vn-a" }, { id: "vn-b" },
      { id: "intern-a" }, { id: "intern-b" }, { id: "yoona" },
    ],
    updateIssue: async (issueId, input) => updates.push({ issueId, input }),
    createComment: async (issueId, body) => comments.push({ issueId, body }),
  };
  const result = await runAssignment({
    client,
    env: fullPoolEnv,
    now: new Date("2026-08-04T01:00:00Z"),
  });
  assert.deepEqual(result, { scanned: 2, devAssigned: 1, qaAssigned: 1, waiting: 0, failed: 0 });
  assert.deepEqual(updates.find((call) => call.issueId === "dev-ticket").input, { assigneeId: "vn-b" });
  assert.deepEqual(updates.find((call) => call.issueId === "qa-ticket").input, { assigneeId: "intern-a" });
  assert.equal(comments.length, 2);
});

test("an already assigned QA Request is not reassigned on the next pass", async () => {
  const { runAssignment } = await assignment();
  const issue = {
    id: "qa-ticket",
    identifier: "ANA-11",
    state: { name: "QA Request", type: "started" },
    team: { id: "anasa" },
    assignee: { id: "intern-a" },
    labels: { nodes: [{ id: "tier2", name: "tier-2" }] },
    comments: { nodes: [
      {
        body: '**[워크플로]** {"event":"dev_assigned","developerId":"vn-a","fingerprint":"dev:qa-ticket"}',
        createdAt: "2026-08-04T00:00:00Z",
      },
      {
        body: '**[워크플로]** {"event":"qa_assigned","developerId":"vn-a","qaId":"intern-a","fingerprint":"qa:qa-ticket"}',
        createdAt: "2026-08-04T01:00:00Z",
      },
    ] },
  };
  const updates = [];
  const comments = [];
  const result = await runAssignment({
    client: {
      listIssues: async () => [issue],
      listMembers: async () => [
        { id: "seunghyun" }, { id: "vn-a" }, { id: "vn-b" }, { id: "vn-c" },
        { id: "intern-a" }, { id: "intern-b" }, { id: "yoona" },
      ],
      updateIssue: async (issueId, input) => updates.push({ issueId, input }),
      createComment: async (issueId, body) => comments.push({ issueId, body }),
    },
    env: fullPoolEnv,
  });

  assert.deepEqual(result, { scanned: 1, devAssigned: 0, qaAssigned: 0, waiting: 0, failed: 0 });
  assert.deepEqual(updates, []);
  assert.deepEqual(comments, []);
});

test("planned LOG tickets apply to active developers without waiting for inactive invitees", async () => {
  const { runAssignment } = await assignment();
  const issues = [plannedIssue("jin-ticket", "vn-a"), plannedIssue("roger-ticket", "vn-b")];
  const updates = [];
  const comments = [];
  const client = {
    listIssues: async () => issues,
    listMembers: async () => [{ id: "seunghyun" }, { id: "vn-a" }, { id: "yoona" }],
    ensureLabels: async () => [],
    updateIssue: async (issueId, input) => updates.push({ issueId, input }),
    createComment: async (issueId, body) => comments.push({ issueId, body }),
  };

  const result = await runAssignment({
    client,
    env: fullPoolEnv,
    now: new Date("2026-08-04T07:10:00Z"),
  });

  assert.deepEqual(updates, [{ issueId: "jin-ticket", input: { assigneeId: "vn-a" } }]);
  assert.equal(result.devAssigned, 1);
  assert.equal(result.waiting, 1);
  assert.match(comments[0].body, /"event":"dev_assigned"/);
  assert.match(comments[0].body, /"developerId":"vn-a"/);
});
