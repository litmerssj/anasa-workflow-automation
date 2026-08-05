// Linear GraphQL 서버 클라이언트. 이 파일은 서버 컴포넌트/라우트 핸들러에서만 import한다.
// 원장은 Linear다 — 이 앱은 상태를 소유하지 않는 번역층이라는 원칙을 코드로 강제하는 곳:
// 여기 없는 지속 상태(자체 DB)는 없다. 모든 조회는 매 요청 Linear에 직접 질의한다.

const API_URL = "https://api.linear.app/graphql";

function apiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error(
      "LINEAR_API_KEY가 설정되지 않았습니다. .env.local에 Linear Personal API Key를 넣어주세요 " +
        "(Linear → Settings → Security & access → Personal API keys).",
    );
  }
  return key;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey(),
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error("Linear API 오류: " + JSON.stringify(json.errors));
  }
  return json.data as T;
}

export type BoardComment = {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string } | null;
};

export type BoardIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
  state: { name: string; type: string };
  team?: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
  projectMilestone?: { id: string; name: string; targetDate: string | null } | null;
  labels: { nodes: { id?: string; name: string }[] };
  comments: { nodes: BoardComment[] };
};

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  createdAt
  state { name type }
  team { id name }
  assignee { id name }
  projectMilestone { id name targetDate }
  labels { nodes { name } }
  comments(first: 20, orderBy: createdAt) {
    nodes { id body createdAt user { name } }
  }
