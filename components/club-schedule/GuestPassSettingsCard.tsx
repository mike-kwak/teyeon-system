'use client';

import React from 'react';
import Link from 'next/link';
import {
    ExternalLink, Eye, Copy, Check, RefreshCcw, AlertTriangle, Settings2,
} from 'lucide-react';
import type { ClubSchedule } from '@/lib/clubScheduleData';
import {
    fetchScheduleGuestPass,
    fetchGuestPassDefaults,
    saveScheduleGuestPass,
    regenerateGuestPassToken,
    mergeGuestPassData,
    type ScheduleGuestPass,
    type GuestPassDefaults,
} from '@/lib/guestPassService';
import {
    buildGuestPassUrl,
    buildKakaoMessage,
    shareOrCopyText,
    copyText,
} from '@/lib/guestPassMessage';
import type { GuestPassParticipation } from '@/lib/guestPassData';

/**
 * Club Schedule 상세에 마운트하는 CEO/ADMIN 전용 Guest Pass 설정 카드.
 *
 * 섹션 구성:
 *   1) 공개 상태 — 비공개 / 공개 중 토글
 *   2) 공개 액션 — 미리보기 / 게스트 안내 링크 복사 / 카카오 안내문 복사 / 안내 링크 새로 만들기
 *   3) 이번 정모 설정 — 게스트비, 계좌 공개, 추가 공지, 참여 상태, 경기 안내 override
 *   4) 공통 설정 — 공통 기본값 편집 진입
 *
 * 용어: "토큰" 노출 금지. 사용자에게는 '게스트 안내 링크' / '안내 링크 새로 만들기' 등 일상어 사용.
 * 내부 코드/DB 컬럼명(public_token)은 유지.
 */

interface GuestPassSettingsCardProps {
    schedule: ClubSchedule;
    userId?: string;
}

