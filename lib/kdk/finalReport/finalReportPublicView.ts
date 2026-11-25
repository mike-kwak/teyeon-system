// TEYEON KDK FINAL REPORT — 공개용 리포트(MAINT-002 · 회원 전용 순위 분리).
//
//   공개 페이지(/club/report/[slug]) · OG 이미지 · 메타 설명은 이 "공개 뷰"만 쓴다. 개인 순위 · TOP3 · 우승자 · 개인 승패/득실 ·
//   주요 경기(이름 · 점수) · 개인 기록 문장은 공개 뷰에 들어올 자리가 없다(allow-list 로 새 객체를 만든다).
//   · DB(get_public_kdk_final_report)가 이미 같은 규칙으로 투영해 주지만, SQL 적용 전 · rollback 후에도 같은 결과가 되도록
//     프런트(서버 렌더)에서도 한 번 더 투영한다(이중 방어). 전체 발행본이 들어와도 출력은 같다.
//   · 문구(opening · closing · headline · closingTitle)는 참가자 이름 · (G) · 경기 점수 형태가 있으면 공개하지 않는다(SQL kdk_fr_public_text 와 같은 규칙).
//   회원용 전체 리포트는 /api/kdk/final-report/member(Bearer · no-store)로만 받는다.

import type { NumberKind } from './v41/storyV41';

export type PublicNumberKind = NumberKind;
export interface FinalReportPublicView {
  /** 2 · 3 = 해당 판형에서 만든 공개본, null = v1. 표시 분기에는 쓰지 않고 정보용(편집기 재발행 안내는 layout 만 본다). */
  edition: 2 | 3 | null;
  session: { title: string; date: string; participantCount: number; matchCount: number };
  headline: string | null;
  opening: string | null;
  closing: string | null;
  /** edition 3 만: 개인 식별이 없는 집계(경기 · 1점 차 · 무실점 · 게스트 수). */
  numbers: Array<{ kind: PublicNumberKind; value: number }>;
  vol: number | null;
  next: { date: string; startTime: string | null } | null;
  /** V4.2 판형(2) 여부 — 편집기 재발행 안내용. */
  layout: 2 | null;
  closingTitle: string | null;
}

