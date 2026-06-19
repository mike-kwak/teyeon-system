'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import ProfileAvatar from '@/components/ProfileAvatar';
import { Lock, X } from 'lucide-react';
import type { PlayerCardStats } from '@/lib/profile/getMemberOfficialStats';

export type { PlayerCardStats } from '@/lib/profile/getMemberOfficialStats';

// ─── Shared types ─────────────────────────────────────────────────────────────

export type VisibilityLevel = 'public' | 'partial' | 'private';

/**
 * Player card view model. Shared by /members list and /profile entry points.
 * Optional Archive stat fields are populated by the next aggregation pass;
 * the UI already renders the placeholders and hides locked cells when needed.
 */
export interface PlayerCardMember {
    id: string;
    nickname: string;
    role?: string;
    is_admin?: boolean;
    is_guest?: boolean;
    phone?: string;
    email?: string;
    mbti?: string;
    affiliation?: string;
    position?: string;
    achievements?: string;
    bio?: string;
    avatar_url?: string;
    profile_avatar_url?: string;
    profile_visibility_level?: VisibilityLevel;
}

// ─── Shared badge helpers ─────────────────────────────────────────────────────

export const EXE_PRIORITY: Record<string, number> = {
    '회장': 1, '부회장': 2, '총무': 3, '재무': 4, '경기': 5, '섭외': 6,
};
export const MEMBER_PRIORITY: Record<string, number> = {
    '정회원': 10, '준회원': 20, '게스트': 30,
};

export const getRoleLabel = (m: PlayerCardMember): string => {
    const role = (m.role || '').trim();
    const pos = (m.position || '').trim();
    return role || pos || (m.is_guest ? '게스트' : '멤버');
};

export type BadgeVariant = 'gold' | 'teal' | 'muted';

export const getBadgeVariant = (label: string, isAdmin?: boolean): BadgeVariant => {
    if (label === '회장' || label === '부회장' || isAdmin) return 'gold';
    if (EXE_PRIORITY[label] || label === '정회원') return 'teal';
    return 'muted';
};

export const BADGE_STYLES: Record<BadgeVariant, React.CSSProperties> = {
    gold: {
        backgroundColor: 'rgba(201,168,76,0.12)',
        color: '#B8891C',
        border: '1px solid rgba(201,168,76,0.28)',
    },
    teal: {
        backgroundColor: 'rgba(13,148,136,0.09)',
        color: '#0D9488',
        border: '1px solid rgba(13,148,136,0.22)',
    },
    muted: {
        backgroundColor: 'rgba(100,116,139,0.08)',
        color: '#64748B',
        border: '1px solid rgba(100,116,139,0.16)',
    },
};

export const ACCENT: Record<BadgeVariant, string> = {
    gold: '#C9A84C',
    teal: '#0D9488',
    muted: '#94A3B8',
};

// ─── VisibilitySettingModal ───────────────────────────────────────────────────

const VISIBILITY_OPTIONS: { level: VisibilityLevel; title: string; desc: string }[] = [
    {
        level: 'public',
        title: '전체 공개',
        desc: '랭킹, 승률, 출석, 전적, 배지를 모두 보여줍니다.',
    },
    {
        level: 'partial',
        title: '일부 공개',
        desc: '대표 배지와 일부 활동 정보만 보여주고, 승률·전적은 가립니다.',
    },
    {
        level: 'private',
        title: '기본 정보만 공개',
        desc: '이름, 역할, 한 줄 소개만 보여줍니다.',
    },
];

