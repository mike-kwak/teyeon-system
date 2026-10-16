// 공개 본선 — 경기 상태 표시(전체 대진표 카드 · 라운드별 목록 공통).
//   ⚠ 서버 상태를 참가자 언어로 바꿀 뿐이다. 경기 결과 · 진출을 여기서 판단하지 않는다.

import { TT } from '@/components/tournaments/tournamentTheme';
import {
  PUBLIC_KNOCKOUT_STATUS_TEXT, type PublicKnockoutMatch,
} from '@/lib/tournaments/publicKnockoutTypes';

/** 경기 상태별 색. 진행 중만 강조하고 나머지는 차분하게 둔다. */
export const statusTone = (m: PublicKnockoutMatch | null, bye: boolean): { label: string; color: string; bg: string } => {
  if (bye) return { label: '부전승 진출', color: '#B45309', bg: '#FFFBEB' };
  if (!m) return { label: '대기', color: TT.subtle, bg: TT.lineSoft };
  switch (m.status) {
    case 'playing':   return { label: '경기 중', color: TT.teal, bg: TT.tealSoft };
    case 'calling':   return { label: '호출 중', color: TT.tealDeep, bg: TT.tealSoft };
    case 'completed': return { label: '종료', color: '#047857', bg: '#ECFDF5' };
    default:          return { label: PUBLIC_KNOCKOUT_STATUS_TEXT.waiting, color: TT.muted, bg: TT.lineSoft };
  }
};

/** 진행 중 경기의 코트 — 서버가 진행 중일 때만 코트를 준다(그 밖에는 빈 문자열). */
export const courtText = (m: PublicKnockoutMatch | null): string =>
  m?.status === 'playing' ? (m.courtName || (m.courtNo ? `${m.courtNo}번 코트` : '')) : '';
