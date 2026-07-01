'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    fetchFeeRulesForYear,
    upsertFeeRule,
    bulkUpsertFeeRules,
} from '@/lib/finance/feeRulesService';
import {
    previewFeeRuleApplication,
    applyFeeRuleToMonthlyReceivables,
    type FeeApplyPreview,
} from '@/lib/finance/duesService';
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

    // URL query (?year=&month=) 우선. month 는 settings 가 12 개월 grid 라 사용하지 않지만,
    // 다른 화면과 일관성을 위해 query 자체는 유지·전달 (회비 기준 저장 후 /finance/payments 로 갈 때).
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const today = new Date();
    const initYear = parseYearParam(searchParams?.get('year'), today.getFullYear());
    const [year, setYear] = React.useState(initYear);

    const updateYear = React.useCallback((y: number) => {
        setYear(y);
        const sp = new URLSearchParams(searchParams?.toString() || '');
        sp.set('year', String(y));
        router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }, [router, pathname, searchParams]);
    const [rules, setRules] = React.useState<FinanceFeeRule[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [savingMonth, setSavingMonth] = React.useState<number | null>(null);
    /** 직전 저장 성공한 월 — UI 에 "저장됨" 작은 피드백 표시 (2초 후 해제). */
    const [savedFlashMonth, setSavedFlashMonth] = React.useState<number | null>(null);

    // 일괄 적용 form state.
    const [bulkFrom, setBulkFrom] = React.useState(1);
    const [bulkTo, setBulkTo] = React.useState(5);
    const [bulkAmount, setBulkAmount] = React.useState<string>('10000');
    const [bulkDueDate, setBulkDueDate] = React.useState<string>('');
    const [bulkBusy, setBulkBusy] = React.useState(false);

    // "기존 청구에도 적용" 확인 대화 상태. 회비 기준 저장만으로 기존 청구를 조용히 바꾸지 않는다.
    const [pendingApply, setPendingApply] = React.useState<
        { months: number[]; amount: number; preview: FeeApplyPreview } | null
    >(null);
    const [applyBusy, setApplyBusy] = React.useState(false);

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
            // 사용자 피드백 — 같은 값을 저장해도 보이는 신호가 있어야 한다 (이전 회귀 보완).
            setSavedFlashMonth(month);
            window.setTimeout(() => {
                setSavedFlashMonth((m) => (m === month ? null : m));
            }, 1800);
            // 기준 저장만으로 기존 청구를 자동 변경하지 않는다 — 기존 monthly_fee 청구가 있으면 확인.
            const preview = await previewFeeRuleApplication(year, month, amount);
            if (preview.changedCount > 0) {
                setPendingApply({ months: [month], amount, preview });
            }
        } catch (e: any) {
            alert(e?.message || '저장에 실패했습니다.');
        } finally {
            setSavingMonth(null);
        }
    };

    // "기존 청구에도 적용" — pendingApply 의 각 월에 amount_due 변경(원자적). payment 불변.
    const handleApplyToExisting = async () => {
        if (!pendingApply) return;
        setApplyBusy(true);
        try {
            let total = 0;
            for (const m of pendingApply.months) {
                total += await applyFeeRuleToMonthlyReceivables(year, m, pendingApply.amount);
            }
            setPendingApply(null);
            await load();
            alert(`기존 청구 ${total}건의 금액을 변경했습니다.`);
        } catch (e: any) {
            alert(e?.message || '기존 청구 적용에 실패했습니다.');
        } finally {
            setApplyBusy(false);
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
            // 범위 내 기존 monthly_fee 청구가 있으면 한 번에 확인 — 월별 preview 합산.
            const from = Math.min(bulkFrom, bulkTo);
            const to = Math.max(bulkFrom, bulkTo);
            const months: number[] = [];
            const agg: FeeApplyPreview = {
                targetCount: 0, changedCount: 0, oldTotalDue: 0, newTotalDue: 0,
                currentPaid: 0, newRemaining: 0, newPaidCount: 0, newPartialCount: 0, newPendingCount: 0,
            };
            for (let m = from; m <= to; m++) {
                const p = await previewFeeRuleApplication(year, m, amt);
                if (p.changedCount > 0) months.push(m);
                agg.targetCount += p.targetCount;
                agg.changedCount += p.changedCount;
                agg.oldTotalDue += p.oldTotalDue;
                agg.newTotalDue += p.newTotalDue;
                agg.currentPaid += p.currentPaid;
                agg.newRemaining += p.newRemaining;
                agg.newPaidCount += p.newPaidCount;
                agg.newPartialCount += p.newPartialCount;
                agg.newPendingCount += p.newPendingCount;
            }
            if (months.length > 0) setPendingApply({ months, amount: amt, preview: agg });
        } catch (e: any) {
            alert(e?.message || '일괄 적용에 실패했습니다.');
        } finally {
            setBulkBusy(false);
        }
    };

    // 저장된 12개월 기준을 연속 동일 금액 구간으로 묶어 칩으로 표시(저장 후 자동 재계산).
    const feeBands = React.useMemo(() => computeFeeBands(ruleByMonth), [ruleByMonth]);

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
                        onChange={(e) => updateYear(Number(e.target.value))}
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

                {/* 현재 저장된 회비 구간 — 12개월 기준을 연속 동일 금액으로 묶어 표시. 저장 시 자동 갱신. */}
                {!loading && feeBands.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#94A3B8' }}>현재 구간</span>
                        {feeBands.map((b) => (
                            <span key={`${b.fromMonth}-${b.toMonth}`} style={{
                                height: 26, display: 'inline-flex', alignItems: 'center',
                                paddingLeft: 10, paddingRight: 10, borderRadius: 999,
                                backgroundColor: '#F1F5F9', border: '1px solid rgba(15,23,42,0.08)',
                                fontSize: 10.5, fontWeight: 800, color: '#0F172A', whiteSpace: 'nowrap',
                            }}>
                                {b.fromMonth === b.toMonth ? `${b.fromMonth}월` : `${b.fromMonth}~${b.toMonth}월`} {formatWon(b.amount)}
                            </span>
                        ))}
                    </div>
                )}

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
                                        justSaved={savedFlashMonth === m}
                                        onSave={handleSaveMonth}
                                    />
                                );
                            })}
                        </ul>
                    )}
                </section>
            </div>

            {pendingApply && (
                <ApplyConfirmDialog
                    year={year}
                    months={pendingApply.months}
                    amount={pendingApply.amount}
                    preview={pendingApply.preview}
                    busy={applyBusy}
                    onSaveRuleOnly={() => setPendingApply(null)}
                    onApply={handleApplyToExisting}
                />
            )}
        </main>
    );
}

