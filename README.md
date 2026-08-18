# Anasa Workflow Automation

Anasa 프로젝트의 Linear 티켓 수명주기, 담당자 자동 배정, 내부 QA, 고객 보드와 모듈 단위 최종검수를 관리하는 운영 자동화 모노레포입니다.

## Packages

- `_customer_board`: 고객/내부 운영용 Next.js 보드와 Linear webhook
- `_diagnosis_worker`: 진단, 분류, 개발·QA 배정, 최종검수 집계를 수행하는 5분 주기 워커
- `_temporal_orchestrator`: Codex 티켓 작업의 상태·승인·배포 배치를 내구성 있게 관리하는 Temporal shadow-mode PoC

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
