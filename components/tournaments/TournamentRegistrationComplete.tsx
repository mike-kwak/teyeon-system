'use client';

// 참가신청 완료 화면.
//
//   원칙
//     · "신청 완료 = 참가 확정"으로 읽히지 않게 한다. 완료 화면 전체에서 이 구분이 가장 눈에 띄어야 한다.
//     · applied(우선 참가 대상)와 waitlisted(대기 접수)는 화면을 다르게 구성한다.
//     · ⚠ waitlisted 에는 입금 안내·계좌·입금 CTA 를 절대 표시하지 않는다.
//       대기팀(49~60) 입금 정책이 확정되지 않았으므로 서버도 계좌를 내려주지 않고(payment=null),
//       화면도 입금을 유도하는 문구를 만들지 않는다.
//     · 접수증이 없으면(직접 URL 진입 / 세션 유실) 안전한 안내만 보여준다 — 가짜 완료 화면을 만들지 않는다.

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Copy, Check, Phone, AlertTriangle } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import { won } from '@/lib/tournaments/format';
import type { TournamentRegistrationReceipt } from '@/lib/tournaments/registrationService';
import type { OfficialTournament } from '@/lib/tournaments/types';

interface Props {
  event: OfficialTournament;
  /** null = 접수증 없음(직접 진입/세션 유실). */
  receipt: TournamentRegistrationReceipt | null;
  hubHref: string;
  /** Hub 로 이동하며 세션에 남은 접수증을 정리한다. */
  onLeave: () => void;
}

/** 클립보드 복사. execCommand 폴백까지 두어 인앱 브라우저에서도 동작하게 한다. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 폴백으로 진행
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1800);
    return () => window.clearTimeout(t);
  }, [done]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        if (await copyText(value)) setDone(true);
      }}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        minHeight: 36,
        padding: '8px 12px',
        borderRadius: 8,
        border: `1px solid ${done ? TT.teal : TT.line}`,
        backgroundColor: done ? TT.tealSoft : TT.surface,
        color: done ? TT.tealDeep : TT.inkSoft,
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 800,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {done ? <Check size={13} strokeWidth={2.6} /> : <Copy size={13} strokeWidth={2.4} />}
      {done ? '복사됨' : '복사'}
    </button>
  );
}

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <section
    style={{
      backgroundColor: TT.surface,
      border: `1px solid ${TT.line}`,
      borderRadius: 12,
      padding: '16px 16px 17px',
      ...style,
    }}
  >
    {children}
  </section>
);

const CardLabel = ({ children }: { children: React.ReactNode }) => (
  <p
    style={{
      margin: 0,
      fontFamily: FONT_LABEL,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '0.16em',
      color: TT.teal,
    }}
  >
    {children}
  </p>
);

const Row = ({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 14,
      padding: '11px 0',
      borderBottom: last ? 'none' : `1px solid ${TT.lineSoft}`,
    }}
  >
    <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: TT.muted }}>{label}</span>
    <span
      style={{
        minWidth: 0,
        fontSize: 13.5,
        fontWeight: 800,
        color: TT.ink,
        textAlign: 'right',
        lineHeight: 1.55,
        wordBreak: 'keep-all',
      }}
    >
      {value}
    </span>
  </div>
);

function ContactBlock({ event }: { event: OfficialTournament }) {
  const primary = event.contacts.find((c) => c.primary) ?? event.contacts[0];
  if (!primary) return null;
  return (
    <Card>
      <CardLabel>CONTACT</CardLabel>
      <p
        style={{
          margin: '9px 0 0',
          fontSize: 12,
          fontWeight: 600,
          color: TT.muted,
          lineHeight: 1.65,
          wordBreak: 'keep-all',
        }}
      >
        접수 내용 수정이나 문의가 필요하면 연락해 주세요.
      </p>
      <a
        href={`tel:${primary.phone.replace(/[^0-9]/g, '')}`}
        style={{
          marginTop: 11,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 46,
          textDecoration: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: TT.teal, minWidth: 26 }}>
          {primary.role}
        </span>
        <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: TT.ink }}>
          {primary.name}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 800,
            color: TT.teal,
            whiteSpace: 'nowrap',
          }}
        >
          <Phone size={13} strokeWidth={2.4} />
          {primary.phone}
        </span>
      </a>
    </Card>
  );
}

function Actions({ hubHref, onLeave }: { hubHref: string; onLeave: () => void }) {
  const teamsHref = `${hubHref}/teams`;
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    minHeight: 54,
    padding: '15px 18px',
    borderRadius: 9,
    fontSize: 15,
    fontWeight: 800,
    textDecoration: 'none',
    boxSizing: 'border-box',
    WebkitTapHighlightColor: 'transparent',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Link
        href={hubHref}
        onClick={onLeave}
        style={{ ...base, backgroundColor: TT.teal, color: '#FFFFFF' }}
      >
        대회 정보로 돌아가기
      </Link>
      <Link
        href={teamsHref}
        onClick={onLeave}
        style={{
          ...base,
          minHeight: 50,
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
          color: TT.inkSoft,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        참가팀 현황 보기
      </Link>
    </div>
  );
}

/** 접수증 없음 — 직접 URL 진입 / 탭 세션 유실. 가짜 완료 화면을 만들지 않는다. */
function NoReceipt({
  event,
  hubHref,
  onLeave,
}: {
  event: OfficialTournament;
  hubHref: string;
  onLeave: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
          <AlertTriangle size={20} strokeWidth={2.2} color={TT.subtle} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800, color: TT.ink, lineHeight: 1.5, wordBreak: 'keep-all' }}>
              접수 완료 정보를 표시할 수 없습니다
            </p>
            <p
              style={{
                margin: '9px 0 0',
                fontSize: 12.5,
                fontWeight: 600,
                color: TT.muted,
                lineHeight: 1.75,
                wordBreak: 'keep-all',
              }}
            >
              접수 완료 정보는 신청 직후 화면에서 확인할 수 있습니다. 참가현황 또는 운영진 문의를 이용해
              주세요.
            </p>
          </div>
        </div>
      </Card>
      <ContactBlock event={event} />
      <Actions hubHref={hubHref} onLeave={onLeave} />
    </div>
  );
}

