import asyncio

import pytest
from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from anasa_orchestrator.models import (
    AnalysisResult,
    BackendBatchRelease,
    DeploymentInput,
    DeploymentResult,
    DirectionApproval,
    ImplementationInput,
    ImplementationResult,
    PrApproval,
    QaInput,
    QaResult,
    TicketPhase,
    TicketWorkflowInput,
)
from anasa_orchestrator.workflow import TicketWorkflow


@activity.defn(name="analyze_ticket")
async def analyze_ticket(_) -> AnalysisResult:
    return AnalysisResult(
        ticket_id="ANA-65",
        scope_statement="test scope",
        acceptance_criteria=["exact approval gates"],
        repositories=["be_anasa"],
        backend_change=True,
        unresolved_decisions=[],
        recommendation="test",
        scope_hash="scope-v1",
        codex_thread_id="thread-1",
    )


@activity.defn(name="inspect_implementation")
async def inspect_implementation(_: ImplementationInput) -> ImplementationResult:
    return ImplementationResult(
        summary="existing candidate",
        pr_url="https://example.test/pr/1",
        pr_head_sha="abc123",
        backend_change=True,
        verification=["tests passed"],
        risks=[],
        codex_thread_id="thread-1",
    )


@activity.defn(name="plan_deployment")
async def plan_deployment(input: DeploymentInput) -> DeploymentResult:
    return DeploymentResult("shadow:batch-1", f"shadow:{input.approved_sha}", "shadow")


@activity.defn(name="plan_qa")
async def plan_qa(_: QaInput) -> QaResult:
    return QaResult("shadow", ["no mutation"])


@activity.defn(name="inspect_implementation")
async def failing_inspect(_: ImplementationInput) -> ImplementationResult:
    raise RuntimeError("candidate inspection failed")


async def wait_for_phase(handle, phase: TicketPhase) -> None:
    snapshot = None
    for _ in range(100):
        snapshot = await handle.query(TicketWorkflow.get_status)
        if snapshot.current_state == phase.value:
            return
        await asyncio.sleep(0.01)
    events = [event async for event in handle.fetch_history_events()]
    event_types = [str(event.event_type) for event in events]
    raise AssertionError(
        f"workflow never reached {phase}; snapshot={snapshot}; events={event_types}"
    )


def error_chain(error: BaseException) -> str:
    messages: list[str] = []
    current: BaseException | None = error
    while current is not None:
        messages.append(str(current))
        current = current.__cause__ or current.__context__
    return " | ".join(messages)


@pytest.mark.asyncio
async def test_exact_sha_and_backend_batch_gates() -> None:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="test-queue",
            workflows=[TicketWorkflow],
            activities=[
                analyze_ticket,
                inspect_implementation,
                plan_deployment,
                plan_qa,
            ],
        ):
            handle = await env.client.start_workflow(
                TicketWorkflow.run,
                TicketWorkflowInput("ANA-65", "/tmp/worktree"),
                id="test-ana-65",
                task_queue="test-queue",
            )
            await wait_for_phase(handle, TicketPhase.WAIT_DIRECTION_APPROVAL)

            with pytest.raises(Exception) as stale_scope:
                await handle.execute_update(
                    TicketWorkflow.approve_direction,
                    DirectionApproval("ANA-65", "stale", "tester"),
                )
            assert "scope hash changed" in error_chain(stale_scope.value)
            await handle.execute_update(
                TicketWorkflow.approve_direction,
                DirectionApproval("ANA-65", "scope-v1", "tester"),
            )

            await wait_for_phase(handle, TicketPhase.WAIT_PR_APPROVAL)
            with pytest.raises(Exception) as stale_sha:
                await handle.execute_update(
                    TicketWorkflow.approve_pr,
                    PrApproval("ANA-65", "stale", "tester"),
                )
            assert "PR head changed" in error_chain(stale_sha.value)
            await handle.execute_update(
                TicketWorkflow.approve_pr,
                PrApproval("ANA-65", "abc123", "tester"),
            )

            await wait_for_phase(handle, TicketPhase.WAIT_BACKEND_BATCH)
            await handle.execute_update(
                TicketWorkflow.release_backend_batch,
                BackendBatchRelease("ANA-65", "batch-1", "abc123"),
            )
            result = await handle.result()

    assert result.current_state == TicketPhase.COMPLETE.value
    assert result.scope_hash == "scope-v1"
    assert result.approved_sha == "abc123"
    assert result.backend_batch_id == "batch-1"
    assert result.external_effects is False
    assert result.transitions == [
        "ANALYZE",
        "WAIT_DIRECTION_APPROVAL",
        "IMPLEMENT",
        "WAIT_PR_APPROVAL",
        "WAIT_BACKEND_BATCH",
        "DEPLOY",
        "QA",
        "COMPLETE",
    ]


@pytest.mark.asyncio
async def test_activity_failure_is_contained_as_blocked_state() -> None:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="failure-queue",
            workflows=[TicketWorkflow],
            activities=[
                analyze_ticket,
                failing_inspect,
                plan_deployment,
                plan_qa,
            ],
        ):
            handle = await env.client.start_workflow(
                TicketWorkflow.run,
                TicketWorkflowInput("ANA-65", "/tmp/worktree"),
                id="test-ana-65-failure",
                task_queue="failure-queue",
            )
            await wait_for_phase(handle, TicketPhase.WAIT_DIRECTION_APPROVAL)
            await handle.execute_update(
                TicketWorkflow.approve_direction,
                DirectionApproval("ANA-65", "scope-v1", "tester"),
            )
            result = await handle.result()

    assert result.current_state == TicketPhase.BLOCKED.value
    assert "candidate inspection failed" in (result.last_failure or "")
    assert result.external_effects is False
