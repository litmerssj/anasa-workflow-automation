#!/usr/bin/env python3
"""화면코드 → FE 라우트 매핑 생성.

경로: screen-manifest.json(route→controller) × FE 소스 grep(controller 파일→view-configs/{TABLE} 호출)
      × 테이블명 정규화(PREFIX-MID-NNNM) → code_to_route.json

한 컨트롤러가 여러 테이블(서브그리드)을 부르므로 코드 하나에 라우트 하나로 수렴시킨다.
충돌(같은 코드가 다른 라우트 2개) 시 둘 다 기록하고 ambiguous 표시 — 진단 워커는 ambiguous면 재현 스킵.
"""
import json, os, re, subprocess

ROOT = "/Users/yoona/Documents/anasa"
FE = os.path.join(ROOT, "workspace/_fe_anasa")
MANIFEST = os.path.join(ROOT, "workspace/_qa_sweep/screen-manifest.json")
OUT = os.path.join(ROOT, "workspace/_diagnosis_worker/code_to_route.json")

CODE_RE = re.compile(r"^([A-Z]{2,5})[-_]([A-Z]{2,5})[-_](\d{3,4})M")


def normalize_code(text):
    m = CODE_RE.match(text)
    if not m:
        return None
    p1, p2, n = m.groups()
    return f"{p1}-{p2}-{n}M"


manifest = json.load(open(MANIFEST))

# 1) controller 이름 → 파일 경로 (src 전체에서 정의 위치 검색)
result = subprocess.run(
    ["grep", "-rl", "--include=*.tsx", "-E", "export (const|function) \\w+Controller", "src/"],
    cwd=FE, capture_output=True, text=True,
)
controller_files = {}
for path in result.stdout.splitlines():
    content = open(os.path.join(FE, path), encoding="utf-8", errors="replace").read()
    for m in re.finditer(r"export (?:const|function) (\w+Controller)", content):
        controller_files.setdefault(m.group(1), []).append(path)

# 2) 각 컨트롤러의 feature 디렉토리 전체에서 화면코드형 문자열 리터럴 수집
#    (view-configs/ 경로뿐 아니라 getViewConfig('TABLE')·상수 선언까지 포괄)
TABLE_RE = re.compile(r"['\"`]([A-Z]{2,5}[-_][A-Z]{2,5}[-_]\d{3,4}M[A-Za-z0-9_\-]*)['\"`]")


def tables_for(path):
    # 컨트롤러 파일이 속한 feature 최상위 디렉토리(예: src/feature-log/order-status)
    parts = path.split(os.sep)
    if len(parts) >= 3 and parts[1].startswith("feature-"):
        feature_dir = os.path.join(FE, parts[0], parts[1], parts[2])
    else:
        feature_dir = os.path.dirname(os.path.join(FE, path))
    found = set()
    for dirpath, _, files in os.walk(feature_dir):
        for fn in files:
            if not fn.endswith((".ts", ".tsx")):
                continue
            try:
                text = open(os.path.join(dirpath, fn), encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for m in TABLE_RE.finditer(text):
                found.add(m.group(1))
    return found


code_to_routes = {}

# 0) 실측 아티팩트 우선: 야간 스윕이 기록한 route→tables (tier0.spec.ts가 생성)
JSONL = os.path.join(ROOT, "workspace/_qa_sweep/harness/route-tables.jsonl")
measured = 0
if os.path.exists(JSONL):
    for line in open(JSONL, encoding="utf-8"):
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        for table in rec.get("tables", []):
            code = normalize_code(table)
            if code:
                code_to_routes.setdefault(code, set()).add(rec["route"])
                measured += 1
    print(f"실측 아티팩트 병합: {measured}건 (route-tables.jsonl)")

for entry in manifest:
    ctrl = entry.get("controller")
    route = entry["route"]
    if not ctrl or ctrl not in controller_files:
        continue
    for path in controller_files[ctrl]:
        for table in tables_for(path):
            code = normalize_code(table)
            if not code:
                continue
            code_to_routes.setdefault(code, set()).add(route)

out = {}
ambiguous = []
for code, routes in sorted(code_to_routes.items()):
    routes = sorted(routes)
    out[code] = {"route": routes[0], "ambiguous": len(routes) > 1, "all_routes": routes}
    if len(routes) > 1:
        ambiguous.append((code, routes))

json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
print(f"매핑된 화면코드: {len(out)}")
print(f"모호(라우트 2개 이상): {len(ambiguous)}")
for code, routes in ambiguous[:10]:
    print(" ", code, routes)
