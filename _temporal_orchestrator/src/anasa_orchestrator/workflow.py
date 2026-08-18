from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from .models import (
        AnalysisResult,
        AnalyzeTicketInput,
        BackendBatchAssignment,
        BackendBatchCompletion,
        CompleteTicketInput,
        CompleteTicketResult,
        CustomerAnswer,
        DirectionApproval,
        ImplementationInput,
        ImplementationResult,
        MergeFrontendInput,
        MergeResult,
        PrApproval,
        PreparePrInput,
        PreparePrResult,
        QaEvidence,
        ReleaseAuthorization,
        RetryRequest,
        StartDevelopmentInput,
        TicketContext,
        TicketPhase,
        TicketSnapshot,
        TicketWorkflowInput,
        WorkflowInstruction,
        WorkspaceResult,
    )


ACTIVITY_TIMEOUT = timedelta(minutes=45)
ACTIVITY_RETRY = RetryPolicy(maximum_attempts=3)


@workflow.defn
class TicketWorkflow:
    def __init__(self) -> None:
        self._snapshot = TicketSnapshot()
        self._analysis: AnalysisResult | None = None
        self._workspace: WorkspaceResult | None = None
        self._context: TicketContext | None = None
        self._direction_approval: DirectionApproval | None = None
        self._pr_approval: PrApproval | None = None
        self._customer_answer: CustomerAnswer | None = None
        self._batch_assignment: BackendBatchAssignment | None = None
        self._batch_completion: BackendBatchCompletion | None = None
        self._release_authorization: ReleaseAuthorization | None = None
        self._qa_evidence: QaEvidence | None = None
        self._retry_requested = False
        self._pending_instructions: list[WorkflowInstruction] = []

    @workflow.run
    async def run(self, input: TicketWorkflowInput) -> TicketSnapshot:
        if input.mode not in {"live", "shadow"}:
            raise ValueError("mode must be live or shadow")
        if not input.ticket_id.startswith("ANA-"):
            raise ValueError("ticket_id must use the ANA-<number> form")

        self._snapshot = TicketSnapshot(
            ticket_id=input.ticket_id,
            current_state=TicketPhase.PREPARE_WORKSPACE.value,
            mode=input.mode,
            external_effects=False,
            transitions=[TicketPhase.PREPARE_WORKSPACE.value],
        )

        self._workspace = await self._activity(
            "prepare_workspace",
            input,
            WorkspaceResult,
            TicketPhase.PREPARE_WORKSPACE,
        )
        self._snapshot.workspace_path = self._workspace.root_path

        self._context = await self._activity(
            "fetch_ticket", input, TicketContext, TicketPhase.FETCH_TICKET
        )

        while True:
            self._analysis = await self._analyze_until_approved(input)
            await self._activity(
                "mark_in_progress",
                StartDevelopmentInput(ticket=input, context=self._context),
                str,
                TicketPhase.START_DEVELOPMENT,
            )
            prepared = await self._implement_until_approved(input)
            if prepared is not None:
                break
        changed = [artifact for artifact in prepared.artifacts if artifact.has_changes]

        backend = [artifact for artifact in changed if artifact.backend_change]
        frontend = [artifact for artifact in changed if not artifact.backend_change]

        if backend:
            self._transition(TicketPhase.WAIT_BACKEND_BATCH)
            await workflow.wait_condition(lambda: self._batch_assignment is not None)
            self._snapshot.backend_batch_id = self._batch_assignment.batch_id
            await workflow.wait_condition(lambda: self._batch_completion is not None)
            self._snapshot.deployed_sha = self._batch_completion.deployed_sha
            if self._batch_completion.deployment_url:
                self._snapshot.deployment_urls.append(self._batch_completion.deployment_url)

        if frontend:
            self._transition(TicketPhase.WAIT_RELEASE_AUTHORIZATION)
            await workflow.wait_condition(lambda: self._release_authorization is not None)
            merged = await self._activity(
                "merge_frontend",
                MergeFrontendInput(
                    ticket=input,
                    artifacts=frontend,
                    authorization=self._release_authorization,
                ),
                MergeResult,
                TicketPhase.MERGE_FRONTEND,
            )
            self._snapshot.deployment_urls.extend(merged.deployment_urls)
            if merged.merged_shas:
                self._snapshot.deployed_sha = next(reversed(merged.merged_shas.values()))

        self._transition(TicketPhase.WAIT_QA_EVIDENCE)
        await workflow.wait_condition(lambda: self._qa_evidence is not None)
        completed = await self._activity(
            "complete_ticket",
            CompleteTicketInput(context=self._context, evidence=self._qa_evidence),
            CompleteTicketResult,
            TicketPhase.COMPLETE_LINEAR,
        )
        self._snapshot.qa_status = completed.state
        self._transition(TicketPhase.COMPLETE)
        return self._copy_snapshot()

    async def _analyze_until_approved(self, input: TicketWorkflowInput) -> AnalysisResult:
        customer_answer: str | None = None
        while True:
            additional = self._consume_instruction_prompts()
            analysis = await self._activity(
                "analyze_ticket",
                AnalyzeTicketInput(
                    ticket=input,
                    workspace=self._workspace,
                    context=self._context,
                    customer_answer=customer_answer,
                    additional_instructions=additional,
                    codex_thread_id=self._snapshot.codex_thread_id,
                ),
                AnalysisResult,
                TicketPhase.ANALYZE,
            )
            customer_answer = None
            self._analysis = analysis
            self._snapshot.scope_hash = analysis.scope_hash
            self._snapshot.analysis_summary = analysis.scope_statement
            self._snapshot.analysis_report = analysis.report_markdown
            self._snapshot.dev_question = analysis.dev_question
            self._snapshot.backend_change = analysis.backend_change
            self._snapshot.unresolved_decisions = list(analysis.unresolved_decisions)
            self._snapshot.codex_thread_id = analysis.codex_thread_id

            if analysis.unresolved_decisions:
                self._transition(TicketPhase.WAIT_CUSTOMER_ANSWER)
                await workflow.wait_condition(
                    lambda: self._customer_answer is not None or bool(self._pending_instructions)
                )
                if self._pending_instructions:
                    continue
                customer_answer = self._customer_answer.answer
                self._customer_answer = None
                continue

            self._transition(TicketPhase.WAIT_DIRECTION_APPROVAL)
            await workflow.wait_condition(
                lambda: self._direction_approval is not None or bool(self._pending_instructions)
            )
            if self._pending_instructions:
                self._direction_approval = None
                continue
            return analysis

    async def _implement_until_approved(self, input: TicketWorkflowInput) -> PreparePrResult | None:
        while True:
            if self._pending_instructions:
                return None
            implementation = await self._activity(
                "implement_ticket",
                ImplementationInput(
                    ticket=input,
                    workspace=self._workspace,
                    context=self._context,
                    analysis=self._analysis,
                    additional_instructions=self._consume_instruction_prompts(),
                    codex_thread_id=self._snapshot.codex_thread_id,
                ),
                ImplementationResult,
                TicketPhase.IMPLEMENT,
            )
            self._snapshot.codex_thread_id = implementation.codex_thread_id
            self._snapshot.implementation_report = implementation.report_markdown
            if self._pending_instructions:
                return None
            if input.mode == "live":
                self._snapshot.external_effects = True

            prepared = await self._activity(
                "prepare_prs",
                PreparePrInput(
                    ticket=input,
                    workspace=self._workspace,
                    context=self._context,
                    analysis=self._analysis,
                    implementation=implementation,
                ),
                PreparePrResult,
                TicketPhase.PREPARE_PR,
            )
            self._snapshot.pr_artifacts = list(prepared.artifacts)
            changed = [artifact for artifact in prepared.artifacts if artifact.has_changes]
            if not changed:
                return prepared

            self._transition(TicketPhase.WAIT_PR_APPROVAL)
            await workflow.wait_condition(
                lambda: self._pr_approval is not None or bool(self._pending_instructions)
            )
            if self._pending_instructions:
                return None
            self._snapshot.approved_shas = dict(self._pr_approval.exact_shas)
            return prepared

    async def _activity(
        self,
        name: str,
        argument: object,
        result_type: type,
        phase: TicketPhase,
    ) -> Any:
        while True:
            self._transition(phase)
            try:
                return await workflow.execute_activity(
                    name,
                    argument,
                    result_type=result_type,
                    start_to_close_timeout=ACTIVITY_TIMEOUT,
                    retry_policy=ACTIVITY_RETRY,
                )
            except Exception as error:
                self._block(phase, error)
                await workflow.wait_condition(lambda: self._retry_requested)
                self._retry_requested = False
                self._snapshot.last_failure = None
                self._snapshot.resume_state = None

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
        if approval.exact_shas != self._changed_artifact_shas():
            raise ValueError("PR heads changed; exact-SHA approval is stale")

    @workflow.update
    def assign_backend_batch(self, assignment: BackendBatchAssignment) -> TicketSnapshot:
        self._batch_assignment = assignment
        return self._copy_snapshot()

    @assign_backend_batch.validator
    def validate_backend_batch_assignment(self, assignment: BackendBatchAssignment) -> None:
        self._require_ticket(assignment.ticket_id)
        self._require_state(TicketPhase.WAIT_BACKEND_BATCH)
        backend = {
            artifact.repository: artifact.head_sha
            for artifact in self._snapshot.pr_artifacts
            if artifact.has_changes and artifact.backend_change
        }
        if assignment.exact_shas != backend:
            raise ValueError("backend batch assignment contains stale SHAs")
        if not assignment.batch_id.strip():
            raise ValueError("batch_id must not be blank")

    @workflow.signal
    def backend_batch_completed(self, completion: BackendBatchCompletion) -> None:
        if completion.ticket_id != self._snapshot.ticket_id:
            return
        if not self._batch_assignment:
            return
        if completion.batch_id != self._batch_assignment.batch_id:
            return
        self._batch_completion = completion

    @workflow.update
    def authorize_release(self, authorization: ReleaseAuthorization) -> TicketSnapshot:
        self._release_authorization = authorization
        return self._copy_snapshot()

    @authorize_release.validator
    def validate_release_authorization(self, authorization: ReleaseAuthorization) -> None:
        self._require_ticket(authorization.ticket_id)
        self._require_state(TicketPhase.WAIT_RELEASE_AUTHORIZATION)
        if authorization.exact_shas != self._snapshot.approved_shas:
            raise ValueError("release authorization contains stale SHAs")
        if not authorization.allow_frontend_production:
            raise ValueError("frontend production release must be explicit")

    @workflow.update
    def submit_qa_evidence(self, evidence: QaEvidence) -> TicketSnapshot:
        self._qa_evidence = evidence
        return self._copy_snapshot()

    @submit_qa_evidence.validator
    def validate_qa_evidence(self, evidence: QaEvidence) -> None:
        self._require_ticket(evidence.ticket_id)
        self._require_state(TicketPhase.WAIT_QA_EVIDENCE)
        fields = [evidence.pr_commit, evidence.smoke, evidence.before, evidence.after]
        if any(not value.strip() for value in fields):
            raise ValueError("all qaEvidence fields are required")

    @workflow.update
    def retry(self, request: RetryRequest) -> TicketSnapshot:
        self._retry_requested = True
        return self._copy_snapshot()

    @retry.validator
    def validate_retry(self, request: RetryRequest) -> None:
        self._require_ticket(request.ticket_id)
        self._require_state(TicketPhase.BLOCKED)
        if not request.requested_by.strip():
            raise ValueError("requested_by must not be blank")

    @workflow.update
    def add_instruction(self, instruction: WorkflowInstruction) -> TicketSnapshot:
        self._pending_instructions.append(instruction)
        self._direction_approval = None
        self._pr_approval = None
        self._snapshot.approved_shas = {}
        self._snapshot.instruction_history.append(
            f"{instruction.author}: {instruction.prompt.strip()}"
        )
        if self._snapshot.current_state == TicketPhase.BLOCKED.value:
            self._retry_requested = True
        return self._copy_snapshot()

    @add_instruction.validator
    def validate_instruction(self, instruction: WorkflowInstruction) -> None:
        self._require_ticket(instruction.ticket_id)
        if not instruction.prompt.strip():
            raise ValueError("instruction prompt must not be blank")
        if not instruction.author.strip():
            raise ValueError("instruction author must not be blank")
        allowed = {
            TicketPhase.PREPARE_WORKSPACE.value,
            TicketPhase.FETCH_TICKET.value,
            TicketPhase.ANALYZE.value,
            TicketPhase.WAIT_CUSTOMER_ANSWER.value,
            TicketPhase.WAIT_DIRECTION_APPROVAL.value,
            TicketPhase.IMPLEMENT.value,
            TicketPhase.PREPARE_PR.value,
            TicketPhase.WAIT_PR_APPROVAL.value,
            TicketPhase.BLOCKED.value,
        }
        if self._snapshot.current_state not in allowed:
            raise ValueError(
                "instructions are locked after release/batch processing begins; "
                "create a new ticket or recovery scope"
            )

    def _changed_artifact_shas(self) -> dict[str, str]:
        return {
            artifact.repository: artifact.head_sha
            for artifact in self._snapshot.pr_artifacts
            if artifact.has_changes
        }

    def _consume_instruction_prompts(self) -> list[str]:
        prompts = [instruction.prompt for instruction in self._pending_instructions]
        self._pending_instructions = []
        return prompts

    def _require_ticket(self, ticket_id: str) -> None:
        if ticket_id != self._snapshot.ticket_id:
            raise ValueError(f"approval is for {ticket_id}, not {self._snapshot.ticket_id}")

    def _require_state(self, expected: TicketPhase) -> None:
        if self._snapshot.current_state != expected.value:
            raise ValueError(
                f"expected {expected.value}, current state is {self._snapshot.current_state}"
            )

    def _transition(self, state: TicketPhase) -> None:
        self._snapshot.current_state = state.value
        if not self._snapshot.transitions or self._snapshot.transitions[-1] != state.value:
            self._snapshot.transitions.append(state.value)

    def _block(self, resume_state: TicketPhase, error: Exception) -> None:
        failures: list[str] = []
        current: BaseException | None = error
        while current is not None:
            failures.append(f"{type(current).__name__}: {current}")
            current = current.__cause__ or current.__context__
        self._snapshot.last_failure = " <- ".join(failures)
        self._snapshot.resume_state = resume_state.value
        self._transition(TicketPhase.BLOCKED)

    def _copy_snapshot(self) -> TicketSnapshot:
        return replace(
            self._snapshot,
            unresolved_decisions=list(self._snapshot.unresolved_decisions),
            pr_artifacts=list(self._snapshot.pr_artifacts),
            approved_shas=dict(self._snapshot.approved_shas),
            deployment_urls=list(self._snapshot.deployment_urls),
            instruction_history=list(self._snapshot.instruction_history),
            transitions=list(self._snapshot.transitions),
        )
