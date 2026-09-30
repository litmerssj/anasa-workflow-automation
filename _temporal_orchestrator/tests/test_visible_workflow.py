import pytest
from temporalio.client import WorkflowUpdateFailedError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from anasa_orchestrator.models import (
    BackendBatchCompletion,
    IntegrationCandidate,
    VisibleDirectionApproval,
    VisibleReopenRequest,
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
                VisibleTicketInput("ANA-348", "thread-348", "/tmp/ana-348", "ANALYZE"),
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

            with pytest.raises(WorkflowUpdateFailedError):
                await handle.execute_update(
                    VisibleTicketWorkflow.approve_direction,
                    VisibleDirectionApproval("ANA-348", "stale", "tester"),
                )
            approved = await handle.execute_update(
                VisibleTicketWorkflow.approve_direction,
                VisibleDirectionApproval("ANA-348", "scope-348", "tester"),
            )
            assert approved.current_state == "IMPLEMENT"
            assert approved.approved_scope_hash == "scope-348"

            await handle.execute_update(
                VisibleTicketWorkflow.sync_state,
                VisibleStateUpdate(
                    ticket_id="ANA-348",
                    state="COMPLETE",
                    summary="done",
                    completed=True,
                ),
            )
            completed = await handle.query(VisibleTicketWorkflow.get_status)
            assert completed.completed is True

            reopened = await handle.execute_update(
                VisibleTicketWorkflow.reopen,
                VisibleReopenRequest("ANA-348", "ANALYZE", "QA returned"),
            )
            assert reopened.completed is False
            assert reopened.attempt == 2

            ready = await handle.execute_update(
                VisibleTicketWorkflow.publish_integration_candidate,
                IntegrationCandidate(
                    ticket_id="ANA-348",
                    repository="be_anasa",
                    pr_url="https://github.test/pr/348",
                    head_sha="head-348",
                    branch_name="codex/ana-348",
                    base_branch="develop",
                    approved_by="tester",
                ),
            )
            assert ready.current_state == "READY_BE_INTEGRATION"
            ready_with_fe = await handle.execute_update(
                VisibleTicketWorkflow.publish_integration_candidate,
                IntegrationCandidate(
                    ticket_id="ANA-348",
                    repository="fe_anasa",
                    pr_url="https://github.test/pr/348-fe",
                    head_sha="head-348-fe",
                    branch_name="codex/ana-348-fe",
                    base_branch="main",
                    approved_by="tester",
                ),
            )
            assert ready_with_fe.current_state == "READY_BE_INTEGRATION"
            assert {item.repository for item in ready_with_fe.integration_candidates} == {
                "be_anasa",
                "fe_anasa",
            }
            assert ready_with_fe.pr_urls == [
                "https://github.test/pr/348",
                "https://github.test/pr/348-fe",
            ]
            assert ready_with_fe.exact_shas == {
                "be_anasa": "head-348",
                "fe_anasa": "head-348-fe",
            }
            await handle.signal(
                VisibleTicketWorkflow.integration_completed,
                BackendBatchCompletion("ANA-348", "batch-348", "merge-348", "https://deploy"),
            )
            backend_deployed = await handle.query(VisibleTicketWorkflow.get_status)
            assert backend_deployed.current_state == "READY_FE_INTEGRATION"
            assert backend_deployed.integrated_repositories == ["be_anasa"]
            await handle.signal(
                VisibleTicketWorkflow.integration_completed,
                BackendBatchCompletion(
                    "ANA-348", "frontend-batch-348", "merge-fe-348", "https://frontend",
                    "fe_anasa",
                ),
            )
            deployed = await handle.query(VisibleTicketWorkflow.get_status)
            assert deployed.current_state == "POST_DEPLOY_QA"
            assert deployed.deployed_sha == "merge-fe-348"
            await handle.cancel()

    assert deployed.transitions == [
        "ANALYZE",
        "WAIT_DIRECTION_APPROVAL",
        "IMPLEMENT",
        "COMPLETE",
        "ANALYZE",
        "READY_BE_INTEGRATION",
        "READY_FE_INTEGRATION",
        "POST_DEPLOY_QA",
    ]


@pytest.mark.asyncio
async def test_visible_sync_is_patch_semantic() -> None:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="visible-patch-queue",
            workflows=[VisibleTicketWorkflow],
        ):
            handle = await env.client.start_workflow(
                VisibleTicketWorkflow.run,
                VisibleTicketInput("ANA-24", "thread-24", "/tmp/ana-24", "ANALYZE"),
                id="visible-24",
                task_queue="visible-patch-queue",
            )
            await handle.execute_update(
                VisibleTicketWorkflow.sync_state,
                VisibleStateUpdate(
                    ticket_id="ANA-24",
                    state="WAIT_DIRECTION_APPROVAL",
                    report_markdown="full report",
                    scope_hash="scope-24",
                    pr_urls=["https://github.test/pr/24"],
                    exact_shas={"fe_anasa": "head-24"},
                ),
            )
            snapshot = await handle.execute_update(
                VisibleTicketWorkflow.sync_state,
                VisibleStateUpdate(
                    ticket_id="ANA-24",
                    state="IMPLEMENT",
                    summary="started",
                ),
            )
            assert snapshot.report_markdown == "full report"
            assert snapshot.scope_hash == "scope-24"
            assert snapshot.pr_urls == ["https://github.test/pr/24"]
            assert snapshot.exact_shas == {"fe_anasa": "head-24"}
            await handle.cancel()
