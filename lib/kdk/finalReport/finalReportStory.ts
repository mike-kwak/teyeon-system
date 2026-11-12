// TEYEON KDK FINAL REPORT v2 — 기록 기반 자동 스토리 엔진(순수 계산 · DB/네트워크 없음).
//
//   입력: buildFinalReportModel() 의 모델(공식 Archive 의 ranking_data 저장 순서 + 완료 경기만).
//   ⚠ 공식 순위 · 승 · 패 · 득실은 ranking_data 에 저장된 값을 그대로 쓴다(재계산 · 재정렬 없음).
//     경기별 점수는 완료 경기 기록 그대로이며, 공식 승패와 경기 기록이 어긋나면 그 선수의 경기 목록은 내보내지 않는다.
//   ⚠ 기록으로 확인할 수 없는 이야기는 만들지 않는다 — 역전 · 매치 포인트 · 감정 · 분위기 · 연승 흐름 · 동률 순위의 이유.
//     만드는 문장은 모두 아래 사실 중 하나에 1:1 로 대응한다: 순위 1위 · 승 · 패 · 득실 · 참가 인원 · 경기 점수 차.
//   ⚠ 공동 기록은 반드시 '공동'(joint) 으로 표시한다. 게스트 표시명((G))은 모델의 표시명을 그대로 쓴다.
//   ⚠ 내부 키(선수 키 · 경기 id)는 계산 · 운영진 화면 연결에만 쓰고 공개본으로 내보내지 않는다(publicStory 참고).

import type { FinalReportModel, MatchRow, StandingRow } from './finalReportModel';

export const FR_HEADLINE_MAX = 40;
export const FR_HIGHLIGHT_MAX = 6;
export const FR_HIGHLIGHT_NAMES = 3;
export const FR_NOTE_MAX = 30;
export const FR_CANDIDATE_MAX = 4;
const PODIUM = 3;

// ── 결과 타입 ───────────────────────────────────────────────────────────────────
export type HighlightKind = 'UNBEATEN_CHAMPION' | 'UNBEATEN' | 'MOST_WINS' | 'BEST_DIFF' | 'CLOSE_MATCHES' | 'SHUTOUT';
export interface Highlight {
  kind: HighlightKind;
  /** 짧은 제목(예: '공동 최다승'). */
  label: string;
  /** 값(예: '4승', '+12', '5경기'). */
  value: string;
  /** 해당 선수 표시명(공식 순위 순서 · 최대 3명). 경기 수 기록은 빈 배열. */
  names: string[];
  /** 해당 인원(선수 기록) 또는 경기 수(경기 기록). */
  total: number;
  /** 같은 기록을 가진 선수가 2명 이상이면 true. */
  joint: boolean;
}

export type BadgeKind = 'UNBEATEN' | 'MOST_WINS' | 'BEST_DIFF';
export interface Badge { kind: BadgeKind; joint: boolean }

export interface PlayerMatch {
  round: number | null;
  court: number | null;
  partner: string;
  opponents: [string, string];
  scoreFor: number;
  scoreAgainst: number;
  result: 'W' | 'L' | 'D';
}
export interface PlayerRecord {
  rank: number;
  name: string;
  /** 경기 기록이 공식 승패와 일치하면 경기 수(무승부 포함), 아니면 공식 승 + 패. */
  played: number;
  wins: number;
  losses: number;
  /** 경기 기록의 무승부 수(일치할 때만 · 아니면 0). 공식 순위에는 무승부 칸이 없다. */
  draws: number;
  diff: number;
  /** 예: '4전 전승 · 득실 +12' / '4전 3승 1패 · 득실 +7'. */
  summary: string;
  badges: Badge[];
  /** 경기 기록이 공식 승패와 일치할 때만 채운다(라운드 · 코트 순). */
  matches: PlayerMatch[];
  /** 경기 기록에서 센 승 · 패가 공식 승 · 패와 같은가. */
  consistent: boolean;
}

export type HeadlineKind = 'UNBEATEN_SOLE' | 'UNBEATEN_JOINT' | 'DOUBLE_CROWN' | 'CLOSE_BATTLES' | 'PARTICIPANTS';
export interface HeadlineCandidate { kind: HeadlineKind; text: string }

