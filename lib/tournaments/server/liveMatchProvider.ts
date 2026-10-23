// LIVE 중계 경기 정보 · 경기별 다시보기 조회 (서버 전용) — Supabase REST RPC 를 직접 부른다.
//
//   ⚠ 공개 조회(get_public_live_match · get_public_live_replays)는 anon key 로만 부른다(service_role 쓰지 않음).
//     결과는 SQL 이 DRAW 공개 조건 · 관리자 확정 조건을 이미 적용한 값이다.
//   ⚠ 관리자 RPC(녹화 연결)는 호출한 관리자 본인의 access token 으로 부른다 — 권한은 SQL 이 판정한다.
//   ⚠ 절대 throw 하지 않는다. 실패는 전부 '조회 실패'로 접는다 —
//     경기 정보 장애가 Cloudflare 영상 상태 · 재생 · 다시보기 응답을 막으면 안 된다.
//   ⚠ 공개 응답은 liveMatch.ts 의 파서가 화이트리스트로 다시 담는다(내부 ID · 점수 · 연락처 차단).
//   ⚠ 에러 객체 · 요청 헤더 · 토큰을 로그에 찍지 않는다.

import { assertServerOnly } from './guard';
import { LIVE_MATCH_UNAVAILABLE, parseLiveMatchState } from '../liveMatch';
import type { LiveMatchState } from '../liveTypes';

assertServerOnly('lib/tournaments/server/liveMatchProvider');

/** 한 번 호출당 상한 — 느려도 LIVE 응답 전체를 붙잡지 않는다. */
const TIMEOUT_MS = 4_000;
/**
 * 대회별 짧은 캐시. 시청자가 N 명이어도 DB 호출량은 이 TTL 로 일정하다
 * (클라이언트 폴링 20초 · 경기 전환 반영은 최대 폴링 + 5초).
 */
const MATCH_TTL_MS = 5_000;
/** 확정 다시보기는 자주 바뀌지 않는다. */
const REPLAYS_TTL_MS = 15_000;

function restConfig(): { url: string; key: string } | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  return url && key ? { url, key } : null;
}

export type RpcOutcome =
  | { ok: true; data: unknown }
  | { ok: false; status: number; code: string };

/** REST RPC 한 번. bearer 가 없으면 anon. 어떤 이유로도 throw 하지 않는다. */
export async function callRestRpc(fn: string, args: Record<string, unknown>, bearer?: string): Promise<RpcOutcome> {
  const cfg = restConfig();
  if (!cfg) return { ok: false, status: 0, code: 'not_configured' };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${bearer || cfg.key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const code = body && typeof body === 'object' ? String((body as { code?: unknown }).code ?? '') : '';
      return { ok: false, status: res.status, code };
    }
    return { ok: true, data: body };
  } catch {
    return { ok: false, status: 0, code: 'network' };
  }
}

const matchCache = new Map<string, { at: number; value: LiveMatchState }>();
const replayCache = new Map<string, { at: number; value: unknown }>();
const trim = (m: Map<string, unknown>) => { if (m.size > 20) m.delete(m.keys().next().value as string); };

export async function getPublicLiveMatch(slug: string): Promise<LiveMatchState> {
  if (!slug || !restConfig()) return LIVE_MATCH_UNAVAILABLE;
  const now = Date.now();
  const hit = matchCache.get(slug);
  if (hit && now - hit.at < MATCH_TTL_MS) return hit.value;
  const r = await callRestRpc('get_public_live_match', { p_slug: slug });
  const value = r.ok ? parseLiveMatchState(r.data) : LIVE_MATCH_UNAVAILABLE;
  // 실패도 짧게 캐시한다(장애 중 시청자 폴링이 DB 를 두드리지 않게).
  matchCache.set(slug, { at: now, value });
  trim(matchCache);
  return value;
}

/** 확정 경기별 다시보기 RPC 원본(파싱은 호출부가 재생 URL 과 함께 한다). 실패 → null. */
export async function getPublicLiveReplaysRaw(slug: string): Promise<unknown> {
  if (!slug || !restConfig()) return null;
  const now = Date.now();
  const hit = replayCache.get(slug);
  if (hit && now - hit.at < REPLAYS_TTL_MS) return hit.value;
  const r = await callRestRpc('get_public_live_replays', { p_slug: slug });
  const value = r.ok ? r.data : null;
  replayCache.set(slug, { at: now, value });
  trim(replayCache);
  return value;
}
