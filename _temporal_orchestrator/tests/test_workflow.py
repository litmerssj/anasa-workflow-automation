import asyncio

import pytest
from temporalio import activity, workflow
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from anasa_orchestrator.batch_workflow import BackendBatchWorkflow
from anasa_orchestrator.frontend_batch_workflow import FrontendBatchWorkflow
from anasa_orchestrator.models import (
    AnalysisResult,
    AnalyzeTicketInput,
    BackendBatchCompletion,
    BackendBatchDeploymentInput,
    BackendBatchInput,
    BackendBatchItem,
    BackendBatchResult,
    CompleteTicketInput,
    CompleteTicketResult,
    DeploymentRequest,
    DirectionApproval,
    ImplementationInput,
    ImplementationResult,
    MergeFrontendInput,
    MergeResult,
    PrApproval,
    PrArtifact,
    PreparePrInput,
    PreparePrResult,
    QaEvidence,
    ReleaseAuthorization,
    RepositoryWorkspace,
    StartDevelopmentInput,
    TicketContext,
    TicketPhase,
    TicketWorkflowInput,
    VisibleTicketInput,
    WorkflowInstruction,
    WorkspaceResult,
)
from anasa_orchestrator.visible_workflow import VisibleTicketWorkflow
from anasa_orchestrator.workflow import TicketWorkflow

analysis_calls = 0
implementation_calls = 0
prepare_pr_calls = 0


@activity.defn(name="prepare_workspace")
async def prepare_workspace(_) -> WorkspaceResult:
    return WorkspaceResult(
        "/tmp/ANA-65",
        [
            RepositoryWorkspace(
                "be_anasa",
                "/tmp/be",
                "/tmp/ANA-65/be_anasa",
                "codex/ana-65-temporal",
                "origin/develop",
                "develop",
            )
        ],
    )


@activity.defn(name="fetch_ticket")
async def fetch_ticket(_) -> TicketContext:
    return TicketContext(
        "issue",
        "ANA-65",
        "ticket",
        "description",
        "https://linear/ANA-65",
        "In Progress",
        "team",
        [],
        [],
        [],
    )


@activity.defn(name="analyze_ticket")
async def analyze_ticket(input: AnalyzeTicketInput) -> AnalysisResult:
    global analysis_calls
    analysis_calls += 1
    version = 2 if input.additional_instructions else 1
    return AnalysisResult(
        ticket_id="ANA-65",
        scope_statement=f"scope {version}",
        acceptance_criteria=["exact approval gates"],
        repositories=["fe_anasa"],
        backend_change=False,
        unresolved_decisions=[],
        recommendation="test",
        report_markdown=f"analysis report {version}",
        dev_question=None,
        scope_hash=f"scope-v{version}",
        codex_thread_id="thread-1",
    )


@activity.defn(name="implement_ticket")
async def implement_ticket(_: ImplementationInput) -> ImplementationResult:
    global implementation_calls
    implementation_calls += 1
    return ImplementationResult(
        summary=f"implementation {implementation_calls}",
        report_markdown=f"implementation report {implementation_calls}",
        changed_repositories=["fe_anasa"],
        verification=["tests passed"],
        risks=[],
        column_impact="none",
        workbook_basis="none",
        codex_thread_id="thread-1",
    )


@activity.defn(name="mark_in_progress")
async def mark_in_progress(_: StartDevelopmentInput) -> str:
    return "In Progress"


@activity.defn(name="prepare_prs")
async def prepare_prs(_: PreparePrInput) -> PreparePrResult:
    global prepare_pr_calls
    prepare_pr_calls += 1
    return PreparePrResult(
        artifacts=[
            PrArtifact(
                repository="fe_anasa",
                pr_url="https://github.test/pr/1",
                head_sha=f"abc{prepare_pr_calls}",
                branch_name="codex/ana-65-temporal",
                base_branch="main",
                backend_change=False,
                has_changes=True,
            )
        ],
        no_change=False,
    )


@activity.defn(name="merge_frontend")
async def merge_frontend(_: MergeFrontendInput) -> MergeResult:
    return MergeResult({"fe_anasa": "merged-fe"}, ["https://frontend"])


@activity.defn(name="complete_ticket")
async def complete_ticket(_: CompleteTicketInput) -> CompleteTicketResult:
    return CompleteTicketResult("comment", "QA Request")


@activity.defn(name="execute_backend_batch")
async def execute_backend_batch(input: BackendBatchInput) -> BackendBatchResult:
    return BackendBatchResult(
        batch_id=input.batch_id,
        deployed_sha="deployed-sha",
        deployment_url="https://deploy",
        merged_shas={"ANA-65": "abc2"},
    )


