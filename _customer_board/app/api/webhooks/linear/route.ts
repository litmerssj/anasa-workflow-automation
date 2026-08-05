import { NextRequest, NextResponse } from "next/server";
import {
  createComment,
  getIssue,
  listActiveMembers,
  listIssuesByStates,
  updateIssue,
} from "@/lib/linear";
import {
  isFreshLinearWebhook,
  linearIssueEvent,
  requireLinearWebhookSecret,
  verifyLinearSignature,
} from "@/lib/linear-webhook";
import { assignQaRequest } from "@/lib/qa-assignment";
import { transitionQaRequest } from "@/lib/workflow-lifecycle";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let secret: string;
  try {
    secret = requireLinearWebhookSecret();
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "webhook is not configured" }, { status: 503 });
  }
  if (!verifyLinearSignature(rawBody, req.headers.get("linear-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const timestamp = (payload as { webhookTimestamp?: unknown })?.webhookTimestamp;
  if (typeof timestamp !== "number" || !isFreshLinearWebhook(timestamp)) {
    return NextResponse.json({ error: "stale webhook" }, { status: 401 });
  }

  const event = linearIssueEvent(payload);
  if (!event) return NextResponse.json({ ok: true, ignored: true });

  try {
    const transition = await transitionQaRequest(event.issueId, {
      getIssue,
      createComment,
    });
    if (transition.status === "ignored") {
      return NextResponse.json({ ok: true, result: transition });
    }
    const teamId = process.env.LINEAR_TEAM_ID;
    const assignment = await assignQaRequest(event.issueId, {
      getIssue,
      listQaWork: () => listIssuesByStates(["QA Request", "QA In Progress"], teamId),
      listActiveMembers,
      updateIssue,
      createComment,
    });
    return NextResponse.json({ ok: true, result: { transition, assignment } });
  } catch (error) {
    console.error("Linear webhook lifecycle error", error);
    return NextResponse.json({ error: "lifecycle transition failed" }, { status: 500 });
  }
}
