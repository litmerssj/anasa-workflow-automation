# Anasa Workflow Automation

Anasa 프로젝트의 Linear 티켓 수명주기, 담당자 자동 배정, 내부 QA, 고객 보드와 모듈 단위 최종검수를 관리하는 운영 자동화 모노레포입니다.

## Temporal control plane 선택 설치

이 브랜치의 Temporal 기능은 필요한 사람만 각자의 Mac에 설치해서 사용합니다. 중앙 서버나
공용 workflow 상태는 사용하지 않습니다.

### 사용하면 좋은 점

- 앱이나 worker를 재시작해도 티켓 상태와 승인 이력이 유지됩니다.
- 각 티켓 작업은 독립적으로 진행하고, 준비된 FE/BE PR만 중앙에서 모아 볼 수 있습니다.
- 승인된 여러 백엔드 PR을 한 번의 통합 머지·배포로 처리해 대기 시간을 줄입니다.
- 실패한 배치의 정확한 PR·SHA·단계와 원인을 남겨 안전하게 이어서 처리할 수 있습니다.
- 개인 PC에서만 동작하므로 사용하지 않는 팀원에게는 영향이 없습니다.

### 운영 방식

상시 중앙 관리자 대화는 사용하지 않습니다.

- 일반 작업: 사용자가 각 ANA 티켓 task에서 직접 지시·피드백·승인합니다.
- Temporal: 티켓 상태와 승인된 FE/BE candidate만 보존합니다.
- 여러 티켓 시작: 필요할 때 one-shot launcher가 task를 만들고 바로 종료합니다.
- 통합 머지·배포: 필요할 때 임시 integration task가 한 배치를 처리하고 종료합니다.

중앙에서 모든 티켓을 polling하거나 진행 상황을 요약·중계·재전달하지 않습니다. 완료·대기
task를 자동으로 깨우지도 않습니다.

이 도구가 맡는 범위는 티켓·승인·PR SHA·통합 배포 기록입니다. Docker runtime 통일,
격리 DB/Redis, 동일 artifact 승격은 별도의 환경 최적화 작업으로 진행해야 합니다.

준비물은 ChatGPT 데스크톱 앱의 Codex, Git, GitHub CLI 로그인입니다. 저장소와
`be_anasa`, `fe_anasa`, `fe-anasa-ord`를 같은 상위 폴더에 둔 뒤 한 번만 실행합니다.

```bash
git clone --branch codex/temporal-local-opt-in \
  https://github.com/litmers-dev/anasa-workflow-automation.git
cd anasa-workflow-automation
./setup-anasa-control-plane
```

설치 명령은 다음 작업을 자동으로 처리합니다.

- Python 가상환경과 ANASA runtime 설치
- Temporal CLI가 없으면 Homebrew로 설치
- 로그인 시 자동 실행되는 로컬 Temporal server/worker 등록
- 저장소 Codex marketplace와 `anasa-control-plane` 플러그인 설치
- 개인 경로를 반영한 `.env` 생성
- worker health 확인

완료 후 ChatGPT 데스크톱 앱을 재시작하고 새 Codex 작업에서
`ANASA Temporal 상태 확인`이라고 요청합니다.

업데이트는 해당 브랜치에서 아래 두 명령만 다시 실행합니다.

```bash
git pull --ff-only
./setup-anasa-control-plane
```

기본값은 `ANASA_PREVIEW_ONLY=true`입니다. PR head, 배포, production, fixture,
qaEvidence 승인은 자동 추론하지 않습니다. 상세 운영 및 중지 방법은
[_temporal_orchestrator/README.md](_temporal_orchestrator/README.md)를 참고합니다.

## Packages

- `_customer_board`: 고객/내부 운영용 Next.js 보드와 Linear webhook
- `_diagnosis_worker`: 진단, 분류, 개발·QA 배정, 최종검수 집계를 수행하는 5분 주기 워커
- `_temporal_orchestrator`: Codex 티켓 작업의 분석·구현·승인·PR·배포 배치·QA를 내구성 있게 관리하는 Temporal control plane
- `plugins/anasa-control-plane`: Codex 앱에서 Temporal 티켓 상태와 승인 게이트를 조작하는 MCP 플러그인

## Ticket lifecycle

`Backlog → In Progress → QA Request → QA In Progress → Done`

- 개발 완료 후 개발자가 `QA Request`로 전환합니다.
- QA 담당자는 즉시 자동 배정되며, 실제 착수할 때 `QA In Progress`로 전환합니다.
- QA 통과는 `Done`, 반려는 원 개발자에게 재배정 후 `In Progress`입니다.
- 고객 피드백은 완료 티켓을 다시 열지 않고 새 Backlog 티켓으로 등록합니다.
- 고객 전달 전 검수는 마일스톤별 `[최종검수]` 집계 티켓으로 관리합니다.

## Verification

```bash
cd _customer_board
npm ci
npm test
npm run build

cd ../_diagnosis_worker
npm test
npm run dry

cd ../_temporal_orchestrator
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest
```

운영 자격증명은 `_customer_board/.env.local`에만 두며 Git에 커밋하지 않습니다. 고객 보드는 Vercel `anasa-customer-board` 프로젝트에, 워커는 macOS `launchd` 서비스 `com.litmers.anasa-linear-worker`로 배포됩니다.
