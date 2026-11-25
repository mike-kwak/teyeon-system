// TEYEON KDK FINAL REPORT 공개 조회 — anon 키 + 공개 RPC(get_public_kdk_final_report)만 사용(service_role 미사용).
//   P2 공개 페이지(/club/report/[slug]) · OG 이미지가 쓴다.
//   MAINT-002: 응답은 공개 뷰(parsePublicReportView — 순위 · TOP3 · 개인 기록이 들어올 자리 없는 allow-list)만 돌려준다.
//     공식 세션 id 도 돌려주지 않는다. 회원용 전체 리포트는 /api/kdk/final-report/member 로만 받는다.
//   상태: ok · corrected(공식 기록 정정 → 오래된 수치 미표시) · not_found(없음 · 비공개 · 미확정 · 테스트) · unavailable(조회 실패).

import { parsePublicReportView, type FinalReportPublicView } from './finalReport/finalReportPublicView';

export const FINAL_REPORT_SITE_URL = 'https://teyeon-system.vercel.app';
export const FINAL_REPORT_SLUG_RE = /^[a-z0-9]{12,32}$/;
export const finalReportPublicPath = (slug: string): string => `/club/report/${slug}`;
export const finalReportPublicUrl = (slug: string): string => `${FINAL_REPORT_SITE_URL}${finalReportPublicPath(slug)}`;
/**
 * 공유 URL(공개 페이지 · 운영진 편집기 공통 — 한 곳에서만 만든다).
 *   항상 운영 공개 도메인(FINAL_REPORT_SITE_URL) — localhost · Preview · 관리자 경로를 공유하지 않는다.
 *   ?v=판 번호는 카카오톡 등 미리보기 캐시 구분용일 뿐이다. 페이지는 v 를 읽지 않고 항상 현재 발행본을 조회 · 검증한다.
 */
export const finalReportSharePath = (slug: string, revision?: number | null): string =>
  `${finalReportPublicPath(slug)}${typeof revision === 'number' && Number.isInteger(revision) && revision >= 1 ? `?v=${revision}` : ''}`;
export const finalReportShareUrl = (slug: string, revision?: number | null): string => `${FINAL_REPORT_SITE_URL}${finalReportSharePath(slug, revision)}`;
/**
 * OG 이미지 경로(판 번호를 붙여 재발행 때 이미지 캐시도 갈린다).
 *   MAINT-002: o=2 = 개인 순위 없는 공개 이미지 판. 예전 TOP3 이미지 주소(?v=N)와 달라져, 미리보기를 다시 읽는 플랫폼은 새 이미지를 받는다.
 *   (route 는 쿼리를 읽지 않고 항상 현재 공개 뷰로 그린다 — 예전 주소로 와도 새 이미지.)
 */
export const FINAL_REPORT_OG_VARIANT = 2;
export const finalReportOgPath = (slug: string, revision?: number | null): string =>
  `${finalReportPublicPath(slug)}/og?${typeof revision === 'number' && Number.isInteger(revision) && revision >= 1 ? `v=${revision}&` : ''}o=${FINAL_REPORT_OG_VARIANT}`;
/** 공식 결과 상세(기존 공개 페이지 · 로그인 불필요). */
export const officialResultPath = (sessionId: string): string => `/club/kdk/${encodeURIComponent(sessionId)}`;

export type PublicFinalReportResult =
  | { state: 'ok'; view: FinalReportPublicView; revision: number; publishedAt: string | null }
  | { state: 'corrected'; title: string; date: string }
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
    return { state: 'corrected', title: typeof b.title === 'string' ? b.title.slice(0, 80) : '', date: typeof b.date === 'string' ? b.date.slice(0, 20) : '' };
  }
  if (b.ok !== true || b.state !== 'ok') return { state: 'not_found' };
  // SQL 적용 전(전체 발행본)이든 후(공개 투영)든 같은 공개 뷰가 된다.
  const view = parsePublicReportView(b.payload);
  if (!view) return { state: 'not_found' };
  return { state: 'ok', view, revision: Number.isInteger(b.revision) ? b.revision : 1,
    publishedAt: typeof b.publishedAt === 'string' ? b.publishedAt : null };
}

// ── 정정 안내용 공식 결과 요약(서버 전용 allow-list) ─────────────────────────────
//   MAINT-002: 회원 전용 API(/api/kdk/final-report/member)가 회원 확인 후에만 호출한다(공개 화면에서는 호출하지 않음).
//   공개 RPC get_public_kdk_session 응답에는 게스트 정산 · 계좌가 함께 있다. 이 함수는 서버에서만 호출하고
//   순위 · 완료 경기 점수만 골라 돌려준다 → 브라우저(HTML · RSC payload)에는 정산 필드가 가지 않는다.
export interface OfficialResultSummary {
  standings: Array<{ rank: number; name: string; guest: boolean; wins: number; losses: number; diff: number }>;
  matches: Array<{ round: number | null; court: number | null; teamA: [string, string]; teamB: [string, string]; score1: number; score2: number }>;
}
const nint = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const nstr = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const plain = (n: string): string => n.replace(/\s*\(G\)\s*$/i, '').trim();
export async function fetchOfficialResultSummary(sessionId: string, rpc: AnonRpc = defaultAnonRpc): Promise<OfficialResultSummary | null> {
  if (!sid(sessionId)) return null;
  const r = await rpc('get_public_kdk_session', { p_session_id: sessionId });
  const b = r.ok && r.body && typeof r.body === 'object' ? r.body : null;
  if (!b || b.state !== 'finished' || b.isOfficial !== true || !Array.isArray(b.finalRanking) || b.finalRanking.length === 0) return null;
  const matches = (Array.isArray(b.matches) ? b.matches : []).slice(0, 200).flatMap((m: any) => {
    const names = Array.isArray(m?.playerNames) ? m.playerNames.map((x: unknown) => nstr(x, 40)) : [];
    if (names.length !== 4 || nint(m?.score1) === null || nint(m?.score2) === null) return [];
    return [{ round: nint(m.round), court: nint(m.court), teamA: [names[0], names[1]] as [string, string], teamB: [names[2], names[3]] as [string, string],
      score1: m.score1 as number, score2: m.score2 as number }];
  });
  const guestNames = new Set(matches.flatMap((m: OfficialResultSummary['matches'][number]) => [...m.teamA, ...m.teamB]).filter((n: string) => /\(G\)\s*$/i.test(n)).map(plain));
  const standings = b.finalRanking.slice(0, 80).flatMap((x: any, i: number) => {
    const name = nstr(x?.name, 40);
    if (!name) return [];
    const guest = /\(G\)\s*$/i.test(name) || guestNames.has(plain(name));
    return [{ rank: nint(x.rank) ?? i + 1, name: guest ? `${plain(name)}(G)` : name, guest, wins: nint(x.wins) ?? 0, losses: nint(x.losses) ?? 0, diff: nint(x.diff) ?? 0 }];
  });
  return standings.length ? { standings, matches } : null;
}