export type CandidateReason = 'ONE_POINT' | 'SHUTOUT' | 'TOP3_INVOLVED' | 'TOP3_CLASH';
export interface FeaturedCandidate { matchId: string; margin: number; podiumPlayers: number; reasons: CandidateReason[]; note: string | null }

export interface FinalReportStory {
  champion: { name: string; guest: boolean } | null;
  unbeaten: { count: number; championUnbeaten: boolean; sole: boolean };
  mostWins: { value: number; count: number; joint: boolean };
  bestDiff: { value: number; count: number; joint: boolean };
  closeMatchCount: number;
  shutoutCount: number;
  highlights: Highlight[];
  /** 공식 1~3위(저장 순서). */
  podium: PlayerRecord[];
  /** 기록 기준 주요 경기 후보(특징이 서로 다른 1~3경기: 1점 차 접전 · TOP3 맞대결 · 완봉). */
  candidates: FeaturedCandidate[];
  /** 사실 근거가 있는 것만 · 우선순위 순. 마지막은 항상 참가 인원 문구(이름이 길면 이름 없는 문구). */
  headlines: HeadlineCandidate[];
  /** headlines[0].text */
  headline: string;
}

// ── 공통 ──────────────────────────────────────────────────────────────────────
const cpLen = (s: string) => [...s].length;
const margin = (m: MatchRow) => Math.abs(m.score1 - m.score2);
const isShutout = (m: MatchRow) => Math.min(m.score1, m.score2) === 0 && margin(m) > 0;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const byOrder = (a: MatchRow, b: MatchRow) =>
  (a.round ?? 999) - (b.round ?? 999) || (a.court ?? 999) - (b.court ?? 999) || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0);

/** 경기 한 줄 기록(점수에서 바로 확인되는 것만). 해당 없으면 null. */
export function matchNote(m: MatchRow, podiumKeys: ReadonlySet<string>): string | null {
  const parts: string[] = [];
  if (margin(m) === 1) parts.push('1점 차 접전');
  if (isShutout(m)) parts.push('완봉');
  const a = m.keysA.some((k) => podiumKeys.has(k));
  const b = m.keysB.some((k) => podiumKeys.has(k));
  if (a && b) parts.push('TOP3 맞대결');
  const t = parts.join(' · ');
  return t && cpLen(t) <= FR_NOTE_MAX ? t : null;
}

export function recordSummary(played: number, wins: number, losses: number, diff: number, draws = 0): string {
  const head = losses === 0 && draws === 0 && wins > 0 && wins === played ? `${played}전 전승`
    : draws > 0 ? `${played}전 ${wins}승 ${draws}무 ${losses}패` : `${played}전 ${wins}승 ${losses}패`;
  return `${head} · 득실 ${signed(diff)}`;
}
/** '전승'은 무승부 없이 모두 이겼을 때만, 무승부가 있으면 '무패'. */
const unbeatenWord = (r: PlayerRecord) => (r.draws === 0 && r.wins === r.played ? `${r.played}전 전승` : `${r.played}전 무패`);

function playerRecord(s: StandingRow, matches: MatchRow[], badges: Badge[]): PlayerRecord {
  const mine: PlayerMatch[] = [];
  let w = 0; let l = 0; let d = 0;
  for (const m of [...matches].sort(byOrder)) {
    const ia = m.keysA.indexOf(s.key); const ib = m.keysB.indexOf(s.key);
    if (ia < 0 && ib < 0) continue;
    const onA = ia >= 0;
    const idx = onA ? ia : ib;
    const team = onA ? m.teamA : m.teamB;
    const opp = onA ? m.teamB : m.teamA;
    const scoreFor = onA ? m.score1 : m.score2;
    const scoreAgainst = onA ? m.score2 : m.score1;
    const result: PlayerMatch['result'] = scoreFor > scoreAgainst ? 'W' : scoreFor < scoreAgainst ? 'L' : 'D';
    if (result === 'W') w += 1; else if (result === 'L') l += 1; else d += 1;
    mine.push({ round: m.round, court: m.court, partner: team[idx === 0 ? 1 : 0], opponents: [opp[0], opp[1]], scoreFor, scoreAgainst, result });
  }
  // 공식 승 · 패와 경기 기록의 승 · 패가 같을 때만 경기 목록 · 무승부를 쓴다(다르면 공식 값만).
  const consistent = mine.length > 0 && w === s.wins && l === s.losses;
  const draws = consistent ? d : 0;
  const played = consistent ? mine.length : s.wins + s.losses;
  return {
    rank: s.rank, name: s.name, played, wins: s.wins, losses: s.losses, draws, diff: s.diff,
    summary: recordSummary(played, s.wins, s.losses, s.diff, draws),
    badges, matches: consistent ? mine : [], consistent,
  };
}

