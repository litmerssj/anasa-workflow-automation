import assert from "node:assert/strict";
import test from "node:test";

function issue(number, labels, title = `[LOG] 티켓 ${number}`) {
  return {
    id: `issue-${number}`,
    identifier: `ANA-${number}`,
    title,
    labels: { nodes: labels.map((name) => ({ id: `label-${name}`, name })) },
    comments: { nodes: [] },
  };
}

test("LOG backlog plan excludes customer lanes and balances all developers", async () => {
  const { planLogBacklog } = await import("../log-backlog.mjs");
  const issues = [
    issue(6, ["tier-2"]),
    issue(1, ["tier-2"]),
    issue(4, ["tier-2"]),
    issue(2, ["tier-3"]),
    issue(5, []),
    issue(3, ["tier-1"]),
    issue(7, ["고객확인"]),
    issue(8, ["tier-2"], "[BAS] 제외"),
  ];
  const plan = planLogBacklog(issues, {
    seniorId: "ian",
    developerIds: ["ian", "jin", "roger"],
    expectedTotal: 6,
  });

  assert.deepEqual(
    Object.fromEntries(
      ["ian", "jin", "roger"].map((id) => [
        id,
        plan.filter((entry) => entry.developerId === id).length,
      ]),
    ),
    { ian: 2, jin: 2, roger: 2 },
  );
  assert.equal(plan.find((entry) => entry.issue.identifier === "ANA-2").developerId, "ian");
  assert.deepEqual(
    plan.map((entry) => entry.issue.identifier).sort(),
    ["ANA-1", "ANA-2", "ANA-3", "ANA-4", "ANA-5", "ANA-6"],
  );
});

test("LOG backlog plan fails closed when the measured total changes", async () => {
  const { planLogBacklog } = await import("../log-backlog.mjs");
  assert.throws(
    () => planLogBacklog([issue(1, ["tier-2"])], {
      seniorId: "ian",
      developerIds: ["ian", "jin", "roger"],
      expectedTotal: 126,
    }),
    /expected=126, actual=1/,
  );
});
