// LIVE 상태 조회 엔드포인트.
//
//   브라우저 → 이 route → Cloudflare Stream API
//   브라우저가 Cloudflare API 를 직접 부르지 않는다. API Token 이 서버 밖으로 나가지 않게 하기 위함이다.
//
//   ⚠ 응답에 담기지 않는 것: API Token · RTMPS Stream Key · SRT credential · Account ID.
//     담기는 것은 재생용 공개 URL(iframe) 과 상태/시청자 수뿐이다.
//   ⚠ Provider 장애는 200 + state:'unavailable' 로 돌려준다.
//     여기서 5xx 를 던지면 화면이 오류로 번진다 — LIVE 는 Tournament 의 optional subsystem 이다.
//
//   ⚠ 지금 중계 경기(liveMatch)는 영상 Provider 와 따로 조회한다. 어느 한쪽이 실패해도 다른 쪽은 그대로 응답한다.
//     경기 정보는 공개 RPC(get_public_live_match — DRAW 공개 조건 적용) 결과를 화이트리스트로 다시 담은 값뿐이다.
//
//   미들웨어 matcher 는 '/admin/:path*' 이므로 이 경로에 관여하지 않는다.

import { NextResponse, type NextRequest } from 'next/server';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { getLiveSnapshot, isStreamConfigured, playbackUrlLike } from '@/lib/tournaments/server/streamProvider';
import { getPublicLiveMatch, getPublicLiveReplaysRaw } from '@/lib/tournaments/server/liveMatchProvider';
import { getLiveSource } from '@/lib/tournaments/server/liveSourceProvider';
import { LIVE_MATCH_UNAVAILABLE, parseLiveMatchReplays } from '@/lib/tournaments/liveMatch';
import type { LivePayload } from '@/lib/tournaments/liveTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

function empty(configured: boolean): LivePayload {
  return {
    configured,
    state: 'unavailable',
    providerStatus: null,
    viewers: null,
    playbackUrl: null,
    replays: [],
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // Next 15 에서 params 는 Promise 다.
  const { slug: rawSlug } = await ctx.params;
  const slug = typeof rawSlug === 'string' ? rawSlug.slice(0, 80).trim() : '';

  // 알 수 없는 slug 로는 Provider 를 호출하지 않는다.
  if (!slug || !getOfficialTournament(slug)) {
    return NextResponse.json(empty(false), { status: 404, headers: noStore });
  }

  // Live Input 은 환경변수 1개로 고정 운용한다(대회별 분기 없음).
  //   영상 상태 · 경기 정보 · 확정 경기별 다시보기를 동시에 조회하고, 서로의 실패를 섞지 않는다(allSettled).
  //   영상 소스(YouTube 기본 · Cloudflare 백업)도 따로 조회한다 — 소스 조회가 실패해도 Cloudflare 상태 · 경기 정보는 그대로.
  const [video, match, replaysRaw, source] = await Promise.allSettled([
    isStreamConfigured() ? getLiveSnapshot() : Promise.resolve(empty(false)),
    getPublicLiveMatch(slug),
    getPublicLiveReplaysRaw(slug),
    getLiveSource(slug),
  ]);
  const base = video.status === 'fulfilled' ? video.value : empty(isStreamConfigured());
  // 경기별 다시보기 재생 URL 은 이 응답의 재생 주소(customer 서브도메인)를 기준으로 만든다 — 없으면 null.
  const ref = base.playbackUrl ?? base.replays[0]?.playbackUrl ?? null;
  const payload: LivePayload = {
    ...base,
    // ⚠ Cloudflare 원본 녹화 목록(테스트 녹화 포함 · 경기와 연결 안 됨)은 공개 응답에 싣지 않는다.
    //   참가자에게는 관리자가 확정한 경기별 다시보기(matchReplays)와 YouTube 다시보기만 보인다.
    //   원본 녹화 확인 · 연결은 관리자 녹화 패널(LiveReplayAdminPanel)에서 한다.
    replays: [],
    liveMatch: match.status === 'fulfilled' ? match.value : LIVE_MATCH_UNAVAILABLE,
    matchReplays: replaysRaw.status === 'fulfilled'
      ? parseLiveMatchReplays(replaysRaw.value, (uid) => playbackUrlLike(ref, uid))
      : [],
    source: source.status === 'fulfilled' ? source.value : undefined,
  };
  return NextResponse.json(payload, { status: 200, headers: noStore });
}

/** GET 외 메서드는 받지 않는다. */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: noStore });
}
