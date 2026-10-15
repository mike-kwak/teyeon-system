'use client';

// Signature 운영 연결 — 화면 틀 + 연결 상태 (/tournaments/[slug]/signature/* 전용).
//
//   데이터(ArenaState)는 페이지가 운영 Arena 와 같은 훅(useArenaData)으로 받아 넘긴다. 이 틀은 상태만 그린다.
//     · 첫 조회 중 · 운영 권한 없음 · 첫 조회 실패 → 경기 정보 대신 안내(데이터를 보이지 않는다)
//     · 정상 → 화면 + 오른쪽 위 '실시간 · 마지막 갱신 시각'
//     · 갱신 지연(배경 갱신 실패 또는 30초 넘게 성공 없음) → 마지막 정상 화면은 그대로 두되
//       호박색 '연결 확인 필요 · 마지막 갱신' 표시 + LIVE 노랑을 회색으로(오래된 경기를 진행 중처럼 보이지 않게)
//   ⚠ 운영 권한이 사라지면(세션 만료 등) 보던 데이터도 감춘다.

import React from 'react';
import SignatureArenaShell from './SignatureArenaShell';
import type { SignatureArenaShellProps } from './SignatureArenaShell';
import { clockText, liveStatusOf } from './signatureLiveAdapter';
import type { LiveStatus } from './signatureLiveAdapter';
import { SIG, SIG_FONT_DISPLAY } from './signatureTheme';
import type { ArenaMode, ArenaSnapshot, ArenaState } from '@/lib/tournaments/arenaTypes';

const emptySnapshot = (slug: string, mode: ArenaMode): ArenaSnapshot => ({
  slug, mode, tournamentTitle: null, courts: [], groups: [], qualifyPerGroup: null, bracket: null,
});

const PILL: Record<LiveStatus['kind'], { bg: string; fg: string; border: string; dot: string }> = {
  live: { bg: 'rgba(255,255,255,0.92)', fg: SIG.inkSoft, border: SIG.line, dot: SIG.royal },
  stale: { bg: '#FFF4DB', fg: '#8A4B00', border: '#E0A43A', dot: '#E0A43A' },
  loading: { bg: 'rgba(255,255,255,0.92)', fg: SIG.muted, border: SIG.line, dot: SIG.faint },
  failed: { bg: '#FDECEC', fg: '#9B1C1C', border: '#E8A0A0', dot: '#C53030' },
  unauthorized: { bg: '#FDECEC', fg: '#9B1C1C', border: '#E8A0A0', dot: '#C53030' },
};

function StatusPill({ status }: { status: LiveStatus }) {
  const t = PILL[status.kind];
  const text = status.kind === 'live' ? `실시간 · ${clockText(status.updatedAt)} 갱신`
    : status.kind === 'stale' ? `연결 확인 필요 · 마지막 갱신 ${clockText(status.updatedAt)}`
      : status.kind === 'loading' ? '불러오는 중'
        : status.kind === 'failed' ? '연결 실패 · 자동 재시도 중'
          : '운영자 로그인 필요';
  return (
    <span data-live-status={status.kind} data-live-updated={status.updatedAt ?? ''} style={{
      height: 24, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 10px', borderRadius: 999,
      background: t.bg, color: t.fg, border: `1px solid ${t.border}`, boxSizing: 'border-box',
      fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
    }}>
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: 4, background: t.dot }} />
      {text}
    </span>
  );
}

function Notice({ status, height }: { status: LiveStatus; height: number }) {
  const msg = status.kind === 'unauthorized'
    ? ['운영자 로그인이 필요합니다', 'CEO · ADMIN 권한 계정으로 로그인한 브라우저에서만 경기 정보가 표시됩니다.']
    : status.kind === 'failed'
      ? ['경기 정보를 불러오지 못했습니다', '네트워크 연결을 확인해 주세요. 10초마다 자동으로 다시 시도합니다.']
      : ['경기 정보를 불러오는 중입니다', '잠시만 기다려 주세요.'];
  return (
    <div data-live-notice={status.kind} style={{ height, display: 'grid', placeItems: 'center' }}>
      <div style={{
        minWidth: 640, padding: '36px 48px', borderRadius: 16, textAlign: 'center',
        background: 'rgba(255,255,255,0.95)', border: `1px solid ${SIG.line}`, boxShadow: SIG.shadowCard,
      }}>
        <div style={{ fontSize: 34, fontWeight: 900, color: SIG.navy, letterSpacing: '-0.02em' }}>{msg[0]}</div>
        <div style={{ marginTop: 12, fontSize: 19, fontWeight: 700, color: SIG.muted }}>{msg[1]}</div>
        <div style={{ marginTop: 18, fontFamily: SIG_FONT_DISPLAY, fontSize: 13, fontWeight: 800, letterSpacing: '0.2em', color: SIG.faint }}>
          TEYEON OPEN · SIGNATURE ARENA
        </div>
      </div>
    </div>
  );
}

export interface SignatureLiveFrameProps
  extends Omit<SignatureArenaShellProps, 'snapshot' | 'children' | 'statusSlot' | 'stale'> {
  slug: string;
  mode: ArenaMode;
  state: ArenaState;
  /** 경기 정보가 없을 때 안내 칸의 높이(1920 캔버스 기준). */
  noticeHeight: number;
  /** 정상 · 갱신 지연일 때만 불린다(스냅샷이 있을 때). */
  children: (snapshot: ArenaSnapshot) => React.ReactNode;
}

export default function SignatureLiveFrame({
  slug, mode, state, noticeHeight, children, showCourts, viewMode, ...shell
}: SignatureLiveFrameProps) {
  // 갱신 지연 판정용 시계 — 5초마다(요청을 만들지 않는다).
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(t);
  }, []);
  const status = liveStatusOf(state, nowMs);
  const showData = (status.kind === 'live' || status.kind === 'stale') && state.snapshot !== null;
  const snapshot = showData ? state.snapshot! : emptySnapshot(slug, mode);

  return (
    <SignatureArenaShell
      {...shell}
      viewMode={viewMode}
      // 데이터가 없으면 코트 줄도 그리지 않는다(빈 코트를 '경기 없음'처럼 보이지 않게).
      showCourts={showData ? showCourts : false}
      snapshot={snapshot}
      statusSlot={<StatusPill status={status} />}
      stale={status.kind === 'stale'}
    >
      {showData ? children(snapshot) : <Notice status={status} height={noticeHeight} />}
    </SignatureArenaShell>
  );
}
