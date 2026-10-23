// LIVE Streaming Provider 어댑터 — Cloudflare Stream (서버 전용).
//
//   ⚠ 이 모듈은 브라우저에서 import 할 수 없다. CLOUDFLARE_STREAM_API_TOKEN 은
//     NEXT_PUBLIC_ 접두어가 없으므로 클라이언트 번들에서 값 자체가 사라지지만,
//     그 위에 assertServerOnly 가드를 하나 더 둔다(registrationSubmitClient 와 같은 방식).
//
//   ⚠ 이 파일 밖으로 절대 내보내지 않는 값
//       · API Token
//       · rtmps.streamKey       (송출 키 — 유출되면 누구나 우리 채널로 송출할 수 있다)
//       · srt.streamId / srt.passphrase
//       · webRTC url
//     아래 buildSnapshot 은 응답 객체를 spread 하지 않고 필요한 필드만 '직접 골라' 담는다.
//     Provider 응답이 나중에 필드를 추가해도 자동으로 새어 나가지 않게 하기 위함이다.
//
//   ⚠ 이 모듈은 절대 throw 하지 않는다. 모든 실패는 state='unavailable' 로 흡수한다.
//     영상 Provider 장애가 Tournament 페이지 전체 오류로 번지면 안 된다.
//
//   공식 문서 기준(2026-09 확인)
//     · Live Input 조회 : GET  https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/live_inputs/{uid}
//                          → result.status 는 '문자열' 이다(객체 아님).
//                            connected / reconnected / reconnecting / client_disconnect /
//                            ttl_exceeded / failed_to_connect / failed_to_reconnect /
//                            new_configuration_accepted, 한 번도 연결 안 됐으면 null
//                          → result.playback.hls 에 customer-<CODE> 서브도메인이 들어 있다.
//     · 시청자 수       : GET  https://customer-<CODE>.cloudflarestream.com/<INPUT_ID>/views
//                          → { "liveViewers": 113 }
//     · 다시보기 목록   : GET  .../stream/live_inputs/{uid}/videos  → status.state === 'ready' 인 것만
//     · Player embed    : https://customer-<CODE>.cloudflarestream.com/<UID>/iframe

import { assertServerOnly } from './guard';
import type { LivePayload, LiveReplay, LiveVideoState } from '../liveTypes';

assertServerOnly('lib/tournaments/server/streamProvider');

const API_BASE = 'https://api.cloudflare.com/client/v4';
/** Provider 한 번 호출당 상한. 대회 당일 네트워크가 느려도 페이지를 붙잡지 않는다. */
const TIMEOUT_MS = 5_000;
/**
 * 서버측 스냅샷 캐시.
 *   시청자가 N 명이어도 Provider 호출량은 이 TTL 로 일정하게 유지된다.
 *   (클라이언트 폴링 20s + 서버 캐시 6s → 동시 시청자와 무관하게 초당 1회 미만)
 */
const CACHE_TTL_MS = 6_000;

/** 32자리 hex 만 허용 — 경로에 그대로 들어가므로 형식을 먼저 검증한다. */
const HEX32 = /^[a-f0-9]{32}$/i;

interface Config {
  accountId: string;
  token: string;
  liveInputId: string;
}

function readConfig(): Config | null {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const token = (process.env.CLOUDFLARE_STREAM_API_TOKEN || '').trim();
  const liveInputId = (process.env.CLOUDFLARE_STREAM_LIVE_INPUT_ID || '').trim();
  if (!accountId || !token || !liveInputId) return null;
  // 형식이 어긋나면 호출하지 않는다(오타로 엉뚱한 경로를 때리지 않게).
  if (!HEX32.test(accountId) || !HEX32.test(liveInputId)) return null;
  return { accountId, token, liveInputId };
}

/** Provider 설정이 모두 갖춰졌는지. 값 자체는 절대 반환하지 않는다. */
export function isStreamConfigured(): boolean {
  return readConfig() !== null;
}

