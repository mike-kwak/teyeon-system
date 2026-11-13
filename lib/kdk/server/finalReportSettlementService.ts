// TEYEON FINAL REPORT V4.1 — 정산 조회 서버 의존성(사용자 토큰으로만 호출 · service_role 미사용).
import { assertServerOnly } from '../../tournaments/server/guard';
import type { SettlementDeps } from './finalReportSettlementHandler';

assertServerOnly('lib/kdk/server/finalReportSettlementService');

export function createSettlementDeps(): SettlementDeps {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !anon) return { configured: false, rpcAsUser: async () => ({ ok: false, status: 0, code: 'not_configured' }) };
  return {
    configured: true,
    async rpcAsUser(token, fn, args) {
      try {
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(args), cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, status: res.status, code: String(body?.code ?? '') };
        return { ok: true, data: body };
      } catch {
        return { ok: false, status: 0, code: 'network' };
      }
    },
  };
}
