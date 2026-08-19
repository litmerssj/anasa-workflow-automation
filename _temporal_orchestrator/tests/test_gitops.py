import subprocess
from pathlib import Path

import pytest

from anasa_orchestrator.config import PROJECTS_ROOT, RepositoryConfig, Settings
from anasa_orchestrator.gitops import (
    GitHubGateway,
    WorktreeManager,
    normalize_ticket_id,
    normalize_ticket_list,
)


def test_ticket_normalization_preserves_order_and_deduplicates() -> None:
    assert normalize_ticket_list("63, ANA-65 63 76") == [
        "ANA-63",
        "ANA-65",
        "ANA-76",
    ]


def test_ticket_batch_is_limited_to_eight() -> None:
    with pytest.raises(ValueError, match="at most 8"):
        normalize_ticket_list("1 2 3 4 5 6 7 8 9")


def test_invalid_ticket_is_rejected() -> None:
    with pytest.raises(ValueError):
        normalize_ticket_id("ANA-zero")


def test_preview_hold_requires_named_ticket_scope() -> None:
    gateway = GitHubGateway(
        Settings(
            workspace_root=Path("/tmp/workspaces"),
            repositories=(),
            github_owner="litmers-dev",
            backend_deploy_workflow="deploy-staging.yml",
            preview_only=True,
            release_tickets=frozenset({"ANA-65"}),
        )
    )
    gateway._require_release_scope(["ANA-65"])
    with pytest.raises(RuntimeError, match="ANA-76"):
        gateway._require_release_scope(["ANA-65", "ANA-76"])


def test_order_frontend_default_is_relative_to_the_checkout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANASA_ORDER_FE_REPO", raising=False)
    gateway = GitHubGateway(
        Settings(
            workspace_root=Path("/tmp/workspaces"),
            repositories=(),
            github_owner="litmers-dev",
            backend_deploy_workflow="deploy-staging.yml",
            preview_only=True,
            release_tickets=frozenset(),
        )
    )

    assert gateway._repository_config("fe_anasa_ord").checkout == PROJECTS_ROOT / "fe-anasa-ord"


def git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.mark.asyncio
async def test_worktree_manager_creates_and_adopts_isolated_ticket_workspace(
    tmp_path: Path,
) -> None:
    origin = tmp_path / "origin.git"
    seed = tmp_path / "seed"
    checkout = tmp_path / "checkout"
    origin.mkdir()
    seed.mkdir()
    git("init", "--bare", cwd=origin)
    git("init", "-b", "develop", cwd=seed)
    git("config", "user.email", "test@example.com", cwd=seed)
    git("config", "user.name", "Test", cwd=seed)
    (seed / "README.md").write_text("seed\n", encoding="utf-8")
    git("add", "README.md", cwd=seed)
    git("commit", "-m", "seed", cwd=seed)
    git("remote", "add", "origin", str(origin), cwd=seed)
    git("push", "-u", "origin", "develop", cwd=seed)
    subprocess.run(
        ["git", "clone", "--branch", "develop", str(origin), str(checkout)],
        check=True,
        capture_output=True,
    )

    config = Settings(
        workspace_root=tmp_path / "workspaces",
        repositories=(
            RepositoryConfig(
                name="be_anasa",
                checkout=checkout,
                base_ref="origin/develop",
                base_branch="develop",
            ),
        ),
        github_owner="litmers-dev",
        backend_deploy_workflow="deploy-staging.yml",
        preview_only=True,
        release_tickets=frozenset(),
    )
    manager = WorktreeManager(config)
    created = await manager.prepare("ANA-65")
    adopted = await manager.prepare("ANA-65")

    assert created == adopted
    assert Path(created.repositories[0].worktree_path).is_dir()
    assert created.repositories[0].branch_name == "codex/ana-65-temporal"

    existing = tmp_path / "existing-ana-66"
    subprocess.run(
        [
            "git",
            "worktree",
            "add",
            "-b",
            "codex/ana-66-existing",
            str(existing),
            "origin/develop",
        ],
        cwd=checkout,
        check=True,
        capture_output=True,
    )
    with pytest.raises(RuntimeError, match="automatic duplication is blocked"):
        await manager.prepare("ANA-66")

    near_prefix = tmp_path / "existing-ana-680"
    subprocess.run(
        [
            "git",
            "worktree",
            "add",
            "-b",
            "codex/ana-680-existing",
            str(near_prefix),
            "origin/develop",
        ],
        cwd=checkout,
        check=True,
        capture_output=True,
    )
    created_ana_68 = await manager.prepare("ANA-68")
    assert created_ana_68.repositories[0].branch_name == "codex/ana-68-temporal"

    phantom = tmp_path / "phantom-ana-69"
    subprocess.run(
        [
            "git",
            "worktree",
            "add",
            "-b",
            "codex/ana-69-existing",
            str(phantom),
            "origin/develop",
        ],
        cwd=checkout,
        check=True,
        capture_output=True,
    )
    (phantom / ".git").unlink()
    created_ana_69 = await manager.prepare("ANA-69")
    assert created_ana_69.repositories[0].branch_name == "codex/ana-69-temporal"
