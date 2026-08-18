from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TicketPhase(str, Enum):
    ANALYZE = "ANALYZE"
    WAIT_CUSTOMER_ANSWER = "WAIT_CUSTOMER_ANSWER"
    WAIT_DIRECTION_APPROVAL = "WAIT_DIRECTION_APPROVAL"
    IMPLEMENT = "IMPLEMENT"
    WAIT_PR_APPROVAL = "WAIT_PR_APPROVAL"
    WAIT_BACKEND_BATCH = "WAIT_BACKEND_BATCH"
    DEPLOY = "DEPLOY"
    QA = "QA"
    COMPLETE = "COMPLETE"
    BLOCKED = "BLOCKED"


@dataclass
class TicketWorkflowInput:
    ticket_id: str
    worktree_path: str
    model: str | None = None
    shadow_mode: bool = True


@dataclass
class AnalyzeTicketInput:
    ticket: TicketWorkflowInput
    customer_answer: str | None = None
    codex_thread_id: str | None = None


@dataclass
class AnalysisResult:
    ticket_id: str
    scope_statement: str
    acceptance_criteria: list[str]
    repositories: list[str]
    backend_change: bool
    unresolved_decisions: list[str]
    recommendation: str
    scope_hash: str
    codex_thread_id: str


@dataclass
class ImplementationInput:
    ticket: TicketWorkflowInput
    analysis: AnalysisResult
    codex_thread_id: str | None = None


@dataclass
class ImplementationResult:
    summary: str
    pr_url: str
    pr_head_sha: str
    backend_change: bool
    verification: list[str]
    risks: list[str]
    codex_thread_id: str


@dataclass
class DirectionApproval:
    ticket_id: str
    scope_hash: str
    approved_by: str


@dataclass
class PrApproval:
    ticket_id: str
    exact_sha: str
    approved_by: str


@dataclass
class CustomerAnswer:
    ticket_id: str
    answer: str


@dataclass
class BackendBatchRelease:
    ticket_id: str
    batch_id: str
    approved_sha: str


@dataclass
class DeploymentInput:
    ticket: TicketWorkflowInput
    approved_sha: str
    backend_batch_id: str | None


@dataclass
class DeploymentResult:
    deployment_id: str
    deployed_sha: str
    status: str


@dataclass
class QaInput:
    ticket: TicketWorkflowInput
    deployed_sha: str
    analysis: AnalysisResult


@dataclass
class QaResult:
    status: str
    evidence: list[str]


@dataclass
class TicketSnapshot:
    ticket_id: str = ""
    current_state: str = TicketPhase.ANALYZE.value
    worktree_path: str = ""
    codex_thread_id: str | None = None
    scope_hash: str | None = None
    pr_head_sha: str | None = None
    approved_sha: str | None = None
    backend_change: bool | None = None
    backend_batch_id: str | None = None
    deployed_sha: str | None = None
    qa_status: str | None = None
    last_failure: str | None = None
    shadow_mode: bool = True
    external_effects: bool = False
    transitions: list[str] = field(default_factory=list)
