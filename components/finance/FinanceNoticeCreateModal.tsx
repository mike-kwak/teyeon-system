'use client';

import React from 'react';
import { X, Link2, MessageSquare, Check } from 'lucide-react';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    buildNoticeSnapshot,
    createPublicNotice,
    publicNoticeUrl,
    buildKakaoNoticeText,
    fetchValidNoticePayments,
    fetchPriorMonthArrears,
    priorArrearsStatsOf,
    formatReferenceDot,
    todayISO,
    type FinancePublicNotice,
    type PriorArrearLine,
} from '@/lib/finance/noticesService';
import { FINANCE_PAYMENT_ACCOUNT } from '@/lib/finance/paymentAccount';
import type { FinanceMember } from '@/lib/finance/duesService';
import type { FinanceDuesPayment, FinanceDuesReceivable, FinanceMemberLeave } from '@/types/finance';

/**
 * 회원 공지 만들기 — 선택된 (year, month) 의 전체 회비 납부 현황을 스냅샷으로 고정해
 *   랜덤 토큰 공개 링크를 생성한다. 생성 후 링크/카카오 안내문 복사 제공.
 */
export default function FinanceNoticeCreateModal({
    year,
    month,
    members,
    receivables,
    payments,
    leaves,
    annualPaidIds,
    onClose,
    onCreated,
}: {
    year: number;
    month: number;
    members: FinanceMember[];
    receivables: FinanceDuesReceivable[];
    payments: FinanceDuesPayment[];
    leaves: FinanceMemberLeave[];
    annualPaidIds?: Set<string>;
    onClose: () => void;
    onCreated?: (notice: FinancePublicNotice) => void;
}) {
    const [title, setTitle] = React.useState('TEYEON 회비 납부 현황');
    const [referenceDate, setReferenceDate] = React.useState(todayISO());
    const [publicNote, setPublicNote] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [created, setCreated] = React.useState<FinancePublicNotice | null>(null);
    const [copied, setCopied] = React.useState<'link' | 'kakao' | null>(null);

    // 공지 생성 직전, 해당 월 청구의 "유효 payment"만 DB 에서 새로 조회(취소분 stale 합산 방지).
    //   로딩 전/실패 시엔 전달받은 payments 에서 is_voided !== true 만 사용(이중 안전).
    const [freshPayments, setFreshPayments] = React.useState<FinanceDuesPayment[] | null>(null);
    React.useEffect(() => {
        let cancelled = false;
        const recvIds = receivables.map((r) => r.id);
        (async () => {
            const valid = await fetchValidNoticePayments(recvIds);
            if (!cancelled) setFreshPayments(valid);
        })();
        return () => { cancelled = true; };
    }, [receivables]);
    const effectivePayments = React.useMemo(
        () => freshPayments ?? payments.filter((p) => p.is_voided !== true),
        [freshPayments, payments],
    );

    // 이전 월 이월 미납(선택 월보다 이전, 같은 연도) — 생성 직전 최신 DB 조회.
    const [priorArrears, setPriorArrears] = React.useState<PriorArrearLine[]>([]);
    React.useEffect(() => {
        let cancelled = false;
        const nameById: Record<string, string> = {};
        for (const m of members) nameById[m.id] = m.nickname || '회원';
        (async () => {
            const lines = await fetchPriorMonthArrears({ year, month, nameById });
            if (!cancelled) setPriorArrears(lines);
        })();
        return () => { cancelled = true; };
    }, [year, month, members]);

    // 현재 입력값 기준 스냅샷 미리보기(전체 납부 대상 + 회비 제외 + 집계).
    const preview = React.useMemo(
        () => buildNoticeSnapshot({ members, receivables, payments: effectivePayments, leaves, year, month, annualPaidIds }),
        [members, receivables, effectivePayments, leaves, year, month, annualPaidIds],
    );
    const priorArrearsStats = React.useMemo(() => priorArrearsStatsOf(priorArrears), [priorArrears]);
    const overallOutstandingAmount = preview.stats.totalRemaining + priorArrearsStats.remainingAmount;

    // 무결성 경고 — annualFeePaid 회원이 이전 월 미납으로 검출되면 숨기지 않고 개발 경고만.
    //   공개 스냅샷은 실제 receivable 잔액(priorArrears)을 우선한다.
    React.useEffect(() => {
        if (!annualPaidIds || priorArrears.length === 0) return;
        const conflict = priorArrears.filter((a) => annualPaidIds.has(a.memberId));
        if (conflict.length > 0) {
            console.warn(
                '[Finance/notice] annualFeePaid 회원이 이전 월 미납으로 검출됨 — 연회비 판정/미납 계산 확인 필요:',
                conflict.map((c) => `${c.displayName} ${c.targetYear}-${c.targetMonth} ${c.remainingAmount}원`),
            );
        }
    }, [priorArrears, annualPaidIds]);

    const handleCreate = async () => {
        if (busy) return;
        if (preview.members.length === 0) {
            alert('이 달의 월회비 납부 대상 회원이 없어 공지를 만들 수 없습니다.');
            return;
        }
        setBusy(true);
        try {
            const notice = await createPublicNotice({
                title,
                targetYear: year,
                targetMonth: month,
                referenceDate,
                publicNote,
                members: preview.members,
                excluded: preview.excluded,
                stats: preview.stats,
                priorArrears,
                priorArrearsStats,
                overallOutstandingAmount,
            });
            setCreated(notice);
            onCreated?.(notice);
        } catch (e: any) {
            alert(e?.message || '공지 생성에 실패했습니다.');
        } finally {
            setBusy(false);
        }
    };

    const copy = async (text: string, kind: 'link' | 'kakao') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(kind);
            setTimeout(() => setCopied(null), 1600);
        } catch {
            // clipboard 미지원 환경 — 수동 안내.
            window.prompt('복사할 내용을 길게 눌러 복사해 주세요.', text);
        }
    };

    const url = created ? publicNoticeUrl(created.token) : '';
    const kakao = created
        ? buildKakaoNoticeText({
            year, month,
            referenceDate: created.reference_date,
            url,
            members: preview.members,
            stats: preview.stats,
            priorArrears,
            paymentAccount: FINANCE_PAYMENT_ACCOUNT,
        })
        : '';

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 400,
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
                    width: '100%', maxWidth: 430,
                    maxHeight: 'calc(100dvh - 28px)',
                    overflow: 'hidden',
                    backgroundColor: '#FFFFFF', borderRadius: 18,
                    border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 24px 60px rgba(15,23,42,0.22)',
                    boxSizing: 'border-box',
                }}
            >
                {/* Header */}
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '15px 16px', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 8.5, fontWeight: 800, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#0E7C76' }}>
                            TEYEON · FINANCE
                        </p>
                        <h2 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 900, color: '#0F172A' }}>
                            {created ? '공지 링크 생성 완료' : '회원 공지 만들기'}
                        </h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="닫기" style={iconBtnStyle}>
                        <X size={17} strokeWidth={2.2} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {!created ? (
                        <>
                            <Field label="공지 제목">
                                <input
                                    type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                                    maxLength={60} style={inputStyle}
                                />
                            </Field>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <Field label="기준 연·월">
                                    <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', fontWeight: 800, color: '#0F172A', backgroundColor: '#F8FAFC' }}>
                                        {year}년 {month}월
                                    </div>
                                </Field>
                                <Field label="기준일">
                                    <input
                                        type="date" value={referenceDate}
                                        onChange={(e) => setReferenceDate(e.target.value || todayISO())}
                                        style={inputStyle}
                                    />
                                </Field>
                            </div>

                            <Field label="공개 대상">
                                <div style={readonlyPill}>미납 및 일부 납부 회원</div>
                            </Field>

                            <Field label="공지 메모 (선택)">
                                <textarea
                                    value={publicNote} onChange={(e) => setPublicNote(e.target.value)}
                                    maxLength={300} rows={3} placeholder="예) 6월 회비 납부 부탁드립니다. 모임통장으로 입금해 주세요."
                                    style={{ ...inputStyle, height: 'auto', resize: 'vertical', lineHeight: 1.5, paddingTop: 9, paddingBottom: 9 }}
                                />
                            </Field>

                            {/* 미리보기 요약 */}
                            <div style={{ backgroundColor: '#F8FAFC', borderRadius: 12, border: '1px solid rgba(15,23,42,0.06)', padding: 12 }}>
                                <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: '#64748B' }}>
                                    {formatReferenceDot(referenceDate)} 기준 스냅샷 미리보기
                                </p>
                                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, fontWeight: 800, color: '#334155' }}>
                                    <span>대상 {preview.stats.targetCount}</span>
                                    <span style={{ color: '#0E7C76' }}>완료 {preview.stats.paidCount}</span>
                                    <span style={{ color: '#92400E' }}>일부 {preview.stats.partialCount}</span>
                                    <span style={{ color: '#B91C1C' }}>미납 {preview.stats.unpaidCount}</span>
                                    <span style={{ color: '#64748B' }}>제외 {preview.stats.associateExcludedCount + preview.stats.leaveExcludedCount}</span>
                                </div>
                                <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 900, color: '#0F172A' }}>
                                    총 대상 {formatWon(preview.stats.totalDue)} · 완료 {formatWon(preview.stats.totalPaid)} · 남음 {formatWon(preview.stats.totalRemaining)}
                                </p>
                                <p style={{ margin: '8px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5 }}>
                                    생성 시점 기준으로 고정 저장됩니다. 이후 납부 데이터가 바뀌어도 이 링크 내용은 변경되지 않습니다. 링크는 비활성화로 관리합니다(만료일 없음).
                                </p>
                                <p style={{ margin: '6px 0 0', fontSize: 10.5, fontWeight: 800, color: '#0E7C76', lineHeight: 1.5 }}>
                                    공지에 카카오뱅크 입금 계좌가 포함됩니다.
                                </p>
                            </div>

                            <button type="button" onClick={handleCreate} disabled={busy || preview.members.length === 0} style={primaryBtn(busy || preview.members.length === 0)}>
                                {busy ? '생성 중...' : '공지 링크 생성'}
                            </button>
                        </>
                    ) : (
                        <>
                            <div style={{ backgroundColor: '#ECFDF5', borderRadius: 12, border: '1px solid rgba(13,148,136,0.22)', padding: 13 }}>
                                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F5132' }}>
                                    {formatReferenceDot(created.reference_date)} 기준 공지가 생성되었습니다.
                                </p>
                                <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 600, color: '#0E7C76' }}>
                                    미납 {created.unpaid_count}명 · 일부 {created.partial_count}명 · 총 미납 {formatWon(created.total_unpaid_amount)}
                                </p>
                            </div>

                            <Field label="공개 링크">
                                <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', backgroundColor: '#F8FAFC', overflow: 'hidden' }}>
                                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: '#334155' }}>
                                        {url}
                                    </span>
                                </div>
                            </Field>

                            <button type="button" onClick={() => copy(url, 'link')} style={secondaryBtn}>
                                {copied === 'link' ? <Check size={15} /> : <Link2 size={15} />}
                                {copied === 'link' ? '복사됨' : '링크 복사'}
                            </button>
                            <button type="button" onClick={() => copy(kakao, 'kakao')} style={primaryBtn(false)}>
                                {copied === 'kakao' ? <Check size={15} /> : <MessageSquare size={15} />}
                                {copied === 'kakao' ? '복사됨' : '카카오톡 안내문 복사'}
                            </button>

                            <div style={{ backgroundColor: '#F8FAFC', borderRadius: 12, border: '1px solid rgba(15,23,42,0.06)', padding: 12 }}>
                                <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#64748B' }}>안내문 미리보기</p>
                                <pre style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
                                    {kakao}
                                </pre>
                            </div>

                            <button type="button" onClick={onClose} style={secondaryBtn}>닫기</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 6 }}>{label}</span>
            {children}
        </label>
    );
}

const iconBtnStyle: React.CSSProperties = {
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

const readonlyPill: React.CSSProperties = {
    ...inputStyle, display: 'flex', alignItems: 'center',
    backgroundColor: '#F1F5F9', color: '#475569', fontWeight: 800,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
    return {
        height: 46, borderRadius: 12, border: 'none',
        backgroundColor: disabled ? '#CBD5E1' : '#0F9F98', color: '#FFFFFF',
        fontSize: 13.5, fontWeight: 900, cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    };
}

const secondaryBtn: React.CSSProperties = {
    height: 44, borderRadius: 12, border: '1px solid rgba(15,23,42,0.12)',
    backgroundColor: '#FFFFFF', color: '#334155',
    fontSize: 13, fontWeight: 800, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
};