function ApplyConfirmDialog({
    year, months, amount, preview, busy, onSaveRuleOnly, onApply,
}: {
    year: number; months: number[]; amount: number; preview: FeeApplyPreview;
    busy: boolean; onSaveRuleOnly: () => void; onApply: () => void;
}) {
    const monthLabel = months.length === 1 ? `${months[0]}월` : `${months.join(', ')}월`;
    return (
        <div
            role="dialog" aria-modal="true"
            style={{
                position: 'fixed', inset: 0, zIndex: 1200,
                background: 'rgba(15,23,42,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
        >
            <div style={{
                width: '100%', maxWidth: 380, background: '#FFFFFF', borderRadius: 16,
                border: '1px solid rgba(15,23,42,0.08)', boxShadow: '0 24px 60px rgba(15,23,42,0.22)',
                padding: 18, boxSizing: 'border-box',
            }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: '#0F172A', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                    {year}년 {monthLabel}에 이미 생성된 월회비 청구 {preview.changedCount}건이 있습니다.
                </p>
                <p style={{ margin: '6px 0 12px', fontSize: 12.5, fontWeight: 700, color: '#475569', wordBreak: 'keep-all' }}>
                    기존 청구를 {formatWon(amount)}으로 변경하시겠습니까?
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 12, borderRadius: 10, background: '#F8FAFC', border: '1px solid rgba(15,23,42,0.06)' }}>
                    <PreviewRow label="대상 회원" value={`${preview.targetCount}명`} />
                    <PreviewRow label="기존 총 청구" value={formatWon(preview.oldTotalDue)} />
                    <PreviewRow label="변경 총 청구" value={formatWon(preview.newTotalDue)} strong />
                    <PreviewRow label="현재 납부액" value={formatWon(preview.currentPaid)} />
                    <PreviewRow label="변경 후 남은 금액" value={formatWon(preview.newRemaining)} strong />
                    <PreviewRow label="변경 후 일부 납부" value={`${preview.newPartialCount}명`} />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button type="button" onClick={onSaveRuleOnly} disabled={busy} style={{
                        flex: 1, height: 42, borderRadius: 10, border: '1px solid rgba(15,23,42,0.12)',
                        background: '#FFFFFF', color: '#334155', fontSize: 12.5, fontWeight: 800,
                        cursor: busy ? 'not-allowed' : 'pointer',
                    }}>
                        기준만 저장
                    </button>
                    <button type="button" onClick={onApply} disabled={busy} style={{
                        flex: 1, height: 42, borderRadius: 10, border: 'none',
                        background: busy ? '#CBD5E1' : '#0F9F98', color: '#FFFFFF', fontSize: 12.5, fontWeight: 900,
                        cursor: busy ? 'wait' : 'pointer',
                    }}>
                        {busy ? '적용 중...' : '기존 청구에도 적용'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function PreviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>{label}</span>
            <span style={{ fontSize: 12.5, fontWeight: strong ? 900 : 800, color: strong ? '#0F172A' : '#334155', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
    );
}

/** 12개월 rule map → 연속 동일 금액 구간. rule 이 없는 달은 구간을 끊는다. */
function computeFeeBands(ruleByMonth: Record<number, FinanceFeeRule | undefined>): { fromMonth: number; toMonth: number; amount: number }[] {
    const bands: { fromMonth: number; toMonth: number; amount: number }[] = [];
    for (let m = 1; m <= 12; m++) {
        const r = ruleByMonth[m];
        if (!r) continue;
        const amount = r.default_amount;
        const last = bands[bands.length - 1];
        if (last && last.toMonth === m - 1 && last.amount === amount) {
            last.toMonth = m;
        } else {
            bands.push({ fromMonth: m, toMonth: m, amount });
        }
    }
    return bands;
}

function MonthRuleRow({
    year, month, rule, saving, justSaved, onSave,
}: {
    year: number;
    month: number;
    rule: FinanceFeeRule | undefined;
    saving: boolean;
    justSaved: boolean;
    onSave: (month: number, amount: number, dueDate: string | null) => void;
}) {
    void year;
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
                onClick={() => {
                    // 빈 문자열 → 0 으로 떨어지는 fallback 은 그대로 두되, parse 실패만 막는다.
                    const parsed = Number(amountStr);
                    const amount = Number.isFinite(parsed) ? parsed : 0;
                    onSave(month, amount, dueDate || null);
                }}
                disabled={saving}
                style={{
                    height: 32, paddingLeft: 12, paddingRight: 12,
                    borderRadius: 8,
                    backgroundColor: saving ? '#CBD5E1' : justSaved ? '#10B981' : '#0F9F98',
                    color: '#FFFFFF', border: 'none',
                    fontSize: 11.5, fontWeight: 800,
                    cursor: saving ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'background-color 0.18s',
                }}
                aria-label={`${month}월 회비 저장`}
            >
                {saving ? '저장 중' : justSaved ? '저장됨' : rule ? '저장' : '등록'}
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

// URL query parser — Finance 전 페이지 동일 규칙.
function parseYearParam(raw: string | null | undefined, fallback: number): number {
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 2020 || n > 2099) return fallback;
    return n;
}
