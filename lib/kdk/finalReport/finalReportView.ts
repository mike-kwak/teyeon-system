// TEYEON KDK FINAL REPORT — 공개 화면(P2) 표시 규칙(순수 함수 · 화면 컴포넌트와 QA 가 함께 쓴다).
//   입력은 parsePublicFinalReport(allow-list)를 거친 FinalReportPublicPayload 뿐. 순위 · 승패 · 점수는 그대로 표시만 한다
//   (재계산 · 재정렬 없음). 운영진 문구가 없으면 해당 자리를 비워 둔다(자동 문장 생성 없음).

import type { FinalReportPublicPayload, PublicFeatured, PublicStanding } from './finalReportModel';
import type { PublicHighlight } from './finalReportStory';

/** Premium Sports Editorial — 표지 Dark Navy + Soft Gold, 본문 Cool Premium Light. */
export const FRV = {
  navy: '#0B1A2E',
  navyDeep: '#06111F',
  navyLine: 'rgba(227,199,126,0.22)',
  gold: '#C9A24B',
  goldSoft: '#E3C77E',
  goldInk: '#8A6A20',
  goldWash: '#FBF6E9',
  bg: '#F2F5F8',
  surface: '#FFFFFF',
  ink: '#12233A',
  sub: '#4A5B70',
  muted: '#7D8B9B',
  line: '#E1E7EE',
  lineSoft: '#ECF0F4',
  teal: '#0E8F84',
  tealWash: '#E6F4F2',
  onNavy: '#F4F1E8',
  onNavySub: 'rgba(244,241,232,0.68)',
} as const;
export const FRV_SERIF = '"Noto Serif KR", "Nanum Myeongjo", Georgia, "Times New Roman", serif';
export const FRV_DISPLAY = 'var(--font-rajdhani), var(--font-geist), system-ui, sans-serif';

export const PODIUM_LABEL: Record<number, string> = { 1: 'CHAMPION', 2: 'RUNNER-UP', 3: 'THIRD PLACE' };

export type TagTone = 'gold' | 'navy' | 'teal' | 'slate';
export const TAG_META: Record<string, { label: string; tone: TagTone }> = {
  MATCH_OF_THE_DAY: { label: 'MATCH OF THE DAY', tone: 'gold' },
  OPERATORS_PICK: { label: "OPERATOR'S PICK", tone: 'navy' },
  CLOSEST_BATTLE: { label: 'CLOSEST BATTLE', tone: 'teal' },
  SHUTOUT: { label: 'SHUTOUT', tone: 'slate' },
};
/** 표시 순서: 운영진 태그 → 기록 태그. 알 수 없는 태그는 파서가 이미 버린다. */
export function tagList(tags: readonly string[]): Array<{ key: string; label: string; tone: TagTone }> {
  const order = ['MATCH_OF_THE_DAY', 'OPERATORS_PICK', 'CLOSEST_BATTLE', 'SHUTOUT'];
  return order.filter((k) => tags.includes(k)).map((k) => ({ key: k, ...TAG_META[k] }));
}

/** 득실 표기: +12 · −6 · 0 (빼기는 유니코드 마이너스로 숫자 폭을 맞춘다). */
export function formatDiff(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}
export const groupLabel = (g: string): string => (g ? `${g}조` : '');

/** 경기 승패(점수 그대로): A = score1 팀. 동점이면 승자 없음. */
export function matchWinner(m: Pick<PublicFeatured, 'score1' | 'score2'>): 'A' | 'B' | null {
  if (m.score1 > m.score2) return 'A';
  if (m.score2 > m.score1) return 'B';
  return null;
}
export function matchMeta(m: Pick<PublicFeatured, 'round' | 'court' | 'group'>): string {
  return [m.round != null ? `ROUND ${m.round}` : '', m.court != null ? `COURT ${m.court}` : '', groupLabel(m.group)].filter(Boolean).join(' · ');
}

