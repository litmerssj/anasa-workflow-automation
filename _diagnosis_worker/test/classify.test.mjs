import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function classifier() {
  try {
    return await import("../classify.mjs");
  } catch {
    return {};
  }
}

test("deterministic shared-write and security signals become tier 3", async () => {
  const { classifyIssue } = await classifier();
  assert.equal(typeof classifyIssue, "function");
  for (const text of [
    "운영 공유 DB ALTER 및 일괄 데이터 변경",
    "저장 프로시저 SP 파라미터 변경 필요",
    "다른 고객 데이터가 보이는 권한 경계 오류",
    "인증 우회와 보안 취약점 수정",
  ]) {
    const result = classifyIssue({ title: text, description: "" });
    assert.equal(result.tier, "tier-3", text);
    assert.equal(result.lowConfidence, false, text);
  }
});

test("closed visual changes become tier 1 without enabling autofix", async () => {
  const { classifyIssue } = await classifier();
  for (const text of [
    "버튼 문구 오타 수정",
    "모달 레이아웃이 겹치고 스크롤이 잘림",
    "컬럼 정렬과 색상 표기가 화면설계서와 다름",
  ]) {
    const result = classifyIssue({ title: text, description: "" });
    assert.equal(result.tier, "tier-1", text);
    assert.equal(result.autoFix, false, text);
  }
});

test("save failures do not become tier 3 without a deterministic risk signal", async () => {
  const { classifyIssue } = await classifier();
  const result = classifyIssue({ title: "등록 버튼을 눌러도 저장되지 않음", description: "원인은 아직 미확인" });
  assert.equal(result.tier, "tier-2");
  assert.equal(result.lowConfidence, false);
});

test("ORD SP and GP product screen names are not stored procedure evidence", async () => {
  const { classifyIssue } = await classifier();
  for (const title of [
    "SP/GP공구 주문등록 장바구니 목록에 담기지 않음",
    "FP제품 주문·SP공구주문이 미완성 상태",
    "SP공구 대리점이관신청 버튼 오류",
  ]) {
    assert.notEqual(classifyIssue({ title, description: "" }).tier, "tier-3", title);
  }
});

test("a proposed view-config seed is not deterministic bulk data risk", async () => {
  const { classifyIssue } = await classifier();
  const result = classifyIssue({
    title: "거래처 조회 팝업 추가",
    description: "조치안 초안: 대상 화면 seed/view-config에 searchable 메타 지정",
  });
  assert.notEqual(result.tier, "tier-3");
});

test("unknown or conflicting evidence stays distributable as low-confidence tier 2", async () => {
  const { classifyIssue } = await classifier();
  const result = classifyIssue({ title: "동작이 이상합니다", description: "확인 필요" });
  assert.equal(result.tier, "tier-2");
  assert.equal(result.lowConfidence, true);
  assert.equal(result.blockAssignment, false);
});

test("classification pass removes pending, sets tier and routes only tier 3 to core", async () => {
  const { runClassification } = await classifier();
  const updates = [];
  const comments = [];
  const ids = new Map([
    ["고객보드", "l-customer"],
    ["tier-3", "l-tier3"],
    ["분류신뢰도-낮음", "l-low"],
  ]);
  const client = {
    listIssues: async () => [{
      id: "issue-1",
      identifier: "ANA-1",
      title: "운영 공유 DB ALTER 필요",
      description: "",
      labels: { nodes: [
        { id: "l-customer", name: "고객보드" },
        { id: "l-pending", name: "자동분류-미확정" },
      ] },
      comments: { nodes: [] },
    }],
    ensureLabels: async (names) => names.map((name) => ids.get(name) ?? `id-${name}`),
    updateIssue: async (issueId, input) => updates.push({ issueId, input }),
    createComment: async (issueId, body) => comments.push({ issueId, body }),
  };
  const result = await runClassification({
    client,
    anasaTeamId: "anasa",
    coreTeamId: "core",
    now: new Date("2026-08-04T00:00:00Z"),
  });
  assert.deepEqual(result, { scanned: 1, classified: 1, failed: 0 });
  assert.equal(updates[0].input.teamId, "core");
  assert.deepEqual(updates[0].input.labelIds.sort(), ["l-customer", "l-tier3"].sort());
  assert.match(comments[0].body, /"event":"classified"/);
});

test("classification dry-run performs no label or issue mutation", async () => {
  const { runClassification } = await classifier();
  const result = await runClassification({
    client: {
      listIssues: async () => [{
        id: "i", identifier: "ANA-2", title: "버튼 문구 오타", description: "",
        labels: { nodes: [{ id: "pending", name: "자동분류-미확정" }] }, comments: { nodes: [] },
      }],
      ensureLabels: async () => assert.fail("dry-run must not ensure labels"),
      updateIssue: async () => assert.fail("dry-run must not update"),
      createComment: async () => assert.fail("dry-run must not comment"),
    },
    anasaTeamId: "anasa",
    coreTeamId: "core",
    dryRun: true,
  });
  assert.equal(result.classified, 1);
});

test("measured ORD history stays on the developer path unless risk is deterministic", async () => {
  const { classifyIssue } = await classifier();
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/ord-history-regression.json", import.meta.url), "utf8"),
  );
  for (const sample of fixture) {
    const result = classifyIssue({ title: sample.title, description: "" });
    assert.equal(result.tier, sample.expectedTier, `${sample.id}: ${sample.title}`);
    assert.equal(result.autoFix, false, sample.id);
    assert.equal(result.blockAssignment, false, sample.id);
  }
});

test("classification audit summarizes tier and reason distribution", async () => {
  const { classificationSummary } = await classifier();
  assert.deepEqual(
    classificationSummary([
      { identifier: "A-1", title: "버튼 문구 오타", description: "" },
      { identifier: "A-2", title: "조회 실패", description: "" },
      { identifier: "A-3", title: "공유 DB 쓰기 변경", description: "" },
      { identifier: "A-4", title: "이상함", description: "" },
    ]),
    {
      total: 4,
      tiers: { "tier-1": 1, "tier-2": 2, "tier-3": 1 },
      lowConfidence: 1,
      reasons: {
        "문구·명칭": 1,
        "순수 표시": 1,
        "조회·검색": 1,
        "공유 DB 쓰기": 1,
        "결정적 신호 부족": 1,
      },
    },
  );
});
