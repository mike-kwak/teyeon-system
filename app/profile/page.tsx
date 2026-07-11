'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { maskEmail } from '@/lib/guide/masking';
import ProfileAvatar from '@/components/ProfileAvatar';
import { supabase } from '@/lib/supabase';
import { InitialAvatar } from '@/components/tournament/InitialAvatar';
import { LogOut, Settings, ChevronRight, ShieldCheck, Trophy, Sparkles, Lock } from 'lucide-react';
import {
    PlayerCardModal,
    MEMBER_LIST_COLS,
    type PlayerCardMember,
    type VisibilityLevel,
} from '@/components/players/PlayerCardModal';
import {
    fetchMemberOfficialStats,
    emptyProfileSummary,
    type ProfileKdkSummary,
    type RecentOfficialRecord,
    type PlayerCardStats,
} from '@/lib/profile/getMemberOfficialStats';
import {
    fetchPublicAchievements,
    formatMemberAchievement,
    normalizeAchievementResult,
    groupAchievementsByYear,
    type MemberAchievement,
} from '@/lib/members/achievements';

type ProfileVisibility = VisibilityLevel;

type LinkedMember = {
    id: string;
    nickname: string;
    profile_visibility_level?: ProfileVisibility | null;
    intro?: string | null;
    role?: string | null;
    is_admin?: boolean | null;
    is_guest?: boolean | null;
    mbti?: string | null;
    affiliation?: string | null;
    position?: string | null;
    bio?: string | null;
    avatar_url?: string | null;
    profile_avatar_url?: string | null;
};

// Re-export so existing external consumers (if any) keep their type imports working.
export type { ProfileKdkSummary, RecentOfficialRecord } from '@/lib/profile/getMemberOfficialStats';

const visibilityMeta = (level: ProfileVisibility) => {
    if (level === 'partial') return { label: '일부 공개', color: '#B7791F', bg: '#FFF4DE', border: '#F4C979' };
    if (level === 'private') return { label: '기본 정보만 공개', color: '#56729A', bg: '#F6FAFD', border: '#DCE8F5' };
    return { label: '전체 공개', color: '#16A085', bg: '#E0F5EB', border: '#B6E2CB' };
};

const formatSigned = (value: number) => (value > 0 ? `+${value}` : `${value}`);

