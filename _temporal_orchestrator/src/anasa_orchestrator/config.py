from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = PACKAGE_ROOT.parent
PROJECTS_ROOT = REPOSITORY_ROOT.parent


def load_local_environment() -> None:
    for path in (
        REPOSITORY_ROOT / "_customer_board" / ".env.local",
        PACKAGE_ROOT / ".env",
    ):
        if not path.is_file():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key and key not in os.environ:
                os.environ[key] = value.strip().strip('"').strip("'")


@dataclass(frozen=True)
class RepositoryConfig:
    name: str
    checkout: Path
    base_ref: str
    base_branch: str
    integration_branch: str = "integration"
    integration_ref: str = "origin/integration"


@dataclass(frozen=True)
class Settings:
    workspace_root: Path
    repositories: tuple[RepositoryConfig, ...]
    github_owner: str
    backend_deploy_workflow: str
    preview_only: bool
    release_tickets: frozenset[str]


def settings() -> Settings:
    load_local_environment()
    workspace_root = Path(
        os.getenv("ANASA_WORKSPACE_ROOT", str(PROJECTS_ROOT / ".anasa-worktrees"))
    ).expanduser()
    repositories = (
        RepositoryConfig(
            name="be_anasa",
            checkout=Path(os.getenv("ANASA_BE_REPO", str(PROJECTS_ROOT / "be_anasa"))).expanduser(),
            base_ref=os.getenv("ANASA_BE_BASE_REF", "origin/develop"),
            base_branch=os.getenv("ANASA_BE_BASE_BRANCH", "develop"),
            integration_branch=os.getenv("ANASA_BE_INTEGRATION_BRANCH", "integration/backend"),
            integration_ref=os.getenv(
                "ANASA_BE_INTEGRATION_REF",
                "origin/" + os.getenv("ANASA_BE_INTEGRATION_BRANCH", "integration/backend"),
            ),
        ),
        RepositoryConfig(
            name="fe_anasa",
            checkout=Path(os.getenv("ANASA_FE_REPO", str(PROJECTS_ROOT / "fe_anasa"))).expanduser(),
            base_ref=os.getenv("ANASA_FE_BASE_REF", "origin/main"),
            base_branch=os.getenv("ANASA_FE_BASE_BRANCH", "main"),
            integration_branch=os.getenv("ANASA_FE_INTEGRATION_BRANCH", "integration/frontend"),
            integration_ref=os.getenv(
                "ANASA_FE_INTEGRATION_REF",
                "origin/" + os.getenv("ANASA_FE_INTEGRATION_BRANCH", "integration/frontend"),
            ),
        ),
    )
    release_tickets = frozenset(
        value.strip().upper()
        for value in os.getenv("ANASA_RELEASE_TICKETS", "").split(",")
        if value.strip()
    )
    return Settings(
        workspace_root=workspace_root,
        repositories=repositories,
        github_owner=os.getenv("ANASA_GITHUB_OWNER", "litmers-dev"),
        backend_deploy_workflow=os.getenv("ANASA_BACKEND_DEPLOY_WORKFLOW", "deploy-staging.yml"),
        preview_only=os.getenv("ANASA_PREVIEW_ONLY", "true").lower() not in {"0", "false", "no"},
        release_tickets=release_tickets,
    )
