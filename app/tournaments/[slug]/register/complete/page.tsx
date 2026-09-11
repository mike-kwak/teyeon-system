'use client';

// 참가신청 완료 화면.
//   접수증은 서버에 다시 물어보지 않고, 신청 직후 저장된 탭 세션(sessionStorage)에서만 읽는다.
//   · 개인정보(선수 이름)를 URL 이나 localStorage 에 남기지 않는다.
//   · 세션이 없으면(직접 URL 진입, 탭 종료 후 재방문) 아무 정보도 만들어내지 않고 안내만 한다.
//   · Hub 로 나갈 때 세션의 접수증을 지운다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentRegistrationComplete from '@/components/tournaments/TournamentRegistrationComplete';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import {
  clearRegistrationReceipt,
  readRegistrationReceipt,
  type TournamentRegistrationReceipt,
} from '@/lib/tournaments/registrationService';

export default function TournamentRegisterCompletePage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string'
      ? params.slug
      : Array.isArray(params?.slug)
        ? params!.slug[0]
        : '';

  const event = getOfficialTournament(slug);

  // sessionStorage 는 서버 렌더 시 존재하지 않으므로 마운트 후에 읽는다.
  const [receipt, setReceipt] = React.useState<TournamentRegistrationReceipt | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!event) return;
    setReceipt(readRegistrationReceipt(event.slug));
    setLoaded(true);
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
          REGISTRATION COMPLETE
        </p>
        <h1
          style={{
            margin: '9px 0 0',
            fontSize: 21,
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
        {loaded ? (
          <TournamentRegistrationComplete
            event={event}
            receipt={receipt}
            hubHref={hubHref}
            onLeave={() => clearRegistrationReceipt(event.slug)}
          />
        ) : (
          <p
            style={{
              margin: 0,
              padding: '28px 0',
              textAlign: 'center',
              fontSize: 12.5,
              fontWeight: 700,
              color: TT.subtle,
            }}
          >
            접수 정보를 불러오는 중…
          </p>
        )}
      </div>
    </main>
  );
}
