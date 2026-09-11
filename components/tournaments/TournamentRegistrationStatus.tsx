'use client';

// 접수 현황 카드 + 핵심 정보 밴드.
//   ⚠️ 접수 현황 숫자는 반드시 서버(get_public_tournament RPC)에서 온 값만 표시한다.
//      저장소 미적용(ready=false)이면 숫자를 지어내지 않고 '준비 중'으로 표시한다.
//   ⚠️ 정원 판정(48 우선 / 60 최대)은 화면이 아니라 서버 RPC 가 원자적으로 한다. 여기 표시는 안내 전용.
//   ⚠️ 입금 상태는 공개 화면에 표시하지 않는다(운영 내부 정보).

import React from 'react';
import { TT, FONT_LABEL } from './tournamentTheme';
import { won, registrationProgress } from '@/lib/tournaments/format';
import type { OfficialTournament, TournamentPublicStatus } from '@/lib/tournaments/types';

interface Props {
  event: OfficialTournament;
  /** null = 접수 현황 미확보(저장소 미적용 또는 조회 실패). */
  status: TournamentPublicStatus | null;
  loading: boolean;
}

const Eyebrow = ({ open }: { open: boolean }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        backgroundColor: open ? TT.teal : TT.faint,
        flexShrink: 0,
      }}
    />
    <span
      style={{
        fontFamily: FONT_LABEL,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.16em',
        color: open ? TT.teal : TT.muted,
        whiteSpace: 'nowrap',
      }}
    >
      {open ? 'REGISTRATION OPEN' : 'REGISTRATION'}
    </span>
  </span>
);

export default function TournamentRegistrationStatus({ event, status, loading }: Props) {
  const hasCount = !!status;
  const applied = status?.appliedCount ?? 0;
  const target = status?.targetCapacity || event.targetCapacity;
  const max = status?.maxCapacity || event.maxCapacity;
  const progress = hasCount ? registrationProgress(applied, target) : 0;

  return (
    <section
      style={{
        backgroundColor: TT.surface,
        border: `1px solid ${TT.line}`,
        borderRadius: 12,
        padding: '15px 16px 16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <Eyebrow open={hasCount && status!.isRegistrationOpen} />
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: TT.muted,
            whiteSpace: 'nowrap',
          }}
        >
          {event.registrationCloseShort}
        </span>
      </div>

      {hasCount ? (
        <>
          <p
            style={{
              margin: '13px 0 0',
              display: 'flex',
              alignItems: 'baseline',
              gap: 7,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 40, fontWeight: 900, color: TT.ink, lineHeight: 1 }}>
              {applied}
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: TT.faint, lineHeight: 1 }}>
              / {target}
            </span>
            <span
              style={{
                fontFamily: FONT_LABEL,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.14em',
                color: TT.subtle,
              }}
            >
              TEAMS
            </span>
          </p>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={applied}
            style={{
              margin: '13px 0 0',
              height: 6,
              borderRadius: 999,
              backgroundColor: '#E8EDF1',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress * 100}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: TT.teal,
              }}
            />
          </div>

          <div
            style={{
              margin: '10px 0 0',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700, color: TT.muted }}>
              현재 {applied}팀 신청
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: TT.muted }}>
              우선 접수 {target}팀 · 최대 {max}팀
            </span>
          </div>
        </>
      ) : (
        <div style={{ margin: '13px 0 0' }}>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 800,
              color: loading ? TT.subtle : TT.inkSoft,
              lineHeight: 1.5,
              wordBreak: 'keep-all',
            }}
          >
            {loading ? '접수 현황 불러오는 중' : '접수 현황 준비 중'}
          </p>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 12.5,
              fontWeight: 600,
              color: TT.muted,
              lineHeight: 1.6,
              wordBreak: 'keep-all',
            }}
          >
            우선 접수 {target}팀 · 최대 {max}팀
          </p>
        </div>
      )}

      <p
        style={{
          margin: '14px 0 0',
          paddingTop: 13,
          borderTop: `1px solid ${TT.lineSoft}`,
          fontSize: 12.5,
          fontWeight: 600,
          color: TT.inkSoft,
          lineHeight: 1.65,
          wordBreak: 'keep-all',
        }}
      >
        {target}팀은 <strong style={{ fontWeight: 800 }}>우선 참가 기준</strong>이며, 이후 신청은
        대기팀으로 접수될 수 있습니다.
      </p>
    </section>
  );
}

/** 접수 카드 아래 전폭 정보 밴드 — 신청 마감 / 참가비. */
export function TournamentKeyBand({ event }: { event: OfficialTournament }) {
  const row = (label: string, value: string, last?: boolean) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 14,
        padding: last ? '10px 0 0' : '0 0 10px',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.muted, flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 800,
          color: TT.ink,
          textAlign: 'right',
          lineHeight: 1.5,
          wordBreak: 'keep-all',
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ width: '100%', backgroundColor: TT.tint, borderTop: `1px solid ${TT.line}` }}>
      <div className="tt-container" style={{ paddingTop: 14, paddingBottom: 14 }}>
        {row('신청 마감', event.registrationCloseLabel)}
        {row('참가비', `${won(event.entryFee)} / TEAM`, true)}
      </div>
    </div>
  );
}
