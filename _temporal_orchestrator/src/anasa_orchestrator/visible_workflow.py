from __future__ import annotations

from dataclasses import replace

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from .models import (
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
        )
        await workflow.wait_condition(lambda: self._snapshot.completed)
        return self._copy()

    @workflow.query
    def get_status(self) -> VisibleTicketSnapshot:
        return self._copy()

    @workflow.update
    def sync_state(self, update: VisibleStateUpdate) -> VisibleTicketSnapshot:
        self._snapshot.current_state = update.state
        self._snapshot.summary = update.summary
        self._snapshot.report_markdown = update.report_markdown
        self._snapshot.scope_hash = update.scope_hash
        self._snapshot.pr_urls = list(update.pr_urls)
        self._snapshot.exact_shas = dict(update.exact_shas)
        self._snapshot.completed = update.completed
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
        return self._copy()

    @add_instruction.validator
    def validate_instruction(self, instruction: WorkflowInstruction) -> None:
        if instruction.ticket_id != self._snapshot.ticket_id:
            raise ValueError("visible instruction targets another ticket")
        if not instruction.prompt.strip() or not instruction.author.strip():
            raise ValueError("instruction prompt and author are required")

    def _copy(self) -> VisibleTicketSnapshot:
        return replace(
            self._snapshot,
            pr_urls=list(self._snapshot.pr_urls),
            exact_shas=dict(self._snapshot.exact_shas),
            instruction_history=list(self._snapshot.instruction_history),
            transitions=list(self._snapshot.transitions),
        )
