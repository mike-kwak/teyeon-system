'use client';

// 공식 LIVE 화면 (/tournaments/[slug]/live) — Hub 의 LIVE 탭.
//
//   영상 소스는 운영진이 정한다(YouTube 기본 · Cloudflare 백업). 이 화면은 /api/tournaments/[slug]/live 응답만 따른다.
//   ⚠ 관리자 기능 · 비밀 값 없음: 방송 주소 수정 · 소스 전환은 Admin LIVE 모니터에만 있다.
//   ⚠ 이 화면은 대회 운영 데이터를 쓰지 않는다. LIVE 가 죽어도 DRAW · 참가팀 · 경기 운영은 그대로다.
//   ⚠ 공개 스위치가 꺼져 있으면 '공개 전' 안내만 한다(영상 · 채팅을 붙이지 않는다).

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, Radio } from 'lucide-react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentNavigation from '@/components/tournaments/TournamentNavigation';
import TournamentLivePanel from '@/components/tournaments/TournamentLivePanel';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { buildHubNavItems } from '@/lib/tournaments/phase';
import { usePublicDrawPublished } from '@/components/tournaments/draw/publicDrawView';
import { PUBLIC_LIVE_ENABLED } from '@/lib/tournaments/publicLiveFlags';

export default function TournamentLivePage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);
  const drawPublished = usePublicDrawPublished(event ? event.slug : '');

  if (!event) {
    return (
      <main style={{ width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, boxSizing: 'border-box' }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink }}>대회를 찾을 수 없습니다.</p>
      </main>
    );
  }

  const hubHref = `/tournaments/${event.slug}`;
  const navItems = buildHubNavItems({ slug: event.slug, current: 'live', phase: 'match_day', drawPublished });

  return (
    // flexShrink: 0 — GlobalMain 이 flex column + 고정 높이라 없으면 sticky 헤더가 중간에 풀린다.
    <main style={{ width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg }}>
      <TournamentPublicHeader shortTag={event.shortTag} backHref={hubHref} />
      <TournamentNavigation items={navItems} defaultNote="대회 진행에 따라 순차 공개" />

      <div className="tt-container" style={{ paddingTop: '22px', paddingBottom: '4px' }}>
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', color: TT.teal }}>
          <Radio size={13} strokeWidth={2.6} />
          LIVE
        </p>
        <h1 style={{ margin: '9px 0 0', fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', color: TT.ink, lineHeight: 1.4, wordBreak: 'keep-all' }}>
          {event.titleFull}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.65, wordBreak: 'keep-all' }}>
          {event.eventDateLabel} · {event.venueName}
        </p>
      </div>

      {/* 영상 · 채팅은 PC 에서 본문 폭보다 넓게(1100px 이상에서만). 모바일은 기존 좌우 여백 그대로. */}
      <div className="tt-live-wide" style={{ paddingTop: '14px', paddingBottom: '8px' }}>
        {PUBLIC_LIVE_ENABLED ? (
          <TournamentLivePanel slug={event.slug} />
        ) : (
          <section data-live-closed style={{ padding: '26px 18px', borderRadius: 12, background: TT.surface, border: `1px solid ${TT.line}`, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: TT.inkSoft }}>LIVE 중계는 대회 당일 공개됩니다.</p>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: TT.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              {event.eventDateLabel} 대회 시작에 맞춰 이 화면에서 경기 영상과 중계 경기 정보를 볼 수 있습니다.
            </p>
          </section>
        )}
      </div>

      <div className="tt-container" style={{ paddingTop: '12px', paddingBottom: '32px' }}>
        <Link href={hubHref} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', minHeight: 50, padding: '13px 18px',
          borderRadius: 9, backgroundColor: TT.surface, border: `1px solid ${TT.line}`, color: TT.inkSoft, fontSize: 14, fontWeight: 700,
          textDecoration: 'none', boxSizing: 'border-box', WebkitTapHighlightColor: 'transparent',
        }}>
          대회 정보로 돌아가기
          <ArrowRight size={15} strokeWidth={2.4} />
        </Link>
      </div>

      <style>{`
        .tt-live-wide { width: 100%; max-width: 430px; margin: 0 auto; padding-left: 18px; padding-right: 18px; box-sizing: border-box; }
        @media (min-width: 768px) { .tt-live-wide { max-width: 680px; padding-left: 32px; padding-right: 32px; } }
        @media (min-width: 1100px) { .tt-live-wide { max-width: 1240px; } }
      `}</style>
    </main>
  );
}
