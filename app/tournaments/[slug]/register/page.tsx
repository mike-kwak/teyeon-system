'use client';

// 2026 TEYEON OPEN — 공개 참가신청(비로그인).
//   Hub(/tournaments/[slug])와 같은 Tournament Design System 을 쓴다. Admin form 스타일 금지.
//   제출 성공 시 접수증을 sessionStorage 로 넘기고 완료 화면으로 이동한다.
//
//   ⚠️ 접수 게이트: 서버가 'open' 이라고 판정했을 때만 폼을 렌더한다.
//      Hub 의 CTA 만 막으면 이 URL 로 직접 들어와 폼을 채울 수 있으므로, 여기서도 같은 판정을 건다.
//      조회 중 / 비공개 / 마감 / 상태 확인 실패는 전부 폼을 렌더하지 않는다(fail-closed).
//      정원(정상 60팀)이 찼어도 접수 기간이면 폼을 보여 준다 — 신청은 대기 접수가 되며, 폼 위에서 먼저 알린다.
//      서버 submit RPC 의 TOURNAMENT_NOT_OPEN / TOURNAMENT_FULL 방어는 그대로 유지된다(최종 방어선).

import React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentRegistrationForm from '@/components/tournaments/TournamentRegistrationForm';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { storeRegistrationReceipt } from '@/lib/tournaments/registrationService';
import {
  CTA_COPY,
  canApply,
  fetchPublicTournamentState,
  toCtaState,
  type PublicTournamentState,
  type RegistrationCtaState,
} from '@/lib/tournaments/publicService';

/**
 * 대기 접수 안내 — 폼 위에 표시된다. 신청 '전에' 대기 접수임을 분명히 알린다.
 *   ⚠ 서버가 준 nextRegistrationWaitlisted 로만 띄운다. 실제 판정은 제출 시 서버가 다시 한다.
 */
function WaitlistNotice({ max }: { max: number }) {
  return (
    <section
      role="note"
      style={{
        marginBottom: 12,
        backgroundColor: '#FEF3C7',
        border: '1px solid #FCD34D',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <p style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: '#92400E', lineHeight: 1.5, wordBreak: 'keep-all' }}>
        지금 신청하면 대기 접수됩니다
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: '#92400E', lineHeight: 1.7, wordBreak: 'keep-all' }}>
        정상 참가 {max}팀이 모두 찼거나 앞선 대기팀이 있습니다. 참가 가능 여부는 대기 순서대로 안내드리며,
        운영진 안내 전에는 입금하지 마세요.
      </p>
    </section>
  );
}

/**
 * 접수 불가 안내 — 폼 대신 표시된다.
 *   문구는 Hub CTA 와 같은 출처(CTA_COPY)를 써서 두 화면이 어긋나지 않게 한다.
 */
function RegistrationGate({
  ctaState,
  hubHref,
  onRetry,
}: {
  ctaState: RegistrationCtaState;
  hubHref: string;
  onRetry: () => void;
}) {
  const copy = CTA_COPY[ctaState];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section
        role="status"
        style={{
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
          borderRadius: 12,
          padding: '28px 18px',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 800,
            color: TT.ink,
            lineHeight: 1.5,
            wordBreak: 'keep-all',
          }}
        >
          {copy.title}
        </p>
        {copy.sub && (
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 12.5,
              fontWeight: 600,
              color: TT.muted,
              lineHeight: 1.75,
              wordBreak: 'keep-all',
            }}
          >
            {copy.sub}
          </p>
        )}
        {ctaState === 'unknown' && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: 16,
              minHeight: 44,
              padding: '11px 20px',
              borderRadius: 9,
              border: `1px solid ${TT.line}`,
              backgroundColor: TT.surface,
              color: TT.teal,
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 800,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            다시 시도
          </button>
        )}
      </section>

      <Link
        href={hubHref}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
      </Link>
    </div>
  );
}

export default function TournamentRegisterPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug =
    typeof params?.slug === 'string'
      ? params.slug
      : Array.isArray(params?.slug)
        ? params!.slug[0]
        : '';

  const event = getOfficialTournament(slug);

  // ⚠️ 훅은 아래 early return 보다 먼저 선언한다(조건부 호출 금지).
  const [state, setState] = React.useState<PublicTournamentState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);

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
        if (!cancelled) setState({ kind: 'unknown' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event, reloadKey]);

  const retry = React.useCallback(() => setReloadKey((k) => k + 1), []);

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
            공식 포스터와 대회요강의 QR 코드로 다시 접속해 주세요.
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

  const hubHref = `/tournaments/${event.slug}`;
  // 서버 판정만 사용. 'open' 이 아니면 폼 자체를 렌더하지 않는다.
  const ctaState = loading ? 'loading' : toCtaState(state);

  return (
    // flexShrink: 0 — GlobalMain 이 flex column + 고정 높이라 없으면 sticky 헤더가 중간에 풀린다(Hub 와 동일).
    <main
      style={{
        width: '100%',
        minHeight: '100%',
        flexShrink: 0,
        backgroundColor: TT.bg,
      }}
    >
      <TournamentPublicHeader shortTag={event.shortTag} backHref={hubHref} />

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
          REGISTRATION
        </p>
        <h1
          style={{
            margin: '9px 0 0',
            fontSize: 24,
            fontWeight: 900,
            letterSpacing: '-0.02em',
            color: TT.ink,
            lineHeight: 1.35,
            wordBreak: 'keep-all',
          }}
        >
          {event.titleFull} 참가 신청
        </h1>
        <p
          style={{
            margin: '9px 0 0',
            fontSize: 13,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.65,
            wordBreak: 'keep-all',
          }}
        >
          {event.eventDateLabel} · {event.startTimeLabel} · {event.venueName}
        </p>
      </div>

      <div
        className="tt-container"
        style={{
          paddingTop: '14px',
          paddingBottom: '32px',
        }}
      >
        {canApply(ctaState) ? (
          <>
          {ctaState === 'waitlist' && <WaitlistNotice max={state && 'status' in state ? state.status.maxCapacity : event.maxCapacity} />}
          <TournamentRegistrationForm
            event={event}
            hubHref={hubHref}
            waitlistExpected={ctaState === 'waitlist'}
            onSubmitted={(receipt) => {
              storeRegistrationReceipt(event.slug, receipt);
              router.push(`${hubHref}/register/complete`);
            }}
          />
          </>
        ) : (
          <RegistrationGate ctaState={ctaState} hubHref={hubHref} onRetry={retry} />
        )}
      </div>
    </main>
  );
}
