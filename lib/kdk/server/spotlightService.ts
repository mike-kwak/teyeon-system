// MATCH SPOTLIGHT 서버 의존성(service_role REST) — app/api/kdk/spotlight/route.ts 전용.
//
//   ⚠ SUPABASE_SERVICE_ROLE_KEY 는 NEXT_PUBLIC_ 접두어가 없으므로 클라이언트 번들에 들어가지 않는다.
//     이 모듈은 assertServerOnly 로 브라우저 import 를 즉시 실패시킨다. 키 값은 어떤 응답에도 담지 않는다.
//   ⚠ 사용자 토큰 검증은 Supabase Auth(/auth/v1/user)로 서버에서 한다(클라이언트가 보낸 user id 를 믿지 않는다).
//   ⚠ members 는 id · nickname · auth_user_id 만, profiles 는 id · role · profile_visibility_level 만 읽는다.

import { randomBytes } from 'node:crypto';
import { assertServerOnly } from '../../tournaments/server/guard';
import type { RpcResult, SpotlightDeps } from './spotlightHandler';

assertServerOnly('lib/kdk/server/spotlightService');

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
      headers: {
        apikey: c.service,
        authorization: `Bearer ${init.bearer || c.service}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.headers || {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const enc = encodeURIComponent;

/** KST 기준 오늘 날짜. */
export function kstToday(now = Date.now()): string {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 12~32자 소문자·숫자 slug(공개 링크). */
export function randomSlug(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(16);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

export function createSpotlightDeps(): SpotlightDeps {
  const c = cfg();
  const clubId = process.env.NEXT_PUBLIC_CLUB_ID || DEFAULT_CLUB_ID;
  const notConfigured = async () => null;
  if (!c) {
    return {
      configured: false, clubId,
      verifyUser: notConfigured, getRole: notConfigured, canManageKdk: notConfigured, loadSessionMatches: notConfigured,
      loadOfficialArchives: notConfigured, loadMembers: notConfigured, loadRestrictedMemberIds: notConfigured,
      latestRunRevision: notConfigured,
      rpc: async () => ({ ok: false, status: 0, code: 'not_configured' }),
      randomSlug, today: () => kstToday(),
    };
  }
  return {
    configured: true,
    clubId,
    async verifyUser(token) {
      // apikey 는 anon, Authorization 은 사용자 토큰 — Supabase Auth 가 서명·만료를 검증한다.
      const r = await rest(c, '/auth/v1/user', { method: 'GET', bearer: token, headers: { apikey: c.anon } });
      const id = r.ok && r.body && typeof r.body.id === 'string' ? r.body.id : null;
      return id;
    },
    async canManageKdk(token) {
      // 기존 KDK 관리자 판정 RPC 를 사용자 본인 토큰으로 호출(apikey anon) — 서버가 권한을 새로 만들지 않는다.
      const r = await rest(c, '/rest/v1/rpc/can_manage_kdk', { method: 'POST', bearer: token, headers: { apikey: c.anon }, body: '{}' });
      return r.ok && typeof r.body === 'boolean' ? r.body : null;
    },
    async getRole(userId) {
      const r = await rest(c, `/rest/v1/profiles?select=role&id=eq.${enc(userId)}&limit=1`, { method: 'GET' });
      return r.ok && Array.isArray(r.body) && r.body[0] ? String(r.body[0].role ?? '') : null;
    },
    async loadSessionMatches(sessionId) {
      const r = await rest(c,
        `/rest/v1/matches?select=id,round,court,status,group_name,player_ids,player_names,session_title`
        + `&club_id=eq.${enc(clubId)}&session_id=eq.${enc(sessionId)}`, { method: 'GET' });
      return r.ok && Array.isArray(r.body) ? r.body : null;
    },
    async loadOfficialArchives() {
      const r = await rest(c,
        '/rest/v1/teyeon_archive_v1?select=id,created_at,raw_data,is_official,archive_type,is_test'
        + '&archive_type=eq.kdk&is_official=eq.true', { method: 'GET' });
      return r.ok && Array.isArray(r.body) ? r.body : null;
    },
    async loadMembers() {
      // 탈회 포함 전체(과거 기록 해석용) — clubRankingService.loadRankingInputs 의 members 와 같은 용도.
      const r = await rest(c, '/rest/v1/members?select=id,nickname', { method: 'GET' });
      return r.ok && Array.isArray(r.body)
        ? r.body.map((m: any) => ({ id: String(m.id), name: String(m.nickname || '') }))
        : null;
    },
    async loadRestrictedMemberIds() {
      const mr = await rest(c, '/rest/v1/members?select=id,auth_user_id&auth_user_id=not.is.null', { method: 'GET' });
      if (!mr.ok || !Array.isArray(mr.body)) return null;
      const authToMember = new Map<string, string>();
      for (const m of mr.body) if (m.auth_user_id) authToMember.set(String(m.auth_user_id), String(m.id));
      if (authToMember.size === 0) return [];
      const ids = [...authToMember.keys()];
      const out: string[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100).map(enc).join(',');
        const pr = await rest(c, `/rest/v1/profiles?select=id,profile_visibility_level&id=in.(${chunk})`, { method: 'GET' });
        if (!pr.ok || !Array.isArray(pr.body)) return null;
        for (const p of pr.body) {
          const level = String(p.profile_visibility_level || 'public');
          if (level === 'private' || level === 'partial') {
            const mid = authToMember.get(String(p.id));
            if (mid) out.push(mid);
          }
        }
      }
      return out;
    },
    async latestRunRevision(token, sessionId) {
      // publish RPC 의 "최신 회차" 판정과 같은 집합(draft · published · unpublished = superseded 제외)을
      // 기존 운영진 RPC(get_kdk_spotlight_admin)로 사용자 본인 토큰으로 읽는다 — 테이블 직접 권한에 기대지 않는다.
      const r = await rest(c, '/rest/v1/rpc/get_kdk_spotlight_admin',
        { method: 'POST', bearer: token, headers: { apikey: c.anon }, body: JSON.stringify({ p_session_id: sessionId }) });
      if (!r.ok || !r.body || !Array.isArray(r.body.runs)) return null;
      return r.body.runs.reduce((mx: number, x: any) => Math.max(mx, Number(x?.revision) || 0), 0);
    },
    async rpc(fn, args): Promise<RpcResult> {
      const r = await rest(c, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
      if (!r.ok) return { ok: false, status: r.status, code: String(r.body?.code ?? (r.status === 0 ? 'network' : '')) };
      return { ok: true, data: r.body };
    },
    randomSlug,
    today: () => kstToday(),
  };
}
