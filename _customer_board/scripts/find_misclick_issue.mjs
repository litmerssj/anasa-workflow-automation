// 잘못 클릭된 질의 티켓 탐색: 질의이력 라벨 보유 + [질의] 본문에 검색어 포함
const KEY = process.env.LINEAR_API_KEY;
if (!KEY) throw new Error("LINEAR_API_KEY 없음");

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

const NEEDLE = "주문 헤더와 품목 상세";

const data = await gql(`
  query {
    issues(filter: { labels: { name: { eq: "질의이력" } } }, first: 100, orderBy: updatedAt) {
      nodes {
        id identifier title url updatedAt
        state { name type }
        assignee { id name }
        labels { nodes { id name } }
        comments(first: 30, orderBy: createdAt) {
          nodes { id body createdAt user { name displayName } }
        }
      }
    }
  }
`);

for (const issue of data.issues.nodes) {
  const hit = issue.comments.nodes.some((c) => c.body.includes(NEEDLE));
  if (!hit) continue;
  console.log("=== MATCH ===");
  console.log("identifier:", issue.identifier, "| id:", issue.id);
  console.log("title:", issue.title);
  console.log("url:", issue.url);
  console.log("state:", issue.state.name, `(${issue.state.type})`);
  console.log("assignee:", issue.assignee ? `${issue.assignee.name} (${issue.assignee.id})` : "없음");
  console.log("labels:", issue.labels.nodes.map((l) => l.name).join(", "));
  console.log("--- comments (시간순) ---");
  for (const c of issue.comments.nodes) {
    const head = c.body.split("\n")[0].slice(0, 120);
    console.log(`[${c.createdAt}] (${c.user?.displayName ?? c.user?.name ?? "?"}) id=${c.id}`);
    console.log(`   ${head}`);
  }
}
