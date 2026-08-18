from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TicketPhase(str, Enum):
    PREPARE_WORKSPACE = "PREPARE_WORKSPACE"
    FETCH_TICKET = "FETCH_TICKET"
    ANALYZE = "ANALYZE"
    WAIT_CUSTOMER_ANSWER = "WAIT_CUSTOMER_ANSWER"
    WAIT_DIRECTION_APPROVAL = "WAIT_DIRECTION_APPROVAL"
    START_DEVELOPMENT = "START_DEVELOPMENT"
    IMPLEMENT = "IMPLEMENT"
    PREPARE_PR = "PREPARE_PR"
    WAIT_PR_APPROVAL = "WAIT_PR_APPROVAL"
    WAIT_BACKEND_BATCH = "WAIT_BACKEND_BATCH"
    WAIT_RELEASE_AUTHORIZATION = "WAIT_RELEASE_AUTHORIZATION"
    MERGE_FRONTEND = "MERGE_FRONTEND"
    WAIT_QA_EVIDENCE = "WAIT_QA_EVIDENCE"
    COMPLETE_LINEAR = "COMPLETE_LINEAR"
    COMPLETE = "COMPLETE"
    BLOCKED = "BLOCKED"


class BatchPhase(str, Enum):
    MERGE = "MERGE"
    DEPLOY = "DEPLOY"
    COMPLETE = "COMPLETE"
    BLOCKED = "BLOCKED"


@dataclass
class TicketWorkflowInput:
    ticket_id: str
    mode: str = "live"
    model: str | None = None
    user_instruction: str = ""


@dataclass
class RepositoryWorkspace:
    name: str
    source_checkout: str
    worktree_path: str
    branch_name: str
    base_ref: str
    base_branch: str


@dataclass
class WorkspaceResult:
    root_path: str
    repositories: list[RepositoryWorkspace]


@dataclass
class TicketComment:
    id: str
    body: str
    created_at: str
    author: str


@dataclass
class TicketAttachment:
    id: str
    title: str
    url: str
    subtitle: str


@dataclass
class RelatedTicket:
    relation_type: str
    identifier: str
    title: str
    url: str


@dataclass
class TicketContext:
    issue_id: str
    ticket_id: str
    title: str
    description: str
    url: str
    state: str
    team_id: str
    comments: list[TicketComment]
    attachments: list[TicketAttachment]
    related_tickets: list[RelatedTicket]


@dataclass
class AnalyzeTicketInput:
    ticket: TicketWorkflowInput
    workspace: WorkspaceResult
    context: TicketContext
    customer_answer: str | None = None
    additional_instructions: list[str] = field(default_factory=list)
    codex_thread_id: str | None = None


@dataclass
class DevQuestion:
    blocked_decision: str
    impact_scope: str
    options: list[str]
    recommendation: str
    needed_example: str


@dataclass
class AnalysisResult:
    ticket_id: str
    scope_statement: str
    acceptance_criteria: list[str]
    repositories: list[str]
    backend_change: bool
    unresolved_decisions: list[str]
    recommendation: str
    report_markdown: str
    dev_question: DevQuestion | None
    scope_hash: str
    codex_thread_id: str


@dataclass
class ImplementationInput:
    ticket: TicketWorkflowInput
    workspace: WorkspaceResult
    context: TicketContext
    analysis: AnalysisResult
    additional_instructions: list[str] = field(default_factory=list)
    codex_thread_id: str | None = None


@dataclass
class StartDevelopmentInput:
    ticket: TicketWorkflowInput
    context: TicketContext


@dataclass
class ImplementationResult:
    summary: str
    report_markdown: str
    changed_repositories: list[str]
    verification: list[str]
    risks: list[str]
    column_impact: str
    workbook_basis: str
    codex_thread_id: str


@dataclass
class PreparePrInput:
    ticket: TicketWorkflowInput
    workspace: WorkspaceResult
    context: TicketContext
    analysis: AnalysisResult
    implementation: ImplementationResult


@dataclass
class PrArtifact:
    repository: str
    pr_url: str
    head_sha: str
    branch_name: str
    base_branch: str
    backend_change: bool
    has_changes: bool


@dataclass
class PreparePrResult:
    artifacts: list[PrArtifact]
    no_change: bool


@dataclass
class DirectionApproval:
    ticket_id: str
    scope_hash: str
    approved_by: str


