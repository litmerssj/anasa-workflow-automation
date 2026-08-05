import assert from "node:assert/strict";
import test from "node:test";

async function migration() {
  try {
    return await import("../migration.mjs");
  } catch {
    return {};
  }
}

test("active WEB titles become ORD and customer intake moves from Core to Anasa", async () => {
  const { migrationInput } = await migration();
  assert.deepEqual(
    migrationInput({
      title: "[WEB] 주문상태확인 · 조회 오류",
      team: { id: "core" },
      labels: { nodes: [{ name: "고객보드" }, { name: "자동분류-미확정" }] },
    }, { anasaTeamId: "anasa", coreTeamId: "core" }),
    { title: "[ORD] 주문상태확인 · 조회 오류", teamId: "anasa" },
  );
});

test("tier 3 stays in Core while still normalizing the prefix", async () => {
  const { migrationInput } = await migration();
  assert.deepEqual(
    migrationInput({
      title: "[WEB] 공유 DB ALTER",
      team: { id: "core" },
      labels: { nodes: [{ name: "고객보드" }, { name: "tier-3" }] },
    }, { anasaTeamId: "anasa", coreTeamId: "core" }),
    { title: "[ORD] 공유 DB ALTER" },
  );
});

test("migration dry-run returns a manifest without mutating Linear", async () => {
  const { runMigration } = await migration();
  const result = await runMigration({
    client: {
      listIssues: async () => [{
        id: "i-1", identifier: "ANACO-11", title: "[WEB] 주문 조회", team: { id: "core" },
        labels: { nodes: [{ name: "고객보드" }, { name: "자동분류-미확정" }] },
      }],
      updateIssue: async () => assert.fail("dry-run must not update"),
    },
    anasaTeamId: "anasa",
    coreTeamId: "core",
    dryRun: true,
  });
  assert.deepEqual(result, {
    scanned: 1,
    changed: 1,
    failed: 0,
    manifest: [{ identifier: "ANACO-11", input: { title: "[ORD] 주문 조회", teamId: "anasa" } }],
  });
});
