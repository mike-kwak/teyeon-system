'use client';

// LIVE 송출 PoC 테스트 페이지 (/tournaments/[slug]/live-test).
//
//   목적 하나: 스마트폰 → RTMPS → Cloudflare Stream → 이 페이지에서 실제 재생을 확인한다.
//   ⚠ 참가자 공개용이 아니다. Hub 의 LIVE 탭은 계속 'pending' 이고 이 경로는 링크하지 않는다.
//   ⚠ Provider 미설정이어도 페이지가 깨지지 않는다(safe empty state).
//   ⚠ 이 페이지는 Tournament 운영 데이터를 읽지도 쓰지도 않는다.
//     LIVE 가 죽어도 Hub / 접수 / 참가팀 현황은 그대로 동작한다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentNavigation from '@/components/tournaments/TournamentNavigation';
import TournamentLivePanel from '@/components/tournaments/TournamentLivePanel';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { buildHubNavItems } from '@/lib/tournaments/phase';

export default function TournamentLiveTestPage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string'
      ? params.slug
      : Array.isArray(params?.slug)
        ? params!.slug[0]
        : '';

  const event = getOfficialTournament(slug);

  if (!event) {
    return (
      <main
        style={{
          width: '100%',
          minHeight: '100%',
          flexShrink: 0,
          backgroundColor: TT.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 28,
          boxSizing: 'border-box',
        }}
      >
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink }}>대회를 찾을 수 없습니다.</p>
      </main>
    );
  }

  const hubHref = `/tournaments/${event.slug}`;
  // 이 페이지 안에서만 LIVE 를 현재 위치로 표시한다. Hub 의 LIVE 탭 상태는 바뀌지 않는다.
  const navItems = buildHubNavItems({ slug: event.slug, current: 'live', phase: 'match_day' });

  return (
    // flexShrink: 0 — GlobalMain 이 flex column + 고정 높이라 없으면 sticky 헤더가 중간에 풀린다.
    <main style={{ width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg }}>
      <TournamentPublicHeader shortTag={event.shortTag} backHref={hubHref} />
      <TournamentNavigation items={navItems} defaultNote="대회 진행에 따라 순차 공개" />

      <div className="tt-container" style={{ paddingTop: '22px', paddingBottom: '8px' }}>
        <p
          style={{
            margin: 0,
            fontFamily: FONT_LABEL,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.18em',
            color: TT.teal,
          }}
        >
          LIVE TEST
        </p>
        <h1
          style={{
            margin: '9px 0 0',
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: '-0.02em',
            color: TT.ink,
            lineHeight: 1.4,
            wordBreak: 'keep-all',
          }}
        >
          {event.titleFull}
        </h1>
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.65,
            wordBreak: 'keep-all',
          }}
        >
          현장 송출 연결을 확인하는 내부 테스트 화면입니다. 참가자에게 공개되는 페이지가 아닙니다.
        </p>
      </div>

      <div className="tt-container" style={{ paddingTop: '14px', paddingBottom: '32px' }}>
        <TournamentLivePanel slug={event.slug} />

        <Link
          href={hubHref}
          style={{
            marginTop: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            width: '100%',
            minHeight: 50,
            padding: '13px 18px',
            borderRadius: 9,
            backgroundColor: TT.surface,
            border: `1px solid ${TT.line}`,
            color: TT.inkSoft,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: 'none',
            boxSizing: 'border-box',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          대회 정보로 돌아가기
          <ArrowRight size={15} strokeWidth={2.4} />
        </Link>
      </div>
    </main>
  );
}