/** 어떤 이유로도 throw 하지 않는 JSON GET. */
async function getJson(
  url: string,
  headers?: Record<string, string>,
): Promise<{ ok: true; json: unknown } | { ok: false }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...(headers || {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };
    return { ok: true, json: (await res.json()) as unknown };
  } catch {
    // 타임아웃 / DNS / TLS / JSON 파싱 — 전부 동일하게 '조회 실패'로 접는다.
    //   ⚠ 에러 객체를 로그에 찍지 않는다(요청 헤더에 token 이 들어 있을 수 있다).
    return { ok: false };
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Cloudflare 가 보고한 상태 문자열 → TEYEON 영상 상태.
 *   ⚠ 모르는 값을 live 로 낙관하지 않는다. 판단 불가는 'connecting'(중립)으로 둔다.
 */
export function mapProviderStatus(raw: string | null): LiveVideoState {
  switch (raw) {
    case null:
      return 'offline'; // 한 번도 연결된 적 없음
    case 'connected':
    case 'reconnected':
      return 'live';
    case 'reconnecting':
      return 'recovering';
    case 'client_disconnect':
    case 'ttl_exceeded':
    case 'disconnected':   // 객체형 status 의 current.state
      return 'ended';
    case 'failed_to_connect':
    case 'failed_to_reconnect':
      return 'error';
    case 'new_configuration_accepted':
      return 'connecting';
    default:
      return 'connecting';
  }
}

/**
 * Live Input 응답의 status → Provider 원문 상태 문자열.
 *   공식 API 문서(2026-10 재확인)는 문자열이다. 다만 실제 응답에서 { current: { state, reason } } 객체로
 *   오는 사례가 보고돼 있어 둘 다 받는다 — 객체를 문자열로 못 읽으면 영원히 'offline' 으로 보이기 때문이다.
 *   객체일 때는 reason(connected / client_disconnect …)을 먼저 쓰되, 모르는 reason 이면 state 를 쓴다.
 *   2026-10-21 실측: 운영 Live Input 의 status 는 객체였다
 *     ({ current: { state: 'connected' | 'disconnected', reason: 'connected' | 'client_disconnect', … }, history }).
 *   ⚠ 모르는 reason 을 그대로 넘기면 'connecting' 으로 판정돼 방송 중에도 플레이어가 내려갔다 다시 붙는다 —
 *     그래서 아는 reason 이 아니면 state(connected → 재생, disconnected → 종료)로 판정한다.
 */
const KNOWN_REASONS = new Set([
  'connected', 'reconnected', 'reconnecting', 'client_disconnect', 'ttl_exceeded',
  'failed_to_connect', 'failed_to_reconnect', 'new_configuration_accepted',
]);

export function readProviderStatus(v: unknown): string | null {
  const s = str(v);
  if (s) return s;
  const cur = obj(obj(v).current);
  const reason = str(cur.reason);
  const state = str(cur.state);
  if (reason && KNOWN_REASONS.has(reason)) return reason;
  return state ?? reason;
}

/** playback.hls 에서 customer 서브도메인 코드를 뽑는다(환경변수로 따로 받지 않기 위함). */
export function extractCustomerCode(hlsUrl: string | null): string | null {
  if (!hlsUrl) return null;
  const m = /^https:\/\/customer-([a-z0-9]+)\.cloudflarestream\.com\//i.exec(hlsUrl);
  return m ? m[1] : null;
}

const iframeUrl = (code: string, uid: string): string =>
  `https://customer-${code}.cloudflarestream.com/${uid}/iframe`;

/** 동시 시청자 수 — Provider 실측값. 조회 실패 시 null(0 으로 만들지 않는다). */
async function fetchViewers(code: string, inputId: string): Promise<number | null> {
  const r = await getJson(`https://customer-${code}.cloudflarestream.com/${inputId}/views`);
  if (!r.ok) return null;
  return num(obj(r.json).liveViewers);
}

/** 종료된 방송의 recording 목록. 실패하면 빈 배열(페이지를 막지 않는다). */
async function fetchReplays(cfg: Config, code: string): Promise<LiveReplay[]> {
  const r = await getJson(
    `${API_BASE}/accounts/${cfg.accountId}/stream/live_inputs/${cfg.liveInputId}/videos`,
    { authorization: `Bearer ${cfg.token}` },
  );
  if (!r.ok) return [];
  const result = obj(r.json).result;
  if (!Array.isArray(result)) return [];

  return result
    .map((row) => {
      const v = obj(row);
      const uid = str(v.uid);
      // 아직 처리 중인 녹화는 재생되지 않으므로 내보내지 않는다.
      if (!uid || str(obj(v.status).state) !== 'ready') return null;
      return {
        id: uid,
        durationSec: num(v.duration),
        createdAt: str(v.created),
        playbackUrl: iframeUrl(code, uid),
      } satisfies LiveReplay;
    })
    .filter((x): x is LiveReplay => x !== null)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5);
}

