// 공개 DRAW — 공식 예선 대진표(조 · 예정 코트 · 1차/2차 · 신고 마감 · 페어 · 소속) 화면 모델. 순수 함수 · 서버 호출 없음.
//
//   ⚠ 순위 · 진출 · 점수는 서버 값 그대로 옮긴다(계산하지 않는다).
//   ⚠ 예정 코트 · 순서 · 신고 마감 · 시작 안내는 운영진이 저장한 조별 일정만 쓴다(추정하지 않는다).
//   ⚠ 소속 클럽은 공개 참가팀 목록(get_public_tournament_teams)과 선수 두 명 이름이 정확히 같을 때만 붙인다.
//     못 찾으면 비워 둔다(지어내지 않는다).
//   ⚠ 순위결정전은 내부 조 번호(group_no, 예: 19)를 화면에 쓰지 않는다. 공개 표시 번호는 publicGroupNo 규칙으로만 정한다
//     (일반 조 2 ~ 18 → '1조'). key · href · groupNo · kind 는 내부 값 그대로다(저장 · 링크 · 경기 로직 무관).

import type { PublicDrawMatch, PublicPreliminaryDraw, PublicStandingRow } from './publicDrawTypes';
import type { PublicGroupSchedule, SessionNo } from './groupScheduleModel';
import { scheduleForGroup } from './groupScheduleModel';
import { groupFirstMatch, isFirstUpcoming, placementFirstMatch, SESSION2_DEFAULT_START, type FirstMatchInfo } from './firstMatchModel';
import { PLACEMENT_NAME, placementPublicLabel, placementPublicNo } from './publicGroupNo';

export interface ClubSource {
  player1Name: string; player2Name: string;
  player1ClubName: string | null; player2ClubName: string | null; clubName: string | null;
}

const nk = (s: string) => s.trim().replace(/\s+/g, '');
const pairKey = (a: string, b: string) => [nk(a), nk(b)].sort().join('|');

export interface ClubInfo {
  /** 팀 한 줄 표시(같은 클럽이면 한 번, 다르면 '가 · 나', 선수별 값이 없으면 팀 단위 값). */
  text: string | null;
  /** 선수 이름(공백 제거) → 그 선수 소속. 선수별 값이 없으면 비어 있다. */
  byName: Record<string, string | null>;
}
export type ClubIndex = Map<string, ClubInfo>;

/** 페어 이름 → 소속. 이름이 같은 페어가 둘 이상이면 어느 쪽인지 알 수 없으므로 쓰지 않는다. */
export function buildClubIndex(rows: ClubSource[]): ClubIndex {
  const m: ClubIndex = new Map(); const dup = new Set<string>();
  for (const r of rows) {
    const k = pairKey(r.player1Name, r.player2Name);
    if (m.has(k)) { dup.add(k); continue; }
    const c1 = r.player1ClubName?.trim() || null; const c2 = r.player2ClubName?.trim() || null;
    const text = c1 && c2 ? (c1 === c2 ? c1 : `${c1} · ${c2}`) : c1 || c2 || r.clubName?.trim() || null;
    m.set(k, { text, byName: { [nk(r.player1Name)]: c1, [nk(r.player2Name)]: c2 } });
  }
  for (const k of dup) m.delete(k);
  return m;
}

export const clubFor = (idx: ClubIndex | null, p1: string, p2: string): string | null =>
  (idx ? idx.get(pairKey(p1, p2))?.text ?? null : null);

/** 선수 한 명의 소속(선수별 값만 — 팀 단위 값으로 추정하지 않는다). */
export const playerClubFor = (idx: ClubIndex | null, p1: string, p2: string, name: string): string | null =>
  (idx ? idx.get(pairKey(p1, p2))?.byName[nk(name)] ?? null : null);

export interface SessionHeader {
  sessionNo: SessionNo;
  checkinDeadline: string | null;
  /** 1차: '09:00'. 2차: 시각 대신 안내('앞 조 종료 후'). */
  startTime: string | null;
  startNote: string | null;
}

/** 상단 1차 · 2차 안내. 저장된 공통 안내가 없으면 빈 배열. 2차에는 시각을 만들지 않는다. */
export function sessionHeaders(s: PublicGroupSchedule | null): SessionHeader[] {
  if (!s) return [];
  return s.sessions
    .filter((x) => x.checkinDeadline || x.startTime || x.startNote)
    .map((x) => ({
      sessionNo: x.sessionNo,
      checkinDeadline: x.checkinDeadline,
      startTime: x.startTime,
      startNote: x.startTime ? x.startNote : (x.startNote ? shortNote(x.startNote) : x.sessionNo === 2 ? SESSION2_DEFAULT_START : null),
    }))
    .sort((a, b) => a.sessionNo - b.sessionNo);
}
/** '앞 조 경기 종료 후 시작' → '앞 조 종료 후'(뜻은 같고 짧게). 다른 문구는 그대로. */
const shortNote = (t: string) => (/^앞\s*조\s*(경기\s*)?종료\s*후(\s*시작)?$/.test(t.trim()) ? SESSION2_DEFAULT_START : t.trim());

