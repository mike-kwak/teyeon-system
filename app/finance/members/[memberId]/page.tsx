'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Copy, Check, Pencil, ShieldOff, ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    fetchReceivablesByMember,
    fetchPaymentsByMember,
    updateReceivableStatus,
    fetchOverlappingMonthlyReceivables,
} from '@/lib/finance/duesService';
import {
    fetchLeavesByMember,
    insertLeave,
    deleteLeave,
} from '@/lib/finance/leavesService';
import PaymentEditModal from '@/components/finance/PaymentEditModal';
import {
    summarizeMemberYear,
    summarizeReceivable,
} from '@/lib/finance/calculatePaymentStatus';
import { supabase } from '@/lib/supabase';
import {
    FinancePageHeader,
    StatusBadge,
    KpiCard,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import ProfileAvatar from '@/components/ProfileAvatar';
import { InitialAvatar } from '@/components/tournament/InitialAvatar';
import {
    RECEIVABLE_TYPE_LABEL,
    type FinanceDuesPayment,
    type FinanceDuesReceivable,
    type FinanceReceivableStatus,
    type FinanceMemberLeave,
} from '@/types/finance';

/**
 * /finance/members/[memberId] — 회원 한 명의 연도별 납부 상세.
 * 일반 회원이 다른 회원 URL 로 진입해도 RLS 가 row 자체를 막아 응답 없음.
 */
export default function FinanceMemberDetailPage() {
    const params = useParams<{ memberId: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const today = new Date();
    const initialYear = parseYearParam(searchParams?.get('year'), today.getFullYear());
    // month 는 화면 내부 동작에는 안 쓰이지만 다른 Finance 화면과 URL query 일관성을 위해 보존·전달.
    const initialMonth = parseMonthParam(searchParams?.get('month'), today.getMonth() + 1);
    const memberId = params?.memberId || '';

    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    const [year, setYear] = React.useState(initialYear);
    const [monthQuery] = React.useState(initialMonth);

    // year 변경 시 URL ?year= 도 같이 갱신 → 새로고침 / 뒤로가기 후에도 선택 연도 유지.
    const updateYear = React.useCallback((y: number) => {
        setYear(y);
        const sp = new URLSearchParams(searchParams?.toString() || '');
        sp.set('year', String(y));
        sp.set('month', String(monthQuery));
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }, [router, pathname, searchParams, monthQuery]);
    const [memberName, setMemberName] = React.useState<string>('');
    const [memberAvatar, setMemberAvatar] = React.useState<string | null>(null);
    const [receivables, setReceivables] = React.useState<FinanceDuesReceivable[]>([]);
    const [payments, setPayments] = React.useState<FinanceDuesPayment[]>([]);
    const [leaves, setLeaves] = React.useState<FinanceMemberLeave[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [copyState, setCopyState] = React.useState<'idle' | 'copied'>('idle');
    const [editingPayment, setEditingPayment] = React.useState<FinanceDuesPayment | null>(null);

    // 휴회 입력 form
    const [leaveStart, setLeaveStart] = React.useState('');
    const [leaveEnd, setLeaveEnd] = React.useState('');
    const [leaveReason, setLeaveReason] = React.useState('');

    const load = React.useCallback(async () => {
        setLoading(true);
        const [recv, pays, mRow, lvs] = await Promise.all([
            fetchReceivablesByMember(memberId, year),
            fetchPaymentsByMember(memberId, year),
            supabase.from('members').select('nickname, avatar_url').eq('id', memberId).maybeSingle(),
            fetchLeavesByMember(memberId),
        ]);
        setReceivables(recv);
        setPayments(pays);
        setMemberName((mRow.data?.nickname as string) || '회원 정보 없음');
        setMemberAvatar((mRow.data?.avatar_url as string) || null);
        setLeaves(lvs);
        setLoading(false);
    }, [memberId, year]);

    React.useEffect(() => { if (isAdmin && memberId) load(); }, [isAdmin, memberId, load]);

    const summary = React.useMemo(() => {
        if (!memberId) return null;
        return summarizeMemberYear(memberId, year, receivables, payments);
    }, [memberId, year, receivables, payments]);

    const rows = React.useMemo(() => {
        return receivables.map((r) => ({ r, s: summarizeReceivable(r, payments) }));
    }, [receivables, payments]);

    if (!isLoading && !isAdmin) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>운영자만 접근할 수 있는 페이지입니다.</p>
                    <Link href="/finance" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#0E7C76' }}>
                        ← Finance
                    </Link>
                </div>
            </main>
        );
    }

    const handleStatus = async (receivableId: string, status: FinanceReceivableStatus) => {
        const ok = window.confirm(
            status === 'exempt' ? '이 항목을 면제 처리하시겠습니까?'
            : status === 'not_target' ? '이 항목을 비대상 처리하시겠습니까?'
            : '상태를 되돌리시겠습니까?'
        );
        if (!ok) return;
        try {
            await updateReceivableStatus(receivableId, status);
            await load();
        } catch (e: any) {
            alert(e?.message || '상태 변경에 실패했습니다.');
        }
    };

    // 휴회 등록 + 기존 청구 면제 흐름.
    //   1) insertLeave 로 휴회 row 생성 (실패 시 후속 단계 진행 안 함).
    //   2) 휴회 구간과 겹치는 monthly_fee receivable 중 pending/partial 만 후보로 조회
    //      (이미 exempt/not_target/paid 인 row 는 자동 제외 — 운영진 결정 보존).
    //   3) 후보가 있으면 "N건 면제 처리?" 확인. 거절하면 아무 것도 안 함.
    //   4) 승인 시 status='exempt' 로 일괄 변경 (실패 row 는 모아 alert).
    //      → 미납 / 남은 금액 계산은 summarizeReceivable 가 즉시 제외하므로 화면 새로고침으로 반영.
    // ⚠️ 자동 삭제 / 자동 면제는 절대 하지 않는다. 운영진 확인 필수.
    const handleAddLeave = async () => {
        if (!leaveStart) { alert('휴회 시작일을 입력해 주세요.'); return; }
        const startSnapshot = leaveStart;
        const endSnapshot = leaveEnd || null;
        try {
            await insertLeave({
                member_id: memberId,
                start_date: startSnapshot,
                end_date: endSnapshot,
                reason: leaveReason.trim() || null,
                userId: user?.id,
            });
            setLeaveStart(''); setLeaveEnd(''); setLeaveReason('');

            // 겹치는 월회비 청구 — pending / partial 만 후보. (이미 exempt 면 굳이 다시 변경 안 함.)
            const overlapping = await fetchOverlappingMonthlyReceivables({
                memberId,
                startDate: startSnapshot,
                endDate: endSnapshot,
            });
            const candidates = overlapping.filter((r) =>
                r.status === 'pending' || r.status === 'partial',
            );

            if (candidates.length > 0) {
                const summaryLines = candidates
                    .slice(0, 10)
                    .map((r) => `· ${r.target_year}년 ${r.target_month}월 ${formatWon(r.amount_due)}`);
                const more = candidates.length > summaryLines.length
                    ? `\n(외 ${candidates.length - summaryLines.length}건)`
                    : '';
                const ok = window.confirm(
                    `휴회 기간과 겹치는 기존 월회비 청구가 ${candidates.length}건 있습니다.\n` +
                    `해당 청구를 면제 처리하시겠습니까?\n\n${summaryLines.join('\n')}${more}`,
                );
                if (ok) {
                    const failed: { month: number | null; reason: string }[] = [];
                    for (const r of candidates) {
                        try {
                            await updateReceivableStatus(r.id, 'exempt', {
                                exemption_reason: '휴회 자동 면제',
                            });
                        } catch (e: any) {
                            failed.push({ month: r.target_month, reason: e?.message || String(e) });
                        }
                    }
                    if (failed.length > 0) {
                        alert(
                            `일부 청구 면제에 실패했습니다 (${failed.length}건).\n` +
                            failed.slice(0, 5).map((f) => `${f.month ?? '?'}월: ${f.reason}`).join('\n'),
                        );
                    }
                }
            }

            await load();
        } catch (e: any) {
            alert(e?.message || '휴회 등록에 실패했습니다.');
        }
    };
    const handleDeleteLeave = async (id: string) => {
        const ok = window.confirm('이 휴회 기록을 삭제하시겠습니까?');
        if (!ok) return;
        try {
            await deleteLeave(id);
            await load();
        } catch (e: any) {
            alert(e?.message || '삭제에 실패했습니다.');
        }
    };

    const handleCopyOverdue = async () => {
        const pendingOrPartial = rows
            .filter(({ s }) => s.derivedStatus === 'pending' || s.derivedStatus === 'partial')
            .map(({ r, s }) => `· ${r.title || `${r.target_year}년 ${r.target_month}월 회비`} — 남은 금액 ${formatWon(s.remaining)}`);
        if (pendingOrPartial.length === 0) {
            alert('미납 항목이 없습니다.');
            return;
        }
        const text = [
            `[TEYEON ${year}년 미납 안내]`,
            `${memberName} 님께`,
            '',
            ...pendingOrPartial,
            '',
            `총 남은 금액: ${formatWon(summary?.totalRemaining ?? 0)}`,
            '',
            '카카오뱅크 모임통장으로 입금 부탁드립니다.',
        ].join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setCopyState('copied');
            window.setTimeout(() => setCopyState('idle'), 2000);
        } catch {
            alert('복사에 실패했습니다.');
        }
    };

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="회원 납부 상세"
                    backHref={`/finance/payments?year=${year}&month=${monthQuery}`}
                />

                <section style={FINANCE_CARD_STYLE}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 48, height: 48, flexShrink: 0 }}>
                            {memberAvatar ? (
                                <ProfileAvatar
                                    src={memberAvatar}
                                    alt="프로필 이미지"
                                    size={48}
                                    className="rounded-full"
                                    fallbackIcon={<InitialAvatar name={memberName} size={48} />}
                                />
                            ) : (
                                <InitialAvatar name={memberName} size={48} />
                            )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A', wordBreak: 'keep-all' }}>
                                {memberName}
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                                {year}년 납부 현황
                            </p>
                        </div>
                        <select
                            value={year}
                            onChange={(e) => updateYear(Number(e.target.value))}
                            style={{
                                height: 32, paddingLeft: 10, paddingRight: 10,
                                borderRadius: 8, border: '1px solid rgba(15,23,42,0.10)',
                                fontSize: 12, fontWeight: 800, color: '#0F172A',
                                backgroundColor: '#FFFFFF',
                            }}
                        >
                            {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
                        </select>
                    </div>
                </section>

                {summary && (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <KpiCard label="납부 대상" value={formatWon(summary.totalDue)} />
                            <KpiCard label="납부 완료" value={formatWon(summary.totalPaid)} accent="teal" />
                        </div>
                        <KpiCard label="남은 금액" value={formatWon(summary.totalRemaining)} accent={summary.totalRemaining > 0 ? 'red' : 'teal'} />
                    </>
                )}

                <section style={FINANCE_CARD_STYLE}>
                    <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                        항목별 청구
                    </h3>
                    {loading && (
                        <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                            불러오는 중...
                        </p>
                    )}
                    {!loading && rows.length === 0 && (
                        <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                            등록된 항목이 없습니다.
                        </p>
                    )}
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {rows.map(({ r, s }) => (
                            <li
                                key={r.id}
                                style={{
                                    paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12,
                                    borderRadius: 10,
                                    backgroundColor: '#F8FAFC',
                                    border: '1px solid rgba(15,23,42,0.06)',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A', wordBreak: 'keep-all' }}>
                                            {r.title || `${r.target_year}년 ${r.target_month}월 ${RECEIVABLE_TYPE_LABEL[r.receivable_type]}`}
                                        </p>
                                        <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                                            기준 {formatWon(r.amount_due)} · 완료 {formatWon(s.amount_paid)}
                                            {r.due_date ? ` · 기한 ${r.due_date}` : ''}
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
                                                    : s.derivedStatus === 'exempt' ? '면제' : '비대상'}
                                            </StatusBadge>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {r.status !== 'exempt' && (
                                        <button type="button" onClick={() => handleStatus(r.id, 'exempt')} style={ghostButton}>
                                            <ShieldOff size={11} /> 면제
                                        </button>
                                    )}
                                    {r.status !== 'not_target' && (
                                        <button type="button" onClick={() => handleStatus(r.id, 'not_target')} style={ghostButton}>
                                            비대상
                                        </button>
                                    )}
                                    {(r.status === 'exempt' || r.status === 'not_target') && (
                                        <button type="button" onClick={() => handleStatus(r.id, 'pending')} style={ghostButton}>
                                            <ShieldCheck size={11} /> 되돌리기
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* 휴회 관리 */}
                <section style={FINANCE_CARD_STYLE}>
                    <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                        휴회 관리
                    </h3>
                    {leaves.length === 0 ? (
                        <p style={{ margin: '6px 0 12px', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                            등록된 휴회 구간이 없습니다.
                        </p>
                    ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {leaves.map((l) => (
                                <li
                                    key={l.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        paddingTop: 8, paddingBottom: 8,
                                        borderTop: '1px dashed rgba(15,23,42,0.05)',
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                                            {l.start_date} ~ {l.end_date ?? '무기한'}
                                        </p>
                                        {l.reason && (
                                            <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                                                {l.reason}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleDeleteLeave(l.id)}
                                        aria-label="휴회 삭제"
                                        style={{
                                            width: 26, height: 26, borderRadius: 6,
                                            border: '1px solid rgba(15,23,42,0.08)',
                                            backgroundColor: '#FFFFFF', color: '#94A3B8',
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div style={{
                        display: 'flex', flexDirection: 'column', gap: 8,
                        paddingTop: 10, borderTop: '1px dashed rgba(15,23,42,0.06)',
                    }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>시작일</span>
                                <input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} style={detailInputStyle} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>종료일 (선택)</span>
                                <input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} style={detailInputStyle} />
                            </label>
                        </div>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>사유 (선택)</span>
                            <input type="text" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="예: 1년 휴회" style={detailInputStyle} />
                        </label>
                        <button type="button" onClick={handleAddLeave} style={{
                            height: 34, paddingLeft: 12, paddingRight: 12,
                            borderRadius: 8,
                            backgroundColor: '#0F9F98', color: '#FFFFFF', border: 'none',
                            fontSize: 11.5, fontWeight: 800,
                            cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}>
                            <Plus size={12} /> 휴회 추가
                        </button>
                    </div>
                </section>

                <section style={FINANCE_CARD_STYLE}>
                    <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                        납부 이력
                    </h3>
                    {payments.length === 0 ? (
                        <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                            기록된 납부가 없습니다.
                        </p>
                    ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {payments.map((p) => {
                                const voided = !!p.is_voided;
                                return (
                                    <li
                                        key={p.id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            paddingTop: 8, paddingBottom: 8,
                                            borderTop: '1px dashed rgba(15,23,42,0.05)',
                                            opacity: voided ? 0.55 : 1,
                                        }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{
                                                margin: 0, fontSize: 12, fontWeight: 800,
                                                color: voided ? '#94A3B8' : '#0F172A',
                                                textDecoration: voided ? 'line-through' : undefined,
                                            }}>
                                                {RECEIVABLE_TYPE_LABEL[p.payment_type]}
                                                {voided && <span style={{ marginLeft: 6, fontSize: 9, color: '#B91C1C', textDecoration: 'none' }}>· 취소됨</span>}
                                            </p>
                                            <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                                                {p.paid_at}{p.memo ? ` · ${p.memo}` : ''}
                                            </p>
                                        </div>
                                        <strong style={{
                                            fontSize: 12.5, fontWeight: 900,
                                            color: voided ? '#94A3B8' : '#0E7C76',
                                            whiteSpace: 'nowrap',
                                            textDecoration: voided ? 'line-through' : undefined,
                                        }}>
                                            {formatWon(p.amount)}
                                        </strong>
                                        <button
                                            type="button"
                                            onClick={() => setEditingPayment(p)}
                                            aria-label="기록 편집"
                                            style={{
                                                width: 26, height: 26, borderRadius: 6,
                                                border: '1px solid rgba(15,23,42,0.08)',
                                                backgroundColor: '#FFFFFF', color: '#475569',
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <Pencil size={12} />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                <div style={{ display: 'flex', gap: 8 }}>
                    <Link
                        href={`/finance/record?year=${year}&month=${monthQuery}`}
                        style={{
                            ...FINANCE_CARD_STYLE,
                            flex: 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            textDecoration: 'none',
                            backgroundColor: '#0F9F98', color: '#FFFFFF',
                            borderColor: '#0F9F98',
                            padding: 12, fontSize: 12.5, fontWeight: 900,
                        }}
                    >
                        납부 기록 추가
                    </Link>
                    <button
                        type="button"
                        onClick={handleCopyOverdue}
                        style={{
                            ...FINANCE_CARD_STYLE,
                            flex: 1,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            backgroundColor: '#FFFFFF',
                            padding: 12, fontSize: 12.5, fontWeight: 900, color: '#0F172A',
                            cursor: 'pointer',
                        }}
                    >
                        {copyState === 'copied' ? <Check size={12} /> : <Copy size={12} />}
                        {copyState === 'copied' ? '복사됨' : '미납 안내문 복사'}
                    </button>
                </div>
            </div>

            {/* 납부 기록 편집 / 취소 모달 */}
            <PaymentEditModal
                payment={editingPayment}
                onClose={() => setEditingPayment(null)}
                onSaved={() => { load(); }}
                userId={user?.id}
            />
        </main>
    );
}

// URL query parser — Finance 전 페이지 동일 규칙.
function parseYearParam(raw: string | null | undefined, fallback: number): number {
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 2020 || n > 2099) return fallback;
    return n;
}
function parseMonthParam(raw: string | null | undefined, fallback: number): number {
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 12) return fallback;
    return n;
}

const detailInputStyle: React.CSSProperties = {
    height: 32,
    paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12, fontWeight: 700, color: '#0F172A',
    backgroundColor: '#FFFFFF',
    boxSizing: 'border-box',
    outline: 'none', width: '100%',
};

const ghostButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    height: 26, paddingLeft: 10, paddingRight: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    color: '#475569',
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 10.5, fontWeight: 800,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
};
