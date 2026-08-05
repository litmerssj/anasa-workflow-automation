import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

async function webhookModule() {
  try {
    return await import("../lib/linear-webhook.ts");
  } catch {
    return {} as Record<string, unknown>;
  }
}

test("Linear webhook signature verifies the raw body as a hexadecimal HMAC", async () => {
  const webhook = await webhookModule();
  assert.equal(typeof webhook.verifyLinearSignature, "function");
  const raw = JSON.stringify({ type: "Issue", webhookTimestamp: 1_000 });
  const signature = createHmac("sha256", "secret").update(raw).digest("hex");
  assert.equal(webhook.verifyLinearSignature(raw, signature, "secret"), true);
  assert.equal(webhook.verifyLinearSignature(`${raw} `, signature, "secret"), false);
  assert.equal(webhook.verifyLinearSignature(raw, "00", "secret"), false);
});

test("Linear webhook timestamp rejects replay outside sixty seconds", async () => {
  const webhook = await webhookModule();
  assert.equal(typeof webhook.isFreshLinearWebhook, "function");
  assert.equal(webhook.isFreshLinearWebhook(1_000_000, 1_059_999), true);
  assert.equal(webhook.isFreshLinearWebhook(1_000_000, 1_060_001), false);
});

test("only Issue updates with an issue id are lifecycle events", async () => {
  const webhook = await webhookModule();
  assert.deepEqual(
    webhook.linearIssueEvent({ type: "Issue", action: "update", data: { id: "issue-1" } }),
    { issueId: "issue-1" },
  );
  assert.equal(webhook.linearIssueEvent({ type: "Comment", action: "create", data: { id: "c-1" } }), null);
});
