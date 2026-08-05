// 티어 추정 휴리스틱 — ⚠️ 어디까지나 참고 의견(advisory)이다.
// 워커는 티어 라벨을 절대 부착하지 않는다. 확정은 감사셀. 자동 하향 금지 원칙의 코드 구현:
// 신호가 겹치면 항상 더 높은(위험한) 티어를 추정으로 낸다.

const TIER3_SIGNALS = [
  /저장.{0,6}(안|않|실패|오류)/, /등록.{0,6}(안|않|실패|오류)/, /삭제/, /수정.{0,6}(안|않|실패)/,
  /재고/, /차감/, /마감/, /집계.{0,6}(다르|틀리|불일치|안 맞)/, /금액.{0,6}(다르|틀리|불일치|안 맞)/,
  /데이터.{0,6}(사라|소멸|증발|유실)/, /500/,
];
const TIER2_SIGNALS = [
  /라벨/, /컬럼명/, /표기/, /명칭/, /문구/, /이름.{0,4}(다르|틀리|이상)/,
  /조회.{0,6}(안|않|실패)/, /검색/, /필터/, /드롭다운/, /선택지/, /날짜.{0,4}기본/,
];
const TIER1_SIGNALS = [
  /버튼.{0,6}(안 눌|클릭|동작)/, /화면.{0,4}깨/, /정렬/, /스크롤/, /레이아웃/, /겹치/, /잘리/,
];

export function estimateTier(text, repro) {
  const hits = { 3: [], 2: [], 1: [] };
  for (const re of TIER3_SIGNALS) if (re.test(text)) hits[3].push(re.source);
  for (const re of TIER2_SIGNALS) if (re.test(text)) hits[2].push(re.source);
  for (const re of TIER1_SIGNALS) if (re.test(text)) hits[1].push(re.source);
  if (repro?.httpErrors?.some((e) => e.status >= 500)) hits[3].push("재현 중 5xx 실측");

  // 상향 우선: 3 > 2 > 1. 신호 전무면 판정 불가(감사셀 직행).
  if (hits[3].length) return { tier: "tier-3 의심", why: hits[3] };
  if (hits[2].length) return { tier: "tier-2 의심", why: hits[2] };
  if (hits[1].length) return { tier: "tier-1 후보", why: hits[1] };
  return { tier: "판정 불가(신호 없음)", why: [] };
}

export const SCREEN_CODE_RE = /([A-Z]{2,5}[-_][A-Z]{2,5}[-_]\d{3,4}M)/; // 이관 티켓 일부는 언더스코어 표기(PDT_PRG_006M)

// 질의 초안 내부정보 노출 검열 — 고객에게 나가면 안 되는 기술 용어
export const INTERNAL_INFO_RE =
  /(str_|proc_|tb[A-Z][a-zA-Z]+|CMTB[A-Z]*|repository|seed|스키마|쿼리|Zod|view-config|route-registry|PR ?#?\d|\bSP\b|\bAPI\b|\bBE\b|\bFE\b|백엔드|프론트엔드|데이터베이스|\bDB\b)/;

// SP 수정 정책 3분류 (2026-08-04 개정 — ANACO-10 재덤프 유실 사고 + 개발팀 SP 전수검사 반영).
// 진단 리포트에서 SP 관련 신호가 잡히면 이 정책을 확인 절차에 포함시킨다.
export const SP_POLICY_NOTE = `SP 수정 정책(3분류): DB에 얹는 커스텀 SP는 재덤프마다 유실 위험(실사고 ANACO-10).
A) 원본 SP가 덤프에 존재하고 내용 동일(base-copy 복구 계열) → BE가 원본을 호출하도록 코드 전환이 기본값(사본 폐기, 재덤프 내성).
B) 원본과 기능·성능이 다름(파라미터화·성능 재작성) → 전환 불가, DB 유지 + 재덤프 재적용 체크리스트 등재 필수.
C) 원본 자체가 없음(신규 기능 SP) → 유지 + 체크리스트 등재.
판정 참고: workspace/_perf/SP_DRIFT_COMPLETE_20260721.md(복구 방식별 목록).`;

export const SP_SIGNAL_RE = /(str_[A-Za-z]|proc_[A-Za-z]|\bSP\b|프로시저|저장\s?프로시저)/;