@dataclass
class PrApproval:
    ticket_id: str
    exact_shas: dict[str, str]
    approved_by: str


@dataclass
class CustomerAnswer:
    ticket_id: str
    answer: str


@dataclass
class BackendBatchAssignment:
    ticket_id: str
    batch_id: str
    exact_shas: dict[str, str]


@dataclass
class BackendBatchCompletion:
    ticket_id: str
    batch_id: str
    deployed_sha: str
    deployment_url: str


@dataclass
class ReleaseAuthorization:
    ticket_id: str
    exact_shas: dict[str, str]
    allow_frontend_production: bool
    approved_by: str


@dataclass
class MergeFrontendInput:
    ticket: TicketWorkflowInput
    artifacts: list[PrArtifact]
    authorization: ReleaseAuthorization


@dataclass
class MergeResult:
    merged_shas: dict[str, str]
    deployment_urls: list[str]


@dataclass
class QaEvidence:
    ticket_id: str
    pr_commit: str
    smoke: str
    before: str
    after: str


@dataclass
class CompleteTicketInput:
    context: TicketContext
    evidence: QaEvidence


@dataclass
class CompleteTicketResult:
    comment_id: str
    state: str


@dataclass
class RetryRequest:
    ticket_id: str
    requested_by: str


@dataclass
class WorkflowInstruction:
    ticket_id: str
    prompt: str
    author: str


@dataclass
class TicketSnapshot:
    ticket_id: str = ""
    current_state: str = TicketPhase.PREPARE_WORKSPACE.value
    mode: str = "live"
    workspace_path: str | None = None
    codex_thread_id: str | None = None
    scope_hash: str | None = None
    analysis_summary: str | None = None
    analysis_report: str | None = None
    dev_question: DevQuestion | None = None
    implementation_report: str | None = None
    unresolved_decisions: list[str] = field(default_factory=list)
    pr_artifacts: list[PrArtifact] = field(default_factory=list)
    approved_shas: dict[str, str] = field(default_factory=dict)
    backend_change: bool | None = None
    backend_batch_id: str | None = None
    deployed_sha: str | None = None
    deployment_urls: list[str] = field(default_factory=list)
    qa_status: str | None = None
    last_failure: str | None = None
    resume_state: str | None = None
    instruction_history: list[str] = field(default_factory=list)
    external_effects: bool = False
    transitions: list[str] = field(default_factory=list)


@dataclass
class BackendBatchItem:
    ticket_id: str
    workflow_id: str
    artifacts: list[PrArtifact]
    approved_shas: dict[str, str]


@dataclass
class BackendBatchInput:
    batch_id: str
    items: list[BackendBatchItem]
    approved_by: str


@dataclass
class BackendBatchResult:
    batch_id: str
    deployed_sha: str
    deployment_url: str
    merged_shas: dict[str, str]


@dataclass
class BackendBatchSnapshot:
    batch_id: str = ""
    current_state: str = BatchPhase.MERGE.value
    tickets: list[str] = field(default_factory=list)
    deployed_sha: str | None = None
    deployment_url: str | None = None
    merged_shas: dict[str, str] = field(default_factory=dict)
    report_markdown: str | None = None
    last_failure: str | None = None
    transitions: list[str] = field(default_factory=list)


@dataclass
class VisibleTicketInput:
    ticket_id: str
    codex_thread_id: str
    worktree_path: str
    initial_state: str = "ANALYZE"


@dataclass
class VisibleStateUpdate:
    ticket_id: str
    state: str
    summary: str = ""
    report_markdown: str = ""
    scope_hash: str | None = None
    pr_urls: list[str] = field(default_factory=list)
    exact_shas: dict[str, str] = field(default_factory=dict)
    completed: bool = False


@dataclass
class VisibleDirectionApproval:
    ticket_id: str
    scope_hash: str
    approved_by: str


@dataclass
class VisibleTicketSnapshot:
    ticket_id: str = ""
    codex_thread_id: str = ""
    worktree_path: str = ""
    current_state: str = "ANALYZE"
    summary: str = ""
    report_markdown: str = ""
    scope_hash: str | None = None
    approved_scope_hash: str | None = None
    approved_by: str | None = None
    pr_urls: list[str] = field(default_factory=list)
    exact_shas: dict[str, str] = field(default_factory=dict)
    instruction_history: list[str] = field(default_factory=list)
    completed: bool = False
    transitions: list[str] = field(default_factory=list)
