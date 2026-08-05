import assert from "node:assert/strict";
import test from "node:test";

import { shouldUploadEvidence } from "../diagnose.mjs";

test("diagnosis dry-run never uploads a reproduction screenshot", () => {
  assert.equal(shouldUploadEvidence({ dryRun: true, repro: { ok: true, screenshot: Buffer.from("x") } }), false);
  assert.equal(shouldUploadEvidence({ dryRun: false, repro: { ok: true, screenshot: Buffer.from("x") } }), true);
  assert.equal(shouldUploadEvidence({ dryRun: false, repro: { ok: false, screenshot: null } }), false);
});
