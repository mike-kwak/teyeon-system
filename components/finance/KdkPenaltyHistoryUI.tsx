'use client';

// KDK 누적 벌금 현황 — 공용 UI 조각(조회 전용 · 납부 버튼 없음).

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import { FINANCE_CARD_STYLE, KpiCard, StatusBadge } from '@/components/finance/FinanceCommon';
import {
    isValidDateString,
    resolvePeriod,
    type PenaltyBucket,
    type PenaltyHistorySummary,
    type PeriodPreset,
    type PeriodResolution,
} from '@/lib/finance/kdkPenaltyHistoryModel';
import type { KdkPenaltyPaymentStatus } from '@/lib/finance/kdkSettlementService';
import {
    PERIOD_PRESETS,
    historyQueryString,
    readHistoryQuery,
    type HistoryQuery,
    type HistoryTab,
} from '@/lib/finance/kdkPenaltyHistoryQuery';

export const NAVY = '#0F172A';
export const TEAL = '#0F9F98';
export const TEAL_DARK = '#0E7C76';

// ── URL 상태(tab · period · from · to · q) ─────────────────────────────────

export { readHistoryQuery, historyQueryString };
export type { HistoryQuery, HistoryTab };
const PRESETS = PERIOD_PRESETS;

/** URL 을 단일 상태로 사용(새로고침·뒤로 가기에서 유지). 갱신은 replace(히스토리 누적 방지). */
export function useHistoryQuery(): [HistoryQuery, (patch: Partial<HistoryQuery>) => void] {
    const sp = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const query = React.useMemo(() => readHistoryQuery(sp), [sp]);
    const update = React.useCallback((patch: Partial<HistoryQuery>) => {
        const next = { ...query, ...patch };
        router.replace(`${pathname}${historyQueryString(next)}`, { scroll: false });
    }, [query, router, pathname]);
    return [query, update];
}

export function usePeriodResolution(query: HistoryQuery): PeriodResolution {
    return React.useMemo(
        () => resolvePeriod(query.period, { from: query.from, to: query.to }),
        [query.period, query.from, query.to],
    );
}

// ── 상태 배지 ────────────────────────────────────────────────────────────────

/** 색상 + 텍스트로 상태 구분: 완료(Teal) · 미납(Red) · 비대상(Gray) · 확인 필요(Amber). */
export function PenaltyBucketBadge({ bucket, status }: { bucket: PenaltyBucket; status?: KdkPenaltyPaymentStatus }) {
    if (bucket === 'paid') return <StatusBadge tone="paid">납부 완료</StatusBadge>;
    if (bucket === 'unpaid') return <StatusBadge tone="pending">{status === 'partial' ? '일부 납부' : '미납'}</StatusBadge>;
    if (bucket === 'excluded') return <StatusBadge tone="exempt">{status === 'exempt' ? '면제' : '비대상'}</StatusBadge>;
    return <StatusBadge tone="needs_review">확인 필요</StatusBadge>;
}

/** 확인 필요 사유(행 보조 문구). */
export function reviewReason(status: KdkPenaltyPaymentStatus, isGuest: boolean): string | null {
    if (status === 'unregistered') return 'Finance 미등록';
    if (status === 'needs_link') return isGuest ? '게스트 식별값 확인 필요' : '회원 연결 필요';
    return null;
}

/** G 배지 — 이름 말줄임과 별도 요소(이름이 길어도 사라지지 않음). */
export function GuestBadge() {
    return (
        <span
            aria-label="게스트"
            style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 15, height: 15, borderRadius: '50%',
                background: '#FFF4DE', border: '1px solid #F4C979', color: '#B7791F',
                fontSize: 8.5, fontWeight: 900, lineHeight: 1,
            }}
        >G</span>
    );
}

/** 이름(말줄임) + 선택적 G 배지. 부모는 minWidth:0 이어야 한다. */
export function NameLine({ name, isGuest, size = 13 }: { name: string; isGuest?: boolean; size?: number }) {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <span
                title={name}
                style={{
                    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontSize: size, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em',
                    paddingLeft: 1, // 첫 글자 잘림 방지(한글 굵은 글꼴의 좌측 bearing).
                }}
            >{name}</span>
            {isGuest && <GuestBadge />}
        </span>
    );
}

// ── 기간 선택 ────────────────────────────────────────────────────────────────