function namesOf(rows: StandingRow[]): string[] { return rows.slice(0, FR_HIGHLIGHT_NAMES).map((r) => r.name); }

// ── 본체 ──────────────────────────────────────────────────────────────────────
export function buildFinalReportStory(model: FinalReportModel): FinalReportStory {
  const st = model.standings;
  const champ = st[0] ?? null;
  const podiumRows = st.slice(0, PODIUM);
  const podiumKeys = new Set(podiumRows.map((s) => s.key));

  // 무패: 공식 패 0 · 승 1 이상.
  const unbeatenRows = st.filter((s) => s.losses === 0 && s.wins > 0);
  const championUnbeaten = !!champ && champ.losses === 0 && champ.wins > 0;
  const soleUnbeaten = championUnbeaten && unbeatenRows.length === 1;

  // 최다승 · 최고 득실(공식 저장 값).
  const maxWins = st.length ? Math.max(...st.map((s) => s.wins)) : 0;
  const winRows = maxWins > 0 ? st.filter((s) => s.wins === maxWins) : [];
  const maxDiff = st.length ? Math.max(...st.map((s) => s.diff)) : 0;
  const diffRows = maxDiff > 0 ? st.filter((s) => s.diff === maxDiff) : [];

  const closeMatchCount = model.matches.filter((m) => margin(m) === 1).length;
  const shutoutCount = model.matches.filter(isShutout).length;

  // TOP3 선수 기록.
  const badgeOf = (s: StandingRow): Badge[] => {
    const b: Badge[] = [];
    if (s.losses === 0 && s.wins > 0) b.push({ kind: 'UNBEATEN', joint: unbeatenRows.length > 1 });
    if (winRows.some((r) => r.key === s.key)) b.push({ kind: 'MOST_WINS', joint: winRows.length > 1 });
    if (diffRows.some((r) => r.key === s.key)) b.push({ kind: 'BEST_DIFF', joint: diffRows.length > 1 });
    return b;
  };
  const podium = podiumRows.map((s) => playerRecord(s, model.matches, badgeOf(s)));
  const champRec = podium[0] ?? null;

  // 하이라이트(기록 카드).
  const highlights: Highlight[] = [];
  if (championUnbeaten && champ && champRec) {
    highlights.push({ kind: 'UNBEATEN_CHAMPION', label: '무패 우승', value: unbeatenWord(champRec), names: [champ.name], total: 1, joint: false });
  }
  if (unbeatenRows.length >= 2) {
    highlights.push({ kind: 'UNBEATEN', label: '공동 무패', value: `${unbeatenRows.length}명`, names: namesOf(unbeatenRows), total: unbeatenRows.length, joint: true });
  }
  if (winRows.length) {
    const joint = winRows.length > 1;
    highlights.push({ kind: 'MOST_WINS', label: joint ? '공동 최다승' : '최다승', value: `${maxWins}승`, names: namesOf(winRows), total: winRows.length, joint });
  }
  if (diffRows.length) {
    const joint = diffRows.length > 1;
    highlights.push({ kind: 'BEST_DIFF', label: joint ? '공동 최고 득실' : '최고 득실', value: signed(maxDiff), names: namesOf(diffRows), total: diffRows.length, joint });
  }
  if (closeMatchCount > 0) {
    highlights.push({ kind: 'CLOSE_MATCHES', label: '1점 차 접전', value: `${closeMatchCount}경기`, names: [], total: closeMatchCount, joint: false });
  }
  if (shutoutCount > 0) {
    highlights.push({ kind: 'SHUTOUT', label: '완봉', value: `${shutoutCount}경기`, names: [], total: shutoutCount, joint: false });
  }

  // 기록 기준 주요 경기 후보(v2.1 · 특징이 서로 다른 경기 위주).
  //   정렬(점수 차 → TOP3 출전 수 → 라운드 · 코트 · id) 뒤, 특징 1점 차 접전 → TOP3 맞대결 → 완봉 순으로
  //   아직 다룬 적 없는 특징을 가진 경기를 하나씩 고른다(같은 6:5 접전만 반복하지 않음).
  //   특징이 있는 경기가 없으면 점수 차가 가장 작은 1경기만. 그래서 후보는 1~3경기(접전이 많아도 접전은 1경기).
  const scored = model.matches.map((m) => {
    const pa = m.keysA.filter((k) => podiumKeys.has(k)).length;
    const pb = m.keysB.filter((k) => podiumKeys.has(k)).length;
    const reasons: CandidateReason[] = [];
    if (margin(m) === 1) reasons.push('ONE_POINT');
    if (isShutout(m)) reasons.push('SHUTOUT');
    if (pa > 0 && pb > 0) reasons.push('TOP3_CLASH'); else if (pa + pb > 0) reasons.push('TOP3_INVOLVED');
    return { m, c: { matchId: m.matchId, margin: margin(m), podiumPlayers: pa + pb, reasons, note: matchNote(m, podiumKeys) } };
  }).sort((x, y) => x.c.margin - y.c.margin || y.c.podiumPlayers - x.c.podiumPlayers || byOrder(x.m, y.m));
  const KEY: CandidateReason[] = ['ONE_POINT', 'TOP3_CLASH', 'SHUTOUT'];
  const picked: typeof scored = [];
  const covered = new Set<CandidateReason>();
  const fresh = (y: (typeof scored)[number]) => y.c.reasons.filter((t) => KEY.includes(t) && !covered.has(t)).length;
  for (const r of KEY) {
    if (covered.has(r)) continue;
    // 이 특징을 가진 경기 중 아직 안 다룬 특징을 가장 많이 함께 가진 경기(동률이면 정렬 순서) — 예: 접전이면서 TOP3 맞대결.
    let best: (typeof scored)[number] | null = null;
    for (const y of scored) if (!picked.includes(y) && y.c.reasons.includes(r) && (!best || fresh(y) > fresh(best))) best = y;
    if (best) { picked.push(best); best.c.reasons.forEach((t) => covered.add(t)); }
  }
  if (!picked.length && scored.length) picked.push(scored[0]);
  const candidates: FeaturedCandidate[] = picked.slice(0, FR_CANDIDATE_MAX).map((x) => x.c);

  // 헤드라인 후보(사실 근거 있는 것만 · 길이 초과 문구는 제외).
  const headlines: HeadlineCandidate[] = [];
  const push = (kind: HeadlineKind, text: string) => { if (cpLen(text) <= FR_HEADLINE_MAX) headlines.push({ kind, text }); };
  if (champ) {
    const n = champ.name;
    if (soleUnbeaten && champRec) push('UNBEATEN_SOLE', `${unbeatenWord(champRec)}, ${n}의 무패 우승`);
    if (championUnbeaten && unbeatenRows.length >= 2) push('UNBEATEN_JOINT', `무패 ${unbeatenRows.length}명 가운데 정상에 오른 ${n}`);
    if (winRows.length === 1 && winRows[0].key === champ.key && diffRows.length === 1 && diffRows[0].key === champ.key && !soleUnbeaten) {
      push('DOUBLE_CROWN', `최다승과 최고 득실, 두 기록의 주인공 ${n}`);
    }
    if (closeMatchCount >= 2) push('CLOSE_BATTLES', `1점 차 접전 ${closeMatchCount}경기, 오늘의 챔피언은 ${n}`);
    push('PARTICIPANTS', `${model.participantCount}명의 도전, 정상에 오른 ${n}`);
  }
  if (!headlines.some((h) => h.kind === 'PARTICIPANTS')) {
    headlines.push({ kind: 'PARTICIPANTS', text: `${model.participantCount}명의 도전, 오늘의 챔피언` });
  }

  return {
    champion: champ ? { name: champ.name, guest: champ.guest } : null,
    unbeaten: { count: unbeatenRows.length, championUnbeaten, sole: soleUnbeaten },
    mostWins: { value: maxWins, count: winRows.length, joint: winRows.length > 1 },
    bestDiff: { value: maxDiff, count: diffRows.length, joint: diffRows.length > 1 },
    closeMatchCount, shutoutCount,
    highlights: highlights.slice(0, FR_HIGHLIGHT_MAX),
    podium, candidates, headlines, headline: headlines[0].text,
  };
}

