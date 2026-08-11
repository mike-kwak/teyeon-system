// KDK 세션 참가자 메타(kdk_session_attendee_meta.attendee_meta jsonb) 병합 규칙 — 순수 함수.
//
//   왜 별도 모듈인가: attendee_meta 는 컬럼 전체가 통째로 upsert 되는 jsonb 다.
//   저장 경로가 둘(① 이름 매칭 확정 시 게스트 출생연도 snapshot, ② 공식 확정 화면의 개별 결정)이라
//   각자 자기 값만 써 버리면 상대가 저장한 참가자 항목이 통째로 사라진다.
//   그래서 '기존 값 + 이번 결정' 병합 규칙을 여기 한 곳에 두고 양쪽이 같은 helper 를 쓴다.
//
//   저장 형태:
//     { "<playerId>": { "birthYear": 1985, "birthYearStatus": "provided" } }  // 출생연도 확인됨
//     { "<playerId>": { "birthYearStatus": "declined" } }                     // 운영자가 미입력 진행 승인
//     (키 없음)                                                                // 아직 미처리
//
//   공식 라이브 순위 RPC 는 'birthYear' 키만 읽는다 → declined 는 서버에서도 미제공(동률 후순위)이다.
//   새 테이블/새 컬럼 없이 기존 jsonb 만 사용하므로 DB 마이그레이션이 필요 없다.
//
//   의존성 없음(런타임 import 0개)이 의도적이다 — fixture(scripts/verify_official_ranking.mts)가
//   Node 의 TypeScript type-stripping 으로 이 파일을 그대로 불러 검증한다.
//   출생연도 유효성(1900~현재 연도)은 공식 규칙인 officialRanking.normalizeBirthYear 담당이며,
//   호출부(guestProfileService)가 통과시킨 값만 넘긴다. 여기서는 형식 안전만 최종 확인한다.
import type { BirthYearStatus } from './officialRanking';

/** attendee_meta 의 참가자 1명 항목. 알 수 없는 키는 그대로 보존한다(미래 확장 안전). */
export type AttendeeMetaEntry = {
  birthYear?: number;
  birthYearStatus?: BirthYearStatus;
} & Record<string, unknown>;

export type AttendeeMetaMap = Record<string, AttendeeMetaEntry>;

/** 참가자 1명에 적용할 결정 — 두 저장 경로가 공유하는 유일한 입력 형태. */
export type AttendeeBirthYearDecision =
  | { birthYear: number }  // 출생연도 입력 → provided (normalizeBirthYear 를 통과한 값만)
  | { declined: true };    // 생년 미입력으로 진행 → declined (birthYear 제거)

/**
 * 기존 항목에 결정 1건을 병합한 새 항목을 만든다(입력 객체는 변경하지 않는다).
 *   · { birthYear } → birthYear 저장 + status 'provided' (declined 였어도 명시적 변경이므로 덮어씀)
 *   · { declined }  → birthYear 키 제거 + status 'declined'
 * 그 외 키는 손대지 않는다 — '이번 입력에서 명시적으로 바꾸지 않은 값은 보존'이 원칙이다.
 */
export function applyAttendeeBirthYearDecision(
  existing: AttendeeMetaEntry | undefined,
  decision: AttendeeBirthYearDecision,
): AttendeeMetaEntry {
  const base: AttendeeMetaEntry = { ...(existing || {}) };
  if ('birthYear' in decision) {
    // 정규화는 호출부(normalizeBirthYear) 책임이지만, 정규화를 건너뛴 값이 snapshot 에 박히지 않도록
    // 4자리 정수 형식만 최종 확인한다(만 나이 43 같은 값은 여기서도 걸린다).
    const year = decision.birthYear;
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      throw new Error(`출생연도가 유효하지 않습니다: ${year}`);
    }
    return { ...base, birthYear: year, birthYearStatus: 'provided' };
  }
  delete base.birthYear; // 미제공으로 확정 — 순위 계산 입력에서 완전히 제거
  return { ...base, birthYearStatus: 'declined' };
}

/**
 * attendee_meta 전체에 여러 결정을 병합한다.
 *   · decisions 에 없는 참가자 항목은 절대 건드리지 않는다(다른 기기/다른 경로가 저장한 값 보존).
 *   · decisions 에 있는 참가자만 위 규칙대로 갱신된다.
 * 입력 map 은 변경하지 않는다.
 */
export function mergeAttendeeMeta(
  current: AttendeeMetaMap | null | undefined,
  decisions: Record<string, AttendeeBirthYearDecision>,
): AttendeeMetaMap {
  const next: AttendeeMetaMap = { ...(current || {}) };
  for (const [playerId, decision] of Object.entries(decisions || {})) {
    if (!playerId) continue;
    next[playerId] = applyAttendeeBirthYearDecision(next[playerId], decision);
  }
  return next;
}
