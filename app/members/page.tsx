'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import PremiumSpinner from '@/components/PremiumSpinner';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import {
    PlayerCardModal,
    type PlayerCardMember,
    type VisibilityLevel,
    EXE_PRIORITY,
    MEMBER_PRIORITY,
    getRoleLabel,
    getBadgeVariant,
    BADGE_STYLES,
    ACCENT,
} from '@/components/players/PlayerCardModal';
import {
    fetchMemberOfficialStats,
    type PlayerCardStats,
    type MemberOfficialStatsResult,
} from '@/lib/profile/getMemberOfficialStats';
import { normalizeAvatarUrl } from '@/lib/memberDisplayResolver';

// Local alias: members page uses the shared player card view model directly.
type Member = PlayerCardMember;

const getMemberPriority = (m: Member): number => {
    const role = (m.role || '').trim();
    const pos = (m.position || '').trim();
    if (EXE_PRIORITY[role]) return EXE_PRIORITY[role];
    if (EXE_PRIORITY[pos]) return EXE_PRIORITY[pos];
    if (m.is_admin) return 0;
    if (MEMBER_PRIORITY[role]) return MEMBER_PRIORITY[role];
    if (MEMBER_PRIORITY[pos]) return MEMBER_PRIORITY[pos];
    if (m.is_guest) return 30;
    return 99;
};

// ─── MemberCard (grid list) ───────────────────────────────────────────────────

const MemberCard = React.memo(function MemberCard({
    member,
    onOpen,
}: {
    member: Member;
    onOpen: (m: Member) => void;
}) {
    const { user } = useAuth();

    // 사진 우선순위:
    //   1) members.avatar_url (운영진 지정 클럽 사진) — 가장 우선
    //   2) profile_avatar_url (auth_user_id → profiles.id, 또는 email fallback으로 해소된 profiles.avatar_url)
    //   3) 본인일 때만 user_metadata.avatar_url || picture
    //   4) null → InitialAvatar fallback (ProfileAvatar의 fallbackIcon)
    // 모든 URL은 http 카카오 CDN을 https로 변환.
    const finalAvatar = useMemo(() => {
        const direct = normalizeAvatarUrl(member.avatar_url);
        if (direct) return direct;
        const profile = normalizeAvatarUrl(member.profile_avatar_url);
        if (profile) return profile;
        // 본인 한정 self fallback
        const isSelf =
            (member.auth_user_id && user?.id && member.auth_user_id === user.id) ||
            (!!user?.email && !!member.email && user.email === member.email);
        if (isSelf) {
            const meta = user?.user_metadata || {};
            return normalizeAvatarUrl(
                (meta.avatar_url as string | undefined) ||
                (meta.picture as string | undefined) ||
                null,
            );
        }
        return undefined;
    }, [
        user?.id,
        user?.email,
        user?.user_metadata,
        member.auth_user_id,
        member.email,
        member.avatar_url,
        member.profile_avatar_url,
    ]);

    const roleLabel = getRoleLabel(member);
    const variant = getBadgeVariant(roleLabel, member.is_admin);
    const accent = ACCENT[variant];

    const introText = member.bio || member.affiliation || '';

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen(member)}
            onKeyDown={(e) => { if (e.key === 'Enter') onOpen(member); }}
            style={{
                position: 'relative',
                backgroundColor: '#FFFFFF',
                borderRadius: 14,
                border: '1px solid rgba(0,0,0,0.06)',
                borderTop: `2px solid ${accent}`,
                boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
                padding: '13px 12px 12px',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                overflow: 'hidden',
                minHeight: 152,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                        style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#0F172A',
                            letterSpacing: '-0.01em',
                            margin: '0 0 5px',
                            lineHeight: 1.25,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {member.nickname}
                        {member.is_guest && (
                            <span style={{ fontSize: 10, fontWeight: 500, color: '#94A3B8', marginLeft: 3 }}>
                                &nbsp;(G)
                            </span>
                        )}
                    </p>
                    <span
                        style={{
                            ...BADGE_STYLES[variant],
                            fontSize: 8,
                            fontWeight: 800,
                            letterSpacing: '0.10em',
                            textTransform: 'uppercase',
                            padding: '2px 6px',
                            borderRadius: 4,
                            display: 'inline-block',
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {roleLabel}
                    </span>
                </div>

                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        flexShrink: 0,
                        padding: 2,
                        background: `linear-gradient(135deg, ${accent}38, ${accent}18)`,
                        boxShadow: `0 0 0 1px ${accent}30`,
                        overflow: 'hidden',
                    }}
                >
                    <div
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            overflow: 'hidden',
                            backgroundColor: `${accent}14`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <ProfileAvatar
                            src={finalAvatar}
                            alt={member.nickname}
                            size={40}
                            fallbackIcon={
                                <span
                                    style={{
                                        fontSize: 16,
                                        fontWeight: 900,
                                        color: accent,
                                        lineHeight: 1,
                                    }}
                                >
                                    {(member.nickname || '?').charAt(0)}
                                </span>
                            }
                        />
                    </div>
                </div>
            </div>

            <div style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginBottom: 8 }} />

            <p
                style={{
                    fontSize: 10.5,
                    fontWeight: 500,
                    color: '#64748B',
                    margin: '0 0 8px',
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    flexGrow: 1,
                    minHeight: 0,
                } as React.CSSProperties}
            >
                {introText || ' '}
            </p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    {member.achievements && (
                        <span
                            style={{
                                fontSize: 8.5,
                                fontWeight: 700,
                                color: '#B8891C',
                                backgroundColor: 'rgba(201,168,76,0.10)',
                                border: '1px solid rgba(201,168,76,0.20)',
                                padding: '2px 6px',
                                borderRadius: 4,
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
                </div>
                <div
                    style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        border: '1px solid rgba(0,0,0,0.06)',
                        backgroundColor: 'rgba(0,0,0,0.028)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginLeft: 4,
                    }}
                >
                    <ChevronRight size={10} strokeWidth={2} style={{ color: '#CBD5E1' }} />
                </div>
            </div>

            <div
                style={{
                    position: 'absolute',
                    right: -10,
                    bottom: -10,
                    width: 50,
                    height: 50,
                    borderRadius: '50%',
                    border: `1.5px solid ${accent}12`,
                    pointerEvents: 'none',
                }}
            />
        </div>
    );
});

