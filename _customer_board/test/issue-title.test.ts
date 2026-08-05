import assert from "node:assert/strict";
import test from "node:test";

import { buildIssueTitle, issuePrefix } from "../lib/issue-title.ts";

test("issuePrefix uses ORD for web-order screen codes", () => {
  assert.equal(issuePrefix("ORD-SGT-001M"), "ORD");
});

test("issuePrefix extracts modules from hyphenated and underscored screen codes", () => {
  assert.equal(issuePrefix("BAS-MA-021M"), "BAS");
  assert.equal(issuePrefix("LOG_OUT_001M"), "LOG");
});

test("buildIssueTitle keeps the screen code and limits the symptom to forty characters", () => {
  const symptom = "가".repeat(45);

  assert.equal(
    buildIssueTitle("ORD-SGP-003M", symptom),
    `[ORD] ORD-SGP-003M · ${"가".repeat(40)}`,
  );
});
