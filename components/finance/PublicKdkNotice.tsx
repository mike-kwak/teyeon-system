'use client';

import React from 'react';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import { formatSeoulDateTime } from '@/lib/finance/noticesService';
import type { PublicKdkNoticeView, KdkNoticeMemberStatus } from '@/lib/finance/kdkNoticesService';
import PaymentAccountCard from '@/components/finance/PaymentAccountCard';

/**
 * KDK 벌금·상금 현황 공개 화면(읽기 전용, 로그인 불필요).
 *   - 흰색 한 장짜리 엑셀형 표(월회비 공개 현황과 동일 톤).
 *   - 실제 최종 1위(overallWinner)와 상금 지급 대상(recipient)을 분리 표시.
 *   - 데이터는 모두 스냅샷 고정값(RPC 응답). member_id/연락처/메모/생성자 없음.
 */
export default function PublicKdkNotice({ notice }: { notice: PublicKdkNoticeView }) {
    const s = notice.stats;
    const refLabel = formatSeoulDateTime(notice.referenceAt);
    const dueLabel = notice.dueAt ? formatSeoulDateTime(notice.dueAt) : null;
    const prize = notice.prize;

    return (
        <main style={{
            width: '100%', minHeight: '100dvh', backgroundColor: '#FFFFFF',
            paddingTop: 'calc(18px + env(safe-area-inset-top))',
            paddingBottom: 'calc(26px + env(safe-area-inset-bottom))',
            paddingLeft: 12, paddingRight: 12, boxSizing: 'border-box',
        }}>
            <div style={{ width: '100%', maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* 헤더 */}
                <header style={{ textAlign: 'center', paddingBottom: 6, borderBottom: '2px solid #0F172A' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.34em', textTransform: 'uppercase', color: '#0E7C76' }}>
                        TEYEON · KDK
                    </p>
                    <h1 style={{ margin: '5px 0 0', fontSize: 20, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
                        TEYEON KDK 벌금 납부 현황
                    </h1>
                    <div style={{ margin: '7px 0 4px', display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '2px 10px' }}>
                        {notice.kdkDate && <span style={{ fontSize: 13, fontWeight: 800, color: '#475569' }}>{dot(notice.kdkDate)}</span>}
                        {notice.sessionTitle && <span style={{ fontSize: 13, fontWeight: 700, color: '#64748B' }}>{notice.sessionTitle}</span>}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '2px 10px' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0E7C76' }}>{refLabel} 기준</span>
                        {dueLabel && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#B91C1C' }}>납부 마감 {dueLabel}</span>}
                    </div>
                </header>

                {/* 요약 */}
                <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, backgroundColor: '#E2E8F0', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                    <Summary label="벌금 대상" value={`${s.targetCount}명`} />
                    <Summary label="납부 완료" value={`${s.paidCount}명`} tone="paid" />
                    <Summary label="미납" value={`${s.unpaidCount}명`} tone="pending" />
                    <Summary label="총 벌금" value={formatWon(s.totalPenalty)} />
                    <Summary label="납부 완료 금액" value={formatWon(s.totalPaid)} tone="paid" />
                    <Summary label="미납 금액" value={formatWon(s.totalUnpaid)} tone="pending" />
                </section>

                {/* 공개 메모 */}
                {notice.publicNote && (
                    <p style={{ margin: 0, padding: '10px 12px', borderRadius: 8, backgroundColor: '#F0FDFA', border: '1px solid #99F6E4', fontSize: 12.5, fontWeight: 600, color: '#0F5132', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>
                        {notice.publicNote}
                    </p>
                )}

                {/* 입금 계좌 */}
                {notice.paymentAccount && (
                    <PaymentAccountCard account={notice.paymentAccount} label="벌금 입금 계좌" />
                )}

                {/* KDK 1등 상금 */}
                {prize && (
                    <section style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 14px', backgroundColor: '#FFFDF5' }}>
                        <h2 style={{ margin: 0, fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>KDK 1등 상금</h2>
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div>
                                <span style={miniLabel}>KDK 최종 1위</span>
                                <span style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                                    {prize.overallWinnerName}{prize.overallWinnerIsGuest ? ' (게스트)' : ''}
                                </span>
                            </div>
                            <div style={{ height: 1, background: '#F1E9C9' }} />
                            <div>
                                <span style={miniLabel}>KDK 1등 상금 지급 대상</span>
                                {prize.recipientName ? (
                                    <>
                                        <span style={{ fontSize: 13.5, fontWeight: 900, color: '#0F172A' }}>
                                            {prize.recipientName}
                                            {prize.recipientOverallRank ? <span style={{ marginLeft: 5, fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>· 전체 {prize.recipientOverallRank}위</span> : null}
                                        </span>
                                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 14, fontWeight: 900, color: '#92400E' }}>상금 {formatWon(prize.amount)}</span>
                                            <PrizePill paid={prize.status === 'paid'} />
                                        </div>
                                    </>
                                ) : (
                                    <span style={{ fontSize: 13, fontWeight: 800, color: '#64748B' }}>상금 지급 대상 없음</span>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {/* 회원별 벌금 납부 현황 */}
                <section>
                    <h2 style={{ margin: '0 0 6px 2px', fontSize: 12.5, fontWeight: 900, color: '#0F172A' }}>회원별 벌금 납부 현황</h2>
                    <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                        <table style={{ width: '100%', minWidth: 380, borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ backgroundColor: '#F8FAFC' }}>
                                    <Th style={{ width: 38, textAlign: 'center' }}>No.</Th>
                                    <Th>이름</Th>
                                    <Th style={{ textAlign: 'right' }}>벌금</Th>
                                    <Th style={{ textAlign: 'center', width: 74 }}>납부 상태</Th>
                                    <Th style={{ textAlign: 'right', width: 96 }}>납부일시</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {notice.members.map((m, i) => {
                                    const paid = m.status === 'paid';
                                    return (
                                        <tr key={i} style={{ borderTop: '1px solid #EEF2F6', backgroundColor: paid ? '#F1FAF5' : '#FDF2F2' }}>
                                            <Td style={{ textAlign: 'center', color: '#94A3B8', fontWeight: 700 }}>{i + 1}</Td>
                                            <Td><span style={{ fontWeight: 800, color: '#0F172A', whiteSpace: 'nowrap' }}>{m.name}</span></Td>
                                            <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 800, color: '#0F172A' }}>{formatWon(m.amount)}</Td>
                                            <Td style={{ textAlign: 'center' }}><MemberPill status={m.status} /></Td>
                                            <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: '#64748B', fontWeight: 700 }}>{m.paidAt || '-'}</Td>
                                        </tr>
                                    );
                                })}
                                {notice.members.length === 0 && (
                                    <tr><Td colSpan={5} style={{ textAlign: 'center', color: '#94A3B8', padding: 16 }}>벌금 대상이 없습니다.</Td></tr>
                                )}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                                    <Td colSpan={2} style={{ textAlign: 'center' }}><span style={{ fontWeight: 800, color: '#475569' }}>합계</span></Td>
                                    <Td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 900, color: '#0F172A' }}>{formatWon(s.totalPenalty)}</Td>
                                    <Td colSpan={2} style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 900, color: '#B91C1C' }}>미납 {formatWon(s.totalUnpaid)}</Td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </section>

                {/* 전체 순위 링크 */}
                {notice.rankingUrl && (
                    <a href={notice.rankingUrl} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 10, backgroundColor: '#0F172A', color: '#FFFFFF', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>
                        전체 KDK 순위 보기
                    </a>
                )}

                {/* 하단 안내 */}
                <footer style={{ marginTop: 2 }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#64748B', lineHeight: 1.6, textAlign: 'center', wordBreak: 'keep-all' }}>
                        본 현황은 {refLabel} 기준으로 집계된 스냅샷입니다. 이후 납부 내역은 반영되지 않을 수 있습니다.
                    </p>
                </footer>
            </div>
        </main>
    );
}

const miniLabel: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 800, color: '#94A3B8', marginBottom: 2 };

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'paid' | 'pending' }) {
    const color = tone === 'paid' ? '#047857' : tone === 'pending' ? '#B91C1C' : '#0F172A';
    return (
        <div style={{ backgroundColor: '#FFFFFF', padding: '9px 8px', textAlign: 'center', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap' }}>{label}</p>
            <p style={{ margin: '2px 0 0', fontSize: 14.5, fontWeight: 900, color, whiteSpace: 'nowrap' }}>{value}</p>
        </div>
    );
}

function MemberPill({ status }: { status: KdkNoticeMemberStatus }) {
    const map: Record<KdkNoticeMemberStatus, { label: string; bg: string; color: string; border: string }> = {
        paid:    { label: '납부 완료', bg: '#E7F6EF', color: '#047857', border: '#A7E3C9' },
        partial: { label: '일부 납부', bg: '#FEF3D7', color: '#92400E', border: '#F4D58A' },
        pending: { label: '미납',     bg: '#FCE4E4', color: '#B91C1C', border: '#F3B4B4' },
    };
    const t = map[status];
    return <span style={{ display: 'inline-block', whiteSpace: 'nowrap', fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 5, backgroundColor: t.bg, color: t.color, border: `1px solid ${t.border}` }}>{t.label}</span>;
}

function PrizePill({ paid }: { paid: boolean }) {
    return (
        <span style={{ display: 'inline-block', whiteSpace: 'nowrap', fontSize: 10.5, fontWeight: 800, padding: '2px 9px', borderRadius: 5, backgroundColor: paid ? '#E7F6EF' : '#FCE4E4', color: paid ? '#047857' : '#B91C1C', border: `1px solid ${paid ? '#A7E3C9' : '#F3B4B4'}` }}>
            {paid ? '지급 완료' : '미지급'}
        </span>
    );
}

function dot(dateStr: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : dateStr;
}

function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
    return <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 800, color: '#475569', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0', ...style }}>{children}</th>;
}
function Td({ children, style, colSpan }: { children?: React.ReactNode; style?: React.CSSProperties; colSpan?: number }) {
    return <td colSpan={colSpan} style={{ padding: '8px 10px', verticalAlign: 'middle', ...style }}>{children}</td>;
}