// ─── MembersPage ──────────────────────────────────────────────────────────────

export default function MembersPage() {
    const { user } = useAuth();
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMember, setSelectedMember] = useState<Member | null>(null);
    const [selectedMemberStats, setSelectedMemberStats] = useState<PlayerCardStats | undefined>(undefined);
    const [isStatsLoading, setIsStatsLoading] = useState(false);
    // 같은 멤버를 반복해서 열어도 한 번만 조회. PROFILE과 동일 helper(fetchMemberOfficialStats)를 재사용한다.
    const statsCacheRef = useRef<Map<string, MemberOfficialStatsResult>>(new Map());

    useEffect(() => { fetchMembers(); }, []);

    async function fetchMembers() {
        try {
            setLoading(true);
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || '512d047d-a076-4080-97e5-6bb5a2c07819';
            const { data, error } = await supabase
                .from('members')
                .select('*')
                .eq('club_id', clubId)
                .order('nickname', { ascending: true });

            if (error) throw error;

            if (data && data.length > 0) {
                // 회원-프로필 연결 우선순위:
                //   1) members.auth_user_id → profiles.id  (DB unique key, 운영진이 사전 매핑한 회원)
                //   2) members.email = profiles.email      (호환용 fallback)
                // N+1 회피를 위해 두 batch만 사용.
                type ProfileRow = { id?: string; email?: string; avatar_url?: string; profile_visibility_level?: string };
                const profileById = new Map<string, ProfileRow>();
                const profileByEmail = new Map<string, ProfileRow>();

                const authUserIds = Array.from(new Set(
                    data
                        .map((m: Member) => m.auth_user_id)
                        .filter((id): id is string => Boolean(id))
                ));

                if (authUserIds.length > 0) {
                    const { data: rows, error } = await supabase
                        .from('profiles')
                        .select('id, email, avatar_url, profile_visibility_level')
                        .in('id', authUserIds);
                    if (error) {
                        console.warn('[Members] Profile fetch by id skipped:', error);
                    } else {
                        for (const p of (rows || []) as ProfileRow[]) {
                            if (p.id) profileById.set(p.id, p);
                        }
                    }
                }

                // email fallback — auth_user_id가 없는 회원에 한정해 batch.
                const emailFallbackTargets = Array.from(new Set(
                    data
                        .filter((m: Member) => !m.auth_user_id && m.email)
                        .map((m: Member) => m.email as string)
                ));

                if (emailFallbackTargets.length > 0) {
                    const { data: rows, error } = await supabase
                        .from('profiles')
                        .select('id, email, avatar_url, profile_visibility_level')
                        .in('email', emailFallbackTargets);
                    if (error) {
                        console.warn('[Members] Profile fetch by email skipped:', error);
                    } else {
                        for (const p of (rows || []) as ProfileRow[]) {
                            if (p.email) profileByEmail.set(p.email, p);
                        }
                    }
                }

                const enriched = data.map((m: Member) => {
                    const matched =
                        (m.auth_user_id ? profileById.get(m.auth_user_id) : undefined) ??
                        (m.email ? profileByEmail.get(m.email) : undefined);
                    return {
                        ...m,
                        // profile.avatar_url은 raw로 저장하고 카드에서 normalize.
                        profile_avatar_url: matched?.avatar_url || undefined,
                        profile_visibility_level: (matched?.profile_visibility_level as VisibilityLevel) ?? undefined,
                    };
                });

                const sorted = [...enriched].sort((a, b) => {
                    const diff = getMemberPriority(a) - getMemberPriority(b);
                    if (diff !== 0) return diff;
                    return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
                });
                setMembers(sorted);
            } else {
                setMembers([]);
            }
        } catch (err: any) {
            console.error('[Members] Fetch Error:', err);
            setMembers([]);
        } finally {
            setLoading(false);
        }
    }

    const handleOpen = useCallback((m: Member) => setSelectedMember(m), []);
    const handleClose = useCallback(() => setSelectedMember(null), []);

    // 선택 멤버가 바뀌면 캐시 확인 후 lazy fetch — 모달은 즉시 열리고 stats만 비동기로 채워진다.
    useEffect(() => {
        if (!selectedMember) {
            setSelectedMemberStats(undefined);
            setIsStatsLoading(false);
            return;
        }

        // 캐시 키에 stats schema 버전을 prefix로 붙여 helper 반환 구조 변경 시 자동 무효화.
        const cacheKey = `v2:${selectedMember.id}`;
        const cached = statsCacheRef.current.get(cacheKey);
        if (cached) {
            setSelectedMemberStats(cached.playerCardStats);
            setIsStatsLoading(false);
            return;
        }

        let cancelled = false;
        setSelectedMemberStats(undefined);   // 이전 멤버 값 즉시 초기화 — 잠깐도 잘못 노출 안 되도록
        setIsStatsLoading(true);

        fetchMemberOfficialStats({
            id: selectedMember.id,
            name: selectedMember.nickname,
        })
            .then((result) => {
                statsCacheRef.current.set(cacheKey, result);
                if (cancelled) return;
                setSelectedMemberStats(result.playerCardStats);
            })
            .catch((err) => {
                console.warn('[Members] Stats fetch failed:', err);
                if (cancelled) return;
                // 사용자에게는 기술 에러를 노출하지 않고 placeholder 폴백
                setSelectedMemberStats(undefined);
            })
            .finally(() => {
                if (!cancelled) setIsStatsLoading(false);
            });

        return () => { cancelled = true; };
    }, [selectedMember]);

    const handleVisibilitySaved = useCallback((level: VisibilityLevel) => {
        setSelectedMember((prev) => prev ? { ...prev, profile_visibility_level: level } : prev);
        setMembers((prev) =>
            prev.map((m) =>
                selectedMember && m.id === selectedMember.id
                    ? { ...m, profile_visibility_level: level }
                    : m
            )
        );
    }, [selectedMember]);

    const selectedAvatar = useMemo(() => {
        if (!selectedMember) return undefined;
        // PlayerCardModal에 전달되는 avatar — MemberCard와 동일 우선순위.
        const direct = normalizeAvatarUrl(selectedMember.avatar_url);
        if (direct) return direct;
        const profile = normalizeAvatarUrl(selectedMember.profile_avatar_url);
        if (profile) return profile;
        const isSelf =
            (selectedMember.auth_user_id && user?.id && selectedMember.auth_user_id === user.id) ||
            (!!user?.email && !!selectedMember.email && user.email === selectedMember.email);
        if (isSelf) {
            const meta = user?.user_metadata || {};
            return normalizeAvatarUrl(
                (meta.avatar_url as string | undefined) ||
                (meta.picture as string | undefined) ||
                null,
            ) || undefined;
        }
        return undefined;
    }, [selectedMember, user?.id, user?.email, user?.user_metadata]);

    const isOwnCard = useMemo(
        () =>
            Boolean(
                selectedMember &&
                ((selectedMember.auth_user_id && user?.id && selectedMember.auth_user_id === user.id) ||
                    (user?.email && selectedMember.email && user.email === selectedMember.email))
            ),
        [selectedMember, user?.id, user?.email]
    );

    return (
        <>
            <style>{`
                @keyframes member-grid-in {
                    from { opacity: 0; transform: translateY(10px); }
                    to   { opacity: 1; transform: translateY(0);    }
                }
                .member-grid { animation: member-grid-in 0.35s ease-out; }
                @media (prefers-reduced-motion: reduce) { .member-grid { animation: none; } }
            `}</style>

            <main
                style={{
                    width: '100%',
                    minHeight: '100dvh',
                    backgroundColor: '#F2F4F7',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    // 하단 BottomNav 여백은 공통 GlobalMain(var(--page-bottom-safe))이 단일 적용. 페이지 자체 clearance 제거(이중 패딩 방지).
                }}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth: 430,
                        padding: '0 16px',
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 11,
                            paddingTop: 16,
                            marginBottom: 16,
                        }}
                    >
                        <Link
                            href="/"
                            aria-label="메인으로"
                            style={{
                                width: 34, height: 34,
                                borderRadius: '50%',
                                border: '1px solid rgba(0,0,0,0.09)',
                                backgroundColor: '#FFFFFF',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#475569',
                                textDecoration: 'none',
                                flexShrink: 0,
                            }}
                        >
                            <ChevronLeft size={17} strokeWidth={2.2} />
                        </Link>
                        <div>
                            <p
                                style={{
                                    fontFamily: 'var(--font-rajdhani), sans-serif',
                                    fontSize: 8,
                                    fontWeight: 800,
                                    letterSpacing: '0.28em',
                                    textTransform: 'uppercase',
                                    color: '#0D9488',
                                    margin: 0,
                                    lineHeight: 1.3,
                                }}
                            >
                                TEYEON TENNIS CLUB
                            </p>
                            <p
                                style={{
                                    fontFamily: 'var(--font-rajdhani), sans-serif',
                                    fontSize: 16,
                                    fontWeight: 900,
                                    letterSpacing: '0.06em',
                                    textTransform: 'uppercase',
                                    color: '#0F172A',
                                    margin: 0,
                                    lineHeight: 1.2,
                                }}
                            >
                                MEMBERS
                            </p>
                        </div>
                    </div>

                    <div
                        style={{
                            marginBottom: 14,
                            borderRadius: 12,
                            backgroundColor: '#FFFFFF',
                            border: '1px solid rgba(0,0,0,0.06)',
                            borderLeft: '3px solid #0D9488',
                            padding: '11px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', margin: 0 }}>
                            Club Member Directory 2026
                        </p>
                        {!loading && (
                            <span
                                style={{
                                    fontSize: 9,
                                    fontWeight: 800,
                                    letterSpacing: '0.14em',
                                    color: '#0D9488',
                                    backgroundColor: 'rgba(13,148,136,0.08)',
                                    border: '1px solid rgba(13,148,136,0.18)',
                                    borderRadius: 5,
                                    padding: '2px 7px',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {members.length}명
                            </span>
                        )}
                    </div>

                    {loading && <PremiumSpinner message="Loading members..." />}

                    {!loading && members.length > 0 && (
                        <div
                            className="member-grid"
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 10,
                            }}
                        >
                            {members.map((m) => (
                                <MemberCard key={m.id} member={m} onOpen={handleOpen} />
                            ))}
                        </div>
                    )}

                    {!loading && members.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '60px 0', opacity: 0.4 }}>
                            <Users size={44} strokeWidth={1.3} color="#0D9488" style={{ marginBottom: 12 }} />
                            <p
                                style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.24em',
                                    color: '#64748B',
                                    margin: 0,
                                }}
                            >
                                No Members Found
                            </p>
                        </div>
                    )}
                </div>
            </main>

            {selectedMember && (
                <PlayerCardModal
                    member={selectedMember}
                    finalAvatar={selectedAvatar}
                    isOwnCard={isOwnCard}
                    stats={selectedMemberStats}
                    isStatsLoading={isStatsLoading}
                    onClose={handleClose}
                    onVisibilitySaved={handleVisibilitySaved}
                />
            )}
        </>
    );
}
