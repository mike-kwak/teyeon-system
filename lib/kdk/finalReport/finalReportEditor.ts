// TEYEON KDK FINAL REPORT — 운영진 편집기 데이터(P3 · 순수 함수 · 서버 핸들러와 편집 화면이 함께 쓴다).
//   서버: 공식 Archive 투영 → buildFinalReportModel → toEditorData(편집 화면용 읽기 전용 기록).
//   화면: 편집 중 문구가 현재 기록과 맞게 연결되어 있는지 reconcileEditor 로 즉시 표시(발행 여부는 서버가 다시 판정).
//   ⚠ 순위 · 승패 · 점수는 서버 모델 그대로 보여 주기만 한다(재계산 · 재정렬 없음).

import {
  FR_CLOSING_MAX, FR_FEATURED_MAX, FR_HEADLINE_MAX, FR_OPENING_MAX, FR_PODIUM, FR_REVIEW_MAX, FR_STORY_MAX,
  matchFingerprint, recordTags,
  type FinalReportContent, type FinalReportModel, type FeaturedState, type Group, type OperatorTag, type RecordTag, type StoryState,
} from './finalReportModel';
import {
  buildFinalReportStory, matchNote, reviewSuggestion, storySuggestion,
  type Badge, type CandidateReason, type HeadlineCandidate,
} from './finalReportStory';

export const FR_LIMITS = { headline: FR_HEADLINE_MAX, opening: FR_OPENING_MAX, story: FR_STORY_MAX, review: FR_REVIEW_MAX, closing: FR_CLOSING_MAX, featured: FR_FEATURED_MAX } as const;

/** v2 편집 보조(읽기 전용 · 서버 계산): 헤드라인 후보 · TOP3 기록 요약 · 제안 문구 · 경기 한 줄 기록. */
export interface EditorStory {
  headlines: HeadlineCandidate[];
  /** 운영진이 헤드라인을 비우면 공개본에 들어갈 자동 헤드라인(= headlines[0]). */
  autoHeadline: string;
  podium: Array<{ key: string; rank: number; summary: string; badges: Badge[]; suggestion: string; consistent: boolean }>;
  matches: Record<string, { note: string | null; reasons: CandidateReason[]; suggestion: string }>;
}

export interface EditorStanding { key: string; rank: number; name: string; wins: number; losses: number; diff: number; group: Group; guest: boolean }
export interface EditorMatch {
  matchId: string; round: number | null; court: number | null; group: Group;
  teamA: [string, string]; teamB: [string, string]; score1: number; score2: number;
  fingerprint: string; tags: RecordTag[];
}
export interface EditorReport {
  status: 'draft' | 'published' | 'unpublished';
  publicSlug: string; revision: number; updatedAt: string | null; publishedAt: string | null;
  /** 발행본이 현재 공식 기록과 다름(정정됨) — 공개 화면은 corrected 상태. */
  stale: boolean;
}
export interface EditorData {
  session: { id: string; title: string; date: string; participantCount: number; matchCount: number };
  standings: EditorStanding[];
  matches: EditorMatch[];
  recommended: string[];
  story: EditorStory;
  /** 불러온 시점의 공식 기록 지문 — 발행 요청에 그대로 돌려보내 그 사이 정정 여부를 서버가 판정. */
  signature: string;
  report: EditorReport | null;
  content: FinalReportContent;
  /** 저장된 문구 형식이 현재 규칙과 맞지 않아 빈 문구로 시작했는지. */
  contentReset: boolean;
}