export interface DrawTeamLine {
  teamNo: number;
  player1Name: string;
  player2Name: string;
  club: string | null;
  /** 공식 조편성표용 선수별 소속(없으면 null). */
  club1: string | null;
  club2: string | null;
  /** 첫 경기 출전(경기 전일 때만). */
  first: boolean;
  /** 경기 시작 후에만 — '2승 1패' / 득실. */
  record: string | null;
  diff: number | null;
  rank: number | null;
  qualified: boolean;
  muted: boolean;
  withdrawn: boolean;
}

export interface DrawMatchLine {
  key: string; label: string; status: string; courtText: string | null;
  team1: string; team2: string; score: string | null; winnerSide: 1 | 2 | null; first: boolean;
}

export interface DrawEntry {
  key: string;
  kind: 'group' | 'placement';
  /** 내부 조 번호(DB group_no) — ⚠ 화면에 숫자로 쓰지 않는다. 화면 번호는 displayNo · label. */
  groupNo: number;
  /** 참가자에게 보이는 조 번호(일반 조 = groupNo, 순위결정전 = 공개 표시 번호 · 정할 수 없으면 null). */
  displayNo: number | null;
  /** 참가자에게 보이는 조 이름('1조' · '7조' · 번호가 없으면 '순위결정전'). */
  label: string;
  /** 작은 보조 문구(순위결정전: '2팀 · 순위결정전'). 일반 조는 null. */
  subLabel: string | null;
  href: string;
  sessionNo: SessionNo | null;
  courtNo: number | null;
  courtText: string | null;
  checkinDeadline: string | null;
  startText: string | null;
  phase: 'pre' | 'live' | 'done';
  statusLabel: string;
  progress: string | null;
  teams: DrawTeamLine[];
  matches: DrawMatchLine[];
  firstInfo: FirstMatchInfo | null;
  /** 팀 정보가 아직 공개 데이터에 없음(순위결정전 경기 생성 전). */
  pendingTeams: boolean;
}

const teamText = (t: { player1Name: string; player2Name: string }) => `${t.player1Name} · ${t.player2Name}`;

function matchLines(ms: PublicDrawMatch[], f: FirstMatchInfo | null): DrawMatchLine[] {
  return [...ms].sort((a, b) => a.sequenceNo - b.sequenceNo).map((m, i) => ({
    key: `m${m.matchNo}`,
    label: `${i + 1}경기`,
    status: m.status,
    courtText: m.status === 'playing' ? (m.courtName || (m.courtNo ? `${m.courtNo}번 코트` : null)) : null,
    team1: teamText(m.team1), team2: teamText(m.team2),
    score: m.status === 'completed' && m.score1 !== null && m.score2 !== null ? `${m.score1} : ${m.score2}` : null,
    winnerSide: m.winnerSide,
    first: !!f && isFirstUpcoming(f) && f.matchNo === m.matchNo,
  }));
}

const started = (ms: { status: string }[]) => ms.some((m) => m.status === 'playing' || m.status === 'completed');

