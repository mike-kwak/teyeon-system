'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/** Finance 공용 페이지 컨테이너. 하단 BottomNav 여백은 공통 GlobalMain(var(--page-bottom-safe))이
 *  단일 적용하므로 여기서 BottomNav 높이/safe-area를 다시 더하지 않는다(이중 패딩 방지).
 *  카드 하단 디자인 여백은 FINANCE_CONTAINER_STYLE.paddingBottom(16)이 담당. */
export const FINANCE_PAGE_STYLE: React.CSSProperties = {
    width: '100%',
    // minHeight:100dvh 제거: 이 컨테이너가 뷰포트 높이로 고정되면(flex 자식 shrink) 콘텐츠가 넘쳐
    //   GlobalMain 공통 하단 clearance(var(--page-bottom-safe))가 반영되지 않아 마지막 액션이 nav 뒤로 가린다.
    //   bg 가 GlobalMain(#F2F4F7)과 동일하므로 콘텐츠 높이로 둬도 짧은 화면에서 이음새가 보이지 않는다.
    backgroundColor: '#F2F4F7',
};

export const FINANCE_CONTAINER_STYLE: React.CSSProperties = {
    width: '100%',
    maxWidth: 430,
    margin: '0 auto',
    // 하단 디자인 여백 40px: GlobalMain(--page-bottom-safe)의 +24px만으로는 실기기에서 마지막 액션
    // (예: "벌금 현황 공지 만들기")이 BottomNav 반투명 배경/그림자에 가려짐. BottomNav 높이/safe-area를
    // 다시 더하지 않고 컨테이너 디자인 여백만 보강(과여백 방지: 총 64px 미만 유지).
    paddingTop: 16, paddingRight: 16, paddingBottom: 40, paddingLeft: 16,
    display: 'flex', flexDirection: 'column', gap: 12,
    boxSizing: 'border-box',
};

/** 카드 공통 스타일. */
export const FINANCE_CARD_STYLE: React.CSSProperties = {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    padding: 14,
};

interface PageHeaderProps {
    /** 상단 작은 라벨 — uppercase Rajdhani. */
    eyebrow?: string;
    title: string;
    subtitle?: string;
    backHref?: string;
    rightSlot?: React.ReactNode;
}

export function FinancePageHeader({ eyebrow, title, subtitle, backHref, rightSlot }: PageHeaderProps) {
    return (
        <header style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 4 }}>
            {backHref && (
                <Link
                    href={backHref}
                    aria-label="뒤로"
                    style={{
                        width: 34, height: 34, borderRadius: '50%',
                        border: '1px solid rgba(0,0,0,0.09)', backgroundColor: '#FFFFFF',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#475569', flexShrink: 0, textDecoration: 'none',
                    }}
                >
                    <ChevronLeft size={17} strokeWidth={2.2} />
                </Link>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                {eyebrow && (
                    <p style={{
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: 8.5, fontWeight: 800, letterSpacing: '0.28em',
                        textTransform: 'uppercase', color: '#0E7C76',
                        margin: 0, lineHeight: 1.3,
                    }}>
                        {eyebrow}
                    </p>
                )}
                <p style={{
                    fontSize: 17, fontWeight: 900, color: '#0F172A',
                    margin: 0, lineHeight: 1.2, letterSpacing: '-0.01em',
                }}>
                    {title}
                </p>
                {subtitle && (
                    <p style={{
                        margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#64748B',
                    }}>
                        {subtitle}
                    </p>
                )}
            </div>
            {rightSlot}
        </header>
    );
}

/** 연/월 선택 — 가로 가벼운 chip. */
interface MonthPickerProps {
    year: number;
    month: number;
    onChange: (year: number, month: number) => void;
    minYear?: number;
    maxYear?: number;
}

export function YearMonthPicker({ year, month, onChange, minYear = 2024, maxYear = 2030 }: MonthPickerProps) {
    const years = [];
    for (let y = minYear; y <= maxYear; y++) years.push(y);
    return (
        <div style={{
            display: 'flex', gap: 6, alignItems: 'center',
            paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10,
            borderRadius: 10,
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(15,23,42,0.08)',
        }}>
            <select
                value={year}
                onChange={(e) => onChange(Number(e.target.value), month)}
                style={selectStyle}
                aria-label="연도"
            >
                {years.map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <span style={{ color: '#CBD5E1' }}>·</span>
            <select
                value={month}
                onChange={(e) => onChange(year, Number(e.target.value))}
                style={selectStyle}
                aria-label="월"
            >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                ))}
            </select>
        </div>
    );
}

