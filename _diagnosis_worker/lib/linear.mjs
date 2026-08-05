import { requireEnv } from "./env.mjs";

const API = "https://api.linear.app/graphql";

const ISSUE_FIELDS = `
  id identifier title description url updatedAt
  state { id name type }
  team { id name }
  assignee { id name email }
  project { id name }
  projectMilestone { id name targetDate }
  labels { nodes { id name } }
  comments(first: 100, orderBy: createdAt) {
    nodes { id body createdAt user { id name } }
  }
`;

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function createLinearClient({
  token,
  fetchImpl = fetch,
  sleep = defaultSleep,
} = {}) {
  const labelCache = new Map();
  async function request(query, variables = {}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetchImpl(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token || requireEnv("LINEAR_API_KEY"),
        },
        body: JSON.stringify({ query, variables }),
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) throw new Error(`Linear API HTTP ${response.status}`);
        await sleep(250 * (2 ** attempt));
        continue;
      }
      if (!response.ok) throw new Error(`Linear API HTTP ${response.status}`);
      const json = await response.json();
      if (json.errors) throw new Error("Linear API 오류: " + JSON.stringify(json.errors));
      return json.data;
    }
    throw new Error("Linear API 재시도 한도를 초과했습니다");
  }

  async function listIssues(filter = {}) {
    const all = [];
    let cursor = null;
    do {
      const data = await request(
        `query ($filter: IssueFilter, $after: String) {
          issues(filter: $filter, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { ${ISSUE_FIELDS} }
          }
        }`,
        { filter, after: cursor },
      );
      all.push(...data.issues.nodes);
      cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
    } while (cursor);
    return all;
  }

  async function createComment(issueId, body) {
    await request(
      `mutation ($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success }
      }`,
      { issueId, body },
    );
  }

  async function ensureLabels(names) {
    const missingFromCache = names.filter((name) => !labelCache.has(name));
    if (missingFromCache.length > 0) {
      const data = await request(`query { issueLabels(first: 250) { nodes { id name } } }`);
      for (const label of data.issueLabels.nodes) labelCache.set(label.name, label.id);
    }
    for (const name of names) {
      if (labelCache.has(name)) continue;
      const data = await request(
        `mutation ($input: IssueLabelCreateInput!) {
          issueLabelCreate(input: $input) {
            success issueLabel { id name }
          }
        }`,
        { input: { name } },
      );
      if (!data.issueLabelCreate.success) throw new Error(`라벨 '${name}' 생성 실패`);
      labelCache.set(name, data.issueLabelCreate.issueLabel.id);
    }
    return names.map((name) => labelCache.get(name));
  }

  async function updateIssue(issueId, input) {
    const data = await request(
      `mutation ($issueId: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $issueId, input: $input) { success }
      }`,
      { issueId, input },
    );
    if (!data.issueUpdate.success) throw new Error(`이슈 ${issueId} 업데이트 실패`);
  }

  async function listMembers() {
    const data = await request(`query {
      users(first: 250) { nodes { id name email active } }
    }`);
    return data.users.nodes.filter((member) => member.active !== false);
  }

  async function listWorkflowStates(teamId) {
    const data = await request(
      `query ($teamId: String!) {
        team(id: $teamId) {
          states(first: 50) { nodes { id name type position color description } }
        }
      }`,
      { teamId },
    );
    return data.team.states.nodes;
  }

  async function createWorkflowState(input) {
    const data = await request(
      `mutation ($input: WorkflowStateCreateInput!) {
        workflowStateCreate(input: $input) {
          success
          workflowState { id name type position color description }
        }
      }`,
      { input },
    );
    if (!data.workflowStateCreate.success) throw new Error(`상태 '${input.name}' 생성 실패`);
    return data.workflowStateCreate.workflowState;
  }

  async function createIssue(input) {
    const data = await request(
      `mutation ($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } }
      }`,
      { input },
    );
    if (!data.issueCreate.success) throw new Error("이슈 생성 실패");
    return data.issueCreate.issue;
  }

  async function uploadPng(buffer, filename) {
    const data = await request(
      `mutation ($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success
          uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }`,
      { contentType: "image/png", filename, size: buffer.byteLength },
    );
    const { uploadUrl, assetUrl, headers } = data.fileUpload.uploadFile;
    const putHeaders = { "Content-Type": "image/png" };
    for (const header of headers) putHeaders[header.key] = header.value;
    const response = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: putHeaders,
      body: buffer,
    });
    if (!response.ok) throw new Error("스크린샷 업로드 실패: " + response.status);
    return assetUrl;
  }

  return {
    request,
    listIssues,
    listMembers,
    listWorkflowStates,
    createWorkflowState,
    createIssue,
    createComment,
    ensureLabels,
    updateIssue,
    uploadPng,
  };
}

let singleton;
function client() {
  singleton ??= createLinearClient();
  return singleton;
}

export async function issuesWithLabel(labelName) {
  const issues = await client().listIssues({ labels: { name: { eq: labelName } } });
  return issues.filter((issue) => !["completed", "canceled"].includes(issue.state.type));
}

export async function createComment(issueId, body) {
  return client().createComment(issueId, body);
}

export async function uploadPng(buffer, filename) {
  return client().uploadPng(buffer, filename);
}
