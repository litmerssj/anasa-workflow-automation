from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path

from .command import CommandError, run_command
from .config import RepositoryConfig, Settings
from .models import (
    BackendBatchInput,
    BackendBatchItem,
    BackendBatchResult,
    MergeResult,
    PrArtifact,
    PreparePrInput,
    PreparePrResult,
    ReleaseAuthorization,
    RepositoryWorkspace,
    WorkspaceResult,
)

TICKET_PATTERN = re.compile(r"^ANA-[1-9][0-9]*$")


def normalize_ticket_id(value: str) -> str:
    stripped = value.strip().upper()
    if stripped.isdigit():
        stripped = f"ANA-{int(stripped)}"
    if not TICKET_PATTERN.fullmatch(stripped):
        raise ValueError(f"invalid ANASA ticket: {value}")
    return stripped


def normalize_ticket_list(value: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for token in re.split(r"[\s,]+", value.strip()):
        if not token:
            continue
        ticket_id = normalize_ticket_id(token)
        if ticket_id not in seen:
            normalized.append(ticket_id)
            seen.add(ticket_id)
    if not normalized:
        raise ValueError("at least one ticket is required")
    if len(normalized) > 8:
        raise ValueError("at most 8 tickets can be started in one batch")
    return normalized


class WorktreeManager:
    def __init__(self, config: Settings) -> None:
        self._settings = config

    async def prepare(self, ticket_id: str) -> WorkspaceResult:
        ticket_id = normalize_ticket_id(ticket_id)
        root = (self._settings.workspace_root / ticket_id).resolve()
        root.mkdir(parents=True, exist_ok=True)
        repositories: list[RepositoryWorkspace] = []
        for config in self._settings.repositories:
            source = config.checkout.resolve()
            if not source.is_dir() or not (source / ".git").exists():
                raise RuntimeError(f"repository checkout is missing: {source}")
            worktree = (root / config.name).resolve()
            if root not in worktree.parents:
                raise RuntimeError(f"worktree escaped workspace root: {worktree}")
            branch = f"codex/{ticket_id.lower()}-temporal"
            if worktree.exists():
                await self._validate_existing_worktree(worktree, branch)
            else:
                collisions = await self._existing_ticket_worktrees(source, ticket_id, worktree)
                if collisions:
                    raise RuntimeError(
                        "existing ticket worktree detected; automatic duplication is blocked: "
                        + ", ".join(str(path) for path in collisions)
                    )
                await run_command(["git", "fetch", "origin", config.base_branch], cwd=source)
                branch_exists = await run_command(
                    ["git", "show-ref", "--verify", f"refs/heads/{branch}"],
                    cwd=source,
                    check=False,
                )
                if branch_exists.returncode == 0:
                    await run_command(["git", "worktree", "add", str(worktree), branch], cwd=source)
                else:
                    await run_command(
                        [
                            "git",
                            "worktree",
                            "add",
                            "-b",
                            branch,
                            str(worktree),
                            config.base_ref,
                        ],
                        cwd=source,
                    )
            repositories.append(
                RepositoryWorkspace(
                    name=config.name,
                    source_checkout=str(source),
                    worktree_path=str(worktree),
                    branch_name=branch,
                    base_ref=config.base_ref,
                    base_branch=config.base_branch,
                )
            )
        return WorkspaceResult(root_path=str(root), repositories=repositories)

    async def _existing_ticket_worktrees(
        self, source: Path, ticket_id: str, expected: Path
    ) -> list[Path]:
        listed = await run_command(["git", "worktree", "list", "--porcelain"], cwd=source)
        marker = ticket_id.lower()
        ticket_pattern = re.compile(rf"(?<![0-9]){re.escape(marker)}(?![0-9])")
        matches: list[Path] = []
        for block in listed.stdout.strip().split("\n\n"):
            fields = {
                line.split(" ", 1)[0]: line.split(" ", 1)[1]
                for line in block.splitlines()
                if " " in line
            }
            raw_path = fields.get("worktree")
            if not raw_path:
                continue
            path = Path(raw_path).resolve()
            if path in {source, expected}:
                continue
            if not (path / ".git").exists():
                continue
            branch = fields.get("branch", "").lower()
            if ticket_pattern.search(branch) or ticket_pattern.search(path.name.lower()):
                matches.append(path)
        return matches

    async def _validate_existing_worktree(self, path: Path, branch: str) -> None:
        top = (await run_command(["git", "rev-parse", "--show-toplevel"], cwd=path)).stdout.strip()
        if Path(top).resolve() != path:
            raise RuntimeError(f"existing path is not the expected worktree: {path}")
        current_branch = (
            await run_command(["git", "branch", "--show-current"], cwd=path)
        ).stdout.strip()
        if current_branch != branch:
            raise RuntimeError(f"existing worktree branch mismatch: {current_branch} != {branch}")
        status = (await run_command(["git", "status", "--porcelain"], cwd=path)).stdout.strip()
        if status:
            raise RuntimeError(
                f"existing worktree has uncommitted changes before implementation: {path}"
            )


class GitHubGateway:
    def __init__(self, config: Settings) -> None:
        self._settings = config

    async def prepare_prs(self, input: PreparePrInput) -> PreparePrResult:
        artifacts: list[PrArtifact] = []
        selected = set(input.analysis.repositories)
        for repository in input.workspace.repositories:
            if repository.name in selected:
                continue
            unexpected = (
                await run_command(
                    ["git", "status", "--porcelain"],
                    cwd=Path(repository.worktree_path),
                )
            ).stdout.strip()
            if unexpected:
                raise RuntimeError(f"unapproved repository was modified: {repository.name}")
        for repository in input.workspace.repositories:
            if repository.name not in selected:
                continue
            path = Path(repository.worktree_path)
            current_branch = (
                await run_command(["git", "branch", "--show-current"], cwd=path)
            ).stdout.strip()
            if current_branch != repository.branch_name:
                raise RuntimeError(f"branch changed for {repository.name}: {current_branch}")
            status = (await run_command(["git", "status", "--porcelain"], cwd=path)).stdout.strip()
            has_changes = bool(status)
            if has_changes:
                await run_command(["git", "add", "-A"], cwd=path)
                await run_command(
                    [
                        "git",
                        "commit",
                        "-m",
                        f"fix({input.ticket.ticket_id}): implement approved scope",
                    ],
                    cwd=path,
                )
                await run_command(
                    ["git", "push", "-u", "origin", repository.branch_name],
                    cwd=path,
                )
            head_sha = (await run_command(["git", "rev-parse", "HEAD"], cwd=path)).stdout.strip()
            pr_url = ""
            if has_changes:
                slug = await self._repository_slug(path)
                existing = await run_command(
                    [
                        "gh",
                        "pr",
                        "view",
                        repository.branch_name,
                        "--repo",
                        slug,
                        "--json",
                        "url,headRefOid,state",
                    ],
                    cwd=path,
                    check=False,
                )
                if existing.returncode == 0:
                    viewed = json.loads(existing.stdout)
                    if viewed["headRefOid"] != head_sha:
                        raise RuntimeError(f"remote PR head mismatch for {repository.name}")
                    pr_url = viewed["url"]
                else:
                    created = await run_command(
                        [
                            "gh",
                            "pr",
                            "create",
                            "--repo",
                            slug,
                            "--base",
                            repository.base_branch,
                            "--head",
                            repository.branch_name,
                            "--title",
                            f"[{input.ticket.ticket_id}] {input.context.title}",
                            "--body",
                            _pr_body(input, repository.name),
                        ],
                        cwd=path,
                    )
                    pr_url = created.stdout.strip().splitlines()[-1]
            artifacts.append(
                PrArtifact(
                    repository=repository.name,
                    pr_url=pr_url,
                    head_sha=head_sha,
                    branch_name=repository.branch_name,
                    base_branch=repository.base_branch,
                    backend_change=repository.name == "be_anasa",
                    has_changes=has_changes,
                )
            )
        changed = [artifact for artifact in artifacts if artifact.has_changes]
        return PreparePrResult(artifacts=artifacts, no_change=not changed)

    async def merge_frontend(
        self,
        artifacts: list[PrArtifact],
        authorization: ReleaseAuthorization,
    ) -> MergeResult:
        self._require_release_scope([authorization.ticket_id])
        if not authorization.allow_frontend_production:
            raise RuntimeError("frontend production release was not authorized")
        merged: dict[str, str] = {}
        urls: list[str] = []
        for artifact in artifacts:
            if artifact.repository != "fe_anasa" or not artifact.has_changes:
                continue
            expected = authorization.exact_shas.get(artifact.repository)
            if expected != artifact.head_sha:
                raise RuntimeError("frontend release authorization is stale")
            merge_sha = await self._merge_pr(artifact)
            merged[artifact.repository] = merge_sha
            urls.append(self._environment_url("ANASA_FRONTEND_URL", "https://erp2.spjoint.com"))
        return MergeResult(merged_shas=merged, deployment_urls=urls)

    async def merge_and_deploy_backend(self, input: BackendBatchInput) -> BackendBatchResult:
        started = time.perf_counter()
        phase_durations: dict[str, float] = {}
        self._require_release_scope([item.ticket_id for item in input.items])
        artifacts = [
            artifact
            for item in input.items
            for artifact in item.artifacts
            if artifact.repository == "be_anasa" and artifact.has_changes
        ]
        if not artifacts:
            raise RuntimeError("backend batch contains no backend PR")
        approved_heads: dict[str, str] = {}

        async def validate_item(item: BackendBatchItem) -> tuple[str, str]:
            artifact = next(
                artifact
                for artifact in item.artifacts
                if artifact.repository == "be_anasa" and artifact.has_changes
            )
            if item.approved_shas.get("be_anasa") != artifact.head_sha:
                raise RuntimeError(f"approved backend SHA is stale for {item.ticket_id}")
            viewed = await run_command(
                [
                    "gh",
                    "pr",
                    "view",
                    artifact.pr_url,
                    "--json",
                    "headRefOid,state",
                ]
            )
            pr = json.loads(viewed.stdout)
            if pr.get("headRefOid") != artifact.head_sha:
                raise RuntimeError(f"backend PR head changed for {item.ticket_id}")
            if pr.get("state") != "OPEN":
                raise RuntimeError(f"backend PR is not open for {item.ticket_id}")
            return item.ticket_id, artifact.head_sha

        validated = await asyncio.gather(*(validate_item(item) for item in input.items))
        approved_heads.update(validated)
        phase_durations["validate_candidates"] = time.perf_counter() - started

        backend = self._repository_config("be_anasa")
        await run_command(["git", "fetch", "origin", backend.base_branch], cwd=backend.checkout)
        slug = await self._repository_slug(backend.checkout)
        assemble_started = time.perf_counter()
        batch_artifact = await self._create_repository_batch_pr(
            input,
            backend.checkout,
            backend.base_branch,
            backend.base_ref,
            slug,
            repository_name="be_anasa",
            branch_prefix="backend-batch",
            root_name="backend-batches",
        )
        phase_durations["assemble_integration_pr"] = time.perf_counter() - assemble_started
        merge_started = time.perf_counter()
        deployed_sha = await self._merge_pr(batch_artifact)
        phase_durations["merge_integration_pr"] = time.perf_counter() - merge_started
        deploy_started = time.perf_counter()
        deployment_url = await self._wait_for_backend_deployment(slug, deployed_sha)
        phase_durations["wait_for_deployment"] = time.perf_counter() - deploy_started
        phase_durations["total"] = time.perf_counter() - started
        return BackendBatchResult(
            batch_id=input.batch_id,
            deployed_sha=deployed_sha,
            deployment_url=deployment_url,
            merged_shas=approved_heads,
            phase_durations=phase_durations,
        )

    async def merge_and_deploy_frontend(self, input: BackendBatchInput) -> BackendBatchResult:
        started = time.perf_counter()
        phase_durations: dict[str, float] = {}
        self._require_release_scope([item.ticket_id for item in input.items])

        async def validate_item(item: BackendBatchItem) -> tuple[str, str]:
            artifact = next(
                artifact
                for artifact in item.artifacts
                if artifact.repository in {"fe_anasa", "fe_anasa_ord"} and artifact.has_changes
            )
            if item.approved_shas.get(artifact.repository) != artifact.head_sha:
                raise RuntimeError(f"approved frontend SHA is stale for {item.ticket_id}")
            viewed = await run_command(
                ["gh", "pr", "view", artifact.pr_url, "--json", "headRefOid,state"]
            )
            payload = json.loads(viewed.stdout)
            if payload.get("headRefOid") != artifact.head_sha or payload.get("state") != "OPEN":
                raise RuntimeError(f"frontend PR changed or closed for {item.ticket_id}")
            return item.ticket_id, artifact.head_sha

        validated = await asyncio.gather(*(validate_item(item) for item in input.items))
        phase_durations["validate_candidates"] = time.perf_counter() - started
        repository_name = next(
            artifact.repository
            for item in input.items
            for artifact in item.artifacts
            if artifact.has_changes
        )
        if any(
            artifact.repository != repository_name
            for item in input.items
            for artifact in item.artifacts
            if artifact.has_changes
        ):
            raise RuntimeError("frontend integration batch cannot mix repositories")
        frontend = self._repository_config(repository_name)
        await run_command(["git", "fetch", "origin", frontend.base_branch], cwd=frontend.checkout)
        slug = await self._repository_slug(frontend.checkout)
        assemble_started = time.perf_counter()
        batch_artifact = await self._create_repository_batch_pr(
            input,
            frontend.checkout,
            frontend.base_branch,
            frontend.base_ref,
            slug,
            repository_name=repository_name,
            branch_prefix="frontend-batch",
            root_name="frontend-batches",
        )
        phase_durations["assemble_integration_pr"] = time.perf_counter() - assemble_started
        merge_started = time.perf_counter()
        deployed_sha = await self._merge_pr(batch_artifact)
        phase_durations["merge_integration_pr"] = time.perf_counter() - merge_started
        deploy_started = time.perf_counter()
        deployment_url = await self._wait_for_frontend_deployment(slug, deployed_sha)
        phase_durations["wait_for_deployment"] = time.perf_counter() - deploy_started
        phase_durations["total"] = time.perf_counter() - started
        return BackendBatchResult(
            batch_id=input.batch_id,
            deployed_sha=deployed_sha,
            deployment_url=deployment_url,
            merged_shas=dict(validated),
            phase_durations=phase_durations,
        )

    async def _create_repository_batch_pr(
        self,
        input: BackendBatchInput,
        source: Path,
        base_branch: str,
        base_ref: str,
        slug: str,
        *,
        repository_name: str,
        branch_prefix: str,
        root_name: str,
    ) -> PrArtifact:
        safe_batch = re.sub(r"[^a-zA-Z0-9-]+", "-", input.batch_id).strip("-")
        if not safe_batch:
            raise ValueError("batch_id has no safe branch characters")
        branch = f"codex/{branch_prefix}-{safe_batch.lower()}"
        root = self._settings.workspace_root / root_name / safe_batch
        worktree = root / repository_name
        root.mkdir(parents=True, exist_ok=True)
        if not worktree.exists():
            branch_exists = await run_command(
                ["git", "show-ref", "--verify", f"refs/heads/{branch}"],
                cwd=source,
                check=False,
            )
            if branch_exists.returncode == 0:
                await run_command(["git", "worktree", "add", str(worktree), branch], cwd=source)
            else:
                await run_command(
                    ["git", "worktree", "add", "-b", branch, str(worktree), base_ref],
                    cwd=source,
                )
        current = (
            await run_command(["git", "branch", "--show-current"], cwd=worktree)
        ).stdout.strip()
        if current != branch:
            raise RuntimeError(f"backend batch worktree branch mismatch: {current}")
        dirty = (await run_command(["git", "status", "--porcelain"], cwd=worktree)).stdout.strip()
        if dirty:
            raise RuntimeError(
                f"backend batch worktree is dirty and requires owned recovery: {worktree}"
            )
        await run_command(["git", "merge", "--no-edit", f"origin/{base_branch}"], cwd=worktree)

        branch_names = list(
            dict.fromkeys(
                artifact.branch_name
                for item in input.items
                for artifact in item.artifacts
                if artifact.repository == repository_name and artifact.has_changes
            )
        )
        if branch_names:
            await run_command(
                ["git", "fetch", "--no-tags", "origin", *branch_names],
                cwd=worktree,
            )

        for item in input.items:
            artifact = next(
                artifact
                for artifact in item.artifacts
                if artifact.repository == repository_name and artifact.has_changes
            )
            merge = await run_command(
                ["git", "merge", "--no-ff", "--no-edit", artifact.head_sha],
                cwd=worktree,
                check=False,
            )
            if merge.returncode != 0:
                await run_command(["git", "merge", "--abort"], cwd=worktree, check=False)
                raise CommandError(["git", "merge", "--no-ff", artifact.head_sha], merge)

        await run_command(["git", "push", "-u", "origin", branch], cwd=worktree)
        head_sha = (await run_command(["git", "rev-parse", "HEAD"], cwd=worktree)).stdout.strip()
        existing = await run_command(
            [
                "gh",
                "pr",
                "view",
                branch,
                "--repo",
                slug,
                "--json",
                "url,headRefOid,state",
            ],
            cwd=worktree,
            check=False,
        )
        if existing.returncode == 0:
            payload = json.loads(existing.stdout)
            if payload.get("headRefOid") != head_sha:
                raise RuntimeError("backend batch PR head does not match integration HEAD")
            pr_url = payload["url"]
        else:
            manifest = "\n".join(
                f"- {item.ticket_id}: `{item.approved_shas[repository_name]}`"
                for item in input.items
            )
            created = await run_command(
                [
                    "gh",
                    "pr",
                    "create",
                    "--repo",
                    slug,
                    "--base",
                    base_branch,
                    "--head",
                    branch,
                    "--title",
                    f"[{repository_name} Integration] {input.batch_id}",
                    "--body",
                    f"Approved exact-SHA manifest:\n{manifest}",
                ],
                cwd=worktree,
            )
            pr_url = created.stdout.strip().splitlines()[-1]
        return PrArtifact(
            repository=repository_name,
            pr_url=pr_url,
            head_sha=head_sha,
            branch_name=branch,
            base_branch=base_branch,
            backend_change=repository_name == "be_anasa",
            has_changes=True,
        )

    async def _merge_pr(self, artifact: PrArtifact) -> str:
        if not artifact.pr_url:
            raise RuntimeError(f"PR URL missing for {artifact.repository}")
        await run_command(
            [
                "gh",
                "pr",
                "merge",
                artifact.pr_url,
                "--merge",
                "--match-head-commit",
                artifact.head_sha,
            ]
        )
        viewed = await run_command(
            [
                "gh",
                "pr",
                "view",
                artifact.pr_url,
                "--json",
                "state,mergeCommit",
            ]
        )
        payload = json.loads(viewed.stdout)
        if payload.get("state") != "MERGED" or not payload.get("mergeCommit"):
            raise RuntimeError(f"PR merge was not confirmed: {artifact.pr_url}")
        return payload["mergeCommit"]["oid"]

    async def _wait_for_backend_deployment(self, slug: str, deployed_sha: str) -> str:
        for _ in range(60):
            listed = await run_command(
                [
                    "gh",
                    "run",
                    "list",
                    "--repo",
                    slug,
                    "--workflow",
                    self._settings.backend_deploy_workflow,
                    "--branch",
                    "develop",
                    "--limit",
                    "10",
                    "--json",
                    "databaseId,status,conclusion,headSha,url",
                ],
                check=False,
            )
            if listed.returncode == 0:
                for run in json.loads(listed.stdout):
                    if run.get("headSha") != deployed_sha:
                        continue
                    if run.get("status") == "completed":
                        if run.get("conclusion") != "success":
                            raise RuntimeError(f"backend deployment failed: {run.get('url')}")
                        return run.get("url") or ""
                    run_id = run.get("databaseId")
                    if run_id:
                        watched = await run_command(
                            [
                                "gh",
                                "run",
                                "watch",
                                str(run_id),
                                "--repo",
                                slug,
                                "--exit-status",
                                "--interval",
                                "5",
                            ],
                            check=False,
                        )
                        if watched.returncode != 0:
                            raise RuntimeError(f"backend deployment failed: {run.get('url')}")
                        return run.get("url") or ""
            await asyncio.sleep(2)
        raise RuntimeError("backend deployment run for the exact batch merge SHA did not complete")

    async def _wait_for_frontend_deployment(self, slug: str, deployed_sha: str) -> str:
        for _ in range(90):
            listed = await run_command(
                [
                    "gh",
                    "api",
                    "-X",
                    "GET",
                    f"repos/{slug}/deployments?sha={deployed_sha}&per_page=10",
                ],
                check=False,
            )
            if listed.returncode == 0:
                for deployment in json.loads(listed.stdout):
                    deployment_id = deployment.get("id")
                    if not deployment_id:
                        continue
                    statuses = await run_command(
                        [
                            "gh",
                            "api",
                            "-X",
                            "GET",
                            f"repos/{slug}/deployments/{deployment_id}/statuses?per_page=1",
                        ],
                        check=False,
                    )
                    if statuses.returncode != 0:
                        continue
                    status_items = json.loads(statuses.stdout)
                    if not status_items:
                        continue
                    status = status_items[0]
                    if status.get("state") == "success":
                        return status.get("target_url") or self._environment_url(
                            "ANASA_FRONTEND_URL", "https://erp2.spjoint.com"
                        )
                    if status.get("state") in {"failure", "error", "inactive"}:
                        target = status.get("target_url") or deployment_id
                        raise RuntimeError(f"frontend deployment failed: {target}")
            await asyncio.sleep(2)
        raise RuntimeError("frontend deployment for the exact integration SHA did not complete")

    async def _repository_slug(self, path: Path) -> str:
        remote = (
            await run_command(["git", "remote", "get-url", "origin"], cwd=path)
        ).stdout.strip()
        match = re.search(r"github\.com[/:]([^/]+/[^/]+?)(?:\.git)?$", remote)
        if not match:
            raise RuntimeError(f"unsupported GitHub remote: {remote}")
        return match.group(1)

    def _repository_config(self, name: str) -> RepositoryConfig:
        for repository in self._settings.repositories:
            if repository.name == name:
                return repository
        if name == "fe_anasa_ord":
            import os

            checkout = Path(
                os.getenv("ANASA_ORDER_FE_REPO", "/Users/cigro/Desktop/fe-anasa-ord")
            ).expanduser()
            return RepositoryConfig(
                name=name,
                checkout=checkout,
                base_ref=os.getenv("ANASA_ORDER_FE_BASE_REF", "origin/main"),
                base_branch=os.getenv("ANASA_ORDER_FE_BASE_BRANCH", "main"),
            )
        raise RuntimeError(f"repository is not configured: {name}")

    @staticmethod
    def _environment_url(name: str, default: str) -> str:
        import os

        return os.getenv(name, default)

    def _require_release_scope(self, ticket_ids: list[str]) -> None:
        if not self._settings.preview_only:
            return
        missing = sorted(set(ticket_ids) - set(self._settings.release_tickets))
        if missing:
            raise RuntimeError(
                "preview-only deployment hold is active; add exact tickets to "
                f"ANASA_RELEASE_TICKETS before release: {', '.join(missing)}"
            )


def _pr_body(input: PreparePrInput, repository: str) -> str:
    verification = (
        "\n".join(f"- {item}" for item in input.implementation.verification) or "- not reported"
    )
    risks = "\n".join(f"- {item}" for item in input.implementation.risks) or "- none"
    return f"""## Ticket
{input.context.url}

## Approved scope
{input.analysis.scope_statement}

Scope hash: `{input.analysis.scope_hash}`
Repository: `{repository}`

## Verification
{verification}

## Risks
{risks}

## Visible-column impact
{input.implementation.column_impact}

Workbook basis: {input.implementation.workbook_basis or "none"}
"""
