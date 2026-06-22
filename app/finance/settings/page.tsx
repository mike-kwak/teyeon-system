'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    fetchFeeRulesForYear,
    upsertFeeRule,
    bulkUpsertFeeRules,
} from '@/lib/finance/feeRulesService';
import {
    FinancePageHeader,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import type { FinanceFeeRule } from '@/types/finance';

/**
 * /finance/settings — 월별 회비 기준.
 * 12개월 grid + 월 범위 일괄 적용. 코드 하드코딩 금지 — 모든 값은 DB.
 */
export default function FinanceSettingsPage() {
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    const today = new Date();
    const [year, setYear] = React.useState(today.getFullYear());
    const [rules, setRules] = React.useState<FinanceFeeRule[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [savingMonth, setSavingMonth] = React.useState<number | null>(null);

    // 일괄 적용 form state.
    const [bulkFrom, setBulkFrom] = React.useState(1);
    const [bulkTo, setBulkTo] = React.useState(5);
    const [bulkAmount, setBulkAmount] = React.useState<string>('10000');
    const [bulkDueDate, setBulkDueDate] = React.useState<string>('');
    const [bulkBusy, setBulkBusy] = React.useState(false);

    const load = React.useCallback(async () => {
        setLoading(true);
        const data = await fetchFeeRulesForYear(year);
        setRules(data);
        setLoading(false);
    }, [year]);

    React.useEffect(() => { load(); }, [load]);

    const ruleByMonth = React.useMemo(() => {
        const map: Record<number, FinanceFeeRule | undefined> = {};
        for (const r of rules) map[r.month] = r;
        return map;
    }, [rules]);

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

    const handleSaveMonth = async (month: number, amount: number, dueDate: string | null) => {
        setSavingMonth(month);
        try {
            await upsertFeeRule(
                { year, month, default_amount: amount, due_date: dueDate, title: `${year}년 ${month}월 회비` },
                user?.id,
            );
            await load();
        } catch (e: any) {
            alert(e?.message || '저장에 실패했습니다.');
        } finally {
            setSavingMonth(null);
        }
    };

    const handleBulkApply = async () => {
        const amt = Number(bulkAmount);
        if (!(amt >= 0) || Number.isNaN(amt)) {
            alert('금액을 다시 입력해 주세요.');
            return;
        }
        setBulkBusy(true);
        try {
            await bulkUpsertFeeRules({
                year,
                fromMonth: bulkFrom,
                toMonth: bulkTo,
                amount: amt,
                dueDate: bulkDueDate || null,
                userId: user?.id,
            });
            await load();
        } catch (e: any) {
            alert(e?.message || '일괄 적용에 실패했습니다.');
        } finally {
            setBulkBusy(false);
        }
    };

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="회비 기준 설정"
                    subtitle="월별 회비 금액과 납부 기한을 관리합니다."
                    backHref="/finance"
                />

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        style={{
                            height: 32, paddingLeft: 10, paddingRight: 10,
                            borderRadius: 10, border: '1px solid rgba(15,23,42,0.10)',
                            fontSize: 12, fontWeight: 800, color: '#0F172A',
                            backgroundColor: '#FFFFFF', outline: 'none',
                        }}
                    >
                        {[2024, 2025, 2026, 2027, 2028, 2029].map((y) => <option key={y} value={y}>{y}년</option>)}
                    </select>
                </div>

                {/* 일괄 적용 */}
                <section style={FINANCE_CARD_STYLE}>
                    <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                        월 범위 일괄 적용
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <Field label="시작 월">
                                <select value={bulkFrom} onChange={(e) => setBulkFrom(Number(e.target.value))} style={inputStyle}>
                                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
                                </select>
                            </Field>
                            <Field label="종료 월">
                                <select value={bulkTo} onChange={(e) => setBulkTo(Number(e.target.value))} style={inputStyle}>
                                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
                                </select>
                            </Field>
                        </div>
                        <Field label="금액 (원)">
                            <input
                                type="number"
                                inputMode="numeric"
                                value={bulkAmount}
                                onChange={(e) => setBulkAmount(e.target.value)}
                                placeholder="10000"
                                style={inputStyle}
                            />
                        </Field>
                        <Field label="납부 기한 (선택)">
                            <input
                                type="date"
                                value={bulkDueDate}
                                onChange={(e) => setBulkDueDate(e.target.value)}
                                style={inputStyle}
                            />
                        </Field>
                        <button
                            type="button"
                            onClick={handleBulkApply}
                            disabled={bulkBusy}
                            style={primaryButton(bulkBusy)}
                        >
                            {bulkBusy ? '저장 중...' : `${bulkFrom}월~${bulkTo}월 일괄 적용`}
                        </button>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                            <Preset onClick={() => { setBulkFrom(1); setBulkTo(5); setBulkAmount('10000'); }}>1~5월 10,000원</Preset>
                            <Preset onClick={() => { setBulkFrom(6); setBulkTo(10); setBulkAmount('20000'); }}>6~10월 20,000원</Preset>
                            <Preset onClick={() => { setBulkFrom(11); setBulkTo(12); setBulkAmount('10000'); }}>11~12월 10,000원</Preset>
                        </div>
                    </div>
                </section>

                {/* 월별 grid */}
                <section style={FINANCE_CARD_STYLE}>
                    <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                        {year}년 월별
                    </h3>
                    {loading ? (
                        <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: '#94A3B8' }}>
                            불러오는 중...
                        </p>
                    ) : (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                                const r = ruleByMonth[m];
                                return (
                                    <MonthRuleRow
                                        key={m}
                                        year={year}
                                        month={m}
                                        rule={r}
                                        saving={savingMonth === m}
                                        onSave={handleSaveMonth}
                                    />
                                );
                            })}
                        </ul>
                    )}
                </section>
            </div>
        </main>
    );
}