function VisibilitySettingModal({
    currentLevel,
    onSave,
    onCancel,
    isSaving,
    saveError,
}: {
    currentLevel: VisibilityLevel;
    onSave: (level: VisibilityLevel) => void;
    onCancel: () => void;
    isSaving: boolean;
    saveError: string | null;
}) {
    const [selected, setSelected] = useState<VisibilityLevel>(currentLevel);

    return (
        <div
            role="dialog"
            aria-modal="true"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 3000,
                backgroundColor: 'rgba(15,23,42,0.55)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
            } as React.CSSProperties}
            onClick={onCancel}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%',
                    maxWidth: 430,
                    backgroundColor: '#FFFFFF',
                    borderRadius: '20px 20px 0 0',
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
                    boxShadow: '0 -8px 40px rgba(0,0,0,0.14)',
                    overflow: 'hidden',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
                    <div style={{ width: 36, height: 4, borderRadius: 99, backgroundColor: 'rgba(0,0,0,0.10)' }} />
                </div>

                <div style={{ padding: '14px 20px 0' }}>
                    <p style={{
                        fontSize: 15, fontWeight: 800, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em',
                    }}>
                        프로필 공개 범위 설정
                    </p>
                    <p style={{
                        fontSize: 11, fontWeight: 500, color: '#64748B', margin: 0, lineHeight: 1.55,
                    }}>
                        내 KDK 기록과 활동 정보를 다른 회원에게 어떻게 보여줄지 선택할 수 있어요.
                        본인은 항상 전체 기록을 확인할 수 있습니다.
                    </p>
                </div>

                <div style={{ padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {VISIBILITY_OPTIONS.map((opt) => {
                        const isSelected = selected === opt.level;
                        return (
                            <button
                                key={opt.level}
                                type="button"
                                onClick={() => setSelected(opt.level)}
                                style={{
                                    width: '100%', padding: '12px 14px', borderRadius: 12,
                                    border: isSelected ? '1.5px solid #0D9488' : '1.5px solid rgba(0,0,0,0.08)',
                                    backgroundColor: isSelected ? 'rgba(13,148,136,0.06)' : '#FAFAFA',
                                    display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                                    textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                                    transition: 'border-color 0.15s, background-color 0.15s',
                                }}
                            >
                                <div
                                    style={{
                                        width: 18, height: 18, borderRadius: '50%',
                                        border: isSelected ? '5px solid #0D9488' : '1.5px solid rgba(0,0,0,0.20)',
                                        flexShrink: 0, marginTop: 2,
                                        backgroundColor: '#FFFFFF', boxSizing: 'border-box',
                                    } as React.CSSProperties}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{
                                        fontSize: 13, fontWeight: 700,
                                        color: isSelected ? '#0D9488' : '#1E293B',
                                        margin: '0 0 3px', letterSpacing: '-0.01em',
                                    }}>
                                        {opt.title}
                                    </p>
                                    <p style={{
                                        fontSize: 10.5, fontWeight: 500, color: '#64748B', margin: 0, lineHeight: 1.45,
                                    }}>
                                        {opt.desc}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {saveError && (
                    <p style={{
                        margin: '10px 20px 0', fontSize: 11, fontWeight: 500,
                        color: '#EF4444', textAlign: 'center', lineHeight: 1.4,
                    }}>
                        {saveError}
                    </p>
                )}

                <div style={{ display: 'flex', gap: 8, padding: '16px 20px 0' }}>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isSaving}
                        style={{
                            flex: 1, height: 44, borderRadius: 11,
                            border: '1.5px solid rgba(0,0,0,0.10)',
                            backgroundColor: '#F8FAFC',
                            fontSize: 13, fontWeight: 700, color: '#475569',
                            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                            opacity: isSaving ? 0.5 : 1,
                        }}
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={() => onSave(selected)}
                        disabled={isSaving}
                        style={{
                            flex: 2, height: 44, borderRadius: 11,
                            border: 'none', backgroundColor: '#0D9488',
                            fontSize: 13, fontWeight: 800, color: '#FFFFFF',
                            cursor: isSaving ? 'not-allowed' : 'pointer',
                            WebkitTapHighlightColor: 'transparent',
                            opacity: isSaving ? 0.7 : 1,
                            letterSpacing: '-0.01em',
                            boxShadow: '0 3px 12px rgba(13,148,136,0.22)',
                            transition: 'opacity 0.15s',
                        }}
                    >
                        {isSaving ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── PlayerCardModal ──────────────────────────────────────────────────────────

type StatLabel = 'LATEST RANK' | 'WIN RATE' | 'ATTEND' | 'RECORD';

const formatStatValue = (
    label: StatLabel,
    stats?: PlayerCardStats,
    isLoading?: boolean,
): string => {
    if (isLoading) return '···';
    if (!stats) return '--';
    switch (label) {
        case 'LATEST RANK':
            return stats.latestRank != null ? `${stats.latestRank}위` : '--';
        case 'WIN RATE':
            return stats.winRate != null ? `${Math.round(stats.winRate)}%` : '--';
        case 'ATTEND':
            return `${stats.attend} / ${stats.totalAttend}`;
        case 'RECORD':
            return stats.record ?? '--';
    }
};

export interface PlayerCardModalProps {
    member: PlayerCardMember;
    finalAvatar?: string;
    isOwnCard: boolean;
    /** Archive 공식 기록 집계 결과 — 없으면 4-cell이 '--' placeholder로 표시됨. */
    stats?: PlayerCardStats;
    /** 멤버별 stats가 조회 중인 동안 4-cell에 미세 로딩 표시. */
    isStatsLoading?: boolean;
    onClose: () => void;
    onVisibilitySaved?: (level: VisibilityLevel) => void;
}

export function PlayerCardModal({
    member,
    finalAvatar,
    isOwnCard,
    stats,
    isStatsLoading,
    onClose,
    onVisibilitySaved,
}: PlayerCardModalProps) {
    const { user } = useAuth();
    const roleLabel = getRoleLabel(member);
    const variant = getBadgeVariant(roleLabel, member.is_admin);
    const accentColor = ACCENT[variant];

    const [perspective, setPerspective] = useState<'self' | 'other'>(
        isOwnCard ? 'self' : 'other',
    );
    const [isVisibilityModalOpen, setIsVisibilityModalOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const visibilityLevel: VisibilityLevel = member.profile_visibility_level ?? 'public';

    const effectiveVisibility: VisibilityLevel = perspective === 'self' ? 'public' : visibilityLevel;

    const isStatVisible = (stat: string): boolean => {
        if (effectiveVisibility === 'public') return true;
        if (effectiveVisibility === 'partial') return stat === 'ATTEND';
        return false;
    };

    const showBadges = effectiveVisibility !== 'private';
    const showPrivacyNote = effectiveVisibility !== 'public';

    const handleVisibilitySave = async (level: VisibilityLevel) => {
        if (!user?.email) {
            setSaveError('로그인 정보를 확인할 수 없어요.');
            return;
        }
        if (user.email !== member.email) {
            setSaveError('본인 프로필만 변경할 수 있어요.');
            return;
        }
        setIsSaving(true);
        setSaveError(null);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ profile_visibility_level: level })
                .eq('email', user.email);
            if (error) throw error;
            onVisibilitySaved?.(level);
            setIsVisibilityModalOpen(false);
        } catch {
            setSaveError('저장에 실패했어요. 다시 시도해주세요.');
        } finally {
            setIsSaving(false);
        }
    };

    // Tilt: direct DOM mutation for performance.
    const tiltRef = useRef<HTMLDivElement>(null);
    const shineRef = useRef<HTMLDivElement>(null);
    const reducedMotionRef = useRef(false);
    // Only treat a pointer interaction as a tilt when it actually started on
    // empty card area (not on a button / toggle / link). Without this guard the
    // wrapper's setPointerCapture + preventDefault swallow click events on the
    // visibility settings button and the perspective toggle inside the card.
    const isTiltingRef = useRef(false);

    useEffect(() => {
        reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }, []);

    const resetTilt = useCallback(() => {
        if (tiltRef.current) {
            tiltRef.current.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg)';
            tiltRef.current.style.transition = 'transform 0.5s ease';
        }
        if (shineRef.current) {
            shineRef.current.style.background = 'radial-gradient(ellipse at 50% 50%, rgba(201,168,76,0.10) 0%, rgba(13,148,136,0.06) 35%, transparent 70%)';
            shineRef.current.style.transition = 'background 0.5s ease';
        }
    }, []);

    const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"], [data-no-tilt]';

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement | null;
        if (target && typeof target.closest === 'function' && target.closest(INTERACTIVE_SELECTOR)) {
            isTiltingRef.current = false;
            return;
        }
        isTiltingRef.current = true;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }, []);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isTiltingRef.current) return;
        if (reducedMotionRef.current) return;
        if (e.cancelable) e.preventDefault();

        const rect = e.currentTarget.getBoundingClientRect();
        const dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
        const dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
        const rotX = +(Math.max(-8, Math.min(8, -dy * 8))).toFixed(2);
        const rotY = +(Math.max(-8, Math.min(8, dx * 8))).toFixed(2);
        const sx = Math.max(0, Math.min(100, +((e.clientX - rect.left) / rect.width * 100).toFixed(1)));
        const sy = Math.max(0, Math.min(100, +((e.clientY - rect.top) / rect.height * 100).toFixed(1)));

        if (tiltRef.current) {
            tiltRef.current.style.transform = `perspective(700px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
            tiltRef.current.style.transition = 'none';
        }
        if (shineRef.current) {
            shineRef.current.style.background = `radial-gradient(ellipse at ${sx}% ${sy}%, rgba(201,168,76,0.22) 0%, rgba(13,148,136,0.14) 35%, transparent 70%)`;
            shineRef.current.style.transition = 'none';
        }
    }, []);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (isTiltingRef.current) {
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            resetTilt();
        }
        isTiltingRef.current = false;
    }, [resetTilt]);

    const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (isTiltingRef.current) {
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            resetTilt();
        }
        isTiltingRef.current = false;
    }, [resetTilt]);

    const handlePointerLeave = useCallback(() => {
        if (!isTiltingRef.current) return;
        isTiltingRef.current = false;
        resetTilt();
    }, [resetTilt]);

    return (
        <>
            <style>{`
                @keyframes player-card-in {
                    from { opacity: 0; transform: scale(0.93) translateY(16px); }
                    to   { opacity: 1; transform: scale(1)    translateY(0);    }
                }
                @media (prefers-reduced-motion: reduce) {
                    .player-card-animate { animation: none !important; opacity: 1 !important; }
                }
            `}</style>

            <div
                role="dialog"
                aria-modal="true"
                onClick={onClose}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 2000,
                    backgroundColor: 'rgba(15,23,42,0.48)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '16px',
                    overflowY: 'auto',
                } as React.CSSProperties}
            >
                <div
                    className="player-card-animate"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        width: '100%',
                        maxWidth: 320,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        animation: 'player-card-in 0.30s cubic-bezier(0.34,1.56,0.64,1) both',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 10,
                            flexShrink: 0,
                        }}
                    >
                        {isOwnCard ? (
                            <div
                                style={{
                                    display: 'flex',
                                    flex: 1,
                                    backgroundColor: 'rgba(255,255,255,0.11)',
                                    borderRadius: 99,
                                    padding: '3px',
                                    border: '1px solid rgba(255,255,255,0.16)',
                                }}
                            >
                                {(['self', 'other'] as const).map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        data-no-tilt
                                        onClick={() => setPerspective(p)}
                                        style={{
                                            flex: 1,
                                            height: 28,
                                            borderRadius: 99,
                                            border: 'none',
                                            fontSize: 10,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            WebkitTapHighlightColor: 'transparent',
                                            backgroundColor: perspective === p ? '#FFFFFF' : 'transparent',
                                            color: perspective === p ? '#0D9488' : 'rgba(255,255,255,0.55)',
                                            transition: 'background-color 0.18s, color 0.18s',
                                            letterSpacing: '-0.01em',
                                            whiteSpace: 'nowrap',
                                            padding: '0 6px',
                                        }}
                                    >
                                        {p === 'self' ? '본인 시점' : '다른 회원 시점'}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div style={{ flex: 1 }} />
                        )}
                        <button
                            type="button"
                            data-no-tilt
                            onClick={onClose}
                            aria-label="닫기"
                            style={{
                                width: 36,
                                height: 36,
                                flexShrink: 0,
                                borderRadius: '50%',
                                backgroundColor: 'rgba(255,255,255,0.15)',
                                border: '1px solid rgba(255,255,255,0.24)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#FFFFFF',
                                cursor: 'pointer',
                                WebkitTapHighlightColor: 'transparent',
                            }}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <div
                        ref={tiltRef}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerCancel}
                        onPointerLeave={handlePointerLeave}
                        style={{
                            transformStyle: 'preserve-3d',
                            willChange: 'transform',
                            flexShrink: 0,
                            touchAction: 'none',
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            WebkitTapHighlightColor: 'transparent',
                            overscrollBehavior: 'contain',
                        } as React.CSSProperties}
                    >
                        <div
                            style={{
                                background: `linear-gradient(135deg, ${accentColor} 0%, #0D9488 40%, ${accentColor} 70%, #0D9488 100%)`,
                                padding: '1.5px',
                                borderRadius: 22,
                                boxShadow: `0 16px 52px rgba(0,0,0,0.26), 0 6px 24px ${accentColor}40`,
                            }}
                        >
                            <div
                                style={{
                                    borderRadius: '20.5px',
                                    overflow: 'hidden',
                                    position: 'relative',
                                    background: 'linear-gradient(160deg, #FFFEF9 0%, #F8FAFC 50%, #EEF2FF 100%)',
                                }}
                            >
                                <div
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        backgroundImage: 'linear-gradient(rgba(13,148,136,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(13,148,136,0.028) 1px, transparent 1px)',
                                        backgroundSize: '28px 28px',
                                        pointerEvents: 'none',
                                        zIndex: 0,
                                    }}
                                />

                                <div
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        background: 'repeating-linear-gradient(45deg, transparent 0px, transparent 14px, rgba(201,168,76,0.04) 14px, rgba(201,168,76,0.04) 15px)',
                                        pointerEvents: 'none',
                                        zIndex: 0,
                                    }}
                                />

                                <div
                                    ref={shineRef}
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        background: 'radial-gradient(ellipse at 50% 50%, rgba(201,168,76,0.10) 0%, rgba(13,148,136,0.06) 35%, transparent 70%)',
                                        pointerEvents: 'none',
                                        zIndex: 1,
                                    }}
                                />

                                <div
                                    style={{
                                        position: 'absolute',
                                        top: 0, left: 0, right: 0, height: '40%',
                                        background: 'linear-gradient(180deg, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0) 100%)',
                                        pointerEvents: 'none',
                                        zIndex: 2,
                                    }}
                                />

                                <div
                                    style={{
                                        position: 'relative',
                                        zIndex: 3,
                                        background: 'linear-gradient(135deg, #0D9488 0%, #0F766E 55%, #115E59 100%)',
                                        padding: '13px 16px 15px',
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <div>
                                        <p
                                            style={{
                                                fontFamily: 'var(--font-rajdhani), sans-serif',
                                                fontSize: 18,
                                                fontWeight: 900,
                                                letterSpacing: '0.20em',
                                                textTransform: 'uppercase',
                                                color: '#FFFFFF',
                                                margin: 0,
                                                lineHeight: 1.1,
                                            }}
                                        >
                                            TEYEON
                                        </p>
                                        <p
                                            style={{
                                                fontFamily: 'var(--font-rajdhani), sans-serif',
                                                fontSize: 7.5,
                                                fontWeight: 700,
                                                letterSpacing: '0.22em',
                                                textTransform: 'uppercase',
                                                color: 'rgba(255,255,255,0.52)',
                                                margin: '2px 0 0',
                                            }}
                                        >
                                            TENNIS CLUB
                                        </p>
                                    </div>

                                    <div style={{ textAlign: 'right' }}>
                                        <span
                                            style={{
                                                display: 'inline-block',
                                                fontSize: 8,
                                                fontWeight: 800,
                                                letterSpacing: '0.12em',
                                                textTransform: 'uppercase',
                                                padding: '3px 8px',
                                                borderRadius: 5,
                                                backgroundColor: variant === 'gold' ? 'rgba(201,168,76,0.24)' : 'rgba(255,255,255,0.14)',
                                                color: variant === 'gold' ? '#F5D87A' : 'rgba(255,255,255,0.92)',
                                                border: variant === 'gold' ? '1px solid rgba(201,168,76,0.42)' : '1px solid rgba(255,255,255,0.22)',
                                                maxWidth: 100,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            {roleLabel}
                                        </span>
                                        <p
                                            style={{
                                                fontSize: 7.5,
                                                fontWeight: 600,
                                                color: 'rgba(255,255,255,0.42)',
                                                margin: '4px 0 0',
                                                letterSpacing: '0.10em',
                                            }}
                                        >
                                            LATEST&nbsp;{isStatsLoading ? '···' : (stats?.latestRank != null ? stats.latestRank : '--')}
                                        </p>
                                    </div>
                                </div>

                                <div style={{ padding: '16px 18px 18px', position: 'relative', zIndex: 3 }}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: 10,
                                            marginBottom: 16,
                                        }}
                                    >
                                        <div
                                            style={{
                                                width: 88, height: 88,
                                                borderRadius: '50%',
                                                padding: 3,
                                                background: `linear-gradient(135deg, ${accentColor} 0%, #0D9488 50%, ${accentColor}88 100%)`,
                                                boxShadow: `0 0 0 1px ${accentColor}28, 0 6px 20px ${accentColor}28`,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: 82, height: 82,
                                                    borderRadius: '50%',
                                                    overflow: 'hidden',
                                                    border: '2px solid rgba(255,255,255,0.88)',
                                                    backgroundColor: `${accentColor}14`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <ProfileAvatar
                                                    src={finalAvatar}
                                                    alt={member.nickname}
                                                    size={82}
                                                    fallbackIcon={
                                                        <span
                                                            style={{
                                                                fontSize: 34,
                                                                fontWeight: 900,
                                                                color: accentColor,
                                                                lineHeight: 1,
                                                            }}
                                                        >
                                                            {(member.nickname || '?').charAt(0)}
                                                        </span>
                                                    }
                                                />
                                            </div>
                                        </div>

                                        <div style={{ textAlign: 'center', maxWidth: '100%', overflow: 'hidden' }}>
                                            <p
                                                style={{
                                                    fontSize: 22,
                                                    fontWeight: 900,
                                                    color: '#0F172A',
                                                    margin: 0,
                                                    letterSpacing: '-0.025em',
                                                    lineHeight: 1.15,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {member.nickname}
                                                {member.is_guest && (
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#94A3B8', marginLeft: 5 }}>
                                                        (G)
                                                    </span>
                                                )}
                                            </p>
                                            {(member.affiliation || member.mbti) && (
                                                <p
                                                    style={{
                                                        fontSize: 11,
                                                        fontWeight: 500,
                                                        color: '#64748B',
                                                        margin: '4px 0 0',
                                                        lineHeight: 1.4,
                                                    }}
                                                >
                                                    {[member.affiliation, member.mbti].filter(Boolean).join(' · ')}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: 'flex',
                                            backgroundColor: 'rgba(248,250,252,0.88)',
                                            borderRadius: 12,
                                            border: '1px solid rgba(0,0,0,0.07)',
                                            marginBottom: 14,
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {(['LATEST RANK', 'WIN RATE', 'ATTEND', 'RECORD'] as const).map((label, idx) => {
                                            const isCompactValue = label === 'RECORD' || label === 'ATTEND';
                                            return (
                                            <div
                                                key={label}
                                                style={{
                                                    flex: 1,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    padding: '8px 2px',
                                                    borderLeft: idx > 0 ? '1px solid rgba(0,0,0,0.06)' : undefined,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontSize: 6.5,
                                                        fontWeight: 800,
                                                        letterSpacing: '0.14em',
                                                        textTransform: 'uppercase',
                                                        color: '#94A3B8',
                                                        marginBottom: 4,
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {label}
                                                </span>
                                                {isStatVisible(label) ? (
                                                    <span
                                                        style={{
                                                            fontSize: isCompactValue ? 15 : 18,
                                                            fontWeight: 900,
                                                            color: isStatsLoading ? '#CBD5E1' : '#0F172A',
                                                            letterSpacing: '-0.03em',
                                                            lineHeight: 1,
                                                            transition: 'color 0.2s ease',
                                                            whiteSpace: 'nowrap',
                                                        }}
                                                    >
                                                        {formatStatValue(label, stats, isStatsLoading)}
                                                    </span>
                                                ) : (
                                                    <span
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 2,
                                                            fontSize: 8,
                                                            fontWeight: 600,
                                                            color: '#94A3B8',
                                                        }}
                                                    >
                                                        <Lock size={8} />
                                                        비공개
                                                    </span>
                                                )}
                                            </div>
                                            );
                                        })}
                                    </div>

                                    {showPrivacyNote && (
                                        <p
                                            style={{
                                                margin: '0 0 10px',
                                                fontSize: 9,
                                                fontWeight: 500,
                                                color: '#94A3B8',
                                                textAlign: 'center',
                                                lineHeight: 1.4,
                                                letterSpacing: '-0.01em',
                                            }}
                                        >
                                            일부 기록은 본인만 확인할 수 있어요
                                        </p>
                                    )}

                                    {showBadges && (member.achievements || member.mbti) && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                                            {member.achievements && (
                                                <span
                                                    style={{
                                                        fontSize: 9.5,
                                                        fontWeight: 700,
                                                        padding: '3px 9px',
                                                        borderRadius: 5,
                                                        backgroundColor: 'rgba(201,168,76,0.10)',
                                                        color: '#B8891C',
                                                        border: '1px solid rgba(201,168,76,0.22)',
                                                        display: 'inline-block',
                                                        maxWidth: '100%',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    🏆 {member.achievements}
                                                </span>
                                            )}
                                            {member.mbti && (
                                                <span
                                                    style={{
                                                        fontSize: 9.5,
                                                        fontWeight: 700,
                                                        padding: '3px 9px',
                                                        borderRadius: 5,
                                                        backgroundColor: 'rgba(13,148,136,0.08)',
                                                        color: '#0D9488',
                                                        border: '1px solid rgba(13,148,136,0.18)',
                                                    }}
                                                >
                                                    {member.mbti}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {isOwnCard && (
                                        <button
                                            type="button"
                                            data-no-tilt
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSaveError(null);
                                                setIsVisibilityModalOpen(true);
                                            }}
                                            style={{
                                                position: 'relative',
                                                zIndex: 10,
                                                pointerEvents: 'auto',
                                                width: '100%',
                                                height: 40,
                                                borderRadius: 11,
                                                border: '1.5px solid rgba(13,148,136,0.24)',
                                                background: 'linear-gradient(135deg, rgba(13,148,136,0.06) 0%, rgba(13,148,136,0.03) 100%)',
                                                fontSize: 11,
                                                fontWeight: 700,
                                                color: '#0D9488',
                                                cursor: 'pointer',
                                                WebkitTapHighlightColor: 'transparent',
                                                letterSpacing: '-0.01em',
                                            }}
                                        >
                                            프로필 공개 범위 설정
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 10, textAlign: 'center', flexShrink: 0 }}>
                        <p
                            style={{
                                fontSize: 8,
                                fontWeight: 700,
                                letterSpacing: '0.22em',
                                textTransform: 'uppercase',
                                color: 'rgba(255,255,255,0.28)',
                                margin: 0,
                            }}
                        >
                            TEYEON MEMBER CARD · {member.id.slice(0, 8).toUpperCase()}
                        </p>
                        <p
                            style={{
                                margin: '5px 0 0',
                                fontSize: 10,
                                fontWeight: 500,
                                color: 'rgba(255,255,255,0.55)',
                                lineHeight: 1.4,
                            }}
                        >
                            카드를 움직여보세요
                        </p>
                    </div>
                </div>
            </div>

            {isVisibilityModalOpen && (
                <VisibilitySettingModal
                    currentLevel={visibilityLevel}
                    onSave={handleVisibilitySave}
                    onCancel={() => setIsVisibilityModalOpen(false)}
                    isSaving={isSaving}
                    saveError={saveError}
                />
            )}
        </>
    );
}

export default PlayerCardModal;
