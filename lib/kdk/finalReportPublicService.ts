// TEYEON KDK FINAL REPORT 공개 조회 — anon 키 + 공개 RPC(get_public_kdk_final_report)만 사용(service_role 미사용).
//   P2 공개 페이지(/club/report/[slug])가 쓴다. 응답은 parsePublicFinalReport(allow-list)를 거친 값만 돌려준다.
//   상태: ok · corrected(공식 기록 정정 → 오래된 수치 미표시) · not_found(없음 · 비공개 · 미확정 · 테스트) · unavailable(조회 실패).

import { parsePublicFinalReport, type FinalReportPublicPayload } from './finalReport/finalReportModel';

export const FINAL_REPORT_SITE_URL = 'https://teyeon-system.vercel.app';
export const FINAL_REPORT_SLUG_RE = /^[a-z0-9]{12,32}$/;
export const finalReportPublicPath = (slug: string): string => `/club/report/${slug}`;
export const finalReportPublicUrl = (slug: string): string => `${FINAL_REPORT_SITE_URL}${finalReportPublicPath(slug)}`;
/** 공식 결과 상세(기존 공개 페이지 · 로그인 불필요). */
export const officialResultPath = (sessionId: string): string => `/club/kdk/${encodeURIComponent(sessionId)}`;

export type PublicFinalReportResult =
  | { state: 'ok'; payload: FinalReportPublicPayload; revision: number; publishedAt: string | null; officialSessionId: string | null }
  | { state: 'corrected'; title: string; date: string; officialSessionId: string | null }
  | { state: 'not_found' }
  | { state: 'unavailable' };

export type AnonRpc = (fn: string, args: Record<string, unknown>) => Promise<{ ok: boolean; status: number; body: any }>;

export const defaultAnonRpc: AnonRpc = async (fn, args) => {
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
};

const sid = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

export async function fetchPublicFinalReport(slug: string, rpc: AnonRpc = defaultAnonRpc): Promise<PublicFinalReportResult> {
  if (!FINAL_REPORT_SLUG_RE.test(slug)) return { state: 'not_found' };
  const r = await rpc('get_public_kdk_final_report', { p_slug: slug });
  if (!r.ok || !r.body || typeof r.body !== 'object') return { state: 'unavailable' };
  const b = r.body;
  if (b.state === 'corrected') {
    return { state: 'corrected', title: typeof b.title === 'string' ? b.title.slice(0, 80) : '', date: typeof b.date === 'string' ? b.date.slice(0, 20) : '', officialSessionId: sid(b.officialSessionId) };
  }
  if (b.ok !== true || b.state !== 'ok') return { state: 'not_found' };
  const payload = parsePublicFinalReport(b.payload);
  if (!payload) return { state: 'not_found' };
  return { state: 'ok', payload, revision: Number.isInteger(b.revision) ? b.revision : 1,
    publishedAt: typeof b.publishedAt === 'string' ? b.publishedAt : null, officialSessionId: sid(b.officialSessionId) };
}
