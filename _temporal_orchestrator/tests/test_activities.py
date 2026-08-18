import json

import pytest

from anasa_orchestrator.activities import TicketActivities
from anasa_orchestrator.models import AnalyzeTicketInput, TicketWorkflowInput


class FakeCodex:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.calls: list[dict[str, object]] = []

    async def run_read_only(self, **kwargs: object) -> tuple[str, str]:
        self.calls.append(kwargs)
        return json.dumps(self.payload), "codex-thread-1"


@pytest.mark.asyncio
async def test_analysis_is_structured_and_scope_hash_is_stable() -> None:
    payload = {
        "ticket_id": "ANA-65",
        "scope_statement": "Reject zero quantities while preserving signed integers.",
        "acceptance_criteria": ["-1 and 1 accepted", "0 rejected"],
        "repositories": ["fe_anasa", "be_anasa"],
        "backend_change": True,
        "unresolved_decisions": [],
        "recommendation": "Proceed with the approved FE and BE validation change.",
    }
    fake = FakeCodex(payload)
    activities = TicketActivities(fake)
    input = AnalyzeTicketInput(
        ticket=TicketWorkflowInput("ANA-65", "/tmp/worktree")
    )

    first = await activities.analyze_ticket(input)
    second = await activities.analyze_ticket(input)

    assert first.scope_hash == second.scope_hash
    assert first.backend_change is True
    assert first.codex_thread_id == "codex-thread-1"
    assert fake.calls[0]["cwd"] == "/tmp/worktree"
