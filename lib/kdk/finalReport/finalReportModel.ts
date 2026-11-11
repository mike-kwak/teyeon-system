// TEYEON KDK FINAL REPORT — 공식 Archive → 리포트 모델 · 운영진 입력 · 공개 payload (순수 계산 · DB/네트워크 없음).
//
//   입력: get_kdk_final_report_source() 의 archive 투영(ranking_data · snapshot_data · 조 정보만 — 정산 · 출생연도 · 아바타 · 확정자 없음).
//   ⚠ 공식 순위는 ranking_data 의 저장 순서 그대로다(1번째 = 1위). 재계산 · 재정렬 · 조별 재계산을 하지 않는다
//     (lib/kdk/officialRanking.ts 원칙 — 과거 공식 Archive 는 절대 재정렬하지 않는다).
//   ⚠ 기록 지문(source signature)은 이 파일이 아니라 SQL(kdk_final_report_signature) 한 곳에서만 계산한다 —
//     발행 · 열람 검증이 같은 함수를 쓰도록(TS/SQL 이중 구현 금지).
//   ⚠ 공개 payload 에는 선수 내부 id · 회원 UUID · 세션 id · 정산 · 출생연도 · 확정자 · 운영진 비공개 메모가 들어가지 않는다.
//     내부 키(playerKey · matchId)는 모델 · 운영진 입력 연결에만 쓰고 payload 로 내보내지 않는다.
//   ⚠ 기록으로 확인할 수 없는 이야기(역전 · 라이벌 · 분위기)는 만들지 않는다. 태그는 점수에서 바로 확인되는 것만.

import { isGuestRankedPlayer } from '../settlement';
import { sanitizeOperatorText } from '../analytics/spotlightOperator';
import { checkPublicText, issueText, type TextIssue } from '../analytics/spotlightMemoLink';

export const FR_OPENING_MAX = 60;
export const FR_STORY_MAX = 80;
export const FR_REVIEW_MAX = 100;
export const FR_CLOSING_MAX = 60;
export const FR_FEATURED_MAX = 4;
export const FR_PODIUM = 3;

// ── 입력(서버 투영) ─────────────────────────────────────────────────────────────
export interface FinalReportSource {
  id: string;
  archiveType: string;
  isOfficial: boolean;
  isTest: boolean;
  title: string;
  date: string;
  rankingData: unknown[];
  snapshotData: unknown[];
  /** player_metadata 의 조만(id → group). */
  playerGroups: Record<string, unknown>;
}

// 선수 이름 공개 정책(2026-11-11 확정): 기존 /club/kdk 공식 결과와 같이 모든 참가자 이름을 표시한다.
//   프로필 공개 설정(public/partial/private)은 회원 프로필 범위이고, 공식 경기 결과 공개 범위와 구분한다.
//   게스트는 '이름(G)'. 전화 · 이메일 · 출생연도 · UUID · 정산 · 계좌 · 비공개 프로필 정보는 계속 payload 에 없다.

export type Group = 'A' | 'B' | '';
export interface StandingRow {
  rank: number;
  /** 내부 키(회원 id · manual-guest-… · 없으면 nm:이름) — 공개하지 않는다. */
  key: string;
  name: string;
  wins: number;
  losses: number;
  diff: number;
  group: Group;
  guest: boolean;
}
export interface MatchRow {
  /** 내부 경기 id — 공개하지 않는다. */
  matchId: string;
  round: number | null;
  court: number | null;
  group: Group;
  teamA: [string, string];
  teamB: [string, string];
  /** 내부 선수 키 — 공개하지 않는다. */
  keysA: [string, string];
  keysB: [string, string];
  score1: number;
  score2: number;
}
export interface FinalReportModel {
  title: string;
  date: string;
  participantCount: number;
  completedMatchCount: number;
  standings: StandingRow[];
  matches: MatchRow[];
  /** 검증용(비공개): 참가자 기본 표시명((G) 제외). */
  allNames: string[];
}
export type ModelReject = 'not_kdk' | 'not_official' | 'test' | 'no_ranking' | 'invalid_ranking' | 'no_completed_matches';

