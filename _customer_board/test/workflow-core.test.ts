import assert from "node:assert/strict";
import test from "node:test";

async function workflowCore() {
  try {
    return await import("../lib/workflow-core.mjs");
  } catch {
    return {} as Record<string, unknown>;
  }
}

const comments = [
  { body: "일반 코멘트", createdAt: "2026-08-04T00:00:00Z" },
  {
    body: '**[워크플로]** {"event":"dev_assigned","developerId":"dev-old","fingerprint":"a","at":"2026-08-04T00:01:00Z"}',
    createdAt: "2026-08-04T00:01:00Z",
  },
  {
    body: '**[워크플로]** {"event":"dev_assigned","developerId":"dev-current","fingerprint":"b","at":"2026-08-04T00:02:00Z"}',
    createdAt: "2026-08-04T00:02:00Z",
  },
];

test("workflow event parser returns the latest original developer", async () => {
  const core = await workflowCore();
  assert.equal(typeof core.latestDeveloperId, "function");
  assert.equal(core.latestDeveloperId(comments), "dev-current");
});

test("workflow event body contains a stable fingerprint", async () => {
  const core = await workflowCore();
  assert.equal(typeof core.workflowEventBody, "function");
  const body = core.workflowEventBody({
    event: "qa_assigned",
    issueId: "issue-1",
    developerId: "dev-1",
    qaId: "qa-1",
    at: "2026-08-04T00:00:00Z",
  });
  const parsed = core.parseWorkflowEvent(body);
  assert.equal(parsed.event, "qa_assigned");
  assert.equal(parsed.developerId, "dev-1");
  assert.match(parsed.fingerprint, /^qa_assigned:issue-1:/);
});

test("published option matching is exact after trimming the answer", async () => {
  const core = await workflowCore();
  assert.equal(typeof core.isExactOption, "function");
  assert.equal(core.isExactOption(" A안 ", ["A안", "B안"]), true);
  assert.equal(core.isExactOption("A", ["A안", "B안"]), false);
  assert.equal(core.isExactOption("A안", []), false);
});

test("question options are parsed only from the latest published question", async () => {
  const core = await workflowCore();
  assert.equal(typeof core.latestPublishedOptions, "function");
  const options = core.latestPublishedOptions([
    { body: "**[질의]** 이전 질문\n선택지: 예, 아니오" },
    { body: "**[질의초안]** 고객에게 보이면 안 됨\n선택지: 내부안" },
    { body: "**[질의]** 최종 질문\n선택지: A안, B안, C안" },
  ]);
  assert.deepEqual(options, ["A안", "B안", "C안"]);
});

test("workflow option matching preserves commas through the JSON option contract", async () => {
  const core = await workflowCore();
  assert.deepEqual(
    core.latestPublishedOptions([
      { body: '**[질의]** 방식 선택\n선택지(JSON): ["헤더는 팝업, 상세는 인라인", "모두 팝업"]' },
    ]),
    ["헤더는 팝업, 상세는 인라인", "모두 팝업"],
  );
});

test("latest workflow values use createdAt when Linear returns comments newest-first", async () => {
  const core = await workflowCore();
  const newest = {
    body: '**[질의]** 새 질문\n선택지(JSON): ["새 A","새 B"]',
    createdAt: "2026-08-04T02:00:00Z",
  };
  const older = {
    body: "**[질의]** 이전 질문\n선택지: 이전 A, 이전 B",
    createdAt: "2026-08-04T01:00:00Z",
  };
  assert.deepEqual(core.latestPublishedOptions([newest, older]), ["새 A", "새 B"]);
});

test("QA Request is the only state that triggers QA handoff", async () => {
  const core = await workflowCore();
  assert.equal(typeof core.isQaRequestState, "function");
  assert.equal(core.isQaRequestState({ name: "QA Request", type: "started" }), true);
  assert.equal(core.isQaRequestState({ name: "QA In Progress", type: "started" }), false);
  assert.equal(core.isQaRequestState({ name: "Done", type: "completed" }), false);
});
