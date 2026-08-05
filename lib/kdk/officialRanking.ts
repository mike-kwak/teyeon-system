// TEYEON KDK 공식 순위 — 단일 comparator (모든 화면·확정·재계산 경로가 이것만 사용).
//
//   공식 기준(2026-08-05 개정, Guest Pass 안내 문구와 반드시 일치해야 함):
//     ① 승수 ↓  ② 득실 ↓  ③ 연장자 우위(출생연도 작은 값 우선)
//     ④ 이름 가나다 ↑  ⑤ stable player id ↑
//
//   연장자 규칙 상세:
//     · 데이터는 '나이'가 아니라 4자리 출생연도(예: 1982). 출생연도가 작을수록 나이가 많으므로 오름차순.
//       1980년생 vs 1982년생이 완전 동률이면 1980년생이 상위.
//     · 출생연도 미제공 참가자는 완전 동률 시 후순위(제공자가 우선) — 방향 변경과 무관하게 기존 정책 유지.
//     · 양쪽 모두 미제공이면 이름 → id 로 결정(입력순/정렬 안정성에 기대지 않음).
//     · 회원·게스트 구분 없이 동일 규칙(별도 comparator 금지).
//
//   개정 이력: 2026-07-08 연소자 우위 → 2026-08-05 연장자 우위(클럽 운영 결정).
//   승수·득점·실점·득실 계산식은 개정 대상이 아니며 그대로다(변경된 것은 ③ 방향뿐).
//
//   범위 밖: 과거 공식 Archive 의 저장된 ranking_data 는 절대 재정렬하지 않는다 —
//   이 helper 는 '지금 계산하는' 순위에만 쓰인다(2026-07-07 동률 오확정 사고 재발 방지).
//   따라서 이 개정은 배포 이후 새로 진행/확정되는 KDK 와 ranking_data 가 없는 Archive
//   fallback 재계산에만 적용된다.

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

// ── 공식 기준 단위 비교자 ────────────────────────────────────────────────────
//   compareOfficialKdkRanking 은 아래 4개의 조합이다. 우선순위를 사용자가 바꿀 수 있는
//   화면(/kdk/ranking LEADERBOARD)도 인라인 비교 로직을 두지 말고 이 단위 비교자를
//   조합해야 한다 — 규칙(특히 ③ 연장자 방향과 미제공 후순위)의 정의는 여기 한 곳뿐이다.

/** ① 승수 ↓ */
export function compareOfficialWins(a: OfficialRankingEntry, b: OfficialRankingEntry): number {
  return (b.wins || 0) - (a.wins || 0);
}

/** ② 공식 2차 성적 기준(득실) ↓ — 계산식은 각 화면의 집계가 담당하고, 여기서는 비교만 한다. */
export function compareOfficialSecondary(a: OfficialRankingEntry, b: OfficialRankingEntry): number {
  return (b.diff || 0) - (a.diff || 0);
}

/** ③ 연장자 우위 — 출생연도 작은 값 우선, 미제공은 후순위(양쪽 미제공이면 0). */
export function compareOfficialBirthYear(a: OfficialRankingEntry, b: OfficialRankingEntry): number {
  const ay = normalizeBirthYear(a.birthYear);
  const by = normalizeBirthYear(b.birthYear);
  if (ay === null && by === null) return 0;
  if (ay === null) return 1;   // a 미제공 → 후순위
  if (by === null) return -1;  // b 미제공 → 후순위
  return ay - by;              // 작은 연도(나이 많은 쪽) 우선
}

/**
 * ④ 이름 ↑ → ⑤ stable id ↑ — 최종 결정자(항상 마지막에 적용).
 * 유니코드 코드포인트 비교(한글 음절 블록은 코드포인트 순서 = 가나다순).
 * localeCompare('ko') 대신 코드포인트를 쓰는 이유: 서버 RPC(COLLATE "C")와
 * 환경(ICU 유무)에 관계없이 byte-단위로 동일한 순서를 보장하기 위해서다.
 * stable id 는 정렬 전용 — 화면/응답에 노출하지 않는다.
 */
export function compareOfficialNameThenId(a: OfficialRankingEntry, b: OfficialRankingEntry): number {
  const aName = String(a.name || '');
  const bName = String(b.name || '');
  if (aName !== bName) return aName < bName ? -1 : 1;
  const aId = String(a.playerId || '');
  const bId = String(b.playerId || '');
  if (aId !== bId) return aId < bId ? -1 : 1;
  return 0;
}

export function compareOfficialKdkRanking(
  a: OfficialRankingEntry,
  b: OfficialRankingEntry,
): number {
  return compareOfficialWins(a, b)
    || compareOfficialSecondary(a, b)
    || compareOfficialBirthYear(a, b)
    || compareOfficialNameThenId(a, b);
}

/** 공식 정렬 + rank(1부터) 부여. 입력 배열은 변경하지 않는다. */
export function sortOfficialKdkRanking<T extends OfficialRankingEntry>(
  entries: readonly T[],
): Array<T & { rank: number }> {
  return [...entries]
    .sort(compareOfficialKdkRanking)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
