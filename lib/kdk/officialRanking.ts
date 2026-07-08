// TEYEON KDK 공식 순위 — 단일 comparator (모든 화면·확정·재계산 경로가 이것만 사용).
//
//   공식 기준(2026-07-08 확정, Guest Pass 안내 문구와 반드시 일치해야 함):
//     ① 승수 ↓  ② 득실 ↓  ③ 연소자 우위(출생연도 큰 값 우선)
//     ④ 이름 가나다 ↑  ⑤ stable player id ↑
//
//   연소자 규칙 상세:
//     · 데이터는 '나이'가 아니라 4자리 출생연도(예: 1982). 출생연도가 클수록 어리므로 내림차순.
//       (기존 useRanking 의 age 오름차순을 재사용하면 안 됨 — 출생연도에 적용 시 연장자 우위로 역전)
//     · 출생연도 미제공 참가자는 완전 동률 시 후순위(제공자가 우선).
//     · 양쪽 모두 미제공이면 이름 → id 로 결정(입력순/정렬 안정성에 기대지 않음).
//
//   범위 밖: 과거 공식 Archive 의 저장된 ranking_data 는 절대 재정렬하지 않는다 —
//   이 helper 는 '지금 계산하는' 순위에만 쓰인다(2026-07-07 동률 오확정 사고 재발 방지).

export type OfficialRankingEntry = {
  /** stable id — members.id / manual-guest-<key>. Archive 재계산처럼 id 가 없으면 name 을 그대로 사용. */
  playerId: string;
  name: string;
  wins: number;
  losses?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  diff: number;
  /** 4자리 출생연도. 미상이면 null/undefined. */
  birthYear?: number | null;
};

/**
 * 출생연도 정규화 — 4자리 연도(1900 ≤ 연도 ≤ 현재 연도)만 인정.
 * 현재 연도보다 큰 값(미래), 만 나이 숫자(예: 43), 빈 값/문자는 전부 null.
 * members."나이" 컬럼(텍스트 "1982")과 attendeeConfigs.age(과거 운영 입력) 모두 안전하게 통과 가능.
 *
 * referenceYear: 기본은 호출 시점의 현재 연도. 테스트가 실행 연도에 흔들리지 않도록
 * 기준 연도를 주입할 수 있다(운영 코드는 기본값 사용).
 */
export function normalizeBirthYear(
  value: unknown,
  referenceYear: number = new Date().getFullYear(),
): number | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? value : parseInt(String(value).trim(), 10);
  if (!Number.isInteger(raw)) return null;
  return raw >= 1900 && raw <= referenceYear ? raw : null;
}

export function compareOfficialKdkRanking(
  a: OfficialRankingEntry,
  b: OfficialRankingEntry,
): number {
  // ① 승수 ↓
  if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
  // ② 득실 ↓
  if ((b.diff || 0) !== (a.diff || 0)) return (b.diff || 0) - (a.diff || 0);
  // ③ 연소자 우위 — 출생연도 큰 값 우선, 미제공은 후순위
  const ay = normalizeBirthYear(a.birthYear);
  const by = normalizeBirthYear(b.birthYear);
  if (ay !== null || by !== null) {
    if (ay === null) return 1;   // a 미제공 → 후순위
    if (by === null) return -1;  // b 미제공 → 후순위
    if (ay !== by) return by - ay; // 큰 연도(어린 쪽) 우선
  }
  // ④ 이름 가나다 ↑
  const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  if (byName !== 0) return byName;
  // ⑤ stable id ↑ — 동명이인까지 결정적으로
  return String(a.playerId || '').localeCompare(String(b.playerId || ''));
}

/** 공식 정렬 + rank(1부터) 부여. 입력 배열은 변경하지 않는다. */
export function sortOfficialKdkRanking<T extends OfficialRankingEntry>(
  entries: readonly T[],
): Array<T & { rank: number }> {
  return [...entries]
    .sort(compareOfficialKdkRanking)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