export default function ProfilePage() {
    const { user, role, signOut, isLoading } = useAuth();
    const { shouldMaskPrivateData } = useGuideRecording();
    const [linkedMember, setLinkedMember] = useState<LinkedMember | null>(null);
    const [summary, setSummary] = useState<ProfileKdkSummary>(emptyProfileSummary);
    const [recentRecords, setRecentRecords] = useState<RecentOfficialRecord[]>([]);
    const [playerCardStats, setPlayerCardStats] = useState<PlayerCardStats | undefined>(undefined);
    const [kdkLoading, setKdkLoading] = useState(false);
    const [kdkError, setKdkError] = useState('');
    const [memberLookupDone, setMemberLookupDone] = useState(false);
    const [isPlayerCardOpen, setIsPlayerCardOpen] = useState(false);
    // 회원 연결 상태: none(정상/미판정) · no-link(연결 없음) · conflict(중복/충돌 — 운영진 확인 필요)
    const [linkIssue, setLinkIssue] = useState<'none' | 'no-link' | 'conflict'>('none');

    useEffect(() => {
        // 인증 uid 기준으로 조회 — 이메일이 없어도 members.auth_user_id 매칭이 가능해야 함.
        if (!user?.id) return;

        let cancelled = false;

        // 본인 회원 연결 판정 — members.auth_user_id === auth.uid() 정확 일치만 사용한다.
        //   P2 개인정보 최소화: email/이름/닉네임 매칭·부분 일치·임의 덮어쓰기를 재도입하지 않는다.
        //   미연결(auth_user_id 매핑 없음)이면 'no-link' → 화면은 claim RPC 흐름으로 안내하고
        //   Profile 화면에서 임의 연결하지 않는다. select 는 화면 표시에 쓰는 최소 컬럼만(email 미조회).
        const resolveLinkedMember = async (): Promise<{ member: LinkedMember | null; issue: 'none' | 'no-link' | 'conflict' }> => {
            const { data: byAuth, error: authErr } = await supabase
                .from('members')
                .select(MEMBER_LIST_COLS)
                .eq('auth_user_id', user.id);
            if (authErr) throw authErr;
            if (byAuth && byAuth.length > 1) return { member: null, issue: 'conflict' }; // 동일 auth_user_id 중복 연결
            if (byAuth && byAuth.length === 1) return { member: byAuth[0] as unknown as LinkedMember, issue: 'none' };
            return { member: null, issue: 'no-link' };
        };

        const loadOfficialKdkStats = async () => {
            setKdkLoading(true);
            setKdkError('');
            setMemberLookupDone(false);
            setLinkIssue('none');

            try {
                const { member, issue } = await resolveLinkedMember();
                if (!member) {
                    if (!cancelled) {
                        setLinkedMember(null);
                        setSummary(emptyProfileSummary);
                        setRecentRecords([]);
                        setPlayerCardStats(undefined);
                        setLinkIssue(issue);
                        setMemberLookupDone(true);
                    }
                    return;
                }

                // profile_visibility_level / profile avatar 보강 — auth uid(profiles.id) 기준.
                let profileVisibility: ProfileVisibility | undefined;
                let profileAvatarUrl: string | undefined;
                try {
                    const { data: profileRow } = await supabase
                        .from('profiles')
                        .select('avatar_url, profile_visibility_level')
                        .eq('id', user.id)
                        .maybeSingle();
                    if (profileRow) {
                        profileVisibility = (profileRow.profile_visibility_level as ProfileVisibility) || undefined;
                        profileAvatarUrl = profileRow.avatar_url || undefined;
                    }
                } catch {
                    // profiles 조회 실패는 무시 — public 폴백
                }

                const enrichedMember: LinkedMember = {
                    ...member,
                    profile_visibility_level: profileVisibility ?? member.profile_visibility_level ?? 'public',
                    profile_avatar_url: profileAvatarUrl ?? member.profile_avatar_url,
                };

                // 공식 KDK archive 집계 — teyeon_archive_v1 (archive_type='kdk', is_official=true).
                // member id 우선, exact name fallback은 calculateKdkArchiveStats 내부에서 처리.
                const result = await fetchMemberOfficialStats({
                    id: enrichedMember.id,
                    name: enrichedMember.nickname,
                });

                if (!cancelled) {
                    setLinkedMember(enrichedMember);
                    setSummary(result.summary);
                    setRecentRecords(result.recentRecords);
                    setPlayerCardStats(result.playerCardStats);
                    setLinkIssue('none');
                    setMemberLookupDone(true);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setKdkError(err?.message || '공식 KDK 기록을 불러오지 못했습니다.');
                    setLinkedMember(null);
                    setSummary(emptyProfileSummary);
                    setRecentRecords([]);
                    setPlayerCardStats(undefined);
                    setLinkIssue('none');
                    setMemberLookupDone(true);
                }
            } finally {
                if (!cancelled) setKdkLoading(false);
            }
        };

        loadOfficialKdkStats();

        return () => {
            cancelled = true;
        };
    }, [user?.id]);

    const handleVisibilitySaved = useCallback((level: VisibilityLevel) => {
        setLinkedMember((prev) => prev ? { ...prev, profile_visibility_level: level } : prev);
    }, []);

    const playerCardMember = useMemo<PlayerCardMember | null>(() => {
        if (!linkedMember) return null;
        // 본인 확인은 서버(set_my_profile_visibility RPC)가 auth.uid() 로 수행 — email 불필요.
        //   P2: members.email 을 조회/전달하지 않는다(개인정보 최소화).
        return {
            id: linkedMember.id,
            nickname: linkedMember.nickname,
            role: linkedMember.role || undefined,
            is_admin: linkedMember.is_admin ?? undefined,
            is_guest: linkedMember.is_guest ?? undefined,
            mbti: linkedMember.mbti || undefined,
            affiliation: linkedMember.affiliation || undefined,
            position: linkedMember.position || undefined,
            bio: linkedMember.bio || undefined,
            avatar_url: linkedMember.avatar_url || undefined,
            profile_avatar_url: linkedMember.profile_avatar_url || undefined,
            profile_visibility_level: (linkedMember.profile_visibility_level as VisibilityLevel) || 'public',
        };
    }, [linkedMember]);

    const playerCardAvatar = useMemo<string | undefined>(() => {
        if (!linkedMember) return undefined;
        if (linkedMember.avatar_url) return linkedMember.avatar_url;
        const authAvatar = (user?.user_metadata?.avatar_url || user?.user_metadata?.picture) as string | undefined;
        if (authAvatar) return authAvatar;
        return linkedMember.profile_avatar_url || undefined;
    }, [linkedMember, user?.user_metadata]);

    const visibility: ProfileVisibility = (linkedMember?.profile_visibility_level as ProfileVisibility) || 'public';
    const visMeta = visibilityMeta(visibility);

    const displayName =
        (user?.user_metadata?.nickname as string | undefined) ||
        linkedMember?.nickname ||
        (user?.user_metadata?.full_name as string | undefined) ||
        '';

    const subNameRaw = (user?.user_metadata?.full_name as string | undefined) || user?.email || '';
    // 촬영 모드: 이메일 형태면 마스킹(전화는 프로필에 미표시). 이름(full_name)은 유지.
    const subName = shouldMaskPrivateData && subNameRaw.includes('@') ? maskEmail(subNameRaw) : subNameRaw;
    const roleLabel = role === 'CEO' ? 'CEO' : role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
    const intro = linkedMember?.intro || '매 순간이 챔피언 샷입니다. 🎾';
    const avatarUrl = (user?.user_metadata?.avatar_url || user?.user_metadata?.picture) as string | undefined;

    return (
        <>
        <main
            className="relative w-full font-sans"
            style={{
                minHeight: '100dvh',
                marginBottom: 'calc(-1 * var(--page-bottom-safe))',
                backgroundColor: '#F2F4F7',
                color: '#0F2747',
                boxSizing: 'border-box',
            }}
        >
            <div
                style={{
                    width: '100%', maxWidth: 520, margin: '0 auto',
                    padding: '20px 16px var(--page-bottom-safe)', boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'column', gap: 14,
                }}
            >
                {/* HEADER */}
                <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <p style={{ margin: 0, fontSize: 10, fontWeight: 900, color: '#3B82F6', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
                            TEYEON OFFICIAL RECORD
                        </p>
                        <p style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                            내 프로필
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => signOut?.()}
                        aria-label="로그아웃"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            height: 36, padding: '0 12px', borderRadius: 999,
                            border: '1px solid #DCE8F5', background: '#FFFFFF',
                            color: '#56729A', fontSize: 11, fontWeight: 900,
                            letterSpacing: '0.04em', cursor: 'pointer',
                        }}
                    >
                        <LogOut size={13} />
                        로그아웃
                    </button>
                </header>

                {/* LOADING — 인증 로딩 중 또는 회원 조회 완료 전에는 "회원 연결 없음"을 먼저 보이지 않게 함 */}
                {isLoading || (user && !memberLookupDone) ? (
                    <section
                        style={{
                            borderRadius: 22, background: '#FFFFFF',
                            border: '1px solid #DCE8F5', padding: 22,
                            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                            textAlign: 'center', fontSize: 12, fontWeight: 700,
                            color: '#7A93B3', letterSpacing: '0.1em', textTransform: 'uppercase',
                        }}
                    >
                        Loading...
                    </section>
                ) : !user ? (
                    /* LOGIN REQUIRED */
                    <section
                        style={{
                            borderRadius: 22, background: '#FFFFFF',
                            border: '1px solid #DCE8F5', padding: 40,
                            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                            textAlign: 'center',
                        }}
                    >
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0F2747' }}>
                            로그인이 필요합니다
                        </p>
                        <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: '#56729A' }}>
                            메인 화면에서 카카오 계정으로 로그인해 주세요.
                        </p>
                    </section>
                ) : (
                    <>
                        {/* PROFILE HERO */}
                        <section
                            style={{
                                borderRadius: 24, background: '#FFFFFF',
                                border: '1px solid #DCE8F5', padding: 18,
                                boxShadow: '0 14px 32px rgba(15,45,85,0.07)',
                                display: 'flex', flexDirection: 'column', gap: 14,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                <div
                                    style={{
                                        flexShrink: 0,
                                        padding: 3,
                                        borderRadius: '50%',
                                        background: 'linear-gradient(135deg, #3B82F6 0%, #22B8CF 100%)',
                                        boxShadow: '0 8px 18px rgba(37,99,235,0.22)',
                                    }}
                                >
                                    {avatarUrl ? (
                                        <ProfileAvatar
                                            src={avatarUrl}
                                            alt={displayName || 'Profile'}
                                            size={64}
                                            className="rounded-full border-2 border-white"
                                            fallbackIcon={<InitialAvatar name={displayName} size={60} />}
                                        />
                                    ) : (
                                        <div style={{ background: '#FFFFFF', borderRadius: '50%', padding: 2 }}>
                                            <InitialAvatar name={displayName} size={60} />
                                        </div>
                                    )}
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                        <span
                                            style={{
                                                display: 'inline-flex', alignItems: 'center',
                                                borderRadius: 999, padding: '2px 8px',
                                                background: role === 'CEO' ? '#FFF4DE' : '#EAF3FC',
                                                border: role === 'CEO' ? '1px solid #F4C979' : '1px solid #C7DCF1',
                                                color: role === 'CEO' ? '#B7791F' : '#1F5FB5',
                                                fontSize: 9, fontWeight: 900, letterSpacing: '0.14em',
                                            }}
                                        >
                                            {roleLabel}
                                        </span>
                                        <span
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                                borderRadius: 999, padding: '2px 8px',
                                                background: visMeta.bg, border: `1px solid ${visMeta.border}`,
                                                color: visMeta.color,
                                                fontSize: 9, fontWeight: 900, letterSpacing: '0.06em',
                                            }}
                                        >
                                            <ShieldCheck size={9} />
                                            {visMeta.label}
                                        </span>
                                    </div>
                                    <h1
                                        style={{
                                            margin: 0, fontSize: 18, fontWeight: 900,
                                            color: '#0F2747', letterSpacing: '-0.02em', lineHeight: 1.15,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {displayName || '닉네임 없음'}
                                    </h1>
                                    {subName && subName !== displayName && (
                                        <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#7A93B3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {subName}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <p style={{
                                margin: 0,
                                fontSize: 12.5, fontWeight: 700, lineHeight: 1.55, color: '#3F5B82',
                                wordBreak: 'keep-all',
                            }}>
                                {intro}
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button
                                    type="button"
                                    onClick={() => playerCardMember && setIsPlayerCardOpen(true)}
                                    disabled={!playerCardMember}
                                    style={{
                                        flex: 1, height: 40, borderRadius: 12,
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        background: '#FFFFFF', border: '1px solid #DCE8F5',
                                        color: '#1F5FB5', fontSize: 12, fontWeight: 900,
                                        letterSpacing: '0.02em', cursor: playerCardMember ? 'pointer' : 'not-allowed',
                                        opacity: playerCardMember ? 1 : 0.55,
                                        WebkitTapHighlightColor: 'transparent',
                                    }}
                                >
                                    선수 카드 보기
                                    <ChevronRight size={13} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => playerCardMember && setIsPlayerCardOpen(true)}
                                    disabled={!playerCardMember}
                                    aria-label="프로필 공개 범위 설정"
                                    style={{
                                        flexShrink: 0,
                                        width: 40, height: 40, borderRadius: 12,
                                        background: '#FFFFFF', border: '1px solid #DCE8F5',
                                        color: '#3B5A85',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: playerCardMember ? 'pointer' : 'not-allowed',
                                        opacity: playerCardMember ? 1 : 0.55,
                                    }}
                                >
                                    <Settings size={16} />
                                </button>
                            </div>
                        </section>

                        {kdkError && (
                            <section
                                style={{
                                    borderRadius: 16, background: '#FDEEEE', border: '1px solid #F4C7C7',
                                    padding: '12px 14px',
                                    fontSize: 12, fontWeight: 800, color: '#C0392B',
                                }}
                            >
                                공식 KDK 기록을 불러오지 못했습니다. ({kdkError})
                            </section>
                        )}

                        {memberLookupDone && !linkedMember && (
                            <section
                                style={{
                                    borderRadius: 22, background: '#FFFFFF',
                                    border: '1px solid #DCE8F5', padding: 18,
                                    boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                                }}
                            >
                                <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>
                                    {kdkError
                                        ? '기록을 불러오지 못했습니다'
                                        : linkIssue === 'conflict'
                                            ? '회원 계정 연결 확인이 필요합니다'
                                            : '회원 계정 연결을 확인해 주세요'}
                                </p>
                                <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: '#56729A', lineHeight: 1.55, wordBreak: 'keep-all' }}>
                                    {kdkError
                                        ? '일시적인 오류로 회원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
                                        : linkIssue === 'conflict'
                                            ? '현재 로그인 계정과 TEYEON 회원 정보 연결에 확인이 필요한 상태입니다(중복 또는 충돌). 운영진에게 계정 연결 확인을 요청해 주세요.'
                                            : '현재 로그인 계정과 TEYEON 회원 정보가 연결되지 않았습니다. 실제 회원이라면 운영진에게 계정 연결을 요청해 주세요.'}
                                </p>
                                {!kdkError && (
                                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 12, background: '#F6FAFD', border: '1px solid #DCE8F5' }}>
                                        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, color: '#7A93B3', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                            운영진 전달용 · 로그인 이메일
                                        </p>
                                        <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 800, color: '#0F2747', wordBreak: 'break-all' }}>
                                            {shouldMaskPrivateData ? maskEmail(user?.email || '') : (user?.email || '(이메일 정보 없음)')}
                                        </p>
                                    </div>
                                )}
                            </section>
                        )}

                        {linkedMember && (
                            <>
                                {/* KDK RECORD SUMMARY */}
                                <section
                                    style={{
                                        borderRadius: 22, background: '#FFFFFF',
                                        border: '1px solid #DCE8F5', padding: 18,
                                        boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
                                            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>KDK 기록 요약</h3>
                                        </div>
                                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#7A93B3' }}>
                                            Archive 공식 기록 기준
                                        </span>
                                    </div>

                                    {summary.officialSessionCount === 0 ? (
                                        <div
                                            style={{
                                                padding: '24px 16px', textAlign: 'center',
                                                borderRadius: 16, background: '#F8FBFE', border: '1px dashed #C7DCF1',
                                            }}
                                        >
                                            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F2747' }}>
                                                아직 공식 KDK 기록이 없습니다
                                            </p>
                                            <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 700, color: '#56729A', lineHeight: 1.55 }}>
                                                공식 확정된 Archive 기록이 생기면 이곳에 표시됩니다.
                                            </p>
                                            <Link
                                                href="/archive"
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                                    marginTop: 14, padding: '8px 14px', borderRadius: 999,
                                                    background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                                                    color: '#FFFFFF',
                                                    fontSize: 12, fontWeight: 900, letterSpacing: '0.02em',
                                                    boxShadow: '0 6px 14px rgba(37,99,235,0.22)',
                                                    textDecoration: 'none',
                                                }}
                                            >
                                                Archive 보기
                                                <ChevronRight size={13} />
                                            </Link>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                                <StatTile value={summary.officialSessionCount} unit="회" label="공식 참가" />
                                                <StatTile value={summary.totalMatches} unit="전" label="총 경기" />
                                                <StatTile
                                                    value={summary.totalMatches > 0 ? summary.winRate : '-'}
                                                    unit={summary.totalMatches > 0 ? '%' : ''}
                                                    label="승률"
                                                    valueColor="#1F5FB5"
                                                />
                                                <StatTile
                                                    value={summary.bestRank ?? '-'}
                                                    unit={summary.bestRank ? '위' : ''}
                                                    label="최고 순위"
                                                    valueColor={summary.bestRank && summary.bestRank <= 3 ? '#B7791F' : '#0F2747'}
                                                />
                                                <StatTile
                                                    value={summary.top3Count}
                                                    unit="회"
                                                    label="TOP 3"
                                                    valueColor="#1F5FB5"
                                                />
                                                <StatTile
                                                    value={summary.championCount}
                                                    unit="회"
                                                    label="우승"
                                                    valueColor={summary.championCount > 0 ? '#B7791F' : '#0F2747'}
                                                />
                                            </div>
                                        </>
                                    )}
                                </section>

                                {/* 대회 입상 기록 — 최근 3건 + 전체 보기(연도별 그룹) */}
                                <ProfileAchievements memberId={linkedMember.id} />

                                {/* 승패 / 득실 카드 */}
                                {summary.totalMatches > 0 && (
                                    <section
                                        style={{
                                            borderRadius: 22, background: '#FFFFFF',
                                            border: '1px solid #DCE8F5', padding: 18,
                                            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                                            display: 'flex', flexDirection: 'column', gap: 12,
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                                <span style={{ fontSize: 22, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>
                                                    {summary.wins}
                                                </span>
                                                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#56729A' }}>승</span>
                                                <span style={{ marginLeft: 6, fontSize: 22, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em' }}>
                                                    {summary.losses}
                                                </span>
                                                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#56729A' }}>패</span>
                                            </div>
                                            <span style={{
                                                fontSize: 14, fontWeight: 900,
                                                color: summary.pointDiff > 0 ? '#16A085' : summary.pointDiff < 0 ? '#C0392B' : '#7A93B3',
                                            }}>
                                                득실 {formatSigned(summary.pointDiff)}
                                            </span>
                                        </div>
                                        <div
                                            aria-label="승률 바"
                                            style={{
                                                position: 'relative', height: 8, borderRadius: 999,
                                                background: '#EEF5FB', overflow: 'hidden',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    position: 'absolute', top: 0, bottom: 0, left: 0,
                                                    width: `${summary.winRate}%`,
                                                    background: 'linear-gradient(90deg, #2563EB 0%, #22B8CF 100%)',
                                                    transition: 'width 0.3s ease',
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, color: '#56729A' }}>
                                            <span>{summary.totalMatches}전</span>
                                            <span>승률 {summary.winRate.toFixed(1)}%</span>
                                        </div>
                                    </section>
                                )}

                                {/* RECENT OFFICIAL RECORDS */}
                                {summary.officialSessionCount > 0 && (
                                    <section
                                        style={{
                                            borderRadius: 22, background: '#FFFFFF',
                                            border: '1px solid #DCE8F5', padding: 18,
                                            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
                                                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>최근 공식 기록</h3>
                                                </div>
                                                <p style={{ margin: '4px 0 0 14px', fontSize: 11, fontWeight: 700, color: '#7A93B3' }}>
                                                    미확정·테스트 기록은 개인 기록에 포함되지 않습니다.
                                                </p>
                                            </div>
                                            <Link
                                                href="/archive"
                                                style={{
                                                    flexShrink: 0,
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    padding: '4px 10px', borderRadius: 999,
                                                    background: '#F8FBFE', border: '1px solid #DCE8F5',
                                                    color: '#1F5FB5', fontSize: 11, fontWeight: 900,
                                                    textDecoration: 'none', whiteSpace: 'nowrap',
                                                }}
                                            >
                                                더보기
                                                <ChevronRight size={12} />
                                            </Link>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {recentRecords.map((r) => (
                                                <Link
                                                    key={r.sessionId}
                                                    href={`/archive?session=${r.sessionId}`}
                                                    style={{ textDecoration: 'none', color: 'inherit' }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                                                            borderRadius: 14,
                                                            background: '#F8FBFE', border: '1px solid #E1EAF5',
                                                            padding: '12px 14px',
                                                        }}
                                                    >
                                                        <div style={{ minWidth: 0, flex: 1 }}>
                                                            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 800, color: '#1F5FB5', letterSpacing: '0.08em' }}>
                                                                {r.sessionDate || '날짜 없음'}
                                                            </p>
                                                            <p
                                                                style={{
                                                                    margin: '4px 0 0', fontSize: 13.5, fontWeight: 900, color: '#0F2747',
                                                                    letterSpacing: '-0.01em',
                                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                                }}
                                                            >
                                                                {r.sessionTitle}
                                                            </p>
                                                            <p style={{ margin: '4px 0 0', fontSize: 11, fontWeight: 700, color: '#56729A' }}>
                                                                {r.wins}승 {r.losses}패 · 득실 {formatSigned(r.pointDiff)}
                                                            </p>
                                                        </div>
                                                        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                                            <span
                                                                style={{
                                                                    display: 'inline-flex', alignItems: 'center',
                                                                    borderRadius: 999, padding: '3px 9px',
                                                                    background: r.finalRank && r.finalRank <= 3 ? '#FFF4DE' : '#EEF5FB',
                                                                    border: r.finalRank && r.finalRank <= 3 ? '1px solid #F4C979' : '1px solid #DCE8F5',
                                                                    color: r.finalRank && r.finalRank <= 3 ? '#B7791F' : '#1F5FB5',
                                                                    fontSize: 11, fontWeight: 900,
                                                                }}
                                                            >
                                                                {r.finalRank ? `${r.finalRank}위` : '-'}
                                                            </span>
                                                            <span
                                                                style={{
                                                                    display: 'inline-flex', alignItems: 'center',
                                                                    borderRadius: 999, padding: '2px 7px',
                                                                    background: '#E0F5EB', border: '1px solid #B6E2CB', color: '#16A085',
                                                                    fontSize: 9, fontWeight: 900, letterSpacing: '0.08em',
                                                                }}
                                                            >
                                                                공식 기록
                                                            </span>
                                                        </div>
                                                    </div>
                                                </Link>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                {/* PLAYER CARD PREVIEW (Compact, links to /members) */}
                                <section
                                    style={{
                                        borderRadius: 22, background: '#FFFFFF',
                                        border: '1px solid #DCE8F5', padding: 18,
                                        boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                                        display: 'flex', flexDirection: 'column', gap: 12,
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
                                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>내 선수 카드</h3>
                                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#7A93B3', marginLeft: 'auto' }}>
                                            공식 기록 기준
                                        </span>
                                    </div>

                                    <div
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            borderRadius: 16, background: '#F8FBFE', border: '1px solid #E1EAF5',
                                            padding: 14,
                                        }}
                                    >
                                        {avatarUrl ? (
                                            <ProfileAvatar
                                                src={avatarUrl}
                                                alt={displayName || 'Profile'}
                                                size={48}
                                                className="rounded-full border border-[#DCE8F5]"
                                                fallbackIcon={<InitialAvatar name={displayName} size={48} />}
                                            />
                                        ) : (
                                            <InitialAvatar name={displayName} size={48} />
                                        )}
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {displayName}
                                            </p>
                                            <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#56729A' }}>
                                                {roleLabel}
                                                {summary.officialSessionCount > 0 && <> · 공식 {summary.officialSessionCount}회</>}
                                            </p>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                        <MiniMetric
                                            value={summary.latestRank ?? '-'}
                                            unit={summary.latestRank ? '위' : ''}
                                            label="현재 랭크"
                                        />
                                        <MiniMetric
                                            value={summary.totalMatches > 0 ? summary.winRate : '-'}
                                            unit={summary.totalMatches > 0 ? '%' : ''}
                                            label="승률"
                                        />
                                        <MiniMetric
                                            value={`${summary.wins}/${summary.losses}`}
                                            label="전적"
                                        />
                                    </div>

                                    {(summary.championCount > 0 || summary.top3Count > 0) && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {summary.championCount > 0 && (
                                                <span
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        borderRadius: 999, padding: '4px 10px',
                                                        background: '#FFF4DE', border: '1px solid #F4C979', color: '#B7791F',
                                                        fontSize: 11, fontWeight: 900,
                                                    }}
                                                >
                                                    <Trophy size={11} />
                                                    우승 {summary.championCount}회
                                                </span>
                                            )}
                                            {summary.top3Count > 0 && (
                                                <span
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        borderRadius: 999, padding: '4px 10px',
                                                        background: '#EEF5FB', border: '1px solid #C7DCF1', color: '#1F5FB5',
                                                        fontSize: 11, fontWeight: 900,
                                                    }}
                                                >
                                                    <Sparkles size={11} />
                                                    TOP3 {summary.top3Count}회
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => playerCardMember && setIsPlayerCardOpen(true)}
                                        disabled={!playerCardMember}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                            height: 44, borderRadius: 14,
                                            background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                                            color: '#FFFFFF',
                                            fontSize: 13, fontWeight: 900, letterSpacing: '0.02em',
                                            boxShadow: '0 10px 22px rgba(37,99,235,0.22)',
                                            cursor: playerCardMember ? 'pointer' : 'not-allowed',
                                            opacity: playerCardMember ? 1 : 0.6,
                                            border: 'none',
                                            WebkitTapHighlightColor: 'transparent',
                                        }}
                                    >
                                        선수 카드 자세히 보기
                                        <ChevronRight size={14} />
                                    </button>
                                </section>
                            </>
                        )}

                        {/* PRIVACY / VISIBILITY */}
                        <section
                            style={{
                                borderRadius: 22, background: '#FFFFFF',
                                border: '1px solid #DCE8F5', padding: 18,
                                boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                                display: 'flex', flexDirection: 'column', gap: 12,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
                                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>프로필 공개 범위</h3>
                                </div>
                                <span
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        borderRadius: 999, padding: '4px 10px',
                                        background: visMeta.bg, border: `1px solid ${visMeta.border}`,
                                        color: visMeta.color,
                                        fontSize: 10.5, fontWeight: 900, letterSpacing: '0.04em',
                                    }}
                                >
                                    <Lock size={11} />
                                    {visMeta.label}
                                </span>
                            </div>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, lineHeight: 1.55, color: '#56729A' }}>
                                본인은 항상 전체 기록을 확인할 수 있습니다. 다른 회원에게 보이는 기록은 공개 범위 설정에 따라 달라지며, 일부 기록은 본인만 확인할 수 있습니다.
                            </p>
                            <button
                                type="button"
                                onClick={() => playerCardMember && setIsPlayerCardOpen(true)}
                                disabled={!playerCardMember}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                    height: 44, borderRadius: 14,
                                    background: '#FFFFFF', border: '1px solid #DCE8F5',
                                    color: '#1F5FB5', fontSize: 12.5, fontWeight: 900,
                                    letterSpacing: '0.02em',
                                    cursor: playerCardMember ? 'pointer' : 'not-allowed',
                                    opacity: playerCardMember ? 1 : 0.6,
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                공개 범위 설정 화면 열기
                                <ChevronRight size={13} />
                            </button>
                        </section>
                    </>
                )}
            </div>
        </main>
        {isPlayerCardOpen && playerCardMember && (
            <PlayerCardModal
                member={playerCardMember}
                finalAvatar={playerCardAvatar}
                isOwnCard={true}
                stats={playerCardStats}
                onClose={() => setIsPlayerCardOpen(false)}
                onVisibilitySaved={handleVisibilitySaved}
            />
        )}
        </>
    );
}

