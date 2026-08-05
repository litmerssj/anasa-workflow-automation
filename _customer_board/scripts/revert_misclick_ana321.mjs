// ANA-321 고객 QA 오클릭 원복: [답변] 코멘트 삭제 + 고객확인 라벨 복원 → 질의대기 레인 복귀
const KEY = process.env.LINEAR_API_KEY;
if (!KEY) throw new Error("LINEAR_API_KEY 없음");

const ISSUE_ID = "5810736e-0cd2-408e-a445-b7108f8f4d16"; // ANA-321
const ANSWER_COMMENT_ID = "c0c33589-f261-47c0-858a-7ee0a1d6de4c";

async function gql(query, variables) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: KEY },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// 1) 오클릭 [답변] 코멘트 삭제
const del = await gql(
  `mutation ($id: String!) { commentDelete(id: $id) { success } }`,
  { id: ANSWER_COMMENT_ID },
);
console.log("commentDelete:", del.commentDelete.success);

// 2) 고객확인 라벨 복원 (기존 라벨 유지 + 추가)
const cur = await gql(
  `query ($id: String!) { issue(id: $id) { labels(first: 50) { nodes { id name } } } }`,
  { id: ISSUE_ID },
);
const keepIds = cur.issue.labels.nodes.map((l) => l.id);
const all = await gql(`query { issueLabels(first: 250) { nodes { id name } } }`);
const confirmLabel = all.issueLabels.nodes.find((l) => l.name === "고객확인");
if (!confirmLabel) throw new Error("고객확인 라벨을 찾을 수 없음");
const upd = await gql(
  `mutation ($id: String!, $labelIds: [String!]!) {
    issueUpdate(id: $id, input: { labelIds: $labelIds }) { success }
  }`,
  { id: ISSUE_ID, labelIds: [...new Set([...keepIds, confirmLabel.id])] },
);
console.log("labelRestore:", upd.issueUpdate.success);

// 3) 기록용 무태그 코멘트 (레인 판정 태그 없음 → 고객 화면 비노출)
await gql(
  `mutation ($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }`,
  {
    issueId: ISSUE_ID,
    body: "(내부기록) 2026-08-04 고객측 QA 오클릭으로 제출된 [답변]('주문 헤더와 품목 상세 모두 화면 내 편집모드 사용')을 삭제하고 고객확인 라벨을 복원함 — 질의대기 상태로 원복. 고객 요청에 따른 조치.",
  },
);
console.log("audit comment: ok");

// 4) 검증: 라벨/최종 태그 상태 재조회
const check = await gql(
  `query ($id: String!) {
    issue(id: $id) {
      identifier
      labels { nodes { name } }
      comments(first: 30, orderBy: createdAt) { nodes { body createdAt } }
    }
  }`,
  { id: ISSUE_ID },
);
const labels = check.issue.labels.nodes.map((l) => l.name);
const tagged = check.issue.comments.nodes.filter(
  (c) => c.body.startsWith("**[질의]**") || c.body.startsWith("**[답변]**"),
);
const last = tagged.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1);
console.log("labels now:", labels.join(", "));
console.log("last tagged comment:", last ? last.body.split("\n")[0].slice(0, 40) : "없음");
const lane = !labels.includes("고객확인")
  ? "반영됨"
  : last?.body.startsWith("**[답변]**")
    ? "회신완료"
    : "질의대기";
console.log("판정 레인:", lane);
