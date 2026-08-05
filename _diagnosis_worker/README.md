# Linear 운영 워커

고객 인테이크 이후의 반복 운영을 5분마다 처리한다. Linear가 원장이고, 워커는 별도 티켓 DB를 만들지 않는다.

## 실행 순서

1. `diagnose` — 화면코드/라우트 파싱, 가능하면 Playwright 재현과 증빙 코멘트
2. `classification` — `자동분류-미확정`을 Tier 1/2/3으로 확정하고 팀 라우팅
3. `questions` — 개발자 질문을 고객용 질문으로 변환; 안전하면 공개, 위험하면 검토 큐
4. `assignment` — 개발 담당자 및 `QA Request` 티켓의 QA 담당자 자동 배정
5. `final review` — 마일스톤 D-2 09:00에 상태별 모듈 최종검수 집계 티켓 생성/갱신

각 패스는 실패가 격리된다. 한 단계 실패로 뒤 단계가 중단되지 않으며, 프로세스 락으로 중복 실행을 막는다.

## 안전선

- 자동 코드 수정은 없다. Tier 1도 개발자에게 배정하고 담당자가 AI 코딩 에이전트로 처리한다.
- Tier 3는 결정적인 SQL/SP, 공유 DB 쓰기, 일괄 데이터 변경, 인증·권한·보안 경계, 되돌리기 어려운 변경만 해당한다.
- 원인이 미확정이거나 고객이 단순히 “DB 확인 필요”라고 쓴 건은 Tier 2로 계속 분배한다.
- 개발·QA 풀은 각각 활성 Linear 멤버만 사용한다. 미수락 사용자는 자신의 고정 예약분만 대기하며 다른 활성 사용자의 배정을 막지 않는다.
- 개발 완료와 QA는 새 티켓을 생성하지 않는다. `In Progress → QA Request → QA In Progress → Done` 상태를 사용한다.
- `QA Request` 진입 시 고객보드 웹훅이 QA 담당자를 즉시 배정하고 상태는 유지한다. 웹훅이 누락되면 5분 배정 pass가 같은 티켓을 중복 배정하지 않고 복구한다.
- 내부 QA 반려는 원 개발자에게 재배정하고 `In Progress`로 돌린다. 고객 피드백은 기존 완료 티켓을 재개하지 않고 새 티켓으로 접수한다.
- 안전한 폐쇄형 고객 질문만 자동 공개한다. 가격·계약·일정 확약·책임·보안 내용은 `질의검토필요`로 보낸다.
- 재현 dry-run은 스크린샷 업로드를 포함한 모든 Linear 변경을 금지한다.

## 실행

```bash
npm test
npm run dry
npm run once
npm run loop
npm run migrate:qa:provision
npm run migrate:qa:dry
npm run migrate:qa
```

`loop` 기본 간격은 5분이며 `INTERVAL_MS`로 조정한다. 상시 루프에서는 진단 폭주를 막기 위해 `MAX_PER_PASS=3`이 기본 적용된다. 야간 `--once`는 전체 대상을 처리할 수 있다.

환경변수는 `_customer_board/.env.local`을 읽는다. 필수 운영값은 `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, `LINEAR_CORE_TEAM_ID`, `LINEAR_WEBHOOK_SECRET`, 개발자 3명 UUID, QA 인턴 2명 UUID, `QA_YOONA_ID`다. 계정 UUID는 Linear의 활성 workspace member를 조회해 확인한 값만 넣는다.

개발자 또는 QA 풀 UUID가 비어 있으면 배정을 안전하게 중단한다. UUID가 설정됐지만 아직 초대를 수락하지 않은 사용자는 활성 풀에서 제외되며, 활성 사용자의 배정은 계속된다. 고정 계획 코멘트가 있는 티켓은 미수락 담당자의 예약분만 `waiting`으로 남고 수락 후 다음 5분 패스에서 같은 담당자에게 적용된다.

2026-08-04 LOG 백로그는 고객확인 4건을 제외한 126건을 Ian/Jin/Roger에게 42건씩 `2026-08-04-log-126-v1` 배치로 고정 계획했다. 이 일괄 백로그는 기존 WIP 3건 제한의 예외이며, 이후 일반 신규 티켓에는 WIP 제한을 그대로 적용한다.

## ORD 실측 회귀 기준

2026-06-19~29 자료의 이슈성 기록 69건은 32개 재발 그룹이며, 43건(62.3%)이 레이아웃·크기다. 수동 재발/단발 선택은 받지 않는다. 과거 유사 이력은 현재 단일 티켓의 참고문맥으로만 사용하며 자동 병합·종료하지 않는다. 대표 사례는 `test/fixtures/ord-history-regression.json`으로 분류 회귀검증한다.
