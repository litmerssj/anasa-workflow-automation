from __future__ import annotations

import asyncio

from temporalio.worker import Worker

from .activities import TicketActivities
from .runtime import connect_client, task_queue
from .workflow import TicketWorkflow


async def run_worker() -> None:
    client = await connect_client()
    activities = TicketActivities()
    worker = Worker(
        client,
        task_queue=task_queue(),
        workflows=[TicketWorkflow],
        activities=[
            activities.analyze_ticket,
            activities.inspect_implementation,
            activities.plan_deployment,
            activities.plan_qa,
        ],
    )
    await worker.run()


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