/** 조 · 순위결정전을 한 목록으로. 순서는 화면이 정한다(sortEntries). */
export function buildEntries(
  draw: PublicPreliminaryDraw, schedule: PublicGroupSchedule | null, clubs: ClubIndex | null, base: string,
): DrawEntry[] {
  const out: DrawEntry[] = [];
  const groupNos = draw.groups.map((g) => g.groupNo);
  const plNo = (i: number) => placementPublicNo(groupNos, i);
  const plSub = `2팀 · ${PLACEMENT_NAME}`;
  for (const g of draw.groups) {
    const s = scheduleForGroup(schedule, g.groupNo);
    const f = groupFirstMatch(g.matches, s);
    const upcoming = isFirstUpcoming(f);
    const isStarted = started(g.matches);
    const done = g.generatedMatches > 0 && g.completedMatches + g.cancelledMatches >= g.generatedMatches && g.rankingStatus === 'FINAL';
    const phase: DrawEntry['phase'] = done ? 'done' : isStarted ? 'live' : 'pre';
    const row = (r: PublicStandingRow): DrawTeamLine => ({
      teamNo: r.teamNo, player1Name: r.player1Name, player2Name: r.player2Name,
      club: clubFor(clubs, r.player1Name, r.player2Name),
      club1: playerClubFor(clubs, r.player1Name, r.player2Name, r.player1Name),
      club2: playerClubFor(clubs, r.player1Name, r.player2Name, r.player2Name),
      first: upcoming && f!.teamNos.includes(r.teamNo),
      record: isStarted ? `${r.wins}승 ${r.losses}패` : null,
      diff: isStarted ? r.gameDiff : null,
      rank: isStarted ? r.rank : null,
      qualified: r.qualificationStatus === 'QUALIFIED',
      muted: done && r.qualificationStatus === 'NOT_QUALIFIED',
      withdrawn: r.withdrawn,
    });
    // 경기 전에는 조 자리 순서 그대로(서버 standings 순서는 경기 전 동률이라 자리 순) — 시작 후에는 서버 순위 순.
    const teams = g.standings.map(row);
    out.push({
      key: `g${g.groupNo}`, kind: 'group', groupNo: g.groupNo, displayNo: g.groupNo, label: `${g.groupNo}조`, subLabel: null, href: `${base}/groups/${g.groupNo}`,
      sessionNo: s?.sessionNo ?? null, courtNo: s?.plannedCourtNo ?? null, courtText: s?.plannedCourtText ?? null,
      checkinDeadline: s?.checkinDeadline ?? null, startText: f?.startText ?? (s ? (s.sessionNo === 1 ? s.startTime ?? s.startNote : s.startNote ?? (s.sessionNo === 2 ? SESSION2_DEFAULT_START : null)) : null),
      phase, statusLabel: phase === 'done' ? '완료' : phase === 'live' ? '진행 중' : '경기 전',
      progress: g.generatedMatches > 0 ? `${g.completedMatches} / ${g.generatedMatches}` : null,
      teams, matches: matchLines(g.matches, f), firstInfo: f, pendingTeams: false,
    });
  }
  draw.placement.forEach((p, pi) => {
    const s = scheduleForGroup(schedule, p.groupNo);
    const f = placementFirstMatch(p, s);
    const upcoming = isFirstUpcoming(f);
    const done = p.status === 'completed';
    const phase: DrawEntry['phase'] = done ? 'done' : p.status === 'playing' ? 'live' : 'pre';
    out.push({
      key: `p${p.groupNo}`, kind: 'placement', groupNo: p.groupNo, displayNo: plNo(pi), label: placementPublicLabel(plNo(pi)), subLabel: plSub, href: `${base}/placement`,
      sessionNo: s?.sessionNo ?? null, courtNo: s?.plannedCourtNo ?? null, courtText: s?.plannedCourtText ?? null,
      checkinDeadline: s?.checkinDeadline ?? null, startText: f?.startText ?? (s?.sessionNo === 2 ? (s.startNote ?? SESSION2_DEFAULT_START) : s?.startTime ?? null),
      phase, statusLabel: done ? '완료' : phase === 'live' ? '진행 중' : '경기 전',
      progress: p.matchNo > 0 ? `${done ? 1 : 0} / 1` : null,
      teams: p.teams.map((t, i) => ({
        teamNo: t.teamNo, player1Name: t.player1Name, player2Name: t.player2Name,
        club: clubFor(clubs, t.player1Name, t.player2Name),
        club1: playerClubFor(clubs, t.player1Name, t.player2Name, t.player1Name),
        club2: playerClubFor(clubs, t.player1Name, t.player2Name, t.player2Name),
        first: upcoming && f!.teamNos.includes(t.teamNo),
        record: done ? (p.winnerSide === i + 1 ? '승' : '패') : null, diff: null, rank: null,
        qualified: false, muted: done && p.winnerSide !== i + 1, withdrawn: false,
      })),
      matches: p.matchNo > 0 && p.teams.length === 2 ? [{
        key: `m${p.matchNo}`, label: PLACEMENT_NAME, status: p.status,
        courtText: null, team1: teamText(p.teams[0]), team2: teamText(p.teams[1]),
        score: done && p.score1 !== null && p.score2 !== null ? `${p.score1} : ${p.score2}` : null,
        winnerSide: p.winnerSide, first: upcoming,
      }] : [],
      firstInfo: f, pendingTeams: false,
    });
  });
  // 순위결정전 일정은 있는데 공개 데이터에 팀이 아직 없는 경우(경기 생성 전) — 자리만 보여 준다(팀을 지어내지 않는다).
  if (schedule) {
    const known = new Set(out.map((e) => e.groupNo));
    for (const row of schedule.groups) {
      if (known.has(row.groupNo) || draw.placement.length > 0) continue;
      const s = scheduleForGroup(schedule, row.groupNo);
      if (!s) continue;
      out.push({
        key: `p${row.groupNo}`, kind: 'placement', groupNo: row.groupNo, displayNo: plNo(0), label: placementPublicLabel(plNo(0)), subLabel: plSub, href: `${base}/placement`,
        sessionNo: s.sessionNo, courtNo: s.plannedCourtNo, courtText: s.plannedCourtText, checkinDeadline: s.checkinDeadline,
        startText: s.sessionNo === 2 ? (s.startNote ?? SESSION2_DEFAULT_START) : s.startTime ?? s.startNote,
        phase: 'pre', statusLabel: '경기 전', progress: null, teams: [], matches: [], firstInfo: null, pendingTeams: true,
      });
    }
  }
  return out;
}