function MonthRuleRow({
    year, month, rule, saving, onSave,
}: {
    year: number;
    month: number;
    rule: FinanceFeeRule | undefined;
    saving: boolean;
    onSave: (month: number, amount: number, dueDate: string | null) => void;
}) {
    const [amountStr, setAmountStr] = React.useState<string>(rule?.default_amount != null ? String(rule.default_amount) : '');
    const [dueDate, setDueDate]     = React.useState<string>(rule?.due_date ?? '');
    React.useEffect(() => {
        setAmountStr(rule?.default_amount != null ? String(rule.default_amount) : '');
        setDueDate(rule?.due_date ?? '');
    }, [rule?.default_amount, rule?.due_date]);

    return (
        <li
            style={{
                display: 'flex', alignItems: 'center', gap: 8,
                paddingTop: 8, paddingBottom: 8,
                borderTop: '1px dashed rgba(15,23,42,0.05)',
                flexWrap: 'wrap',
            }}
        >
            <span style={{
                minWidth: 36, fontSize: 12, fontWeight: 900, color: '#0F172A',
                letterSpacing: '-0.01em',
            }}>
                {month}월
            </span>
            <input
                type="number"
                inputMode="numeric"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0"
                style={{ ...inputStyle, flex: '1 1 100px', minWidth: 0 }}
            />
            <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={{ ...inputStyle, flex: '1 1 130px', minWidth: 0 }}
            />
            <button
                type="button"
                onClick={() => onSave(month, Number(amountStr) || 0, dueDate || null)}
                disabled={saving}
                style={{
                    height: 32, paddingLeft: 12, paddingRight: 12,
                    borderRadius: 8,
                    backgroundColor: saving ? '#CBD5E1' : '#0F9F98',
                    color: '#FFFFFF', border: 'none',
                    fontSize: 11.5, fontWeight: 800,
                    cursor: saving ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                }}
            >
                {saving ? '저장 중' : rule ? '저장' : '등록'}
            </button>
            {rule && (
                <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 700, color: '#94A3B8', whiteSpace: 'nowrap' }}>
                    현재 {formatWon(rule.default_amount)}
                </span>
            )}
        </li>
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

function Preset({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                height: 26, paddingLeft: 10, paddingRight: 10,
                borderRadius: 999,
                backgroundColor: '#F1F5F9', color: '#0F172A',
                border: '1px solid rgba(15,23,42,0.08)',
                fontSize: 10.5, fontWeight: 800, letterSpacing: '-0.01em',
                cursor: 'pointer', whiteSpace: 'nowrap',
            }}
        >
            {children}
        </button>
    );
}

const inputStyle: React.CSSProperties = {
    height: 32,
    paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12, fontWeight: 700, color: '#0F172A',
    backgroundColor: '#FFFFFF',
    boxSizing: 'border-box',
    outline: 'none',
    width: '100%',
};

function primaryButton(busy: boolean): React.CSSProperties {
    return {
        height: 38, paddingLeft: 14, paddingRight: 14,
        borderRadius: 10,
        backgroundColor: busy ? '#CBD5E1' : '#0F9F98',
        color: '#FFFFFF', border: 'none',
        fontSize: 12.5, fontWeight: 800,
        cursor: busy ? 'wait' : 'pointer',
        WebkitTapHighlightColor: 'transparent',
    };
}
