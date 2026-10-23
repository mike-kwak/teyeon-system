// LIVE 녹화 ↔ 경기 구간 연결(관리자 전용).
//
//   브라우저(CEO · ADMIN) → 이 route → ① 관리자 확인(본인 토큰으로 get_admin_live_state)
//                                   → ② Cloudflare 녹화 목록(서버 토큰 · GET 만)
//                                   → ③ sync_live_clips(본인 토큰 — 권한 · 연결 규칙은 SQL 이 판정)
//
//   ⚠ Cloudflare API Token 은 서버 밖으로 나가지 않는다. 응답에는 녹화 UID(재생용 공개 ID) · 시각 · 길이만 담는다.
//   ⚠ 관리자가 아니면 Cloudflare 를 부르지 않는다(①에서 끝).
//   ⚠ 녹화를 지우거나 바꾸지 않는다. 연결 시작 이전 녹화(테스트 녹화 포함)는 SQL 이 건너뛴다.
//   ⚠ 기존 공개 LIVE 응답(/api/tournaments/[slug]/live)과 별개 — 이 route 가 실패해도 방송 · 재생은 그대로다.

import { NextResponse, type NextRequest } from 'next/server';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { isStreamConfigured, listLiveRecordings } from '@/lib/tournaments/server/streamProvider';
import { callRestRpc } from '@/lib/tournaments/server/liveMatchProvider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };
const fail = (status: number, reason: string) => NextResponse.json({ ok: false, reason }, { status, headers: noStore });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = typeof rawSlug === 'string' ? rawSlug.slice(0, 80).trim() : '';
  if (!slug || !getOfficialTournament(slug)) return fail(404, 'tournament_not_found');

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length > 4096) return fail(401, 'login_required');

  // ① 관리자 확인 — 본인 토큰으로 관리자 조회 RPC. CEO · ADMIN 이 아니면 SQL 이 42501 로 거부한다.
  const who = await callRestRpc('get_admin_live_state', { p_slug: slug }, token);
  if (!who.ok) {
    if (who.status === 401 || who.status === 403 || who.code === '42501') return fail(403, 'forbidden');
    if (who.status === 404 || who.code === 'PGRST202') return fail(200, 'live_sql_not_applied');
    return fail(502, 'db_unavailable');
  }

  // ② Cloudflare 녹화 목록
  if (!isStreamConfigured()) return fail(200, 'stream_not_configured');
  const list = await listLiveRecordings();
  if (!list.ok) return fail(502, 'provider_unavailable');

  // ③ 연결 — 같은 녹화를 여러 번 보내도 SQL 이 멱등으로 처리한다.
  const sync = await callRestRpc('sync_live_clips', { p_slug: slug, p_recordings: list.recordings }, token);
  if (!sync.ok) {
    if (sync.status === 401 || sync.status === 403 || sync.code === '42501') return fail(403, 'forbidden');
    return fail(502, 'db_unavailable');
  }
  const result = sync.data && typeof sync.data === 'object' ? (sync.data as Record<string, unknown>) : null;
  if (!result || result.ok !== true) return fail(200, String(result?.reason ?? 'sync_rejected'));

  return NextResponse.json({
    ok: true,
    sync: {
      autoSegments: result.autoSegments ?? null,
      clipsWritten: result.clipsWritten ?? null,
      clipsRemoved: result.clipsRemoved ?? null,
      clipsNeedReview: result.clipsNeedReview ?? null,
      recordingsBeforeLinking: result.recordingsBeforeLinking ?? null,
      linkingStartedAt: result.linkingStartedAt ?? null,
    },
    recordings: list.recordings,
  }, { status: 200, headers: noStore });
}

/** POST 외 메서드는 받지 않는다. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: noStore });
}