/** 녹화 한 건(관리자 녹화 연결용). ⚠ 재생용 공개 ID · 시각 · 길이만 — 그 밖의 필드는 담지 않는다. */
export interface LiveRecording {
  uid: string;
  /** Cloudflare 가 녹화 영상을 만든 시각(= 방송 연결 시각에 가깝다). ISO. */
  startedAt: string;
  durationSec: number;
}

/**
 * Live Input 의 녹화 목록 — 재생 준비(ready)된 것만, 최신순 최대 100개.
 *   ⚠ 관리자 녹화 연결 전용(캐시 없음). 실패는 ok:false 로 접는다(throw 없음).
 *   ⚠ 녹화를 지우거나 바꾸지 않는다(GET 만).
 */
export async function listLiveRecordings(): Promise<{ ok: true; recordings: LiveRecording[] } | { ok: false }> {
  const cfg = readConfig();
  if (!cfg) return { ok: false };
  const r = await getJson(
    `${API_BASE}/accounts/${cfg.accountId}/stream/live_inputs/${cfg.liveInputId}/videos`,
    { authorization: `Bearer ${cfg.token}` },
  );
  if (!r.ok) return { ok: false };
  const result = obj(r.json).result;
  if (!Array.isArray(result)) return { ok: false };
  const recordings = result
    .map((row): LiveRecording | null => {
      const v = obj(row);
      const uid = str(v.uid);
      const created = str(v.created);
      const duration = num(v.duration);
      if (!uid || !HEX32.test(uid) || str(obj(v.status).state) !== 'ready') return null;
      if (!created || !Number.isFinite(Date.parse(created)) || duration === null || duration <= 0) return null;
      return { uid, startedAt: created, durationSec: Math.round(duration * 1000) / 1000 };
    })
    .filter((x): x is LiveRecording => x !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 100);
  return { ok: true, recordings };
}

/** iframe 재생 URL — 응답에 담긴 재생 주소(customer 서브도메인)를 기준으로 다른 녹화 UID 의 URL 을 만든다. */
export function playbackUrlLike(referenceUrl: string | null, uid: string): string | null {
  const code = extractCustomerCode(referenceUrl);
  return code && HEX32.test(uid) ? iframeUrl(code, uid) : null;
}

function unavailable(configured: boolean): LivePayload {
  return {
    configured,
    state: 'unavailable',
    providerStatus: null,
    viewers: null,
    playbackUrl: null,
    replays: [],
    fetchedAt: new Date().toISOString(),
  };
}

let cache: { at: number; payload: LivePayload } | null = null;

/**
 * 현재 LIVE 스냅샷.
 *   호출부(API route)는 이 함수만 쓰면 되고, 실패해도 예외를 받지 않는다.
 */
export async function getLiveSnapshot(): Promise<LivePayload> {
  const cfg = readConfig();
  if (!cfg) return unavailable(false);

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.payload;

  const input = await getJson(
    `${API_BASE}/accounts/${cfg.accountId}/stream/live_inputs/${cfg.liveInputId}`,
    { authorization: `Bearer ${cfg.token}` },
  );
  if (!input.ok) {
    // 토큰 권한 부족 / Input 삭제됨 / Cloudflare 장애 — 전부 '조회 불가'.
    const payload = unavailable(true);
    cache = { at: now, payload };
    return payload;
  }

  // ⚠ 여기서부터 필요한 필드만 '직접' 고른다. result 를 spread 하지 않는다
  //   (rtmps.streamKey / srt.passphrase / webRTC 가 응답에 함께 들어 있다).
  const result = obj(obj(input.json).result);
  const providerStatus = readProviderStatus(result.status);
  const code = extractCustomerCode(str(obj(result.playback).hls));

  if (!code) {
    // playback URL 이 없으면 재생도 시청자 조회도 불가하다. 상태만 보고한다.
    const payload: LivePayload = {
      configured: true,
      state: mapProviderStatus(providerStatus),
      providerStatus,
      viewers: null,
      playbackUrl: null,
      replays: [],
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: now, payload };
    return payload;
  }

  const [viewers, replays] = await Promise.all([
    fetchViewers(code, cfg.liveInputId),
    fetchReplays(cfg, code),
  ]);

  const payload: LivePayload = {
    configured: true,
    state: mapProviderStatus(providerStatus),
    providerStatus,
    viewers,
    // Live Input UID 로 재생하면 '지금 방송 중인 것'이 항상 나온다(방송마다 URL 을 바꾸지 않아도 된다).
    playbackUrl: iframeUrl(code, cfg.liveInputId),
    replays,
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: now, payload };
  return payload;
}