@activity.defn(name="execute_backend_integration")
async def execute_backend_integration(input: BackendBatchInput) -> BackendBatchResult:
    return BackendBatchResult(
        batch_id=input.batch_id,
        deployed_sha="integration-sha",
        deployment_url="",
        merged_shas={"ANA-65": "abc2"},
        integration_branch="integration/backend",
        integration_sha="integration-sha",
    )


@activity.defn(name="execute_backend_deployment")
async def execute_backend_deployment(
    input: BackendBatchDeploymentInput,
) -> BackendBatchResult:
    return BackendBatchResult(
        batch_id=input.batch.batch_id,
        deployed_sha=input.integration_sha,
        deployment_url="https://deploy",
        merged_shas={"ANA-65": "abc2"},
        integration_branch="integration/backend",
        integration_sha=input.integration_sha,
    )


@activity.defn(name="execute_frontend_batch")
async def execute_frontend_batch(input: BackendBatchInput) -> BackendBatchResult:
    return BackendBatchResult(
        batch_id=input.batch_id,
        deployed_sha="frontend-merge",
        deployment_url="https://frontend",
        merged_shas={"ANA-65": "fe-head"},
        phase_durations={"total": 3.5},
    )


@workflow.defn
class BatchReceiverWorkflow:
    def __init__(self) -> None:
        self._completion = None

    @workflow.run
    async def run(self) -> str:
        await workflow.wait_condition(lambda: self._completion is not None)
        return self._completion.deployed_sha

    @workflow.signal(name="backend_batch_completed")
    def backend_batch_completed(self, completion: BackendBatchCompletion) -> None:
        self._completion = completion


async def wait_for(handle, predicate, message: str) -> object:
    snapshot = None
    for _ in range(200):
        snapshot = await handle.query(TicketWorkflow.get_status)
        if predicate(snapshot):
            return snapshot
        await asyncio.sleep(0.01)
    raise AssertionError(f"{message}; snapshot={snapshot}")


@pytest.mark.asyncio
async def test_followup_instructions_invalidate_scope_and_pr_then_complete() -> None:
    global analysis_calls, implementation_calls, prepare_pr_calls
    analysis_calls = implementation_calls = prepare_pr_calls = 0
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="test-queue",
            workflows=[TicketWorkflow],
            activities=[
                prepare_workspace,
                fetch_ticket,
                analyze_ticket,
                mark_in_progress,
                implement_ticket,
                prepare_prs,
                merge_frontend,
                complete_ticket,
            ],
        ):
            handle = await env.client.start_workflow(
                TicketWorkflow.run,
                TicketWorkflowInput("ANA-65", mode="live"),
                id="test-ana-65",
                task_queue="test-queue",
            )
            await wait_for(
                handle,
                lambda value: (
                    value.current_state == TicketPhase.WAIT_DIRECTION_APPROVAL.value
                    and value.scope_hash == "scope-v1"
                ),
                "initial analysis",
            )
            await handle.execute_update(
                TicketWorkflow.add_instruction,
                WorkflowInstruction("ANA-65", "include new evidence", "tester"),
            )
            await wait_for(
                handle,
                lambda value: (
                    value.current_state == TicketPhase.WAIT_DIRECTION_APPROVAL.value
                    and value.scope_hash == "scope-v2"
                ),
                "re-analysis",
            )
            await handle.execute_update(
                TicketWorkflow.approve_direction,
                DirectionApproval("ANA-65", "scope-v2", "tester"),
            )
            await wait_for(
                handle,
                lambda value: (
                    value.current_state == TicketPhase.WAIT_PR_APPROVAL.value
                    and value.pr_artifacts[0].head_sha == "abc1"
                ),
                "first PR",
            )
            await handle.execute_update(
                TicketWorkflow.add_instruction,
                WorkflowInstruction("ANA-65", "adjust implementation", "tester"),
            )
            await wait_for(
                handle,
                lambda value: (
                    value.current_state == TicketPhase.WAIT_DIRECTION_APPROVAL.value
                    and len(value.instruction_history) == 2
                ),
                "fresh direction approval after PR-stage instruction",
            )
            await handle.execute_update(
                TicketWorkflow.approve_direction,
                DirectionApproval("ANA-65", "scope-v2", "tester"),
            )
            await wait_for(
                handle,
                lambda value: (
                    value.current_state == TicketPhase.WAIT_PR_APPROVAL.value
                    and value.pr_artifacts[0].head_sha == "abc2"
                ),
                "updated PR",
            )
            await handle.execute_update(
                TicketWorkflow.approve_pr,
                PrApproval("ANA-65", {"fe_anasa": "abc2"}, "tester"),
            )
            await wait_for(
                handle,
                lambda value: value.current_state == TicketPhase.WAIT_RELEASE_AUTHORIZATION.value,
                "frontend release wait",
            )
            await handle.execute_update(
                TicketWorkflow.authorize_release,
                ReleaseAuthorization("ANA-65", {"fe_anasa": "abc2"}, True, "tester"),
            )
            await wait_for(
                handle,
                lambda value: value.current_state == TicketPhase.WAIT_QA_EVIDENCE.value,
                "QA evidence wait",
            )
            handle = env.client.get_workflow_handle_for(TicketWorkflow.run, "test-ana-65")
            await handle.execute_update(
                TicketWorkflow.submit_qa_evidence,
                QaEvidence(
                    "ANA-65",
                    "PR #1 / abc2",
                    "staging smoke passed",
                    "zero accepted",
                    "zero rejected",
                ),
            )
            result = await handle.result()

    assert result.current_state == TicketPhase.COMPLETE.value
    assert result.approved_shas == {"fe_anasa": "abc2"}
    assert result.deployed_sha == "merged-fe"
    assert result.qa_status == "QA Request"
    assert len(result.instruction_history) == 2
    assert analysis_calls == 3
    assert implementation_calls == 2


