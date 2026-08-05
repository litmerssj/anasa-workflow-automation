import { NextRequest, NextResponse } from "next/server";
import { createIssue, uploadAsset } from "@/lib/linear";
import { buildIssueTitle } from "@/lib/issue-title";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { screenCode, screenName, symptom, steps, expected, screenshotDataUrl } = body as {
      screenCode: string;
      screenName: string;
      symptom: string;
      steps: string;
      expected: string;
      screenshotDataUrl: string;
    };

    if (!screenCode || !symptom || !screenshotDataUrl) {
      return NextResponse.json(
        { error: "화면, 증상, 화면 캡처는 필수입니다." },
        { status: 400 },
      );
    }

    const assetUrl = await uploadAsset(screenshotDataUrl, `intake-${Date.now()}.png`);

    const description = [
      `**화면코드**: ${screenCode} (${screenName || "-"})`,
      "",
      `**증상**`,
      symptom,
      "",
      steps ? `**재현 순서**\n${steps}` : "",
      "",
      expected ? `**기대 동작**\n${expected}` : "",
      "",
      `**화면 캡처**`,
      `![스크린샷](${assetUrl})`,
    ]
      .filter((l) => l !== "")
      .join("\n");

    const teamId = process.env.LINEAR_TEAM_ID;
    if (!teamId) {
      return NextResponse.json({ error: "서버 설정 오류: LINEAR_TEAM_ID 미설정" }, { status: 500 });
    }

    // 웹발주(ORD-*) 화면은 별도 시스템 스코프로 자동 라우팅한다.
    const PROJECT_STABILIZATION = "f6b4cc99-9d5b-4b75-bf68-8b28ce1930d0"; // 아나사 안정화 6주
    const MILESTONE_ORD = "77a322a4-ca2e-413f-b4a5-7ad3cc31fdb5"; // ORD 웹발주
    const isWebOrder = screenCode.startsWith("ORD-");

    const issue = await createIssue({
      title: buildIssueTitle(screenCode, symptom),
      description,
      teamId,
      labelNames: ["고객보드", "자동분류-미확정"],
      ...(isWebOrder
        ? { projectId: PROJECT_STABILIZATION, projectMilestoneId: MILESTONE_ORD }
        : {}),
    });

    return NextResponse.json({ ok: true, identifier: issue.identifier, url: issue.url });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 },
    );
  }
}
