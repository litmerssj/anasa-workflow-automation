from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .models import (
        BackendBatchCompletion,
        BackendBatchDeploymentInput,
        BackendBatchInput,
        BackendBatchResult,
        BackendBatchSnapshot,
        BatchPhase,
        DeploymentRequest,
        RetryRequest,
    )
    from .visible_workflow import VisibleTicketWorkflow
    from .workflow import TicketWorkflow


@workflow.defn
class BackendBatchWorkflow:
    """Merge an approved queue into the integration branch, then deploy on demand."""

    def __init__(self) -> None:
        self._snapshot = BackendBatchSnapshot()
        self._retry_requested = False
        self._deploy_requested = False

    @workflow.run
    async def run(self, input: BackendBatchInput) -> BackendBatchSnapshot:
        self._snapshot = BackendBatchSnapshot(
            batch_id=input.batch_id,
            current_state=BatchPhase.MERGE.value,
            tickets=[item.ticket_id for item in input.items],
            transitions=[BatchPhase.MERGE.value],
        )
        merged = await self._run_activity("execute_backend_integration", input, BatchPhase.MERGE)
        self._snapshot.integration_branch = merged.integration_branch
        self._snapshot.integration_sha = merged.integration_sha or merged.deployed_sha
        self._snapshot.merged_shas = dict(merged.merged_shas)
        self._snapshot.phase_durations = dict(merged.phase_durations)
        self._snapshot.report_markdown = (
            f"백엔드 통합 머지: {input.batch_id}\n"
            f"포함 티켓: {', '.join(self._snapshot.tickets)}\n"
            f"integration branch: {self._snapshot.integration_branch}\n"
            f"integration SHA: {self._snapshot.integration_sha}\n"
            "배포 요청 대기 중"
        )
        self._transition(BatchPhase.WAIT_DEPLOYMENT)
        await workflow.wait_condition(lambda: self._deploy_requested)
        self._deploy_requested = False

        deployed = await self._run_activity(
            "execute_backend_deployment",
            BackendBatchDeploymentInput(input, self._snapshot.integration_sha or ""),
            BatchPhase.DEPLOY,
        )
        self._snapshot.deployed_sha = deployed.deployed_sha
        self._snapshot.deployment_url = deployed.deployment_url
        self._snapshot.merged_shas = dict(deployed.merged_shas)
        self._snapshot.phase_durations = {
            **self._snapshot.phase_durations,
            **deployed.phase_durations,
        }
        self._snapshot.report_markdown = (
            f"백엔드 배치: {input.batch_id}\n"
            f"포함 티켓: {', '.join(self._snapshot.tickets)}\n"
            f"integration branch: {self._snapshot.integration_branch}\n"
            f"integration SHA: {self._snapshot.integration_sha}\n"
            f"deployed SHA: {deployed.deployed_sha}\n"
            f"deployment: {deployed.deployment_url}\n"
            f"phase durations: {self._snapshot.phase_durations}"
        )
        for item in input.items:
            completion = BackendBatchCompletion(
                ticket_id=item.ticket_id,
                batch_id=input.batch_id,
                deployed_sha=deployed.deployed_sha,
                deployment_url=deployed.deployment_url,
                repository="be_anasa",
            )
            if item.workflow_kind == "visible":
                handle = workflow.get_external_workflow_handle_for(
                    VisibleTicketWorkflow.run, item.workflow_id
                )
                await handle.signal(VisibleTicketWorkflow.integration_completed, completion)
            else:
                handle = workflow.get_external_workflow_handle_for(
                    TicketWorkflow.run, item.workflow_id
                )
                await handle.signal(TicketWorkflow.backend_batch_completed, completion)
        self._transition(BatchPhase.COMPLETE)
        return self._copy_snapshot()

    async def _run_activity(
        self, name: str, argument: object, phase: BatchPhase
    ) -> BackendBatchResult:
        while True:
            self._transition(phase)
            try:
                return await workflow.execute_activity(
                    name,
                    argument,
                    result_type=BackendBatchResult,
                    start_to_close_timeout=timedelta(minutes=30),
                    # Merge/deploy is externally mutating. Retrying the whole activity
                    # can recreate PRs or repeat a deterministic deployment failure.
                    retry_policy=RetryPolicy(maximum_attempts=1),
                )
            except Exception as error:
                self._block(error)
                await workflow.wait_condition(lambda: self._retry_requested)
                self._retry_requested = False
                self._snapshot.last_failure = None

    @workflow.query
    def get_status(self) -> BackendBatchSnapshot:
        return self._copy_snapshot()

    @workflow.update
    def deploy(self, request: DeploymentRequest) -> BackendBatchSnapshot:
        self._deploy_requested = True
        return self._copy_snapshot()

    @deploy.validator
    def validate_deploy(self, request: DeploymentRequest) -> None:
        if request.batch_id != self._snapshot.batch_id:
            raise ValueError("deployment request targets another batch")
        if self._snapshot.current_state != BatchPhase.WAIT_DEPLOYMENT.value:
            raise ValueError("backend batch is not waiting for deployment")
        if not request.requested_by.strip():
            raise ValueError("requested_by must not be blank")

    @workflow.update
    def retry(self, request: RetryRequest) -> BackendBatchSnapshot:
        self._retry_requested = True
        return self._copy_snapshot()

    @retry.validator
    def validate_retry(self, request: RetryRequest) -> None:
        if self._snapshot.current_state != BatchPhase.BLOCKED.value:
            raise ValueError("backend batch is not blocked")
        if not request.requested_by.strip():
            raise ValueError("requested_by must not be blank")

    def _block(self, error: Exception) -> None:
        failures: list[str] = []
        current: BaseException | None = error
        while current is not None:
            failures.append(f"{type(current).__name__}: {current}")
            current = current.__cause__ or current.__context__
        self._snapshot.last_failure = " <- ".join(failures)
        self._transition(BatchPhase.BLOCKED)

    def _transition(self, state: BatchPhase) -> None:
        self._snapshot.current_state = state.value
        if not self._snapshot.transitions or self._snapshot.transitions[-1] != state.value:
            self._snapshot.transitions.append(state.value)

    def _copy_snapshot(self) -> BackendBatchSnapshot:
        return replace(
            self._snapshot,
            tickets=list(self._snapshot.tickets),
            merged_shas=dict(self._snapshot.merged_shas),
            phase_durations=dict(self._snapshot.phase_durations),
            transitions=list(self._snapshot.transitions),
        )
