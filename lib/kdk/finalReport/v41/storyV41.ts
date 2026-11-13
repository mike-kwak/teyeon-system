// TEYEON FINAL REPORT V4.1 — 기록 기반 매거진 스토리(순수 계산 · 공식 기록으로 검증되는 것만).
//
//   만들지 않는 것: 타이브레이크 점수 · 경기 종료 시각 · 게스트 첫 참가 · 조건 미달 라이벌 · 감정 추정 문구.
//   판정 조건(테스트 대상):
//     COMEBACK      본인 첫 경기(가장 작은 round) 패배, 이후 모든 경기 승리, 이후 승 ≥ 2, round 모두 숫자 · 중복 없음
//     SHUTOUT       승리 팀 점수 > 0 · 패배 팀 0(무실점 승리)
//     MOST_GAMES    완료 경기 획득 게임 합의 단독 1위(동수면 생략)
//     BREAKTHROUGH  회원(게스트 아님 · id 확인) · 이전 공식 회차 ≥ 3 · 오늘 승 > 이전 최고(같으면 '타이')
//     RIVALRY       오늘 상대 팀으로 만난 회원 2명 · 이전 공식 맞대결 ≥ 3경기(무승부 제외) · 날짜 확인된 회차만
//     VOL           공식 회차를 날짜순으로 센 번호 — 날짜 누락 · 같은 날 복수 회차가 있으면 null
//   HIDDEN HEROES 는 시상대(1~3위) 밖 선수만.

import type { FinalReportModel, MatchRow } from '../finalReportModel';

export interface HistorySession { self: boolean; date: string; ranking: Array<{ id: unknown; wins: unknown }>; matches: Array<{ ids: unknown; score1: unknown; score2: unknown }> }
/** next: 다음 정모 후보. nextReliable=true(확정 · 취소 여부를 확인할 수 있는 일정)일 때만 공개본에 날짜를 넣는다. */
export interface V41Context { date: string; history: HistorySession[]; next: { date: string; startTime: string | null } | null; nextReliable?: boolean }

export type HeroKind = 'COMEBACK' | 'BREAKTHROUGH' | 'MOST_GAMES' | 'SHUTOUT';
export interface V41Hero { kind: HeroKind; title: string; name: string; stat: string; head: string; line: string; source: 'today' | 'archive' }
export interface V41Mention { name: string; line: string }
export interface V41Rivalry {
  winner: string; loser: string; winnerTeam: [string, string]; loserTeam: [string, string];
  priorWins: number; priorLosses: number; recent: Array<'W' | 'L'>; from: string; to: string;
  scoreWin: number; scoreLose: number; round: number | null; title: string; line: string;
}
export type NumberKind = 'MATCHES' | 'ONE_POINT' | 'SHUTOUTS' | 'GUESTS';
export interface V41Number { kind: NumberKind; value: number; label: string; sub: string }
export interface V41Story {
  vol: number | null;
  heroes: V41Hero[];
  mentions: V41Mention[];
  rivalry: V41Rivalry | null;
  numbers: V41Number[];
  next: { date: string; startTime: string | null } | null;
  /** V4.2 판형 표시(7장). 없으면 V4.1 판형(8장) — 기존 발행본은 이 값이 없다. */
  layout?: 2;
  /** V4.2 만: 운영진이 확정한 CLOSING 제목(본문은 공통 closing). */
  closingTitle?: string | null;
}
/**
 * V4.2 옵션(신규 발행본):
 *   · RIVALRY 를 만들지 않는다(복식 결과를 개인 맞대결로 묶지 않음).
 *   · 무실점 승리는 경기 단위 한 항목(같은 팀 두 명을 따로 특집하지 않음) · MATCH OF THE DAY 경기 제외.
 *   · head = 핵심 한 문장, line = 짧은 근거(같은 사실을 두 번 쓰지 않음).
 */
export interface V41StoryOptions { layout?: 2; excludeMatchIds?: readonly string[] }

