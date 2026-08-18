# ANASA Temporal Control Plane

ANASA 티켓의 조사, 사용자 보고, 개발방향 승인, Codex 구현, PR exact-SHA 승인,
backend 통합 배포, QA 증빙을 durable Temporal Workflow로 관리합니다.

```text
Codex 앱 ── ANASA MCP Plugin ── Temporal ── Codex SDK ticket worker
                                  ├── Linear
                                  ├── Git/GitHub
                                  └── approved deployment workflow
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

## Codex 앱에서 하는 일

- `63, 65, 76`처럼 최대 8개 티켓 일괄 시작
- Linear description, 댓글, 첨부·연관 티켓을 포함한 읽기 전용 분석
- 다음 형식의 텍스트 보고
  - 티켓 이해 내용
  - 현재 동작과 원인
  - 개발 방향
  - 변경 영향
  - 검증 계획
  - 남은 결정/위험
- 고객 결정이 필요하면 `[Dev Q]` 텍스트 보고
- 진행 중 Workflow에 추가 프롬프트 전달
- scope hash 개발방향 승인
- 구현·테스트 후 생성된 FE/BE PR exact SHA 승인
- 승인 backend 티켓을 지정해 한 배치로 merge·staging deploy
- FE production release 명시 승인
- 실제 스모크·수정 전·수정 후 증거를 입력한 뒤 최종 Linear qaEvidence와 QA Request

추가 프롬프트는 같은 `codex_thread_id`를 resume합니다. 개발방향 승인 전이면 재분석하고,
PR 승인 전이면 재구현·재검증하여 새 head SHA를 만들고 이전 승인을 무효화합니다. Backend
batch assignment 또는 release가 시작된 뒤에는 같은 Workflow의 범위 변경을 차단합니다.

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

Activity가 3회 실패하면 Workflow는 종료되지 않고 `BLOCKED`에서 원인과 resume state를
보존합니다. 동일 범위·artifact 재시도만 허용하며, 행동 변경은 추가 프롬프트와 새 승인을
거칩니다.

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
