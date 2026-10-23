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

/** DRAW 메뉴 — 대진표(전체 조편성표) · 예선(모바일 대진표: 조별 · 코트별) · 본선(본선 토너먼트). */
export type DrawStage = 'sheet' | 'board' | 'knockout';

/**
 * 대진표 | 예선 | 본선.
 *   · 대진표 = /draw(전체 조편성표) · 예선 = /draw?view=board(모바일 대진표) · 본선 = /draw/knockout — 기존 주소 · 공유 링크 그대로.
 *   · 예선 화면 안에서는 onPrelimSelect 로 보기만 바꾼다(다시 불러오지 않음). 본선 화면에서는 링크로 이동한다.
 *   ⚠ 본선 탭은 knockoutOpen 일 때만 링크가 된다. 그 전에는 지금까지처럼 '준비 중' 으로 둔다
 *     (기능 스위치가 꺼진 운영 환경에서 동작이 달라지지 않게).
 *   ⚠ 'preliminary' 는 예전 호출 호환용(= 대진표).
 */
export function DrawStageTabs({
  slug, active = 'sheet', knockoutOpen = false, onPrelimSelect,
}: {
  slug?: string; active?: DrawStage | 'preliminary'; knockoutOpen?: boolean;
  /** 예선 화면 안에서 대진표 ↔ 예선 전환(주소 이동 없이). 없으면 링크로 이동한다. */
  onPrelimSelect?: (v: 'sheet' | 'board') => void;
} = {}) {
  const cur: DrawStage = active === 'preliminary' ? 'sheet' : active;
  const base: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: 46, minWidth: 0, borderRadius: 9, border: 0, fontFamily: 'inherit', lineHeight: 1.25,
    textDecoration: 'none', WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap', cursor: 'pointer',
  };
  const on: React.CSSProperties = {
    background: '#fff', color: TT.ink, fontSize: 14.5, fontWeight: 800,
    boxShadow: '0 1px 3px rgba(15,23,42,0.10)',
  };
  const off: React.CSSProperties = { background: 'transparent', color: TT.inkSoft, fontSize: 14.5, fontWeight: 700 };

  const sheetHref = slug ? `/tournaments/${slug}/draw` : null;
  const boardHref = slug ? `/tournaments/${slug}/draw?view=board` : null;
  const knockoutHref = slug && knockoutOpen ? `/tournaments/${slug}/draw/knockout` : null;

  const prelimTab = (v: 'sheet' | 'board', label: string, href: string | null) => {
    if (cur === v) return <span key={v} role="tab" aria-selected data-draw-view={v} data-draw-stage={v} style={{ ...base, ...on }}>{label}</span>;
    if (onPrelimSelect) {
      return (
        <button key={v} type="button" role="tab" aria-selected={false} data-draw-view={v} data-draw-stage={v}
          onClick={() => onPrelimSelect(v)} style={{ ...base, ...off }}>{label}</button>
      );
    }
    return href
      ? <Link key={v} role="tab" aria-selected={false} href={href} data-draw-stage={v} style={{ ...base, ...off }}>{label}</Link>
      : <span key={v} role="tab" aria-selected={false} data-draw-stage={v} style={{ ...base, ...off }}>{label}</span>;
  };

  return (
    <div role="tablist" aria-label="대진표 메뉴" data-draw-stages
      style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3, padding: 3, background: '#E6EAF0', borderRadius: 12, marginBottom: 12 }}>
      {prelimTab('sheet', '대진표', sheetHref)}
      {prelimTab('board', '예선', boardHref)}
      {cur === 'knockout' ? (
        <span role="tab" aria-selected data-draw-stage="knockout" style={{ ...base, ...on }}>본선</span>
      ) : knockoutHref ? (
        <Link role="tab" aria-selected={false} href={knockoutHref} data-draw-stage="knockout" style={{ ...base, ...off }}>
          본선
        </Link>
      ) : (
        <span role="tab" aria-selected={false} aria-disabled="true" data-draw-stage="knockout"
          style={{ ...base, color: TT.subtle, fontSize: 14.5, fontWeight: 700, cursor: 'default' }}>
          본선
          <span style={{ fontSize: 11, fontWeight: 600, color: TT.faint }}>준비 중</span>
        </span>
      )}
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
