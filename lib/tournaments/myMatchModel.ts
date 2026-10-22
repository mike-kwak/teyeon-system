// MY MATCH — 참가자가 고른 '내 팀' 의 경기만 모으고, 두 번의 조회 사이 상태 변화를 알림으로 바꾼다.
//
//   ⚠ 데이터는 공개 RPC 두 개(get_public_preliminary_draw · get_public_knockout_bracket) 응답 그대로다.
//     새 RPC · 원본 테이블 · 개인정보 없음. 순위 · 진출 · 승자는 서버 값을 옮길 뿐 다시 계산하지 않는다.
//   ⚠ 팀 식별자는 teamNo(대회 안에서 unique). 같은 이름 대비로 선수 두 명 이름을 함께 저장해 대조한다.
//   ⚠ 경기 식별자는 단계 접두어 + matchNo — 'P'(예선) · 'L'(순위결정전) · 'K'(본선). 단계가 달라도 충돌하지 않는다.
//   ⚠ 코트 알림은 서버가 'playing' 일 때 주는 실제 코트로만 만든다(실제 투입 후).
//     운영진이 지정한 조별 순서 · 예정 코트 · 신고 마감(get_public_group_schedule)은 MyMatchSchedule 로 '안내만' 한다
//     — 예정 코트로는 알림을 만들지 않는다(diffEvents 는 schedule 을 보지 않는다).

import type { PublicPreliminaryDraw } from './publicDrawTypes';
import type { PublicKnockoutBracket } from './publicKnockoutTypes';
import { scheduleForGroup, type GroupScheduleInfo, type PublicGroupSchedule } from './groupScheduleModel';
import { groupFirstMatch, placementFirstMatch, type FirstMatchInfo } from './firstMatchModel';
import { PLACEMENT_NAME, placementPublicLabel, placementPublicNo } from './publicGroupNo';

export type MyStage = 'P' | 'L' | 'K';
export type MyStatus = 'waiting' | 'calling' | 'playing' | 'completed';

export interface MyTeam {
  teamNo: number;
  player1Name: string;
  player2Name: string;
  /** 예선 조 번호(본선 목록에서만 찾은 팀이면 null). 순위결정전 팀은 내부 조 번호 — ⚠ 화면에 숫자로 쓰지 않는다(teamGroupLabel). */
  groupNo: number | null;
  /** 순위결정전 참가 팀인가(일반 조 순위표가 아니라 순위결정전 목록에서 찾은 팀). */
  placement: boolean;
  /** 순위결정전 팀의 공개 조 번호(일반 조 2 ~ N 이면 1). 번호를 정할 수 없거나 일반 조 팀이면 null. 표시 전용. */
  placementNo?: number | null;
  withdrawn: boolean;
}

/** 팀의 조 표시 — 일반 조 'N조' · 순위결정전 공개 번호('1조', 없으면 '순위결정전') · 본선에서만 찾은 팀 ''. 내부 조 번호(예: 19)는 쓰지 않는다. */
export const teamGroupLabel = (t: Pick<MyTeam, 'groupNo' | 'placement' | 'placementNo'>): string =>
  t.placement ? placementPublicLabel(t.placementNo ?? null) : t.groupNo ? `${t.groupNo}조` : '';

export interface MyOpponent {
  teamNo: number;
  player1Name: string;
  player2Name: string;
}

export interface MyMatch {
  /** 알림 · 화면 key — 단계 접두어 + 경기 번호(예: 'P12' · 'K40'). */
  key: string;
  stage: MyStage;
  matchNo: number;
  /** 참가자에게 보이는 경기 이름 — '3조 2경기' · '32강 MATCH 12' · '순위결정전'. */
  title: string;
  status: MyStatus;
  /** 진행 중일 때만 값이 있다(서버 규약). 순위결정전은 공개 응답에 코트가 없어 항상 null. */
  courtNo: number | null;
  courtName: string | null;
  opponent: MyOpponent | null;
  myScore: number | null;
  oppScore: number | null;
  /** 완료 경기의 결과(서버 winnerSide 기준). */
  result: 'win' | 'loss' | null;
  /** 본선: 이기면 올라가는 라운드 이름('16강' · '우승'). */
  nextRoundName: string | null;
  /** 정렬 — 예선(조 · 순서) → 순위결정전 → 본선(라운드 · 경기 번호). */
  order: number;
}

