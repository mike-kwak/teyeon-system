// LIVE 영상 소스 조회 (서버 전용) — YouTube 기본 · Cloudflare 백업.
//
//   순서: ① 운영진 설정(공개 RPC get_public_live_source — SQL 적용 후) → ② 서버 환경변수 → ③ 기본값.
//     ② TEYEON_YOUTUBE_LIVE_URL       : YouTube 방송 주소(또는 video ID). SQL 미적용 · 비상용.
//       TEYEON_YOUTUBE_REPLAY_URL     : 다시보기 주소(선택).
//       TEYEON_LIVE_SOURCE            : 'cloudflare' 면 Cloudflare 로 고정(선택). 그 밖엔 YouTube ID 가 있으면 YouTube.
//     ⚠ 환경변수는 공개 값(video ID)만 둔다. YouTube 스트림 키는 어디에도 두지 않는다(현장 송출 앱에만 있다).
//   선택: YOUTUBE_DATA_API_KEY(서버 전용)가 있으면 방송 상태(방송 전 · 중 · 종료)를 YouTube Data API 로 확인한다.
//     없으면 상태는 null(모름) — 플레이어는 그대로 보여 주고 YouTube 플레이어가 스스로 안내한다.
//   ⚠ 절대 throw 하지 않는다. 실패는 다음 단계 값으로 접는다. 키 · 응답 원문을 로그에 찍지 않는다.

import { assertServerOnly } from './guard';
import { callRestRpc } from './liveMatchProvider';
import { YOUTUBE_ID_RE, parseYouTubeVideoId } from '../youtube';
import type { LiveSourceInfo, LiveSourceKind, YouTubeBroadcastStatus } from '../liveTypes';

assertServerOnly('lib/tournaments/server/liveSourceProvider');

/** 운영진 전환 반영은 최대 이 TTL + 클라이언트 폴링(20초). */
const SOURCE_TTL_MS = 5_000;
/** YouTube Data API 할당량 보호 — 시청자 수와 무관하게 30초에 한 번. */
const STATUS_TTL_MS = 30_000;
const STATUS_TIMEOUT_MS = 4_000;

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && YOUTUBE_ID_RE.test(v) ? v : null);

/** 서버 환경변수 → 소스. 값이 없으면 null. */
export function sourceFromEnv(env: Record<string, string | undefined> = process.env): Omit<LiveSourceInfo, 'youtubeStatus'> | null {
  const live = (env.TEYEON_YOUTUBE_LIVE_URL ?? '').trim();
  const replay = (env.TEYEON_YOUTUBE_REPLAY_URL ?? '').trim();
  const forced = (env.TEYEON_LIVE_SOURCE ?? '').trim().toLowerCase();
  const liveId = live ? (parseYouTubeVideoId(live).ok ? (parseYouTubeVideoId(live) as { videoId: string }).videoId : null) : null;
  const replayId = replay ? (parseYouTubeVideoId(replay).ok ? (parseYouTubeVideoId(replay) as { videoId: string }).videoId : null) : null;
  if (!liveId && !replayId && forced !== 'cloudflare') return null;
  const source: LiveSourceKind = forced === 'cloudflare' ? 'cloudflare' : (liveId || replayId) ? 'youtube' : 'cloudflare';
  return { source, youtubeVideoId: liveId, youtubeReplayVideoId: replayId, origin: 'env' };
}

/** 공개 RPC 응답 → 소스. 형식이 어긋나거나 available=false 면 null. */
export function parsePublicLiveSource(raw: unknown): Omit<LiveSourceInfo, 'youtubeStatus'> | null {
  const o = rec(raw);
  if (!o || o.available !== true) return null;
  const source: LiveSourceKind = o.source === 'cloudflare' ? 'cloudflare' : 'youtube';
  return { source, youtubeVideoId: idOrNull(o.youtubeVideoId), youtubeReplayVideoId: idOrNull(o.youtubeReplayVideoId), origin: 'db' };
}