@pytest.mark.asyncio
async def test_backend_batch_signals_each_ticket_after_deployment() -> None:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="batch-queue",
            workflows=[BackendBatchWorkflow, BatchReceiverWorkflow],
            activities=[execute_backend_integration, execute_backend_deployment],
        ):
            receiver = await env.client.start_workflow(
                BatchReceiverWorkflow.run,
                id="receiver-1",
                task_queue="batch-queue",
            )
            batch = await env.client.start_workflow(
                BackendBatchWorkflow.run,
                BackendBatchInput(
                    "batch-1",
                    [
                        BackendBatchItem(
                            ticket_id="ANA-65",
                            workflow_id="receiver-1",
                            artifacts=[
                                PrArtifact(
                                    repository="be_anasa",
                                    pr_url="https://github.test/pr/1",
                                    head_sha="abc2",
                                    branch_name="codex/ana-65-temporal",
                                    base_branch="develop",
                                    backend_change=True,
                                    has_changes=True,
                                )
                            ],
                            approved_shas={"be_anasa": "abc2"},
                        )
                    ],
                    "tester",
                ),
                id="batch-1",
                task_queue="batch-queue",
            )
            for _ in range(100):
                status = await batch.query(BackendBatchWorkflow.get_status)
                if status.current_state == "WAIT_DEPLOYMENT":
                    break
                await asyncio.sleep(0.01)
            await batch.execute_update(
                BackendBatchWorkflow.deploy,
                DeploymentRequest(
                    "batch-1",
                    "tester",
                    request_id="release-batch-1",
                    manifest_hash="sha256:" + "a" * 64,
                    candidate_receipt_id="candidate-receipt-1",
                ),
            )
            batch_result = await batch.result()
            receiver_result = await receiver.result()

    assert batch_result.current_state == "COMPLETE"
    assert receiver_result == "integration-sha"


@pytest.mark.asyncio
async def test_frontend_batch_signals_visible_ticket_session() -> None:
    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="frontend-batch-queue",
            workflows=[FrontendBatchWorkflow, VisibleTicketWorkflow],
            activities=[execute_frontend_batch],
        ):
            visible = await env.client.start_workflow(
                VisibleTicketWorkflow.run,
                VisibleTicketInput("ANA-65", "thread-65", "/tmp/ana-65"),
                id="visible-65",
                task_queue="frontend-batch-queue",
            )
            batch = await env.client.start_workflow(
                FrontendBatchWorkflow.run,
                BackendBatchInput(
                    "frontend-batch-1",
                    [
                        BackendBatchItem(
                            ticket_id="ANA-65",
                            workflow_id="visible-65",
                            artifacts=[
                                PrArtifact(
                                    repository="fe_anasa",
                                    pr_url="https://github.test/pr/65",
                                    head_sha="fe-head",
                                    branch_name="codex/ana-65",
                                    base_branch="main",
                                    backend_change=False,
                                    has_changes=True,
                                )
                            ],
                            approved_shas={"fe_anasa": "fe-head"},
                            workflow_kind="visible",
                        )
                    ],
                    "tester",
                ),
                id="frontend-batch-1",
                task_queue="frontend-batch-queue",
            )
            result = await batch.result()
            snapshot = await visible.query(VisibleTicketWorkflow.get_status)
            await visible.cancel()

    assert result.current_state == "COMPLETE"
    assert result.phase_durations == {"total": 3.5}
    assert snapshot.current_state == "POST_DEPLOY_QA"
    assert snapshot.deployed_sha == "frontend-merge"