/** 내 팀이 본선 자리에 있지만 상대가 아직 정해지지 않은 상태(경기가 아직 만들어지지 않음). */
export interface MyPendingSlot {
  roundName: string;
  /** 상대 자리 표시 — '3조 1위' · '앞 경기 승자' 등. */
  opponentLabel: string;
}

/** 운영진이 지정한 내 조의 순서 · 예정 코트 · 신고 마감 · 장소(안내 전용 — 알림에 쓰지 않는다). */
export type MyMatchSchedule = GroupScheduleInfo;

export interface MyMatchView {
  team: MyTeam | null;
  matches: MyMatch[];
  /** 진행 중 · 호출 중 경기(있으면 하나). */
  current: MyMatch | null;
  /** 아직 시작 전인 가장 이른 경기. */
  next: MyMatch | null;
  results: MyMatch[];
  pendingSlot: MyPendingSlot | null;
  /** 본선 대진이 공개돼 이번 조회에 들어왔는가. */
  knockoutLoaded: boolean;
  schedule: MyMatchSchedule | null;
  /** 내 팀이 그 조(순위결정전)의 첫 경기에 나가면 그 첫 경기 정보 — 실제 경기 행에서만. 아니면 null. */
  first: FirstMatchInfo | null;
}

// ── 팀 목록 ─────────────────────────────────────────────────────────────────

const normName = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/** 공개 데이터의 모든 팀(예선 조 순위표 → 순위결정전 → 본선 자리 · 경기 순). teamNo 오름차순. */
export function listTeams(draw: PublicPreliminaryDraw | null, bracket: PublicKnockoutBracket | null): MyTeam[] {
  const map = new Map<number, MyTeam>();
  for (const g of draw?.groups ?? []) {
    for (const r of g.standings) {
      if (r.teamNo > 0 && !map.has(r.teamNo)) {
        map.set(r.teamNo, { teamNo: r.teamNo, player1Name: r.player1Name, player2Name: r.player2Name, groupNo: g.groupNo, placement: false, withdrawn: r.withdrawn });
      }
    }
  }
  // 순위결정전 팀 — 일반 조 순위표에 없으므로 따로 모은다(공개 응답에 기권 표시가 없어 false).
  const groupNos = (draw?.groups ?? []).map((g) => g.groupNo);
  (draw?.placement ?? []).forEach((p, pi) => {
    for (const t of p.teams) {
      if (t.teamNo > 0 && !map.has(t.teamNo)) {
        map.set(t.teamNo, { teamNo: t.teamNo, player1Name: t.player1Name, player2Name: t.player2Name, groupNo: p.groupNo, placement: true, placementNo: placementPublicNo(groupNos, pi), withdrawn: false });
      }
    }
  });
  const addKo = (t: { teamNo: number; player1Name: string; player2Name: string; withdrawn: boolean } | null) => {
    if (t && t.teamNo > 0 && !map.has(t.teamNo)) {
      map.set(t.teamNo, { teamNo: t.teamNo, player1Name: t.player1Name, player2Name: t.player2Name, groupNo: null, placement: false, withdrawn: t.withdrawn });
    }
  };
  for (const s of bracket?.slots ?? []) addKo(s.team);
  for (const m of bracket?.matches ?? []) { addKo(m.team1); addKo(m.team2); }
  return [...map.values()].sort((a, b) => a.teamNo - b.teamNo);
}

/** 검색 — 팀 번호(정확히) 또는 선수 이름 일부(공백 무시 · 대소문자 무시). */
export function searchTeams(teams: MyTeam[], query: string): MyTeam[] {
  const q = query.trim();
  if (!q) return teams;
  const n = /^\d+$/.test(q) ? Number(q) : null;
  const nq = normName(q);
  return teams.filter((t) => (n !== null && t.teamNo === n)
    || normName(t.player1Name).includes(nq) || normName(t.player2Name).includes(nq));
}

// ── 저장된 선택 대조 ─────────────────────────────────────────────────────────

export interface SavedTeam {
  teamNo: number;
  player1Name: string;
  player2Name: string;
}

/**
 * 저장된 내 팀이 지금 공개 데이터와 맞는가.
 *   'unknown' — 대조할 데이터가 없다(첫 로딩 · 조회 실패 · 비공개). ⚠ 이때 선택을 지우거나 바꾸지 않는다.
 *   'missing' — 팀 목록은 있는데 그 번호가 없다.  'changed' — 번호는 있는데 선수 이름이 다르다.
 *   ⚠ 어느 경우에도 저장값을 지우지 않는다. 화면이 '다시 선택' 을 안내할 뿐이다.
 */
