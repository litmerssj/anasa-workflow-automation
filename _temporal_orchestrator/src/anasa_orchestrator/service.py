from __future__ import annotations

from dataclasses import asdict
from typing import Any

from temporalio.client import Client
from temporalio.common import WorkflowIDConflictPolicy, WorkflowIDReusePolicy

from .batch_workflow import BackendBatchWorkflow
from .gitops import normalize_ticket_id, normalize_ticket_list
from .models import (
    BackendBatchAssignment,
    BackendBatchInput,
    BackendBatchItem,
    BackendBatchSnapshot,
    CustomerAnswer,
    DirectionApproval,
    PrApproval,
    QaEvidence,
    ReleaseAuthorization,
    RetryRequest,
    TicketPhase,
    TicketSnapshot,
    TicketWorkflowInput,
    VisibleDirectionApproval,
    VisibleStateUpdate,
    VisibleTicketInput,
    VisibleTicketSnapshot,
    WorkflowInstruction,
)
from .runtime import task_queue, visible_workflow_id, workflow_id
from .visible_workflow import VisibleTicketWorkflow
from .workflow import TicketWorkflow


class OrchestratorService:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def start_tickets(
        self,
        ticket_text: str,
        *,
        user_instruction: str,
        mode: str = "live",
        model: str | None = None,
    ) -> list[dict[str, str]]:
        tickets = normalize_ticket_list(ticket_text)
        results: list[dict[str, str]] = []
        for ticket_id in tickets:
            handle = await self._client.start_workflow(
                TicketWorkflow.run,
                TicketWorkflowInput(
                    ticket_id=ticket_id,
                    mode=mode,
                    model=model,
                    user_instruction=user_instruction.strip(),
                ),
                id=workflow_id(ticket_id),
                task_queue=task_queue(),
                id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
                id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
                static_summary=f"{ticket_id} ANASA ticket workflow",
                static_details=user_instruction.strip() or "No extra instruction",
            )
            results.append({"ticket_id": ticket_id, "workflow_id": handle.id})
        return results

    async def list_tickets(self) -> list[dict[str, Any]]:
        tickets: list[dict[str, Any]] = []
        async for execution in self._client.list_workflows():
            if execution.workflow_type != "TicketWorkflow":
                continue
            ticket_id = execution.id.removeprefix("anasa-ticket-")
            item: dict[str, Any] = {
                "ticket_id": ticket_id,
                "workflow_id": execution.id,
                "temporal_status": execution.status.name if execution.status else "UNKNOWN",
                "start_time": execution.start_time.isoformat(),
                "close_time": execution.close_time.isoformat() if execution.close_time else None,
            }
            try:
                snapshot = await self.get_ticket(ticket_id)
                item.update(asdict(snapshot))
            except Exception as error:
                item["query_error"] = str(error)
            tickets.append(item)
        return sorted(tickets, key=lambda item: item["ticket_id"])

    async def get_ticket(self, ticket_id: str) -> TicketSnapshot:
        ticket_id = normalize_ticket_id(ticket_id)
        handle = self._client.get_workflow_handle_for(TicketWorkflow.run, workflow_id(ticket_id))
        return await handle.query(TicketWorkflow.get_status)

    async def approve_direction(
        self, ticket_id: str, scope_hash: str, approved_by: str
    ) -> TicketSnapshot:
        handle = self._ticket_handle(ticket_id)
        return await handle.execute_update(
            TicketWorkflow.approve_direction,
            DirectionApproval(normalize_ticket_id(ticket_id), scope_hash, approved_by),
        )

    async def answer_customer(self, ticket_id: str, answer: str) -> TicketSnapshot:
        handle = self._ticket_handle(ticket_id)
        return await handle.execute_update(
            TicketWorkflow.answer_customer,
            CustomerAnswer(normalize_ticket_id(ticket_id), answer),
        )

    async def approve_prs(
        self, ticket_id: str, exact_shas: dict[str, str], approved_by: str
    ) -> TicketSnapshot:
        handle = self._ticket_handle(ticket_id)
        return await handle.execute_update(
            TicketWorkflow.approve_pr,
            PrApproval(normalize_ticket_id(ticket_id), exact_shas, approved_by),
        )

    async def authorize_frontend_release(
        self, ticket_id: str, exact_shas: dict[str, str], approved_by: str
    ) -> TicketSnapshot:
        handle = self._ticket_handle(ticket_id)
        return await handle.execute_update(
            TicketWorkflow.authorize_release,
            ReleaseAuthorization(
                ticket_id=normalize_ticket_id(ticket_id),
                exact_shas=exact_shas,
                allow_frontend_production=True,
                approved_by=approved_by,
            ),
        )

    async def submit_qa_evidence(
        self,
        ticket_id: str,
        *,
        pr_commit: str,
        smoke: str,
        before: str,
        after: str,
    ) -> TicketSnapshot:
        handle = self._ticket_handle(ticket_id)
        return await handle.execute_update(
            TicketWorkflow.submit_qa_evidence,
            QaEvidence(
                ticket_id=normalize_ticket_id(ticket_id),
                pr_commit=pr_commit,
                smoke=smoke,
                before=before,
                after=after,
            ),
        )

    async def retry_ticket(self, ticket_id: str, requested_by: str) -> TicketSnapshot:
        handle = self._ticket_handle(ticket_id)
        return await handle.execute_update(
            TicketWorkflow.retry,
            RetryRequest(normalize_ticket_id(ticket_id), requested_by),
        )

    async def add_instruction(self, ticket_id: str, prompt: str, author: str) -> TicketSnapshot:
        handle = self._ticket_handle(ticket_id)
        return await handle.execute_update(
            TicketWorkflow.add_instruction,
            WorkflowInstruction(
                ticket_id=normalize_ticket_id(ticket_id),
                prompt=prompt,
                author=author,
            ),
        )

    async def register_visible_ticket(
        self,
        ticket_id: str,
        codex_thread_id: str,
        worktree_path: str,
        initial_state: str = "ANALYZE",
    ) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(ticket_id)
        handle = await self._client.start_workflow(
            VisibleTicketWorkflow.run,
            VisibleTicketInput(
                ticket_id=normalized,
                codex_thread_id=codex_thread_id,
                worktree_path=worktree_path,
                initial_state=initial_state,
            ),
            id=visible_workflow_id(normalized),
            task_queue=task_queue(),
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
            static_summary=f"{normalized} visible Codex task tracker",
        )
        return await handle.query(VisibleTicketWorkflow.get_status)

    async def get_visible_ticket(self, ticket_id: str) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(ticket_id)
        handle = self._client.get_workflow_handle_for(
            VisibleTicketWorkflow.run, visible_workflow_id(normalized)
        )
        return await handle.query(VisibleTicketWorkflow.get_status)

    async def list_visible_tickets(self) -> list[dict[str, Any]]:
        tickets: list[dict[str, Any]] = []
        async for execution in self._client.list_workflows():
            if execution.workflow_type != "VisibleTicketWorkflow":
                continue
            ticket_id = execution.id.removeprefix("anasa-visible-")
            item: dict[str, Any] = {
                "ticket_id": ticket_id,
                "workflow_id": execution.id,
                "temporal_status": execution.status.name if execution.status else "UNKNOWN",
                "start_time": execution.start_time.isoformat(),
            }
            try:
                item.update(asdict(await self.get_visible_ticket(ticket_id)))
            except Exception as error:
                item["query_error"] = str(error)
            tickets.append(item)
        return sorted(tickets, key=lambda item: item["ticket_id"])

    async def sync_visible_ticket(
        self, update: VisibleStateUpdate
    ) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(update.ticket_id)
        update.ticket_id = normalized
        handle = self._client.get_workflow_handle_for(
            VisibleTicketWorkflow.run, visible_workflow_id(normalized)
        )
        return await handle.execute_update(VisibleTicketWorkflow.sync_state, update)

    async def add_visible_instruction(
        self, ticket_id: str, prompt: str, author: str
    ) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(ticket_id)
        handle = self._client.get_workflow_handle_for(
            VisibleTicketWorkflow.run, visible_workflow_id(normalized)
        )
        return await handle.execute_update(
            VisibleTicketWorkflow.add_instruction,
            WorkflowInstruction(normalized, prompt, author),
        )

    async def approve_visible_direction(
        self, ticket_id: str, scope_hash: str, approved_by: str
    ) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(ticket_id)
        handle = self._client.get_workflow_handle_for(
            VisibleTicketWorkflow.run, visible_workflow_id(normalized)
        )
        return await handle.execute_update(
            VisibleTicketWorkflow.approve_direction,
            VisibleDirectionApproval(normalized, scope_hash, approved_by),
        )

    async def start_backend_batch(
        self, ticket_ids: list[str], batch_id: str, approved_by: str
    ) -> dict[str, str]:
        normalized = [normalize_ticket_id(ticket) for ticket in ticket_ids]
        if not normalized:
            raise ValueError("backend batch must contain tickets")
        if len(normalized) > 8:
            raise ValueError("backend batch can contain at most 8 tickets")
        items: list[BackendBatchItem] = []
        for ticket_id in normalized:
            snapshot = await self.get_ticket(ticket_id)
            if snapshot.current_state != TicketPhase.WAIT_BACKEND_BATCH.value:
                raise ValueError(
                    f"{ticket_id} is not waiting for backend batch: {snapshot.current_state}"
                )
            backend_artifacts = [
                artifact
                for artifact in snapshot.pr_artifacts
                if artifact.backend_change and artifact.has_changes
            ]
            exact_shas = {artifact.repository: artifact.head_sha for artifact in backend_artifacts}
            if not backend_artifacts or any(
                snapshot.approved_shas.get(key) != value for key, value in exact_shas.items()
            ):
                raise ValueError(f"{ticket_id} backend approval is missing or stale")
            assignment = BackendBatchAssignment(ticket_id, batch_id, exact_shas)
            await self._ticket_handle(ticket_id).execute_update(
                TicketWorkflow.assign_backend_batch, assignment
            )
            items.append(
                BackendBatchItem(
                    ticket_id=ticket_id,
                    workflow_id=workflow_id(ticket_id),
                    artifacts=backend_artifacts,
                    approved_shas=exact_shas,
                )
            )
        batch_workflow_id = f"anasa-backend-batch-{batch_id}"
        handle = await self._client.start_workflow(
            BackendBatchWorkflow.run,
            BackendBatchInput(batch_id, items, approved_by),
            id=batch_workflow_id,
            task_queue=task_queue(),
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
            static_summary=f"ANASA backend batch {batch_id}",
        )
        return {"batch_id": batch_id, "workflow_id": handle.id}

    async def list_backend_batches(self) -> list[dict[str, Any]]:
        batches: list[dict[str, Any]] = []
        async for execution in self._client.list_workflows():
            if execution.workflow_type != "BackendBatchWorkflow":
                continue
            item: dict[str, Any] = {
                "workflow_id": execution.id,
                "temporal_status": execution.status.name if execution.status else "UNKNOWN",
                "start_time": execution.start_time.isoformat(),
            }
            try:
                handle = self._client.get_workflow_handle_for(
                    BackendBatchWorkflow.run, execution.id
                )
                snapshot = await handle.query(BackendBatchWorkflow.get_status)
                item.update(asdict(snapshot))
            except Exception as error:
                item["query_error"] = str(error)
            batches.append(item)
        return sorted(batches, key=lambda item: item.get("batch_id", ""))

    async def retry_backend_batch(self, batch_id: str, requested_by: str) -> BackendBatchSnapshot:
        handle = self._client.get_workflow_handle_for(
            BackendBatchWorkflow.run, f"anasa-backend-batch-{batch_id}"
        )
        return await handle.execute_update(
            BackendBatchWorkflow.retry,
            RetryRequest(batch_id, requested_by),
        )

    def _ticket_handle(self, ticket_id: str):
        normalized = normalize_ticket_id(ticket_id)
        return self._client.get_workflow_handle_for(TicketWorkflow.run, workflow_id(normalized))
