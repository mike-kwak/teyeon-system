// LIVE 영상 소스 · YouTube 방송 주소 — 관리자(CEO · ADMIN) 전용 클라이언트 service.
//
//   ⚠ 부르는 RPC 는 둘뿐이다: get_admin_live_source(조회) · set_live_source(저장). 권한 · 형식 · 버전 충돌은 SQL 이 판정한다.
//   ⚠ 저장하는 값은 공개 시청 식별자(video ID)와 소스 선택뿐이다. 스트림 키는 받지도 저장하지도 않는다.
//   ⚠ SQL(add_hosted_tournament_live_source.sql)이 아직 적용되지 않았으면 'unavailable' — 화면은 안내만 하고,
//     시청자 화면은 서버 환경변수(TEYEON_YOUTUBE_LIVE_URL)를 쓴다.

import { supabase } from '@/lib/supabase';
import { YOUTUBE_ID_RE } from './youtube';
import type { LiveSourceKind } from './liveTypes';

export interface LiveSourceAdminState {
  source: LiveSourceKind;
  youtubeVideoId: string | null;
  youtubeReplayVideoId: string | null;
  /** 행이 없으면 0(첫 저장의 기대 버전). */
  version: number;
  updatedAt: string | null;
}

export type LiveSourceLoad =
  | { kind: 'ok'; state: LiveSourceAdminState }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

export type LiveSourceSave =
  | { kind: 'ok'; changed: boolean; version: number }
  | { kind: 'rejected'; reason: string }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && YOUTUBE_ID_RE.test(v) ? v : null);
const errCode = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? '');
const isMissing = (e: unknown): boolean => {
  const code = errCode(e);
  const msg = String((e as { message?: unknown } | null)?.message ?? '');
  return code === 'PGRST202' || code === '42883' || (/live_source/.test(msg) && /Could not find|does not exist|schema cache/.test(msg));
};

export function parseLiveSourceAdmin(raw: unknown): LiveSourceAdminState | null {
  const o = rec(raw);
  if (!o) return null;
  const version = typeof o.version === 'number' && Number.isInteger(o.version) && o.version >= 0 ? o.version : null;
  if (version === null) return null;
  return {
    source: o.source === 'cloudflare' ? 'cloudflare' : 'youtube',
    youtubeVideoId: idOrNull(o.youtubeVideoId),
    youtubeReplayVideoId: idOrNull(o.youtubeReplayVideoId),
    version,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
  };
}

export async function fetchLiveSourceAdmin(slug: string): Promise<LiveSourceLoad> {
  try {
    const { data, error } = await supabase.rpc('get_admin_live_source', { p_slug: slug });
    if (error) return isMissing(error) ? { kind: 'unavailable' } : errCode(error) === '42501' ? { kind: 'forbidden' } : { kind: 'error' };
    if (data === null || data === undefined) return { kind: 'forbidden' };
    const state = parseLiveSourceAdmin(data);
    return state ? { kind: 'ok', state } : { kind: 'unavailable' };
  } catch {
    return { kind: 'error' };
  }
}

export async function saveLiveSource(
  slug: string,
  v: { source: LiveSourceKind; youtubeVideoId: string | null; youtubeReplayVideoId: string | null; expectedVersion: number },
): Promise<LiveSourceSave> {
  try {
    const { data, error } = await supabase.rpc('set_live_source', {
      p_slug: slug, p_source: v.source, p_youtube_video_id: v.youtubeVideoId,
      p_youtube_replay_video_id: v.youtubeReplayVideoId, p_expected_version: v.expectedVersion,
    });
    if (error) return isMissing(error) ? { kind: 'unavailable' } : errCode(error) === '42501' ? { kind: 'forbidden' } : { kind: 'error' };
    const o = rec(data);
    if (o?.ok === true) return { kind: 'ok', changed: o.changed === true, version: typeof o.version === 'number' ? o.version : v.expectedVersion };
    return { kind: 'rejected', reason: typeof o?.reason === 'string' ? o.reason : 'unknown' };
  } catch {
    return { kind: 'error' };
  }
}

export const LIVE_SOURCE_REJECT_TEXT: Record<string, string> = {
  stale_version: '다른 운영진이 먼저 바꿨습니다. 최신 설정을 다시 불러왔으니 확인 후 다시 저장해 주세요.',
  invalid_video_id: 'YouTube 영상 ID 형식이 올바르지 않습니다.',
  invalid_source: '알 수 없는 영상 소스입니다.',
  tournament_not_found: '대회를 찾을 수 없습니다.',
};