/** 날짜 'YYYY-MM-DD' → '2026. 11. 11 (수)'. 형식이 다르면 원문 그대로. */
export function formatReportDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return date.trim();
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return date.trim();
  return `${m[1]}. ${m[2]}. ${m[3]} (${'일월화수목금토'[d.getUTCDay()]})`;
}

export interface Chapter { id: 'podium' | 'records' | 'review' | 'standings'; no: string; title: string; kicker: string }
/** 챕터 목록 — 주요 경기가 없으면 MATCH REVIEW 를 빼고 번호를 이어 붙인다(빈 챕터 없음). */
export function chaptersOf(p: FinalReportPublicPayload): Chapter[] {
  const list: Array<Omit<Chapter, 'no'>> = [
    { id: 'podium', title: 'THE PODIUM', kicker: '공식 TOP 3' },
    ...(p.featured.length ? [{ id: 'review' as const, title: 'MATCH REVIEW', kicker: '주요 경기' }] : []),
    { id: 'standings', title: 'FINAL STANDINGS', kicker: '공식 전체 순위' },
  ];
  return list.map((c, i) => ({ ...c, no: String(i + 1).padStart(2, '0') }));
}

// ── v2(edition 2) 표시 규칙 ─────────────────────────────────────────────────────
/** v2 챕터: THE PODIUM → THE RECORDS(기록 카드가 있을 때) → MATCH REVIEW(주요 경기가 있을 때) → FINAL STANDINGS. */
export function chaptersOfV2(p: FinalReportPublicPayload): Chapter[] {
  const list: Array<Omit<Chapter, 'no'>> = [
    { id: 'podium', title: 'THE PODIUM', kicker: '공식 TOP 3' },
    ...(recordsView(p).any ? [{ id: 'records' as const, title: 'THE RECORDS', kicker: '오늘의 기록' }] : []),
    ...(p.featured.length ? [{ id: 'review' as const, title: 'MATCH REVIEW', kicker: p.featuredMode === 'manual' ? '운영진 선정 경기' : '기록 기준 추천 경기' }] : []),
    { id: 'standings', title: 'FINAL STANDINGS', kicker: '공식 전체 순위' },
  ];
  return list.map((c, i) => ({ ...c, no: String(i + 1).padStart(2, '0') }));
}
/**
 * v2.1 THE RECORDS 표시(공개본 하이라이트는 그대로 두고 화면에서만 고른다):
 *   · 우승자 혼자 가진 기록(무패 우승 · 단독 최다승 · 단독 최고 득실)은 COVER · PODIUM 이 이미 보여 주므로 뺀다.
 *   · 공동 기록 · 우승자가 아닌 선수의 단독 기록은 선수 기록 카드로.
 *   · 경기 수 기록(1점 차 접전 · 완봉)은 한 영역(matchStats)으로 묶는다.
 */
