// TEYEON FINAL REPORT V4.1 — 회원 전용 정산 조회 핸들러(의존성 주입형 · 보안 시험 가능).
//
//   흐름: Bearer(사용자 본인 access token) → Supabase 에 "그 사용자로" get_kdk_final_report_settlement(p_slug) 호출.
//         열람 자격(회원 연결 · 클럽 역할 · 탈회 · 운영 권한)은 DB 가 auth.uid() 로 판정한다. service_role 을 쓰지 않는다.
//   응답: 성공도 실패도 캐시 금지(no-store · private · Vary: Authorization). 비허용자에게는 리포트 · 정산 존재 여부를 알리지 않는다.
//   ⚠ 서버가 받은 스냅샷도 allow-list 파서로 다시 검사한다. 형식 · 합계가 틀리면 'unavailable'(0원 · 완납으로 표시 금지).

import { parseSettlementSnapshot, type SettlementSnapshot } from '../finalReport/v41/settlementSnapshot';
import { bearerOf } from './finalReportHandler';

export interface SettlementDeps {
  configured: boolean;
  /** 사용자 토큰으로 공개 RPC 호출(anon key + 사용자 JWT). */
  rpcAsUser(token: string, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: any } | { ok: false; status: number; code: string }>;
}
export type SettlementResponse =
  | { status: 200; body: { ok: true; revision: number; capturedAt: string | null; snapshot: SettlementSnapshot } }
  | { status: number; body: { ok: false; reason: 'login_required' | 'forbidden' | 'not_available' | 'unavailable' | 'invalid_slug' | 'not_configured' } };

const SLUG_RE = /^[a-z0-9]{12,32}$/;
/**
 * 회원별 응답이 브라우저 · 프록시 · CDN 어디에도 저장 · 공유되지 않게 한다.
 *   · Cache-Control: private(공유 캐시 저장 금지) + no-store(어떤 캐시도 저장 금지) + max-age=0
 *   · CDN-Cache-Control / Vercel-CDN-Cache-Control(RFC 9213 · Vercel Edge): CDN 계층에도 명시적으로 저장 금지
 *   · Surrogate-Control: 대리(프록시) 캐시 지시
 *   · Vary 는 Next.js 가 라우트 응답에서 고정값으로 덮어써 쓸 수 없다 → 위 지시들로 대체(요청에 Authorization 이 있으면 RFC 9111 상 공유 캐시는 원래 저장 불가).
 */
export const SETTLEMENT_HEADERS = {
  'cache-control': 'private, no-store, no-cache, max-age=0, must-revalidate',
  'cdn-cache-control': 'no-store',
  'vercel-cdn-cache-control': 'no-store',
  'surrogate-control': 'no-store',
  pragma: 'no-cache',
  expires: '0',
  vary: 'Authorization',
  'x-robots-tag': 'noindex, nofollow',
} as const;

export async function handleSettlementRequest(deps: SettlementDeps, authHeader: string | null | undefined, slug: string | null): Promise<SettlementResponse> {
  if (!deps.configured) return { status: 503, body: { ok: false, reason: 'not_configured' } };
  const token = bearerOf(authHeader);
  if (!token) return { status: 401, body: { ok: false, reason: 'login_required' } };
  if (!slug || !SLUG_RE.test(slug)) return { status: 400, body: { ok: false, reason: 'invalid_slug' } };
  const r = await deps.rpcAsUser(token, 'get_kdk_final_report_settlement', { p_slug: slug });
  if (!r.ok) {
    if (r.status === 401 || r.code === 'PGRST301' || r.code === 'PGRST302') return { status: 401, body: { ok: false, reason: 'login_required' } };
    if (r.status === 403 || r.code === '42501') return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (r.code === 'PGRST202' || r.code === '42883' || r.status === 404) return { status: 404, body: { ok: false, reason: 'not_available' } };
    return { status: 502, body: { ok: false, reason: 'unavailable' } };
  }
  const d = r.data;
  if (!d || typeof d !== 'object') return { status: 502, body: { ok: false, reason: 'unavailable' } };
  if (d.ok !== true) {
    const reason = String(d.reason || '');
    if (reason === 'login_required') return { status: 401, body: { ok: false, reason: 'login_required' } };
    if (reason === 'forbidden') return { status: 403, body: { ok: false, reason: 'forbidden' } };
    if (reason === 'not_available') return { status: 404, body: { ok: false, reason: 'not_available' } };
    return { status: 502, body: { ok: false, reason: 'unavailable' } };
  }
  const snapshot = parseSettlementSnapshot(d.snapshot);
  if (!snapshot) return { status: 502, body: { ok: false, reason: 'unavailable' } };
  return { status: 200, body: { ok: true, revision: Number.isInteger(d.revision) ? d.revision : 0,
    capturedAt: typeof d.capturedAt === 'string' ? d.capturedAt.slice(0, 25) : null, snapshot } };
}
