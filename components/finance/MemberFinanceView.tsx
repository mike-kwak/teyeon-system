'use client';

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { fetchMyFinanceYear } from '@/lib/finance/duesService';
import { summarizeMemberYear, summarizeReceivable } from '@/lib/finance/calculatePaymentStatus';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    KpiCard,
    StatusBadge,
    FINANCE_CARD_STYLE,
    KakaoBankNotice,
} from './FinanceCommon';
import {
    RECEIVABLE_TYPE_LABEL,
    type FinanceDuesPayment,
    type FinanceDuesReceivable,
    type MemberYearSummary,
} from '@/types/finance';

/**
 * 일반 회원 — 본인 납부 현황.
 *
 * - 원본 테이블 직접 SELECT 하지 않고 get_my_finance_year(p_year) RPC 만 호출.
 * - RPC 가 admin_memo / created_by / updated_by 등 운영 컬럼을 제외하고 반환.
 * - 취소된(payment.is_voided=true) 기록도 RPC 가 미포함.
 * - 휴회 정보(leaves)도 함께 받아 화면 상단에 안내.
 *
 * ⚠️ memo 컬럼(회원 공개 메모) 은 응답에 포함될 수 있다. 민감 메모는 admin_memo 로 작성.
 */
export default function MemberFinanceView({ authUserId: _authUserId }: { authUserId: string }) {
    const today = new Date();
    const [year, setYear] = React.useState(today.getFullYear());

    const [memberFound, setMemberFound] = React.useState<'loading' | 'found' | 'missing'>('loading');
    const [receivables, setReceivables] = React.useState<FinanceDuesReceivable[]>([]);
    const [payments, setPayments] = React.useState<FinanceDuesPayment[]>([]);
    const [leaves, setLeaves] = React.useState<{ id: string; start_date: string; end_date: string | null; reason: string | null }[]>([]);
    const [annualFeePaid, setAnnualFeePaid] = React.useState(false);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const data = await fetchMyFinanceYear(year);
                if (cancelled) return;
                if (!data.memberFound) {
                    setMemberFound('missing');
                    setAnnualFeePaid(false);
                    setLoading(false);
                    return;
                }
                setMemberFound('found');
                setReceivables(data.receivables);
                setPayments(data.payments);
                setLeaves(data.leaves);
                setAnnualFeePaid(data.annualFeePaid);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [year]);

    // memberId 는 응답 row 의 member_id 에서 추출 (모두 동일).
    const memberId = receivables[0]?.member_id ?? payments[0]?.member_id ?? null;

    const summary: MemberYearSummary | null = React.useMemo(() => {
        if (!memberId) return null;
        return summarizeMemberYear(memberId, year, receivables, payments);
    }, [memberId, year, receivables, payments]);

    const rows = React.useMemo(() => {
        return receivables.map((r) => ({ r, s: summarizeReceivable(r, payments) }));
    }, [receivables, payments]);

    // 오늘 기준 활성 휴회 안내.
    const todayStr = new Date().toISOString().slice(0, 10);
    const activeLeave = leaves.find((l) =>
        (!l.start_date || l.start_date <= todayStr) &&
        (!l.end_date   || l.end_date   >= todayStr)
    );

    // 상태 1) 로그인 계정과 members 연결 자체가 없음(회원 매핑 실패).
    if (memberFound === 'missing') {
        return (
            <section style={FINANCE_CARD_STYLE}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                    회원 정보를 확인할 수 없습니다
                </p>
                <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.5 }}>
                    운영진에게 계정 연결을 요청해 주세요.
                </p>
            </section>
        );
    }

    return (
        <>
            {/* 연도 선택 — 단순 chip. */}
            <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12,
                borderRadius: 999,
                backgroundColor: '#FFFFFF',
                border: '1px solid rgba(15,23,42,0.08)',
                alignSelf: 'flex-start',
            }}>
                <select
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    style={{
                        height: 22, border: 'none', backgroundColor: 'transparent',
                        fontSize: 12, fontWeight: 800, color: '#0F172A',
                        outline: 'none', cursor: 'pointer', appearance: 'none',
                    }}
                    aria-label="연도"
                >
                    {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
            </div>

            {loading && (
                <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                    불러오는 중...
                </p>
            )}

            {!loading && activeLeave && (
                <section style={{
                    ...FINANCE_CARD_STYLE,
                    backgroundColor: 'rgba(100,116,139,0.06)',
                    borderColor: 'rgba(100,116,139,0.18)',
                }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#475569' }}>
                        현재 휴회 중
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 600, color: '#64748B' }}>
                        {activeLeave.start_date} ~ {activeLeave.end_date ?? '무기한'}
                        {activeLeave.reason ? ` · ${activeLeave.reason}` : ''}
                    </p>
                </section>
            )}

            {/* 연회비 납부 완료 배지 — 연도 선택 아래 / KPI 위. 연한 teal 성공 카드. */}
            {!loading && memberFound === 'found' && annualFeePaid && (
                <section style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    paddingTop: 11, paddingBottom: 11, paddingLeft: 12, paddingRight: 12,
                    borderRadius: 12,
                    backgroundColor: 'rgba(15,159,152,0.08)',
                    border: '1px solid rgba(15,159,152,0.24)',
                }}>
                    <CheckCircle2 size={18} style={{ color: '#0E7C76', flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#0E7C76', wordBreak: 'keep-all' }}>
                            {year}년 연회비 납부 완료
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#0F766E', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                            올해 납부해야 할 월회비를 모두 납부했습니다.
                        </p>
                    </div>
                </section>
            )}

            {!loading && summary && (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <KpiCard label="납부 대상" value={formatWon(summary.totalDue)} accent="default" />
                        <KpiCard label="납부 완료" value={formatWon(summary.totalPaid)} accent="teal" />
                    </div>
                    <KpiCard
                        label="남은 금액"
                        value={formatWon(summary.totalRemaining)}
                        accent={summary.totalRemaining > 0 ? 'red' : 'teal'}
                        sub={summary.totalDue > 0
                            ? `납부율 ${Math.round((summary.totalPaid / summary.totalDue) * 100)}%`
                            : undefined}
                    />

                    <section style={FINANCE_CARD_STYLE}>
                        <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                            항목별
                        </h3>
                        {rows.length === 0 ? (
                            <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                                등록된 항목이 없습니다.
                            </p>
                        ) : (
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {rows.map(({ r, s }) => (
                                    <li
                                        key={r.id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            paddingTop: 8, paddingBottom: 8,
                                            borderTop: '1px dashed rgba(15,23,42,0.05)',
                                        }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{
                                                margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A',
                                                wordBreak: 'keep-all',
                                            }}>
                                                {r.title || `${r.target_year ?? year}년 ${r.target_month ?? ''}${r.target_month != null ? '월 ' : ''}${RECEIVABLE_TYPE_LABEL[r.receivable_type]}`}
                                            </p>
                                            <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                                                기준 {formatWon(r.amount_due)} · 완료 {formatWon(s.amount_paid)}
                                                {s.latestPaidAt ? ` · ${s.latestPaidAt} 납부` : ''}
                                            </p>
                                        </div>
                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                            <p style={{
                                                margin: 0, fontSize: 13, fontWeight: 900,
                                                color: s.remaining > 0 ? '#B91C1C' : '#0E7C76',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {formatWon(s.remaining)}
                                            </p>
                                            <div style={{ marginTop: 2 }}>
                                                <StatusBadge tone={s.derivedStatus}>
                                                    {s.derivedStatus === 'paid' ? '납부 완료'
                                                        : s.derivedStatus === 'partial' ? '일부 납부'
                                                        : s.derivedStatus === 'pending' ? '미납'
                                                        : s.derivedStatus === 'exempt' ? '면제'
                                                        : '비대상'}
                                                </StatusBadge>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <KakaoBankNotice />
                </>
            )}

            {/* 상태 3) 회원 연결은 정상이나 선택 연도 납부 데이터가 없음. */}
            {!loading && memberFound === 'found' && !summary && (
                <section style={FINANCE_CARD_STYLE}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                        등록된 납부 항목이 없습니다
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                        {year}년에 납부할 회비나 벌금 내역이 아직 등록되지 않았습니다.
                    </p>
                </section>
            )}
        </>
    );
}
