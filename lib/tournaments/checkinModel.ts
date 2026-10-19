// 현장 팀 체크인 — 순수 판정(검색 · 필터 · 요약 · Control Center 조회용 표).
//
//   ⚠ 서버 값을 그대로 쓴다. 요약 숫자는 서버가 준 total / checkedIn 을 우선한다.
//   ⚠ 체크인은 '팀 단위'다. 선수 한 명만 도착한 상태를 따로 두지 않는다(본부가 두 명 모두 확인한 뒤 누른다).

export type TeamCheckinStatus = 'active' | 'withdrawn';

export interface TeamCheckinRow {
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  player1ClubName: string | null;
  player2ClubName: string | null;
  clubName: string | null;
  status: TeamCheckinStatus;
  /** 체크인 시각(서버 ISO). 미체크인이면 null. */
  checkedInAt: string | null;
}

export interface TeamCheckinBoard {
  slug: string;
  teams: TeamCheckinRow[];
  /** active 팀 수 */
  total: number;
  /** active 팀 중 체크인 수 */
  checkedIn: number;
  withdrawn: number;
  serverNow: string | null;
}

export type CheckinFilter = 'pending' | 'done' | 'all';

/** 검색어 정규화 — 공백 제거 · 소문자. */
const norm = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/**
 * 검색어가 팀 번호를 뜻하면 그 번호. 'TEAM 12' · '#12' · '12번' · '12팀' · '12' 모두 12.
 *   ⚠ 숫자만 남는 경우에만 번호로 본다(이름 속 숫자와 섞지 않는다).
 */
export function teamNoQuery(query: string): number | null {
  const q = norm(query).replace(/^(team|팀|#|no\.?)/, '').replace(/(번|팀)$/, '');
  if (!/^\d{1,3}$/.test(q)) return null;
  const n = Number(q);
  return n >= 1 ? n : null;
}

/** 한 팀이 검색어에 맞는가 — 팀 번호(정확히) 또는 선수 이름 · 클럽 이름(부분). */
export function matchesQuery(row: TeamCheckinRow, query: string): boolean {
  const q = norm(query);
  if (q === '') return true;
  const no = teamNoQuery(query);
  if (no !== null && row.teamNo === no) return true;
  const hay = norm([
    row.player1Name, row.player2Name,
    row.player1ClubName ?? '', row.player2ClubName ?? '', row.clubName ?? '',
  ].join('|'));
  return hay.includes(q);
}

export function matchesFilter(row: TeamCheckinRow, filter: CheckinFilter): boolean {
  if (filter === 'all') return true;
  // 기권 팀은 '미체크인' 목록에서 뺀다(할 일이 아니다). 전체에서만 보인다.
  if (filter === 'pending') return row.status === 'active' && row.checkedInAt === null;
  return row.checkedInAt !== null;
}

/** 화면 목록 — 필터 + 검색. 순서는 팀 번호(서버 순서 그대로). */
export function visibleTeams(rows: TeamCheckinRow[], query: string, filter: CheckinFilter): TeamCheckinRow[] {
  // 검색어가 있으면 필터와 무관하게 찾는다 — '체크인했는지 모르는 팀' 을 찾는 경우가 많다.
  if (query.trim() !== '') return rows.filter((r) => matchesQuery(r, query));
  return rows.filter((r) => matchesFilter(r, filter));
}

export interface CheckinSummary {
  total: number;
  checkedIn: number;
  pending: number;
  withdrawn: number;
  /** 0~100 정수 */
  percent: number;
}

export function checkinSummary(board: TeamCheckinBoard): CheckinSummary {
  const total = Math.max(0, board.total);
  const checkedIn = Math.min(Math.max(0, board.checkedIn), total);
  return {
    total, checkedIn, pending: total - checkedIn, withdrawn: Math.max(0, board.withdrawn),
    percent: total === 0 ? 0 : Math.floor((checkedIn / total) * 100),
  };
}

/** 한 팀의 결과를 목록에 반영한다(서버 응답 기준). 요약도 함께 고친다. */
export function applyCheckinResult(
  board: TeamCheckinBoard, teamId: string, checkedInAt: string | null,
): TeamCheckinBoard {
  let delta = 0;
  const teams = board.teams.map((t) => {
    if (t.teamId !== teamId) return t;
    if (t.status === 'active') {
      if (t.checkedInAt === null && checkedInAt !== null) delta = 1;
      if (t.checkedInAt !== null && checkedInAt === null) delta = -1;
    }
    return { ...t, checkedInAt };
  });
  return { ...board, teams, checkedIn: board.checkedIn + delta };
}

/** Control Center 용 — 팀 번호 → 체크인 여부. 팀 번호는 대회 안에서 유일하다(DB 제약). */
export type CheckinLookup = ReadonlyMap<number, { checkedIn: boolean; status: TeamCheckinStatus }>;

export function checkinLookup(board: TeamCheckinBoard): CheckinLookup {
  return new Map(board.teams.map((t) => [t.teamNo, { checkedIn: t.checkedInAt !== null, status: t.status }]));
}

/**
 * 투입하려는 경기에서 체크인 안 된 팀 번호들.
 *   lookup 이 없으면(조회 실패 · 미적용) null — '모름' 이다. 빈 배열(= 모두 체크인)과 구분한다.
 *   목록에 없는 팀 번호도 '모름' 으로 보고 경고하지 않는다(잘못된 경고로 진행을 막지 않는다).
 *   기권 팀은 체크인 대상이 아니므로 여기서 세지 않는다(기권 경기는 기존 운영 판단 그대로).
 */
export function uncheckedTeams(lookup: CheckinLookup | null, teamNos: number[]): number[] | null {
  if (!lookup) return null;
  return teamNos.filter((n) => {
    const v = lookup.get(n);
    return v !== undefined && v.status === 'active' && !v.checkedIn;
  });
}