export function toEditorData(model: FinalReportModel, extra: { id: string; signature: string; report: EditorReport | null; content: FinalReportContent; contentReset: boolean }): EditorData {
  const st = buildFinalReportStory(model);
  const podiumKeys = new Set(model.standings.slice(0, FR_PODIUM).map((s) => s.key));
  const reasons = new Map(st.candidates.map((c) => [c.matchId, c.reasons]));
  const story: EditorStory = {
    headlines: st.headlines, autoHeadline: st.headline,
    podium: st.podium.map((r, i) => ({ key: model.standings[i].key, rank: r.rank, summary: r.summary, badges: r.badges, suggestion: storySuggestion(r), consistent: r.consistent })),
    matches: Object.fromEntries(model.matches.map((m) => [m.matchId, {
      note: matchNote(m, podiumKeys), reasons: reasons.get(m.matchId) ?? [], suggestion: reviewSuggestion(m, podiumKeys, FR_REVIEW_MAX),
    }])),
  };
  return {
    session: { id: extra.id, title: model.title, date: model.date, participantCount: model.participantCount, matchCount: model.completedMatchCount },
    standings: model.standings.map((s) => ({ key: s.key, rank: s.rank, name: s.name, wins: s.wins, losses: s.losses, diff: s.diff, group: s.group, guest: s.guest })),
    matches: model.matches.map((m) => ({
      matchId: m.matchId, round: m.round, court: m.court, group: m.group, teamA: [...m.teamA] as [string, string], teamB: [...m.teamB] as [string, string],
      score1: m.score1, score2: m.score2, fingerprint: matchFingerprint(m), tags: recordTags(m, model),
    })),
    // 자동 추천 = 공개본 자동 모드와 같은 v2 기록 기준 후보.
    recommended: st.candidates.map((c) => c.matchId),
    story,
    signature: extra.signature,
    report: extra.report,
    content: extra.content,
    contentReset: extra.contentReset,
  };
}

// ── 편집 화면용 연결 확인(서버 reconcileContent 와 같은 규칙) ─────────────────────────────
export interface EditorReconcile {
  stories: Array<{ playerKey: string; savedRank: number; state: StoryState; currentRank: number | null; name: string | null }>;
  featured: Array<{ matchId: string; state: FeaturedState }>;
  needsReview: boolean;
}
export function reconcileEditor(content: FinalReportContent, data: Pick<EditorData, 'standings' | 'matches'>): EditorReconcile {
  const byKey = new Map(data.standings.map((s) => [s.key, s]));
  const byMatch = new Map(data.matches.map((m) => [m.matchId, m]));
  const stories = content.stories.map((s) => {
    const cur = byKey.get(s.playerKey);
    const state: StoryState = !cur ? 'player_missing' : cur.rank > FR_PODIUM ? 'not_top3' : cur.rank !== s.rank ? 'rank_changed' : 'ok';
    return { playerKey: s.playerKey, savedRank: s.rank, state, currentRank: cur?.rank ?? null, name: cur?.name ?? null };
  });
  const featured = (content.featured ?? []).map((f) => {
    const m = byMatch.get(f.matchId);
    return { matchId: f.matchId, state: (!m ? 'match_missing' : m.fingerprint !== f.fingerprint ? 'match_changed' : 'ok') as FeaturedState };
  });
  return { stories, featured, needsReview: stories.some((s) => s.state !== 'ok') || featured.some((f) => f.state !== 'ok') };
}

// ── 편집 동작(불변 갱신) ─────────────────────────────────────────────────────────
/** TOP3 스토리 입력: 현재 공식 순위(rank)와 선수 키로 연결. 빈 문구는 항목을 지운다. */
export function setStory(content: FinalReportContent, s: Pick<EditorStanding, 'key' | 'rank'>, text: string): FinalReportContent {
  const rest = content.stories.filter((x) => x.playerKey !== s.key && x.rank !== s.rank);
  const t = text.slice(0, FR_STORY_MAX);
  return { ...content, stories: t.trim() ? [...rest, { playerKey: s.key, rank: s.rank, text: t }].sort((a, b) => a.rank - b.rank) : rest };
}
export function storyText(content: FinalReportContent, key: string): string {
  return content.stories.find((x) => x.playerKey === key)?.text ?? '';
}
/** 주요 경기 선택 전환. featured=null(자동 추천)이면 추천 목록에서 시작해 직접 선택으로 바꾼다. */
export function toggleFeatured(content: FinalReportContent, data: Pick<EditorData, 'matches' | 'recommended'>, matchId: string): { content: FinalReportContent; limited: boolean } {
  const base = content.featured ?? data.recommended.map((id) => ({ matchId: id, fingerprint: data.matches.find((m) => m.matchId === id)?.fingerprint ?? '', review: '', tag: null }));
  if (base.some((f) => f.matchId === matchId)) return { content: { ...content, featured: base.filter((f) => f.matchId !== matchId) }, limited: false };
  if (base.length >= FR_FEATURED_MAX) return { content: { ...content, featured: base }, limited: true };
  const m = data.matches.find((x) => x.matchId === matchId);
  if (!m) return { content, limited: false };
  return { content: { ...content, featured: [...base, { matchId, fingerprint: m.fingerprint, review: '', tag: null }] }, limited: false };
}
export function setReview(content: FinalReportContent, matchId: string, review: string): FinalReportContent {
  if (!content.featured) return content;
  return { ...content, featured: content.featured.map((f) => (f.matchId === matchId ? { ...f, review: review.slice(0, FR_REVIEW_MAX) } : f)) };
}
/** 운영진 태그는 경기당 1개, 같은 태그는 리포트 전체에 1개(다른 경기의 같은 태그는 해제). */
export function setOperatorTag(content: FinalReportContent, matchId: string, tag: OperatorTag | null): FinalReportContent {
  if (!content.featured) return content;
  return { ...content, featured: content.featured.map((f) => (f.matchId === matchId ? { ...f, tag } : tag && f.tag === tag ? { ...f, tag: null } : f)) };
}

