// TEYEON FINAL REPORT V4.1 — edition 3 공개 필드(v41) allow-list 파서. 타입만 참조(순환 import 없음).

import type { HeroKind, NumberKind, V41Story } from './storyV41';

export type V41Public = V41Story;

// ── 공개 응답 파서(allow-list) ───────────────────────────────────────────────
const s = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');
const int = (v: unknown, min = 0, max = 9999): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
const HERO_KINDS = new Set<HeroKind>(['COMEBACK', 'BREAKTHROUGH', 'MOST_GAMES', 'SHUTOUT']);
const NUM_KINDS = new Set<NumberKind>(['MATCHES', 'ONE_POINT', 'SHUTOUTS', 'GUESTS']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseV41Public(v: unknown): V41Public | null {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object') return null;
  const heroes = (Array.isArray(o.heroes) ? o.heroes : []).slice(0, 3).flatMap((h) => {
    const x = h as Record<string, unknown>;
    if (!x || !HERO_KINDS.has(x.kind as HeroKind) || !s(x.name, 40)) return [];
    return [{ kind: x.kind as HeroKind, title: s(x.title, 24), name: s(x.name, 40), stat: s(x.stat, 12), head: s(x.head, 60), line: s(x.line, 90),
      source: x.source === 'archive' ? 'archive' as const : 'today' as const }];
  });
  const mentions = (Array.isArray(o.mentions) ? o.mentions : []).slice(0, 3).flatMap((m) => {
    const x = m as Record<string, unknown>;
    return x && s(x.name, 40) ? [{ name: s(x.name, 40), line: s(x.line, 60) }] : [];
  });
  const r = o.rivalry as Record<string, unknown> | null;
  let rivalry: V41Public['rivalry'] = null;
  if (r && typeof r === 'object' && s(r.winner, 40) && s(r.loser, 40) && int(r.priorWins) !== null && int(r.priorLosses) !== null
      && int(r.scoreWin) !== null && int(r.scoreLose) !== null) {
    const team = (t: unknown): [string, string] => { const a = Array.isArray(t) ? t : []; return [s(a[0], 40), s(a[1], 40)]; };
    rivalry = { winner: s(r.winner, 40), loser: s(r.loser, 40), winnerTeam: team(r.winnerTeam), loserTeam: team(r.loserTeam),
      priorWins: int(r.priorWins) as number, priorLosses: int(r.priorLosses) as number,
      recent: (Array.isArray(r.recent) ? r.recent : []).slice(-5).filter((x): x is 'W' | 'L' => x === 'W' || x === 'L'),
      from: s(r.from, 7), to: s(r.to, 7), scoreWin: int(r.scoreWin) as number, scoreLose: int(r.scoreLose) as number,
      round: int(r.round, 0, 99), title: s(r.title, 40), line: s(r.line, 120) };
  }
  const numbers = (Array.isArray(o.numbers) ? o.numbers : []).slice(0, 4).flatMap((n) => {
    const x = n as Record<string, unknown>;
    return x && NUM_KINDS.has(x.kind as NumberKind) && int(x.value) !== null
      ? [{ kind: x.kind as NumberKind, value: int(x.value) as number, label: s(x.label, 16), sub: s(x.sub, 40) }] : [];
  });
  const nx = o.next as Record<string, unknown> | null;
  const next = nx && typeof nx === 'object' && DATE_RE.test(s(nx.date, 10))
    ? { date: s(nx.date, 10), startTime: /^\d{2}:\d{2}$/.test(s(nx.startTime, 5)) ? s(nx.startTime, 5) : null } : null;
  return { vol: int(o.vol, 1, 9999), heroes, mentions, rivalry, numbers, next };
}
