// [WEB] 전체 검수(웹발주) → Linear draft 티켓 이관 (1회성)
// 근거: workspace/_notion_html_20260803/WEB_atomized.md (13건 → 12티켓: WEB-08+10 병합)
// 원칙: 자동분류-미확정으로 생성(감사셀 확정 전 개발자 큐 비노출). 이미지는 Linear 업로드 임베드.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, requireEnv } from "./lib/env.mjs";

const API = "https://api.linear.app/graphql";
const TEAM_ANASA = "f4837910-b73f-4908-b4d8-f25ad31c2f61";
const PROJECT = "f6b4cc99-9d5b-4b75-bf68-8b28ce1930d0"; // 아나사 안정화 6주
const MILESTONE_WEB = "77a322a4-ca2e-413f-b4a5-7ad3cc31fdb5"; // WEB 웹발주 (가일정·스코프 검토)
const IMG_DIR = path.join(ROOT, "workspace/_notion_html_20260803/512da270/content/개인 페이지 & 공유된 페이지/[WEB] 전체 검수");

async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: requireEnv("LINEAR_API_KEY") },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function uploadPng(buffer, filename) {
  const data = await gql(
    `mutation ($contentType: String!, $filename: String!, $size: Int!) {
      fileUpload(contentType: $contentType, filename: $filename, size: $size) {
        success uploadFile { uploadUrl assetUrl headers { key value } }
      }
    }`,
    { contentType: "image/png", filename, size: buffer.byteLength },
  );
  const { uploadUrl, assetUrl, headers } = data.fileUpload.uploadFile;
  const putHeaders = { "Content-Type": "image/png" };
  for (const h of headers) putHeaders[h.key] = h.value;
  const putRes = await fetch(uploadUrl, { method: "PUT", headers: putHeaders, body: buffer });
  if (!putRes.ok) throw new Error("업로드 실패: " + putRes.status);
  return assetUrl;
}

const BANNER = [
  "> ⚠️ **노션 신규 문서 `[WEB] 전체 검수`(2026-07-20 스냅샷, 이승호) 이관** — 대상은 **웹발주 시스템**(ERP 166화면 아님). 이후 배포가 있었을 수 있으므로 **착수 전 현재상태 재현 재확인 필수**.",
  "> 📌 마일스톤 `WEB 웹발주`는 가일정 — ERP 6주 미팅 주차와 별개 트랙, 스코프(포함/보류)는 감사셀 확정 사항.",
].join("\n");

const MULTI_SELECT_NOTE = "> 🔎 WEB-03·04·05는 동일 패턴(다중선택 → 단건만 적용/전체 오적용) — 선택상태 전달 공통 근원 가능성. 확정 시 병합 또는 동시 착수 검토.";

