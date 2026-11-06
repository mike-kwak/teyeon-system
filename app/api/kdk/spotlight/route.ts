// MATCH SPOTLIGHT 운영 API(CEO · ADMIN · KDK 관리자 — can_manage_kdk 판정).
//
//   POST { action: 'generate', sessionId } | { action: 'publish', runId } | { action: 'unpublish', sessionId }
//   Authorization: Bearer <사용자 access token>
//
//   ⚠ 인증·권한은 서버에서 다시 검증한다(lib/kdk/server/spotlightHandler).
//   ⚠ 예측은 서버가 DB 원본으로 계산한다 — 요청 body 의 확률·선정 값은 사용하지 않는다.
//   ⚠ service_role 키는 이 서버 route 안에서만 쓰이며 응답에 포함되지 않는다.
//   공개 조회는 이 route 가 아니라 anon RPC(get_public_kdk_spotlight)로 /club/spotlight/[slug] 가 한다.

import { NextResponse, type NextRequest } from 'next/server';
import { handleSpotlightAction } from '@/lib/kdk/server/spotlightHandler';
import { createSpotlightDeps } from '@/lib/kdk/server/spotlightService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown = null;
  try {
    const text = await req.text();
    if (text.length > 4096) return NextResponse.json({ ok: false, reason: 'payload_too_large' }, { status: 413, headers: noStore });
    body = text ? JSON.parse(text) : null;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400, headers: noStore });
  }
  const res = await handleSpotlightAction(createSpotlightDeps(), req.headers.get('authorization'), body);
  return NextResponse.json(res.body, { status: res.status, headers: noStore });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: noStore });
}
