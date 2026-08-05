import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLinearSignature(
  rawBody: string,
  headerSignature: string | null,
  secret: string,
): boolean {
  if (!headerSignature || !/^[0-9a-f]{64}$/i.test(headerSignature) || !secret) return false;
  const supplied = Buffer.from(headerSignature, "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function isFreshLinearWebhook(webhookTimestamp: number, now = Date.now()): boolean {
  return Number.isFinite(webhookTimestamp) && Math.abs(now - webhookTimestamp) <= 60_000;
}

export function linearIssueEvent(payload: unknown): { issueId: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as { type?: unknown; action?: unknown; data?: { id?: unknown } };
  if (event.type !== "Issue" || event.action !== "update" || typeof event.data?.id !== "string") {
    return null;
  }
  return { issueId: event.data.id };
}

export function requireLinearWebhookSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env.LINEAR_WEBHOOK_SECRET;
  if (!secret) throw new Error("LINEAR_WEBHOOK_SECRET가 설정되지 않았습니다");
  return secret;
}
