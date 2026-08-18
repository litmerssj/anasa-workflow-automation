from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict

from .runtime import connect_client
from .service import OrchestratorService


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ANASA Temporal control plane")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start")
    start.add_argument("tickets", help="63,65 or ANA-63 ANA-65")
    start.add_argument("--prompt", default="")
    start.add_argument("--mode", choices=["live", "shadow"], default="live")
    start.add_argument("--model")

    status = sub.add_parser("status")
    status.add_argument("ticket_id")

    instruction = sub.add_parser("instruction")
    instruction.add_argument("ticket_id")
    instruction.add_argument("prompt")
    instruction.add_argument("--by", default="hong-seokju")

    answer = sub.add_parser("customer-answer")
    answer.add_argument("ticket_id")
    answer.add_argument("answer")

    direction = sub.add_parser("approve-direction")
    direction.add_argument("ticket_id")
    direction.add_argument("scope_hash")
    direction.add_argument("--by", default="hong-seokju")

    pr = sub.add_parser("approve-pr")
    pr.add_argument("ticket_id")
    pr.add_argument("sha", nargs="+", help="repository=exact_sha")
    pr.add_argument("--by", default="hong-seokju")

    batch = sub.add_parser("backend-batch")
    batch.add_argument("batch_id")
    batch.add_argument("tickets", nargs="+")
    batch.add_argument("--by", default="hong-seokju")

    release = sub.add_parser("frontend-release")
    release.add_argument("ticket_id")
    release.add_argument("sha", nargs="+", help="repository=exact_sha")
    release.add_argument("--by", default="hong-seokju")

    qa = sub.add_parser("qa-evidence")
    qa.add_argument("ticket_id")
    qa.add_argument("--pr-commit", required=True)
    qa.add_argument("--smoke", required=True)
    qa.add_argument("--before", required=True)
    qa.add_argument("--after", required=True)

    retry = sub.add_parser("retry")
    retry.add_argument("ticket_id")
    retry.add_argument("--by", default="hong-seokju")
    return parser


def _sha_map(values: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"expected repository=sha: {value}")
        repository, sha = value.split("=", 1)
        if repository not in {"be_anasa", "fe_anasa"} or not sha.strip():
            raise ValueError(f"invalid repository SHA: {value}")
        result[repository] = sha.strip()
    return result


async def _run(args: argparse.Namespace) -> None:
    client = await connect_client()
    service = OrchestratorService(client)
    if args.command == "start":
        result = await service.start_tickets(
            args.tickets,
            user_instruction=args.prompt,
            mode=args.mode,
            model=args.model,
        )
    elif args.command == "status":
        result = asdict(await service.get_ticket(args.ticket_id))
    elif args.command == "instruction":
        result = asdict(await service.add_instruction(args.ticket_id, args.prompt, args.by))
    elif args.command == "customer-answer":
        result = asdict(await service.answer_customer(args.ticket_id, args.answer))
    elif args.command == "approve-direction":
        result = asdict(await service.approve_direction(args.ticket_id, args.scope_hash, args.by))
    elif args.command == "approve-pr":
        result = asdict(await service.approve_prs(args.ticket_id, _sha_map(args.sha), args.by))
    elif args.command == "backend-batch":
        result = await service.start_backend_batch(args.tickets, args.batch_id, args.by)
    elif args.command == "frontend-release":
        result = asdict(
            await service.authorize_frontend_release(args.ticket_id, _sha_map(args.sha), args.by)
        )
    elif args.command == "qa-evidence":
        result = asdict(
            await service.submit_qa_evidence(
                args.ticket_id,
                pr_commit=args.pr_commit,
                smoke=args.smoke,
                before=args.before,
                after=args.after,
            )
        )
    elif args.command == "retry":
        result = asdict(await service.retry_ticket(args.ticket_id, args.by))
    else:
        raise AssertionError(f"unknown command: {args.command}")
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


def main() -> None:
    asyncio.run(_run(_parser().parse_args()))


if __name__ == "__main__":
    main()