export function recordsView(p: Pick<FinalReportPublicPayload, 'highlights' | 'podium'>): { players: PublicHighlight[]; matchStats: PublicHighlight[]; any: boolean } {
  const champ = p.podium[0]?.name ?? '';
  const all = p.highlights ?? [];
  const soleChampion = (h: PublicHighlight) => !h.joint && h.names.length === 1 && h.names[0] === champ;
  const players = all.filter((h) => (h.kind === 'UNBEATEN' || h.kind === 'MOST_WINS' || h.kind === 'BEST_DIFF') && !soleChampion(h));
  const matchStats = all.filter((h) => h.kind === 'CLOSE_MATCHES' || h.kind === 'SHUTOUT');
  return { players, matchStats, any: players.length + matchStats.length > 0 };
}
/** 주요 경기에 다 싣지 못한 1점 차 접전 수 안내(기록 근거만). 없으면 null. */
export function closeSummary(p: Pick<FinalReportPublicPayload, 'highlights' | 'featured'>): string | null {
  const total = (p.highlights ?? []).find((h) => h.kind === 'CLOSE_MATCHES')?.total ?? 0;
  const shown = p.featured.filter((m) => Math.abs(m.score1 - m.score2) === 1).length;
  return total > shown ? `이날 1점 차 접전은 모두 ${total}경기였습니다.` : null;
}
/** 배지 이름(공동이면 반드시 '공동'). 1위의 무패는 '무패 우승'. */
export function badgeLabel(b: { kind: 'UNBEATEN' | 'MOST_WINS' | 'BEST_DIFF'; joint: boolean }, rank: number): string {
  if (b.kind === 'UNBEATEN') return b.joint ? '공동 무패' : rank === 1 ? '무패 우승' : '무패';
  if (b.kind === 'MOST_WINS') return b.joint ? '공동 최다승' : '최다승';
  return b.joint ? '공동 최고 득실' : '최고 득실';
}
export const RESULT_LABEL: Record<'W' | 'L' | 'D', string> = { W: '승', L: '패', D: '무' };
/** MATCH OF THE DAY 로 크게 보일 경기: 운영진 MATCH_OF_THE_DAY 태그 경기, 없으면 첫 경기. */
export function heroIndex(featured: readonly PublicFeatured[]): number {
  const i = featured.findIndex((m) => m.tags.includes('MATCH_OF_THE_DAY'));
  return i >= 0 ? i : 0;
}
/** 리뷰가 없을 때의 기록 한 줄(점수에서 바로 확인되는 것만). */
export function matchFallbackLine(m: Pick<PublicFeatured, 'score1' | 'score2' | 'note'>): string {
  const hi = Math.max(m.score1, m.score2); const lo = Math.min(m.score1, m.score2);
  if (m.note) return `${hi}:${lo} · ${m.note}`;
  if (hi > lo && lo === 0) return `${hi}:${lo} · 완봉`;
  return hi === lo ? `${hi}:${lo} 무승부` : `${hi}:${lo} · ${hi - lo}점 차 승부`;
}
export const CLOSING_DEFAULT = '다음 KDK 코트에서 다시 만나요.';

/** 순위표에 조 정보가 하나라도 있으면 조 열을 보인다. */
export const hasGroups = (rows: readonly PublicStanding[]): boolean => rows.some((r) => !!r.group);

export function reportMetaTitle(p: FinalReportPublicPayload): string {
  return `THE FINAL STORY · ${p.session.title || 'TEYEON KDK'}`;
}
export function reportMetaDescription(p: FinalReportPublicPayload): string {
  const head = p.podium[0] ? `CHAMPION ${p.podium[0].name} · ` : '';
  return `${p.session.date ? `${p.session.date} · ` : ''}${head}참가 ${p.session.participantCount}명 · ${p.session.matchCount}경기 — TEYEON KDK 공식 결과`;
}

// ── OG 이미지(P4) — 공개 발행본(state ok)만 내용을 싣고, 그 밖의 상태는 중립 이미지 ─────────────
//   입력은 공개 조회 결과뿐(초안 · 비공개 · 정정 전 발행본 · 운영진 문구 · 수치 외 정보 없음).
//   TOP3 = 공개본 podium 순서 그대로(= Archive 저장 순서). 이름은 OG 칸에 맞게 자르기만 한다.
export type OgView =
  | { kind: 'report'; title: string; date: string; top3: Array<{ rank: number; label: string; name: string }> }
  | { kind: 'neutral' };
/** 글자(코드 포인트) 기준 자르기 — 넘치면 말줄임표. */
export function clipText(v: string, max: number): string {
  const chars = [...(v || '').trim()];
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…` : chars.join('');
}
export function ogViewOf(res: { state: string; payload?: FinalReportPublicPayload } | null | undefined): OgView {
  if (!res || res.state !== 'ok' || !res.payload) return { kind: 'neutral' };
  const p = res.payload;
  return {
    kind: 'report',
    title: clipText(p.session.title || 'TEYEON KDK', 24),
    date: p.session.date ? formatReportDate(p.session.date) : '',
    top3: p.podium.slice(0, 3).map((x) => ({ rank: x.rank, label: PODIUM_LABEL[x.rank] || '', name: clipText(x.name, 10) })),
  };
}
