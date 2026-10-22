'use client';

// 공개 DRAW — '첫 경기 출전' 노란 강조(조 카드 줄 · 조 상세 · 순위결정전).
//
//   ⚠ 노란색은 '이 팀이 그 조의 첫 경기에 나간다' 는 안내 전용이다. 승리(teal) · 진출 · 확인 필요(amber 글자) · LIVE 와 섞지 않는다.
//   ⚠ 색만으로 구분하지 않는다 — 깃발 아이콘 + '첫 경기 출전' 글자 + 시간 줄을 함께 쓴다.
//   ⚠ 첫 번째 조(09:00)와 두 번째 조(앞 조 종료 후)는 색 농도와 시간 글자로 구분한다.
//     두 번째 조에 고정 시각을 붙이지 않는다(firstMatchModel 이 정한 문구만).

import React from 'react';
import { Flag } from 'lucide-react';
import type { HighlightMark } from '@/components/tournaments/standings/primitives';
import {
  FIRST_BADGE_LABEL, FIRST_PENDING_LABEL, firstDetail, firstHeadline, isFirstUpcoming, type FirstMatchInfo,
} from '@/lib/tournaments/firstMatchModel';

/** 첫 번째 조 — 진한 노랑. 두 번째 조 — 옅은 노랑(같은 '첫 경기' 이지만 시작이 늦다). */
const TONE_S1 = { bg: '#FFF1BF', bd: '#E5B300', fg: '#5C4300' };
const TONE_S2 = { bg: '#FFF9E3', bd: '#E9CF79', fg: '#6E5512' };

/** 첫 경기를 앞둔 팀 · 경기의 강조 표시. 진행 · 종료 · 취소 · 경기 미생성이면 null(강조하지 않는다). */
export function firstMark(f: FirstMatchInfo | null): HighlightMark | null {
  if (!isFirstUpcoming(f)) return null;
  return { label: FIRST_BADGE_LABEL, ...(f.sessionNo === 2 ? TONE_S2 : TONE_S1) };
}

/** 팀 번호가 첫 경기 출전 팀이면 강조 표시. */
export const firstMarkFor = (f: FirstMatchInfo | null, teamNo: number): HighlightMark | null =>
  f && f.teamNos.includes(teamNo) ? firstMark(f) : null;

/** 경기 카드 띠 — 배지 + '첫 경기 · 09:00 · 예정 2번 코트 · 신고 08:40까지'. */
export function firstMatchHighlight(f: FirstMatchInfo | null): { mark: HighlightMark; detail: string | null } | null {
  const mark = firstMark(f);
  if (!mark || !f) return null;
  return { mark, detail: [firstHeadline(f), firstDetail(f)].filter(Boolean).join(' · ') };
}

/**
 * 조 카드 한 줄 — '⚑ 첫 경기 · 09:00' (첫 경기 전) / '경기 순서 준비 중' (경기 미생성).
 *   첫 경기가 시작된 뒤에는 그리지 않는다(카드의 진행 상태가 대신 알려 준다).
 */
export function FirstMatchLine({ info, pending }: { info: FirstMatchInfo | null; pending: boolean }) {
  if (pending) {
    return (
      <span data-first-line="pending" style={{ fontSize: 12, fontWeight: 700, color: '#7A8699', lineHeight: 1.5 }}>
        {FIRST_PENDING_LABEL}
      </span>
    );
  }
  const mark = firstMark(info);
  if (!mark || !info) return null;
  return (
    <span data-first-line={info.sessionNo ?? 'none'} style={{
      display: 'flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%', boxSizing: 'border-box',
      padding: '3px 9px', borderRadius: 8, background: mark.bg, border: `1px solid ${mark.bd}`, color: mark.fg,
      fontSize: 12.5, fontWeight: 800, lineHeight: 1.45, wordBreak: 'keep-all',
    }}>
      <Flag size={12} strokeWidth={2.6} style={{ flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>{firstHeadline(info)}</span>
    </span>
  );
}