`;

export async function getIssue(issueId: string): Promise<BoardIssue> {
  const data = await gql<{ issue: BoardIssue }>(
    `query ($issueId: String!) {
      issue(id: $issueId) { ${ISSUE_FIELDS} }
    }`,
    { issueId },
  );
  if (!data.issue) throw new Error("티켓을 찾을 수 없습니다");
  return data.issue;
}

export function requireIssueLabels(issue: BoardIssue, required: string[]): void {
  const current = new Set(issue.labels.nodes.map((label) => label.name));
  for (const label of required) {
    if (!current.has(label)) throw new Error(`라벨 '${label}'이 없는 티켓입니다`);
  }
}

export async function updateIssue(input: {
  issueId: string;
  stateId?: string;
  assigneeId?: string | null;
  teamId?: string;
  title?: string;
  description?: string;
}): Promise<void> {
  const { issueId, ...changes } = input;
  const data = await gql<{ issueUpdate: { success: boolean } }>(
    `mutation ($issueId: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $issueId, input: $input) { success }
    }`,
    { issueId, input: changes },
  );
  if (!data.issueUpdate.success) throw new Error("이슈 업데이트 실패");
}

/** 라벨 이름으로 이슈 목록 조회 (질의/검수 레인 렌더링용). teamId 생략 시 워크스페이스 전체. */
export async function listIssuesByLabel(
  labelName: string,
  teamId?: string,
): Promise<BoardIssue[]> {
  const filter: Record<string, unknown> = {
    labels: { name: { eq: labelName } },
  };
  if (teamId) filter.team = { id: { eq: teamId } };

  const data = await gql<{ issues: { nodes: BoardIssue[] } }>(
    `query ($filter: IssueFilter) {
      issues(filter: $filter, first: 100, orderBy: updatedAt) {
        nodes { ${ISSUE_FIELDS} }
      }
    }`,
    { filter },
  );
  return data.issues.nodes;
}

/** 여러 라벨을 한 번에 (레인별로 나눠 렌더링할 때 요청수 절약용) */
export async function listIssuesByLabels(
  labelNames: string[],
  teamId?: string,
): Promise<Record<string, BoardIssue[]>> {
  const entries = await Promise.all(
    labelNames.map(async (name) => [name, await listIssuesByLabel(name, teamId)] as const),
  );
  return Object.fromEntries(entries);
}

export async function listIssuesByState(
  stateName: string,
  teamId?: string,
): Promise<BoardIssue[]> {
  const filter: Record<string, unknown> = { state: { name: { eq: stateName } } };
  if (teamId) filter.team = { id: { eq: teamId } };
  const data = await gql<{ issues: { nodes: BoardIssue[] } }>(
    `query ($filter: IssueFilter) {
      issues(filter: $filter, first: 100, orderBy: updatedAt) {
        nodes { ${ISSUE_FIELDS} }
      }
    }`,
    { filter },
  );
  return data.issues.nodes;
}

export async function listIssuesByStates(
  stateNames: string[],
  teamId?: string,
): Promise<BoardIssue[]> {
  const groups = await Promise.all(stateNames.map((name) => listIssuesByState(name, teamId)));
  return [...new Map(groups.flat().map((issue) => [issue.id, issue])).values()];
}

export async function listActiveMembers(): Promise<{ id: string; name: string; email: string }[]> {
  const data = await gql<{
    users: { nodes: { id: string; name: string; email: string; active: boolean }[] };
  }>(`query { users(first: 250) { nodes { id name email active } } }`);
  return data.users.nodes.filter((member) => member.active !== false);
}

/** 스크린샷 업로드 (Linear 자체 파일 스토리지). data URL을 받아 asset URL을 반환. */
export async function uploadAsset(dataUrl: string, filename: string): Promise<string> {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("잘못된 이미지 데이터");
  const [, contentType, base64] = match;
  const buffer = Buffer.from(base64, "base64");

  const uploadData = await gql<{
    fileUpload: {
      success: boolean;
      uploadFile: { uploadUrl: string; assetUrl: string; headers: { key: string; value: string }[] };
    };
  }>(
    `mutation ($contentType: String!, $filename: String!, $size: Int!) {
      fileUpload(contentType: $contentType, filename: $filename, size: $size) {
        success
        uploadFile { uploadUrl assetUrl headers { key value } }
      }
    }`,
    { contentType, filename, size: buffer.byteLength },
  );

  const { uploadUrl, assetUrl, headers } = uploadData.fileUpload.uploadFile;
  const putHeaders: Record<string, string> = { "Content-Type": contentType };
  for (const h of headers) putHeaders[h.key] = h.value;

  const putRes = await fetch(uploadUrl, { method: "PUT", headers: putHeaders, body: buffer });
  if (!putRes.ok) throw new Error("스크린샷 업로드 실패: " + putRes.status);

  return assetUrl;
}

type CreateIssueInput = {
  title: string;
  description: string;
  teamId: string;
  labelNames: string[];
  projectId?: string;
  projectMilestoneId?: string;
};

/** 인테이크 폼 제출 → Linear 이슈 생성. 라벨은 이름으로 받아 내부에서 ID 조회. */
export async function createIssue(input: CreateIssueInput): Promise<BoardIssue> {
  const labelIds = await resolveLabelIds(input.labelNames);
  const data = await gql<{ issueCreate: { success: boolean; issue: BoardIssue } }>(
    `mutation ($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { ${ISSUE_FIELDS} }
      }
    }`,
    {
      input: {
        title: input.title,
        description: input.description,
        teamId: input.teamId,
        labelIds,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectMilestoneId ? { projectMilestoneId: input.projectMilestoneId } : {}),
      },
    },
  );
  if (!data.issueCreate.success) throw new Error("이슈 생성 실패");
  return data.issueCreate.issue;
}

export async function createComment(issueId: string, body: string): Promise<string> {
  const data = await gql<{ commentCreate: { success: boolean; comment: { id: string } } }>(
    `mutation ($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } }
    }`,
    { issueId, body },
  );
  if (!data.commentCreate.success) throw new Error("코멘트 생성 실패");
  return data.commentCreate.comment.id;
}

/** 되돌리기(undo)에서 방금 만든 [답변]/[검수] 코멘트를 제거할 때 사용. */
export async function deleteComment(commentId: string): Promise<void> {
  const data = await gql<{ commentDelete: { success: boolean } }>(
    `mutation ($id: String!) { commentDelete(id: $id) { success } }`,
    { id: commentId },
  );
  if (!data.commentDelete.success) throw new Error("코멘트 삭제 실패");
}

/** 이슈 라벨 추가/제거 (이름 기준). 검수 통과/반려, 질의 unblock 등에 사용. */
export async function updateIssueLabels(
  issueId: string,
  opts: { add?: string[]; remove?: string[] },
): Promise<void> {
  const data = await gql<{ issue: { labels: { nodes: { id: string; name: string }[] } } }>(
    `query ($issueId: String!) {
      issue(id: $issueId) { labels(first: 50) { nodes { id name } } }
    }`,
    { issueId },
  );
  const current = data.issue.labels.nodes;
  const removeIds = new Set(
    current.filter((l) => opts.remove?.includes(l.name)).map((l) => l.id),
  );
  const keepIds = current.filter((l) => !removeIds.has(l.id)).map((l) => l.id);
  const addIds = opts.add ? await resolveLabelIds(opts.add) : [];

  await gql(
    `mutation ($issueId: String!, $labelIds: [String!]!) {
      issueUpdate(id: $issueId, input: { labelIds: $labelIds }) { success }
    }`,
    { issueId, labelIds: [...new Set([...keepIds, ...addIds])] },
  );
}

export async function updateIssueState(issueId: string, stateName: string): Promise<void> {
  const data = await gql<{ issue: { team: { states: { nodes: { id: string; name: string }[] } } } }>(
    `query ($issueId: String!) {
      issue(id: $issueId) { team { states(first: 20) { nodes { id name } } } }
    }`,
    { issueId },
  );
  const state = data.issue.team.states.nodes.find((s) => s.name === stateName);
  if (!state) throw new Error(`팀에 '${stateName}' 상태가 없습니다`);
  await gql(
    `mutation ($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
    }`,
    { issueId, stateId: state.id },
  );
}

const labelIdCache = new Map<string, string>();

type LabelSource = {
  listLabels(): Promise<{ id: string; name: string }[]>;
  createLabel(name: string): Promise<{ id: string; name: string }>;
};

export async function resolveLabelIdsFromSource(
  names: string[],
  source: LabelSource,
): Promise<string[]> {
  const byName = new Map((await source.listLabels()).map((label) => [label.name, label]));
  for (const name of names) {
    if (byName.has(name)) continue;
    const created = await source.createLabel(name);
    byName.set(created.name, created);
  }
  return names.map((name) => {
    const label = byName.get(name);
    if (!label) throw new Error(`라벨 '${name}'을 만들 수 없습니다`);
    return label.id;
  });
}

async function resolveLabelIds(names: string[]): Promise<string[]> {
  const uncached = names.filter((n) => !labelIdCache.has(n));
  if (uncached.length > 0) {
    const ids = await resolveLabelIdsFromSource(uncached, {
      listLabels: async () => {
        const data = await gql<{ issueLabels: { nodes: { id: string; name: string }[] } }>(
          `query { issueLabels(first: 250) { nodes { id name } } }`,
        );
        return data.issueLabels.nodes;
      },
      createLabel: async (name) => {
        const data = await gql<{
          issueLabelCreate: { success: boolean; issueLabel: { id: string; name: string } };
        }>(
          `mutation ($input: IssueLabelCreateInput!) {
            issueLabelCreate(input: $input) { success issueLabel { id name } }
          }`,
          { input: { name } },
        );
        if (!data.issueLabelCreate.success) throw new Error(`라벨 '${name}' 생성 실패`);
        return data.issueLabelCreate.issueLabel;
      },
    });
    uncached.forEach((name, index) => labelIdCache.set(name, ids[index]));
  }
  return names.map((n) => {
    const id = labelIdCache.get(n);
    if (!id) throw new Error(`라벨 '${n}'을 만들 수 없습니다`);
    return id;
  });
}