// ── 정규화(SQL kdk_fr_* 와 같은 규칙) ───────────────────────────────────────────────
export function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? v : null;
  if (typeof v === 'string') { const t = v.trim(); return /^-?\d{1,9}(\.0+)?$/.test(t) ? Math.trunc(Number(t)) : null; }
  return null;
}
export function normalizeGroup(v: unknown): Group {
  const raw = String(v ?? '').trim().toUpperCase();
  if (raw.includes('B') || raw.includes('BLUE')) return 'B';
  if (raw.includes('A') || raw.includes('GOLD')) return 'A';
  return '';
}
export function playerKey(id: unknown, name: unknown): string {
  const i = String(id ?? '').trim();
  if (i) return i;
  const n = String(name ?? '').trim();
  return n ? `nm:${n.toLowerCase()}` : '';
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
/** 표시명 기본형: manual-guest- 접두 · (G) · 끝의 " g" 제거. */
export function baseName(name: unknown): string {
  return str(name).replace(/^manual-guest-/i, '').replace(/\s*\(G\)\s*$/i, '').replace(/\s+g$/i, '').trim();
}

// ── 1) Archive → 모델 ──────────────────────────────────────────────────────────
export function buildFinalReportModel(src: FinalReportSource): { ok: true; model: FinalReportModel } | { ok: false; reason: ModelReject } {
  if (src.archiveType !== 'kdk') return { ok: false, reason: 'not_kdk' };
  if (src.isOfficial !== true) return { ok: false, reason: 'not_official' };
  if (src.isTest === true) return { ok: false, reason: 'test' };
  const ranking = Array.isArray(src.rankingData) ? src.rankingData : [];
  if (ranking.length === 0) return { ok: false, reason: 'no_ranking' };
  const groups = src.playerGroups && typeof src.playerGroups === 'object' ? src.playerGroups : {};

  const seen = new Set<string>();
  const standings: StandingRow[] = [];
  const allNames: string[] = [];
  for (let i = 0; i < ranking.length; i += 1) {
    const r = ranking[i] as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return { ok: false, reason: 'invalid_ranking' };
    const key = playerKey(r.id, r.name);
    if (!key || seen.has(key)) return { ok: false, reason: 'invalid_ranking' };
    seen.add(key);
    const id = str(r.id).trim();
    const guest = isGuestRankedPlayer({ id, name: str(r.name) });
    const base = baseName(r.name) || '이름 미공개';
    if (base !== '이름 미공개') allNames.push(base);
    standings.push({
      rank: i + 1, key,
      name: guest ? `${base}(G)` : base,
      wins: toInt(r.wins) ?? 0, losses: toInt(r.losses) ?? 0, diff: toInt(r.diff) ?? 0,
      group: normalizeGroup(r.group ?? (id ? (groups as Record<string, unknown>)[id] : '')),
      guest,
    });
  }
  const byKey = new Map(standings.map((s) => [s.key, s]));

  const matches: MatchRow[] = [];
  const seenMatch = new Set<string>();
  for (const raw of Array.isArray(src.snapshotData) ? src.snapshotData : []) {
    const m = raw as Record<string, unknown> | null;
    if (!m || typeof m !== 'object' || m.status !== 'complete') continue;
    const matchId = str(m.id).trim();
    if (!matchId || seenMatch.has(matchId)) continue;
    const ids = Array.isArray(m.player_ids) ? m.player_ids : [];
    const names = Array.isArray(m.player_names) ? m.player_names : [];
    const s1 = toInt(m.score1); const s2 = toInt(m.score2);
    if (s1 == null || s2 == null || s1 < 0 || s2 < 0) continue;
    const keys = [0, 1, 2, 3].map((k) => playerKey(ids[k], names[k]));
    if (keys.some((k) => !k)) continue;
    // 표시명: 순위표의 같은 선수 표시를 우선((G) 일관), 없으면 이 경기 기록만으로.
    const disp = keys.map((k, n) => {
      const s = byKey.get(k);
      if (s) return s.name;
      const guest = isGuestRankedPlayer({ id: str(ids[n]).trim(), name: str(names[n]) });
      const base = baseName(names[n]) || '이름 미공개';
      return guest ? `${base}(G)` : base;
    });
    seenMatch.add(matchId);
    matches.push({
      matchId, round: toInt(m.round), court: toInt(m.court), group: normalizeGroup(m.group_name),
      teamA: [disp[0], disp[1]], teamB: [disp[2], disp[3]],
      keysA: [keys[0], keys[1]], keysB: [keys[2], keys[3]], score1: s1, score2: s2,
    });
  }
  if (matches.length === 0) return { ok: false, reason: 'no_completed_matches' };
  // 표시 순서: 라운드 → 코트 → 경기 id(기록 저장 순서와 무관하게 안정).
  matches.sort((a, b) => (a.round ?? 999) - (b.round ?? 999) || (a.court ?? 999) - (b.court ?? 999) || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));
  return { ok: true, model: {
    title: str(src.title).trim(), date: str(src.date).trim(),
    participantCount: standings.length, completedMatchCount: matches.length,
    standings, matches, allNames: [...new Set(allNames)],
  } };
}