export function checkSaved(saved: SavedTeam, teams: MyTeam[], haveFullList: boolean): 'ok' | 'unknown' | 'missing' | 'changed' {
  if (teams.length === 0) return 'unknown';
  const t = teams.find((x) => x.teamNo === saved.teamNo);
  if (!t) return haveFullList ? 'missing' : 'unknown';
  const same = (a: string, b: string) => normName(a) === normName(b);
  const ok = (same(t.player1Name, saved.player1Name) && same(t.player2Name, saved.player2Name))
    || (same(t.player1Name, saved.player2Name) && same(t.player2Name, saved.player1Name));
  return ok ? 'ok' : 'changed';
}

// ── 내 경기 모으기 ───────────────────────────────────────────────────────────

const asStatus = (s: string): MyStatus => (s === 'calling' || s === 'playing' || s === 'completed' ? s : 'waiting');

export function buildMyMatches(
  draw: PublicPreliminaryDraw | null, bracket: PublicKnockoutBracket | null, teamNo: number,
): MyMatch[] {
  const out: MyMatch[] = [];
  for (const g of draw?.groups ?? []) {
    for (const m of g.matches) {
      const mine = m.team1.teamNo === teamNo ? 1 : m.team2.teamNo === teamNo ? 2 : 0;
      if (!mine) continue;
      const opp = mine === 1 ? m.team2 : m.team1;
      const status = asStatus(m.status);
      const done = status === 'completed';
      out.push({
        key: `P${m.matchNo}`, stage: 'P', matchNo: m.matchNo, title: `${g.groupNo}조 ${m.sequenceNo}경기`,
        status, courtNo: status === 'playing' ? m.courtNo : null, courtName: status === 'playing' ? m.courtName : null,
        opponent: { teamNo: opp.teamNo, player1Name: opp.player1Name, player2Name: opp.player2Name },
        myScore: done ? (mine === 1 ? m.score1 : m.score2) : null,
        oppScore: done ? (mine === 1 ? m.score2 : m.score1) : null,
        result: done && m.winnerSide ? (m.winnerSide === mine ? 'win' : 'loss') : null,
        nextRoundName: null,
        order: g.groupNo * 100 + m.sequenceNo,
      });
    }
  }
  const gNos = (draw?.groups ?? []).map((g) => g.groupNo);
  (draw?.placement ?? []).forEach((p, pi) => {
    const idx = p.teams.findIndex((t) => t.teamNo === teamNo);
    if (idx < 0) return;
    const mine = (idx + 1) as 1 | 2;
    const opp = p.teams[idx === 0 ? 1 : 0] ?? null;
    const status = asStatus(p.status);
    const done = status === 'completed';
    out.push({
      key: `L${p.matchNo}`, stage: 'L', matchNo: p.matchNo, title: placementPublicNo(gNos, pi) === null ? PLACEMENT_NAME : `${placementPublicLabel(placementPublicNo(gNos, pi))} ${PLACEMENT_NAME}`,
      status, courtNo: null, courtName: null,
      opponent: opp ? { teamNo: opp.teamNo, player1Name: opp.player1Name, player2Name: opp.player2Name } : null,
      myScore: done ? (mine === 1 ? p.score1 : p.score2) : null,
      oppScore: done ? (mine === 1 ? p.score2 : p.score1) : null,
      result: done && p.winnerSide ? (p.winnerSide === mine ? 'win' : 'loss') : null,
      nextRoundName: null,
      order: 100_000 + p.groupNo,
    });
  });
  if (bracket) {
    const roundName = (no: number) => bracket.rounds.find((r) => r.roundNo === no)?.name ?? '';
    for (const m of bracket.matches) {
      const mine = m.team1.teamNo === teamNo ? 1 : m.team2.teamNo === teamNo ? 2 : 0;
      if (!mine) continue;
      const opp = mine === 1 ? m.team2 : m.team1;
      const status = asStatus(m.status);
      const done = status === 'completed';
      const rn = m.roundName || roundName(m.roundNo);
      out.push({
        key: `K${m.matchNo}`, stage: 'K', matchNo: m.matchNo, title: `${rn} MATCH ${String(m.matchNo).padStart(2, '0')}`,
        status, courtNo: status === 'playing' ? m.courtNo : null, courtName: status === 'playing' ? m.courtName : null,
        opponent: opp.teamNo > 0 ? { teamNo: opp.teamNo, player1Name: opp.player1Name, player2Name: opp.player2Name } : null,
        myScore: done ? (mine === 1 ? m.score1 : m.score2) : null,
        oppScore: done ? (mine === 1 ? m.score2 : m.score1) : null,
        result: done && m.winnerSide ? (m.winnerSide === mine ? 'win' : 'loss') : null,
        nextRoundName: roundName(m.roundNo + 1) || null,
        order: 200_000 + m.roundNo * 1000 + m.matchNo,
      });
    }
  }
  return out.sort((a, b) => a.order - b.order);
}

