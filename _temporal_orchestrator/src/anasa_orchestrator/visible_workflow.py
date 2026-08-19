from __future__ import annotations

from dataclasses import replace

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from .models import (
        BackendBatchCompletion,
        IntegrationCandidate,
        VisibleDirectionApproval,
        VisibleReopenRequest,
        VisibleStateUpdate,
        VisibleTicketInput,
        VisibleTicketSnapshot,
        WorkflowInstruction,
    )


@workflow.defn
class VisibleTicketWorkflow:
    def __init__(self) -> None:
        self._snapshot = VisibleTicketSnapshot()

    @workflow.run
    async def run(self, input: VisibleTicketInput) -> VisibleTicketSnapshot:
        self._snapshot = VisibleTicketSnapshot(
            ticket_id=input.ticket_id,
            codex_thread_id=input.codex_thread_id,
            worktree_path=input.worktree_path,
            current_state=input.initial_state,
            transitions=[input.initial_state],
            updated_at=workflow.now().isoformat(),
        )
        # Visible ticket trackers are durable session registries. They stay open after
        # COMPLETE so a QA return can reopen the same Codex session without creating a
        # duplicate Temporal workflow.
        await workflow.wait_condition(lambda: False)
        return self._copy()  # pragma: no cover - the tracker is intentionally long-lived

    @workflow.query
    def get_status(self) -> VisibleTicketSnapshot:
        return self._copy()

    @workflow.update
    def sync_state(self, update: VisibleStateUpdate) -> VisibleTicketSnapshot:
        self._snapshot.current_state = update.state
        if update.summary is not None:
            self._snapshot.summary = update.summary
        if update.report_markdown is not None:
            self._snapshot.report_markdown = update.report_markdown
        if update.scope_hash is not None:
            self._snapshot.scope_hash = update.scope_hash
        if update.pr_urls is not None:
            self._snapshot.pr_urls = list(update.pr_urls)
        if update.exact_shas is not None:
            self._snapshot.exact_shas = dict(update.exact_shas)
        if update.last_failure is not None:
            self._snapshot.last_failure = update.last_failure
        if update.resume_state is not None:
            self._snapshot.resume_state = update.resume_state
        if update.completed is not None:
            self._snapshot.completed = update.completed
        self._snapshot.updated_at = workflow.now().isoformat()
        if not self._snapshot.transitions or self._snapshot.transitions[-1] != update.state:
            self._snapshot.transitions.append(update.state)
        return self._copy()

    @sync_state.validator
    def validate_sync_state(self, update: VisibleStateUpdate) -> None:
        if update.ticket_id != self._snapshot.ticket_id:
            raise ValueError("visible state update targets another ticket")
        if not update.state.strip():
            raise ValueError("visible state must not be blank")

    @workflow.update
    def add_instruction(self, instruction: WorkflowInstruction) -> VisibleTicketSnapshot:
        self._snapshot.instruction_history.append(
            f"{instruction.author}: {instruction.prompt.strip()}"
        )
        self._snapshot.updated_at = workflow.now().isoformat()
        return self._copy()

    @add_instruction.validator
    def validate_instruction(self, instruction: WorkflowInstruction) -> None:
        if instruction.ticket_id != self._snapshot.ticket_id:
            raise ValueError("visible instruction targets another ticket")
        if not instruction.prompt.strip() or not instruction.author.strip():
            raise ValueError("instruction prompt and author are required")

    @workflow.update
    def approve_direction(self, approval: VisibleDirectionApproval) -> VisibleTicketSnapshot:
        self._snapshot.approved_scope_hash = approval.scope_hash
        self._snapshot.approved_by = approval.approved_by
        self._snapshot.current_state = "IMPLEMENT"
        self._snapshot.transitions.append("IMPLEMENT")
        self._snapshot.updated_at = workflow.now().isoformat()
        return self._copy()

    @approve_direction.validator
    def validate_direction_approval(self, approval: VisibleDirectionApproval) -> None:
        if approval.ticket_id != self._snapshot.ticket_id:
            raise ValueError("visible direction approval targets another ticket")
        if self._snapshot.current_state != "WAIT_DIRECTION_APPROVAL":
            raise ValueError("visible ticket is not waiting for direction approval")
        if not self._snapshot.scope_hash:
            raise ValueError("visible ticket has no canonical scope hash")
        if approval.scope_hash != self._snapshot.scope_hash:
            raise ValueError("visible direction approval scope hash is stale")
        if not approval.approved_by.strip():
            raise ValueError("approved_by is required")

    @workflow.update
    def publish_integration_candidate(
        self, candidate: IntegrationCandidate
    ) -> VisibleTicketSnapshot:
        self._snapshot.integration_candidate = replace(candidate)
        self._snapshot.pr_urls = [candidate.pr_url]
        self._snapshot.exact_shas = {candidate.repository: candidate.head_sha}
        if candidate.repository == "be_anasa":
            state = "READY_BE_INTEGRATION"
        elif candidate.repository in {"fe_anasa", "fe_anasa_ord"}:
            state = "READY_FE_INTEGRATION"
        else:
            raise ValueError(f"unsupported integration repository: {candidate.repository}")
        self._snapshot.current_state = state
        if not self._snapshot.transitions or self._snapshot.transitions[-1] != state:
            self._snapshot.transitions.append(state)
        self._snapshot.updated_at = workflow.now().isoformat()
        return self._copy()

    @publish_integration_candidate.validator
    def validate_integration_candidate(self, candidate: IntegrationCandidate) -> None:
        if candidate.ticket_id != self._snapshot.ticket_id:
            raise ValueError("integration candidate targets another ticket")
        if not candidate.pr_url.strip() or not candidate.head_sha.strip():
            raise ValueError("integration candidate requires PR URL and exact head SHA")
        if not candidate.approved_by.strip():
            raise ValueError("integration candidate requires ticket-session approval")

    @workflow.update
    def reopen(self, request: VisibleReopenRequest) -> VisibleTicketSnapshot:
        self._snapshot.current_state = request.state
        self._snapshot.completed = False
        self._snapshot.attempt += 1
        self._snapshot.last_failure = request.reason
        self._snapshot.resume_state = request.state
        self._snapshot.integration_candidate = None
        self._snapshot.backend_batch_id = None
        self._snapshot.deployed_sha = None
        self._snapshot.deployment_url = None
        if not self._snapshot.transitions or self._snapshot.transitions[-1] != request.state:
            self._snapshot.transitions.append(request.state)
        self._snapshot.updated_at = workflow.now().isoformat()
        return self._copy()

    @reopen.validator
    def validate_reopen(self, request: VisibleReopenRequest) -> None:
        if request.ticket_id != self._snapshot.ticket_id:
            raise ValueError("reopen targets another ticket")
        if not request.state.strip() or not request.reason.strip():
            raise ValueError("reopen state and reason are required")

    @workflow.signal
    def integration_completed(self, completion: BackendBatchCompletion) -> None:
        if completion.ticket_id != self._snapshot.ticket_id:
            raise ValueError("integration completion targets another ticket")
        self._snapshot.backend_batch_id = completion.batch_id
        self._snapshot.deployed_sha = completion.deployed_sha
        self._snapshot.deployment_url = completion.deployment_url
        self._snapshot.current_state = "POST_DEPLOY_QA"
        self._snapshot.last_failure = None
        self._snapshot.resume_state = None
        if not self._snapshot.transitions or self._snapshot.transitions[-1] != "POST_DEPLOY_QA":
            self._snapshot.transitions.append("POST_DEPLOY_QA")
        self._snapshot.updated_at = workflow.now().isoformat()

    def _copy(self) -> VisibleTicketSnapshot:
        return replace(
            self._snapshot,
            pr_urls=list(self._snapshot.pr_urls),
            exact_shas=dict(self._snapshot.exact_shas),
            integration_candidate=(
                replace(self._snapshot.integration_candidate)
                if self._snapshot.integration_candidate
                else None
            ),
            instruction_history=list(self._snapshot.instruction_history),
            transitions=list(self._snapshot.transitions),
        )
