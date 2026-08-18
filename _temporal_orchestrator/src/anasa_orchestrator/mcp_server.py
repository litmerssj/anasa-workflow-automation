from __future__ import annotations

from dataclasses import asdict
from typing import Any

from mcp.server.fastmcp import FastMCP

from .models import VisibleStateUpdate
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
async def anasa_list_tickets() -> list[dict[str, Any]]:
    """List every Temporal-managed ANASA ticket with reports and attention state."""
    return await (await _service()).list_tickets()


@mcp.tool()
async def anasa_list_visible_tickets() -> list[dict[str, Any]]:
    """List Temporal trackers for visible Codex app ticket tasks."""
    return await (await _service()).list_visible_tickets()


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
async def anasa_sync_visible_ticket(
    ticket_id: str,
    state: str,
    summary: str = "",
    report_markdown: str = "",
    scope_hash: str | None = None,
    pr_urls: list[str] | None = None,
    exact_shas: dict[str, str] | None = None,
    completed: bool = False,
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
                pr_urls=pr_urls or [],
                exact_shas=exact_shas or {},
                completed=completed,
            )
        )
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
