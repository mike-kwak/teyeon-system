// TEYEON FINAL REPORT V4.1 — 회원 전용 벌금 정산 조회(발행 시점 스냅샷 · 읽기 전용).
//   GET ?slug=<공개 slug>   Authorization: Bearer <사용자 access token>
//   ⚠ 열람 자격은 DB(get_kdk_final_report_settlement · auth.uid())가 판정한다. 이 route 는 service_role 을 쓰지 않는다.
//   ⚠ 모든 응답 캐시 금지(no-store · private · Vary: Authorization). 쓰기 기능 없음(POST 등 405).

import { NextResponse, type NextRequest } from 'next/server';
import { handleSettlementRequest, SETTLEMENT_HEADERS } from '@/lib/kdk/server/finalReportSettlementHandler';
import { createSettlementDeps } from '@/lib/kdk/server/finalReportSettlementService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const slug = req.nextUrl.searchParams.get('slug');
  const res = await handleSettlementRequest(createSettlementDeps(), req.headers.get('authorization'), slug);
  return NextResponse.json(res.body, { status: res.status, headers: SETTLEMENT_HEADERS });
}

const notAllowed = (): NextResponse => NextResponse.json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: SETTLEMENT_HEADERS });
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
