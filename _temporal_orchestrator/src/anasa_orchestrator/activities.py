from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict
from temporalio import activity

from .command import run_command
from .config import Settings, settings
from .gitops import GitHubGateway, WorktreeManager
from .linear import LinearGateway
from .models import (
    AnalysisResult,
    AnalyzeTicketInput,
    BackendBatchInput,
    BackendBatchResult,
    CompleteTicketInput,
    CompleteTicketResult,
    DevQuestion,
    ImplementationInput,
    ImplementationResult,
    MergeFrontendInput,
    MergeResult,
    PrArtifact,
    PreparePrInput,
    PreparePrResult,
    StartDevelopmentInput,
    TicketContext,
    TicketWorkflowInput,
    WorkspaceResult,
)


class DevQuestionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocked_decision: str
    impact_scope: str
    options: list[str]
    recommendation: str
    needed_example: str


class AnalysisPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_id: str
    scope_statement: str
    acceptance_criteria: list[str]
    repositories: list[str]
    backend_change: bool
    unresolved_decisions: list[str]
    recommendation: str
    report_markdown: str
    dev_question: DevQuestionPayload | None


class ImplementationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    report_markdown: str
    changed_repositories: list[str]
    verification: list[str]
    risks: list[str]
    column_impact: str
    workbook_basis: str


class CodexPort(Protocol):
    async def run(
        self,
        *,
        cwd: str,
        prompt: str,
        output_schema: dict[str, object],
        model: str | None,
        thread_id: str | None,
        writable: bool,
    ) -> tuple[str, str]: ...


class OpenAICodexPort:
    """Official Codex SDK adapter with explicit per-phase sandboxing."""

    async def run(
        self,
        *,
        cwd: str,
        prompt: str,
        output_schema: dict[str, object],
        model: str | None,
        thread_id: str | None,
        writable: bool,
    ) -> tuple[str, str]:
        from openai_codex import ApprovalMode, AsyncCodex, Sandbox

        sandbox = Sandbox.workspace_write if writable else Sandbox.read_only
        async with AsyncCodex() as codex:
            if thread_id:
                thread = await codex.thread_resume(
                    thread_id,
                    cwd=cwd,
                    model=model,
                    sandbox=sandbox,
                    approval_mode=ApprovalMode.deny_all,
                )
            else:
                thread = await codex.thread_start(
                    cwd=cwd,
                    model=model,
                    sandbox=sandbox,
                    approval_mode=ApprovalMode.deny_all,
                )
            result = await thread.run(
                prompt,
                output_schema=output_schema,
                sandbox=sandbox,
                approval_mode=ApprovalMode.deny_all,
            )
            if not result.final_response:
                raise RuntimeError("Codex returned no final response")
            return result.final_response, thread.id


