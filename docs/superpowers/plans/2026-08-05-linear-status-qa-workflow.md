# Linear Status-Based QA Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the transient `Done → In Progress + QA labels` loop with the explicit Linear state flow `Backlog → In Progress → QA Request → QA In Progress → Done`, while keeping module-level final review and creating new tickets for later customer feedback.

**Architecture:** Linear issue state becomes the single source of truth for development and internal QA lanes. The signed webhook performs immediate, idempotent QA assignment when an issue enters `QA Request`; the five-minute worker uses the same state contract as a fallback. Internal QA actions move the same issue to `Done` or back to `In Progress`, and the milestone final-review aggregate reads state counts instead of per-ticket customer-review labels.

**Tech Stack:** Next.js 15 route handlers, TypeScript/ES modules, Node test runner, Linear GraphQL API, Vercel deployment, local launchd worker.

---

### Task 1: Define the state contract and replace the Done bounce

**Files:**
- Modify: `workspace/_customer_board/test/workflow-lifecycle.test.ts`
- Modify: `workspace/_customer_board/test/workflow-core.test.ts`
- Modify: `workspace/_customer_board/lib/workflow-lifecycle.ts`
- Modify: `workspace/_customer_board/lib/workflow-core.mjs`

- [ ] **Step 1: Write failing state-transition tests**

Replace the Done-based expectations with tests proving:

```ts
test("QA Request records development completion without changing state", async () => {
  const result = await transitionQaRequest("issue-1", deps, now);
  assert.equal(result.status, "ready");
  assert.deepEqual(calls.map(([type]) => type), ["comment", "comment"]);
});

test("Done is terminal and never reopens", async () => {
  assert.deepEqual(await transitionQaRequest("done-issue", deps), { status: "ignored" });
  assert.deepEqual(calls, []);
});
```

Add pure state helpers with the desired contract:

```js
assert.equal(isQaRequestState({ name: "QA Request", type: "started" }), true);
assert.equal(isQaRequestState({ name: "Done", type: "completed" }), false);
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm test -- test/workflow-lifecycle.test.ts test/workflow-core.test.ts`

Expected: FAIL because `transitionQaRequest` and `isQaRequestState` do not exist and the old code reopens Done.

- [ ] **Step 3: Implement the minimal state-based lifecycle**

In `workflow-core.mjs`, replace `shouldQueueQaFromDone` with state-name helpers and keep the existing structured `dev_completed` event/fingerprint behavior. In `workflow-lifecycle.ts`, replace `transitionDeveloperDone` with `transitionQaRequest`; it must record completion once, never add QA labels, and never mutate the issue state.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run: `npm test -- test/workflow-lifecycle.test.ts test/workflow-core.test.ts`

Expected: all focused tests pass with no Done reopening assertion remaining.

### Task 2: Make QA assignment state-based and idempotent

**Files:**
- Modify: `workspace/_diagnosis_worker/test/assign.test.mjs`
- Modify: `workspace/_diagnosis_worker/assign.mjs`
- Modify: `workspace/_diagnosis_worker/test/lifecycle.test.mjs`
- Modify: `workspace/_diagnosis_worker/lifecycle.mjs`
- Modify: `workspace/_diagnosis_worker/worker.mjs`

- [ ] **Step 1: Write failing worker tests**

Change the QA target fixture from the `QA대기` label to state `QA Request` and assert that assignment changes only the assignee and writes `qa_assigned`:

```js
assert.deepEqual(qaUpdate.input, { assigneeId: "intern-a" });
assert.equal(qaIssue.state.name, "QA Request");
```

Add cases proving an already assigned `QA Request` is not reassigned and `QA In Progress` counts against QA WIP. Replace the completed-issue reconciliation tests with a fallback that scans `QA Request` issues only.

- [ ] **Step 2: Run worker tests and confirm RED**

Run: `npm test -- test/assign.test.mjs test/lifecycle.test.mjs`

Expected: FAIL because assignment still selects/removes QA labels and reconciliation still scans Done.

- [ ] **Step 3: Implement state-based assignment**

