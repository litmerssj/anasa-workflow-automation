from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .models import (
        AnalysisResult,
        AnalyzeTicketInput,
        BackendBatchRelease,
        CustomerAnswer,
        DeploymentInput,
        DeploymentResult,
        DirectionApproval,
        ImplementationInput,
        ImplementationResult,
        PrApproval,
        QaInput,
        QaResult,
        TicketPhase,
        TicketSnapshot,
        TicketWorkflowInput,
    )


ACTIVITY_TIMEOUT = timedelta(minutes=30)
ACTIVITY_RETRY = RetryPolicy(maximum_attempts=3)


@workflow.defn
class TicketWorkflow:
    def __init__(self) -> None:
        self._snapshot = TicketSnapshot()
        self._analysis: AnalysisResult | None = None
        self._direction_approval: DirectionApproval | None = None
        self._pr_approval: PrApproval | None = None
        self._customer_answer: CustomerAnswer | None = None
        self._batch_release: BackendBatchRelease | None = None

    @workflow.run
    async def run(self, input: TicketWorkflowInput) -> TicketSnapshot:
        if not input.shadow_mode:
            raise ValueError("Only shadow_mode=True is supported by this PoC")
        if not input.ticket_id.startswith("ANA-"):
            raise ValueError("ticket_id must use the ANA-<number> form")

        self._snapshot = TicketSnapshot(
            ticket_id=input.ticket_id,
            current_state=TicketPhase.ANALYZE.value,
            worktree_path=input.worktree_path,
            shadow_mode=True,
            external_effects=False,
            transitions=[TicketPhase.ANALYZE.value],
        )

        analysis_input = AnalyzeTicketInput(ticket=input)
        while True:
            try:
                self._analysis = await workflow.execute_activity(
                    "analyze_ticket",
                    analysis_input,
                    result_type=AnalysisResult,
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
            except Exception as error:
                return self._block(error)
            self._snapshot.scope_hash = self._analysis.scope_hash
            self._snapshot.backend_change = self._analysis.backend_change
            self._snapshot.codex_thread_id = self._analysis.codex_thread_id
            if not self._analysis.unresolved_decisions:
                break

            self._transition(TicketPhase.WAIT_CUSTOMER_ANSWER)
            await workflow.wait_condition(lambda: self._customer_answer is not None)
            answer = self._customer_answer
            self._customer_answer = None
            analysis_input = AnalyzeTicketInput(
                ticket=input,
                customer_answer=answer.answer,
                codex_thread_id=self._snapshot.codex_thread_id,
            )
            self._transition(TicketPhase.ANALYZE)

        self._transition(TicketPhase.WAIT_DIRECTION_APPROVAL)
        await workflow.wait_condition(lambda: self._direction_approval is not None)

        self._transition(TicketPhase.IMPLEMENT)
        try:
            implementation = await workflow.execute_activity(
                "inspect_implementation",
                ImplementationInput(
                    ticket=input,
                    analysis=self._analysis,
                    codex_thread_id=self._snapshot.codex_thread_id,
                ),
                result_type=ImplementationResult,
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=ACTIVITY_RETRY,
            )
        except Exception as error:
            return self._block(error)
        self._snapshot.pr_head_sha = implementation.pr_head_sha
        self._snapshot.backend_change = implementation.backend_change
        self._snapshot.codex_thread_id = implementation.codex_thread_id

        self._transition(TicketPhase.WAIT_PR_APPROVAL)
        await workflow.wait_condition(lambda: self._pr_approval is not None)
        self._snapshot.approved_sha = self._pr_approval.exact_sha

        if self._snapshot.backend_change:
            self._transition(TicketPhase.WAIT_BACKEND_BATCH)
            await workflow.wait_condition(lambda: self._batch_release is not None)
            self._snapshot.backend_batch_id = self._batch_release.batch_id

        self._transition(TicketPhase.DEPLOY)
        try:
            deployment = await workflow.execute_activity(
                "plan_deployment",
                DeploymentInput(
                    ticket=input,
                    approved_sha=self._snapshot.approved_sha or "",
                    backend_batch_id=self._snapshot.backend_batch_id,
                ),
                result_type=DeploymentResult,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=ACTIVITY_RETRY,
            )
        except Exception as error:
            return self._block(error)
        self._snapshot.deployed_sha = deployment.deployed_sha

        self._transition(TicketPhase.QA)
        try:
            qa = await workflow.execute_activity(
                "plan_qa",
                QaInput(
                    ticket=input,
                    deployed_sha=deployment.deployed_sha,
                    analysis=self._analysis,
                ),
                result_type=QaResult,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=ACTIVITY_RETRY,
            )
        except Exception as error:
            return self._block(error)
        self._snapshot.qa_status = qa.status
        self._transition(TicketPhase.COMPLETE)
        return self._copy_snapshot()

    @workflow.query
    def get_status(self) -> TicketSnapshot:
        return self._copy_snapshot()

    @workflow.update
    def answer_customer(self, answer: CustomerAnswer) -> TicketSnapshot:
        self._customer_answer = answer
        return self._copy_snapshot()

    @answer_customer.validator
    def validate_customer_answer(self, answer: CustomerAnswer) -> None:
        self._require_ticket(answer.ticket_id)
        self._require_state(TicketPhase.WAIT_CUSTOMER_ANSWER)
        if not answer.answer.strip():
            raise ValueError("customer answer must not be blank")

    @workflow.update
    def approve_direction(self, approval: DirectionApproval) -> TicketSnapshot:
        self._direction_approval = approval
        return self._copy_snapshot()

    @approve_direction.validator
    def validate_direction_approval(self, approval: DirectionApproval) -> None:
        self._require_ticket(approval.ticket_id)
        self._require_state(TicketPhase.WAIT_DIRECTION_APPROVAL)
        if approval.scope_hash != self._snapshot.scope_hash:
            raise ValueError("scope hash changed; direction approval is stale")

    @workflow.update
    def approve_pr(self, approval: PrApproval) -> TicketSnapshot:
        self._pr_approval = approval
        return self._copy_snapshot()

    @approve_pr.validator
    def validate_pr_approval(self, approval: PrApproval) -> None:
        self._require_ticket(approval.ticket_id)
        self._require_state(TicketPhase.WAIT_PR_APPROVAL)
        if approval.exact_sha != self._snapshot.pr_head_sha:
            raise ValueError("PR head changed; exact-SHA approval is stale")

    @workflow.update
    def release_backend_batch(
        self, release: BackendBatchRelease
    ) -> TicketSnapshot:
        self._batch_release = release
        return self._copy_snapshot()

    @release_backend_batch.validator
    def validate_backend_batch_release(self, release: BackendBatchRelease) -> None:
        self._require_ticket(release.ticket_id)
        self._require_state(TicketPhase.WAIT_BACKEND_BATCH)
        if release.approved_sha != self._snapshot.approved_sha:
            raise ValueError("batch release does not contain the approved exact SHA")
        if not release.batch_id.strip():
            raise ValueError("batch_id must not be blank")

    def _require_ticket(self, ticket_id: str) -> None:
        if ticket_id != self._snapshot.ticket_id:
            raise ValueError(
                f"approval is for {ticket_id}, not {self._snapshot.ticket_id}"
            )

    def _require_state(self, expected: TicketPhase) -> None:
        if self._snapshot.current_state != expected.value:
            raise ValueError(
                f"expected {expected.value}, current state is {self._snapshot.current_state}"
            )

    def _transition(self, state: TicketPhase) -> None:
        self._snapshot.current_state = state.value
        self._snapshot.transitions.append(state.value)

    def _block(self, error: Exception) -> TicketSnapshot:
        failures: list[str] = []
        current: BaseException | None = error
        while current is not None:
            failures.append(f"{type(current).__name__}: {current}")
            current = current.__cause__ or current.__context__
        self._snapshot.last_failure = " <- ".join(failures)
        self._transition(TicketPhase.BLOCKED)
        return self._copy_snapshot()

    def _copy_snapshot(self) -> TicketSnapshot:
        return replace(
            self._snapshot,
            transitions=list(self._snapshot.transitions),
        )
