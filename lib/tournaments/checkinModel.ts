// 현장 팀 체크인 — 순수 판정(검색 · 필터 · 요약 · Control Center 조회용 표).
//
//   ⚠ 서버 값을 그대로 쓴다. 요약 숫자는 서버가 준 total / checkedIn 을 우선한다.
//   ⚠ 체크인은 '팀 단위'다. 선수 한 명만 도착한 상태를 따로 두지 않는다(본부가 두 명 모두 확인한 뒤 누른다).
//   ⚠ 화면 순서 · 조 표시는 조편성(본부 조회)에서 team_id 로 맞춘다 — 표시 전용. team_id · 팀 번호 · 경기 연결은 그대로.

import { placementPublicSlot } from './publicGroupNo';

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

// ── 조편성 순서 · 조 표시(표시 전용) ──────────────────────────────────────────

/** 체크인 카드의 자리 — '3조 2번'. publicNo 가 null 이면(번호를 정할 수 없는 순위결정전) 이름만. */
export interface CheckinSeat {
  /** 공개 조 번호(내부 19 → 1). null = 번호를 정할 수 없음 → label 은 '순위결정전'. */
  publicNo: number | null;
  /** '3조' · '1조' · '순위결정전' */
  label: string;
  /** 조 안 순번(확정 조편성 순서, 1부터) */
  order: number;
  /** 정렬 키(작을수록 앞) */
  rank: number;
}

/** 조편성 조회에서 쓰는 최소 모양 — 본부 조편성 조회(get_admin_preliminary_draw) 결과와 맞는다. */
export interface CheckinDrawGroup {
  groupNo: number;
  groupType: 'preliminary' | 'placement' | string;
  members: { teamId: string; slotNo: number }[];
}

/** team_id → 자리. */
export type CheckinSeatMap = ReadonlyMap<string, CheckinSeat>;

/**
 * 조편성 → team_id 별 자리(공개 조 번호 · 조 안 순번).
 *   · 일반 조는 내부 번호 그대로, 순위결정전은 공개 번호 규칙(일반 조 2 ~ 18 → 1조, 맨 앞).
 *   · 공개 번호를 정할 수 없는 순위결정전은 번호 없이 '순위결정전'(맨 뒤) — 번호를 추측하지 않는다.
 *   · 조 안 순서 = slot_no 순(확정 조편성 순서). 순번은 1부터 빈틈없이.
 *   · 조가 없거나 같은 팀이 두 조에 있으면 null(=모름) — 화면은 기존 순서로 돌아간다.
 */
export function buildCheckinSeats(groups: CheckinDrawGroup[]): CheckinSeatMap | null {
  const pre = groups.filter((g) => g.groupType !== 'placement');
  const placement = groups.filter((g) => g.groupType === 'placement').sort((a, b) => a.groupNo - b.groupNo);
  if (pre.length === 0) return null;
  const preNos = pre.map((g) => g.groupNo);
  if (new Set(preNos).size !== preNos.length) return null;
  const maxPre = Math.max(...preNos);
  const map = new Map<string, CheckinSeat>();
  const put = (g: CheckinDrawGroup, publicNo: number | null, label: string, base: number): boolean => {
    const members = [...g.members].sort((a, b) => a.slotNo - b.slotNo);
    for (let i = 0; i < members.length; i += 1) {
      const id = members[i].teamId;
      if (!id || map.has(id)) return false;
      map.set(id, { publicNo, label, order: i + 1, rank: base * 100 + i });
    }
    return true;
  };
  for (const g of pre) if (!put(g, g.groupNo, `${g.groupNo}조`, g.groupNo)) return null;
  for (let i = 0; i < placement.length; i += 1) {
    const slot = placementPublicSlot(preNos, i);
    const ok = slot
      ? put(placement[i], slot.no, `${slot.no}조`, slot.at === 'lead' ? 0 : slot.no)
      : put(placement[i], null, '순위결정전', maxPre + 1000 + i);
    if (!ok) return null;
  }
  return map;
}

/** 자리 문구 — '3조 2번'. 자리를 모르면 null. */
export const seatText = (seat: CheckinSeat | undefined): string | null =>
  seat ? `${seat.label} ${seat.order}번` : null;

/**
 * 화면 순서 — 자리 순(1조 → 2조 → … · 조 안 확정 순서). 자리가 없는 팀(미배정)은 맨 뒤 팀 번호 순.
 *   seats 가 null(조편성 조회 실패 · 없음)이면 서버 순서(팀 번호) 그대로.
 */
export function orderBySeat(rows: TeamCheckinRow[], seats: CheckinSeatMap | null): TeamCheckinRow[] {
  if (!seats) return rows;
  return [...rows].sort((a, b) => {
    const sa = seats.get(a.teamId); const sb = seats.get(b.teamId);
    if (sa && sb) return sa.rank - sb.rank;
    if (sa) return -1;
    if (sb) return 1;
    return a.teamNo - b.teamNo;
  });
}

/** 검색어가 조를 뜻하면 그 조 · 순번. '3조' · '3조2번' · '3조 2' 모두. 아니면 null. */
export function seatQuery(query: string): { no: number; order: number | null } | null {
  const m = /^(\d{1,2})조(?:(\d{1,2})번?)?$/.exec(norm(query));
  if (!m) return null;
  return { no: Number(m[1]), order: m[2] ? Number(m[2]) : null };
}

/** 한 팀이 검색어에 맞는가 — 조('3조' · '3조 2번' · 조편성을 알면 숫자만) · 팀 번호(조편성을 모를 때만) · 선수 이름 · 클럽 이름(부분). */
export function matchesQuery(row: TeamCheckinRow, query: string, seats: CheckinSeatMap | null = null): boolean {
  const q = norm(query);
  if (q === '') return true;
  const no = teamNoQuery(query);
  // 조편성을 알면 숫자만 입력해도 조로 찾는다(내부 팀 번호는 화면에 없으므로 쓰지 않는다).
  const sq = seatQuery(query) ?? (seats && no !== null ? { no, order: null } : null);
  if (sq) {
    const seat = seats?.get(row.teamId);
    return !!seat && seat.publicNo === sq.no && (sq.order === null || seat.order === sq.order);
  }
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

/**
 * 화면 목록 — 필터 + 검색. 순서는 자리 순(조편성을 모르면 서버 순서 = 팀 번호).
 *   필터 · 검색 모두 같은 순서를 쓴다(정렬 뒤에 거른다).
 */
export function visibleTeams(
  rows: TeamCheckinRow[], query: string, filter: CheckinFilter, seats: CheckinSeatMap | null = null,
): TeamCheckinRow[] {
  const ordered = orderBySeat(rows, seats);
  // 검색어가 있으면 필터와 무관하게 찾는다 — '체크인했는지 모르는 팀' 을 찾는 경우가 많다.
  if (query.trim() !== '') return ordered.filter((r) => matchesQuery(r, query, seats));
  return ordered.filter((r) => matchesFilter(r, filter));
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
