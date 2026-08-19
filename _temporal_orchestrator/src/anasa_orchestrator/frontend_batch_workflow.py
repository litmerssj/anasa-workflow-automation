from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .models import (
        BackendBatchCompletion,
        BackendBatchInput,
        BackendBatchResult,
        BackendBatchSnapshot,
        BatchPhase,
        RetryRequest,
    )
    from .visible_workflow import VisibleTicketWorkflow


@workflow.defn
class FrontendBatchWorkflow:
    """One integration PR and one production release for visible FE ticket sessions."""

    def __init__(self) -> None:
        self._snapshot = BackendBatchSnapshot()
        self._retry_requested = False

    @workflow.run
    async def run(self, input: BackendBatchInput) -> BackendBatchSnapshot:
        self._snapshot = BackendBatchSnapshot(
            batch_id=input.batch_id,
            current_state=BatchPhase.MERGE.value,
            tickets=[item.ticket_id for item in input.items],
            transitions=[BatchPhase.MERGE.value],
        )
        while True:
            try:
                result = await workflow.execute_activity(
                    "execute_frontend_batch",
                    input,
                    result_type=BackendBatchResult,
                    start_to_close_timeout=timedelta(minutes=20),
                    retry_policy=RetryPolicy(maximum_attempts=1),
                )
                break
            except Exception as error:
                self._block(error)
                await workflow.wait_condition(lambda: self._retry_requested)
                self._retry_requested = False
                self._snapshot.last_failure = None
                self._transition(BatchPhase.MERGE)

        self._transition(BatchPhase.DEPLOY)
        self._snapshot.deployed_sha = result.deployed_sha
        self._snapshot.deployment_url = result.deployment_url
        self._snapshot.merged_shas = dict(result.merged_shas)
        self._snapshot.phase_durations = dict(result.phase_durations)
        for item in input.items:
            completion = BackendBatchCompletion(
                ticket_id=item.ticket_id,
                batch_id=input.batch_id,
                deployed_sha=result.deployed_sha,
                deployment_url=result.deployment_url,
            )
            handle = workflow.get_external_workflow_handle_for(
                VisibleTicketWorkflow.run, item.workflow_id
            )
            await handle.signal(VisibleTicketWorkflow.integration_completed, completion)
        self._transition(BatchPhase.COMPLETE)
        return self._copy_snapshot()

    @workflow.query
    def get_status(self) -> BackendBatchSnapshot:
        return self._copy_snapshot()

    @workflow.update
    def retry(self, request: RetryRequest) -> BackendBatchSnapshot:
        self._retry_requested = True
        return self._copy_snapshot()

    @retry.validator
    def validate_retry(self, request: RetryRequest) -> None:
        if self._snapshot.current_state != BatchPhase.BLOCKED.value:
            raise ValueError("frontend batch is not blocked")
        if not request.requested_by.strip():
            raise ValueError("requested_by must not be blank")

    def _block(self, error: Exception) -> None:
        self._snapshot.last_failure = f"{type(error).__name__}: {error}"
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
