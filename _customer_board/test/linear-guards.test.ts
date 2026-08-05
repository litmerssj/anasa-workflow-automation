import assert from "node:assert/strict";
import test from "node:test";

import { requireIssueLabels } from "../lib/linear.ts";

function issueWithLabels(names: string[]) {
  return {
    id: "issue-1",
    identifier: "ANA-1",
    title: "테스트",
    description: null,
    url: "https://linear.app/example",
    createdAt: "2026-08-04T00:00:00Z",
    state: { name: "In Progress", type: "started" },
    labels: { nodes: names.map((name) => ({ name })) },
    comments: { nodes: [] },
  };
}

test("issue label guard accepts every required label", () => {
  assert.doesNotThrow(() =>
    requireIssueLabels(issueWithLabels(["질의이력", "고객확인"]), ["질의이력", "고객확인"]),
  );
});

test("issue label guard rejects a ticket outside the requested customer lane", () => {
  assert.throws(
    () => requireIssueLabels(issueWithLabels(["고객보드"]), ["검수요청"]),
    /검수요청/,
  );
});
