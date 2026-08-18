import pytest
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from anasa_orchestrator.models import (
    VisibleStateUpdate,
    VisibleTicketInput,
    WorkflowInstruction,
)
from anasa_orchestrator.visible_workflow import VisibleTicketWorkflow


@pytest.mark.asyncio
async def test_visible_ticket_tracks_app_task_reports_without_running_agent() -> None:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="visible-queue",
            workflows=[VisibleTicketWorkflow],
        ):
            handle = await env.client.start_workflow(
                VisibleTicketWorkflow.run,
                VisibleTicketInput(
                    "ANA-348", "thread-348", "/tmp/ana-348", "ANALYZE"
                ),
                id="visible-348",
                task_queue="visible-queue",
            )
            await handle.execute_update(
                VisibleTicketWorkflow.sync_state,
                VisibleStateUpdate(
                    ticket_id="ANA-348",
                    state="WAIT_DIRECTION_APPROVAL",
                    summary="analysis ready",
                    report_markdown="report",
                    scope_hash="scope-348",
                ),
            )
            await handle.execute_update(
                VisibleTicketWorkflow.add_instruction,
                WorkflowInstruction("ANA-348", "check regression", "tester"),
            )
            snapshot = await handle.query(VisibleTicketWorkflow.get_status)
            assert snapshot.codex_thread_id == "thread-348"
            assert snapshot.current_state == "WAIT_DIRECTION_APPROVAL"
            assert snapshot.scope_hash == "scope-348"
            assert snapshot.instruction_history == ["tester: check regression"]

            await handle.execute_update(
                VisibleTicketWorkflow.sync_state,
                VisibleStateUpdate(
                    ticket_id="ANA-348",
                    state="COMPLETE",
                    summary="done",
                    completed=True,
                ),
            )
            result = await handle.result()

    assert result.completed is True
    assert result.transitions == ["ANALYZE", "WAIT_DIRECTION_APPROVAL", "COMPLETE"]
