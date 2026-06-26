'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon, isValidPaymentAmount } from '@/lib/finance/formatFinanceAmount';
import {
    fetchAllMembers,
    insertPayment,
    findDuplicatePayment,
    findMonthlyReceivable,
    fetchAnnualFeePreview,
    payAnnualFeeRemainder,
    type AnnualFeePreview,
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

const newItem = (year: number, month: number): ItemDraft => ({
    id: Math.random().toString(36).slice(2),
    payment_type: 'monthly_fee',
    target_year: year,
    target_month: month,
    amount: '',
});

export default function FinanceRecordPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    // URL query (?year=&month=) 우선. 없거나 잘못되면 현재 연·월.
    // → 항목 기본 대상 월 + 저장/취소 후 돌아가는 Finance 링크에 같은 연·월 유지.
    const today = new Date();
    const initYear = parseYearParam(searchParams?.get('year'), today.getFullYear());
    const initMonth = parseMonthParam(searchParams?.get('month'), today.getMonth() + 1);
    const financeHref = `/finance?year=${initYear}&month=${initMonth}`;

    const [members, setMembers] = React.useState<FinanceMember[]>([]);
    const [memberId, setMemberId] = React.useState<string>('');
    const [paidAt, setPaidAt] = React.useState<string>(() => new Date().toISOString().slice(0, 10));
    const [memo, setMemo] = React.useState<string>('');
    const [items, setItems] = React.useState<ItemDraft[]>(() => [newItem(initYear, initMonth)]);
    const [saving, setSaving] = React.useState(false);
    const [saveError, setSaveError] = React.useState<string | null>(null);

    // 연회비(annual_fee) 항목별 월회비 잔액 미리보기 (회원 + 대상 연도 기준).
    const [annualPreviews, setAnnualPreviews] = React.useState<Record<string, AnnualFeePreview | null>>({});
    const [annualLoading, setAnnualLoading] = React.useState<Record<string, boolean>>({});

    React.useEffect(() => {
        if (!isAdmin) return;
        (async () => {
            const list = await fetchAllMembers();
            setMembers(list);
        })();
    }, [isAdmin]);

    // 연회비 항목이 있으면 (회원, 연도)별 월회비 잔액을 조회. annualKey 가 바뀔 때만 재조회.
    const annualKey = items
        .filter((it) => it.payment_type === 'annual_fee')
        .map((it) => `${it.id}:${it.target_year ?? ''}`)
        .join(',');
    React.useEffect(() => {
        if (!memberId) { setAnnualPreviews({}); return; }
        const annualItems = items.filter((it) => it.payment_type === 'annual_fee' && it.target_year);
        if (annualItems.length === 0) { setAnnualPreviews({}); return; }
        let cancelled = false;
        (async () => {
            for (const it of annualItems) {
                setAnnualLoading((p) => ({ ...p, [it.id]: true }));
                try {
                    const preview = await fetchAnnualFeePreview(memberId, it.target_year as number);
                    if (!cancelled) setAnnualPreviews((p) => ({ ...p, [it.id]: preview }));
                } catch {
                    if (!cancelled) setAnnualPreviews((p) => ({ ...p, [it.id]: null }));
                } finally {
                    if (!cancelled) setAnnualLoading((p) => ({ ...p, [it.id]: false }));
                }
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memberId, annualKey]);

    if (!isLoading && !isAdmin) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>운영자만 접근할 수 있는 페이지입니다.</p>
                    <Link href={financeHref} style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#0E7C76' }}>
                        ← Finance
                    </Link>
                </div>
            </main>
        );
    }

    const memberName = members.find((m) => m.id === memberId)?.nickname ?? null;

    // 저장 대상 분리: 금액 입력 항목(월회비/벌금/게스트비/행사비/기타)과 연회비(잔액 일괄).
    const isAnnual = (it: ItemDraft) => it.payment_type === 'annual_fee';
    const amountItems = items.filter((it) => !isAnnual(it) && isValidPaymentAmount(Number(it.amount)));
    const annualItems = items.filter((it) => isAnnual(it) && (annualPreviews[it.id]?.payableCount ?? 0) > 0);
    const hasSavable = amountItems.length > 0 || annualItems.length > 0;
    const amountTotal = amountItems.reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
    const annualTotal = annualItems.reduce((acc, it) => acc + (annualPreviews[it.id]?.totalRemaining ?? 0), 0);
    const grandTotal = amountTotal + annualTotal;
    // 연회비만 단독으로 저장하는 흔한 경우엔 버튼 문구를 연회비 일괄 납부로.
    const annualOnly = annualItems.length === 1 && amountItems.length === 0;

    const updateItem = (id: string, patch: Partial<ItemDraft>) => {
        setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it));
    };
    const addItem = () => setItems((prev) => [...prev, newItem(initYear, initMonth)]);
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
        if (!hasSavable) { alert('납부할 항목을 1건 이상 입력해 주세요.'); return; }
        setSaveError(null);

        // 월회비 항목은 반드시 해당 (회원·연·월) receivable 에 연결해야 집계에 반영된다.
        //   연결할 청구가 없으면 조용히 미반영되는 것을 막기 위해 저장을 중단하고 안내.
        const monthlyRecvMap = new Map<string, string>();
        const missing: string[] = [];
        for (const it of amountItems) {
            if (it.payment_type !== 'monthly_fee' || !it.target_year || !it.target_month) continue;
            try {
                const recv = await findMonthlyReceivable(memberId, it.target_year, it.target_month);
                if (recv) monthlyRecvMap.set(it.id, recv.id);
                else missing.push(`${it.target_year}년 ${it.target_month}월`);
            } catch {
                setSaveError('청구 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
                return;
            }
        }
        if (missing.length > 0) {
            setSaveError(`월회비 청구가 없는 달이 있어 납부를 연결할 수 없습니다: ${missing.join(', ')}. 납부 현황에서 청구를 먼저 생성해 주세요.`);
            return;
        }

        // 중복 경고 — 금액 입력 항목만 (연회비는 RPC 가 잔액만 정확히 처리).
        for (const it of amountItems) {
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
        try {
            // 1) 금액 입력 항목 — 월회비는 receivable_id 연결, 그 외는 기존 방식 유지.
            for (const it of amountItems) {
                await insertPayment({
                    member_id: memberId,
                    receivable_id: it.payment_type === 'monthly_fee' ? (monthlyRecvMap.get(it.id) ?? null) : null,
                    payment_type: it.payment_type,
                    amount: Number(it.amount),
                    paid_at: paidAt,
                    memo: memo.trim() || null,
                }, user?.id);
            }
            // 2) 연회비 항목 — 선택 연도 월회비 잔액을 월별 payment 로 일괄(서버 RPC, 원자적).
            for (const it of annualItems) {
                const yr = it.target_year as number;
                await payAnnualFeeRemainder(memberId, yr, paidAt, memo.trim() || `${yr}년 연회비 일괄 납부`);
            }
            // 저장 성공 — 방금 기록한 "대상 월"의 현황으로 이동(현재 월/URL 월로 튀지 않게).
            //   월회비 항목의 target_year/month 우선, 없으면 기존 컨텍스트(initYear/initMonth).
            const savedMonthly = amountItems.find(
                (it) => it.payment_type === 'monthly_fee' && it.target_year && it.target_month,
            );
            const dest = savedMonthly
                ? `/finance?year=${savedMonthly.target_year}&month=${savedMonthly.target_month}`
                : financeHref;
            router.push(dest);
        } catch (e: any) {
            setSaveError(e?.message || '납부 기록을 저장하지 못했습니다. 다시 시도해 주세요.');
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
                    backHref={financeHref}
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
                                annualPreview={annualPreviews[it.id] ?? null}
                                annualLoading={!!annualLoading[it.id]}
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
                {memberId && hasSavable && (
                    <section style={{ ...FINANCE_CARD_STYLE, backgroundColor: '#F8FAFC' }}>
                        <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 900, color: '#0F172A' }}>
                            {memberName ?? '회원'}
                        </h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {amountItems.map((it) => (
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
                            {annualItems.map((it) => (
                                <li
                                    key={it.id}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        fontSize: 12, fontWeight: 700, color: '#475569',
                                    }}
                                >
                                    <span>{it.target_year}년 연회비 잔액 ({annualPreviews[it.id]?.payableCount ?? 0}개월)</span>
                                    <strong style={{ color: '#0F172A', whiteSpace: 'nowrap' }}>
                                        {formatWon(annualPreviews[it.id]?.totalRemaining ?? 0)}
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
                                {formatWon(grandTotal)}
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
                    disabled={saving || !memberId || !hasSavable}
                    style={{
                        height: 44, borderRadius: 12,
                        backgroundColor: saving || !memberId || !hasSavable ? '#CBD5E1' : '#0F9F98',
                        color: '#FFFFFF', border: 'none',
                        fontSize: 13, fontWeight: 900,
                        cursor: saving ? 'wait' : (!memberId || !hasSavable ? 'not-allowed' : 'pointer'),
                    }}
                >
                    {saving
                        ? '저장 중...'
                        : annualOnly
                            ? `연회비 잔액 ${formatWon(annualTotal)} 일괄 납부`
                            : '납부 기록 저장'}
                </button>
            </div>
        </main>
    );
}

function ItemRow({
    item, index, annualPreview, annualLoading, onChangeType, onChangeMonth, onChangeAmount, onRemove, removable,
}: {
    item: ItemDraft;
    index: number;
    annualPreview: AnnualFeePreview | null;
    annualLoading: boolean;
    onChangeType: (t: FinanceReceivableType) => void;
    onChangeMonth: (y: number, m: number) => void;
    onChangeAmount: (v: string) => void;
    onRemove: () => void;
    removable: boolean;
}) {
    const isMonthly = item.payment_type === 'monthly_fee';
    const isAnnual = item.payment_type === 'annual_fee';
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
                {isAnnual ? (
                    <>
                        <Field label="대상 연도">
                            <select
                                value={item.target_year ?? ''}
                                onChange={(e) => onChangeMonth(Number(e.target.value), item.target_month ?? 1)}
                                style={inputStyle}
                            >
                                {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
                            </select>
                        </Field>
                        <AnnualPreviewView preview={annualPreview} loading={annualLoading} year={item.target_year ?? null} />
                    </>
                ) : (
                    <>
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
                    </>
                )}
            </div>
        </div>
    );
}

function AnnualPreviewView({ preview, loading, year }: { preview: AnnualFeePreview | null; loading: boolean; year: number | null }) {
    if (loading) {
        return <p style={annualNote}>{year ? `${year}년 ` : ''}연회비 잔액 계산 중...</p>;
    }
    if (!preview) {
        return <p style={annualNote}>회원과 대상 연도를 선택하면 월회비 잔액을 계산합니다.</p>;
    }
    return (
        <div style={{ borderRadius: 10, border: '1px solid rgba(15,23,42,0.08)', backgroundColor: '#FFFFFF', padding: 10 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 900, color: '#0F172A' }}>{preview.year}년 연회비 잔액</p>
            {preview.lines.length === 0 ? (
                <p style={{ ...annualNote, marginTop: 0 }}>해당 연도에 생성된 월회비 청구가 없습니다.</p>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {preview.lines.map((l) => (
                        <li key={l.month} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, fontWeight: 700 }}>
                            <span style={{ color: '#475569' }}>{l.month}월</span>
                            <span style={{ color: l.remaining > 0 ? '#B91C1C' : '#0E7C76', whiteSpace: 'nowrap' }}>
                                {l.status === 'paid' ? '납부 완료'
                                    : l.status === 'exempt' ? '면제'
                                    : l.status === 'not_target' ? '비대상'
                                    : `남은 금액 ${formatWon(l.remaining)}`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {preview.missingMonths.length > 0 && (
                <p style={{ ...annualNote, color: '#B7791F' }}>
                    월회비 청구가 생성되지 않은 월이 있어 해당 월은 연회비 계산에서 제외되었습니다. ({preview.missingMonths.join(', ')}월)
                </p>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(15,23,42,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>총 납부 금액 ({preview.payableCount}개월)</span>
                <strong style={{ fontSize: 13, fontWeight: 900, color: preview.totalRemaining > 0 ? '#0E7C76' : '#94A3B8' }}>
                    {formatWon(preview.totalRemaining)}
                </strong>
            </div>
            {preview.totalRemaining === 0 && preview.lines.length > 0 && (
                <p style={{ ...annualNote, color: '#0E7C76' }}>해당 연도의 월회비가 모두 납부되었습니다.</p>
            )}
        </div>
    );
}

const annualNote: React.CSSProperties = {
    margin: '8px 0 0', fontSize: 10.5, fontWeight: 700, color: '#94A3B8', lineHeight: 1.5,
};

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

// URL query parser — /finance 와 동일 규칙. 페이지마다 인라인 복제.
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