export const V41_HEROES_MAX = 3;
export const V41_MENTIONS_MAX = 3;
export const RIVALRY_MIN_PRIOR = 3;
export const BREAKTHROUGH_MIN_SESSIONS = 3;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 회원 id 로 확인된 키만(게스트 manual-guest- · 이름 키 nm: 제외). */
export const isMemberKey = (k: string): boolean => UUID_RE.test(k);
const intOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : null);
const idOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const ym = (d: string) => `${d.slice(0, 4)}.${d.slice(5, 7)}`;

interface PlayerGame { m: MatchRow; side: 'A' | 'B'; forS: number; againstS: number; won: boolean; lost: boolean }
function gamesOf(model: FinalReportModel, key: string): PlayerGame[] {
  const out: PlayerGame[] = [];
  for (const m of model.matches) {
    const side = m.keysA.includes(key) ? 'A' : m.keysB.includes(key) ? 'B' : null;
    if (!side) continue;
    const forS = side === 'A' ? m.score1 : m.score2; const againstS = side === 'A' ? m.score2 : m.score1;
    out.push({ m, side, forS, againstS, won: forS > againstS, lost: forS < againstS });
  }
  return out;
}

/**
 * V4.2 자동 헤드라인: 01 THE CHAMPION 에서 헤드라인이 바로 위 큰 우승자 이름을 되풀이하지 않도록 이름을 뺀 같은 사실 문장으로.
 *   운영진이 직접 쓴 헤드라인에는 쓰지 않는다(그대로 공개). 알 수 없는 형태면 참가 인원 문장으로.
 */
export function v42Headline(text: string, champName: string, participants: number): string {
  const n = champName.trim();
  if (!n || !text.includes(n)) return text;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules: Array<[RegExp, string]> = [
    [new RegExp(`^(.+), ${esc}의 무패 우승$`), '$1, 무패 우승'],
    [new RegExp(`^(.+) 정상에 오른 ${esc}$`), '$1 정상에 올랐습니다'],
    [new RegExp(`^최다승과 최고 득실, 두 기록의 주인공 ${esc}$`), '최다승과 최고 득실, 두 기록을 모두 가졌습니다'],
    [new RegExp(`^(.+), 오늘의 챔피언은 ${esc}$`), '$1 끝에 오른 정상'],
  ];
  for (const [re, to] of rules) if (re.test(text)) return text.replace(re, to);
  return `${participants}명의 도전, 정상에 올랐습니다`;
}

export function computeVol(date: string, history: HistorySession[]): number | null {
  if (!DATE_RE.test(date)) return null;
  if (history.some((h) => !DATE_RE.test(h.date))) return null;
  if (history.filter((h) => h.date === date).length !== 1) return null; // 같은 날 복수 회차 · 자기 자신 없음
  return history.filter((h) => h.date <= date).length;
}

