# ANASA Temporal Orchestrator PoC

This is a separate, shadow-mode control plane for ANASA ticket work. It does not
modify `be_anasa`, `fe_anasa`, Linear, GitHub, Vercel, EC2, stored procedures, or
business data.

The first version proves that the manager can hold durable ticket state instead of
manually injecting prose into every Codex task:

```text
ANALYZE
  -> WAIT_CUSTOMER_ANSWER (when needed)
  -> WAIT_DIRECTION_APPROVAL
  -> IMPLEMENT (read-only inspection in this PoC)
  -> WAIT_PR_APPROVAL
  -> WAIT_BACKEND_BATCH (backend tickets only)
  -> DEPLOY (plan only)
  -> QA (plan only)
  -> COMPLETE
```

## Safety boundary

- `shadow_mode=False` is rejected by the Workflow.
- Every Codex turn uses `Sandbox.read_only` and `ApprovalMode.deny_all`.
- Implementation is an inspection of an existing candidate; it cannot edit or open a PR.
- Deployment and QA Activities return explicit `SHADOW_*` records without external calls.
- Direction approval is bound to `scope_hash`.
- PR approval and backend batch release are bound to the exact PR head SHA.
- Temporal Updates validate gates synchronously, so a stale approval is rejected before it
  is accepted into Workflow History.

## Stored ticket state

Each Workflow Query returns:

```text
ticket_id, current_state, worktree_path, codex_thread_id,
scope_hash, pr_head_sha, approved_sha, backend_batch_id,
deployed_sha, qa_status, last_failure, transitions
```

The Workflow ID is deterministic: `anasa-ticket-ANA-<number>`. This prevents a second
manager from accidentally creating a duplicate active Workflow for the same ticket.

## Local setup

Python 3.10+ and a local Temporal development server are required.

```bash
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
temporal server start-dev --db-filename .temporal/temporal.db
```

In another terminal, start the worker:

```bash
.venv/bin/anasa-worker
```

Start a read-only shadow ticket and inspect its state:

```bash
.venv/bin/anasa-orchestrator start ANA-65 /absolute/path/to/its/worktree
.venv/bin/anasa-orchestrator status ANA-65
```

Approvals are explicit, validated Temporal Updates:

```bash
.venv/bin/anasa-orchestrator approve-direction ANA-65 <scope-hash>
.venv/bin/anasa-orchestrator approve-pr ANA-65 <exact-pr-head-sha>
.venv/bin/anasa-orchestrator release-backend-batch ANA-65 <batch-id> <approved-sha>
```

If analysis has an unresolved customer decision:

```bash
.venv/bin/anasa-orchestrator customer-answer ANA-65 '<answer>'
```

Configuration:

```text
TEMPORAL_ADDRESS      default localhost:7233
TEMPORAL_NAMESPACE    default default
ANASA_TASK_QUEUE      default anasa-ticket-workers
```

## What is deliberately not implemented yet

- Linear and GitHub webhooks
- creation/adoption of Codex app tasks and git worktrees
- live implementation, merge, deployment, rollback, staging mutation, or qaEvidence
- a backend batch parent Workflow
- workflow versioning and Continue-As-New for very long ticket histories
- authentication, RBAC, secrets, production Temporal namespace, and observability

Those are promotion steps after one historical ticket completes shadow comparison against
the current manager.

## Verification

```bash
.venv/bin/pytest
```

The Temporal integration test starts an ephemeral test service, drives a backend ticket
through the full state machine, rejects stale scope/SHA approvals, and verifies that the
result records no external effects.

## Sources

- [OpenAI Codex SDK](https://developers.openai.com/codex/codex-sdk)
- [Temporal Python SDK](https://docs.temporal.io/develop/python)
- [Temporal Python Workflow messages](https://docs.temporal.io/develop/python/workflows/message-passing)
