from __future__ import annotations

import asyncio

from temporalio.worker import Worker

from .activities import TicketActivities
from .batch_workflow import BackendBatchWorkflow
from .runtime import connect_client, task_queue
from .workflow import TicketWorkflow


async def run_worker() -> None:
    client = await connect_client()
    activities = TicketActivities()
    worker = Worker(
        client,
        task_queue=task_queue(),
        workflows=[TicketWorkflow, BackendBatchWorkflow],
        activities=[
            activities.prepare_workspace,
            activities.fetch_ticket,
            activities.analyze_ticket,
            activities.mark_in_progress,
            activities.implement_ticket,
            activities.prepare_prs,
            activities.merge_frontend,
            activities.complete_ticket,
            activities.execute_backend_batch,
        ],
    )
    await worker.run()


def main() -> None:
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
