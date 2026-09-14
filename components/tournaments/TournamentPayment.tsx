'use client';

// 참가비 · 입금계좌 — Hub INFO 영역에서 '언제든 다시' 확인할 수 있게 상시 노출한다.
//
//   ⚠ 계좌 값을 이 파일에 하드코딩하지 않는다.
//     은행·계좌·예금주는 hosted_tournaments.bank_* 를 공개 RPC 가 내려준 값만 쓴다.
//     RPC 가 계좌를 반환하지 않는 동안에는 계좌 블록을 아예 렌더하지 않고
//     "신청 완료 화면에서 확인" 안내만 보여준다(가짜 계좌를 만들어내지 않는다).
//   ⚠ 참가비는 공개 RPC 의 entryFee(DB 값)를 우선 쓰고, 조회 전에는 공식 요강 값으로 표시한다.
//   ⚠ 대기팀이 먼저 입금하는 사고를 막는 문구를 계좌와 같은 카드에 둔다.

import React from 'react';
import { Copy, Check, Info } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import { SectionHeading } from './TournamentSection';
import { won } from '@/lib/tournaments/format';
import type { OfficialTournament, TournamentPublicStatus } from '@/lib/tournaments/types';

interface Props {
  event: OfficialTournament;
  /** 공개 RPC 결과. 조회 전/실패 시 null. */
  status: TournamentPublicStatus | null;
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1600);
          })
          .catch(() => {
            // 클립보드 권한이 없는 브라우저 — 계좌는 화면에 그대로 보이므로 무시한다.
          });
      }}
      aria-label="계좌번호 복사"
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minHeight: 34,
        padding: '7px 11px',
        borderRadius: 8,
        border: `1px solid ${TT.line}`,
        backgroundColor: TT.surface,
        color: done ? TT.teal : TT.inkSoft,
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 800,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {done ? <Check size={13} strokeWidth={2.6} /> : <Copy size={13} strokeWidth={2.2} />}
      {done ? '복사됨' : '복사'}
    </button>
  );
}

const rowLabel: React.CSSProperties = {
  flexShrink: 0,
  minWidth: 54,
  fontSize: 11.5,
  fontWeight: 800,
  color: TT.subtle,
  lineHeight: 1.6,
};
const rowValue: React.CSSProperties = {
  minWidth: 0,
  fontSize: 14,
  fontWeight: 800,
  color: TT.ink,
  lineHeight: 1.6,
  wordBreak: 'break-all',
};

export default function TournamentPayment({ event, status }: Props) {
  // DB 값이 있으면 그것을, 없으면 공식 요강의 참가비를 쓴다(둘 다 같은 값이어야 정상).
  const fee = status?.entryFee && status.entryFee > 0 ? status.entryFee : event.entryFee;
  const hasBank = !!(status?.bankName && status?.bankAccount && status?.bankHolder);

  return (
    <section>
      <SectionHeading id="tournament-payment" label="ENTRY FEE · 입금계좌" />

      <div
        style={{
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
          borderRadius: 12,
          padding: '16px 16px 14px',
        }}
      >
        {/* 참가비 */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: FONT_LABEL,
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: '0.14em',
              color: TT.teal,
            }}
          >
            ENTRY FEE
          </span>
          <span style={{ fontSize: 19, fontWeight: 900, color: TT.ink, lineHeight: 1.35 }}>
            {won(fee)}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.muted }}>/ 팀</span>
        </div>

        {hasBank ? (
          <>
            <div style={{ height: 1, backgroundColor: TT.lineSoft, margin: '13px 0 12px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={rowLabel}>은행</span>
                <span style={rowValue}>{status!.bankName}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={rowLabel}>계좌번호</span>
                <span style={{ ...rowValue, flex: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {status!.bankAccount}
                </span>
                <CopyButton value={status!.bankAccount!} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={rowLabel}>예금주</span>
                <span style={rowValue}>{status!.bankHolder}</span>
              </div>
            </div>
          </>
        ) : (
          <p
            style={{
              margin: '12px 0 0',
              fontSize: 12.5,
              fontWeight: 600,
              color: TT.muted,
              lineHeight: 1.75,
              wordBreak: 'keep-all',
            }}
          >
            입금 계좌는 참가신청 완료 화면에서 안내됩니다. 계좌 확인이 필요하면 대회 운영본부로 문의해 주세요.
          </p>
        )}

        {/* 입금 시점 안내 — 대기팀 선입금 방지가 핵심이다. */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 14,
            padding: '11px 12px',
            borderRadius: 9,
            backgroundColor: TT.tint,
          }}
        >
          <Info size={14} strokeWidth={2.2} color={TT.teal} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                fontWeight: 800,
                color: TT.ink,
                lineHeight: 1.7,
                wordBreak: 'keep-all',
              }}
            >
              접수 완료 후 입금해 주세요.
            </p>
            <p
              style={{
                margin: '3px 0 0',
                fontSize: 12.5,
                fontWeight: 700,
                color: '#B45309',
                lineHeight: 1.7,
                wordBreak: 'keep-all',
              }}
            >
              대기 접수는 운영진 연락 후 입금해 주세요.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