export function buildV41Story(model: FinalReportModel, ctx: V41Context, opts: V41StoryOptions = {}): V41Story {
  const v42 = opts.layout === 2;
  const exclude = new Set(opts.excludeMatchIds ?? []);
  const podiumKeys = new Set(model.standings.slice(0, 3).map((s) => s.key));
  const nameOf = new Map(model.standings.map((s) => [s.key, s.name]));
  const guestOf = new Map(model.standings.map((s) => [s.key, s.guest]));
  const prior = ctx.history.filter((h) => !h.self && DATE_RE.test(h.date) && DATE_RE.test(ctx.date) && h.date < ctx.date);

  type Cand = V41Hero & { key: string; rank: number; keys?: string[] };
  const cands: Cand[] = [];
  const mentions: Array<V41Mention & { key: string }> = [];

  // COMEBACK
  for (const s of model.standings) {
    if (podiumKeys.has(s.key)) continue;
    const gs = gamesOf(model, s.key);
    if (gs.length < 3 || gs.some((g) => g.m.round == null)) continue;
    const rounds = gs.map((g) => g.m.round as number);
    if (new Set(rounds).size !== rounds.length) continue;
    gs.sort((a, b) => (a.m.round as number) - (b.m.round as number));
    const [first, ...rest] = gs;
    if (first.lost && rest.length >= 2 && rest.every((g) => g.won)) {
      cands.push({ key: s.key, rank: s.rank, kind: 'COMEBACK', title: 'THE COMEBACK', name: s.name, stat: `${rest.length}연승`,
        head: v42 ? `첫 경기를 내준 뒤, 남은 ${rest.length}경기를 모두 잡았습니다.` : `첫 경기 패배 뒤 남은 ${rest.length}경기를 모두 이겼습니다.`,
        line: v42 ? `${first.m.round}라운드 ${first.forS}:${first.againstS}` : `${first.m.round}라운드 ${first.forS}:${first.againstS} 패배 이후 ${rest.length}경기 연속 승리.`, source: 'today' });
    }
  }

  // BREAKTHROUGH(회원 · 이전 공식 회차 ≥ 3)
  for (const s of model.standings) {
    if (podiumKeys.has(s.key) || s.guest || !isMemberKey(s.key)) continue;
    const prevWins = prior.flatMap((h) => h.ranking.filter((r) => idOf(r.id) === s.key).map((r) => intOf(r.wins))).filter((x): x is number => x !== null);
    if (prevWins.length < BREAKTHROUGH_MIN_SESSIONS) continue;
    const best = Math.max(...prevWins);
    if (s.wins > best) {
      cands.push({ key: s.key, rank: s.rank, kind: 'BREAKTHROUGH', title: 'BREAKTHROUGH', name: s.name, stat: `${s.wins}승`,
        head: '공식 기록 개인 최다승을 새로 썼습니다.', line: v42 ? `이전 최고 ${best}승` : `이전 공식 회차 최고 ${best}승 → 오늘 ${s.wins}승.`, source: 'archive' });
    } else if (s.wins === best && s.wins > 0) {
      mentions.push({ key: s.key, name: s.name, line: `공식 기록 개인 최다승 타이(${s.wins}승)` });
    }
  }

  // MOST_GAMES(단독 1위 · 시상대 밖)
  const totals = model.standings.map((s) => ({ s, total: gamesOf(model, s.key).reduce((a, g) => a + g.forS, 0), played: gamesOf(model, s.key).length }));
  const maxTotal = Math.max(0, ...totals.map((t) => t.total));
  const top = totals.filter((t) => t.total === maxTotal && maxTotal > 0);
  if (top.length === 1 && !podiumKeys.has(top[0].s.key)) {
    cands.push({ key: top[0].s.key, rank: top[0].s.rank, kind: 'MOST_GAMES', title: 'MOST GAMES', name: top[0].s.name, stat: `${maxTotal}게임`,
      head: '오늘 가장 많은 게임을 따냈습니다.', line: v42 ? `${top[0].played}경기 합계` : `${top[0].played}경기에서 ${maxTotal}게임 획득.`, source: 'today' });
  }

  // SHUTOUT(무실점 승리 — 시상대 밖 승리 팀 선수)
  for (const m of [...model.matches].sort((a, b) => (a.round ?? 99) - (b.round ?? 99) || (a.court ?? 99) - (b.court ?? 99))) {
    const winA = m.score1 > m.score2;
    const ws = winA ? m.score1 : m.score2; const ls = winA ? m.score2 : m.score1;
    if (!(ws > 0 && ls === 0)) continue;
    if (v42) {
      // 경기 단위 한 항목: 시상대 밖 승리 선수(1~2명)를 한 사례로 묶는다. MATCH OF THE DAY 경기는 제외(다른 장에서 반복 금지).
      if (exclude.has(m.matchId)) continue;
      const ks = (winA ? m.keysA : m.keysB).filter((k) => !podiumKeys.has(k) && nameOf.has(k));
      if (!ks.length) continue;
      const ss = ks.map((k) => model.standings.find((x) => x.key === k)!);
      cands.push({ key: ks[0], keys: ks, rank: Math.min(...ss.map((x) => x.rank)), kind: 'SHUTOUT', title: 'CLEAN SHEET', name: ss.map((x) => x.name).join(' · ').slice(0, 40),
        stat: `${ws}:0`, head: '상대에게 한 게임도 내주지 않았습니다.', line: m.round != null ? `${m.round}라운드` : '오늘 경기', source: 'today' });
      continue;
    }
    for (const k of winA ? m.keysA : m.keysB) {
      if (podiumKeys.has(k) || !nameOf.has(k)) continue;
      const roundTxt = m.round != null ? `${m.round}라운드 ` : '';
      const s = model.standings.find((x) => x.key === k)!;
      cands.push({ key: k, rank: s.rank, kind: 'SHUTOUT', title: 'CLEAN SHEET', name: s.name, stat: `${ws}:0`,
        head: '상대에게 한 게임도 내주지 않았습니다.', line: `${roundTxt}${ws}:0 무실점 승리.`, source: 'today' });
    }
  }

  // 선택: 종류 우선순위 → 순위. 한 사람은 한 번만 특집, 나머지는 ALSO ON THE RECORD.
  const PRI: Record<HeroKind, number> = { COMEBACK: 0, BREAKTHROUGH: 1, MOST_GAMES: 2, SHUTOUT: 3 };
  cands.sort((a, b) => PRI[a.kind] - PRI[b.kind] || a.rank - b.rank);
  const heroes: V41Hero[] = []; const used = new Set<string>();
  for (const c of cands) {
    // V4.2 경기 단위 항목: 이미 다른 특집에 나온 선수는 빼고 남은 선수만(모두 나왔으면 생략).
    const ks = (c.keys ?? [c.key]).filter((k) => !used.has(k));
    if (!ks.length) continue;
    if (c.keys && ks.length !== c.keys.length) c.name = ks.map((k) => nameOf.get(k) ?? '').join(' · ').slice(0, 40);
    if (heroes.length < V41_HEROES_MAX) { heroes.push({ kind: c.kind, title: c.title, name: c.name, stat: c.stat, head: c.head, line: c.line, source: c.source }); ks.forEach((k) => used.add(k)); }
    else if (mentions.length < V41_MENTIONS_MAX + 3) {
      // V4.2: 짧은 근거(line)만으로는 뜻이 약하므로 핵심 문장(head)을 쓴다.
      mentions.push({ key: c.key, name: c.name, line: (v42 ? c.head : c.line).replace(/\.$/, '') }); ks.forEach((k) => used.add(k));
    }
  }
  const mentionOut = mentions.filter((m, i, arr) => !heroes.some((h) => h.name === m.name) && arr.findIndex((x) => x.key === m.key) === i)
    .slice(0, V41_MENTIONS_MAX).map(({ name, line }) => ({ name, line }));

  return {
    vol: computeVol(ctx.date, ctx.history),
    heroes, mentions: mentionOut,
    rivalry: v42 ? null : buildRivalry(model, prior, nameOf, guestOf),
    numbers: buildNumbers(model, v42),
    ...(v42 ? { layout: 2 as const } : {}),
    // 취소 여부를 신뢰할 수 없는 일정은 확정된 다음 경기처럼 공개하지 않는다(화면은 '클럽 일정 보기' 링크로 대체).
    next: ctx.nextReliable === true && ctx.next && DATE_RE.test(ctx.next.date) ? { date: ctx.next.date, startTime: ctx.next.startTime && /^\d{2}:\d{2}$/.test(ctx.next.startTime) ? ctx.next.startTime : null } : null,
  };
}