// ── 2) 기록 근거 태그 · 주요 경기 추천 ─────────────────────────────────────────────
export type RecordTag = 'CLOSEST_BATTLE' | 'SHUTOUT';
export type OperatorTag = 'MATCH_OF_THE_DAY' | 'OPERATORS_PICK';
const margin = (m: MatchRow) => Math.abs(m.score1 - m.score2);
/** 점수에서 바로 확인되는 태그만: 최소 점수 차(2 이하)인 경기 = CLOSEST_BATTLE, 한 팀 0점 = SHUTOUT. */
export function recordTags(m: MatchRow, model: FinalReportModel): RecordTag[] {
  const min = Math.min(...model.matches.map(margin));
  const tags: RecordTag[] = [];
  if (min <= 2 && margin(m) === min) tags.push('CLOSEST_BATTLE');
  if (Math.min(m.score1, m.score2) === 0 && margin(m) > 0) tags.push('SHUTOUT');
  return tags;
}
/** 기본 추천(최대 4): 접전 → 완봉, 각각 라운드 · 코트 순. 운영진이 고르지 않았을 때 기록만으로 보여 줄 후보. */
export function recommendFeatured(model: FinalReportModel, max = FR_FEATURED_MAX): string[] {
  const close = model.matches.filter((m) => recordTags(m, model).includes('CLOSEST_BATTLE'));
  const shut = model.matches.filter((m) => !close.includes(m) && recordTags(m, model).includes('SHUTOUT'));
  return [...close, ...shut].slice(0, max).map((m) => m.matchId);
}
/** 경기 지문(내부): 선수 구성 + 점수. 리뷰를 고른 뒤 이 경기 기록이 바뀌었는지 판정. */
export function matchFingerprint(m: MatchRow): string {
  return [[...m.keysA].sort().join('+'), [...m.keysB].sort().join('+'), m.score1, m.score2].join('|');
}

// ── 3) 운영진 입력(content · 비공개 원본) ───────────────────────────────────────────
export interface StoryInput { playerKey: string; rank: number; text: string }
export interface FeaturedInput { matchId: string; fingerprint: string; review: string; tag: OperatorTag | null }
export interface FinalReportContent {
  schema: 1;
  opening: string;
  closing: string;
  stories: StoryInput[];
  /** null = 운영진이 고르지 않음(기본 추천 사용) · [] = 주요 경기 없이 발행. */
  featured: FeaturedInput[] | null;
}
export const EMPTY_CONTENT: FinalReportContent = { schema: 1, opening: '', closing: '', stories: [], featured: null };
export type ContentReject = 'invalid' | 'too_long' | 'html' | 'too_many' | 'duplicate' | 'tag_limit';

function cleanText(v: unknown, max: number): { ok: true; text: string } | { ok: false; reason: ContentReject } {
  if (v == null || v === '') return { ok: true, text: '' };
  const r = sanitizeOperatorText(v, max);
  if (r.ok) return { ok: true, text: r.text };
  if (r.reason === 'operator_text_empty') return { ok: true, text: '' };
  return { ok: false, reason: r.reason === 'operator_html' ? 'html' : r.reason === 'operator_text_too_long' ? 'too_long' : 'invalid' };
}

