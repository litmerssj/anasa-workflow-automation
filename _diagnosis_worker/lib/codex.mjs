// codex exec 래퍼 — 구독 인증(codex-lb), 모델·effort는 ~/.codex/config.toml 고정값 사용
// (gpt-5.6-sol, reasoning high). 텍스트 생성 전용: read-only 샌드박스 + 세션 미저장.
import { execFile } from "node:child_process";
import { readFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function codexGenerate(prompt, { timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const outFile = path.join(mkdtempSync(path.join(tmpdir(), "codex-")), "out.md");
    const child = execFile(
      "codex",
      ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "-o", outFile, "-"],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, cwd: tmpdir() },
      (err) => {
        if (err) return reject(new Error("codex exec 실패: " + err.message));
        try {
          const text = readFileSync(outFile, "utf-8").trim();
          unlinkSync(outFile);
          resolve(text);
        } catch (e) {
          reject(e);
        }
      },
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