function buildRivalry(model: FinalReportModel, prior: HistorySession[], nameOf: Map<string, string>, guestOf: Map<string, boolean>): V41Rivalry | null {
  type Best = V41Rivalry & { games: number; upset: boolean; order: number };
  let best: Best | null = null;
  const ordered = [...model.matches].sort((a, b) => (a.round ?? 99) - (b.round ?? 99) || (a.court ?? 99) - (b.court ?? 99));
  ordered.forEach((m, order) => {
    if (m.score1 === m.score2) return;
    const winA = m.score1 > m.score2;
    const wk = winA ? m.keysA : m.keysB; const lk = winA ? m.keysB : m.keysA;
    for (const w of wk) for (const l of lk) {
      if (!isMemberKey(w) || !isMemberKey(l) || guestOf.get(w) || guestOf.get(l)) continue;
      const results: Array<{ date: string; r: 'W' | 'L' }> = [];
      for (const h of prior) for (const pm of h.matches) {
        const ids = Array.isArray(pm.ids) ? pm.ids.map(idOf) : [];
        const s1 = intOf(pm.score1); const s2 = intOf(pm.score2);
        if (ids.length !== 4 || s1 === null || s2 === null || s1 === s2) continue;
        const wSide = ids.slice(0, 2).includes(w) ? 'A' : ids.slice(2).includes(w) ? 'B' : null;
        const lSide = ids.slice(0, 2).includes(l) ? 'A' : ids.slice(2).includes(l) ? 'B' : null;
        if (!wSide || !lSide || wSide === lSide) continue;
        const wWon = (wSide === 'A') === (s1 > s2);
        results.push({ date: h.date, r: wWon ? 'W' : 'L' });
      }
      if (results.length < RIVALRY_MIN_PRIOR) continue;
      results.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const pw = results.filter((x) => x.r === 'W').length; const pl = results.length - pw;
      const upset = pw < pl;
      const better = !best || results.length > best.games || (results.length === best.games && upset && !best.upset);
      if (!better) continue;
      const wTeam = (winA ? m.teamA : m.teamB); const lTeam = (winA ? m.teamB : m.teamA);
      const ws = winA ? m.score1 : m.score2; const ls = winA ? m.score2 : m.score1;
      const wName = nameOf.get(w) || ''; const lName = nameOf.get(l) || '';
      best = {
        winner: wName, loser: lName, winnerTeam: [...wTeam] as [string, string], loserTeam: [...lTeam] as [string, string],
        priorWins: pw, priorLosses: pl, recent: results.slice(-5).map((x) => x.r),
        from: ym(results[0].date), to: ym(results[results.length - 1].date),
        scoreWin: ws, scoreLose: ls, round: m.round,
        title: upset ? '열세였던 맞대결, 오늘은 달랐다.' : pw === pl ? '팽팽했던 맞대결, 오늘의 승자.' : '이어지는 맞대결, 오늘도 승리.',
        line: `공식 기록 기준 이전 맞대결 ${pw}승 ${pl}패(${ym(results[0].date)} – ${ym(results[results.length - 1].date)}). ${m.round != null ? `${m.round}라운드 ` : ''}${ws}:${ls} 승리.`,
        games: results.length, upset, order,
      };
    }
  });
  if (!best) return null;
  const { games: _g, upset: _u, order: _o, ...pub } = best as Best;
  return pub;
}