/** 저장 전 형식 검증(길이 · 꺾쇠 · 개수 · 중복). 빈 문구는 빈 상태 그대로(자동 생성 없음). */
export function parseFinalReportContent(v: unknown): { ok: true; content: FinalReportContent } | { ok: false; reason: ContentReject; field: string } {
  if (!v || typeof v !== 'object') return { ok: false, reason: 'invalid', field: 'content' };
  const o = v as Record<string, unknown>;
  const opening = cleanText(o.opening, FR_OPENING_MAX); if (!opening.ok) return { ok: false, reason: opening.reason, field: 'opening' };
  const closing = cleanText(o.closing, FR_CLOSING_MAX); if (!closing.ok) return { ok: false, reason: closing.reason, field: 'closing' };
  const stories: StoryInput[] = [];
  const rawStories = o.stories == null ? [] : o.stories;
  if (!Array.isArray(rawStories)) return { ok: false, reason: 'invalid', field: 'stories' };
  if (rawStories.length > FR_PODIUM) return { ok: false, reason: 'too_many', field: 'stories' };
  for (const s of rawStories) {
    const x = s as Record<string, unknown>;
    const key = typeof x?.playerKey === 'string' ? x.playerKey.trim().slice(0, 80) : '';
    const rank = toInt(x?.rank);
    if (!key || rank == null || rank < 1 || rank > FR_PODIUM) return { ok: false, reason: 'invalid', field: 'stories' };
    if (stories.some((y) => y.playerKey === key || y.rank === rank)) return { ok: false, reason: 'duplicate', field: 'stories' };
    const t = cleanText(x.text, FR_STORY_MAX); if (!t.ok) return { ok: false, reason: t.reason, field: `stories.${rank}` };
    if (t.text) stories.push({ playerKey: key, rank, text: t.text });
  }
  let featured: FeaturedInput[] | null = null;
  if (o.featured != null) {
    if (!Array.isArray(o.featured)) return { ok: false, reason: 'invalid', field: 'featured' };
    if (o.featured.length > FR_FEATURED_MAX) return { ok: false, reason: 'too_many', field: 'featured' };
    featured = [];
    for (const f of o.featured) {
      const x = f as Record<string, unknown>;
      const matchId = typeof x?.matchId === 'string' ? x.matchId.trim().slice(0, 80) : '';
      const fp = typeof x?.fingerprint === 'string' ? x.fingerprint.slice(0, 400) : '';
      if (!matchId || !fp) return { ok: false, reason: 'invalid', field: 'featured' };
      if (featured.some((y) => y.matchId === matchId)) return { ok: false, reason: 'duplicate', field: 'featured' };
      const tag = x.tag === 'MATCH_OF_THE_DAY' || x.tag === 'OPERATORS_PICK' ? x.tag : null;
      if (x.tag != null && tag == null) return { ok: false, reason: 'invalid', field: 'featured' };
      const t = cleanText(x.review, FR_REVIEW_MAX); if (!t.ok) return { ok: false, reason: t.reason, field: `featured.${matchId}` };
      featured.push({ matchId, fingerprint: fp, review: t.text, tag });
    }
    for (const tag of ['MATCH_OF_THE_DAY', 'OPERATORS_PICK'] as const) {
      if (featured.filter((y) => y.tag === tag).length > 1) return { ok: false, reason: 'tag_limit', field: tag };
    }
  }
  return { ok: true, content: { schema: 1, opening: opening.text, closing: closing.text, stories, featured } };
}

// ── 4) 정정 대응: 운영진 입력 ↔ 현재 공식 기록 대조(문구는 지우지 않는다) ─────────────────────
export type StoryState = 'ok' | 'rank_changed' | 'not_top3' | 'player_missing';
export type FeaturedState = 'ok' | 'match_changed' | 'match_missing';
export interface Reconciled {
  stories: Array<StoryInput & { state: StoryState; currentRank: number | null; currentName: string | null }>;
  featured: Array<FeaturedInput & { state: FeaturedState }>;
  /** 하나라도 ok 가 아니면 운영진 재확인 전까지 발행 불가. */
  needsReview: boolean;
}
export function reconcileContent(content: FinalReportContent, model: FinalReportModel): Reconciled {
  const byKey = new Map(model.standings.map((s) => [s.key, s]));
  const byMatch = new Map(model.matches.map((m) => [m.matchId, m]));
  const stories = content.stories.map((s) => {
    const cur = byKey.get(s.playerKey);
    const state: StoryState = !cur ? 'player_missing' : cur.rank > FR_PODIUM ? 'not_top3' : cur.rank !== s.rank ? 'rank_changed' : 'ok';
    return { ...s, state, currentRank: cur?.rank ?? null, currentName: cur?.name ?? null };
  });
  const featured = (content.featured ?? []).map((f) => {
    const m = byMatch.get(f.matchId);
    const state: FeaturedState = !m ? 'match_missing' : matchFingerprint(m) !== f.fingerprint ? 'match_changed' : 'ok';
    return { ...f, state };
  });
  return { stories, featured, needsReview: stories.some((s) => s.state !== 'ok') || featured.some((f) => f.state !== 'ok') };
}
/**
 * 운영진이 재확인을 마친 뒤(편집기에서 승인) 호출: 남길 항목을 현재 공식 기록에 다시 묶는다.
 *   keepStories/keepFeatured 에 없는 항목은 빠진다. 대상 선수가 TOP3 밖이거나 경기가 없어진 항목은 묶을 수 없어 빠진다.
 */
