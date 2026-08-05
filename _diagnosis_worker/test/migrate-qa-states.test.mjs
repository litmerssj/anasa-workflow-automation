import assert from "node:assert/strict";
import test from "node:test";

async function migration() {
  try {
    return await import("../migrate-qa-states.mjs");
  } catch {
    return {};
  }
}

function issue(id, state, labels) {
  return {
    id,
    identifier: id.toUpperCase(),
    state: { name: state, type: "started" },
    labels: { nodes: labels.map((name, index) => ({ id: `${id}-label-${index}`, name })) },
  };
}

test("legacy QA labels map to explicit states without touching unrelated tickets", async () => {
  const { buildQaStateMigrationPlan } = await migration();
  assert.equal(typeof buildQaStateMigrationPlan, "function");
  assert.deepEqual(
    buildQaStateMigrationPlan([
      issue("qa-wait", "In Progress", ["tier-2", "QA대기"]),
      issue("qa-active", "In Progress", ["tier-2", "QA중"]),
      issue("dev", "In Progress", ["tier-2"]),
      issue("already", "QA Request", ["tier-2"]),
    ], {
      "QA Request": "state-request",
      "QA In Progress": "state-progress",
    }),
    [
      {
        issueId: "qa-wait",
        identifier: "QA-WAIT",
        state: "QA Request",
        input: { stateId: "state-request", labelIds: ["qa-wait-label-0"] },
      },
      {
        issueId: "qa-active",
        identifier: "QA-ACTIVE",
        state: "QA In Progress",
        input: { stateId: "state-progress", labelIds: ["qa-active-label-0"] },
      },
    ],
  );
});

test("QA중 wins when a legacy ticket has both QA labels", async () => {
  const { buildQaStateMigrationPlan } = await migration();
  const [plan] = buildQaStateMigrationPlan([
    issue("both", "In Progress", ["QA대기", "QA중"]),
  ], {
    "QA Request": "state-request",
    "QA In Progress": "state-progress",
  });
  assert.equal(plan.state, "QA In Progress");
  assert.deepEqual(plan.input.labelIds, []);
});

test("migration fails before issue mutation when QA states are unresolved", async () => {
  const { runQaStateMigration } = await migration();
  const updates = [];
  await assert.rejects(
    () => runQaStateMigration({
      client: {
        listWorkflowStates: async () => [{ id: "request", name: "QA Request", type: "started" }],
        listIssues: async () => [issue("qa-wait", "In Progress", ["QA대기"])],
        updateIssue: async (...args) => updates.push(args),
      },
      teamId: "anasa",
      dryRun: false,
      createMissing: false,
    }),
    /QA In Progress/,
  );
  assert.deepEqual(updates, []);
});

test("dry-run returns the exact migration manifest without mutations", async () => {
  const { runQaStateMigration } = await migration();
  const result = await runQaStateMigration({
    client: {
      listWorkflowStates: async () => [
        { id: "request", name: "QA Request", type: "started" },
        { id: "progress", name: "QA In Progress", type: "started" },
      ],
      listIssues: async () => [issue("qa-wait", "In Progress", ["tier-2", "QA대기"])],
      updateIssue: async () => assert.fail("dry-run must not mutate issues"),
    },
    teamId: "anasa",
    dryRun: true,
  });
  assert.equal(result.changed, 1);
  assert.deepEqual(result.manifest.map(({ identifier, state }) => ({ identifier, state })), [
    { identifier: "QA-WAIT", state: "QA Request" },
  ]);
});