/**
 * 정렬 — group: 공개 조 번호(1조 → 18조 · 번호 없는 순위결정전은 맨 뒤) · court: 차수 → 예정 코트. 미지정은 뒤로.
 *   ⚠ 표시 순서만 정한다. 내부 group_no · 코트 · 차수는 바꾸지 않는다.
 */
export type DrawOrder = 'group' | 'court';

export function sortEntries(es: DrawEntry[], order: DrawOrder): DrawEntry[] {
  const big = 999;
  const byNo = (a: DrawEntry, b: DrawEntry) => (a.displayNo ?? big) - (b.displayNo ?? big) || (a.kind === b.kind ? a.groupNo - b.groupNo : a.kind === 'group' ? -1 : 1);
  return [...es].sort((a, b) => order === 'court'
    ? (a.sessionNo ?? big) - (b.sessionNo ?? big) || (a.courtNo ?? big) - (b.courtNo ?? big) || byNo(a, b)
    : byNo(a, b));
}

/** 코트별 보기 — 코트 하나 = 차수별 배정 조. 코트 번호는 저장된 예정 코트에서만(없는 코트를 만들지 않는다). */
export interface CourtSlot {
  courtNo: number;
  courtText: string | null;
  /** 차수 1 · 2 의 배정 조(없으면 null — 예: 4 · 5번 코트 2차). 같은 차수에 둘 이상이면 모두(운영 확인용, 보통 1개). */
  s1: DrawEntry[];
  s2: DrawEntry[];
  /** 차수 미정으로 이 코트에 배정된 조. */
  other: DrawEntry[];
}

export function buildCourtSlots(es: DrawEntry[]): { courts: CourtSlot[]; unassigned: DrawEntry[] } {
  const m = new Map<number, CourtSlot>(); const unassigned: DrawEntry[] = [];
  for (const e of sortEntries(es, 'group')) {
    if (e.courtNo === null) { unassigned.push(e); continue; }
    const c = m.get(e.courtNo) ?? { courtNo: e.courtNo, courtText: e.courtText, s1: [], s2: [], other: [] };
    (e.sessionNo === 1 ? c.s1 : e.sessionNo === 2 ? c.s2 : c.other).push(e);
    m.set(e.courtNo, c);
  }
  return { courts: [...m.values()].sort((a, b) => a.courtNo - b.courtNo), unassigned };
}

export const teamMatches = (t: { teamNo: number; player1Name: string; player2Name: string }, q: string): boolean => {
  if (!q) return false;
  const num = q.replace(/번$/, '');
  if (/^\d+$/.test(num)) return Number(num) === t.teamNo;
  return `${t.player1Name}${t.player2Name}`.toLowerCase().replace(/\s+/g, '').includes(q);
};

/** 검색 결과 — 이름이 맞는 팀과 그 조(위에서부터). */
export function findTeams(es: DrawEntry[], q: string): { entry: DrawEntry; team: DrawTeamLine }[] {
  if (!q) return [];
  const out: { entry: DrawEntry; team: DrawTeamLine }[] = [];
  for (const e of es) for (const t of e.teams) if (teamMatches(t, q)) out.push({ entry: e, team: t });
  return out;
}

/** 전체 진행 — 경기 수 기준. */
export function drawProgress(draw: PublicPreliminaryDraw): { done: number; all: number } {
  return draw.groups.reduce((a, g) => ({ done: a.done + g.completedMatches, all: a.all + g.generatedMatches }),
    { done: draw.placement.filter((p) => p.status === 'completed').length, all: draw.placement.filter((p) => p.matchNo > 0).length });
}
