// TEYEON KDK FINAL REPORT 운영 API(CEO · ADMIN · KDK 관리자).
//   POST { action, sessionId, content?, expectedUpdatedAt?, expectedRevision?, baseSignature?, confirm?, keep? }
//   Authorization: Bearer <사용자 access token>
//   ⚠ 인증 · 권한 · 공개본 생성은 서버(lib/kdk/server/finalReportHandler)가 매 요청 다시 한다.
//   ⚠ service_role 키는 이 route 안에서만 쓰이며 응답에 포함되지 않는다.
//   공개 조회는 이 route 가 아니라 anon RPC(get_public_kdk_final_report)로 /club/report/[slug] 가 한다.

import { NextResponse, type NextRequest } from 'next/server';
import { handleFinalReportAction } from '@/lib/kdk/server/finalReportHandler';
import { createFinalReportDeps } from '@/lib/kdk/server/finalReportService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = null;
  try {
    const text = await req.text();
    // 운영진 문구(오프닝 · 마무리 · 스토리 3 · 리뷰 4) + 연결 정보를 담기에 충분한 크기.
    if (text.length > 24576) return NextResponse.json({ ok: false, reason: 'payload_too_large' }, { status: 413, headers: noStore });
    body = text ? JSON.parse(text) : null;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400, headers: noStore });
  }
  const res = await handleFinalReportAction(createFinalReportDeps(), req.headers.get('authorization'), body);
  return NextResponse.json(res.body, { status: res.status, headers: noStore });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: noStore });
}
