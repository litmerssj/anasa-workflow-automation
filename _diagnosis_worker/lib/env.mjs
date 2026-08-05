// 자격증명 로딩 — 키는 _customer_board/.env.local 한 곳에만 둔다 (중복 보관 금지).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const WORKER_DIR = path.resolve(HERE, "..");
export const HARNESS_DIR = path.join(ROOT, "workspace/_qa_sweep/harness");

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

loadDotenv(path.join(ROOT, "workspace/_customer_board/.env.local"));

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 미설정 — workspace/_customer_board/.env.local 확인`);
  return v;
}
