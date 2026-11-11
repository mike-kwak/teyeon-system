// TEYEON KDK FINAL REPORT 서버 의존성(service_role REST) — app/api/kdk/final-report/route.ts 전용.
//   ⚠ SUPABASE_SERVICE_ROLE_KEY 는 서버에서만 읽고 응답에 담지 않는다(assertServerOnly 로 브라우저 import 차단).
//   ⚠ 사용자 확인은 Supabase Auth(/auth/v1/user), 관리 권한은 사용자 본인 토큰으로 can_manage_kdk() — 기존 KDK 관리자 체계 그대로.

import { assertServerOnly } from '../../tournaments/server/guard';
import { randomSlug } from './spotlightService';
import type { FinalReportDeps, RpcResult } from './finalReportHandler';

assertServerOnly('lib/kdk/server/finalReportService');

const TIMEOUT_MS = 15000;
const DEFAULT_CLUB_ID = '512d047d-a076-4080-97e5-6bb5a2c07819';

interface Cfg { url: string; anon: string; service: string }
function cfg(): Cfg | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return url && anon && service ? { url: url.replace(/\/+$/, ''), anon, service } : null;
}

async function rest(c: Cfg, path: string, init: RequestInit & { bearer?: string } = {}): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch(`${c.url}${path}`, {
      ...init,
      headers: { apikey: c.service, authorization: `Bearer ${init.bearer || c.service}`, 'content-type': 'application/json', accept: 'application/json', ...(init.headers || {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export function createFinalReportDeps(): FinalReportDeps {
  const c = cfg();
  const clubId = process.env.NEXT_PUBLIC_CLUB_ID || DEFAULT_CLUB_ID;
  if (!c) {
    const none = async () => null;
    return { configured: false, clubId, verifyUser: none, getRole: none, canManageKdk: none,
      rpc: async () => ({ ok: false, status: 0, code: 'not_configured' }), randomSlug };
  }
  return {
    configured: true,
    clubId,
    async verifyUser(token) {
      const r = await rest(c, '/auth/v1/user', { method: 'GET', bearer: token, headers: { apikey: c.anon } });
      return r.ok && r.body && typeof r.body.id === 'string' ? r.body.id : null;
    },
    async canManageKdk(token) {
      const r = await rest(c, '/rest/v1/rpc/can_manage_kdk', { method: 'POST', bearer: token, headers: { apikey: c.anon }, body: '{}' });
      return r.ok && typeof r.body === 'boolean' ? r.body : null;
    },
    async getRole(userId) {
      const r = await rest(c, `/rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`, { method: 'GET' });
      return r.ok && Array.isArray(r.body) && r.body[0] ? String(r.body[0].role ?? '') : null;
    },
    async rpc(fn, args): Promise<RpcResult> {
      const r = await rest(c, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
      if (!r.ok) return { ok: false, status: r.status, code: String(r.body?.code ?? (r.status === 0 ? 'network' : '')) };
      return { ok: true, data: r.body };
    },
    randomSlug,
  };
}
