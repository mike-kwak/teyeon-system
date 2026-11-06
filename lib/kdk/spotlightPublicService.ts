// MATCH SPOTLIGHT 공개 조회 — anon 키 + 공개 RPC 만 사용(service_role 미사용).
//   서버 컴포넌트(/club/spotlight/[slug])와 클라이언트 배너가 함께 쓴다.
//   응답은 parsePublicSpotlightPayload(allow-list)를 거친 값만 반환한다.

import { parsePublicSpotlightPayload, type PublicSpotlightPayload } from './analytics/publicSpotlight';

export const SPOTLIGHT_SITE_URL = 'https://teyeon-system.vercel.app';
export const SLUG_RE = /^[a-z0-9]{12,32}$/;

export const spotlightPublicPath = (slug: string): string => `/club/spotlight/${slug}`;
export const spotlightPublicUrl = (slug: string): string => `${SPOTLIGHT_SITE_URL}${spotlightPublicPath(slug)}`;

export type PublicSpotlightResult =
  | { state: 'ok'; payload: PublicSpotlightPayload; publishedAt: string | null }
  | { state: 'not_found' }
  | { state: 'unavailable' };

async function anonRpc(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: any }> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) return { ok: false, status: 0, body: null };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export async function fetchPublicSpotlight(slug: string): Promise<PublicSpotlightResult> {
  if (!SLUG_RE.test(slug)) return { state: 'not_found' };
  const r = await anonRpc('get_public_kdk_spotlight', { p_slug: slug });
  if (!r.ok) return { state: 'unavailable' };
  if (r.body?.ok !== true) return { state: 'not_found' };
  const payload = parsePublicSpotlightPayload(r.body.payload);
  if (!payload) return { state: 'not_found' };
  return { state: 'ok', payload, publishedAt: typeof r.body.published_at === 'string' ? r.body.published_at : null };
}
