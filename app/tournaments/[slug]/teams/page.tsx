'use client';

// 공개 참가팀 현황 (/tournaments/[slug]/teams).
//   Hub 와 동일한 헤더·네비게이션을 쓰고, TEAMS 탭이 현재 위치가 된다.
//   데이터는 공개 RPC get_public_tournament_teams 하나만 사용한다(원본 테이블 접근 없음).

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentNavigation from '@/components/tournaments/TournamentNavigation';
import PublicTeamList from '@/components/tournaments/PublicTeamList';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { buildHubNavItems, resolvePhase } from '@/lib/tournaments/phase';
import { usePublicDrawPublished } from '@/components/tournaments/draw/publicDrawView';
import {
  fetchPublicTournamentStatus,
  fetchPublicTournamentTeams,
  type PublicTournamentTeam,
} from '@/lib/tournaments/publicService';

export default function TournamentTeamsPage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string'
      ? params.slug
      : Array.isArray(params?.slug)
        ? params!.slug[0]
        : '';

  const event = getOfficialTournament(slug);

  const [teams, setTeams] = React.useState<PublicTournamentTeam[]>([]);
  const [ready, setReady] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<string | null>(null);
  // DRAW 탭 — 운영진이 예선 DRAW 를 공개했을 때만 연다(기능 스위치가 꺼져 있으면 항상 준비 중).
  const drawPublished = usePublicDrawPublished(event ? event.slug : '');

  React.useEffect(() => {
    if (!event) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPublicTournamentTeams(event.slug), fetchPublicTournamentStatus(event.slug)])
      .then(([t, s]) => {
        if (cancelled) return;
        // 대회가 비공개(draft)면 공개 상태 RPC 가 null 을 준다.
        //   이때 팀 목록은 [] 로 오지만 그건 '팀이 0개'가 아니라 '아직 공개 전'이므로
        //   '아직 접수된 팀이 없습니다'가 아니라 '준비 중'으로 안내해야 한다.
        setReady(t.ready && !!s.status);
        setTeams(t.teams);
        setStatus(s.status ? 'known' : null);
      })
      .catch(() => {
        if (!cancelled) {
          setReady(false);
          setTeams([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event]);

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
        <div style={{ maxWidth: 320, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink, lineHeight: 1.5 }}>
            대회를 찾을 수 없습니다.
          </p>
          <Link
            href="/tournaments/2026-teyeon-open"
            style={{ display: 'inline-block', marginTop: 16, fontSize: 13, fontWeight: 800, color: TT.teal, textDecoration: 'none' }}
          >
            2026 TEYEON OPEN 보기
          </Link>
        </div>
      </main>
    );
  }

  const hubHref = `/tournaments/${event.slug}`;
  // 공개 RPC 가 대회를 돌려주지 않으면(비공개/draft) preparing 으로 본다.
  const phase = resolvePhase(status ? 'registration_open' : null);
  const navItems = buildHubNavItems({ slug: event.slug, current: 'teams', phase, drawPublished });

  return (
    // flexShrink: 0 — GlobalMain 이 flex column + 고정 높이라 없으면 sticky 헤더가 중간에 풀린다.
    <main style={{ width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg }}>
      <TournamentPublicHeader shortTag={event.shortTag} backHref={hubHref} />
      <TournamentNavigation items={navItems} defaultNote="대회 진행에 따라 순차 공개" />

      <div
        className="tt-container"
        style={{
          paddingTop: '22px',
          paddingBottom: '8px',
        }}
      >
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
          TEAMS
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
          참가팀 현황
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
          {event.titleFull} · 모집 {event.targetCapacity}팀 · 최대 {event.maxCapacity}팀 참가 · 이후 대기 접수
        </p>
      </div>

      <div
        className="tt-container"
        style={{
          paddingTop: '14px',
          paddingBottom: '32px',
        }}
      >
        <PublicTeamList teams={teams} ready={ready} loading={loading} />

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