Use `issue.state.name === "QA Request"` for QA targets, keep status unchanged, and count both `QA Request` and `QA In Progress` as QA WIP. Exclude those states from developer WIP. Make the target idempotent by comparing the current assignee with the latest `qa_assigned` event after the latest `dev_completed` event.

Refactor the lifecycle fallback to return unassigned or partially assigned `QA Request` issues, and remove the `Done` recovery pass from `worker.mjs`.

- [ ] **Step 4: Run worker tests and confirm GREEN**

Run: `npm test -- test/assign.test.mjs test/lifecycle.test.mjs`

Expected: focused worker tests pass and no test expects QA label mutation.

### Task 3: Assign QA immediately from the signed webhook

**Files:**
- Create: `workspace/_customer_board/lib/qa-assignment.ts`
- Create: `workspace/_customer_board/test/qa-assignment.test.ts`
- Modify: `workspace/_customer_board/lib/linear.ts`
- Modify: `workspace/_customer_board/app/api/webhooks/linear/route.ts`

- [ ] **Step 1: Write failing immediate-assignment tests**

Define a dependency-injected API:

```ts
const result = await assignQaRequest("issue-1", deps, env, now);
assert.deepEqual(result, { status: "assigned", qaId: "intern-a", developerId: "dev-1" });
assert.deepEqual(updates, [{ issueId: "issue-1", assigneeId: "intern-a" }]);
assert.match(comments[0], /"event":"qa_assigned"/);
```

Cover WIP saturation, self-QA exclusion, already-assigned idempotency, and missing status/account configuration.

- [ ] **Step 2: Run the new test and confirm RED**

Run: `npm test -- test/qa-assignment.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement immediate assignment and Linear read helpers**

Add Linear helpers for listing issues by state and active workspace members. `assignQaRequest` must reuse the established intern-first, Tier-3 senior/lead, WIP-cap rules and must not change the issue state. Update the webhook route to run `transitionQaRequest` followed by `assignQaRequest`; webhook retries must not duplicate the event or assignment.

- [ ] **Step 4: Run assignment and webhook tests**

Run: `npm test -- test/qa-assignment.test.ts test/workflow-lifecycle.test.ts test/linear-webhook.test.ts`

Expected: all focused tests pass.

### Task 4: Move internal QA actions and queue UI to states

**Files:**
- Modify: `workspace/_customer_board/test/internal-actions.test.ts`
- Modify: `workspace/_customer_board/lib/workflow-core.mjs`
- Modify: `workspace/_customer_board/app/api/internal/route.ts`
- Modify: `workspace/_customer_board/lib/linear.ts`
- Modify: `workspace/_customer_board/app/internal/page.tsx`
- Modify: `workspace/_customer_board/components/InternalWorkflowCard.tsx`

- [ ] **Step 1: Write failing QA action tests**

Update decision fixtures to pass `state: { name: "QA In Progress" }` instead of the `QA중` label. Assert:

```js
assert.deepEqual(qaPass, {
  tag: "**[QA:통과]**",
  state: "Done",
  returnToDeveloper: false,
});
assert.deepEqual(qaReject.state, "In Progress");
```

Remove individual `final_pass` and `final_hold` expectations.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- test/internal-actions.test.ts`

Expected: FAIL because actions still require QA labels and QA pass does not set Done.

- [ ] **Step 3: Implement state-based QA actions and UI**

Require `QA In Progress` for pass/reject. Pass changes state to `Done`; reject records mandatory feedback, restores the latest developer, and changes state to `In Progress`. Query `QA Request` and `QA In Progress` by state in the internal page. Show QA action cards only for `QA In Progress`; show module `[최종검수]` tickets as links, not per-ticket customer-publication actions.

- [ ] **Step 4: Run focused tests and build**

Run: `npm test -- test/internal-actions.test.ts`

Run: `npm run build`

Expected: tests pass and Next.js production build exits 0.

### Task 5: Preserve module-level final review without customer-ticket lanes