const selectStyle: React.CSSProperties = {
    height: 28, border: 'none', backgroundColor: 'transparent',
    fontSize: 12, fontWeight: 800, color: '#0F172A',
    outline: 'none', cursor: 'pointer',
    appearance: 'none',
    paddingRight: 4,
};

/** KPI 카드 (2열 grid 친화 — 360px 에서도 줄바꿈 없음). */
interface KpiCardProps {
    label: string;
    value: React.ReactNode;
    accent?: 'default' | 'teal' | 'amber' | 'red' | 'gray';
    sub?: string;
}

export function KpiCard({ label, value, accent = 'default', sub }: KpiCardProps) {
    const tone = ACCENT[accent];
    return (
        <div
            style={{
                ...FINANCE_CARD_STYLE,
                padding: 12,
                minWidth: 0,
            }}
        >
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B', letterSpacing: '0.02em' }}>
                {label}
            </p>
            <p style={{
                margin: '4px 0 0', fontSize: 17, fontWeight: 900, color: tone.color,
                letterSpacing: '-0.02em', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
                {value}
            </p>
            {sub && (
                <p style={{ margin: '3px 0 0', fontSize: 10, fontWeight: 600, color: '#94A3B8' }}>
                    {sub}
                </p>
            )}
        </div>
    );
}

const ACCENT: Record<NonNullable<KpiCardProps['accent']>, { color: string }> = {
    default: { color: '#0F172A' },
    teal:    { color: '#0E7C76' },
    amber:   { color: '#92400E' },
    red:     { color: '#B91C1C' },
    gray:    { color: '#64748B' },
};

/** 상태 뱃지 (small). */
interface StatusBadgeProps {
    children: React.ReactNode;
    tone: 'paid' | 'partial' | 'pending' | 'exempt' | 'not_target' | 'prepaid' | 'needs_review';
}
export function StatusBadge({ children, tone }: StatusBadgeProps) {
    const t = STATUS_TONE[tone];
    return (
        <span style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.02em',
            paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
            borderRadius: 4,
            backgroundColor: t.bg, color: t.color, border: `1px solid ${t.border}`,
            whiteSpace: 'nowrap',
        }}>
            {children}
        </span>
    );
}

const STATUS_TONE: Record<StatusBadgeProps['tone'], { bg: string; color: string; border: string }> = {
    paid:         { bg: 'rgba(15,159,152,0.10)', color: '#0E7C76', border: 'rgba(15,159,152,0.24)' },
    partial:      { bg: 'rgba(245,158,11,0.10)', color: '#92400E', border: 'rgba(245,158,11,0.24)' },
    pending:      { bg: 'rgba(220,38,38,0.10)',  color: '#B91C1C', border: 'rgba(220,38,38,0.26)' },
    exempt:       { bg: 'rgba(100,116,139,0.10)', color: '#475569', border: 'rgba(100,116,139,0.22)' },
    not_target:   { bg: 'rgba(100,116,139,0.06)', color: '#94A3B8', border: 'rgba(100,116,139,0.16)' },
    prepaid:      { bg: 'rgba(13,148,136,0.10)',  color: '#0F766E', border: 'rgba(13,148,136,0.22)' },
    needs_review: { bg: 'rgba(245,158,11,0.10)',  color: '#92400E', border: 'rgba(245,158,11,0.24)' },
};

/** 일반 회원에게 안내 — 카카오뱅크 모임통장. */
export function KakaoBankNotice() {
    return (
        <p style={{
            margin: '8px 4px 0',
            fontSize: 11, fontWeight: 600, color: '#64748B',
            lineHeight: 1.55, textAlign: 'center', wordBreak: 'keep-all',
        }}>
            전체 잔액과 입출금 내역은 카카오뱅크 모임통장에서 확인할 수 있습니다.
        </p>
    );
}