// 멤버 프로필 대회 입상 기록 — 최근 3건 + 전체 건수 + 전체 보기(연도별 그룹).
//   데이터는 공개(is_public) 기록만. 사진/파트너/메모 없이 표준 문자열만 표시.
function ProfileAchievements({ memberId }: { memberId: string }) {
    const [list, setList] = useState<MemberAchievement[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchPublicAchievements(memberId)
            .then((rows) => { if (!cancelled) setList(rows); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [memberId]);

    // 기록이 없으면 섹션 자체를 숨긴다(불필요한 빈 카드 방지).
    if (loading || list.length === 0) return null;

    const recent = list.slice(0, 3);
    const groups = groupAchievementsByYear(list);

    const line = (a: MemberAchievement) => {
        const gold = normalizeAchievementResult(a.result) === '우승';
        return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0' }}>
                <span style={{ marginTop: 6, width: 5, height: 5, borderRadius: 999, flexShrink: 0, background: gold ? '#C9A84C' : '#2563EB' }} />
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#0F2747', lineHeight: 1.45, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                    {formatMemberAchievement(a)}
                </p>
            </div>
        );
    };

    return (
        <section
            style={{
                borderRadius: 22, background: '#FFFFFF', border: '1px solid #DCE8F5', padding: 18,
                boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #C9A84C, #B08D2E)', borderRadius: 2 }} />
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>입상 기록</h3>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#8A6D1F', backgroundColor: '#FBF6E7', border: '1px solid #EBDCA6', padding: '3px 10px', borderRadius: 999 }}>
                    {list.length}건
                </span>
            </div>

            {!expanded ? (
                <>
                    <div>{recent.map(line)}</div>
                    {list.length > 3 && (
                        <button
                            type="button"
                            onClick={() => setExpanded(true)}
                            style={{
                                marginTop: 10, width: '100%', height: 38, borderRadius: 11,
                                border: '1px solid #DCE8F5', background: '#F8FBFE', color: '#1F5FB5',
                                fontSize: 12, fontWeight: 900, cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                            }}
                        >
                            전체 입상 보기 <ChevronRight size={13} />
                        </button>
                    )}
                </>
            ) : (
                <>
                    {groups.map((g) => (
                        <div key={String(g.year)} style={{ marginBottom: 12 }}>
                            <p style={{ margin: '0 0 2px', fontSize: 11.5, fontWeight: 900, color: '#1F5FB5', letterSpacing: '0.02em' }}>
                                {g.year ?? '연도 미상'}
                            </p>
                            <div>{g.items.map(line)}</div>
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={() => setExpanded(false)}
                        style={{
                            marginTop: 2, width: '100%', height: 36, borderRadius: 11,
                            border: '1px solid #DCE8F5', background: '#FFFFFF', color: '#56729A',
                            fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        }}
                    >
                        접기
                    </button>
                </>
            )}
        </section>
    );
}

function StatTile({
    value,
    unit,
    label,
    valueColor = '#0F2747',
}: {
    value: number | string;
    unit?: string;
    label: string;
    valueColor?: string;
}) {
    return (
        <div
            style={{
                borderRadius: 14,
                background: '#F8FBFE',
                border: '1px solid #E1EAF5',
                padding: '10px 8px',
                textAlign: 'center',
            }}
        >
            <p
                style={{
                    margin: 0,
                    display: 'inline-flex', alignItems: 'baseline', justifyContent: 'center', gap: 2,
                }}
            >
                <span style={{ fontSize: 20, fontWeight: 900, color: valueColor, letterSpacing: '-0.02em' }}>
                    {value}
                </span>
                {unit && <span style={{ fontSize: 11, fontWeight: 800, color: '#7A93B3' }}>{unit}</span>}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 10.5, fontWeight: 800, color: '#56729A', letterSpacing: '0.02em' }}>
                {label}
            </p>
        </div>
    );
}

function MiniMetric({ value, unit, label }: { value: number | string; unit?: string; label: string }) {
    return (
        <div
            style={{
                borderRadius: 12,
                background: '#FFFFFF',
                border: '1px solid #DCE8F5',
                padding: '10px 6px',
                textAlign: 'center',
            }}
        >
            <p
                style={{
                    margin: 0,
                    display: 'inline-flex', alignItems: 'baseline', justifyContent: 'center', gap: 2,
                }}
            >
                <span style={{ fontSize: 16, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.01em' }}>
                    {value}
                </span>
                {unit && <span style={{ fontSize: 10, fontWeight: 800, color: '#7A93B3' }}>{unit}</span>}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 10, fontWeight: 800, color: '#56729A', letterSpacing: '0.02em' }}>
                {label}
            </p>
        </div>
    );
}
