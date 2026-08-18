---
name: anasa-control-plane
description: Use the local Temporal control plane to start, inspect, prompt, approve, batch, retry, and complete ANASA ticket workflows from the Codex app. Use when 홍석주 mentions ANA ticket numbers, asks for status or reports, adds a follow-up instruction, answers a customer question, or explicitly approves a development direction, exact PR SHA, backend batch, frontend production release, or qaEvidence.
---

# ANASA Control Plane

Use the `anasa-temporal` MCP tools as the authoritative workflow interface.

## Read and report

- Normalize bare numbers to `ANA-<number>`.
- For status requests, call `anasa_list_tickets` or `anasa_get_ticket` and report the stored analysis, Dev Q, implementation report, PR artifacts, failure, and exact pending gate.
- Use `anasa_add_instruction` when the user adds a prompt to an in-progress pre-release workflow. Explain that it resumes the same Codex thread and can invalidate scope hash or PR SHA.
- Never post investigation or Dev Q text to Linear. Those reports remain in the Codex app.

## Approval boundaries

- Call `anasa_approve_direction` only after the user explicitly approves the displayed scope hash.
- Call `anasa_approve_prs` only with the exact repository-to-head-SHA map the user approved.
- Call `anasa_start_backend_batch` only after explicit approval of the named tickets, batch ID, and exact confirmation `DEPLOY BACKEND <batch_id>`.
- Call `anasa_authorize_frontend_production` only after explicit production approval and exact confirmation `PRODUCTION <ticket_id>`.
- Call `anasa_submit_qa_evidence` only with actual PR/commit, smoke, before, and after evidence.
- Do not infer deployment-hold release from a PR approval, preview, elapsed time, or generic completion request.

## Failure handling

- Read `last_failure` and `resume_state` before retrying.
- Use `anasa_retry` only when retrying the same approved artifacts and behavior is safe.
- If a follow-up instruction changes behavior, scope, repository impact, API/SP/DB/migration strategy, visible-column contract, or risk, send it through `anasa_add_instruction` and require fresh downstream approvals.
