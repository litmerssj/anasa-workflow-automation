import json

import pytest

from anasa_orchestrator.activities import TicketActivities
from anasa_orchestrator.models import (
    AnalyzeTicketInput,
    ImplementationInput,
    RepositoryWorkspace,
    TicketComment,
    TicketContext,
    TicketWorkflowInput,
    WorkspaceResult,
)


class FakeCodex:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = payloads
        self.calls: list[dict[str, object]] = []

    async def run(self, **kwargs: object) -> tuple[str, str]:
        self.calls.append(kwargs)
        return json.dumps(self.payloads.pop(0)), "codex-thread-1"


def context() -> TicketContext:
    return TicketContext(
        issue_id="issue-65",
        ticket_id="ANA-65",
        title="Signed quantity",
        description="Allow signed non-zero integers.",
        url="https://linear.test/ANA-65",
        state="In Progress",
        team_id="team",
        comments=[TicketComment("c1", "customer answer", "2026-08-18", "customer")],
        attachments=[],
        related_tickets=[],
    )


ANALYSIS_REPORT = "\n".join(
    [
        "티켓 이해 내용",
        "현재 동작과 원인",
        "개발 방향",
        "변경 영향",
        "검증 계획",
        "남은 결정/위험",
    ]
)


@pytest.mark.asyncio
async def test_analysis_is_structured_and_scope_hash_ignores_report_wording() -> None:
    base = {
        "ticket_id": "ANA-65",
        "scope_statement": "Reject zero quantities while preserving signed integers.",
        "acceptance_criteria": ["-1 and 1 accepted", "0 rejected"],
        "repositories": ["fe_anasa", "be_anasa"],
        "backend_change": True,
        "unresolved_decisions": [],
        "dev_question": None,
    }
    fake = FakeCodex(
        [
            {**base, "recommendation": "first", "report_markdown": ANALYSIS_REPORT},
            {**base, "recommendation": "second", "report_markdown": ANALYSIS_REPORT + "\nchanged"},
        ]
    )
    activities = TicketActivities(fake)
    input = AnalyzeTicketInput(
        ticket=TicketWorkflowInput("ANA-65"),
        workspace=WorkspaceResult(
            "/tmp/worktree",
            [
                RepositoryWorkspace("be_anasa", "", "", "", "", ""),
                RepositoryWorkspace("fe_anasa", "", "", "", "", ""),
            ],
        ),
        context=context(),
    )

    first = await activities.analyze_ticket(input)
    second = await activities.analyze_ticket(input)

    assert first.scope_hash == second.scope_hash
    assert first.backend_change is True
    assert first.codex_thread_id == "codex-thread-1"
    assert fake.calls[0]["writable"] is False


@pytest.mark.asyncio
async def test_implementation_uses_workspace_write_only_in_live_mode() -> None:
    fake = FakeCodex(
        [
            {
                "summary": "implemented",
                "report_markdown": "implementation report",
                "changed_repositories": ["be_anasa"],
                "verification": ["pytest passed"],
                "risks": [],
                "column_impact": "none",
                "workbook_basis": "none",
            }
        ]
    )
    activities = TicketActivities(fake)
    from anasa_orchestrator.models import AnalysisResult

    analysis = AnalysisResult(
        ticket_id="ANA-65",
        scope_statement="scope",
        acceptance_criteria=["criterion"],
        repositories=["be_anasa"],
        backend_change=True,
        unresolved_decisions=[],
        recommendation="go",
        report_markdown="analysis",
        dev_question=None,
        scope_hash="scope-v1",
        codex_thread_id="thread",
    )
    await activities.implement_ticket(
        ImplementationInput(
            ticket=TicketWorkflowInput("ANA-65", mode="live"),
            workspace=WorkspaceResult("/tmp/worktree", []),
            context=context(),
            analysis=analysis,
        )
    )
    assert fake.calls[0]["writable"] is True