const PRESET_LABEL: Record<PeriodPreset, string> = {
    year: '올해', '3m': '3개월', '6m': '6개월', all: '전체', custom: '직접',
};

export function PeriodFilter({ query, onChange, resolution }: {
    query: HistoryQuery;
    onChange: (patch: Partial<HistoryQuery>) => void;
    resolution: PeriodResolution;
}) {
    const [from, setFrom] = React.useState(query.from);
    const [to, setTo] = React.useState(query.to);
    const [localError, setLocalError] = React.useState<string | null>(null);
    React.useEffect(() => { setFrom(query.from); setTo(query.to); }, [query.from, query.to]);

    const apply = () => {
        if (!from || !to) { setLocalError('시작일과 종료일을 모두 선택해 주세요.'); return; }
        if (!isValidDateString(from) || !isValidDateString(to)) { setLocalError('날짜 형식이 올바르지 않습니다.'); return; }
        if (from > to) { setLocalError('시작일이 종료일보다 늦습니다.'); return; }
        setLocalError(null);
        onChange({ period: 'custom', from, to });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div role="radiogroup" aria-label="기간" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 5 }}>
                {PRESETS.map((p) => {
                    const active = query.period === p;
                    return (
                        <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => {
                                setLocalError(null);
                                if (p === 'custom') onChange({ period: 'custom', from: query.from, to: query.to });
                                else onChange({ period: p, from: '', to: '' });
                            }}
                            style={{
                                height: 32, minWidth: 0, padding: '0 2px', borderRadius: 9, cursor: 'pointer',
                                border: active ? `1px solid ${TEAL}` : '1px solid rgba(15,23,42,0.10)',
                                background: active ? 'rgba(15,159,152,0.10)' : '#FFFFFF',
                                color: active ? TEAL_DARK : '#475569',
                                fontSize: 11.5, fontWeight: active ? 900 : 700, whiteSpace: 'nowrap',
                            }}
                        >{PRESET_LABEL[p]}</button>
                    );
                })}
            </div>
            {query.period === 'custom' && (
                <div style={{ ...FINANCE_CARD_STYLE, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 6 }}>
                        <input type="date" aria-label="시작일" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
                        <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 800 }}>~</span>
                        <input type="date" aria-label="종료일" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={dateInput} />
                    </div>
                    <button type="button" onClick={apply} style={{
                        height: 34, borderRadius: 9, border: 'none', cursor: 'pointer',
                        background: TEAL, color: '#FFFFFF', fontSize: 12, fontWeight: 800,
                    }}>이 기간으로 조회</button>
                    {(localError || (!resolution.ok && (query.from || query.to))) && (
                        <p role="alert" style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#B91C1C' }}>
                            {localError || (!resolution.ok ? resolution.error : '')}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

const dateInput: React.CSSProperties = {
    width: '100%', minWidth: 0, height: 36, boxSizing: 'border-box',
    padding: '0 8px', borderRadius: 8, border: '1px solid rgba(15,23,42,0.12)',
    background: '#FFFFFF', color: NAVY, fontSize: 13, fontWeight: 700,
    fontFamily: 'inherit',
};

// ── 요약 ─────────────────────────────────────────────────────────────────────

export function formatRate(rate: number | null): string {
    if (rate == null) return '—';
    const pct = Math.floor(rate * 1000) / 10; // 99.95% 를 100% 로 올려 보이지 않게 내림.
    return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export function PenaltySummaryCards({ summary }: { summary: PenaltyHistorySummary }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                <KpiCard label="총 부과액" value={formatWon(summary.billableAmount)} sub={`청구 대상 ${summary.paidCount + summary.unpaidCount}건`} />
                <KpiCard label="납부 완료" value={formatWon(summary.paidAmount)} accent="teal" sub={`${summary.paidCount}건 완료`} />
                <KpiCard label="미납" value={formatWon(summary.unpaidAmount)} accent={summary.unpaidAmount > 0 ? 'red' : 'default'} sub={`${summary.unpaidCount}건`} />
                <KpiCard label="납부율" value={formatRate(summary.paidRate)} accent="teal" sub="부과액 대비 납부" />
            </div>
            <div style={{
                ...FINANCE_CARD_STYLE, padding: '9px 12px',
                display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 4,
                fontSize: 11, fontWeight: 700, color: '#64748B',
            }}>
                <span style={{ whiteSpace: 'nowrap' }}>벌금 원금 <b style={{ color: NAVY }}>{formatWon(summary.grossAmount)}</b></span>
                <span style={{ whiteSpace: 'nowrap' }}>비대상 <b style={{ color: '#475569' }}>{formatWon(summary.excludedAmount)}</b>{summary.excludedCount ? ` (${summary.excludedCount}건)` : ''}</span>
                <span style={{ whiteSpace: 'nowrap', color: summary.reviewCount ? '#92400E' : undefined }}>
                    확인 필요 <b>{formatWon(summary.reviewAmount)}</b>{summary.reviewCount ? ` (${summary.reviewCount}건)` : ''}
                </span>
            </div>
            {summary.excludedPaidAmount > 0 && (
                <p style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', wordBreak: 'keep-all' }}>
                    납부 완료 금액에는 비대상·면제 처리된 청구에 남아 있는 납부 {formatWon(summary.excludedPaidAmount)}이 포함됩니다(세션 정산 화면과 같은 기준).
                </p>
            )}
        </div>
    );
}

// ── 상태 카드 ────────────────────────────────────────────────────────────────

export function LoadingCard() {
    return (
        <section style={{ ...FINANCE_CARD_STYLE, textAlign: 'center', padding: '28px 14px' }} aria-busy="true">
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>벌금 기록을 불러오는 중...</p>
        </section>
    );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <section style={{ ...FINANCE_CARD_STYLE, borderColor: 'rgba(185,28,28,0.18)', backgroundColor: '#FFF7F7' }} role="alert">
            <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#B91C1C' }}>벌금 기록을 불러오지 못했습니다</p>
            <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#7F1D1D', wordBreak: 'break-word' }}>{message}</p>
            <p style={{ margin: '6px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8', wordBreak: 'keep-all' }}>
                일부만 불러온 상태로 합계를 표시하지 않습니다. 다시 시도해 주세요.
            </p>
            <button type="button" onClick={onRetry} style={{
                marginTop: 10, height: 36, padding: '0 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: TEAL, color: '#FFFFFF', fontSize: 12, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', gap: 6,
            }}><RefreshCw size={13} /> 다시 시도</button>
        </section>
    );
}

export function EmptyCard({ children }: { children: React.ReactNode }) {
    return (
        <section style={{ ...FINANCE_CARD_STYLE, textAlign: 'center', padding: '20px 14px' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#94A3B8', wordBreak: 'keep-all' }}>{children}</p>
        </section>
    );
}

export function BlockedView({ loggedIn }: { loggedIn: boolean }) {
    return (
        <div style={{ paddingTop: 64, textAlign: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>
                {!loggedIn ? '로그인이 필요합니다.' : '운영자만 접근할 수 있는 페이지입니다.'}
            </p>
            <Link href="/finance" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: TEAL_DARK }}>← Finance</Link>
        </div>
    );
}

export function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            aria-label="새로고침"
            style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                border: '1px solid rgba(0,0,0,0.09)', background: '#FFFFFF',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)', color: busy ? '#CBD5E1' : '#475569',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'default' : 'pointer',
            }}
        ><RefreshCw size={15} /></button>
    );
}

export function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ width: 4, height: 14, background: TEAL, borderRadius: 2, flexShrink: 0 }} />
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: NAVY, flex: 1, minWidth: 0 }}>{title}</h2>
            {right}
        </div>
    );
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' */
export function dotDate(date: string | null | undefined): string {
    return date ? date.replace(/-/g, '.') : '날짜 미상';
}

/** 긴 목록 점진 표시(한 번에 수천 행을 그리지 않음). */
export function useIncremental(total: number, step = 50, resetKey: unknown = null) {
    const [limit, setLimit] = React.useState(step);
    React.useEffect(() => { setLimit(step); }, [resetKey, step]);
    return { limit, more: total > limit, showMore: () => setLimit((l) => l + step) };
}

export function ShowMoreButton({ remaining, onClick }: { remaining: number; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} style={{
            height: 38, borderRadius: 10, cursor: 'pointer',
            border: '1px solid rgba(15,23,42,0.10)', background: '#FFFFFF',
            color: '#475569', fontSize: 12, fontWeight: 800,
        }}>더 보기 ({remaining.toLocaleString('ko-KR')}건 남음)</button>
    );
}
