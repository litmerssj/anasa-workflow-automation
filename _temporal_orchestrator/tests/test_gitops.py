import json
import subprocess
from pathlib import Path

import pytest

from anasa_orchestrator.command import CommandResult
from anasa_orchestrator.config import PROJECTS_ROOT, RepositoryConfig, Settings
from anasa_orchestrator.gitops import (
    GitHubGateway,
    WorktreeManager,
    normalize_ticket_id,
    normalize_ticket_list,
)
from anasa_orchestrator.models import (
    BackendBatchDeploymentInput,
    BackendBatchInput,
    BackendBatchItem,
    DeploymentRequest,
    PrArtifact,
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


def backend_gateway(tmp_path: Path) -> GitHubGateway:
    return GitHubGateway(
        Settings(
            workspace_root=tmp_path / "workspaces",
            repositories=(
                RepositoryConfig(
                    name="be_anasa",
                    checkout=tmp_path / "backend",
                    base_ref="origin/develop",
                    base_branch="develop",
                    integration_ref="origin/integration/backend",
                    integration_branch="integration/backend",
                ),
            ),
            github_owner="litmers-dev",
            backend_deploy_workflow="deploy-staging.yml",
            preview_only=False,
            release_tickets=frozenset(),
        )
    )


def backend_batch() -> BackendBatchInput:
    return BackendBatchInput(
        batch_id="batch-1",
        items=[
            BackendBatchItem(
                ticket_id="ANA-489",
                workflow_id="anasa-session-v3-ANA-489",
                artifacts=[
                    PrArtifact(
                        repository="be_anasa",
                        pr_url="https://github.com/litmers-dev/be_anasa/pull/512",
                        head_sha="approved-head",
                        branch_name="codex/ana-489",
                        base_branch="develop",
                        backend_change=True,
                        has_changes=True,
                    )
                ],
                approved_shas={"be_anasa": "approved-head"},
            )
        ],
        approved_by="tester",
    )


async def async_value(value):
    return value


@pytest.mark.asyncio
async def test_backend_batch_targets_persistent_integration_branch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    gateway = backend_gateway(tmp_path)
    captured: dict[str, object] = {}

    async def fake_run_command(args, **kwargs):
        command = list(args)
        if command[:3] == ["gh", "pr", "view"]:
            return CommandResult(
                json.dumps({"headRefOid": "approved-head", "state": "OPEN"}), "", 0
            )
        return CommandResult("", "", 0)

    async def fake_create(*args, **kwargs) -> PrArtifact:
        captured["base_branch"] = args[2]
        captured["base_ref"] = args[3]
        captured["refresh_branch"] = kwargs["refresh_branch"]
        return PrArtifact(
            repository="be_anasa",
            pr_url="https://github.com/litmers-dev/be_anasa/pull/999",
            head_sha="integration-head",
            branch_name="codex/backend-batch-batch-1",
            base_branch="integration/backend",
            backend_change=True,
            has_changes=True,
        )

    monkeypatch.setattr("anasa_orchestrator.gitops.run_command", fake_run_command)
    monkeypatch.setattr(
        gateway, "_ensure_integration_branch", lambda _: async_value("origin/integration/backend")
    )
    monkeypatch.setattr(gateway, "_repository_slug", lambda _: async_value("litmers-dev/be_anasa"))
    monkeypatch.setattr(gateway, "_create_repository_batch_pr", fake_create)
    monkeypatch.setattr(gateway, "_merge_pr", lambda artifact: async_value(artifact.head_sha))

    result = await gateway.merge_backend_batch(backend_batch())

    assert captured == {
        "base_branch": "integration/backend",
        "base_ref": "origin/integration/backend",
        "refresh_branch": "develop",
    }
    assert result.integration_branch == "integration/backend"
    assert result.integration_sha == "integration-head"


@pytest.mark.asyncio
async def test_backend_deployment_waits_on_integration_branch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    gateway = backend_gateway(tmp_path)
    observed: dict[str, str] = {}

    async def fake_run_command(args, **kwargs):
        command = list(args)
        if command[:3] == ["git", "merge-base", "--is-ancestor"]:
            assert command[-1] == "origin/integration/backend"
        return CommandResult("", "", 0)

    async def fake_wait(slug: str, sha: str, branch: str) -> str:
        observed.update(slug=slug, sha=sha, branch=branch)
        return "https://github.test/actions/runs/1"

    monkeypatch.setattr("anasa_orchestrator.gitops.run_command", fake_run_command)
    monkeypatch.setattr(gateway, "_repository_slug", lambda _: async_value("litmers-dev/be_anasa"))
    monkeypatch.setattr(gateway, "_wait_for_backend_deployment", fake_wait)

    result = await gateway.deploy_backend_batch(
        BackendBatchDeploymentInput(backend_batch(), "integration-head")
    )

    assert observed == {
        "slug": "litmers-dev/be_anasa",
        "sha": "integration-head",
        "branch": "integration/backend",
    }
    assert result.deployed_sha == "integration-head"


@pytest.mark.asyncio
async def test_backend_deployment_dispatches_staging_workflow_from_integration_branch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    gateway = backend_gateway(tmp_path)
    captured: dict[str, object] = {}

    async def fake_run_command(args, **kwargs):
        command = list(args)
        if command[:3] == ["git", "merge-base", "--is-ancestor"]:
            return CommandResult("", "", 0)
        if command[:3] == ["gh", "workflow", "run"]:
            captured["command"] = command
        return CommandResult("", "", 0)

    async def fake_wait(slug: str, sha: str, branch: str, *, request_id: str = "") -> str:
        captured["wait"] = (slug, sha, branch, request_id)
        return "https://github.test/actions/runs/2"

    monkeypatch.setattr("anasa_orchestrator.gitops.run_command", fake_run_command)
    monkeypatch.setattr(gateway, "_repository_slug", lambda _: async_value("litmers-dev/be_anasa"))
    monkeypatch.setattr(gateway, "_wait_for_backend_deployment", fake_wait)

    result = await gateway.deploy_backend_batch(
        BackendBatchDeploymentInput(
            backend_batch(),
            "integration-head",
            DeploymentRequest(
                "batch-1",
                "tester",
                request_id="release-batch-1",
                manifest_hash="sha256:" + "b" * 64,
                candidate_receipt_id="candidate-receipt-1",
            ),
        )
    )

    command = captured["command"]
    assert command[:8] == [
        "gh",
        "workflow",
        "run",
        "deploy-staging.yml",
        "--repo",
        "litmers-dev/be_anasa",
        "--ref",
        "integration/backend",
    ]
    assert "--field" in command
    assert "backend_sha=integration-head" in command
    assert "request_id=release-batch-1" in command
    assert captured["wait"] == (
        "litmers-dev/be_anasa",
        "integration-head",
        "integration/backend",
        "release-batch-1",
    )
    assert result.deployed_sha == "integration-head"


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
