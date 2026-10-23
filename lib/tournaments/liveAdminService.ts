// LIVE 중계 경기 지정 — 관리자(CEO · ADMIN) 전용 클라이언트 service.
//
//   ⚠ 이 파일이 부르는 RPC 는 둘뿐이다: get_admin_live_state(조회) · set_live_match(저장).
//     권한 · 경기 유효성(같은 대회 · 대기/호명/진행 중) · 버전 충돌은 전부 SQL 이 판정한다. 여기서 흉내 내지 않는다.
//   ⚠ 영상 송출(Cloudflare)과 무관하다. 저장이 실패해도 방송은 그대로다.
//   ⚠ 고정 후보 목록은 기존 관리자 조회(get_admin_match_board · get_admin_bracket) 결과에서 고른다.
//     선수 이름을 입력받지 않는다.

import { supabase } from '@/lib/supabase';
import { parseLiveMatchInfo } from './liveMatch';
import type { LiveMatchInfo } from './liveTypes';
import type { MatchStatus, TournamentMatch } from './matchTypes';

export type LiveAdminMode = 'auto' | 'manual' | 'none';

export interface LiveAdminState {
  mode: LiveAdminMode;
  version: number;
  featureCourt: { courtNo: number; courtName: string | null } | null;
  manualMatchId: string | null;
  /** 수동 고정했던 경기가 사라짐(본선 대기 경기 삭제 등) — 시청자 화면에는 경기 정보가 없다. */
  manualMissing: boolean;
  /** LIVE 지정 코트에서 지금 진행 중인 경기(자동 모드가 보여 줄 경기). */
  autoMatchId: string | null;
  onAirMatchId: string | null;
  /** 지금 시청자 화면에 보일 경기(관리자 확인용 — DRAW 비공개여도 채워진다). */
  onAir: LiveMatchInfo | null;
  /** 시청자 화면에 실제로 선수 정보가 나가는가(DRAW 공개 조건). */
  onAirPublic: boolean;
}

export type LiveAdminLoad =
  | { kind: 'ok'; state: LiveAdminState }
  | { kind: 'forbidden' }
  /** LIVE 중계 SQL 이 아직 적용되지 않았거나 응답 형식이 다름 — 화면은 안내만 한다. */
  | { kind: 'unavailable' }
  | { kind: 'error' };

export type LiveAdminSave =
  | { kind: 'ok'; changed: boolean; version: number }
  | { kind: 'rejected'; reason: string }
  | { kind: 'forbidden' }
  | { kind: 'error' };

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const intOr = (v: unknown, d: number | null): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : d;
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const errCode = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? '');
const isMissing = (e: unknown): boolean => {
  const code = errCode(e);
  const msg = String((e as { message?: unknown } | null)?.message ?? '');
  return code === 'PGRST202' || code === '42883' || /get_admin_live_state|set_live_match/.test(msg) && /Could not find|does not exist|schema cache/.test(msg);
};

/** RPC 응답 → 상태. 형식이 어긋나면 null(= unavailable). */
export function parseLiveAdminState(raw: unknown): LiveAdminState | null {
  const o = rec(raw);
  if (!o || o.ok !== true) return null;
  const mode = o.mode === 'auto' || o.mode === 'manual' || o.mode === 'none' ? o.mode : null;
  const version = intOr(o.version, null);
  if (!mode || version === null) return null;
  const fc = rec(o.featureCourt);
  const fcNo = fc ? intOr(fc.courtNo, null) : null;
  return {
    mode,
    version,
    featureCourt: fcNo !== null ? { courtNo: fcNo, courtName: strOrNull(fc!.courtName) } : null,
    manualMatchId: strOrNull(o.manualMatchId),
    manualMissing: o.manualMissing === true,
    autoMatchId: strOrNull(o.autoMatchId),
    onAirMatchId: strOrNull(o.onAirMatchId),
    onAir: parseLiveMatchInfo(o.onAir),
    onAirPublic: o.onAirPublic === true,
  };
}