/**
 * DB 설정과 env 를 합친다.
 *   · DB 행이 있고 YouTube ID 가 있거나 Cloudflare 를 골랐으면 DB 그대로.
 *   · DB 가 '아직 아무것도 저장 안 함'(youtube · ID 없음)이면 env 값을 쓴다(비상용 env 가 묻히지 않게).
 *   · 둘 다 없으면 기본값: YouTube ID 가 없으니 Cloudflare(기존 동작) — 빈 YouTube 화면을 만들지 않는다.
 */
export function mergeLiveSource(
  db: Omit<LiveSourceInfo, 'youtubeStatus'> | null,
  env: Omit<LiveSourceInfo, 'youtubeStatus'> | null,
): Omit<LiveSourceInfo, 'youtubeStatus'> {
  if (db && (db.source === 'cloudflare' || db.youtubeVideoId || db.youtubeReplayVideoId)) return db;
  if (env) return env;
  // 쓸 수 있는 설정이 없다 — 출처는 '기본값'(운영진 설정으로 보이지 않게).
  return { source: 'cloudflare', youtubeVideoId: null, youtubeReplayVideoId: null, origin: 'default' };
}

/** YouTube Data API videos.list 응답 → 상태. 영상이 없으면 null. */
export function parseYouTubeStatus(raw: unknown): YouTubeBroadcastStatus | null {
  const items = rec(raw)?.items;
  const item = Array.isArray(items) ? rec(items[0]) : null;
  if (!item) return null;
  const content = rec(item.snippet)?.liveBroadcastContent;
  const details = rec(item.liveStreamingDetails);
  if (content === 'live') return 'live';
  if (content === 'upcoming') return 'upcoming';
  if (details && typeof details.actualEndTime === 'string') return 'ended';
  return 'none';
}

const sourceCache = new Map<string, { at: number; value: Omit<LiveSourceInfo, 'youtubeStatus'> | null }>();
const statusCache = new Map<string, { at: number; value: YouTubeBroadcastStatus | null }>();
const trim = (m: Map<string, unknown>) => { if (m.size > 20) m.delete(m.keys().next().value as string); };

async function dbSource(slug: string): Promise<Omit<LiveSourceInfo, 'youtubeStatus'> | null> {
  const now = Date.now();
  const hit = sourceCache.get(slug);
  if (hit && now - hit.at < SOURCE_TTL_MS) return hit.value;
  const r = await callRestRpc('get_public_live_source', { p_slug: slug });
  // 함수 없음(SQL 미적용) · 실패 → null → env 로.
  const value = r.ok ? parsePublicLiveSource(r.data) : null;
  sourceCache.set(slug, { at: now, value });
  trim(sourceCache);
  return value;
}

async function youtubeStatus(videoId: string): Promise<YouTubeBroadcastStatus | null> {
  const key = (process.env.YOUTUBE_DATA_API_KEY ?? '').trim();
  if (!key) return null;
  const now = Date.now();
  const hit = statusCache.get(videoId);
  if (hit && now - hit.at < STATUS_TTL_MS) return hit.value;
  let value: YouTubeBroadcastStatus | null = null;
  try {
    const q = new URLSearchParams({ part: 'snippet,liveStreamingDetails', id: videoId, key });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${q.toString()}`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS), cache: 'no-store',
    });
    if (res.ok) value = parseYouTubeStatus(await res.json().catch(() => null));
  } catch {
    value = null;
  }
  statusCache.set(videoId, { at: now, value });
  trim(statusCache);
  return value;
}

/** 이 대회의 영상 소스. 어떤 실패도 throw 하지 않는다. */
export async function getLiveSource(slug: string): Promise<LiveSourceInfo> {
  const base = mergeLiveSource(slug ? await dbSource(slug) : null, sourceFromEnv());
  const status = base.source === 'youtube' && base.youtubeVideoId ? await youtubeStatus(base.youtubeVideoId) : null;
  return { ...base, youtubeStatus: status };
}
