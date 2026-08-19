import sys

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


@pytest.mark.asyncio
async def test_mcp_server_exposes_ticket_control_tools() -> None:
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "anasa_orchestrator.mcp_server"],
    )
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()

    names = {tool.name for tool in tools.tools}
    assert {
        "anasa_list_tickets",
        "anasa_list_backend_batches",
        "anasa_list_visible_tickets",
        "anasa_get_ticket_summary",
        "anasa_list_integration_candidates",
        "anasa_health",
        "anasa_register_visible_ticket",
        "anasa_register_visible_tickets",
        "anasa_sync_visible_ticket",
        "anasa_publish_integration_candidate",
        "anasa_reopen_visible_ticket",
        "anasa_approve_visible_direction",
        "anasa_start_tickets",
        "anasa_add_instruction",
        "anasa_approve_direction",
        "anasa_approve_prs",
        "anasa_start_backend_batch",
        "anasa_start_visible_backend_batch",
        "anasa_start_visible_frontend_batch",
        "anasa_submit_qa_evidence",
        "anasa_retry_backend_batch",
    } <= names