// ── 운영진 제안 문구(편집기에서 채워 넣고 운영진이 고친다 · 그대로 저장되면 운영진 문구로 검사) ─────────
//   스토리 제안은 이름을 넣지 않는다(스토리 문구에는 본인 이름만 허용). 리뷰 제안에는 그 경기 4명 이름만 쓴다.
/** 숫자 뒤 조사 '로/으로' — 마지막 숫자 읽기의 받침 기준(ㄹ 받침 · 받침 없음 → 로). */
export function josaRo(n: number): string {
  const d = Math.abs(n) % 10;
  if (d === 0) return '으로'; // 영 · 십 · 백 …
  return d === 3 || d === 6 ? '으로' : '로';
}
const PLACE_VERB: Record<number, string> = { 1: '정상에 올랐습니다', 2: '준우승을 차지했습니다', 3: '3위에 올랐습니다' };
export function storySuggestion(r: PlayerRecord): string {
  const unb = r.badges.find((b) => b.kind === 'UNBEATEN');
  // 공동 무패면 반드시 '공동 무패'를 밝힌다(2 · 3위가 무패여도 우승이 아닌 이유를 지어내지 않음).
  const head = unb ? `${unbeatenWord(r)}${unb.joint ? ' 공동 무패' : ''}`
    : r.draws > 0 ? `${r.played}전 ${r.wins}승 ${r.draws}무 ${r.losses}패` : `${r.played}전 ${r.wins}승 ${r.losses}패`;
  // 단독 기록은 괄호로(조사는 괄호 앞 숫자 기준).
  const badge = r.badges.find((b) => b.kind === 'MOST_WINS' && !b.joint) ? '(최다승)'
    : r.badges.find((b) => b.kind === 'BEST_DIFF' && !b.joint) ? '(최고 득실)' : '';
  return `${head}, 득실 ${signed(r.diff)}${badge}${josaRo(r.diff)} ${PLACE_VERB[r.rank] ?? `${r.rank}위에 올랐습니다`}.`;
}
export function reviewSuggestion(m: MatchRow, podiumKeys: ReadonlySet<string>, max = 100): string {
  const hi = Math.max(m.score1, m.score2); const lo = Math.min(m.score1, m.score2);
  const win = m.score1 > m.score2 ? m.teamA : m.score2 > m.score1 ? m.teamB : null;
  const score = `${hi}:${lo}`;
  const clash = m.keysA.some((k) => podiumKeys.has(k)) && m.keysB.some((k) => podiumKeys.has(k));
  const tail = clash ? ' TOP3 선수끼리 만난 경기입니다.' : '';
  const body = !win ? '' : margin(m) === 1 ? `1점 차 접전 끝에 ${score}${josaRo(lo)} 승리했습니다.`
    : isShutout(m) ? `${score} 완봉승을 거뒀습니다.` : `${score}${josaRo(lo)} 승리했습니다.`;
  const withNames = win
    ? `${win.join('·')} 팀이 ${body}${tail}`
    : `${m.teamA.join('·')} 팀과 ${m.teamB.join('·')} 팀이 ${score}${josaRo(lo)} 비겼습니다.${tail}`;
  if (cpLen(withNames) <= max) return withNames;
  // 이름이 길어 넘치면 이름 없이 점수만.
  if (!win) return `${score} 무승부 경기입니다.`;
  const pre = margin(m) === 1 ? '1점 차 접전, ' : isShutout(m) ? '완봉 승부, ' : '';
  return `${pre}${score}${josaRo(lo)} 끝난 경기입니다.`;
}