export async function fetchLiveAdminState(slug: string): Promise<LiveAdminLoad> {
  try {
    const { data, error } = await supabase.rpc('get_admin_live_state', { p_slug: slug });
    if (error) {
      if (errCode(error) === '42501') return { kind: 'forbidden' };
      if (isMissing(error)) return { kind: 'unavailable' };
      return { kind: 'error' };
    }
    const state = parseLiveAdminState(data);
    return state ? { kind: 'ok', state } : { kind: 'unavailable' };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * 중계 경기 지정. manual 일 때만 matchId 를 보낸다.
 *   expectedVersion — 화면이 마지막으로 본 버전. 다른 관리자가 먼저 바꿨으면 SQL 이 stale_version 으로 거부한다.
 */
export async function saveLiveMatch(
  slug: string,
  mode: LiveAdminMode,
  matchId: string | null,
  expectedVersion: number,
): Promise<LiveAdminSave> {
  try {
    const { data, error } = await supabase.rpc('set_live_match', {
      p_slug: slug,
      p_mode: mode,
      p_match_id: mode === 'manual' ? matchId : null,
      p_expected_version: expectedVersion,
    });
    if (error) return errCode(error) === '42501' ? { kind: 'forbidden' } : { kind: 'error' };
    const o = rec(data);
    if (!o) return { kind: 'error' };
    if (o.ok === true) return { kind: 'ok', changed: o.changed === true, version: intOr(o.version, expectedVersion) ?? expectedVersion };
    return { kind: 'rejected', reason: strOrNull(o.reason) ?? 'unknown' };
  } catch {
    return { kind: 'error' };
  }
}

// ── 고정 후보 ──────────────────────────────────────────────────────────────────

/** SQL(set_live_match)이 받는 상태와 같다 — 완료 · 취소 경기는 후보가 아니다. */
export const LIVE_PINNABLE_STATUSES: readonly MatchStatus[] = ['waiting', 'calling', 'playing'];

export interface LivePinCandidate {
  matchId: string;
  matchNo: number;
  stageLabel: string;
  status: MatchStatus;
  courtNo: number | null;
  team1: string;
  team2: string;
}

const STATUS_ORDER: Record<string, number> = { playing: 0, calling: 1, waiting: 2 };

/** 기존 경기 목록 → 고정 후보(진행 중 → 호명 → 대기, 같은 상태는 경기 번호 순). */
export function buildPinCandidates(
  matches: readonly TournamentMatch[],
  roundNames: ReadonlyMap<number, string>,
): LivePinCandidate[] {
  return matches
    .filter((m) => LIVE_PINNABLE_STATUSES.includes(m.status))
    .map((m) => ({
      matchId: m.matchId,
      matchNo: m.matchNo,
      stageLabel: m.stage === 'knockout'
        ? (roundNames.get(m.matchNo) ?? '본선')
        : m.stage === 'placement' || m.groupType === 'placement'
          ? `순위결정전 ${m.groupNo ?? ''}`.trim()
          : `예선 ${m.groupNo ?? ''}조`,
      status: m.status,
      courtNo: m.courtNo,
      team1: `${m.team1.player1Name} · ${m.team1.player2Name}`,
      team2: `${m.team2.player1Name} · ${m.team2.player2Name}`,
    }))
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (a.matchNo - b.matchNo));
}

/** 검색어(선수 이름 · 경기 번호 · 단계)로 후보를 좁힌다. 공백은 무시한다. */
export function filterPinCandidates(list: readonly LivePinCandidate[], query: string): LivePinCandidate[] {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return [...list];
  return list.filter((c) => {
    const hay = `${c.matchNo}경기${c.stageLabel}${c.team1}${c.team2}`.replace(/\s+/g, '').toLowerCase();
    return hay.includes(q) || String(c.matchNo) === q;
  });
}

/**
 * 고정하려는 경기가 LIVE 지정 코트 밖이면 경고한다(영상과 선수 정보가 다를 수 있음).
 *   진행 중이 아니면 코트를 알 수 없으므로 역시 경고한다.
 */
export function pinCourtWarning(c: LivePinCandidate, featureCourtNo: number | null): string | null {
  if (featureCourtNo === null) return 'LIVE 지정 코트가 없습니다. 카메라가 이 경기를 비추고 있는지 확인하세요.';
  if (c.status !== 'playing' || c.courtNo === null) {
    return `아직 코트에 투입되지 않은 경기입니다. LIVE 코트(${featureCourtNo}번)의 실제 영상과 선수 정보가 다를 수 있습니다.`;
  }
  if (c.courtNo !== featureCourtNo) {
    return `${c.courtNo}번 코트 경기입니다. LIVE 코트(${featureCourtNo}번)의 실제 영상과 선수 정보가 다를 수 있습니다.`;
  }
  return null;
}

/** 저장 거부 사유 → 안내 문구. */
export function liveSaveMessage(reason: string): string {
  switch (reason) {
    case 'stale_version': return '다른 관리자가 먼저 바꿨습니다. 최신 상태를 불러왔으니 확인 후 다시 저장하세요.';
    case 'match_not_found': return '경기를 찾을 수 없습니다(삭제되었거나 다른 대회 경기). 목록을 새로 불러왔습니다.';
    case 'match_not_live': return '완료되었거나 취소된 경기는 고정할 수 없습니다. 목록을 새로 불러왔습니다.';
    case 'tournament_not_found': return '대회를 찾을 수 없습니다.';
    case 'invalid_mode':
    case 'invalid_match': return '요청 형식이 올바르지 않습니다. 화면을 새로 고친 뒤 다시 시도하세요.';
    default: return '저장하지 못했습니다. 잠시 후 다시 시도하세요.';
  }
}

// ── 녹화 ↔ 경기 구간(다시보기) 관리 ─────────────────────────────────────────────

export type LiveClipStatus = 'draft' | 'confirmed' | 'hidden';

export interface LiveAdminClip {
  id: string;
  videoUid: string;
  recordingStartedAt: string;
  recordingDurationSec: number;
  autoStartSec: number;
  autoEndSec: number;
  adjustedStartSec: number | null;
  adjustedEndSec: number | null;
  status: LiveClipStatus;
  version: number;
}

export interface LiveAdminSegment {
  id: string;
  source: 'auto' | 'manual' | 'none';
  /** 구간 시작 당시 경기 정보 스냅샷(경기가 지워져도 남는다). 'none' 이면 null. */
  match: LiveMatchInfo | null;
  /** 원래 경기가 대진에서 사라졌는지(스냅샷만 남음). */
  matchMissing: boolean;
  startedAt: string;
  endedAt: string | null;
  clips: LiveAdminClip[];
}

export interface LiveRecordingSummary { uid: string; startedAt: string; durationSec: number }

export interface LiveSyncResult {
  autoSegments: number | null;
  clipsWritten: number | null;
  clipsRemoved: number | null;
  clipsNeedReview: number | null;
  recordingsBeforeLinking: number | null;
  linkingStartedAt: string | null;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function parseClip(raw: unknown): LiveAdminClip | null {
  const o = rec(raw);
  if (!o) return null;
  const id = strOrNull(o.id);
  const videoUid = strOrNull(o.videoUid);
  const at = strOrNull(o.recordingStartedAt);
  const dur = numOrNull(o.recordingDurationSec);
  const as = numOrNull(o.autoStartSec);
  const ae = numOrNull(o.autoEndSec);
  const version = intOr(o.version, null);
  const status = o.status === 'draft' || o.status === 'confirmed' || o.status === 'hidden' ? o.status : null;
  if (!id || !videoUid || !at || dur === null || as === null || ae === null || version === null || !status) return null;
  return {
    id, videoUid, recordingStartedAt: at, recordingDurationSec: dur, autoStartSec: as, autoEndSec: ae,
    adjustedStartSec: numOrNull(o.adjustedStartSec), adjustedEndSec: numOrNull(o.adjustedEndSec), status, version,
  };
}

/** get_admin_live_clips 응답 → 구간 목록. 형식이 어긋나면 null. */
export function parseLiveAdminSegments(raw: unknown): LiveAdminSegment[] | null {
  const o = rec(raw);
  if (!o || o.ok !== true || !Array.isArray(o.segments)) return null;
  const out: LiveAdminSegment[] = [];
  for (const s of o.segments) {
    const x = rec(s);
    if (!x) continue;
    const id = strOrNull(x.id);
    const startedAt = strOrNull(x.startedAt);
    const source = x.source === 'auto' || x.source === 'manual' || x.source === 'none' ? x.source : null;
    if (!id || !startedAt || !source) continue;
    out.push({
      id,
      source,
      match: parseLiveMatchInfo(x.match),
      matchMissing: source !== 'none' && !strOrNull(x.matchId),
      startedAt,
      endedAt: strOrNull(x.endedAt),
      clips: (Array.isArray(x.clips) ? x.clips : []).map(parseClip).filter((c): c is LiveAdminClip => c !== null),
    });
  }
  return out;
}

export type LiveClipsLoad =
  | { kind: 'ok'; segments: LiveAdminSegment[] }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

export async function fetchLiveClips(slug: string): Promise<LiveClipsLoad> {
  try {
    const { data, error } = await supabase.rpc('get_admin_live_clips', { p_slug: slug });
    if (error) {
      if (errCode(error) === '42501') return { kind: 'forbidden' };
      if (isMissing(error) || /get_admin_live_clips/.test(String((error as { message?: unknown }).message ?? ''))) return { kind: 'unavailable' };
      return { kind: 'error' };
    }
    const segments = parseLiveAdminSegments(data);
    return segments ? { kind: 'ok', segments } : { kind: 'unavailable' };
  } catch {
    return { kind: 'error' };
  }
}

async function clipRpc(fn: 'adjust_live_clip' | 'set_live_clip_status', args: Record<string, unknown>, expectedVersion: number): Promise<LiveAdminSave> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return errCode(error) === '42501' ? { kind: 'forbidden' } : { kind: 'error' };
    const o = rec(data);
    if (!o) return { kind: 'error' };
    if (o.ok === true) return { kind: 'ok', changed: true, version: intOr(o.version, expectedVersion) ?? expectedVersion };
    return { kind: 'rejected', reason: strOrNull(o.reason) ?? 'unknown' };
  } catch {
    return { kind: 'error' };
  }
}