const items = [
  { id: "WEB-01", screen: "주문상태확인", summary: "100건 이상 조회 불가 — 전역 조회상한 의심", status: "🔴미착수",
    req: "100건 이상 조회되지 않음. 출고상태확인 화면도 동일 — 고객이 \"전체 화면 검토\" 요청(전역 페이지네이션/조회 상한 이슈 의심).",
    imgs: ["image.png"] },
  { id: "WEB-02", screen: "주문상태확인", summary: "주문취소·상세주문취소 모두 오류", status: "🔴미착수",
    req: "주문취소, 상세주문 취소 모두 오류 발생 중.",
    imgs: ["image 1.png", "image 2.png"] },
  { id: "WEB-03", screen: "출고상태확인", summary: "다중선택 출력여부 변경이 1건만 적용(취소 동일)", status: "🔴미착수",
    req: "다중선택 후 출력여부 진행 시 1건만 Y로 변경되고 나머지는 미변경. 출력여부 취소도 동일 증상.",
    note: MULTI_SELECT_NOTE, imgs: ["image 3.png"] },
  { id: "WEB-04", screen: "출고상태확인", summary: "엑셀다운이 선택건 아닌 전체건 다운로드", status: "🔴미착수",
    req: "엑셀다운 시 선택한 건이 아닌 전체 건이 전부 다운로드됨.",
    note: MULTI_SELECT_NOTE, imgs: [] },
  { id: "WEB-05", screen: "출고상태확인", summary: "다중선택 명세서 출력 시 1건만 출력", status: "🔴미착수",
    req: "다중선택 후 명세서 출력 시 1건만 출력됨.",
    note: MULTI_SELECT_NOTE, imgs: [] },
  { id: "WEB-06", screen: "질의응답", summary: "조회 시 오류 발생", status: "🔴미착수",
    req: "질의응답 조회 시 오류 발생 중.",
    imgs: ["image 4.png"] },
  { id: "WEB-07", screen: "home", summary: "home 클릭 시 로그인 첫 화면 상태(좌측 메뉴바 없음)로 이동 요청", status: "🟠변경요청",
    req: "현재: home 클릭 시 좌측 메뉴바 고정된 채 메인 이동. 요청: 로그인 직후 첫 화면 상태(좌측 메뉴바 없는 상태)로. 첫 번째 이미지=현재, 두 번째 이미지=요청.",
    imgs: ["image 5.png", "image 6.png"] },
  { id: "WEB-08·10", screen: "주소/상세주소", summary: "주소 필드 분리 — 1차 대응 반려 재발", status: "🔴반려(재검수)", rejected: true,
    req: "주소 부분을 주소/상세주소로 분리 요청. 1차 검수에서 고객이 \"요청사항대로 진행 불가해 보이면 다른 방향 제안 환영\"이라 했고(WEB-08), **재검수에서 \"오류 수정되지 않았습니다(1,2번사진/3,4번사진)\"로 반려됨(WEB-10)**. 대안 설계 여지 있음 — 확정 시 접근 방향부터 판정.",
    imgs: ["image 7.png", "image 8.png", "image 9.png"] },
  { id: "WEB-09", screen: "FP제품 주문·SP공구주문", summary: "\"미완성 상태\" — 정확한 미완성 범위 고객 확인 필요", status: "❓질의", inquiry: true,
    req: "고객 원문: \"현재 FP제품 주문, SP공구주문이 미완성 상태입니다.\" — 포괄 상태 보고라 원자 결함 단위가 아님. 어떤 기능/단계가 미완성인지 범위 확인 질의 필요(재검수 목록의 번호 누락 1~3번 존재 여부도 함께).",
    imgs: [] },
  { id: "WEB-11", screen: "SP/GP공구 주문등록", summary: "장바구니담기 성공 팝업 후 목록 미반영", status: "🔴미착수",
    req: "장바구니담기 성공 팝업이 떴음에도 장바구니 목록에 담기지 않음.",
    imgs: ["image 10.png"] },
  { id: "WEB-12", screen: "문의", summary: "문의 등록 불가", status: "🔴미착수",
    req: "문의 등록이 안 됨.",
    imgs: ["image 11.png"] },
  { id: "WEB-13", screen: "현장등록", summary: "담당부서 미표시", status: "🔴미착수",
    req: "현장등록에서 담당부서가 보이지 않음. (원문 \"4.\" 번호 표기 — 앞 1~3번은 문서에 없음, 범위 확인은 WEB-09 질의에 포함)",
    imgs: ["image 12.png"] },
];

const labelIds = {};
{
  const data = await gql(`query { issueLabels(first: 200) { nodes { id name } } }`);
  for (const l of data.issueLabels.nodes) labelIds[l.name] = l.id;
}

const dryRun = process.argv.includes("--dry");
let created = 0, failed = [];

for (const it of items) {
  const title = `[WEB] ${it.screen} · ${it.summary} (${it.id})`;
  const imgMd = [];
  for (const f of it.imgs) {
    if (dryRun) { imgMd.push(`![${f}](dry-run)`); continue; }
    try {
      const url = await uploadPng(readFileSync(path.join(IMG_DIR, f)), `web-${it.id.replace(/·/g, "-")}-${f.replace(/ /g, "_")}`);
      imgMd.push(`![${f}](${url})`);
    } catch (e) { imgMd.push(`_(이미지 ${f} 업로드 실패: ${String(e.message).slice(0, 80)})_`); }
  }
  const desc = [
    BANNER,
    it.note || "",
    "",
    `**백로그 상태**: ${it.status}`,
    `**요청내용(고객 원문 기반)**: ${it.req}`,
    `**출처**: 노션 [WEB] 전체 검수 → \`workspace/_notion_html_20260803/WEB_atomized.md\` ${it.id}`,
    imgMd.length ? "\n" + imgMd.join("\n") : "",
  ].filter(Boolean).join("\n");

  const labels = [labelIds["노션검수"], labelIds["자동분류-미확정"]];
  if (it.inquiry) labels.push(labelIds["고객확인"]);
  // 주의: `검수반려` 라벨 금지 — 고객 보드 재수정요청 레인이 이 라벨로 판정되어 draft가 고객에게 노출된다.
  // 반려 이력은 본문 서술로만 남긴다(it.rejected는 서술용 플래그).

  if (dryRun) { console.log("[dry]", title); created++; continue; }
  try {
    const data = await gql(
      `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier } } }`,
      { input: { title: title.slice(0, 255), description: desc, teamId: TEAM_ANASA, projectId: PROJECT, projectMilestoneId: MILESTONE_WEB, labelIds: labels } },
    );
    console.log(data.issueCreate.issue.identifier, "←", it.id);
    created++;
    await new Promise((r) => setTimeout(r, 250));
  } catch (e) { failed.push([it.id, String(e.message).slice(0, 120)]); }
}
console.log(`\n생성 ${created} / 실패 ${failed.length}`);
for (const [id, err] of failed) console.log("실패:", id, err);