/** 본선 자리에는 올라갔지만 경기가 아직 없는 경우 — '16강 진출 · 상대 결정 대기'. */
function pendingSlotOf(bracket: PublicKnockoutBracket | null, teamNo: number, matches: MyMatch[]): MyPendingSlot | null {
  if (!bracket) return null;
  const mineSlots = bracket.slots.filter((s) => s.team?.teamNo === teamNo && !s.isFinalSlot);
  if (mineSlots.length === 0) return null;
  const top = mineSlots.reduce((a, b) => (b.roundNo > a.roundNo ? b : a));
  const hasMatch = bracket.matches.some((m) => m.roundNo === top.roundNo
    && (m.team1.teamNo === teamNo || m.team2.teamNo === teamNo));
  if (hasMatch) return null;
  // 내 팀이 진출한 뒤 아직 끝나지 않은 경기가 있으면(그 경기가 먼저) 대기 표시를 하지 않는다.
  if (matches.some((m) => m.status !== 'completed')) return null;
  const partner = bracket.slots.find((s) => s.roundNo === top.roundNo && s.publicKey !== top.publicKey
    && s.feedsSlotPublicKey === top.feedsSlotPublicKey && s.feedsSlotPublicKey !== null);
  const label = !partner ? '상대 결정 대기'
    : partner.slotType === 'bye' ? '부전승'
    : partner.team ? `${partner.team.player1Name} · ${partner.team.player2Name}`
    : partner.sourceLabel ? `${partner.sourceLabel} (예선 결과 대기)` : '앞 경기 승자';
  const rn = bracket.rounds.find((r) => r.roundNo === top.roundNo)?.name ?? '본선';
  return { roundName: rn, opponentLabel: label };
}

/** 내 팀이 나가는 조별 첫 경기(일반 조 · 순위결정전). 내 팀이 첫 경기 팀이 아니면 null. */
function firstOf(draw: PublicPreliminaryDraw | null, team: MyTeam, sched: GroupScheduleInfo | null): FirstMatchInfo | null {
  if (team.groupNo === null) return null;
  const f = team.placement
    ? (() => { const p = draw?.placement.find((x) => x.groupNo === team.groupNo); return p ? placementFirstMatch(p, sched) : null; })()
    : (() => { const g = draw?.groups.find((x) => x.groupNo === team.groupNo); return g ? groupFirstMatch(g.matches, sched) : null; })();
  return f && f.teamNos.includes(team.teamNo) ? f : null;
}

export function buildView(
  draw: PublicPreliminaryDraw | null, bracket: PublicKnockoutBracket | null, teamNo: number | null,
  schedule: PublicGroupSchedule | null = null,
): MyMatchView {
  const teams = listTeams(draw, bracket);
  const team = teamNo ? teams.find((t) => t.teamNo === teamNo) ?? null : null;
  const matches = teamNo ? buildMyMatches(draw, bracket, teamNo) : [];
  const current = matches.find((m) => m.status === 'playing') ?? matches.find((m) => m.status === 'calling') ?? null;
  const next = matches.find((m) => m.status === 'waiting' && m !== current) ?? null;
  const results = matches.filter((m) => m.status === 'completed').reverse();
  const sched = team?.groupNo ? scheduleForGroup(schedule, team.groupNo) : null;
  return {
    team, matches, current, next, results,
    pendingSlot: teamNo ? pendingSlotOf(bracket, teamNo, matches) : null,
    knockoutLoaded: bracket !== null,
    schedule: sched,
    first: team ? firstOf(draw, team, sched) : null,
  };
}

// ── 상태 변화 → 알림 ─────────────────────────────────────────────────────────

