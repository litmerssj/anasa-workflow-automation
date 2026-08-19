# ANASA Temporal Control Plane

ANASA 티켓별 작업은 각 visible Codex task가 독립적으로 소유하고, Temporal은 task registry와
FE/BE 통합 머지를 durable Workflow로 관리합니다.

```text
Codex 앱 visible project task ── ANASA MCP Plugin ── Temporal
          ├── Linear                                   ├── durable state
          ├── Git/GitHub                               ├── approval history
          └── analysis/implementation                  └── backend batch
```

평소 사용자 화면은 Codex 앱입니다. `localhost:8233`의 Temporal 기본 UI는 Workflow
event history와 장애를 디버깅할 때만 사용합니다.

## 한 번에 실행

Python 환경과 Temporal CLI를 최초 한 번 준비합니다.

```bash
cd /Users/cigro/Desktop/anasa-workflow-automation/_temporal_orchestrator
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
brew install temporal
```

Linear 자격증명은 기존 원칙대로 `_customer_board/.env.local` 한 곳에만 둡니다.
오케스트레이터의 비밀이 아닌 로컬 설정은 이 디렉터리의 `.env`를 사용합니다.

```bash
cp ../_customer_board/.env.example ../_customer_board/.env.local
cp .env.example .env
```

GitHub PR·merge·workflow 조작에는 유효한 GitHub CLI 인증이 필요합니다.

```bash
gh auth login -h github.com
```

이후에는 아래 명령 하나로 Temporal 서버(없을 때만)와 v2 worker를 실행합니다.

```bash
.venv/bin/anasa-local
```

Codex 앱의 `anasa-control-plane` 플러그인이 이 worker와 통신합니다. 기존에 수동으로
실행한 `anasa-worker`는 v1 task queue를 사용하므로 새 v2 worker와 섞이지 않습니다.

## 역할 경계

- 각 티켓 task: 분석, 사용자 피드백, Dev Q, 개발방향, 구현, 테스트, PR exact-SHA 승인,
  티켓별 QA와 완료
- 중앙 관리자: 최대 8개 티켓 task 일괄 생성/채택, backend 통합 머지/배포, frontend 통합
  머지/main release
- Temporal: visible task registry, FE/BE ready queue, exact candidate manifest, integration failure와
  단계별 시간 보존

중앙 관리자는 일반 티켓 지시를 중계하거나 모든 티켓을 계속 polling하지 않습니다.

## Codex 앱에서 하는 일

- `63, 65, 76`처럼 최대 8개 티켓 일괄 시작
- Linear description, 댓글, 첨부·연관 티켓을 포함한 읽기 전용 분석
- app이 만든 실제 thread/worktree를 `anasa_register_visible_tickets`로 한 번에 등록
- 티켓 task가 승인된 PR을 `anasa_publish_integration_candidate`로 FE/BE ready queue에 게시
- 중앙에서 ready candidate만 조회해 한 integration PR로 merge/release
- QA 반려 시 `anasa_reopen_visible_ticket`으로 같은 task와 tracker를 재사용
- `anasa_health`로 integration 시작 전 worker poller 확인

실제 agent는 Codex 앱의 `anasa` 프로젝트 worktree task에서 실행됩니다. Temporal은 agent를
headless로 실행하지 않습니다. `anasa_sync_visible_ticket`은 patch semantic이므로 생략한
report/scope/PR/SHA를 빈 값으로 지우지 않습니다.

## 빠른 통합 배포

- candidate PR 상태 검사를 병렬 실행
- integration worktree fetch는 repository당 한 번
- whole merge/deploy activity 자동 재시도 금지; frozen manifest의 명시적 retry만 허용
- GitHub deployment run 발견 후 `gh run watch --interval 5`로 전환
- batch 결과에 candidate validation, PR assembly, merge, deploy wait 시간을 기록
- staging DB/migration은 transient 연결 오류만 재시도하고 deterministic contract/data 오류는
  첫 실패에서 중단
- 정상 배포는 Docker layer를 보존하고 disk usage 85% 이상일 때만 오래된 layer를 정리
- API 시작은 고정 30초 sleep 대신 즉시 5초 health polling

## Workflow

