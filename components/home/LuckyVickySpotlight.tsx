'use client';

// TEYEON 메인 Club Board Hero 하단 — 러키비키(LUCKY VICKY) Culture Spotlight.
//   · active 회차가 있을 때만 렌더(없으면 null → divider/여백도 함께 사라짐).
//   · 접근 권한(회원 전용)은 부모(app/page.tsx)가 tennisLogStatus==='allowed' 로 게이트한다.
//   · Hero 하단과 자연스럽게 연결되는 compact row(약 40px). 과한 pill/금색/애니메이션 금지.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clover, ChevronRight } from 'lucide-react';
import { roundTeamCount, type LuckyVickyRound } from '@/lib/luckyVickyData';
import { fetchSpotlightRound } from '@/lib/luckyVickyService';

export default function LuckyVickySpotlight() {
  // DB(active + spotlight_enabled) 조회. 로딩/미존재/조회 실패 → null(여백/divider 없음).
  const [active, setActive] = useState<LuckyVickyRound | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSpotlightRound()
      .then((r) => { if (!cancelled) setActive(r); })
      .catch(() => { if (!cancelled) setActive(null); });
    return () => { cancelled = true; };
  }, []);

  if (!active) return null; // active+spotlight 회차 없음/로딩 → 노출 안 함(빈 여백/divider 제거)

  const summary = `${active.round}회차 진행 중 · ${roundTeamCount(active)}팀 출전 준비`;
  return (
    <Link
      href="/lucky-vicky"
      aria-label={`러키비키 — ${summary}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 40,
        padding: '9px 14px',
        borderTop: '1px solid rgba(15,23,42,0.06)',
        backgroundColor: '#FFFDF7',
        textDecoration: 'none',
        color: 'inherit',
      }}
      className="active:opacity-90"
    >
      <Clover size={15} strokeWidth={1.9} style={{ color: '#C79A32', flexShrink: 0 }} aria-hidden />
      <span style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', color: '#8E6B17', whiteSpace: 'nowrap', flexShrink: 0 }}>LUCKY VICKY</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {summary}</span>
      </span>
      <ChevronRight size={14} style={{ color: '#CBD5E1', flexShrink: 0 }} aria-hidden />
    </Link>
  );
}
