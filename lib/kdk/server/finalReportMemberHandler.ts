// TEYEON FINAL REPORT — 회원 전용 전체 리포트 조회 핸들러(MAINT-002 · 의존성 주입형 · 보안 시험 가능).
//
//   흐름: Bearer(사용자 본인 access token) → Supabase 에 "그 사용자로" get_kdk_final_report_member(p_slug) 호출.
//         열람 자격(members.auth_user_id 연결 · 정회원/준회원/임원 토큰 · 탈회 우선 거부)은 DB 가 auth.uid() 로 판정한다.
//         service_role 을 쓰지 않는다. 정산 열람 자격(kdk_can_view_settlement)과는 별개다.
//   응답: 성공도 실패도 캐시 금지(SETTLEMENT_HEADERS 와 같은 no-store · private). 비허용자에게는 리포트 존재 여부를 알리지 않는다.
//   ⚠ 받은 발행본도 allow-list 파서(parsePublicFinalReport)로 다시 검사한다. 정정 상태면 공식 결과 요약(정산 없음)만 서버에서 붙인다.

import { parsePublicFinalReport, type FinalReportPublicPayload } from '../finalReport/finalReportModel';
import type { OfficialResultSummary } from '../finalReportPublicService';
import { bearerOf } from './finalReportHandler';
import type { SettlementDeps } from './finalReportSettlementHandler';

export interface MemberReportDeps extends SettlementDeps {
  /** 정정 상태일 때만(회원 확인 후) 서버에서 공식 결과 요약을 읽는다. */
  officialSummary(sessionId: string): Promise<OfficialResultSummary | null>;
}
export type MemberReportReason = 'login_required' | 'forbidden' | 'not_available' | 'unavailable' | 'invalid_slug' | 'not_configured';
export type MemberReportResponse =
  | { status: 200; body: { ok: true; state: 'ok'; payload: FinalReportPublicPayload; revision: number } }
  | { status: 200; body: { ok: true; state: 'corrected'; title: string; date: string; official: OfficialResultSummary | null } }
  | { status: number; body: { ok: false; reason: MemberReportReason } };

const SLUG_RE = /^[a-z0-9]{12,32}$/;
const fail = (status: number, reason: MemberReportReason): MemberReportResponse => ({ status, body: { ok: false, reason } });

export async function handleMemberReportRequest(deps: MemberReportDeps, authHeader: string | null | undefined, slug: string | null): Promise<MemberReportResponse> {
  if (!deps.configured) return fail(503, 'not_configured');
  const token = bearerOf(authHeader);
  if (!token) return fail(401, 'login_required');
  if (!slug || !SLUG_RE.test(slug)) return fail(400, 'invalid_slug');
  const r = await deps.rpcAsUser(token, 'get_kdk_final_report_member', { p_slug: slug });
  if (!r.ok) {
    if (r.status === 401 || r.code === 'PGRST301' || r.code === 'PGRST302') return fail(401, 'login_required');
    if (r.status === 403 || r.code === '42501') return fail(403, 'forbidden');
    // 함수 없음(SQL 미적용 · rollback) → 회원도 공개본만(화면은 공개 뷰 유지).
    if (r.code === 'PGRST202' || r.code === '42883' || r.status === 404) return fail(404, 'not_available');
    return fail(502, 'unavailable');
  }
  const d = r.data;
  if (!d || typeof d !== 'object') return fail(502, 'unavailable');
  if (d.ok !== true) {
    const reason = String(d.reason || '');
    if (reason === 'login_required') return fail(401, 'login_required');
    if (reason === 'forbidden') return fail(403, 'forbidden');
    if (reason === 'not_available') return fail(404, 'not_available');
    return fail(502, 'unavailable');
  }
  if (d.state === 'corrected') {
    const sid = typeof d.officialSessionId === 'string' && d.officialSessionId.length > 0 && d.officialSessionId.length <= 80 ? d.officialSessionId : null;
    const official = sid ? await deps.officialSummary(sid).catch(() => null) : null;
    return { status: 200, body: { ok: true, state: 'corrected', title: typeof d.title === 'string' ? d.title.slice(0, 80) : '',
      date: typeof d.date === 'string' ? d.date.slice(0, 20) : '', official } };
  }
  if (d.state !== 'ok') return fail(502, 'unavailable');
  const payload = parsePublicFinalReport(d.payload);
  if (!payload) return fail(502, 'unavailable');
  return { status: 200, body: { ok: true, state: 'ok', payload, revision: Number.isInteger(d.revision) ? d.revision : 1 } };
}
