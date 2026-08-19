from __future__ import annotations

from dataclasses import asdict
from typing import Any

from mcp.server.fastmcp import FastMCP

from .models import IntegrationCandidate, VisibleStateUpdate, VisibleTicketInput
from .runtime import connect_client
from .service import OrchestratorService

mcp = FastMCP(
    "ANASA Control Plane",
    instructions=(
        "Manage durable ANASA ticket workflows. Read status and reports freely. "
        "Never infer direction, exact-SHA, backend deployment, frontend production, "
        "or qaEvidence approval. Call the corresponding mutation tool only when the "
        "user explicitly authorizes that exact ticket and scope."
    ),
)


async def _service() -> OrchestratorService:
    return OrchestratorService(await connect_client())


@mcp.tool()
async def anasa_health() -> dict[str, Any]:
    """Check Temporal connectivity and active workflow/activity pollers."""
    return await (await _service()).health()


@mcp.tool()
async def anasa_list_tickets() -> list[dict[str, Any]]:
    """List every Temporal-managed ANASA ticket with reports and attention state."""
    return await (await _service()).list_tickets()


@mcp.tool()
async def anasa_list_visible_tickets(states: list[str] | None = None) -> list[dict[str, Any]]:
    """List Temporal trackers for visible Codex app ticket tasks."""
    return await (await _service()).list_visible_tickets(states=set(states or []))


@mcp.tool()
async def anasa_get_ticket_summary(ticket_id: str) -> dict[str, Any]:
    """Read a ticket from the visible-session tracker, falling back to legacy workflow."""
    return await (await _service()).get_ticket_summary(ticket_id)


@mcp.tool()
async def anasa_list_integration_candidates(repository: str) -> list[dict[str, Any]]:
    """List ticket-session-approved candidates ready for one FE or BE integration merge."""
    return await (await _service()).list_integration_candidates(repository)


@mcp.tool()
async def anasa_register_visible_ticket(
    ticket_id: str,
    codex_thread_id: str,
    worktree_path: str,
    initial_state: str = "ANALYZE",
) -> dict[str, Any]:
    """Register an app-visible Codex task as the durable worker for one ticket."""
    return asdict(
        await (await _service()).register_visible_ticket(
            ticket_id, codex_thread_id, worktree_path, initial_state
        )
    )


