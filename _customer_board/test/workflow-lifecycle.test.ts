import assert from "node:assert/strict";
import test from "node:test";

async function lifecycleModule() {
  try {
    return await import("../lib/workflow-lifecycle.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

function qaRequestIssue(stateName = "QA Request") {
  return {
    id: "issue-1",
    identifier: "ANA-1",
    state: { name: stateName, type: stateName === "Done" ? "completed" : "started" },
    labels: { nodes: [{ name: "고객보드" }, { name: "tier-2" }] },
    comments: {
      nodes: [
        {
          id: "c-1",
          body: '**[워크플로]** {"event":"dev_assigned","developerId":"dev-1","fingerprint":"dev:1","at":"2026-08-04T00:00:00Z"}',
          createdAt: "2026-08-04T00:00:00Z",
          user: null,
        },
      ],
    },
  };
}

test("QA Request records development completion without changing state", async () => {
  const lifecycle = await lifecycleModule();
  assert.equal(typeof lifecycle.transitionQaRequest, "function");
  const calls: Array<[string, unknown]> = [];
  const result = await lifecycle.transitionQaRequest("issue-1", {
    getIssue: async () => qaRequestIssue(),
    createComment: async (_id: string, body: string) => calls.push(["comment", body]),
  }, new Date("2026-08-04T01:00:00Z"));

  assert.deepEqual(result, { status: "ready", developerId: "dev-1" });
  assert.deepEqual(calls.map(([type]) => type), ["comment", "comment"]);
  assert.match(String(calls[0][1]), /QA Request/);
  assert.match(String(calls[1][1]), /"event":"dev_completed"/);
});

test("Done is terminal and never reopens", async () => {
  const lifecycle = await lifecycleModule();
  const calls: unknown[] = [];
  const result = await lifecycle.transitionQaRequest("issue-1", {
    getIssue: async () => qaRequestIssue("Done"),
    createComment: async (...args: unknown[]) => calls.push(args),
  });

  assert.deepEqual(result, { status: "ignored" });
  assert.deepEqual(calls, []);
});

test("webhook retry reuses the recorded development cycle", async () => {
  const lifecycle = await lifecycleModule();
  const target = qaRequestIssue();
  target.comments.nodes.push({
    id: "c-2",
    body: '**[워크플로]** {"event":"dev_completed","issueId":"issue-1","developerId":"dev-1","cycle":1,"fingerprint":"done:1","at":"2026-08-04T01:00:00Z"}',
    createdAt: "2026-08-04T01:00:00Z",
    user: null,
  });
  const calls: unknown[] = [];
  const result = await lifecycle.transitionQaRequest("issue-1", {
    getIssue: async () => target,
    createComment: async (...args: unknown[]) => calls.push(args),
  });

  assert.deepEqual(result, { status: "ready", developerId: "dev-1" });
  assert.deepEqual(calls, []);
});

test("QA Request without an original developer fails closed", async () => {
  const lifecycle = await lifecycleModule();
  const target = qaRequestIssue();
  target.comments.nodes = [];
  const calls: unknown[] = [];
  const result = await lifecycle.transitionQaRequest("issue-1", {
    getIssue: async () => target,
    createComment: async (...args: unknown[]) => calls.push(args),
  });

  assert.deepEqual(result, { status: "ignored" });
  assert.deepEqual(calls, []);
});
