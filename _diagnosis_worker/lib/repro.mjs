// Playwright 라이브 재현 — 조회 전용(로그인·goto·관찰·스크린샷만, 쓰기 조작 없음).
// harness의 playwright 설치와 로그인 세션(.auth/state.json)을 재사용한다.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { HARNESS_DIR } from "./env.mjs";

const require = createRequire(path.join(HARNESS_DIR, "package.json"));
const { chromium } = require("playwright");

const BASE_URL = process.env.ANASA_BASE_URL || "https://erp2.spjoint.com";
const STATE = path.join(HARNESS_DIR, ".auth/state.json");

/** 라우트 방문 → { ok, screenshot(Buffer), consoleErrors, httpErrors, gridVisible } */
export async function reproduce(route) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext(
      existsSync(STATE) ? { storageState: STATE, baseURL: BASE_URL } : { baseURL: BASE_URL },
    );
    const page = await ctx.newPage();
    const consoleErrors = [];
    const httpErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("response", (r) => {
      if (r.status() >= 400 && /\/api\/v1\//.test(r.url()))
        httpErrors.push({ url: r.url().split("?")[0], status: r.status() });
    });

    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // 세션 만료 감지: /login으로 튕겼으면 재현 불가
    if (page.url().includes("/login")) {
      return { ok: false, reason: "세션 만료 — harness 스윕 재실행으로 .auth/state.json 갱신 필요" };
    }

    const gridVisible = (await page.locator(".ag-root-wrapper, .ag-root").count()) > 0;
    const screenshot = await page.screenshot({ fullPage: false });
    return {
      ok: true,
      screenshot,
      gridVisible,
      consoleErrors: consoleErrors.filter(
        (e) => !/favicon|ResizeObserver|hydration|DevTools/i.test(e),
      ),
      httpErrors,
    };
  } finally {
    await browser.close();
  }
}