// ── 공개본(allow-list) ─────────────────────────────────────────────────────────
export interface PublicHighlight { kind: HighlightKind; label: string; value: string; names: string[]; total: number; joint: boolean }
export interface PublicPlayerRecord {
  played: number; summary: string; badges: Badge[];
  matches: Array<{ round: number | null; partner: string; opponents: [string, string]; scoreFor: number; scoreAgainst: number; result: 'W' | 'L' | 'D' }>;
}
export const publicHighlight = (h: Highlight): PublicHighlight => ({ kind: h.kind, label: h.label, value: h.value, names: [...h.names], total: h.total, joint: h.joint });
export const publicRecord = (r: PlayerRecord): PublicPlayerRecord => ({
  played: r.played, summary: r.summary, badges: r.badges.map((b) => ({ ...b })),
  matches: r.matches.map((m) => ({ round: m.round, partner: m.partner, opponents: [m.opponents[0], m.opponents[1]], scoreFor: m.scoreFor, scoreAgainst: m.scoreAgainst, result: m.result })),
});

// ── 공개 응답 파서(허용 목록 · 길이 제한) ─────────────────────────────────────────────
const HL_KINDS = new Set<HighlightKind>(['UNBEATEN_CHAMPION', 'UNBEATEN', 'MOST_WINS', 'BEST_DIFF', 'CLOSE_MATCHES', 'SHUTOUT']);
const BADGE_KINDS = new Set<BadgeKind>(['UNBEATEN', 'MOST_WINS', 'BEST_DIFF']);
const ps = (v: unknown, n: number): string => (typeof v === 'string' ? [...v].slice(0, n).join('') : '');
const pi = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

