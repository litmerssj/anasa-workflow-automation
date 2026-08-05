import assert from "node:assert/strict";
import test from "node:test";

async function orchestrator() {
  try {
    return await import("../orchestrator.mjs");
  } catch {
    return {};
  }
}

test("one failed pass is isolated and later workflow passes continue", async () => {
  const { runPasses } = await orchestrator();
  assert.equal(typeof runPasses, "function");
  const order = [];
  const results = await runPasses([
    { name: "diagnose", run: async () => { order.push("diagnose"); throw new Error("browser unavailable"); } },
    { name: "classify", run: async () => { order.push("classify"); return { classified: 2 }; } },
    { name: "assign", run: async () => { order.push("assign"); return { devAssigned: 1 }; } },
  ]);
  assert.deepEqual(order, ["diagnose", "classify", "assign"]);
  assert.equal(results[0].status, "failed");
  assert.deepEqual(results[1], { name: "classify", status: "ok", result: { classified: 2 } });
  assert.equal(results[2].status, "ok");
});
