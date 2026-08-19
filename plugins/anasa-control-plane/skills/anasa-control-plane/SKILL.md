---
name: anasa-control-plane
description: Use Temporal as the lightweight ANASA ticket-session registry and as the central FE/BE integration merge coordinator. Use it to register several app-created ticket sessions at once, publish exact ticket-session-approved integration candidates, list ready FE/BE candidates, run one approved integration merge/deployment, inspect batch failures, and reopen the same session after QA return.
---

# ANASA Control Plane

Use the `anasa-temporal` MCP tools for durable session registration and integration batches.

## Ownership boundary

- Each ANA ticket has its own visible Codex app task and worktree.
- 홍석주 gives ticket-specific requirements, feedback, Dev Q answers, direction approval, PR approval,
  QA feedback, and completion instructions directly in that ticket task.
- The central manager does not relay ordinary ticket instructions or poll every ticket for progress.
- The central manager owns only:
  1. creating/adopting several ticket tasks in one request;
  2. one compatible backend integration merge/deployment;
  3. one compatible frontend integration merge/main release.

## Starting several ticket sessions

1. The central Codex task creates or adopts one app-visible worktree task per ticket, up to eight.
2. Do not create a duplicate when a task for the same ticket already exists.
3. After the app returns the real thread IDs and worktree paths, call
   `anasa_register_visible_tickets` once for the whole batch.
4. Ticket-specific conversation continues in each created task, not in the central manager.

## Ticket-session publishing

- A ticket task calls `anasa_sync_visible_ticket` at meaningful gates. Sync is patch-semantic:
  omitted report, scope, PR, and SHA fields preserve their current values.
- After 홍석주 approves the ticket's exact PR head in that ticket task, it calls
  `anasa_publish_integration_candidate` with repository, PR URL, head SHA, branch/base, impact,
  and approver.
- Backend candidates enter `READY_BE_INTEGRATION`; frontend candidates enter
  `READY_FE_INTEGRATION`.
- A QA return uses `anasa_reopen_visible_ticket` so the same Codex task and workflow attempt are
  reused.

## Central integration

- Use `anasa_list_integration_candidates(repository)` instead of polling every ticket.
- Freeze the selected ticket IDs and exact heads before integration.
- Backend confirmation must equal `DEPLOY BACKEND <batch-id>` and calls
  `anasa_start_visible_backend_batch`.
- Frontend confirmation must equal `MERGE FRONTEND <batch-id>` and calls
  `anasa_start_visible_frontend_batch`.
- Never mix `fe_anasa` and `fe_anasa_ord` in one frontend batch.
- Integration activities use one integration PR and one target-branch merge. They do not re-run the
  individual ticket development lifecycle.

## Failure and speed rules

- Call `anasa_health` before starting a batch; both workflow and activity pollers must be present.
- Whole merge/deploy activities do not auto-retry. Retry only a frozen unchanged batch with the
  explicit retry tool after reading its failure.
- Deployment database commands retry only transient connectivity failures. Deterministic migration,
  contract, or data errors fail after the first attempt.
- Batch reports include phase durations for candidate validation, integration assembly, merge, and
  deployment wait.
- Do not infer exact-SHA, backend deployment, frontend main, fixture, qaEvidence, or data-mutation
  approval.

## Compatibility

Legacy ticket workflow tools remain available for old workflows, but new work uses visible Codex
tasks and the tools described above. Do not use deprecated headless `anasa_start_tickets`.
