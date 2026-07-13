'use client';

// Handbook 배지 4종 — Handoff §4/§8.
//   규칙: pill 은 배지·상태에만 / white-space:nowrap + flex-shrink:0 / 색+텍스트 병행(색만 금지).
//   "가이드 준비 상태(pill)"와 "사용자 학습 상태(읽음 dot)"는 절대 같은 UI 로 혼합하지 않는다.

import React from 'react';
import { HB } from './handbookTokens';
import type { GuidePrivacyLevel, GuideRecordingStatus, GuideWriteMode } from '@/lib/handbook/types';

const pill = (bg: string, ink: string, border?: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 999,
  fontSize: 11, fontWeight: 800, lineHeight: 1,
  backgroundColor: bg, color: ink,
  border: `1px solid ${border || 'transparent'}`,
  whiteSpace: 'nowrap', flexShrink: 0,
});

/** 가이드 제작 상태(일반 사용자에게 개발 완료/미완료로 읽히지 않게 — "영상 준비 중" 등 콘텐츠 상태로만 표현) */
export function GuideStatusBadge({ status }: { status: GuideRecordingStatus }) {
  if (status === 'REVIEWED') return <span style={pill(HB.successBg, HB.successInk)}>검수 완료</span>;
  if (status === 'RECORDED') return <span style={pill(HB.surfaceSub, HB.textSecondary, HB.border)}>촬영 완료</span>;
  return <span style={pill(HB.surfaceSub, HB.textTertiary, HB.borderSub)}>영상 준비 중</span>;
}

export function ModeBadge({ mode }: { mode: GuideWriteMode }) {
  return mode === 'WRITES_DATA'
    ? <span style={pill(HB.dangerBg, HB.dangerInk, HB.dangerBorder)}>실제 저장</span>
    : <span style={pill(HB.successBg, HB.successInk)}>조회 전용</span>;
}

export function PrivacyBadge({ level }: { level: GuidePrivacyLevel }) {
  if (level === 'LOW') return <span style={pill(HB.surfaceSub, HB.textSecondary, HB.borderSub)}>개인정보 낮음</span>;
  return <span style={pill(HB.warningBg, HB.warningInk, HB.warningBorder)}>{level === 'HIGH' ? '개인정보 높음' : '개인정보 표시'}</span>;
}

/** 운영진 역할 배지 — 전 운영진 공통처럼 표현 금지(해당 역할만 표시) */
export function PermissionBadge({ role }: { role: string }) {
  const isCeo = /CEO|ADMIN/i.test(role);
  const isFinance = /finance|재무/i.test(role);
  const style = isCeo
    ? pill(HB.textPrimary, '#FFFFFF')
    : isFinance
      ? pill(HB.warningBg, HB.goldInk, HB.warningBorder)
      : pill('#42566B', '#FFFFFF');
  return <span style={{ ...style, letterSpacing: '.05em' }}>{role}</span>;
}

/** 배지 그룹 래퍼 — wrap 허용(배지 자체를 두 줄로 꺾지 않음) */
export function BadgeRow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', ...style }}>{children}</div>;
}