**Files:**
- Modify: `workspace/_diagnosis_worker/test/final-review.test.mjs`
- Modify: `workspace/_diagnosis_worker/final-review.mjs`

- [ ] **Step 1: Write failing aggregate tests**

Use issues with states `Done`, `QA Request`, `QA In Progress`, and `In Progress`. Assert that the D-2 aggregate reports counts by state and includes all non-canceled milestone tickets, while excluding the aggregate ticket itself.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- test/final-review.test.mjs`

Expected: FAIL because the aggregate still relies on `최종검수대기` and QA labels.

- [ ] **Step 3: Implement state-based milestone aggregation**

List all non-canceled issues, group non-aggregate issues by project milestone, and report `Done`, `QA Request`, `QA In Progress`, and development-incomplete counts. Keep one `[최종검수]` aggregate per milestone and do not create `검수요청` on individual tickets.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm test -- test/final-review.test.mjs`

Expected: all aggregate tests pass.

### Task 6: Provision Linear states and migrate active tickets safely

**Files:**
- Create: `workspace/_diagnosis_worker/migrate-qa-states.mjs`
- Create: `workspace/_diagnosis_worker/test/migrate-qa-states.test.mjs`
- Modify: `workspace/_diagnosis_worker/package.json`
- Modify: `workspace/_customer_board/README.md`
- Modify: `workspace/_customer_board/AGENTS.md`
- Modify: `workspace/_diagnosis_worker/README.md`

- [ ] **Step 1: Write failing migration-plan tests**

Test an idempotent plan that maps only active legacy lanes:

```js
assert.deepEqual(plan, [
  { issueId: "qa-wait", state: "QA Request", removeLabels: ["QA대기"] },
  { issueId: "qa-active", state: "QA In Progress", removeLabels: ["QA중"] },
]);
```

- [ ] **Step 2: Run the migration test and confirm RED**

Run: `npm test -- test/migrate-qa-states.test.mjs`

Expected: FAIL because the migration module does not exist.

- [ ] **Step 3: Implement dry-run-first provisioning and migration**

The script must verify or create `QA Request` and `QA In Progress` as Started workflow states, print the exact affected issue identifiers in dry-run mode, then update state and remove only `QA대기`/`QA중`. It must fail before issue mutation if either state cannot be resolved.

- [ ] **Step 4: Run dry-run and inspect the exact migration set**

Run: `node migrate-qa-states.mjs --dry`

Expected: two states verified/created in plan output and only currently active legacy QA tickets listed.

- [ ] **Step 5: Apply Linear state provisioning and migration**

Run: `node migrate-qa-states.mjs`

Expected: `QA Request` and `QA In Progress` exist in the Anasa team and all listed active legacy tickets are migrated once.

### Task 7: Full verification, deployment, and worker restart

**Files:**
- Verify all modified files above

- [ ] **Step 1: Run the complete customer-board suite**

Run: `npm test`

Run: `npm run build`

Expected: zero test failures and production build exit 0.

- [ ] **Step 2: Run the complete worker suite**

Run: `npm test`

Run: `npm run dry`

Expected: zero test failures; dry worker reports no Done-reopen lifecycle actions.

- [ ] **Step 3: Deploy the customer board**

Run: `vercel --prod`

Expected: production deployment succeeds and the signed Linear webhook target remains healthy.

- [ ] **Step 4: Restart the local launchd worker**

Restart only `com.litmers.anasa-linear-worker` after tests and deployment, then inspect fresh logs for one polling cycle.

Expected: worker starts with the new state-based assignment/final-review passes and no legacy label transition errors.

- [ ] **Step 5: Verify Linear externally**

List Anasa statuses and confirm the exact ordered active flow contains `Backlog`, `In Progress`, `QA Request`, `QA In Progress`, and `Done`. Verify migrated tickets and confirm no active issue remains controlled by `QA대기` or `QA중`.

---

This workspace root and the two workflow source folders are not Git repositories, so commit checkpoints are unavailable. Preserve safety with test-first red/green evidence, dry-run migration output, file diffs, and external Linear verification.