export type MyEventKind = 'assign' | 'court_change' | 'calling' | 'completed' | 'ko_next';

export interface MyEvent {
  kind: MyEventKind;
  key: string;
  /** 같은 알림을 두 번 띄우지 않기 위한 지문 — key + 종류 + 코트. */
  sig: string;
  match: MyMatch;
  fromCourt: number | null;
}

/** 직전 조회의 내 경기 상태(메모리 전용). */
export interface MySnapshot {
  byKey: Record<string, { status: MyStatus; courtNo: number | null }>;
  knockoutLoaded: boolean;
}

export const snapshotOf = (view: MyMatchView): MySnapshot => ({
  byKey: Object.fromEntries(view.matches.map((m) => [m.key, { status: m.status, courtNo: m.courtNo }])),
  knockoutLoaded: view.knockoutLoaded,
});

export const sigOf = (kind: MyEventKind, m: MyMatch): string =>
  `${m.key}:${kind}${kind === 'assign' || kind === 'court_change' ? `:${m.courtNo ?? ''}` : ''}`;

/**
 * 직전 조회와 이번 조회를 비교해 알림을 만든다.
 *   ⚠ prev = null(이 화면에서 첫 조회 · 팀을 막 고른 직후)이면 알림을 만들지 않는다.
 *     이미 진행 중인 경기는 화면이 '현재 N번 코트에서 진행 중' 으로 보여 줄 뿐, 새 배정처럼 알리지 않는다.
 *   ⚠ 본선이 이번에 처음 보이면(직전엔 본선 자체가 없었음) 본선 경기도 알림 없이 목록에만 나타난다.
 *   ⚠ 조회 실패한 쪽 데이터는 호출부가 직전 값을 유지해서 넘긴다 — 실패로 경기가 '사라졌다 생기는' 일이 없다.
 */
export function diffEvents(prev: MySnapshot | null, view: MyMatchView): MyEvent[] {
  if (!prev) return [];
  const out: MyEvent[] = [];
  for (const m of view.matches) {
    const before = prev.byKey[m.key];
    if (!before) {
      if (m.stage === 'K' && prev.knockoutLoaded && m.status !== 'completed') {
        // 본선 다음 경기가 새로 만들어졌다. 이미 코트에 들어가 있으면 배정 알림이 더 중요하다.
        const kind: MyEventKind = m.status === 'playing' && m.courtNo !== null ? 'assign' : 'ko_next';
        out.push({ kind, key: m.key, sig: sigOf(kind, m), match: m, fromCourt: null });
      }
      continue;
    }
    if (m.status === 'playing' && m.courtNo !== null) {
      if (before.status !== 'playing') out.push({ kind: 'assign', key: m.key, sig: sigOf('assign', m), match: m, fromCourt: null });
      else if (before.courtNo !== null && before.courtNo !== m.courtNo) {
        out.push({ kind: 'court_change', key: m.key, sig: sigOf('court_change', m), match: m, fromCourt: before.courtNo });
      }
    } else if (m.status === 'calling' && before.status === 'waiting') {
      out.push({ kind: 'calling', key: m.key, sig: sigOf('calling', m), match: m, fromCourt: null });
    } else if (m.status === 'completed' && before.status !== 'completed') {
      out.push({ kind: 'completed', key: m.key, sig: sigOf('completed', m), match: m, fromCourt: null });
    }
  }
  return out;
}

const PRIORITY: Record<MyEventKind, number> = { assign: 0, court_change: 0, ko_next: 1, calling: 2, completed: 3 };

/** 이미 알린 지문은 빼고, 중요한 순서로. */
export function freshEvents(events: MyEvent[], seen: ReadonlySet<string>): MyEvent[] {
  return events.filter((e) => !seen.has(e.sig)).sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
}

/** 큰 알림(코트 번호)인가. */
export const isCourtEvent = (e: MyEvent): boolean => e.kind === 'assign' || e.kind === 'court_change';

export const courtText = (m: Pick<MyMatch, 'courtNo' | 'courtName'>): string =>
  m.courtName || (m.courtNo !== null ? `${m.courtNo}번 코트` : '');

/** 남은 경기가 있는가 — 갱신 주기를 정한다(없으면 느리게). */
export const hasPending = (view: MyMatchView): boolean =>
  view.matches.some((m) => m.status !== 'completed') || view.pendingSlot !== null;