class TicketActivities:
    def __init__(
        self,
        codex: CodexPort | None = None,
        *,
        config: Settings | None = None,
        linear: LinearGateway | None = None,
    ) -> None:
        self._settings = config or settings()
        self._codex = codex or OpenAICodexPort()
        self._linear = linear or LinearGateway()
        self._worktrees = WorktreeManager(self._settings)
        self._github = GitHubGateway(self._settings)

    @activity.defn(name="prepare_workspace")
    async def prepare_workspace(self, ticket: TicketWorkflowInput) -> WorkspaceResult:
        return await self._worktrees.prepare(ticket.ticket_id)

    @activity.defn(name="fetch_ticket")
    async def fetch_ticket(self, ticket: TicketWorkflowInput) -> TicketContext:
        context = await self._linear.get_ticket(ticket.ticket_id)
        if context.ticket_id != ticket.ticket_id:
            raise RuntimeError(f"Linear returned {context.ticket_id}, expected {ticket.ticket_id}")
        return context

    @activity.defn(name="analyze_ticket")
    async def analyze_ticket(self, input: AnalyzeTicketInput) -> AnalysisResult:
        customer_context = (
            f"\nLatest customer answer:\n{input.customer_answer}\n" if input.customer_answer else ""
        )
        prompt = f"""
Perform the read-only pre-development analysis for {input.ticket.ticket_id}.
Read https://github.com/litmers-dev/anasa-workflow-automation/pull/2, all repository
AGENTS.md files that apply, and relevant Graphiti project decisions. Inspect the supplied
Linear content, all comments, attachments and related-ticket references, source code,
tests and git history.
For any visible table-column change, open the matching source workbook before inspecting
implementation/API/SP/DB/ViewConfig evidence and report the complete column contract.

Do not edit files, install dependencies, commit, push, create a PR, change Linear, deploy,
or mutate a database. Distinguish explicit evidence from inference. report_markdown must
contain the Korean headings `티켓 이해 내용`, `현재 동작과 원인`, `개발 방향`,
`변경 영향`, `검증 계획`, `남은 결정/위험`. If a real customer decision is required,
populate dev_question using exactly the meaning of `[Dev Q]`: 막힌 결정, 영향 범위,
선택지, 추천안, 필요한 예시. Otherwise return dev_question=null. Return only the JSON
required by the output schema. repositories must contain only be_anasa and/or fe_anasa.

Linear ticket JSON:
{json.dumps(asdict(input.context), ensure_ascii=False)}

User instruction supplied from the local control plane:
{input.ticket.user_instruction or "(none)"}

Follow-up instructions added while this Workflow was running:
{json.dumps(input.additional_instructions, ensure_ascii=False)}
{customer_context}
""".strip()
        response, thread_id = await self._codex.run(
            cwd=input.workspace.root_path,
            prompt=prompt,
            output_schema=AnalysisPayload.model_json_schema(),
            model=input.ticket.model,
            thread_id=input.codex_thread_id,
            writable=False,
        )
        payload = AnalysisPayload.model_validate_json(response)
        if payload.ticket_id != input.ticket.ticket_id:
            raise ValueError(
                f"Codex returned {payload.ticket_id}, expected {input.ticket.ticket_id}"
            )
        available = {repo.name for repo in input.workspace.repositories}
        selected = set(payload.repositories)
        if not selected or not selected <= available:
            raise ValueError(
                f"invalid repositories: {sorted(selected)}; available={sorted(available)}"
            )
        if payload.backend_change != ("be_anasa" in selected):
            raise ValueError("backend_change must match whether be_anasa is in repositories")
        required_headings = [
            "티켓 이해 내용",
            "현재 동작과 원인",
            "개발 방향",
            "변경 영향",
            "검증 계획",
            "남은 결정/위험",
        ]
        missing_headings = [
            heading for heading in required_headings if heading not in payload.report_markdown
        ]
        if missing_headings:
            raise ValueError(f"analysis report headings are missing: {', '.join(missing_headings)}")
        if payload.unresolved_decisions and payload.dev_question is None:
            raise ValueError("unresolved decisions require a structured Dev Q")
        dumped = payload.model_dump(exclude={"dev_question"})
        dev_question = (
            DevQuestion(**payload.dev_question.model_dump()) if payload.dev_question else None
        )
        return AnalysisResult(
            **dumped,
            dev_question=dev_question,
            scope_hash=_scope_hash(payload),
            codex_thread_id=thread_id,
        )

    @activity.defn(name="implement_ticket")
    async def implement_ticket(self, input: ImplementationInput) -> ImplementationResult:
        writable = input.ticket.mode == "live"
        mode_instruction = (
            "Implement the approved scope, edit the selected repository worktrees, "
            "and run proportional tests."
            if writable
            else "Inspect and describe the implementation only; do not edit files."
        )
        prompt = f"""
{mode_instruction}

Ticket: {input.ticket.ticket_id} — {input.context.title}
Approved scope hash: {input.analysis.scope_hash}
Approved scope: {input.analysis.scope_statement}
Acceptance criteria: {json.dumps(input.analysis.acceptance_criteria, ensure_ascii=False)}
Allowed repositories: {json.dumps(input.analysis.repositories)}
User instruction: {input.ticket.user_instruction or "(none)"}
Follow-up instructions: {json.dumps(input.additional_instructions, ensure_ascii=False)}

Reconfirm PR #2 and every applicable AGENTS.md and record that in report_markdown.
Preserve unrelated user changes. Do not expand the
approved scope. For visible-column work, obey the screen-design-first workbook gate.
Do not commit, push, create/merge PRs, change Linear, deploy, or mutate shared/staging data;
the Temporal control plane owns those later phases. Run focused tests and static/build
checks appropriate to risk. report_markdown must be a Korean handoff containing 원인,
변경 전/후, 변경 파일과 FE/BE/API/SP/DB/migration/cache 영향, 검증 결과, PR 전 위험.
Return only the requested JSON summary when finished.
""".strip()
        response, thread_id = await self._codex.run(
            cwd=input.workspace.root_path,
            prompt=prompt,
            output_schema=ImplementationPayload.model_json_schema(),
            model=input.ticket.model,
            thread_id=input.codex_thread_id,
            writable=writable,
        )
        payload = ImplementationPayload.model_validate_json(response)
        if not payload.report_markdown.strip():
            raise ValueError("implementation report must not be blank")
        allowed = set(input.analysis.repositories)
        changed = set(payload.changed_repositories)
        if not changed <= allowed:
            raise ValueError(
                f"implementation escaped approved repositories: {sorted(changed - allowed)}"
            )
        return ImplementationResult(**payload.model_dump(), codex_thread_id=thread_id)

    @activity.defn(name="mark_in_progress")
    async def mark_in_progress(self, input: StartDevelopmentInput) -> str:
        if input.ticket.mode != "live":
            return input.context.state
        return await self._linear.ensure_state(input.ticket.ticket_id, "In Progress")

    @activity.defn(name="prepare_prs")
    async def prepare_prs(self, input: PreparePrInput) -> PreparePrResult:
        if input.ticket.mode != "live":
            repositories = set(input.analysis.repositories)
            artifacts = []
            for repo in input.workspace.repositories:
                if repo.name in repositories:
                    head = (
                        await run_command(
                            ["git", "rev-parse", "HEAD"],
                            cwd=Path(repo.worktree_path),
                        )
                    ).stdout.strip()
                    artifacts.append(
                        PrArtifact(
                            repository=repo.name,
                            pr_url="",
                            head_sha=head,
                            branch_name=repo.branch_name,
                            base_branch=repo.base_branch,
                            backend_change=repo.name == "be_anasa",
                            has_changes=False,
                        )
                    )
            return PreparePrResult(artifacts=artifacts, no_change=True)
        return await self._github.prepare_prs(input)

    @activity.defn(name="merge_frontend")
    async def merge_frontend(self, input: MergeFrontendInput) -> MergeResult:
        return await self._github.merge_frontend(input.artifacts, input.authorization)

    @activity.defn(name="complete_ticket")
    async def complete_ticket(self, input: CompleteTicketInput) -> CompleteTicketResult:
        return await self._linear.complete_ticket(input.context, input.evidence)

    @activity.defn(name="execute_backend_batch")
    async def execute_backend_batch(self, input: BackendBatchInput) -> BackendBatchResult:
        return await self._github.merge_and_deploy_backend(input)


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