```text
PREPARE_WORKSPACE
→ FETCH_TICKET
→ ANALYZE
→ WAIT_CUSTOMER_ANSWER (필요 시)
→ WAIT_DIRECTION_APPROVAL
→ START_DEVELOPMENT
→ IMPLEMENT
→ PREPARE_PR
→ WAIT_PR_APPROVAL
→ WAIT_BACKEND_BATCH (BE 변경)
→ WAIT_RELEASE_AUTHORIZATION (FE 변경)
→ WAIT_QA_EVIDENCE
→ COMPLETE_LINEAR
→ COMPLETE
```

Integration activity는 외부 merge/deploy를 수행하므로 자동 재시도하지 않습니다. 실패한
Workflow는 `BLOCKED`에서 manifest와 원인을 보존하며, 동일 artifact의 명시적 retry만 허용합니다.

## 실제 구현 경계

- Workflow 시작: 티켓별 `/Users/cigro/Desktop/.anasa-worktrees/ANA-N/...` FE/BE worktree 생성
- 분석: Codex `Sandbox.read_only` + `ApprovalMode.deny_all`
- 개발방향 승인 후 구현: Codex `Sandbox.workspace_write` + `ApprovalMode.deny_all`
- Codex는 코드·테스트만 변경하며 commit/push/PR/Linear/deploy는 Temporal Activity가 담당
- PR 승인은 repository → exact head SHA map에 결박
- backend batch는 포함 티켓과 승인 SHA manifest를 고정한 뒤 merge하고 배포 workflow를 1회 실행
- 최종 Linear comment는 workflow-core의 `PR/커밋`, `스모크`, `수정 전`, `수정 후` 계약만 작성

`ANASA_PREVIEW_ONLY=true`가 기본값입니다. 프리뷰 성공은 staging smoke·qaEvidence·완료를
대체하지 않습니다. Named release를 허용하려면 `.env`의 `ANASA_RELEASE_TICKETS`에
`ANA-65,ANA-76`처럼 exact scope를 넣고 worker를 재시작해야 합니다. 그 뒤에도 FE
production과 backend staging tool은 각각 `PRODUCTION ANA-N`,
`DEPLOY BACKEND <batch-id>` 확인 문구가 필요합니다.

## 로컬 보안

- MCP server는 Codex가 로컬 stdio child process로만 실행하고 네트워크 포트를 열지 않음
- 조회와 보고는 자유롭지만 scope/SHA/deploy/qaEvidence는 별도 명시 승인 필요
- Backend와 FE release tool은 각각 `DEPLOY BACKEND <batch-id>`, `PRODUCTION ANA-N` 확인 필요
- 비밀값과 `.temporal` DB는 Git에서 제외

## Codex 앱 플러그인

개인 plugin `anasa-control-plane`은 `anasa-mcp` stdio server를 통해 같은 Temporal service를
사용합니다. 새 Codex 작업에서 다음과 같이 말할 수 있습니다.

```text
65 상태와 조사 보고 보여줘
65에 "FE만 수정하고 컬럼은 그대로 유지"라고 추가 지시해
65 개발 방향 승인
65 PR exact SHA 승인
65, 76을 batch-20260818로 backend 배포
```

플러그인은 사용자의 명시적 승인 없이 direction, SHA, backend deployment, FE production,
qaEvidence를 추론하지 않습니다.

## CLI 백업

```bash
anasa-orchestrator start '63,65' --prompt '추가 지시'
anasa-orchestrator status ANA-65
anasa-orchestrator instruction ANA-65 '진행 중 추가 지시'
anasa-orchestrator approve-direction ANA-65 <scope-hash>
anasa-orchestrator approve-pr ANA-65 be_anasa=<sha> fe_anasa=<sha>
```

## 검증

```bash
.venv/bin/pytest
.venv/bin/python -m pip check
```

테스트는 Temporal ephemeral server에서 scope/PR 승인 무효화, 진행 중 프롬프트 재분석·
재구현, backend batch gate, qaEvidence, BLOCKED retry, MCP stdio tool
노출을 검증합니다.

## Sources

- [OpenAI Codex SDK](https://developers.openai.com/codex/codex-sdk)
- [Temporal Python SDK](https://docs.temporal.io/develop/python)
- [Temporal Workflow message passing](https://docs.temporal.io/develop/python/workflows/message-passing)
