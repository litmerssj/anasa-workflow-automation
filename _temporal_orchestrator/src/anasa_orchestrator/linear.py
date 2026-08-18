from __future__ import annotations

import os
from typing import Any

import httpx

from .config import load_local_environment
from .models import (
    CompleteTicketResult,
    QaEvidence,
    RelatedTicket,
    TicketAttachment,
    TicketComment,
    TicketContext,
)

LINEAR_API = "https://api.linear.app/graphql"


class LinearGateway:
    def __init__(self, token: str | None = None) -> None:
        load_local_environment()
        self._token = token or os.getenv("LINEAR_API_KEY")

    def _require_token(self) -> str:
        if not self._token:
            raise RuntimeError("LINEAR_API_KEY is missing; configure _customer_board/.env.local")
        return self._token

    async def _request(
        self, query: str, variables: dict[str, object] | None = None
    ) -> dict[str, Any]:
        token = self._require_token()
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.post(
                        LINEAR_API,
                        headers={
                            "Authorization": token,
                            "Content-Type": "application/json",
                        },
                        json={"query": query, "variables": variables or {}},
                    )
                if response.status_code == 429 or response.status_code >= 500:
                    raise RuntimeError(f"Linear API HTTP {response.status_code}")
                response.raise_for_status()
                payload = response.json()
                if payload.get("errors"):
                    raise RuntimeError(f"Linear API errors: {payload['errors']}")
                return payload["data"]
            except Exception as error:
                last_error = error
                if attempt == 2:
                    break
        raise RuntimeError(f"Linear API failed after 3 attempts: {last_error}")

    async def get_ticket(self, ticket_id: str) -> TicketContext:
        data = await self._request(
            """
            query Ticket($id: String!) {
              issue(id: $id) {
                id identifier title description url
                state { name }
                team { id }
                comments(first: 100, orderBy: createdAt) {
                  nodes { id body createdAt user { name } }
                }
                attachments(first: 100) {
                  nodes { id title url subtitle }
                }
                relations(first: 100) {
                  nodes {
                    type
                    relatedIssue { identifier title url }
                  }
                }
              }
            }
            """,
            {"id": ticket_id},
        )
        issue = data.get("issue")
        if not issue:
            raise RuntimeError(f"Linear ticket not found: {ticket_id}")
        comments = [
            TicketComment(
                id=node["id"],
                body=node.get("body") or "",
                created_at=node.get("createdAt") or "",
                author=(node.get("user") or {}).get("name") or "unknown",
            )
            for node in issue.get("comments", {}).get("nodes", [])
        ]
        attachments = [
            TicketAttachment(
                id=node["id"],
                title=node.get("title") or "attachment",
                url=node.get("url") or "",
                subtitle=node.get("subtitle") or "",
            )
            for node in issue.get("attachments", {}).get("nodes", [])
        ]
        relations = [
            RelatedTicket(
                relation_type=node.get("type") or "related",
                identifier=(node.get("relatedIssue") or {}).get("identifier") or "",
                title=(node.get("relatedIssue") or {}).get("title") or "",
                url=(node.get("relatedIssue") or {}).get("url") or "",
            )
            for node in issue.get("relations", {}).get("nodes", [])
            if node.get("relatedIssue")
        ]
        return TicketContext(
            issue_id=issue["id"],
            ticket_id=issue["identifier"],
            title=issue.get("title") or "",
            description=issue.get("description") or "",
            url=issue.get("url") or "",
            state=(issue.get("state") or {}).get("name") or "",
            team_id=(issue.get("team") or {}).get("id") or "",
            comments=comments,
            attachments=attachments,
            related_tickets=relations,
        )

    async def complete_ticket(
        self, context: TicketContext, evidence: QaEvidence
    ) -> CompleteTicketResult:
        latest = await self.get_ticket(context.ticket_id)
        body = _evidence_body(evidence)
        existing = next(
            (comment for comment in latest.comments if comment.body.strip() == body.strip()),
            None,
        )
        comment_id = existing.id if existing else await self._create_comment(latest.issue_id, body)
        if latest.state != "QA Request":
            state_id = await self._workflow_state_id(latest.team_id, "QA Request")
            await self._update_issue_state(latest.issue_id, state_id)
        return CompleteTicketResult(comment_id=comment_id, state="QA Request")

    async def ensure_state(self, ticket_id: str, state_name: str) -> str:
        latest = await self.get_ticket(ticket_id)
        if latest.state == state_name:
            return state_name
        state_id = await self._workflow_state_id(latest.team_id, state_name)
        await self._update_issue_state(latest.issue_id, state_id)
        return state_name

    async def _create_comment(self, issue_id: str, body: str) -> str:
        data = await self._request(
            """
            mutation Comment($issueId: String!, $body: String!) {
              commentCreate(input: { issueId: $issueId, body: $body }) {
                success comment { id }
              }
            }
            """,
            {"issueId": issue_id, "body": body},
        )
        result = data["commentCreate"]
        if not result["success"]:
            raise RuntimeError("Linear completion comment failed")
        return result["comment"]["id"]

    async def _workflow_state_id(self, team_id: str, name: str) -> str:
        data = await self._request(
            """
            query States($teamId: String!) {
              team(id: $teamId) { states(first: 50) { nodes { id name } } }
            }
            """,
            {"teamId": team_id},
        )
        for state in data["team"]["states"]["nodes"]:
            if state["name"] == name:
                return state["id"]
        raise RuntimeError(f"Linear workflow state not found: {name}")

    async def _update_issue_state(self, issue_id: str, state_id: str) -> None:
        data = await self._request(
            """
            mutation UpdateState($issueId: String!, $stateId: String!) {
              issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
            }
            """,
            {"issueId": issue_id, "stateId": state_id},
        )
        if not data["issueUpdate"]["success"]:
            raise RuntimeError("Linear QA Request transition failed")


def _evidence_body(evidence: QaEvidence) -> str:
    fields = {
        "PR/커밋": evidence.pr_commit,
        "스모크": evidence.smoke,
        "수정 전": evidence.before,
        "수정 후": evidence.after,
    }
    blank = [name for name, value in fields.items() if not value.strip()]
    if blank:
        raise ValueError(f"qaEvidence fields are missing: {', '.join(blank)}")
    return "\n".join(
        ["[개발완료]"] + [f"{name}: {value.strip()}" for name, value in fields.items()]
    )