function buildNumbers(model: FinalReportModel, v42 = false): V41Number[] {
  const rounds = new Set(model.matches.map((m) => m.round).filter((r): r is number => r != null));
  const onePoint = model.matches.filter((m) => Math.abs(m.score1 - m.score2) === 1).length;
  const shutouts = model.matches.filter((m) => Math.min(m.score1, m.score2) === 0 && Math.max(m.score1, m.score2) > 0).length;
  const guests = model.standings.filter((s) => s.guest).length;
  return [
    { kind: 'MATCHES', value: model.completedMatchCount, label: '경기', sub: `${model.participantCount}명${rounds.size ? ` · ${rounds.size}라운드` : ''}` },
    v42 ? { kind: 'ONE_POINT', value: onePoint, label: '1점 차 승부', sub: '1게임 차로 끝난 경기' }
      : { kind: 'ONE_POINT', value: onePoint, label: '1점 차 승부', sub: '마지막 게임까지 간 경기' },
    v42 ? { kind: 'SHUTOUTS', value: shutouts, label: '무실점 승리', sub: '한 게임도 내주지 않은 경기' }
      : { kind: 'SHUTOUTS', value: shutouts, label: '무실점 승리', sub: '상대에게 게임을 내주지 않은 경기' },
    { kind: 'GUESTS', value: guests, label: '게스트', sub: '함께한 게스트' },
  ];
}