export function reanchorContent(content: FinalReportContent, model: FinalReportModel, keep: { stories: string[]; featured: string[] }): FinalReportContent {
  const byKey = new Map(model.standings.map((s) => [s.key, s]));
  const byMatch = new Map(model.matches.map((m) => [m.matchId, m]));
  const stories = content.stories.filter((s) => keep.stories.includes(s.playerKey))
    .flatMap((s) => { const cur = byKey.get(s.playerKey); return cur && cur.rank <= FR_PODIUM ? [{ ...s, rank: cur.rank }] : []; });
  const featured = content.featured == null ? null : content.featured.filter((f) => keep.featured.includes(f.matchId))
    .flatMap((f) => { const m = byMatch.get(f.matchId); return m ? [{ ...f, fingerprint: matchFingerprint(m) }] : []; });
  return { ...content, stories, featured };
}

// ── 5) 문구 검증(공개 직전) ───────────────────────────────────────────────────
export interface ContentIssue { field: string; issue: TextIssue }
/** 기존 공개 문구 검증(길이 · 꺾쇠 · 다른 선수 · 개인정보 숫자)을 그대로 재사용. */
export function validateContentTexts(content: FinalReportContent, model: FinalReportModel): ContentIssue[] {
  const out: ContentIssue[] = [];
  const byKey = new Map(model.standings.map((s) => [s.key, s]));
  const byMatch = new Map(model.matches.map((m) => [m.matchId, m]));
  const check = (field: string, text: string, own: readonly string[]) => {
    if (!text) return;
    for (const x of checkPublicText(text, own, model.allNames)) out.push({ field, issue: x });
  };
  check('opening', content.opening, model.allNames);
  check('closing', content.closing, model.allNames);
  for (const s of content.stories) {
    const cur = byKey.get(s.playerKey);
    check(`stories.${s.rank}`, s.text, cur ? [baseName(cur.name)] : []);
  }
  for (const f of content.featured ?? []) {
    const m = byMatch.get(f.matchId);
    check(`featured.${f.matchId}`, f.review, m ? [...m.teamA, ...m.teamB].map(baseName) : []);
  }
  return out;
}
export const contentIssueText = (x: ContentIssue): string => issueText(x.issue);

// ── 6) 공개 payload(allow-list) ───────────────────────────────────────────────
export interface PublicStanding { rank: number; name: string; wins: number; losses: number; diff: number; group: Group; guest: boolean }
export interface PublicPodium extends PublicStanding { story: string | null }
export interface PublicFeatured {
  round: number | null; court: number | null; group: Group;
  teamA: [string, string]; teamB: [string, string]; score1: number; score2: number;
  tags: Array<RecordTag | OperatorTag>;
  review: string | null;
}
export interface FinalReportPublicPayload {
  schema: 1;
  session: { title: string; date: string; officialConfirmed: true; participantCount: number; matchCount: number };
  opening: string | null;
  closing: string | null;
  podium: PublicPodium[];
  featured: PublicFeatured[];
  standings: PublicStanding[];
}
export type PayloadReject = 'needs_review' | 'invalid_text';

const pubStanding = (s: StandingRow): PublicStanding => ({ rank: s.rank, name: s.name, wins: s.wins, losses: s.losses, diff: s.diff, group: s.group, guest: s.guest });