@mcp.tool()
async def anasa_register_visible_tickets(
    tickets: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """Register up to eight app-created Codex ticket sessions in one Temporal call."""
    inputs = [
        VisibleTicketInput(
            ticket_id=item["ticket_id"],
            codex_thread_id=item["codex_thread_id"],
            worktree_path=item["worktree_path"],
            initial_state=item.get("initial_state", "ANALYZE"),
        )
        for item in tickets
    ]
    snapshots = await (await _service()).register_visible_tickets(inputs)
    return [asdict(snapshot) for snapshot in snapshots]


@mcp.tool()
async def anasa_sync_visible_ticket(
    ticket_id: str,
    state: str,
    summary: str = "",
    report_markdown: str = "",
    scope_hash: str | None = None,
    pr_urls: list[str] | None = None,
    exact_shas: dict[str, str] | None = None,
    last_failure: str | None = None,
    resume_state: str | None = None,
    completed: bool | None = None,
) -> dict[str, Any]:
    """Persist a visible task's report and current gate in Temporal."""
    return asdict(
        await (await _service()).sync_visible_ticket(
            VisibleStateUpdate(
                ticket_id=ticket_id,
                state=state,
                summary=summary,
                report_markdown=report_markdown,
                scope_hash=scope_hash,
                pr_urls=pr_urls,
                exact_shas=exact_shas,
                last_failure=last_failure,
                resume_state=resume_state,
                completed=completed,
            )
        )
    )


@mcp.tool()
async def anasa_publish_integration_candidate(
    ticket_id: str,
    repository: str,
    pr_url: str,
    head_sha: str,
    branch_name: str,
    base_branch: str,
    approved_by: str,
    base_sha: str = "",
    impact_summary: str = "",
) -> dict[str, Any]:
    """Publish an exact ticket-session-approved PR to the central FE/BE ready queue."""
    return asdict(
        await (await _service()).publish_integration_candidate(
            IntegrationCandidate(
                ticket_id=ticket_id,
                repository=repository,
                pr_url=pr_url,
                head_sha=head_sha,
                branch_name=branch_name,
                base_branch=base_branch,
                base_sha=base_sha,
                approved_by=approved_by,
                impact_summary=impact_summary,
            )
        )
    )


@mcp.tool()
async def anasa_reopen_visible_ticket(ticket_id: str, state: str, reason: str) -> dict[str, Any]:
    """Reopen the same durable ticket session after QA return or follow-up work."""
    return asdict(await (await _service()).reopen_visible_ticket(ticket_id, state, reason))


@mcp.tool()
async def anasa_approve_visible_direction(
    ticket_id: str, scope_hash: str, approved_by: str = "hong-seokju"
) -> dict[str, Any]:
    """Approve the exact canonical scope hash for a visible Codex ticket task."""
    return asdict(
        await (await _service()).approve_visible_direction(ticket_id, scope_hash, approved_by)
    )


@mcp.tool()
async def anasa_get_ticket(ticket_id: str) -> dict[str, Any]:
    """Read one ticket's durable state, reports, Dev Q, PR artifacts, and failures."""
    return asdict(await (await _service()).get_ticket(ticket_id))


@mcp.tool()
async def anasa_list_backend_batches() -> list[dict[str, Any]]:
    """List backend batch manifests, deployment results, reports, and failures."""
    return await (await _service()).list_backend_batches()


@mcp.tool()
async def anasa_start_tickets(
    tickets: str,
    instruction: str = "",
    mode: str = "live",
) -> list[dict[str, str]]:
    """Deprecated headless start. Create a visible Codex task and register it instead."""
    raise RuntimeError(
        "headless ticket start is disabled; create an app-visible project task and call "
        "anasa_register_visible_ticket"
    )


@mcp.tool()
async def anasa_add_instruction(
    ticket_id: str, prompt: str, author: str = "hong-seokju"
) -> dict[str, Any]:
    """Add a follow-up prompt before release processing and resume the same Codex thread."""
    return asdict(await (await _service()).add_instruction(ticket_id, prompt, author))


@mcp.tool()
async def anasa_answer_customer(ticket_id: str, answer: str) -> dict[str, Any]:
    """Apply the customer's explicit answer to a waiting ticket and re-run analysis."""
    return asdict(await (await _service()).answer_customer(ticket_id, answer))


@mcp.tool()
async def anasa_approve_direction(
    ticket_id: str, scope_hash: str, approved_by: str = "hong-seokju"
) -> dict[str, Any]:
    """Approve exactly the reported scope hash, enabling implementation."""
    return asdict(await (await _service()).approve_direction(ticket_id, scope_hash, approved_by))


@mcp.tool()
async def anasa_approve_prs(
    ticket_id: str,
    exact_shas: dict[str, str],
    approved_by: str = "hong-seokju",
) -> dict[str, Any]:
    """Approve the exact FE/BE PR heads reported by the ticket workflow."""
    return asdict(await (await _service()).approve_prs(ticket_id, exact_shas, approved_by))


@mcp.tool()
async def anasa_start_backend_batch(
    ticket_ids: list[str],
    batch_id: str,
    confirmation: str,
    approved_by: str = "hong-seokju",
) -> dict[str, str]:
    """Merge and deploy approved backend SHAs. confirmation must equal DEPLOY BACKEND <batch_id>."""
    expected = f"DEPLOY BACKEND {batch_id}"
    if confirmation != expected:
        raise ValueError(f"confirmation must equal: {expected}")
    return await (await _service()).start_backend_batch(ticket_ids, batch_id, approved_by)


@mcp.tool()
async def anasa_start_visible_backend_batch(
    ticket_ids: list[str],
    batch_id: str,
    confirmation: str,
    approved_by: str = "hong-seokju",
) -> dict[str, str]:
    """Create one backend integration merge/deploy from visible ticket ready candidates."""
    expected = f"DEPLOY BACKEND {batch_id}"
    if confirmation != expected:
        raise ValueError(f"confirmation must equal: {expected}")
    return await (await _service()).start_visible_backend_batch(ticket_ids, batch_id, approved_by)


@mcp.tool()
async def anasa_start_visible_frontend_batch(
    ticket_ids: list[str],
    batch_id: str,
    confirmation: str,
    approved_by: str = "hong-seokju",
) -> dict[str, str]:
    """Create one frontend integration PR/main merge from visible ticket candidates."""
    expected = f"MERGE FRONTEND {batch_id}"
    if confirmation != expected:
        raise ValueError(f"confirmation must equal: {expected}")
    return await (await _service()).start_visible_frontend_batch(ticket_ids, batch_id, approved_by)


@mcp.tool()
async def anasa_authorize_frontend_production(
    ticket_id: str,
    exact_shas: dict[str, str],
    confirmation: str,
    approved_by: str = "hong-seokju",
) -> dict[str, Any]:
    """Authorize FE main merge/production. confirmation must equal PRODUCTION <ticket_id>."""
    expected = f"PRODUCTION {ticket_id}"
    if confirmation != expected:
        raise ValueError(f"confirmation must equal: {expected}")
    return asdict(
        await (await _service()).authorize_frontend_release(ticket_id, exact_shas, approved_by)
    )


@mcp.tool()
async def anasa_submit_qa_evidence(
    ticket_id: str,
    pr_commit: str,
    smoke: str,
    before: str,
    after: str,
) -> dict[str, Any]:
    """Submit actual verification evidence, create final Linear evidence, and request QA."""
    return asdict(
        await (await _service()).submit_qa_evidence(
            ticket_id,
            pr_commit=pr_commit,
            smoke=smoke,
            before=before,
            after=after,
        )
    )


@mcp.tool()
async def anasa_retry(ticket_id: str, requested_by: str = "hong-seokju") -> dict[str, Any]:
    """Retry the exact blocked phase without changing scope or approval artifacts."""
    return asdict(await (await _service()).retry_ticket(ticket_id, requested_by))


@mcp.tool()
async def anasa_retry_backend_batch(
    batch_id: str, requested_by: str = "hong-seokju"
) -> dict[str, Any]:
    """Retry the exact blocked backend batch manifest without changing its SHAs."""
    return asdict(await (await _service()).retry_backend_batch(batch_id, requested_by))


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
