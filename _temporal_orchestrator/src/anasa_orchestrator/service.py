from __future__ import annotations

import asyncio
from dataclasses import asdict
from typing import Any

from temporalio.api.enums.v1 import TaskQueueType
from temporalio.api.taskqueue.v1 import TaskQueue
from temporalio.api.workflowservice.v1 import DescribeTaskQueueRequest
from temporalio.client import Client
from temporalio.common import WorkflowIDConflictPolicy, WorkflowIDReusePolicy

from .batch_workflow import BackendBatchWorkflow
from .frontend_batch_workflow import FrontendBatchWorkflow
from .gitops import normalize_ticket_id, normalize_ticket_list
from .models import (
    BackendBatchAssignment,
    BackendBatchInput,
    BackendBatchItem,
    BackendBatchSnapshot,
    CustomerAnswer,
    DeploymentRequest,
    DirectionApproval,
    IntegrationCandidate,
    PrApproval,
    PrArtifact,
    QaEvidence,
    ReleaseAuthorization,
    RetryRequest,
    TicketPhase,
    TicketSnapshot,
    TicketWorkflowInput,
    VisibleDirectionApproval,
    VisibleReopenRequest,
    VisibleStateUpdate,
    VisibleTicketInput,
    VisibleTicketSnapshot,
    WorkflowInstruction,
)
from .runtime import VISIBLE_WORKFLOW_PREFIX, task_queue, visible_workflow_id, workflow_id
from .visible_workflow import VisibleTicketWorkflow
from .workflow import TicketWorkflow


