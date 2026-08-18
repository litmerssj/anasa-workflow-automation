from __future__ import annotations

import hashlib
import json
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field
from temporalio import activity

from .models import (
    AnalysisResult,
    AnalyzeTicketInput,
    DeploymentInput,
    DeploymentResult,
    ImplementationInput,
    ImplementationResult,
    QaInput,
    QaResult,
)


class AnalysisPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_id: str
    scope_statement: str
    acceptance_criteria: list[str]
    repositories: list[str]
    backend_change: bool
    unresolved_decisions: list[str]
    recommendation: str


class ImplementationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    pr_url: str = ""
    pr_head_sha: str = Field(
        description="Existing candidate PR head SHA. Empty when no candidate exists."
    )
    backend_change: bool
    verification: list[str]
    risks: list[str]


class CodexPort(Protocol):
    async def run_read_only(
        self,
        *,
        cwd: str,
        prompt: str,
        output_schema: dict[str, object],
        model: str | None,
        thread_id: str | None,
    ) -> tuple[str, str]: ...


class OpenAICodexPort:
    """Official Codex SDK adapter with a hard read-only sandbox."""

    async def run_read_only(
        self,
        *,
        cwd: str,
        prompt: str,
        output_schema: dict[str, object],
        model: str | None,
        thread_id: str | None,
    ) -> tuple[str, str]:
        from openai_codex import ApprovalMode, AsyncCodex, Sandbox

        async with AsyncCodex() as codex:
            if thread_id:
                thread = await codex.thread_resume(
                    thread_id,
                    cwd=cwd,
                    model=model,
                    sandbox=Sandbox.read_only,
                    approval_mode=ApprovalMode.deny_all,
                )
            else:
                thread = await codex.thread_start(
                    cwd=cwd,
                    model=model,
                    sandbox=Sandbox.read_only,
                    approval_mode=ApprovalMode.deny_all,
                )
            result = await thread.run(
                prompt,
                output_schema=output_schema,
                sandbox=Sandbox.read_only,
                approval_mode=ApprovalMode.deny_all,
            )
            if not result.final_response:
                raise RuntimeError("Codex returned no final response")
            return result.final_response, thread.id


class TicketActivities:
    def __init__(self, codex: CodexPort | None = None) -> None:
        self._codex = codex or OpenAICodexPort()

    @activity.defn(name="analyze_ticket")
    async def analyze_ticket(self, input: AnalyzeTicketInput) -> AnalysisResult:
        customer_context = (
            f"\nLatest customer answer:\n{input.customer_answer}\n"
            if input.customer_answer
            else ""
        )
        prompt = f"""
Analyze {input.ticket.ticket_id} in read-only mode for the ANASA workflow.
Do not edit files, create commits, push, open PRs, change Linear, deploy, or mutate data.
Inspect only the supplied worktree and return the requested JSON object.
Separate explicit acceptance criteria from unresolved decisions. Identify whether any
backend code, API, stored procedure, schema, migration, cache, or deployment change is
required. Keep the scope statement precise enough to bind a later approval.
{customer_context}
""".strip()
        response, thread_id = await self._codex.run_read_only(
            cwd=input.ticket.worktree_path,
            prompt=prompt,
            output_schema=AnalysisPayload.model_json_schema(),
            model=input.ticket.model,
            thread_id=input.codex_thread_id,
        )
        payload = AnalysisPayload.model_validate_json(response)
        if payload.ticket_id != input.ticket.ticket_id:
            raise ValueError(
                f"Codex returned {payload.ticket_id}, expected {input.ticket.ticket_id}"
            )
        scope_hash = _scope_hash(payload)
        return AnalysisResult(
            **payload.model_dump(),
            scope_hash=scope_hash,
            codex_thread_id=thread_id,
        )

    @activity.defn(name="inspect_implementation")
    async def inspect_implementation(
        self, input: ImplementationInput
    ) -> ImplementationResult:
        if not input.ticket.shadow_mode:
            raise RuntimeError("Live implementation is intentionally disabled in this PoC")
        prompt = f"""
Read-only shadow review for {input.ticket.ticket_id}.
Approved scope hash: {input.analysis.scope_hash}
Approved scope: {input.analysis.scope_statement}
Inspect the existing worktree, commits, tests, and any already-existing PR metadata that
is locally available. Do not edit, commit, push, create a PR, call deployment workflows,
or change Linear. Return the requested JSON. If there is no existing PR candidate, leave
pr_url and pr_head_sha empty. This is an observation, not implementation authorization.
""".strip()
        response, thread_id = await self._codex.run_read_only(
            cwd=input.ticket.worktree_path,
            prompt=prompt,
            output_schema=ImplementationPayload.model_json_schema(),
            model=input.ticket.model,
            thread_id=input.codex_thread_id,
        )
        payload = ImplementationPayload.model_validate_json(response)
        if not payload.pr_head_sha:
            raise RuntimeError(
                "Shadow review found no existing PR head SHA; workflow cannot request exact-SHA approval"
            )
        return ImplementationResult(
            **payload.model_dump(),
            codex_thread_id=thread_id,
        )

    @activity.defn(name="plan_deployment")
    async def plan_deployment(self, input: DeploymentInput) -> DeploymentResult:
        if not input.ticket.shadow_mode:
            raise RuntimeError("Live deployment is intentionally disabled in this PoC")
        batch = input.backend_batch_id or "frontend-only"
        return DeploymentResult(
            deployment_id=f"shadow:{batch}",
            deployed_sha=f"shadow:{input.approved_sha}",
            status="SHADOW_ONLY_NO_DEPLOYMENT",
        )

    @activity.defn(name="plan_qa")
    async def plan_qa(self, input: QaInput) -> QaResult:
        if not input.ticket.shadow_mode:
            raise RuntimeError("Live QA is intentionally disabled in this PoC")
        return QaResult(
            status="SHADOW_ONLY_NO_QA_MUTATION",
            evidence=[
                f"would verify scope {input.analysis.scope_hash}",
                f"would verify artifact {input.deployed_sha}",
                "would require staging smoke and qaEvidence before Linear QA Request",
            ],
        )


def _scope_hash(payload: AnalysisPayload) -> str:
    scope_contract = {
        "ticket_id": payload.ticket_id,
        "scope_statement": payload.scope_statement,
        "acceptance_criteria": sorted(payload.acceptance_criteria),
        "repositories": sorted(payload.repositories),
        "backend_change": payload.backend_change,
        "unresolved_decisions": sorted(payload.unresolved_decisions),
    }
    canonical = json.dumps(
        scope_contract,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