const NUM_KINDS: ReadonlySet<string> = new Set(['MATCHES', 'ONE_POINT', 'SHUTOUTS', 'GUESTS']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
/** 한 자리:한 자리 경기 점수(6:5 · 6-4). 시각(08:00 · 19:00)은 통과. SQL 과 같은 식. */
const SCORE_RE = /(^|[^0-9])[0-9]\s*[:：\-–—]\s*[0-9]([^0-9]|$)/;
const GUEST_MARK_RE = /\([Gg]\)/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const cnt = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 9999 ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const cleanName = (n: string): string => n.replace(/\s*\([Gg]\)\s*$/, '').replace(/\s+/g, '');
const compact = (t: string): string => t.replace(/\s+/g, '');

/**
 * 문구 안에서 찾을 참가자 이름(공개본 · Archive 어디에 있든). 공백 제거 · 2글자 이상만.
 *   한글 3~4글자 이름은 성을 뺀 이름(김가람 → 가람)도 넣는다(SQL kdk_fr_public_names 와 같은 규칙).
 */
export function participantNamesOf(payload: unknown): string[] {
  const p = obj(payload) ?? {};
  const v41 = obj(p.v41) ?? {};
  const out = new Set<string>();
  const add = (x: unknown) => {
    const n = cleanName(str(x));
    if ([...n].length >= 2) out.add(n);
    if (/^[가-힣]{3,4}$/.test(n)) out.add(n.slice(1));
  };
  for (const list of [p.standings, p.podium, v41.heroes, v41.mentions]) for (const e of arr(list)) add(obj(e)?.name);
  for (const f of arr(p.featured)) { const o = obj(f); for (const n of [...arr(o?.teamA), ...arr(o?.teamB)]) add(n); }
  const r = obj(v41.rivalry);
  if (r) for (const n of [r.winner, r.loser, ...arr(r.winnerTeam), ...arr(r.loserTeam)]) add(n);
  for (const h of arr(p.highlights)) for (const n of arr(obj(h)?.names)) add(n);
  return [...out];
}

/** 공개해도 되는 문구만 돌려준다(아니면 null). 글자 수는 코드 포인트 기준으로 자른다. */
export function publicText(v: unknown, names: readonly string[], max: number): string | null {
  const t = str(v).trim();
  if (!t) return null;
  if (SCORE_RE.test(t) || GUEST_MARK_RE.test(t)) return null;
  const c = compact(t);
  if (names.some((n) => n && c.includes(n))) return null;
  return [...t].slice(0, Math.max(1, max)).join('');
}

/**
 * 공개 응답 payload(공개 투영 또는 — SQL 적용 전 — 전체 발행본) → 공개 뷰.
 *   schema 1 · session 객체가 없으면 null(not_found 로 처리).
 */
export function parsePublicReportView(v: unknown): FinalReportPublicView | null {
  const p = obj(v);
  if (!p || p.schema !== 1) return null;
  const ss = obj(p.session);
  if (!ss) return null;
  const names = participantNamesOf(p);
  const edition = p.edition === 2 || p.edition === 3 ? p.edition : null;
  const x = edition === 3 ? obj(p.v41) : null;
  const nx = x ? obj(x.next) : null;
  const v42 = x?.layout === 2;
  return {
    edition,
    session: {
      // 세션명에 참가자 이름이 있으면(공백 무시) 일반 제목으로(SQL 과 같은 규칙).
      title: names.some((n) => n && compact(str(ss.title)).includes(n)) ? 'TEYEON KDK' : [...str(ss.title)].slice(0, 80).join(''),
      date: str(ss.date).slice(0, 20),
      participantCount: cnt(ss.participantCount),
      matchCount: cnt(ss.matchCount),
    },
    headline: edition ? publicText(p.headline, names, 40) : null,
    opening: publicText(p.opening, names, 60),
    closing: publicText(p.closing, names, 90),
    numbers: x ? arr(x.numbers).slice(0, 4).flatMap((n) => {
      const o = obj(n);
      return o && NUM_KINDS.has(str(o.kind)) && typeof o.value === 'number' && Number.isInteger(o.value) && o.value >= 0 && o.value <= 9999
        ? [{ kind: o.kind as PublicNumberKind, value: o.value }] : [];
    }) : [],
    vol: x && typeof x.vol === 'number' && Number.isInteger(x.vol) && x.vol >= 1 && x.vol <= 9999 ? x.vol : null,
    next: nx && DATE_RE.test(str(nx.date)) ? { date: str(nx.date), startTime: TIME_RE.test(str(nx.startTime)) ? str(nx.startTime) : null } : null,
    layout: v42 ? 2 : null,
    closingTitle: v42 ? publicText(x?.closingTitle, names, 30) : null,
  };
}

/** 공개 집계 표시 문구(개인 정보 없음 · 코드 고정 문구). */
export const PUBLIC_NUMBER_TEXT: Record<PublicNumberKind, { label: string; sub: string }> = {
  MATCHES: { label: '경기', sub: '공식 기록으로 확정된 경기' },
  ONE_POINT: { label: '1점 차 승부', sub: '1게임 차로 끝난 경기' },
  SHUTOUTS: { label: '무실점 승리', sub: '한 게임도 내주지 않은 경기' },
  GUESTS: { label: '게스트', sub: '함께한 게스트' },
};

/** 회원 전용 안내(한 곳에만 표시). */
export const MEMBER_ONLY_NOTICE = '개인별 경기 기록 및 최종 순위는 TEYEON 회원에게 공개됩니다.';