export default function TournamentRegistrationComplete({ event, receipt, hubHref, onLeave }: Props) {
  if (!receipt) return <NoReceipt event={event} hubHref={hubHref} onLeave={onLeave} />;

  const waitlisted = receipt.registrationStatus === 'waitlisted';
  const accent = waitlisted ? '#B45309' : TT.teal;
  const accentSoft = waitlisted ? '#FEF3C7' : TT.tealSoft;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 접수 결과 */}
      <section
        style={{
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
          borderTop: `3px solid ${accent}`,
          borderRadius: 12,
          padding: '22px 18px 20px',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 54,
            height: 54,
            borderRadius: '50%',
            backgroundColor: accentSoft,
            color: accent,
          }}
        >
          {waitlisted ? <Clock size={27} strokeWidth={2} /> : <CheckCircle2 size={28} strokeWidth={2} />}
        </span>
        <p
          style={{
            margin: '14px 0 0',
            fontSize: 20,
            fontWeight: 900,
            color: TT.ink,
            lineHeight: 1.4,
            wordBreak: 'keep-all',
          }}
        >
          {waitlisted ? '대기 접수되었습니다' : '참가신청 접수 완료'}
        </p>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 13,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.75,
            wordBreak: 'keep-all',
          }}
        >
          {waitlisted
            ? '참가 가능 여부는 운영진 확인 후 안내됩니다.'
            : '접수번호를 저장해 주세요. 접수 내용 확인 시 사용됩니다.'}
        </p>
      </section>

      {/* 접수번호 */}
      <section
        style={{
          backgroundColor: accentSoft,
          borderRadius: 12,
          padding: '15px 16px',
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: FONT_LABEL,
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '0.16em',
            color: accent,
          }}
        >
          REGISTRATION NO
        </p>
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              minWidth: 0,
              flex: 1,
              fontFamily: FONT_LABEL,
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: '0.04em',
              color: TT.ink,
              lineHeight: 1.25,
              wordBreak: 'break-all',
            }}
          >
            {receipt.registrationNo}
          </span>
          <CopyButton value={receipt.registrationNo} label="접수번호 복사" />
        </div>
      </section>

      {/* 신청 내용 */}
      <Card>
        <CardLabel>REGISTRATION</CardLabel>
        <div style={{ marginTop: 6 }}>
          <Row label="선수 1" value={receipt.player1Name} />
          <Row label="선수 2" value={receipt.player2Name} />
          <Row
            label="접수 상태"
            value={
              <span
                style={{
                  display: 'inline-block',
                  padding: '3px 10px',
                  borderRadius: 999,
                  backgroundColor: accentSoft,
                  color: accent,
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {waitlisted ? '대기 접수' : '접수 완료'}
              </span>
            }
          />
          <Row label="참가비" value={`팀당 ${won(receipt.entryFee || event.entryFee)}`} last />
        </div>
      </Card>

      {/* 입금 안내 — applied 이고 서버가 계좌를 내려준 경우에만. */}
      {!waitlisted && receipt.payment && (
        <Card>
          <CardLabel>PAYMENT</CardLabel>
          <p
            style={{
              margin: '9px 0 0',
              fontSize: 12.5,
              fontWeight: 600,
              color: TT.muted,
              lineHeight: 1.7,
              wordBreak: 'keep-all',
            }}
          >
            아래 계좌로 참가비를 입금해 주세요. 입금자명은 신청서에 적어주신 이름으로 부탁드립니다.
          </p>
          <div style={{ marginTop: 8 }}>
            <Row label="은행" value={receipt.payment.bankName} />
            <Row
              label="계좌번호"
              value={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all' }}>
                    {receipt.payment.bankAccount}
                  </span>
                  <CopyButton value={receipt.payment.bankAccount} label="계좌번호 복사" />
                </span>
              }
            />
            <Row label="예금주" value={receipt.payment.bankHolder} />
            <Row label="입금 금액" value={won(receipt.entryFee || event.entryFee)} last />
          </div>
        </Card>
      )}

      {/* 참가 확정 오해 방지 — 화면에서 가장 강한 안내. */}
      <section
        style={{
          backgroundColor: TT.navy,
          borderRadius: 12,
          padding: '18px 17px 19px',
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: FONT_LABEL,
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '0.18em',
            color: TT.tealOnNavy,
          }}
        >
          IMPORTANT
        </p>
        <p
          style={{
            margin: '11px 0 0',
            fontSize: 15,
            fontWeight: 900,
            color: '#FFFFFF',
            lineHeight: 1.6,
            wordBreak: 'keep-all',
          }}
        >
          신청 완료는 최종 참가 확정이 아닙니다.
        </p>
        <p
          style={{
            margin: '9px 0 0',
            fontSize: 12.5,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.72)',
            lineHeight: 1.75,
            wordBreak: 'keep-all',
          }}
        >
          입금 확인 및 운영진 확인 후 최종 참가 확정됩니다.
          {waitlisted && ' 대기 접수는 참가 가능 여부가 확인된 뒤 운영진이 개별 안내드립니다.'}
        </p>
      </section>

      <ContactBlock event={event} />
      <Actions hubHref={hubHref} onLeave={onLeave} />
    </div>
  );
}