class OrchestratorService:
    def __init__(self, client: Client) -> None:
        self._client = client

    async def health(self) -> dict[str, Any]:
        async def describe(queue_type: int):
            return await self._client.workflow_service.describe_task_queue(
                DescribeTaskQueueRequest(
                    namespace=self._client.namespace,
                    task_queue=TaskQueue(name=task_queue()),
                    task_queue_type=queue_type,
                    report_pollers=True,
                )
            )

        workflow_queue, activity_queue = await asyncio.gather(
            describe(TaskQueueType.TASK_QUEUE_TYPE_WORKFLOW),
            describe(TaskQueueType.TASK_QUEUE_TYPE_ACTIVITY),
        )
        workflow_pollers = len(workflow_queue.pollers)
        activity_pollers = len(activity_queue.pollers)
        return {
            "ok": workflow_pollers > 0 and activity_pollers > 0,
            "task_queue": task_queue(),
            "workflow_pollers": workflow_pollers,
            "activity_pollers": activity_pollers,
        }

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

    async def register_visible_tickets(
        self, tickets: list[VisibleTicketInput]
    ) -> list[VisibleTicketSnapshot]:
        if not tickets:
            raise ValueError("visible ticket batch must contain tickets")
        if len(tickets) > 8:
            raise ValueError("visible ticket batch can contain at most 8 tickets")
        normalized = [normalize_ticket_id(item.ticket_id) for item in tickets]
        if len(set(normalized)) != len(normalized):
            raise ValueError("visible ticket batch contains duplicate ticket IDs")
        return list(
            await asyncio.gather(
                *(
                    self.register_visible_ticket(
                        ticket_id,
                        item.codex_thread_id,
                        item.worktree_path,
                        item.initial_state,
                    )
                    for ticket_id, item in zip(normalized, tickets, strict=True)
                )
            )
        )

    async def get_visible_ticket(self, ticket_id: str) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(ticket_id)
        handle = self._client.get_workflow_handle_for(
            VisibleTicketWorkflow.run, visible_workflow_id(normalized)
        )
        return await handle.query(VisibleTicketWorkflow.get_status)

    async def list_visible_tickets(self, *, states: set[str] | None = None) -> list[dict[str, Any]]:
        executions = []
        async for execution in self._client.list_workflows():
            if execution.workflow_type != "VisibleTicketWorkflow" or not execution.id.startswith(
                VISIBLE_WORKFLOW_PREFIX
            ):
                continue
            executions.append(execution)

        async def load(execution) -> dict[str, Any]:
            ticket_id = execution.id.removeprefix(VISIBLE_WORKFLOW_PREFIX)
            item: dict[str, Any] = {
                "ticket_id": ticket_id,
                "workflow_id": execution.id,
                "temporal_status": execution.status.name if execution.status else "UNKNOWN",
                "start_time": execution.start_time.isoformat(),
            }
            try:
                snapshot = await asyncio.wait_for(self.get_visible_ticket(ticket_id), timeout=5)
                item.update(asdict(snapshot))
            except Exception as error:
                item["query_error"] = str(error)
            return item

        tickets = list(await asyncio.gather(*(load(execution) for execution in executions)))
        if states:
            tickets = [item for item in tickets if item.get("current_state") in states]
        return sorted(tickets, key=lambda item: item["ticket_id"])

    async def get_ticket_summary(self, ticket_id: str) -> dict[str, Any]:
        normalized = normalize_ticket_id(ticket_id)
        try:
            return {"kind": "visible", **asdict(await self.get_visible_ticket(normalized))}
        except Exception as error:
            if "not found" not in str(error).lower():
                raise
        return {"kind": "legacy", **asdict(await self.get_ticket(normalized))}

    async def list_integration_candidates(self, repository: str) -> list[dict[str, Any]]:
        if repository == "be_anasa":
            states = {"READY_BE_INTEGRATION"}
        elif repository in {"fe_anasa", "fe_anasa_ord"}:
            states = {"READY_FE_INTEGRATION"}
        else:
            raise ValueError(f"unsupported integration repository: {repository}")
        tickets = await self.list_visible_tickets(states=states)
        return [
            item
            for item in tickets
            if any(
                candidate.get("repository") == repository
                for candidate in (
                    item.get("integration_candidates")
                    or (
                        [item["integration_candidate"]]
                        if item.get("integration_candidate")
                        else []
                    )
                )
            )
        ]

    async def sync_visible_ticket(self, update: VisibleStateUpdate) -> VisibleTicketSnapshot:
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

    async def publish_integration_candidate(
        self, candidate: IntegrationCandidate
    ) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(candidate.ticket_id)
        candidate.ticket_id = normalized
        handle = self._client.get_workflow_handle_for(
            VisibleTicketWorkflow.run, visible_workflow_id(normalized)
        )
        return await handle.execute_update(
            VisibleTicketWorkflow.publish_integration_candidate, candidate
        )

    async def reopen_visible_ticket(
        self, ticket_id: str, state: str, reason: str
    ) -> VisibleTicketSnapshot:
        normalized = normalize_ticket_id(ticket_id)
        handle = self._client.get_workflow_handle_for(
            VisibleTicketWorkflow.run, visible_workflow_id(normalized)
        )
        return await handle.execute_update(
            VisibleTicketWorkflow.reopen,
            VisibleReopenRequest(normalized, state, reason),
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

    async def deploy_backend_batch(
        self,
        batch_id: str,
        requested_by: str,
        *,
        request_id: str,
        manifest_hash: str,
        candidate_receipt_id: str,
        backend_image_digest: str = "none",
        expected_migration_version: str = "none",
        expected_stored_procedure_hash: str = "none",
        expected_schema_contract_hash: str = "none",
        environment: str = "staging",
    ) -> dict[str, str]:
        if not batch_id.strip() or not requested_by.strip():
            raise ValueError("batch_id and requested_by are required")
        if not request_id.strip() or not manifest_hash.strip() or not candidate_receipt_id.strip():
            raise ValueError(
                "request_id, manifest_hash, and candidate_receipt_id are required "
                "by deploy-staging.yml"
            )
        handle = self._client.get_workflow_handle_for(
            BackendBatchWorkflow.run, f"anasa-backend-batch-{batch_id}"
        )
        snapshot = await handle.execute_update(
            BackendBatchWorkflow.deploy,
            DeploymentRequest(
                batch_id=batch_id,
                requested_by=requested_by,
                request_id=request_id,
                manifest_hash=manifest_hash,
                candidate_receipt_id=candidate_receipt_id,
                backend_image_digest=backend_image_digest,
                expected_migration_version=expected_migration_version,
                expected_stored_procedure_hash=expected_stored_procedure_hash,
                expected_schema_contract_hash=expected_schema_contract_hash,
                environment=environment,
            ),
        )
        return {"batch_id": batch_id, "state": snapshot.current_state}

    async def start_visible_backend_batch(
        self, ticket_ids: list[str], batch_id: str, approved_by: str
    ) -> dict[str, str]:
        normalized = [normalize_ticket_id(ticket) for ticket in ticket_ids]
        if not normalized or len(normalized) > 8:
            raise ValueError("visible backend batch must contain 1-8 tickets")
        snapshots = await asyncio.gather(
            *(self.get_visible_ticket(ticket_id) for ticket_id in normalized)
        )
        items: list[BackendBatchItem] = []
        for ticket_id, snapshot in zip(normalized, snapshots, strict=True):
            candidates = snapshot.integration_candidates or (
                [snapshot.integration_candidate] if snapshot.integration_candidate else []
            )
            candidate = next(
                (
                    candidate
                    for candidate in candidates
                    if candidate is not None
                    and candidate.repository == "be_anasa"
                    and candidate.repository not in snapshot.integrated_repositories
                ),
                None,
            )
            if snapshot.current_state != "READY_BE_INTEGRATION" or candidate is None:
                raise ValueError(f"{ticket_id} is not ready for backend integration")
            artifact = PrArtifact(
                repository="be_anasa",
                pr_url=candidate.pr_url,
                head_sha=candidate.head_sha,
                branch_name=candidate.branch_name,
                base_branch=candidate.base_branch,
                backend_change=True,
                has_changes=True,
            )
            items.append(
                BackendBatchItem(
                    ticket_id=ticket_id,
                    workflow_id=visible_workflow_id(ticket_id),
                    artifacts=[artifact],
                    approved_shas={"be_anasa": candidate.head_sha},
                    workflow_kind="visible",
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
            static_summary=f"ANASA visible backend batch {batch_id}",
        )
        return {"batch_id": batch_id, "workflow_id": handle.id}

    async def start_visible_frontend_batch(
        self, ticket_ids: list[str], batch_id: str, approved_by: str
    ) -> dict[str, str]:
        normalized = [normalize_ticket_id(ticket) for ticket in ticket_ids]
        if not normalized or len(normalized) > 8:
            raise ValueError("visible frontend batch must contain 1-8 tickets")
        snapshots = await asyncio.gather(
            *(self.get_visible_ticket(ticket_id) for ticket_id in normalized)
        )
        items: list[BackendBatchItem] = []
        repository_name: str | None = None
        for ticket_id, snapshot in zip(normalized, snapshots, strict=True):
            candidates = snapshot.integration_candidates or (
                [snapshot.integration_candidate] if snapshot.integration_candidate else []
            )
            pending_backend = any(
                candidate.repository == "be_anasa"
                and candidate.repository not in snapshot.integrated_repositories
                for candidate in candidates
            )
            candidate = next(
                (
                    candidate
                    for candidate in candidates
                    if candidate is not None
                    and candidate.repository in {"fe_anasa", "fe_anasa_ord"}
                    and candidate.repository not in snapshot.integrated_repositories
                ),
                None,
            )
            if (
                snapshot.current_state != "READY_FE_INTEGRATION"
                or candidate is None
                or pending_backend
            ):
                raise ValueError(f"{ticket_id} is not ready for frontend integration")
            repository_name = repository_name or candidate.repository
            if candidate.repository != repository_name:
                raise ValueError("frontend batch cannot mix repositories")
            artifact = PrArtifact(
                repository=candidate.repository,
                pr_url=candidate.pr_url,
                head_sha=candidate.head_sha,
                branch_name=candidate.branch_name,
                base_branch=candidate.base_branch,
                backend_change=False,
                has_changes=True,
            )
            items.append(
                BackendBatchItem(
                    ticket_id=ticket_id,
                    workflow_id=visible_workflow_id(ticket_id),
                    artifacts=[artifact],
                    approved_shas={candidate.repository: candidate.head_sha},
                    workflow_kind="visible",
                )
            )
        workflow_id_value = f"anasa-frontend-batch-{batch_id}"
        handle = await self._client.start_workflow(
            FrontendBatchWorkflow.run,
            BackendBatchInput(batch_id, items, approved_by),
            id=workflow_id_value,
            task_queue=task_queue(),
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
            static_summary=f"ANASA visible frontend batch {batch_id}",
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