/** 구간 보정 — 둘 다 null 이면 자동 계산값으로 되돌린다. 범위 · 버전은 SQL 이 판정한다. */
export function adjustLiveClip(clipId: string, startSec: number | null, endSec: number | null, expectedVersion: number): Promise<LiveAdminSave> {
  return clipRpc('adjust_live_clip', { p_clip_id: clipId, p_start_sec: startSec, p_end_sec: endSec, p_expected_version: expectedVersion }, expectedVersion);
}

/** 공개 상태 — confirmed(공개) · draft(미확정) · hidden(숨김). */
export function setLiveClipStatus(clipId: string, status: LiveClipStatus, expectedVersion: number): Promise<LiveAdminSave> {
  return clipRpc('set_live_clip_status', { p_clip_id: clipId, p_status: status, p_expected_version: expectedVersion }, expectedVersion);
}

export type LiveSyncOutcome =
  | { kind: 'ok'; sync: LiveSyncResult; recordings: LiveRecordingSummary[] }
  | { kind: 'rejected'; reason: string }
  | { kind: 'forbidden' }
  | { kind: 'error' };

/** Cloudflare 녹화를 불러와 경기 구간과 연결(서버 route — 본인 로그인 토큰을 넘긴다). */
export async function syncLiveRecordings(slug: string): Promise<LiveSyncOutcome> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { kind: 'forbidden' };
    const res = await fetch(`/api/tournaments/${encodeURIComponent(slug)}/live/recordings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const body = rec(await res.json().catch(() => null));
    if (res.status === 401 || res.status === 403) return { kind: 'forbidden' };
    if (!body) return { kind: 'error' };
    if (body.ok !== true) return res.ok ? { kind: 'rejected', reason: strOrNull(body.reason) ?? 'unknown' } : { kind: 'error' };
    const s = rec(body.sync) ?? {};
    const recordings: LiveRecordingSummary[] = (Array.isArray(body.recordings) ? body.recordings : [])
      .map((r) => rec(r))
      .filter((r): r is Record<string, unknown> =>
        !!r && typeof r.uid === 'string' && typeof r.startedAt === 'string' && typeof r.durationSec === 'number')
      .map((r) => ({ uid: r.uid as string, startedAt: r.startedAt as string, durationSec: r.durationSec as number }));
    return {
      kind: 'ok',
      recordings,
      sync: {
        autoSegments: numOrNull(s.autoSegments),
        clipsWritten: numOrNull(s.clipsWritten),
        clipsRemoved: numOrNull(s.clipsRemoved),
        clipsNeedReview: numOrNull(s.clipsNeedReview),
        recordingsBeforeLinking: numOrNull(s.recordingsBeforeLinking),
        linkingStartedAt: strOrNull(s.linkingStartedAt),
      },
    };
  } catch {
    return { kind: 'error' };
  }
}

/** 녹화 연결 · 보정 · 공개 거부 사유 → 안내 문구. */
export function liveClipMessage(reason: string): string {
  switch (reason) {
    case 'stale_version': return '다른 관리자가 먼저 바꿨습니다. 최신 목록을 불러왔으니 확인 후 다시 저장하세요.';
    case 'invalid_range': return '구간이 올바르지 않습니다. 시작 < 끝, 녹화 길이 안이어야 합니다.';
    case 'clip_not_found': return '구간을 찾을 수 없습니다(다시 연결되며 지워졌을 수 있음). 목록을 새로 불러왔습니다.';
    case 'stream_not_configured': return 'Cloudflare 설정이 없어 녹화를 불러올 수 없습니다.';
    case 'live_sql_not_applied': return 'LIVE 중계 SQL 이 아직 적용되지 않았습니다.';
    case 'invalid_recordings': return '녹화 목록 형식이 올바르지 않습니다.';
    default: return '처리하지 못했습니다. 잠시 후 다시 시도하세요.';
  }
}

/** 공개 재생에 쓰이는 구간(보정값이 있으면 보정값). */
export const clipEffectiveStart = (c: LiveAdminClip): number => c.adjustedStartSec ?? c.autoStartSec;
export const clipEffectiveEnd = (c: LiveAdminClip): number => c.adjustedEndSec ?? c.autoEndSec;

export interface LiveRecordingGroupRow { clip: LiveAdminClip; segment: LiveAdminSegment }
export interface LiveRecordingGroup { uid: string; startedAt: string; durationSec: number; rows: LiveRecordingGroupRow[] }

/** 구간 목록 + 마지막 연결의 녹화 목록 → 녹화별 묶음(최신 녹화 먼저, 녹화 안에서는 공개 시작 초 순). */
export function groupByRecording(segments: LiveAdminSegment[], recordings: LiveRecordingSummary[]): LiveRecordingGroup[] {
  const m = new Map<string, LiveRecordingGroup>();
  for (const r of recordings) m.set(r.uid, { uid: r.uid, startedAt: r.startedAt, durationSec: r.durationSec, rows: [] });
  for (const segment of segments) {
    for (const clip of segment.clips) {
      const g = m.get(clip.videoUid) ?? { uid: clip.videoUid, startedAt: clip.recordingStartedAt, durationSec: clip.recordingDurationSec, rows: [] };
      g.rows.push({ clip, segment });
      m.set(clip.videoUid, g);
    }
  }
  const out = [...m.values()];
  out.forEach((g) => g.rows.sort((a, b) => clipEffectiveStart(a.clip) - clipEffectiveStart(b.clip)));
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
