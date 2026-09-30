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
- one-shot launcher: 명시적으로 요청한 여러 visible task 일괄 등록 후 종료
- temporary integration task: backend 통합 머지/배포 또는 frontend 통합 머지/release 한 배치 후 종료
- Temporal: task registry, FE/BE ready queue, exact candidate manifest, batch 실패와 단계별 시간

상시 중앙 관리자 task는 두지 않습니다. 일반 티켓 지시·피드백·승인은 각 티켓 task에서 직접
처리합니다. 각 티켓 task가 승인된 PR을 integration candidate로 게시하고, 통합이 필요할 때만
임시 integration task가 ready queue를 읽습니다. 임시 task는 배치가 끝나면 종료합니다.

## 안전 기본값

- `ANASA_PREVIEW_ONLY=true`
- backend 통합 머지 확인문: `MERGE BACKEND <batch-id>`
- backend 배포 확인문: `DEPLOY BACKEND <batch-id>`
- backend 통합 브랜치: `ANASA_BE_INTEGRATION_BRANCH` (기본값 `integration/backend`)
- frontend 통합 브랜치: `ANASA_FE_INTEGRATION_BRANCH` (기본값 `integration/frontend`)
- frontend 통합 확인문: `MERGE FRONTEND <batch-id>`
- whole merge/deploy activity 자동 재시도 없음
- deterministic migration/contract/data 오류는 첫 실패에서 중단
- PR SHA, 배포, fixture, qaEvidence와 data mutation 승인을 추론하지 않음

preview-only를 해제해야 할 때는 `_temporal_orchestrator/.env`의
`ANASA_RELEASE_TICKETS`에 명시적으로 허용할 티켓만 넣고 설치 명령을 다시 실행합니다.

백엔드 배치는 리뷰된 후보를 `integration/backend`에 순서대로 합친 뒤
`WAIT_DEPLOYMENT`에서 멈춥니다. 배포 창이 열렸을 때 같은 batch id로 별도
`DEPLOY BACKEND <batch-id>`를 호출해야 staging 배포를 관찰하고 티켓을 QA 단계로 넘깁니다.
승인된 개발 PR의 exact head를 통합 브랜치에 직접 병합합니다. 중간 배치 조립 브랜치나
추가 통합 PR은 만들지 않습니다. `develop`의 최신 변경을 자동으로 섞지 않으며, 이미
통합 브랜치에 들어간 exact SHA는 다시 merge하지 않습니다.
개발 브랜치의 기반 `develop` 커밋이 아직 통합 브랜치에 없으면 병합을 중단합니다. 해당
브랜치를 통합 브랜치 기준으로 다시 만들고 변경된 SHA에 대한 리뷰 승인을 받아야 합니다.

`ANASA_BACKEND_DEPLOY_WORKFLOW`는 `workflow_dispatch` 방식으로 호출됩니다. `DEPLOY BACKEND`
호출에는 `request_id`, `manifest_hash`, `candidate_receipt_id`를 포함한 release-train 입력을
명시해야 하며, control plane은 값을 추정하지 않습니다. 호출부는 자동으로
`ref=integration/backend`, `backend_sha=<integration SHA>`, `batch_id=<batch id>`를 전달하고,
workflow 실행 제목의 request id와 exact SHA를 함께 관찰합니다. FE는 Vercel 연속 배포를
사용하므로 통합 브랜치 머지 후 별도 배포 게이트를 만들지 않고 기존 배포 관찰 흐름을
유지합니다.

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
