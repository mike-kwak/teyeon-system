'use client';

import React from 'react';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    formatReferenceDot,
    groupPriorArrears,
    type PublicNoticeView,
    type NoticeMemberStatus,
} from '@/lib/finance/noticesService';
import PaymentAccountCard from '@/components/finance/PaymentAccountCard';

/**
 * 회원 공지용 회비 납부 현황 공개 화면(읽기 전용, 로그인 불필요).
 *   - KDK 경기 결과표처럼 흰색 한 장짜리 엑셀형 표(얇은 테두리·compact row·우측 정렬 숫자).
 *   - 상단 요약 → 회원별 납부 현황 표 → 회비 제외 대상 표 → 기준일 스냅샷 안내.
 *   - 데이터는 모두 스냅샷 고정값(RPC 응답). 연락처/계정/메모/생성자 없음.
 */
export default function PublicFinanceNotice({ notice }: { notice: PublicNoticeView }) {
    const ref = formatReferenceDot(notice.referenceDate);
    const s = notice.stats;

    // 이전 월 이월 미납(구버전 공지엔 없음 — optional). 회원별로 묶어 표시.
    const priorGroups = groupPriorArrears(notice.priorArrears ?? []);
    const hasPrior = priorGroups.length > 0;
    const priorRemaining = notice.priorArrearsStats?.remainingAmount
        ?? priorGroups.reduce((sum, g) => sum + g.totalRemaining, 0);
    const overallOutstanding = notice.overallOutstandingAmount ?? (s.totalRemaining + priorRemaining);

    return (
        <main
            style={{
                width: '100%',
                minHeight: '100dvh',
                backgroundColor: '#FFFFFF',
                paddingTop: 'calc(18px + env(safe-area-inset-top))',
                paddingBottom: 'calc(26px + env(safe-area-inset-bottom))',
                paddingLeft: 12,
                paddingRight: 12,
                boxSizing: 'border-box',
            }}
        >
            <div style={{ width: '100%', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* 상단 — 로고 / 제목 / 기준일 / 기간 */}
                <header style={{ textAlign: 'center', paddingBottom: 4, borderBottom: '2px solid #0F172A' }}>
                    <p style={{
                        margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: 11, fontWeight: 800, letterSpacing: '0.34em',
                        textTransform: 'uppercase', color: '#0E7C76',
                    }}>
                        TEYEON · FINANCE
                    </p>
                    <h1 style={{ margin: '5px 0 0', fontSize: 20, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
                        TEYEON 회비 납부 현황
                    </h1>
                    <div style={{ margin: '7px 0 8px', display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '2px 12px' }}>
                        <span style={{ fontSize: 14, fontWeight: 900, color: '#0E7C76' }}>{ref} 기준</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>{notice.targetYear}년 {notice.targetMonth}월 회비</span>
                    </div>
                </header>

                {/* 요약 — compact grid */}
                <section style={{
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
                    backgroundColor: '#E2E8F0', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden',
                }}>
                    <Summary label="전체 회원" value={s.totalMembers} />
                    <Summary label="납부 대상" value={s.targetCount} />
                    <Summary label="회비 제외" value={notice.excluded.length} />
                    <Summary label="납부 완료" value={s.paidCount} tone="paid" />
                    <Summary label="일부 납부" value={s.partialCount} tone="partial" />
                    <Summary label="미납" value={s.unpaidCount} tone="pending" />
                </section>

                {/* 공개 메모 */}
                {notice.publicNote && (
                    <p style={{
                        margin: 0, padding: '10px 12px', borderRadius: 8,
                        backgroundColor: '#F0FDFA', border: '1px solid #99F6E4',
                        fontSize: 12.5, fontWeight: 600, color: '#0F5132', lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', wordBreak: 'keep-all', overflowWrap: 'anywhere',
                    }}>
                        {notice.publicNote}
                    </p>
                )}

                {/* 입금 계좌 */}
                {notice.paymentAccount && (
                    <PaymentAccountCard account={notice.paymentAccount} label="회비 입금 계좌" />
                )}

                {/* 회원별 납부 현황 표 */}
                <section>
                    <SectionTitle>회원별 납부 현황</SectionTitle>
                    <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                        <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ backgroundColor: '#F8FAFC' }}>
                                    <Th style={{ width: 38, textAlign: 'center' }}>No.</Th>
                                    <Th>이름</Th>
                                    <Th className="hidden sm:table-cell" style={{ textAlign: 'right' }}>납부 대상</Th>
                                    <Th style={{ textAlign: 'right' }}>납부 완료</Th>
                                    <Th style={{ textAlign: 'right' }}>남은 금액</Th>
                                    <Th style={{ textAlign: 'center', width: 78 }}>상태</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {notice.members.map((m, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid #EEF2F6' }}>
                                        <Td style={{ textAlign: 'center', color: '#94A3B8', fontWeight: 700 }}>{i + 1}</Td>
                                        <Td>
                                            <span style={{ fontWeight: 800, color: '#0F172A', whiteSpace: 'nowrap' }}>{m.displayName}</span>
                                            {/* 모바일: 납부 대상 열 대신 이름 아래 보조 문구 */}
                                            <span className="sm:hidden" style={{ display: 'block', marginTop: 1, fontSize: 10.5, fontWeight: 600, color: '#94A3B8', whiteSpace: 'nowrap' }}>
                                                대상 {formatWon(m.amountDue)}
                                            </span>
                                        </Td>
                                        <Td className="hidden sm:table-cell" style={{ textAlign: 'right', whiteSpace: 'nowrap', color: '#334155' }}>{formatWon(m.amountDue)}</Td>
                                        <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: '#0E7C76', fontWeight: 700 }}>{formatWon(m.amountPaid)}</Td>
                                        <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800, color: m.remainingAmount > 0 ? '#B91C1C' : '#94A3B8' }}>{formatWon(m.remainingAmount)}</Td>
                                        <Td style={{ textAlign: 'center' }}><StatusPill status={m.status} annual={m.annualFeePaid} /></Td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                                    <Td style={{ textAlign: 'center' }} colSpan={2}><span style={{ fontWeight: 800, color: '#475569' }}>합계</span></Td>
                                    <Td className="hidden sm:table-cell" style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800, color: '#334155' }}>{formatWon(s.totalDue)}</Td>
                                    <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800, color: '#0E7C76' }}>{formatWon(s.totalPaid)}</Td>
                                    <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 900, color: '#B91C1C' }}>{formatWon(s.totalRemaining)}</Td>
                                    <Td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </section>

                {/* 금액 요약 — 선택 월 / 이전 월 미납 / 전체 분리(이전 월 미납이 있을 때만). */}
                {hasPrior && (
                    <section style={{
                        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1,
                        backgroundColor: '#E2E8F0', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden',
                    }}>
                        <MoneyCell label={`${notice.targetMonth}월 남은 금액`} value={s.totalRemaining} />
                        <MoneyCell label="이전 월 미납" value={priorRemaining} />
                        <MoneyCell label="현재 전체 미납" value={overallOutstanding} strong />
                    </section>
                )}

                {/* 이전 월 이월 미납 — 선택 월보다 이전(같은 연도) monthly_fee 미납. 회원별 그룹. */}
                {hasPrior && (
                    <section>
                        <SectionTitle>이전 월 이월 미납</SectionTitle>
                        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                            <table style={{ width: '100%', minWidth: 360, borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#F8FAFC' }}>
                                        <Th>이름</Th>
                                        <Th>미납 월</Th>
                                        <Th style={{ textAlign: 'right', width: 110 }}>이전 미납 금액</Th>
                                        <Th style={{ textAlign: 'center', width: 80 }}>상태</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {priorGroups.map((g, i) => {
                                        const monthsLabel = `${g.months[0].targetYear}년 ${g.months.map((m) => `${m.targetMonth}월`).join(', ')}`;
                                        const anyPartial = g.months.some((m) => m.amountPaid > 0);
                                        return (
                                            <tr key={i} style={{ borderTop: '1px solid #EEF2F6' }}>
                                                <Td><span style={{ fontWeight: 800, color: '#0F172A', whiteSpace: 'nowrap' }}>{g.displayName}</span></Td>
                                                <Td><span style={{ fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>{monthsLabel}</span></Td>
                                                <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 900, color: '#B91C1C' }}>{formatWon(g.totalRemaining)}</Td>
                                                <Td style={{ textAlign: 'center' }}>
                                                    <StatusPill status={anyPartial ? 'partial' : 'pending'} />
                                                </Td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                                        <Td style={{ textAlign: 'center' }} colSpan={2}><span style={{ fontWeight: 800, color: '#475569' }}>이전 월 미납 합계</span></Td>
                                        <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 900, color: '#B91C1C' }}>{formatWon(priorRemaining)}</Td>
                                        <Td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </section>
                )}

                {/* 회비 제외 대상 */}
                {notice.excluded.length > 0 && (
                    <section>
                        <SectionTitle>회비 제외 대상</SectionTitle>
                        <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                            <table style={{ width: '100%', minWidth: 260, borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#F8FAFC' }}>
                                        <Th style={{ width: 38, textAlign: 'center' }}>No.</Th>
                                        <Th>이름</Th>
                                        <Th style={{ width: 110 }}>제외 사유</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {notice.excluded.map((m, i) => (
                                        <tr key={i} style={{ borderTop: '1px solid #EEF2F6' }}>
                                            <Td style={{ textAlign: 'center', color: '#94A3B8', fontWeight: 700 }}>{i + 1}</Td>
                                            <Td><span style={{ fontWeight: 800, color: '#0F172A', whiteSpace: 'nowrap' }}>{m.displayName}</span></Td>
                                            <Td><span style={{ fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap' }}>{m.reason}</span></Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* 하단 안내 */}
                <footer style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#64748B', lineHeight: 1.6, textAlign: 'center', wordBreak: 'keep-all' }}>
                        본 현황은 {ref} 기준으로 집계된 스냅샷입니다. 이후 납부 내역은 반영되지 않을 수 있습니다.
                    </p>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, textAlign: 'center', wordBreak: 'keep-all' }}>
                        전체 통장 잔액과 입출금 내역은 카카오뱅크 모임통장에서 확인할 수 있습니다.
                    </p>
                </footer>
            </div>
        </main>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h2 style={{ margin: '0 0 6px 2px', fontSize: 12.5, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
            {children}
        </h2>
    );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: NoticeMemberStatus }) {
    const color = tone === 'paid' ? '#047857' : tone === 'partial' ? '#92400E' : tone === 'pending' ? '#B91C1C' : '#0F172A';
    return (
        <div style={{ backgroundColor: '#FFFFFF', padding: '9px 8px', textAlign: 'center', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap' }}>{label}</p>
            <p style={{ margin: '2px 0 0', fontSize: 17, fontWeight: 900, color, whiteSpace: 'nowrap' }}>{value}</p>
        </div>
    );
}

function MoneyCell({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
    return (
        <div style={{ backgroundColor: '#FFFFFF', padding: '9px 8px', textAlign: 'center', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap' }}>{label}</p>
            <p style={{
                margin: '2px 0 0', fontSize: strong ? 15 : 13.5, fontWeight: 900,
                color: value > 0 ? '#B91C1C' : '#0E7C76', whiteSpace: 'nowrap',
            }}>
                {formatWon(value)}
            </p>
        </div>
    );
}

function StatusPill({ status, annual }: { status: NoticeMemberStatus; annual?: boolean }) {
    const map: Record<NoticeMemberStatus, { label: string; bg: string; color: string; border: string }> = {
        paid:    { label: '납부 완료', bg: '#E7F6EF', color: '#047857', border: '#A7E3C9' },
        partial: { label: '일부 납부', bg: '#FEF3D7', color: '#92400E', border: '#F4D58A' },
        pending: { label: '미납',     bg: '#FCE4E4', color: '#B91C1C', border: '#F3B4B4' },
    };
    // 연회비 완료 회원은 월 상태 대신 '연회비 납부 완료' 로 표시.
    const t = annual
        ? { label: '연회비 납부 완료', bg: '#E7F6EF', color: '#0E7C76', border: '#A7E3C9' }
        : map[status];
    return (
        <span style={{
            display: 'inline-block', whiteSpace: 'nowrap',
            fontSize: 10.5, fontWeight: 800,
            padding: '2px 8px', borderRadius: 5,
            backgroundColor: t.bg, color: t.color, border: `1px solid ${t.border}`,
        }}>
            {t.label}
        </span>
    );
}

function Th({ children, style, className }: { children?: React.ReactNode; style?: React.CSSProperties; className?: string }) {
    return (
        <th
            className={className}
            style={{
                padding: '8px 10px', textAlign: 'left',
                fontSize: 11, fontWeight: 800, color: '#475569', whiteSpace: 'nowrap',
                borderBottom: '1px solid #E2E8F0',
                ...style,
            }}
        >
            {children}
        </th>
    );
}

function Td({ children, style, className, colSpan }: { children?: React.ReactNode; style?: React.CSSProperties; className?: string; colSpan?: number }) {
    return (
        <td className={className} colSpan={colSpan} style={{ padding: '8px 10px', verticalAlign: 'middle', ...style }}>
            {children}
        </td>
    );
}
