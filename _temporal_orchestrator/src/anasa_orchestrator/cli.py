from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict

from .models import (
    BackendBatchRelease,
    CustomerAnswer,
    DirectionApproval,
    PrApproval,
    TicketWorkflowInput,
)
from .runtime import connect_client, task_queue, workflow_id
from .workflow import TicketWorkflow


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ANASA Temporal shadow orchestrator")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start")
    start.add_argument("ticket_id")
    start.add_argument("worktree_path")
    start.add_argument("--model")

    status = sub.add_parser("status")
    status.add_argument("ticket_id")

    direction = sub.add_parser("approve-direction")
    direction.add_argument("ticket_id")
    direction.add_argument("scope_hash")
    direction.add_argument("--by", default="hong-seokju")

    answer = sub.add_parser("customer-answer")
    answer.add_argument("ticket_id")
    answer.add_argument("answer")

    pr = sub.add_parser("approve-pr")
    pr.add_argument("ticket_id")
    pr.add_argument("exact_sha")
    pr.add_argument("--by", default="hong-seokju")

    batch = sub.add_parser("release-backend-batch")
    batch.add_argument("ticket_id")
    batch.add_argument("batch_id")
    batch.add_argument("approved_sha")
    return parser


async def _run(args: argparse.Namespace) -> None:
    client = await connect_client()
    wid = workflow_id(args.ticket_id)

    if args.command == "start":
        handle = await client.start_workflow(
            TicketWorkflow.run,
            TicketWorkflowInput(
                ticket_id=args.ticket_id,
                worktree_path=args.worktree_path,
                model=args.model,
                shadow_mode=True,
            ),
            id=wid,
            task_queue=task_queue(),
        )
        print(json.dumps({"workflow_id": handle.id, "run_id": handle.result_run_id}))
        return

    handle = client.get_workflow_handle_for(TicketWorkflow.run, wid)
    if args.command == "status":
        snapshot = await handle.query(TicketWorkflow.get_status)
    elif args.command == "approve-direction":
        snapshot = await handle.execute_update(
            TicketWorkflow.approve_direction,
            DirectionApproval(args.ticket_id, args.scope_hash, args.by),
        )
    elif args.command == "customer-answer":
        snapshot = await handle.execute_update(
            TicketWorkflow.answer_customer,
            CustomerAnswer(args.ticket_id, args.answer),
        )
    elif args.command == "approve-pr":
        snapshot = await handle.execute_update(
            TicketWorkflow.approve_pr,
            PrApproval(args.ticket_id, args.exact_sha, args.by),
        )
    elif args.command == "release-backend-batch":
        snapshot = await handle.execute_update(
            TicketWorkflow.release_backend_batch,
            BackendBatchRelease(args.ticket_id, args.batch_id, args.approved_sha),
        )
    else:
        raise AssertionError(f"unknown command: {args.command}")
    print(json.dumps(asdict(snapshot), ensure_ascii=False, indent=2, default=str))


def main() -> None:
    asyncio.run(_run(_parser().parse_args()))


if __name__ == "__main__":
    main()