export default function GuestPassSettingsCard({ schedule, userId }: GuestPassSettingsCardProps) {
    const [loadStatus, setLoadStatus] = React.useState<'loading' | 'ok' | 'failed'>('loading');
    const [perMeet, setPerMeet] = React.useState<ScheduleGuestPass | null>(null);
    const [defaults, setDefaults] = React.useState<GuestPassDefaults | null>(null);

    // 편집 폼 (퍼시스트는 명시적 저장 버튼)
    const [feeOverrideStr, setFeeOverrideStr] = React.useState('');
    const [showBank, setShowBank] = React.useState(true);
    const [extraNotice, setExtraNotice] = React.useState('');
    const [matchHeadlineOverride, setMatchHeadlineOverride] = React.useState('');
    const [matchBodyOverride, setMatchBodyOverride] = React.useState('');
    const [participation, setParticipation] = React.useState<GuestPassParticipation>('confirmed');

    const [saving, setSaving] = React.useState(false);
    const [savedTick, setSavedTick] = React.useState(0);
    const [saveError, setSaveError] = React.useState<string | null>(null);

    const [copyLinkState, setCopyLinkState] = React.useState<'idle' | 'copied' | 'shared' | 'failed'>('idle');
    const [copyKakaoState, setCopyKakaoState] = React.useState<'idle' | 'copied' | 'shared' | 'failed'>('idle');
    const [regenBusy, setRegenBusy] = React.useState(false);

    // 초기 로드 ─────────────────────────────────────────────────────────────
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [pm, d] = await Promise.all([
                    fetchScheduleGuestPass(schedule.id),
                    fetchGuestPassDefaults(),
                ]);
                if (cancelled) return;
                setPerMeet(pm);
                setDefaults(d);
                setFeeOverrideStr(pm?.feeAmountOverride != null ? String(pm.feeAmountOverride) : '');
                setShowBank(pm?.showBankAccount !== false);
                setExtraNotice(pm?.extraNotice ?? '');
                setMatchHeadlineOverride(pm?.matchStatusHeadlineOverride ?? '');
                setMatchBodyOverride(pm?.matchStatusBodyOverride ?? '');
                setParticipation(pm?.participationStatus ?? 'confirmed');
                setLoadStatus('ok');
            } catch (err) {
                if (cancelled) return;
                console.warn('[GuestPassSettings] load failed:', err);
                setLoadStatus('failed');
            }
        })();
        return () => { cancelled = true; };
    }, [schedule.id]);

    const isActive = !!perMeet?.isActive;
    const token = perMeet?.publicToken ?? null;
    const guestPassUrl = buildGuestPassUrl({ token });

    const handleSave = async (opts: { isActive: boolean }) => {
        setSaving(true);
        setSaveError(null);
        try {
            const next = await saveScheduleGuestPass({
                scheduleId: schedule.id,
                isActive: opts.isActive,
                overrides: {
                    feeAmountOverride: feeOverrideStr ? Number(feeOverrideStr) : null,
                    showBankAccount: showBank,
                    extraNotice: extraNotice.trim() || null,
                    matchStatusHeadlineOverride: matchHeadlineOverride.trim() || null,
                    matchStatusBodyOverride: matchBodyOverride.trim() || null,
                    participationStatus: participation,
                },
                userId,
            });
            setPerMeet(next);
            setSavedTick((n) => n + 1);
        } catch (err: any) {
            setSaveError(err?.message || '저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const handleCopyLink = async () => {
        if (!guestPassUrl) return;
        const result = await shareOrCopyText({
            title: 'TEYEON Guest Pass',
            text: guestPassUrl,
        });
        setCopyLinkState(result.mode === 'share' ? 'shared'
            : result.mode === 'copy' ? 'copied' : 'failed');
        window.setTimeout(() => setCopyLinkState('idle'), 2000);
    };

    const handleCopyKakao = async () => {
        if (!guestPassUrl) return;
        // 카카오 메시지는 합쳐진 GuestPassData 기준 — defaults 없으면 메시지 일부가 비어 있음.
        const data = mergeGuestPassData({ schedule, defaults, perMeet });
        const message = buildKakaoMessage({ data, guestPassUrl });
        try {
            await copyText(message);
            setCopyKakaoState('copied');
        } catch {
            setCopyKakaoState('failed');
        }
        window.setTimeout(() => setCopyKakaoState('idle'), 2000);
    };

    const handleRegenerate = async () => {
        if (!perMeet) {
            alert('먼저 Guest Pass를 공개 상태로 활성화해 주세요.');
            return;
        }
        const ok = window.confirm(
            '새 링크를 만들면 기존에 공유한 Guest Pass 링크는 더 이상 사용할 수 없습니다. 계속하시겠습니까?'
        );
        if (!ok) return;
        setRegenBusy(true);
        try {
            const next = await regenerateGuestPassToken(schedule.id, userId);
            setPerMeet(next);
            setSavedTick((n) => n + 1);
        } catch (err: any) {
            alert(err?.message || '안내 링크를 새로 만들지 못했습니다.');
        } finally {
            setRegenBusy(false);
        }
    };

    // ── 렌더 ───────────────────────────────────────────────────────────────
    return (
        <section
            style={{
                borderRadius: 16,
                backgroundColor: '#FFFFFF',
                border: '1px solid rgba(15,159,152,0.18)',
                boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
                padding: 16,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{
                    width: 4, height: 16, borderRadius: 2,
                    background: 'linear-gradient(180deg, #0E7E76, #1EA89B)',
                }} />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.01em' }}>
                    Guest Pass 설정
                </h3>
                <span style={{
                    marginLeft: 'auto',
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                    paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
                    borderRadius: 4,
                    backgroundColor: 'rgba(15,159,152,0.10)',
                    color: '#0E7C76',
                    border: '1px solid rgba(15,159,152,0.22)',
                }}>
                    ADMIN
                </span>
            </div>

            {loadStatus === 'loading' && (
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#94A3B8' }}>불러오는 중...</p>
            )}

            {loadStatus === 'failed' && (
                <div
                    style={{
                        display: 'flex', gap: 8, alignItems: 'flex-start',
                        padding: '8px 10px', borderRadius: 8,
                        backgroundColor: 'rgba(220,38,38,0.08)',
                        border: '1px solid rgba(220,38,38,0.28)',
                        fontSize: 11.5, fontWeight: 700, color: '#B91C1C',
                    }}
                >
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                        Guest Pass 설정을 불러오지 못했습니다.
                        supabase/add_club_schedule_guest_passes.sql 및 add_club_guest_pass_defaults.sql 적용 여부를 확인해 주세요.
                    </span>
                </div>
            )}

            {loadStatus === 'ok' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* ── 1. 공개 상태 ─────────────────────────────────── */}
                    <SectionLabel>공개 상태</SectionLabel>
                    <div
                        style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12,
                            borderRadius: 12,
                            backgroundColor: '#F8FAFC',
                            border: '1px solid rgba(15,23,42,0.06)',
                        }}
                    >
                        <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            backgroundColor: isActive ? '#10B981' : '#94A3B8',
                        }} />
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A', flex: 1 }}>
                            {isActive ? '공개 중' : '비공개'}
                        </span>
                        <button
                            type="button"
                            onClick={() => handleSave({ isActive: !isActive })}
                            disabled={saving}
                            style={{
                                height: 30, paddingLeft: 12, paddingRight: 12,
                                borderRadius: 8,
                                backgroundColor: isActive ? '#FFFFFF' : '#0F9F98',
                                color: isActive ? '#475569' : '#FFFFFF',
                                border: isActive ? '1px solid rgba(15,23,42,0.10)' : 'none',
                                fontSize: 11, fontWeight: 800,
                                cursor: saving ? 'wait' : 'pointer',
                                WebkitTapHighlightColor: 'transparent',
                            }}
                        >
                            {isActive ? '비공개로 전환' : 'Guest Pass 공개'}
                        </button>
                    </div>

                    {/* ── 2. 공개 액션 ─────────────────────────────────── */}
                    <SectionLabel>공개 액션</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <Link
                                href={`/guest/pass/preview?scheduleId=${schedule.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={iconButton}
                            >
                                <Eye size={12} /> 미리보기
                            </Link>
                            <button
                                type="button"
                                onClick={handleCopyLink}
                                disabled={!isActive || !token}
                                style={{
                                    ...iconButton,
                                    opacity: (!isActive || !token) ? 0.5 : 1,
                                    cursor: (!isActive || !token) ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {copyLinkState === 'copied' || copyLinkState === 'shared'
                                    ? <Check size={12} />
                                    : <Copy size={12} />}
                                {copyLinkState === 'copied' ? '복사됨'
                                    : copyLinkState === 'shared' ? '공유됨'
                                        : copyLinkState === 'failed' ? '실패'
                                            : '게스트 안내 링크 복사'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyKakao}
                                disabled={!isActive || !token}
                                style={{
                                    ...iconButton,
                                    opacity: (!isActive || !token) ? 0.5 : 1,
                                    cursor: (!isActive || !token) ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {copyKakaoState === 'copied' ? <Check size={12} /> : <Copy size={12} />}
                                {copyKakaoState === 'copied' ? '복사됨'
                                    : copyKakaoState === 'failed' ? '실패'
                                        : '카카오 안내문 복사'}
                            </button>
                            <button
                                type="button"
                                onClick={handleRegenerate}
                                disabled={regenBusy || !perMeet}
                                style={{
                                    ...iconButton,
                                    color: '#B91C1C',
                                    border: '1px solid rgba(220,38,38,0.32)',
                                    opacity: (!perMeet) ? 0.5 : 1,
                                    cursor: (regenBusy || !perMeet) ? 'not-allowed' : 'pointer',
                                }}
                            >
                                <RefreshCcw size={11} /> 안내 링크 새로 만들기
                            </button>
                        </div>

                        {token ? (
                            <p style={{
                                margin: 0,
                                fontSize: 10.5, fontWeight: 600, color: '#64748B',
                                wordBreak: 'break-all',
                            }}>
                                {guestPassUrl}
                            </p>
                        ) : isActive ? (
                            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: '#B45309' }}>
                                저장하면 공개 링크가 발급됩니다.
                            </p>
                        ) : (
                            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                                공개 활성화 후 링크가 생성됩니다.
                            </p>
                        )}
                    </div>

                    {/* ── 3. 이번 정모 설정 ────────────────────────────── */}
                    <SectionLabel>이번 정모 설정</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <FormRow label="게스트비 (원)">
                            <input
                                type="number"
                                inputMode="numeric"
                                value={feeOverrideStr}
                                onChange={(e) => setFeeOverrideStr(e.target.value)}
                                placeholder={
                                    schedule.fee_amount != null
                                        ? `${schedule.fee_amount.toLocaleString()} (정모 설정)`
                                        : defaults?.defaultFeeAmount != null
                                            ? `${defaults.defaultFeeAmount.toLocaleString()} (공통 기본값)`
                                            : '예: 10000'
                                }
                                style={inputStyle}
                            />
                            <Hint>비워두면 공통 기본값을 사용합니다.</Hint>
                        </FormRow>

                        <FormRow label="계좌 공개">
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#0F172A' }}>
                                <input
                                    type="checkbox"
                                    checked={showBank}
                                    onChange={(e) => setShowBank(e.target.checked)}
                                />
                                Guest Pass 카드에 계좌 표시
                            </label>
                            <Hint>끄면 공개 응답에서 계좌 정보가 완전히 제외됩니다.</Hint>
                        </FormRow>

                        <FormRow label="추가 공지 (이번 정모만)">
                            <textarea
                                value={extraNotice}
                                onChange={(e) => setExtraNotice(e.target.value)}
                                placeholder="예: 비 예보로 코트 변경될 수 있습니다."
                                rows={2}
                                style={textareaStyle}
                            />
                        </FormRow>

                        <FormRow label="참여 상태">
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {(['confirmed', 'pending', 'cancelled'] as const).map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setParticipation(p)}
                                        style={{
                                            height: 30, paddingLeft: 10, paddingRight: 10,
                                            borderRadius: 8,
                                            backgroundColor: participation === p ? '#0F172A' : '#FFFFFF',
                                            color: participation === p ? '#FFFFFF' : '#475569',
                                            border: `1px solid ${participation === p ? '#0F172A' : 'rgba(15,23,42,0.10)'}`,
                                            fontSize: 11, fontWeight: 800,
                                            cursor: 'pointer',
                                            WebkitTapHighlightColor: 'transparent',
                                        }}
                                    >
                                        {p === 'confirmed' ? '참여 확정' : p === 'pending' ? '운영진 확정 대기' : '정모 취소'}
                                    </button>
                                ))}
                            </div>
                        </FormRow>

                        <FormRow label="경기 안내 상태 문구">
                            <input
                                value={matchHeadlineOverride}
                                onChange={(e) => setMatchHeadlineOverride(e.target.value)}
                                placeholder={defaults?.matchStatusHeadline || '당일 대진표 공유 예정'}
                                style={inputStyle}
                            />
                            <Hint>비워두면 공통 기본값을 사용합니다.</Hint>
                        </FormRow>

                        <FormRow label="경기 안내 상세 문구">
                            <textarea
                                value={matchBodyOverride}
                                onChange={(e) => setMatchBodyOverride(e.target.value)}
                                placeholder={defaults?.matchStatusBody || '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.'}
                                rows={3}
                                style={textareaStyle}
                            />
                            <Hint>비워두면 공통 기본값을 사용합니다.</Hint>
                        </FormRow>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                            {saveError && (
                                <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#B91C1C' }}>
                                    {saveError}
                                </span>
                            )}
                            {!saveError && savedTick > 0 && !saving && (
                                <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#0E7C5C' }}>
                                    저장됨
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => handleSave({ isActive })}
                                disabled={saving}
                                style={{
                                    marginLeft: 'auto',
                                    height: 34, paddingLeft: 14, paddingRight: 14,
                                    borderRadius: 8,
                                    backgroundColor: saving ? '#CBD5E1' : '#0F9F98',
                                    color: '#FFFFFF', border: 'none',
                                    fontSize: 11.5, fontWeight: 800,
                                    cursor: saving ? 'wait' : 'pointer',
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                {saving ? '저장 중...' : '이번 정모 설정 저장'}
                            </button>
                        </div>
                    </div>

                    {/* ── 4. 공통 설정 ────────────────────────────────── */}
                    <SectionLabel>공통 설정</SectionLabel>
                    <Link
                        href="/admin/guest-pass-defaults"
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            alignSelf: 'flex-start',
                            fontSize: 11.5, fontWeight: 800, color: '#0E7C76',
                            textDecoration: 'none',
                        }}
                    >
                        <Settings2 size={12} /> 공통 기본값 편집 <ExternalLink size={11} />
                    </Link>
                    <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.55 }}>
                        공통 기본값은 모든 정모 Guest Pass 에 자동 적용됩니다. 정모별로 다르게 보이고 싶을 때만 위 'override' 입력란을 채워주세요.
                    </p>
                </div>
            )}
        </section>
    );
}

// ── Sub components ──────────────────────────────────────────────────────────

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <p
        style={{
            margin: 0,
            fontFamily: 'var(--font-rajdhani), sans-serif',
            fontSize: 10, fontWeight: 800, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: '#0E8079',
        }}
    >
        {children}
    </p>
);

const FormRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>{label}</span>
        {children}
    </label>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5 }}>
        {children}
    </span>
);

const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    height: 34,
    paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12, fontWeight: 600, color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontFamily: 'inherit',
    outline: 'none',
};

const textareaStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    paddingTop: 8, paddingBottom: 8, paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    fontSize: 12, fontWeight: 600, color: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical',
    minHeight: 52,
};

const iconButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    height: 30, paddingLeft: 10, paddingRight: 10,
    borderRadius: 8,
    border: '1px solid rgba(15,23,42,0.10)',
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 11, fontWeight: 800,
    cursor: 'pointer',
    textDecoration: 'none',
    WebkitTapHighlightColor: 'transparent',
};
