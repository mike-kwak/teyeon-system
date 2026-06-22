'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon, isValidPaymentAmount } from '@/lib/finance/formatFinanceAmount';
import {
    fetchAllMembers,
    fetchReceivablesByMonth,
    insertPaymentsBulk,
    type FinanceMember,
} from '@/lib/finance/duesService';
import { fetchFeeRule } from '@/lib/finance/feeRulesService';
import { summarizeReceivable } from '@/lib/finance/calculatePaymentStatus';
import { supabase } from '@/lib/supabase';
import {
    FinancePageHeader,
    StatusBadge,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import {
    RECEIVABLE_TYPE_LABEL,
    type FinanceDuesPayment,
    type FinanceDuesReceivable,
    type FinanceReceivableType,
    type PaymentDerivedStatus,
} from '@/types/finance';

/**
 * /finance/bulk — 동일 항목·동일 금액을 여러 회원에게 일괄 납부 처리.
 *   - 연·월 + 유형 선택
 *   - 회원 검색 + 다중 선택 (이미 paid 인 회원은 기본 선택 해제)
 *   - 저장 시 회원별 finance_dues_payments row 일괄 생성
 *   - 같은 월의 receivable 이 있으면 receivable_id 연결.
 */
export default function FinanceBulkPage() {
    const router = useRouter();
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    const today = new Date();
    const [year, setYear] = React.useState(today.getFullYear());
    const [month, setMonth] = React.useState(today.getMonth() + 1);
    const [paymentType, setPaymentType] = React.useState<FinanceReceivableType>('monthly_fee');
    const [amountStr, setAmountStr] = React.useState<string>('');
    const [paidAt, setPaidAt] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
    const [memo, setMemo] = React.useState('');

    const [members, setMembers] = React.useState<FinanceMember[]>([]);
    const [receivables, setReceivables] = React.useState<FinanceDuesReceivable[]>([]);
    const [payments, setPayments] = React.useState<FinanceDuesPayment[]>([]);
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [search, setSearch] = React.useState('');
    const [onlyUnpaid, setOnlyUnpaid] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);

    // 월회비 자동 금액 제안.
    React.useEffect(() => {
        if (paymentType !== 'monthly_fee') return;
        if (amountStr) return;
        (async () => {
            const rule = await fetchFeeRule(year, month);
            if (rule) setAmountStr(String(rule.default_amount));
        })();
    }, [paymentType, year, month, amountStr]);

    const load = React.useCallback(async () => {
        setLoading(true);
        const [mems, recv] = await Promise.all([
            fetchAllMembers(),
            fetchReceivablesByMonth(year, month),
        ]);
        const recvIds = recv.map((r) => r.id);
        const { data: payRows } = recvIds.length > 0
            ? await supabase.from('finance_dues_payments').select('*').in('receivable_id', recvIds)
            : { data: [] as FinanceDuesPayment[] };
        setMembers(mems);
        setReceivables(recv);
        setPayments((payRows || []) as FinanceDuesPayment[]);
        setLoading(false);
    }, [year, month]);

    React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

    // 회원별 status — 해당 월 receivable 매칭.
    const memberStatus = React.useMemo(() => {
        const map: Record<string, { status: PaymentDerivedStatus; receivableId: string | null }> = {};
        for (const m of members) {
            const r = receivables.find((x) => x.member_id === m.id);
            if (r) {
                const s = summarizeReceivable(r, payments);
                map[m.id] = { status: s.derivedStatus, receivableId: r.id };
            } else {
                map[m.id] = { status: 'pending', receivableId: null };
            }
        }
        return map;
    }, [members, receivables, payments]);

    // 검색 + 필터.
    const visibleMembers = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        return members.filter((m) => {
            if (q && !(m.nickname || '').toLowerCase().includes(q)) return false;
            if (onlyUnpaid) {
                const s = memberStatus[m.id]?.status;
                if (s === 'paid' || s === 'exempt' || s === 'not_target') return false;
            }
            return true;
        });
    }, [members, search, onlyUnpaid, memberStatus]);

    // 이미 완료된 회원은 기본 선택에서 해제.
    React.useEffect(() => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const id of Array.from(next)) {
                if (memberStatus[id]?.status === 'paid') next.delete(id);
            }
            return next;
        });
    }, [memberStatus]);

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const selectAllVisible = () => {
        setSelected((prev) => {
            const next = new Set(prev);
            for (const m of visibleMembers) {
                if (memberStatus[m.id]?.status !== 'paid') next.add(m.id);
            }
            return next;
        });
    };
    const clearSelection = () => setSelected(new Set());

    const amount = Number(amountStr);
    const validAmount = isValidPaymentAmount(amount);
    const totalAmount = validAmount ? amount * selected.size : 0;

    // 이미 paid 인 회원이 선택에 포함됐는지 검사 — 저장 시 경고.
    const selectedAlreadyPaid = React.useMemo(() => {
        const list: string[] = [];
        for (const id of Array.from(selected)) {
            if (memberStatus[id]?.status === 'paid') list.push(id);
        }
        return list;
    }, [selected, memberStatus]);

    const handleSave = async () => {
        if (!validAmount) { alert('금액을 입력해 주세요.'); return; }
        if (selected.size === 0) { alert('회원을 1명 이상 선택해 주세요.'); return; }
        if (selectedAlreadyPaid.length > 0) {
            const ok = window.confirm(
                `이미 납부 완료된 회원 ${selectedAlreadyPaid.length}명이 포함되어 있습니다.\n중복 기록을 추가하시겠습니까?`
            );
            if (!ok) return;
        }
        setSaving(true);
        try {
            const receivableMap: Record<string, string | null> = {};
            for (const id of Array.from(selected)) {
                receivableMap[id] = memberStatus[id]?.receivableId ?? null;
            }
            await insertPaymentsBulk({
                memberIds: Array.from(selected),
                receivableMap,
                payment_type: paymentType,
                amount,
                paid_at: paidAt,
                memo: memo.trim() || null,
                userId: user?.id,
            });
            router.push('/finance/payments');
        } catch (e: any) {
            alert(e?.message || '일괄 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

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

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="일괄 납부 처리"
                    subtitle="동일 항목을 여러 회원에게 한 번에 기록합니다."
                    backHref="/finance"
                />

                <section style={FINANCE_CARD_STYLE}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Field label="연도">
                                <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={inputStyle}>
                                    {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
                                </select>
                            </Field>
                            <Field label="월">
                                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={inputStyle}>
                                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
                                </select>
                            </Field>
                        </div>
                        <Field label="유형">
                            <select
                                value={paymentType}
                                onChange={(e) => setPaymentType(e.target.value as FinanceReceivableType)}
                                style={inputStyle}
                            >
                                {(Object.keys(RECEIVABLE_TYPE_LABEL) as FinanceReceivableType[]).map((k) => (
                                    <option key={k} value={k}>{RECEIVABLE_TYPE_LABEL[k]}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="금액 (원)">
                            <input
                                type="number"
                                inputMode="numeric"
                                value={amountStr}
                                onChange={(e) => setAmountStr(e.target.value)}
                                placeholder="0"
                                style={inputStyle}
                            />
                        </Field>
                        <Field label="납부일">
                            <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} style={inputStyle} />
                        </Field>
                        <Field label="메모 (선택)">
                            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} style={inputStyle} />
                        </Field>
                    </div>
                </section>

                {/* 회원 선택 */}
                <section style={FINANCE_CARD_STYLE}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                            회원 선택
                        </h3>
                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#0E7C76' }}>
                            {selected.size}명 · 합계 {formatWon(totalAmount)}
                        </span>
                    </div>

                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                        paddingTop: 6, paddingBottom: 6, paddingLeft: 10, paddingRight: 10,
                        borderRadius: 8,
                        border: '1px solid rgba(15,23,42,0.10)',
                        backgroundColor: '#F8FAFC',
                    }}>
                        <Search size={13} style={{ color: '#94A3B8' }} />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="회원 검색"
                            style={{
                                flex: 1, height: 24, border: 'none', backgroundColor: 'transparent',
                                outline: 'none', fontSize: 12.5, fontWeight: 700, color: '#0F172A',
                                minWidth: 0,
                            }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#475569' }}>
                            <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} />
                            미납만 보기
                        </label>
                        <button type="button" onClick={selectAllVisible} style={smallButton}>표시 전체 선택</button>
                        <button type="button" onClick={clearSelection} style={smallButton}>선택 해제</button>
                    </div>

                    {loading ? (
                        <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                            불러오는 중...
                        </p>
                    ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {visibleMembers.map((m) => {
                                const st = memberStatus[m.id]?.status ?? 'pending';
                                const isSel = selected.has(m.id);
                                return (
                                    <li key={m.id}>
                                        <button
                                            type="button"
                                            onClick={() => toggle(m.id)}
                                            style={{
                                                width: '100%',
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10,
                                                borderRadius: 8,
                                                backgroundColor: isSel ? 'rgba(15,159,152,0.08)' : '#FFFFFF',
                                                border: `1px solid ${isSel ? 'rgba(15,159,152,0.30)' : 'rgba(15,23,42,0.06)'}`,
                                                cursor: 'pointer',
                                                WebkitTapHighlightColor: 'transparent',
                                            }}
                                        >
                                            <span style={{
                                                width: 18, height: 18, borderRadius: 4,
                                                backgroundColor: isSel ? '#0F9F98' : '#FFFFFF',
                                                border: `1.5px solid ${isSel ? '#0F9F98' : 'rgba(15,23,42,0.16)'}`,
                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                color: '#FFFFFF',
                                                flexShrink: 0,
                                            }}>
                                                {isSel && <Check size={12} strokeWidth={3} />}
                                            </span>
                                            <span style={{
                                                flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: '#0F172A',
                                                textAlign: 'left',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>
                                                {m.nickname || '회원 정보 없음'}
                                            </span>
                                            <StatusBadge tone={st}>
                                                {st === 'paid' ? '완료'
                                                    : st === 'partial' ? '일부'
                                                    : st === 'pending' ? '미납'
                                                    : st === 'exempt' ? '면제' : '비대상'}
                                            </StatusBadge>
                                        </button>
                                    </li>
                                );
                            })}
                            {visibleMembers.length === 0 && (
                                <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                                    검색 결과가 없습니다.
                                </p>
                            )}
                        </ul>
                    )}
                </section>

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !validAmount || selected.size === 0}
                    style={{
                        height: 44, borderRadius: 12,
                        backgroundColor: saving || !validAmount || selected.size === 0 ? '#CBD5E1' : '#0F9F98',
                        color: '#FFFFFF', border: 'none',
                        fontSize: 13, fontWeight: 900,
                        cursor: saving ? 'wait' : (!validAmount || selected.size === 0 ? 'not-allowed' : 'pointer'),
                    }}
                >
                    {saving ? '저장 중...' : `${selected.size}명에게 ${formatWon(amount)} 일괄 처리`}
                </button>
            </div>
        </main>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>{label}</span>
            {children}
        </label>
    );
}

const inputStyle: React.CSSProperties = {
    height: 36,
    paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12.5, fontWeight: 700, color: '#0F172A',
    backgroundColor: '#FFFFFF',
    boxSizing: 'border-box',
    outline: 'none',
    width: '100%',
};

const smallButton: React.CSSProperties = {
    height: 26, paddingLeft: 10, paddingRight: 10,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    color: '#0F172A',
    border: '1px solid rgba(15,23,42,0.08)',
    fontSize: 10.5, fontWeight: 800,
    cursor: 'pointer',
};