export function parsePublicHighlights(v: unknown): PublicHighlight[] {
  return (Array.isArray(v) ? v : []).slice(0, FR_HIGHLIGHT_MAX).flatMap((x) => {
    const o = x as Record<string, unknown>;
    if (!o || typeof o !== 'object' || !HL_KINDS.has(o.kind as HighlightKind)) return [];
    const label = ps(o.label, 20); const value = ps(o.value, 20);
    if (!label || !value) return [];
    const names = (Array.isArray(o.names) ? o.names : []).slice(0, FR_HIGHLIGHT_NAMES).map((n) => ps(n, 40)).filter(Boolean);
    return [{ kind: o.kind as HighlightKind, label, value, names, total: Math.max(0, pi(o.total) ?? 0), joint: o.joint === true }];
  });
}
export function parsePublicRecord(v: unknown): PublicPlayerRecord | null {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;
  const summary = ps(o.summary, 40);
  if (!summary) return null;
  const badges = (Array.isArray(o.badges) ? o.badges : []).slice(0, 3).flatMap((b) => {
    const x = b as Record<string, unknown>;
    return x && BADGE_KINDS.has(x.kind as BadgeKind) ? [{ kind: x.kind as BadgeKind, joint: x.joint === true }] : [];
  });
  const matches = (Array.isArray(o.matches) ? o.matches : []).slice(0, 12).flatMap((m) => {
    const x = m as Record<string, unknown>;
    if (!x || typeof x !== 'object' || pi(x.scoreFor) == null || pi(x.scoreAgainst) == null) return [];
    if (x.result !== 'W' && x.result !== 'L' && x.result !== 'D') return [];
    const op = Array.isArray(x.opponents) ? x.opponents : [];
    return [{ round: pi(x.round), partner: ps(x.partner, 40), opponents: [ps(op[0], 40), ps(op[1], 40)] as [string, string],
      scoreFor: pi(x.scoreFor) as number, scoreAgainst: pi(x.scoreAgainst) as number, result: x.result as 'W' | 'L' | 'D' }];
  });
  return { played: Math.max(0, pi(o.played) ?? 0), summary, badges, matches };
}
export const parsePublicNote = (v: unknown): string | null => ps(v, FR_NOTE_MAX) || null;
export const parsePublicHeadline = (v: unknown): string | null => ps(v, FR_HEADLINE_MAX) || null;
