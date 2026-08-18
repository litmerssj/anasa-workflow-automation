import pytest

from anasa_orchestrator.linear import _evidence_body
from anasa_orchestrator.models import QaEvidence


def test_qa_evidence_matches_workflow_core_contract() -> None:
    body = _evidence_body(QaEvidence("ANA-65", "PR #1 / abc", "passed", "old", "new"))
    assert body.splitlines() == [
        "[개발완료]",
        "PR/커밋: PR #1 / abc",
        "스모크: passed",
        "수정 전: old",
        "수정 후: new",
    ]


def test_qa_evidence_rejects_missing_real_evidence() -> None:
    with pytest.raises(ValueError, match="스모크"):
        _evidence_body(QaEvidence("ANA-65", "PR", "", "old", "new"))