/**
 * 운영진 재확인: 다시 연결할 수 있는 항목(순위만 바뀐 TOP3 스토리 · 같은 id 의 경기)을 현재 공식 기록에 다시 묶는다.
 *   TOP3 밖 · 사라진 선수/경기는 묶을 수 없으므로 그대로 두고(운영진이 직접 빼야 함) 결과의 blocked 로 알린다.
 *   문구는 지우거나 바꾸지 않는다. 서버가 발행 때 같은 규칙으로 다시 확인한다.
 */
export function reanchorEditor(content: FinalReportContent, data: Pick<EditorData, 'standings' | 'matches'>): { content: FinalReportContent; blocked: number } {
  const byKey = new Map(data.standings.map((s) => [s.key, s]));
  const byMatch = new Map(data.matches.map((m) => [m.matchId, m]));
  let blocked = 0;
  const stories = content.stories.map((s) => {
    const cur = byKey.get(s.playerKey);
    if (!cur || cur.rank > FR_PODIUM) { blocked += 1; return s; }
    return { ...s, rank: cur.rank };
  }).sort((a, b) => a.rank - b.rank);
  const featured = content.featured == null ? null : content.featured.map((f) => {
    const m = byMatch.get(f.matchId);
    if (!m) { blocked += 1; return f; }
    return { ...f, fingerprint: m.fingerprint };
  });
  return { content: { ...content, stories, featured }, blocked };
}
export function removeStory(content: FinalReportContent, key: string): FinalReportContent {
  return { ...content, stories: content.stories.filter((s) => s.playerKey !== key) };
}
export function removeFeatured(content: FinalReportContent, matchId: string): FinalReportContent {
  return content.featured == null ? content : { ...content, featured: content.featured.filter((f) => f.matchId !== matchId) };
}
/** 저장 · 비교용 정규형(빈 스토리 제거 · 순서 고정). */
export function contentKey(c: FinalReportContent): string {
  return JSON.stringify({
    h: (c.headline ?? '').trim(),
    o: c.opening.trim(), c: c.closing.trim(), ct: (c.closingTitle ?? '').trim(),
    s: c.stories.filter((s) => s.text.trim()).map((s) => [s.playerKey, s.rank, s.text.trim()]).sort(),
    f: c.featured == null ? null : c.featured.map((f) => [f.matchId, f.fingerprint, f.review.trim(), f.tag]),
  });
}

export const STORY_STATE_TEXT: Record<StoryState, string> = {
  ok: '연결됨',
  rank_changed: '공식 순위가 바뀌었습니다',
  not_top3: '이 선수가 TOP3 밖으로 바뀌었습니다',
  player_missing: '공식 기록에서 이 선수를 찾을 수 없습니다',
};
export const FEATURED_STATE_TEXT: Record<FeaturedState, string> = {
  ok: '연결됨',
  match_changed: '경기 기록(선수 · 점수)이 바뀌었습니다',
  match_missing: '공식 기록에서 이 경기를 찾을 수 없습니다',
};

export const EMPTY_EPOCH = '1970-01-01T00:00:00Z';
