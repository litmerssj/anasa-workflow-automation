# ANASA Temporal Control Plane

각 ANA 티켓은 Codex 앱의 visible task와 독립 worktree가 소유합니다. Temporal은 agent를
대신 실행하지 않고 task registry, FE/BE integration candidate, exact manifest와 batch 결과만
내구성 있게 보존합니다.

```text
Codex ticket task ── Anasa Control Plane plugin ── local Temporal
       │                         │                       ├─ task registry
       ├─ analysis/code/QA       ├─ MCP tools            ├─ ready queues
       └─ ticket approvals       └─ exact gates          └─ batch history
```

## 가장 간단한 설치

macOS에서 저장소 루트의 명령 한 번만 실행합니다.

```bash
./setup-anasa-control-plane
```

이 명령은 Python 3.10+, `git`, `gh`, `codex`를 확인하고 Temporal CLI가 없으면 Homebrew로
설치합니다. 이후 runtime, launchd worker, repo marketplace와 Codex plugin을 자동으로
준비합니다. GitHub CLI가 로그인되지 않았다면 아래 명령 후 설치를 다시 실행합니다.

```bash
gh auth login -h github.com
```

완료 후 ChatGPT 데스크톱 앱을 재시작하고 새 Codex 작업에서 다음처럼 사용합니다.

```text
ANASA Temporal 상태 확인
63, 65, 76 작업을 Temporal에 등록해
준비된 백엔드 통합 후보 보여줘
```

## 폴더 배치

설치 스크립트는 기본적으로 세 저장소가 같은 상위 폴더에 있다고 가정합니다.

```text
projects/
├── anasa-workflow-automation/
├── be_anasa/
├── fe_anasa/
└── fe-anasa-ord/
```

다른 위치라면 설치 명령에만 환경변수를 지정합니다. 생성된
`_temporal_orchestrator/.env`는 이후 실행에 재사용되고 Git에는 올라가지 않습니다.

```bash
ANASA_BE_REPO=/path/to/be_anasa \
ANASA_FE_REPO=/path/to/fe_anasa \
ANASA_ORDER_FE_REPO=/path/to/fe-anasa-ord \
./setup-anasa-control-plane
```

Linear 자격증명이 필요한 기존 자동화는 `_customer_board/.env.local`을 계속 사용합니다.
자격증명과 token은 저장소 또는 Temporal history에 기록하지 않습니다.

## 역할 경계

- 티켓 task: 분석, 피드백, 개발 방향, 구현, 테스트, exact-PR 승인, 티켓별 QA와 완료
- 중앙 task: 여러 visible task 일괄 등록, backend 통합 머지/배포, frontend 통합 머지/release
- Temporal: task registry, FE/BE ready queue, exact candidate manifest, batch 실패와 단계별 시간

중앙 task는 일반 티켓 지시를 중계하거나 모든 티켓을 계속 polling하지 않습니다. 각 티켓
task가 승인된 PR을 integration candidate로 게시하고 중앙 task는 ready queue만 조회합니다.

## 안전 기본값

- `ANASA_PREVIEW_ONLY=true`
- backend 배포 확인문: `DEPLOY BACKEND <batch-id>`
- frontend 통합 확인문: `MERGE FRONTEND <batch-id>`
- whole merge/deploy activity 자동 재시도 없음
- deterministic migration/contract/data 오류는 첫 실패에서 중단
- PR SHA, 배포, fixture, qaEvidence와 data mutation 승인을 추론하지 않음

preview-only를 해제해야 할 때는 `_temporal_orchestrator/.env`의
`ANASA_RELEASE_TICKETS`에 명시적으로 허용할 티켓만 넣고 설치 명령을 다시 실행합니다.

## 서비스 확인과 중지

설치 상태와 worker poller를 확인합니다.

```bash
anasa-orchestrator health
open http://localhost:8233
```

로그는 아래에 저장됩니다.

```text
_temporal_orchestrator/.temporal/anasa-local.stdout.log
_temporal_orchestrator/.temporal/anasa-local.stderr.log
```

로컬 서비스만 중지하려면 다음 명령을 실행합니다. 저장된 workflow DB와 plugin은 삭제하지
않습니다.

```bash
launchctl bootout gui/$(id -u) \
  "$HOME/Library/LaunchAgents/com.litmers.anasa-temporal-v3.plist"
```

다시 시작하거나 업데이트하려면 저장소 루트에서 설치 명령을 재실행합니다.

## 개발 검증

```bash
cd _temporal_orchestrator
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
.venv/bin/ruff check src tests
```

플러그인은 공식 Codex repo marketplace 구조를 사용합니다.

- `.agents/plugins/marketplace.json`
- `plugins/anasa-control-plane/.codex-plugin/plugin.json`
- `plugins/anasa-control-plane/.mcp.json`

참고 문서:

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Temporal Python SDK](https://docs.temporal.io/develop/python)