export function buildFinalReportPayload(model: FinalReportModel, content: FinalReportContent):
  { ok: true; payload: FinalReportPublicPayload } | { ok: false; reason: PayloadReject; issues?: ContentIssue[]; reconciled?: Reconciled } {
  const rec = reconcileContent(content, model);
  if (rec.needsReview) return { ok: false, reason: 'needs_review', reconciled: rec };
  const issues = validateContentTexts(content, model).filter((x) => x.issue.severity === 'block');
  if (issues.length) return { ok: false, reason: 'invalid_text', issues };
  const storyByKey = new Map(content.stories.map((s) => [s.playerKey, s.text]));
  const podium = model.standings.slice(0, FR_PODIUM).map((s) => ({ ...pubStanding(s), story: storyByKey.get(s.key) || null }));
  const byMatch = new Map(model.matches.map((m) => [m.matchId, m]));
  const picks: Array<{ m: MatchRow; review: string | null; tag: OperatorTag | null }> = content.featured == null
    ? recommendFeatured(model).map((id) => ({ m: byMatch.get(id) as MatchRow, review: null, tag: null }))
    : content.featured.map((f) => ({ m: byMatch.get(f.matchId) as MatchRow, review: f.review || null, tag: f.tag }));
  const featured = picks.map(({ m, review, tag }) => ({
    round: m.round, court: m.court, group: m.group, teamA: [...m.teamA] as [string, string], teamB: [...m.teamB] as [string, string],
    score1: m.score1, score2: m.score2, tags: [...(tag ? [tag] : []), ...recordTags(m, model)], review,
  }));
  return { ok: true, payload: {
    schema: 1,
    session: { title: model.title, date: model.date, officialConfirmed: true, participantCount: model.participantCount, matchCount: model.completedMatchCount },
    opening: content.opening || null, closing: content.closing || null,
    podium, featured, standings: model.standings.map(pubStanding),
  } };
}

// ── 7) 공개 응답 파서(allow-list · P2 화면용) ─────────────────────────────────────────
const TAGS = new Set(['CLOSEST_BATTLE', 'SHUTOUT', 'MATCH_OF_THE_DAY', 'OPERATORS_PICK']);
const s = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');
const i = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const g = (v: unknown): Group => (v === 'A' || v === 'B' ? v : '');
function parseStanding(v: unknown): PublicStanding | null {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object' || i(o.rank) == null || !s(o.name, 40)) return null;
  return { rank: i(o.rank) as number, name: s(o.name, 40), wins: i(o.wins) ?? 0, losses: i(o.losses) ?? 0, diff: i(o.diff) ?? 0, group: g(o.group), guest: o.guest === true };
}
export function parsePublicFinalReport(v: unknown): FinalReportPublicPayload | null {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object' || o.schema !== 1) return null;
  const ss = o.session as Record<string, unknown>;
  if (!ss || typeof ss !== 'object') return null;
  const standings = (Array.isArray(o.standings) ? o.standings : []).slice(0, 80).map(parseStanding).filter((x): x is PublicStanding => !!x);
  if (!standings.length) return null;
  const podium = (Array.isArray(o.podium) ? o.podium : []).slice(0, FR_PODIUM).flatMap((p) => {
    const base = parseStanding(p); if (!base) return [];
    return [{ ...base, story: s((p as Record<string, unknown>).story, FR_STORY_MAX) || null }];
  });
  const featured = (Array.isArray(o.featured) ? o.featured : []).slice(0, FR_FEATURED_MAX).flatMap((f) => {
    const x = f as Record<string, unknown>;
    if (!x || typeof x !== 'object' || i(x.score1) == null || i(x.score2) == null) return [];
    const ta = Array.isArray(x.teamA) ? x.teamA : []; const tb = Array.isArray(x.teamB) ? x.teamB : [];
    return [{ round: i(x.round), court: i(x.court), group: g(x.group),
      teamA: [s(ta[0], 40), s(ta[1], 40)] as [string, string], teamB: [s(tb[0], 40), s(tb[1], 40)] as [string, string],
      score1: i(x.score1) as number, score2: i(x.score2) as number,
      tags: (Array.isArray(x.tags) ? x.tags : []).filter((t): t is RecordTag | OperatorTag => typeof t === 'string' && TAGS.has(t)),
      review: s(x.review, FR_REVIEW_MAX) || null }];
  });
  return {
    schema: 1,
    session: { title: s(ss.title, 80), date: s(ss.date, 20), officialConfirmed: true,
      participantCount: i(ss.participantCount) ?? standings.length, matchCount: i(ss.matchCount) ?? 0 },
    opening: s(o.opening, FR_OPENING_MAX) || null, closing: s(o.closing, FR_CLOSING_MAX) || null,
    podium, featured, standings,
  };
}
