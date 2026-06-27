'use client';

import React from 'react';
import { X, RotateCcw, AlertTriangle } from 'lucide-react';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    computeMonthlyResetPreview,
    resetMonthlyPayments,
} from '@/lib/finance/duesService';
import type { FinanceDuesPayment, FinanceDuesReceivable } from '@/types/finance';

/**
 * 월 납부 초기화 모달 — 선택 (year, month) 월회비 청구에 연결된 유효 monthly_fee payment 만
 *   soft-cancel 해 그 달을 미납으로 되돌린다. 청구/금액/다른 월·타입 payment 는 보존.
 *   실행 전 미리보기 + 운영자 직접 입력("{year}년 {month}월 초기화") 확인을 요구한다.
 */
export default function MonthlyResetModal({
    year,
    month,
    receivables,
    payments,
    onClose,
    onDone,
}: {
    year: number;
    month: number;
    receivables: FinanceDuesReceivable[];
    payments: FinanceDuesPayment[];
    onClose: () => void;
    onDone: () => void;
}) {
    const preview = React.useMemo(
        () => computeMonthlyResetPreview(year, month, receivables, payments),
        [year, month, receivables, payments],
    );
    const confirmPhrase = `${year}년 ${month}월 초기화`;
    const [typed, setTyped] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const canRun = typed.trim() === confirmPhrase && preview.resetCount > 0 && !busy;

    const handleRun = async () => {
        if (!canRun) return;
        setBusy(true);
        setError(null);
        try {
            await resetMonthlyPayments(year, month);
            onDone();
            onClose();
        } catch (e: any) {
            setError(e?.message || '월 납부 초기화에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(5px)',
                padding: 14,
                paddingTop: 'calc(14px + env(safe-area-inset-top))',
                paddingBottom: 'calc(14px + env(safe-area-inset-bottom))',
                boxSizing: 'border-box',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    display: 'flex', flexDirection: 'column',
                    width: '100%', maxWidth: 420,
                    maxHeight: 'calc(100dvh - 28px)', overflow: 'hidden',
                    backgroundColor: '#FFFFFF', borderRadius: 18,
                    border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 24px 60px rgba(15,23,42,0.22)',
                    boxSizing: 'border-box',
                }}
            >
                {/* Header */}
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '15px 16px', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#B91C1C' }}>
                            TEYEON · FINANCE
                        </p>
                        <h2 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 900, color: '#0F172A' }}>
                            {year}년 {month}월 납부 초기화
                        </h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="닫기" style={iconBtn}>
                        <X size={17} strokeWidth={2.2} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* 안내 */}
                    <div style={{ display: 'flex', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#FFF7ED', border: '1px solid rgba(234,88,12,0.22)' }}>
                        <AlertTriangle size={16} style={{ color: '#C2410C', flexShrink: 0, marginTop: 1 }} />
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#9A3412', lineHeight: 1.6 }}>
                            {year}년 {month}월 월회비 납부 기록을 초기화합니다. 청구는 유지되고 납부 기록만 취소됩니다.
                        </p>
                    </div>

                    {/* 미리보기 */}
                    <div style={{ backgroundColor: '#F8FAFC', borderRadius: 12, border: '1px solid rgba(15,23,42,0.06)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Row label="대상 연·월" value={`${year}년 ${month}월`} />
                        <Row label="월회비 청구 인원" value={`${preview.receivableCount}명`} />
                        <Row label="초기화 대상 납부" value={`${preview.resetCount}건`} strong />
                        <Row label="초기화 대상 총액" value={formatWon(preview.resetTotal)} strong />
                        <Row label="이미 취소된 납부" value={`${preview.alreadyVoidedCount}건`} muted />
                        <div style={{ borderTop: '1px dashed rgba(15,23,42,0.10)', marginTop: 2, paddingTop: 6 }}>
                            <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 800, color: '#64748B' }}>초기화 후 예상</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, fontWeight: 800 }}>
                                <span style={{ color: '#0E7C76' }}>완료 {preview.afterPaid}</span>
                                <span style={{ color: '#92400E' }}>일부 {preview.afterPartial}</span>
                                <span style={{ color: '#B91C1C' }}>미납 {preview.afterPending}</span>
                            </div>
                        </div>
                    </div>

                    {preview.resetCount === 0 ? (
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#64748B', textAlign: 'center' }}>
                            초기화할 유효 월회비 납부 기록이 없습니다.
                        </p>
                    ) : (
                        <label style={{ display: 'block' }}>
                            <span style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 6 }}>
                                실행하려면 <b style={{ color: '#B91C1C' }}>{confirmPhrase}</b> 를 입력하세요.
                            </span>
                            <input
                                type="text"
                                value={typed}
                                onChange={(e) => setTyped(e.target.value)}
                                placeholder={confirmPhrase}
                                style={inputStyle}
                            />
                        </label>
                    )}

                    {error && (
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#B91C1C' }}>{error}</p>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={onClose} disabled={busy} style={secondaryBtn}>닫기</button>
                        <button
                            type="button"
                            onClick={handleRun}
                            disabled={!canRun}
                            style={{
                                flex: 1, height: 44, borderRadius: 12, border: 'none',
                                backgroundColor: canRun ? '#DC2626' : '#E5C2C2',
                                color: '#FFFFFF', fontSize: 13, fontWeight: 900,
                                cursor: canRun ? 'pointer' : 'not-allowed',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}
                        >
                            <RotateCcw size={15} />
                            {busy ? '초기화 중...' : `${year}년 ${month}월 초기화`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>{label}</span>
            <strong style={{ fontSize: strong ? 13 : 12, fontWeight: strong ? 900 : 800, color: muted ? '#94A3B8' : '#0F172A', whiteSpace: 'nowrap' }}>
                {value}
            </strong>
        </div>
    );
}

const iconBtn: React.CSSProperties = {
    flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
    border: '1px solid rgba(15,23,42,0.10)', backgroundColor: '#FFFFFF', color: '#475569',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
    width: '100%', height: 40, boxSizing: 'border-box',
    borderRadius: 10, border: '1px solid rgba(15,23,42,0.12)',
    padding: '0 12px', fontSize: 13, fontWeight: 700, color: '#0F172A',
    outline: 'none', backgroundColor: '#FFFFFF',
};

const secondaryBtn: React.CSSProperties = {
    height: 44, paddingLeft: 16, paddingRight: 16, borderRadius: 12,
    border: '1px solid rgba(15,23,42,0.12)', backgroundColor: '#FFFFFF', color: '#334155',
    fontSize: 13, fontWeight: 800, cursor: 'pointer',
};
