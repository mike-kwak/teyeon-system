'use client';

// 공개 DRAW 화면 공통 틀 — TEYEON OPEN 공개 Hub 와 같은 헤더 · 네비게이션 · 컨테이너.
//   ⚠ Admin shell(다크 헤더 · 역할 배지 · BottomNav)을 가져오지 않는다.

import React from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentNavigation from '@/components/tournaments/TournamentNavigation';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { buildHubNavItems, resolvePhase } from '@/lib/tournaments/phase';

type OfficialEvent = NonNullable<ReturnType<typeof getOfficialTournament>>;

export function useDrawEvent(slugParam: string | string[] | undefined) {
  const slug = typeof slugParam === 'string' ? slugParam : Array.isArray(slugParam) ? slugParam[0] : '';
  return { slug, event: getOfficialTournament(slug) };
}

export function PublicDrawShell({
  event, published, children,
}: { event: OfficialEvent; published: boolean; children: React.ReactNode }) {
  const hubHref = `/tournaments/${event.slug}`;
  const navItems = buildHubNavItems({
    slug: event.slug, current: 'draw', phase: resolvePhase(null), drawPublished: published,
  });
  return (
    // flexShrink: 0 — GlobalMain 이 flex column + 고정 높이라 없으면 sticky 헤더가 중간에 풀린다.
    <main style={{ width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg }}>
      <TournamentPublicHeader shortTag={event.shortTag} backHref={hubHref} />
      <TournamentNavigation items={navItems} defaultNote="대회 진행에 따라 순차 공개" />
      <div className="tt-container" style={{ paddingTop: 20, paddingBottom: 32 }}>
        {children}
      </div>
    </main>
  );
}

/** 대회 없음(잘못된 slug). */
export function DrawNotFound() {
  return (
    <main style={{
      width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, boxSizing: 'border-box',
    }}>
      <div style={{ maxWidth: 320, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink, lineHeight: 1.5 }}>대회를 찾을 수 없습니다.</p>
        <Link href="/tournaments/2026-teyeon-open"
          style={{ display: 'inline-block', marginTop: 16, fontSize: 13, fontWeight: 800, color: TT.teal, textDecoration: 'none' }}>
          2026 TEYEON OPEN 보기
        </Link>
      </div>
    </main>
  );
}

/** DRAW 머리 — 라벨 · 제목 · 예선/본선 전환. */
export function DrawHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', color: TT.teal }}>
        DRAW
      </p>
      <h1 style={{ margin: '9px 0 0', fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', color: TT.ink, lineHeight: 1.4, wordBreak: 'keep-all' }}>
        {title}
      </h1>
      <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.65, wordBreak: 'keep-all' }}>
        {sub}
      </p>
    </div>
  );
}

/** 예선 조별리그 | 본선 토너먼트(준비 중). 본선은 이번 범위가 아니다. */
export function DrawStageTabs() {
  const base: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: 46, borderRadius: 9, fontFamily: 'inherit', lineHeight: 1.25,
  };
  return (
    <div role="tablist" aria-label="대진 단계"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 3, padding: 3, background: '#E6EAF0', borderRadius: 12, marginBottom: 12 }}>
      <span role="tab" aria-selected="true"
        style={{ ...base, background: '#fff', color: TT.ink, fontSize: 14, fontWeight: 800, boxShadow: '0 1px 3px rgba(15,23,42,0.10)' }}>
        예선 조별리그
      </span>
      <span role="tab" aria-selected="false" aria-disabled="true"
        style={{ ...base, color: TT.subtle, fontSize: 14, fontWeight: 700 }}>
        본선 토너먼트
        <span style={{ fontSize: 11, fontWeight: 600, color: TT.faint }}>준비 중</span>
      </span>
    </div>
  );
}

/** 아직 공개 전 — 이유(비공개 · 미확정 · 기능 미적용)를 구분하지 않는다. */
export function DrawNotPublished({ hubHref, loading }: { hubHref: string; loading: boolean }) {
  return (
    <div>
      <div style={{
        background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '26px 18px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
      }}>
        {!loading && <CalendarClock size={26} color={TT.teal} strokeWidth={2} />}
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink, lineHeight: 1.5, wordBreak: 'keep-all' }}>
          {loading ? '불러오는 중…' : '예선 조편성이 아직 공개되지 않았습니다.'}
        </p>
        {!loading && (
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.65, wordBreak: 'keep-all' }}>
            참가팀이 확정되고 조편성이 공개되면 이곳에서 조별 순위와 경기 결과를 볼 수 있습니다.
          </p>
        )}
      </div>
      <BackToHub hubHref={hubHref} />
    </div>
  );
}

export function BackToHub({ hubHref }: { hubHref: string }) {
  return (
    <Link href={hubHref} style={{
      marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
      width: '100%', minHeight: 50, padding: '13px 18px', borderRadius: 9, backgroundColor: TT.surface,
      border: `1px solid ${TT.line}`, color: TT.inkSoft, fontSize: 14, fontWeight: 700, textDecoration: 'none',
      boxSizing: 'border-box', WebkitTapHighlightColor: 'transparent',
    }}>
      대회 정보로 돌아가기
      <ArrowRight size={15} strokeWidth={2.4} />
    </Link>
  );
}
