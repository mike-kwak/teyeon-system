'use client';

import React from 'react';
import { X } from 'lucide-react';
import { updatePayment, voidPayment, unvoidPayment } from '@/lib/finance/duesService';
import { formatWon, isValidPaymentAmount } from '@/lib/finance/formatFinanceAmount';
import {
    RECEIVABLE_TYPE_LABEL,
    type FinanceDuesPayment,
    type FinanceReceivableType,
} from '@/types/finance';

/**
 * 납부 기록 편집 + 취소 (soft-cancel) 모달.
 * - 금액 / 날짜 / 유형 / 회원 공개 메모 / 운영진 메모 수정
 * - 취소: is_voided=true 로 soft-cancel (hard delete 아님)
 *   사유 입력 + 확인 모달 후 처리.
 * - 취소된 기록 재활성화도 같은 모달에서 가능.
 */
interface Props {
    payment: FinanceDuesPayment | null;
    onClose: () => void;
    onSaved: () => void;
    userId?: string;
}

export default function PaymentEditModal({ payment, onClose, onSaved, userId }: Props) {
    const [amountStr, setAmountStr] = React.useState('');
    const [paidAt, setPaidAt] = React.useState('');
    const [type, setType] = React.useState<FinanceReceivableType>('monthly_fee');
    const [memo, setMemo] = React.useState('');
    const [adminMemo, setAdminMemo] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!payment) return;
        setAmountStr(String(payment.amount));
        setPaidAt(payment.paid_at);
        setType(payment.payment_type);
        setMemo(payment.memo ?? '');
        setAdminMemo(payment.admin_memo ?? '');
        setError(null);
    }, [payment]);

    if (!payment) return null;
    const isVoided = !!payment.is_voided;

    const handleSave = async () => {
        const amount = Number(amountStr);
        if (!isValidPaymentAmount(amount)) {
            setError('금액을 다시 입력해 주세요 (양의 정수).');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await updatePayment(payment.id, {
                amount,
                paid_at: paidAt,
                payment_type: type,
                memo: memo.trim() || null,
                admin_memo: adminMemo.trim() || null,
            }, userId);
            onSaved();
            onClose();
        } catch (e: any) {
            setError(e?.message || '저장에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const handleVoid = async () => {
        const reason = window.prompt('취소 사유를 입력해 주세요 (선택)') ?? null;
        const ok = window.confirm('이 납부 기록을 취소(무효) 처리하시겠습니까?\n합계 계산에서 제외되지만 기록은 보존됩니다.');
        if (!ok) return;
        setBusy(true);
        try {
            await voidPayment(payment.id, reason, userId);
            onSaved();
            onClose();
        } catch (e: any) {
            setError(e?.message || '취소에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const handleUnvoid = async () => {
        const ok = window.confirm('취소 상태를 해제하고 다시 합계에 포함하시겠습니까?');
        if (!ok) return;
        setBusy(true);
        try {
            await unvoidPayment(payment.id, userId);
            onSaved();
            onClose();
        } catch (e: any) {
            setError(e?.message || '복원에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 9000,
                backgroundColor: 'rgba(15,23,42,0.40)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 430,
                    backgroundColor: '#FFFFFF',
                    borderTopLeftRadius: 18, borderTopRightRadius: 18,
                    paddingTop: 14, paddingBottom: 18, paddingLeft: 16, paddingRight: 16,
                    boxShadow: '0 -8px 28px rgba(15,23,42,0.20)',
                    maxHeight: '92dvh', overflowY: 'auto',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A' }}>
                        납부 기록 {isVoided ? '복원' : '수정'}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="닫기"
                        style={{
                            marginLeft: 'auto',
                            width: 28, height: 28, borderRadius: '50%',
                            border: '1px solid rgba(15,23,42,0.10)',
                            backgroundColor: '#FFFFFF', color: '#475569',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <X size={14} />
                    </button>
                </div>

                {isVoided && (
                    <div style={{
                        marginBottom: 10, padding: 10, borderRadius: 8,
                        backgroundColor: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.22)',
                        fontSize: 11.5, fontWeight: 700, color: '#B91C1C',
                    }}>
                        취소된 기록입니다 — 합계에서 제외 중. 사유: {payment.void_reason || '미입력'}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Field label="유형">
                        <select value={type} onChange={(e) => setType(e.target.value as FinanceReceivableType)} style={inputStyle} disabled={isVoided}>
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
                            style={inputStyle}
                            disabled={isVoided}
                        />
                    </Field>
                    <Field label="납부일">
                        <input
                            type="date"
                            value={paidAt}
                            onChange={(e) => setPaidAt(e.target.value)}
                            style={inputStyle}
                            disabled={isVoided}
                        />
                    </Field>
                    <Field label="회원 공개 메모">
                        <input
                            type="text"
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder="회원 화면에 노출됩니다"
                            style={inputStyle}
                            disabled={isVoided}
                        />
                    </Field>
                    <Field label="운영진 메모 (회원 비공개)">
                        <input
                            type="text"
                            value={adminMemo}
                            onChange={(e) => setAdminMemo(e.target.value)}
                            placeholder="운영진만 볼 수 있는 메모"
                            style={inputStyle}
                            disabled={isVoided}
                        />
                    </Field>
                </div>

                {error && (
                    <p style={{ margin: '8px 0 0', fontSize: 11.5, fontWeight: 700, color: '#B91C1C' }}>
                        {error}
                    </p>
                )}

                <div style={{
                    marginTop: 14, paddingTop: 12,
                    borderTop: '1px dashed rgba(15,23,42,0.08)',
                    display: 'flex', gap: 8, flexDirection: 'column',
                }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={onClose} disabled={busy} style={secondaryButton}>
                            닫기
                        </button>
                        {!isVoided && (
                            <button type="button" onClick={handleSave} disabled={busy} style={primaryButton(busy)}>
                                {busy ? '저장 중...' : '저장'}
                            </button>
                        )}
                    </div>
                    {isVoided ? (
                        <button type="button" onClick={handleUnvoid} disabled={busy} style={ghostButton('teal')}>
                            취소 해제 (다시 합계 포함)
                        </button>
                    ) : (
                        <button type="button" onClick={handleVoid} disabled={busy} style={ghostButton('red')}>
                            이 기록 취소(무효)
                        </button>
                    )}
                    <p style={{ margin: '4px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', textAlign: 'center' }}>
                        취소된 기록은 삭제되지 않고 보존됩니다.
                    </p>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
    outline: 'none', width: '100%',
};

function primaryButton(busy: boolean): React.CSSProperties {
    return {
        flex: 1,
        height: 40, paddingLeft: 14, paddingRight: 14,
        borderRadius: 10,
        backgroundColor: busy ? '#CBD5E1' : '#0F9F98',
        color: '#FFFFFF', border: 'none',
        fontSize: 12.5, fontWeight: 900,
        cursor: busy ? 'wait' : 'pointer',
    };
}

const secondaryButton: React.CSSProperties = {
    flex: 1,
    height: 40, paddingLeft: 14, paddingRight: 14,
    borderRadius: 10,
    backgroundColor: '#FFFFFF', color: '#475569',
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12.5, fontWeight: 800,
    cursor: 'pointer',
};

function ghostButton(tone: 'red' | 'teal'): React.CSSProperties {
    return {
        height: 36,
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
        color: tone === 'red' ? '#B91C1C' : '#0E7C76',
        border: `1px solid ${tone === 'red' ? 'rgba(220,38,38,0.32)' : 'rgba(15,159,152,0.30)'}`,
        fontSize: 11.5, fontWeight: 800,
        cursor: 'pointer',
    };
}

// formatWon 은 사용 안 하지만 import 유지 (정적 분석 통과용 — 향후 확장 대비). 제거 권장 시 아래 주석.
void formatWon;
