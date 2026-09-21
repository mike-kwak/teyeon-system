'use client';

// 2026 TEYEON OPEN — 공개 Tournament Hub (QR 영구 진입점 /tournaments/2026-teyeon-open).
//
//   · 비로그인 외부 참가자 전용. 회원 chrome 없음.
//   · 대회 확정 정보는 lib/tournaments/officialInfo.ts(공식 요강 SSOT)에서만 온다.
//   · 접수 현황 숫자는 공개 RPC 값이 있을 때만 표시한다(가짜 숫자 금지).
//   · 준비중 단계(DRAW/LIVE/RESULTS)는 숨기지 않고 공개 시점을 안내한다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TT } from '@/components/tournaments/tournamentTheme';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentNavigation from '@/components/tournaments/TournamentNavigation';
import TournamentHero from '@/components/tournaments/TournamentHero';
import TournamentRegistrationStatus, {
  TournamentKeyBand,
} from '@/components/tournaments/TournamentRegistrationStatus';
import TournamentInfo from '@/components/tournaments/TournamentInfo';
import TournamentPayment from '@/components/tournaments/TournamentPayment';
import TournamentPrize from '@/components/tournaments/TournamentPrize';
import TournamentFormat from '@/components/tournaments/TournamentFormat';
import TournamentRegulations from '@/components/tournaments/TournamentRegulations';
import TournamentJoinCta from '@/components/tournaments/TournamentJoinCta';
import TournamentFooter from '@/components/tournaments/TournamentFooter';
import TournamentStickyBar from '@/components/tournaments/TournamentStickyBar';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import {
  fetchPublicTournamentState,
  toCtaState,
  type PublicTournamentState,
} from '@/lib/tournaments/publicService';
import { buildHubNavItems, resolvePhase } from '@/lib/tournaments/phase';
import { usePublicDrawPublished } from '@/components/tournaments/draw/publicDrawView';

const REGULATIONS_ANCHOR = '#tournament-regulations';

/** 단계별 공개 시점 — 요강에 없는 새 규정이 아니라 사이트 운영 안내 문구. */
const NAV_DEFAULT_NOTE = '대회 진행에 따라 순차 공개';

const Padded = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => (
  <div className="tt-container" style={style}>
    {children}
  </div>
);

function TournamentNotFound() {
  return (
    <main
      style={{
        width: '100%',
        minHeight: '100%',
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
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 12.5,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.7,
            wordBreak: 'keep-all',
          }}
        >
          주소가 정확한지 확인해 주세요. 공식 포스터와 대회요강의 QR 코드로 다시 접속하시면 됩니다.
        </p>
        <Link
          href="/tournaments/2026-teyeon-open"
          style={{
            display: 'inline-block',
            marginTop: 16,
            fontSize: 13,
            fontWeight: 800,
            color: TT.teal,
            textDecoration: 'none',
          }}
        >
          2026 TEYEON OPEN 보기
        </Link>
      </div>
    </main>
  );
}

export default function TournamentHubPage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string'
      ? params.slug
      : Array.isArray(params?.slug)
        ? params!.slug[0]
        : '';

  const event = getOfficialTournament(slug);

  // 서버가 판정한 접수 상태. 화면에서 접수 가능 여부를 새로 계산하지 않는다.
  const [state, setState] = React.useState<PublicTournamentState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);

  // 히어로가 화면에서 벗어난 뒤에만 하단 고정 바를 띄운다(첫 화면 CTA 와 중복 방지).
  const heroRef = React.useRef<HTMLDivElement | null>(null);
  const [barShown, setBarShown] = React.useState(false);
  // DRAW 탭 — 운영진이 예선 DRAW 를 공개했을 때만 연다(기능 스위치가 꺼져 있으면 항상 준비 중).
  const drawPublished = usePublicDrawPublished(event ? event.slug : '');

  React.useEffect(() => {
    if (!event) return;
    let cancelled = false;
    setLoading(true);
    setState(null);
    fetchPublicTournamentState(event.slug)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch(() => {
        // 서비스가 이미 fail-closed 로 처리하지만, 예상 밖 예외도 신청 불가로 닫는다.
        if (!cancelled) setState({ kind: 'unknown' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event, reloadKey]);

  /** 'unknown'(상태 확인 실패) 일 때 사용자가 직접 다시 조회. */
  const retry = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setBarShown(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [event]);

  if (!event) return <TournamentNotFound />;

  const registerHref = `/tournaments/${event.slug}/register`;

  // 표시용 접수 숫자 — 조회에 성공했을 때만 존재한다(가짜 숫자 금지).
  const status = state && (state.kind === 'open' || state.kind === 'closed') ? state.status : null;
  // CTA 판정 — 서버 판정('open')일 때만 신청을 허용한다.
  //   조회 중 / 비공개(draft) / 마감 / 만석 / 상태 확인 실패는 전부 신청 불가(fail-closed).
  const ctaState = loading ? 'loading' : toCtaState(state);

  // 탭 구성은 lib/tournaments/phase 한 곳에서만 정한다(향후 phase 별 기본 탭 확장 지점).
  const phase = resolvePhase(status?.isRegistrationOpen ? 'registration_open' : null);
  const navItems = buildHubNavItems({ slug: event.slug, current: 'info', phase, drawPublished });

  return (
    // ⚠️ flexShrink: 0 은 필수다.
    //    GlobalMain(단일 스크롤러)이 display:flex + flexDirection:column + 고정 높이(100dvh)이므로,
    //    긴 페이지의 root 는 기본 flex-shrink:1 로 뷰포트 높이까지 '눌린다'. 그러면 그 안의
    //    position:sticky 헤더가 눌린 높이(약 820px)까지만 고정되고 그 아래로는 함께 밀려 올라간다.
    //    flexShrink:0 으로 실제 콘텐츠 높이를 유지해야 헤더가 페이지 끝까지 상단에 고정된다.
    <main
      style={{
        width: '100%',
        minHeight: '100%',
        flexShrink: 0,
        backgroundColor: TT.bg,
      }}
    >
      <TournamentPublicHeader shortTag={event.shortTag} />
      <TournamentNavigation items={navItems} defaultNote={NAV_DEFAULT_NOTE} />

      <div ref={heroRef}>
        <Padded>
          <TournamentHero
            event={event}
            registerHref={registerHref}
            regulationsHref={REGULATIONS_ANCHOR}
            ctaState={ctaState}
            onRetry={retry}
          />
        </Padded>
      </div>

      <Padded style={{ paddingTop: 22, paddingBottom: 20 }}>
        <TournamentRegistrationStatus event={event} status={status} loading={loading} />
      </Padded>

      <TournamentKeyBand event={event} />

      <Padded style={{ paddingTop: 30 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
          <TournamentInfo event={event} />
          {/* 참가비·입금계좌 — 신청 후에도 Hub 에서 다시 확인할 수 있게 상시 노출. */}
          <TournamentPayment event={event} status={status} />
          <TournamentPrize event={event} />
          <TournamentFormat event={event} regulationsHref={REGULATIONS_ANCHOR} />
          <TournamentRegulations event={event} />
          <TournamentJoinCta
            event={event}
            status={status}
            registerHref={registerHref}
            ctaState={ctaState}
            onRetry={retry}
          />
        </div>
        <TournamentFooter event={event} />
      </Padded>

      <TournamentStickyBar
        event={event}
        status={status}
        registerHref={registerHref}
        shown={barShown}
        ctaState={ctaState}
      />
    </main>
  );
}
