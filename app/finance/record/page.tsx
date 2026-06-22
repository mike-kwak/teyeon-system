'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon, isValidPaymentAmount } from '@/lib/finance/formatFinanceAmount';
import {
    fetchAllMembers,
    insertPayment,
    findDuplicatePayment,
    type FinanceMember,
} from '@/lib/finance/duesService';
import { fetchFeeRule } from '@/lib/finance/feeRulesService';
import {
    FinancePageHeader,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import {
    RECEIVABLE_TYPE_LABEL,
    type FinanceReceivableType,
} from '@/types/finance';

/**
 * /finance/record — 단일 회원, 여러 항목 납부 기록 등록.
 *   - 항목별로 type / 대상 월 / 금액 입력
 *   - 월회비 선택 시 해당 연·월 회비 기준 금액 기본값 제안
 *   - 저장 전 요약 + 중복 경고
 *   - 저장 시 항목별 finance_dues_payments row 분리 생성
 */

interface ItemDraft {
    id: string;
    payment_type: FinanceReceivableType;
    target_year: number | null;
    target_month: number | null;
    amount: string;     // input string — 빈 값 허용
}

const newItem = (): ItemDraft => ({
    id: Math.random().toString(36).slice(2),
    payment_type: 'monthly_fee',
    target_year: new Date().getFullYear(),
    target_month: new Date().getMonth() + 1,
    amount: '',
});

export default function FinanceRecordPage() {
    const router = useRouter();
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    const [members, setMembers] = React.useState<FinanceMember[]>([]);
    const [memberId, setMemberId] = React.useState<string>('');
    const [paidAt, setPaidAt] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
    const [memo, setMemo] = React.useState<string>('');
    const [items, setItems] = React.useState<ItemDraft[]>([newItem()]);
    const [saving, setSaving] = React.useState(false);
    const [saveError, setSaveError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!isAdmin) return;
        (async () => {
            const list = await fetchAllMembers();
            setMembers(list);
        })();
    }, [isAdmin]);

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

    const memberName = members.find((m) => m.id === memberId)?.nickname ?? null;

    const totalAmount = items.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
    const validItems = items.filter((it) => isValidPaymentAmount(Number(it.amount)));

    const updateItem = (id: string, patch: Partial<ItemDraft>) => {
        setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it));
    };
    const addItem = () => setItems((prev) => [...prev, newItem()]);
    const removeItem = (id: string) => setItems((prev) => prev.length > 1 ? prev.filter((it) => it.id !== id) : prev);

    // 월회비 / 연·월 변경 시 기본 금액 자동 제안 (현재 값이 비어있을 때만).
    const handleItemTypeChange = async (id: string, type: FinanceReceivableType) => {
        updateItem(id, { payment_type: type });
        if (type === 'monthly_fee') {
            const cur = items.find((it) => it.id === id);
            if (cur && cur.target_year && cur.target_month && !cur.amount) {
                const rule = await fetchFeeRule(cur.target_year, cur.target_month);
                if (rule) updateItem(id, { amount: String(rule.default_amount) });
            }
        }
    };
    const handleItemMonthChange = async (id: string, year: number, month: number) => {
        updateItem(id, { target_year: year, target_month: month });
        const cur = items.find((it) => it.id === id);
        if (cur?.payment_type === 'monthly_fee' && !cur.amount) {
            const rule = await fetchFeeRule(year, month);
            if (rule) updateItem(id, { amount: String(rule.default_amount) });
        }
    };

    const handleSave = async () => {
        if (!memberId) { alert('회원을 선택해 주세요.'); return; }
        if (validItems.length === 0) { alert('금액을 1건 이상 입력해 주세요.'); return; }

        // 중복 경고 — 같은 회원 / 같은 type / 같은 날짜 / 같은 금액.
        for (const it of validItems) {
            const dup = await findDuplicatePayment({
                member_id: memberId,
                payment_type: it.payment_type,
                amount: Number(it.amount),
                paid_at: paidAt,
            });
            if (dup) {
                const ok = window.confirm(
                    `${RECEIVABLE_TYPE_LABEL[it.payment_type]} ${formatWon(Number(it.amount))} — ${paidAt}\n` +
                    '같은 조건의 납부 기록이 이미 있습니다. 그래도 추가하시겠습니까?',
                );
                if (!ok) return;
                break; // 한 번만 확인.
            }
        }

        setSaving(true);
        setSaveError(null);
        try {
            // 항목별로 분리 저장.
            for (const it of validItems) {
                await insertPayment({
                    member_id: memberId,
                    payment_type: it.payment_type,
                    amount: Number(it.amount),
                    paid_at: paidAt,
                    memo: memo.trim() || null,
                }, user?.id);
            }
            router.push('/finance');
        } catch (e: any) {
            setSaveError(e?.message || '저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="납부 기록 등록"
                    subtitle="회원이 입금한 내용을 직접 기록합니다."
                    backHref="/finance"
                />

                {/* 1. 회원 / 날짜 / 메모 */}
                <section style={FINANCE_CARD_STYLE}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <Field label="회원">
                            <select
                                value={memberId}
                                onChange={(e) => setMemberId(e.target.value)}
                                style={inputStyle}
                            >
                                <option value="">회원 선택</option>
                                {members.map((m) => (
                                    <option key={m.id} value={m.id}>{m.nickname || '회원 정보 없음'}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="납부일">
                            <input
                                type="date"
                                value={paidAt}
                                onChange={(e) => setPaidAt(e.target.value)}
                                style={inputStyle}
                            />
                        </Field>
                        <Field label="메모 (선택)">
                            <input
                                type="text"
                                value={memo}
                                onChange={(e) => setMemo(e.target.value)}
                                placeholder="관리자 메모"
                                style={inputStyle}
                            />
                        </Field>
                    </div>
                </section>

                {/* 2. 항목별 입력 */}
                <section style={FINANCE_CARD_STYLE}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#0F172A' }}>납부 항목</h3>
                        <button type="button" onClick={addItem} style={addButton}>
                            <Plus size={12} /> 항목 추가
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {items.map((it, idx) => (
                            <ItemRow
                                key={it.id}
                                item={it}
                                index={idx}
                                onChangeType={(t) => handleItemTypeChange(it.id, t)}
                                onChangeMonth={(y, m) => handleItemMonthChange(it.id, y, m)}
                                onChangeAmount={(v) => updateItem(it.id, { amount: v })}
                                onRemove={() => removeItem(it.id)}
                                removable={items.length > 1}
                            />
                        ))}
                    </div>
                </section>

                {/* 3. 요약 */}
                {memberId && validItems.length > 0 && (
                    <section style={{ ...FINANCE_CARD_STYLE, backgroundColor: '#F8FAFC' }}>
                        <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                            {memberName ?? '회원'}
                        </h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {validItems.map((it) => (
                                <li
                                    key={it.id}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        fontSize: 12, fontWeight: 700, color: '#475569',
                                    }}
                                >
                                    <span>
                                        {it.payment_type === 'monthly_fee' && it.target_year && it.target_month
                                            ? `${it.target_year}년 ${it.target_month}월 회비`
                                            : RECEIVABLE_TYPE_LABEL[it.payment_type]}
                                    </span>
                                    <strong style={{ color: '#0F172A', whiteSpace: 'nowrap' }}>
                                        {formatWon(Number(it.amount))}
                                    </strong>
                                </li>
                            ))}
                        </ul>
                        <div style={{
                            marginTop: 10, paddingTop: 10,
                            borderTop: '1px solid rgba(15,23,42,0.08)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                        }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>총 납부 금액</span>
                            <strong style={{ fontSize: 15, fontWeight: 900, color: '#0E7C76' }}>
                                {formatWon(totalAmount)}
                            </strong>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', textAlign: 'right' }}>
                            납부일 {paidAt}
                        </p>
                    </section>
                )}

                {saveError && (
                    <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#B91C1C' }}>
                        {saveError}
                    </p>
                )}

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !memberId || validItems.length === 0}
                    style={{
                        height: 44, borderRadius: 12,
                        backgroundColor: saving || !memberId || validItems.length === 0 ? '#CBD5E1' : '#0F9F98',
                        color: '#FFFFFF', border: 'none',
                        fontSize: 13, fontWeight: 900,
                        cursor: saving ? 'wait' : (!memberId || validItems.length === 0 ? 'not-allowed' : 'pointer'),
                    }}
                >
                    {saving ? '저장 중...' : '납부 기록 저장'}
                </button>
            </div>
        </main>
    );
}

function ItemRow({
    item, index, onChangeType, onChangeMonth, onChangeAmount, onRemove, removable,
}: {
    item: ItemDraft;
    index: number;
    onChangeType: (t: FinanceReceivableType) => void;
    onChangeMonth: (y: number, m: number) => void;
    onChangeAmount: (v: string) => void;
    onRemove: () => void;
    removable: boolean;
}) {
    const isMonthly = item.payment_type === 'monthly_fee';
    return (
        <div
            style={{
                paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12,
                borderRadius: 10,
                backgroundColor: '#F8FAFC',
                border: '1px solid rgba(15,23,42,0.06)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#64748B' }}>항목 {index + 1}</span>
                {removable && (
                    <button
                        type="button"
                        onClick={onRemove}
                        aria-label="항목 삭제"
                        style={{
                            marginLeft: 'auto',
                            width: 24, height: 24, borderRadius: 6,
                            border: '1px solid rgba(15,23,42,0.08)',
                            backgroundColor: '#FFFFFF', color: '#94A3B8',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <X size={12} />
                    </button>
                )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Field label="유형">
                    <select
                        value={item.payment_type}
                        onChange={(e) => onChangeType(e.target.value as FinanceReceivableType)}
                        style={inputStyle}
                    >
                        {(Object.keys(RECEIVABLE_TYPE_LABEL) as FinanceReceivableType[]).map((k) => (
                            <option key={k} value={k}>{RECEIVABLE_TYPE_LABEL[k]}</option>
                        ))}
                    </select>
                </Field>
                {isMonthly && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Field label="대상 연도">
                            <select
                                value={item.target_year ?? ''}
                                onChange={(e) => onChangeMonth(Number(e.target.value), item.target_month ?? 1)}
                                style={inputStyle}
                            >
                                {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
                            </select>
                        </Field>
                        <Field label="대상 월">
                            <select
                                value={item.target_month ?? ''}
                                onChange={(e) => onChangeMonth(item.target_year ?? new Date().getFullYear(), Number(e.target.value))}
                                style={inputStyle}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
                            </select>
                        </Field>
                    </div>
                )}
                <Field label="금액 (원)">
                    <input
                        type="number"
                        inputMode="numeric"
                        value={item.amount}
                        onChange={(e) => onChangeAmount(e.target.value)}
                        placeholder="0"
                        style={inputStyle}
                    />
                </Field>
            </div>
        </div>
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

const addButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    height: 28, paddingLeft: 10, paddingRight: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15,159,152,0.10)',
    color: '#0E7C76',
    border: '1px solid rgba(15,159,152,0.24)',
    fontSize: 11, fontWeight: 800,
    cursor: 'pointer',
};
