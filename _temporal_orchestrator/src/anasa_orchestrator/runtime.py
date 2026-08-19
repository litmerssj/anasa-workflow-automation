from __future__ import annotations

import os

from temporalio.client import Client

DEFAULT_ADDRESS = "localhost:7233"
DEFAULT_NAMESPACE = "default"
DEFAULT_TASK_QUEUE = "anasa-ticket-workers-v3"
VISIBLE_WORKFLOW_PREFIX = "anasa-session-v3-"


async def connect_client() -> Client:
    return await Client.connect(
        os.getenv("TEMPORAL_ADDRESS", DEFAULT_ADDRESS),
        namespace=os.getenv("TEMPORAL_NAMESPACE", DEFAULT_NAMESPACE),
    )


def task_queue() -> str:
    return os.getenv("ANASA_TASK_QUEUE", DEFAULT_TASK_QUEUE)


def workflow_id(ticket_id: str) -> str:
    return f"anasa-ticket-{ticket_id}"


def visible_workflow_id(ticket_id: str) -> str:
    return f"{VISIBLE_WORKFLOW_PREFIX}{ticket_id}"
