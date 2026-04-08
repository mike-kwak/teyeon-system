'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { generateKdkMatches, Player as KdkPlayer, Match as KdkMatch } from '@/lib/kdk';
import PremiumSpinner from '@/components/PremiumSpinner';
import { DataStateView } from '@/components/DataStateView';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';

// --- Types & Interfaces ---
interface Member {
    id: string;
    nickname: string;
    role?: string;
    position?: string;
    is_guest?: boolean;
    avatar_url?: string;
    age?: number;
    mbti?: string;
    achievements?: string;
}

type AttendeeConfig = {
    id: string;
    name: string;
    is_guest?: boolean;
    group: 'A' | 'B';
    startTime: string;
    endTime: string;
    isLate?: boolean;
    age?: number;
    isWinner?: boolean;
};

interface Match {
    id: string;
    playerIds: string[];
    court: number | null;
    status: 'waiting' | 'playing' | 'complete';
    score1?: number;
    score2?: number;
    mode: string;
    round?: number;
    teams?: [string[], string[]];
    groupName?: string;
}

type KDKConcept = 'RANDOM' | 'MBTI' | 'AWARD' | 'AGE';

// --- Role Support ---
type UserRole = 'CEO' | 'Staff' | 'Member' | 'Guest';

export default function KDKPage() {
    const router = useRouter();
    const { role, hasPermission, getRestrictionMessage } = useAuth();

    // --- RBAC Protection: KDK is for Staff+ ---
    useEffect(() => {
        if (role === 'GUEST') {
            alert("정회원 이상만 이용 가능한 메뉴입니다. 대시보드로 이동합니다.");
            router.push('/');
        }
    }, [role, router]);

    if (role === 'GUEST') {
        return (
            <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8 z-[1000]">
                <div style={{ width: '80px', height: '80px', borderRadius: '100px', background: 'rgba(212, 175, 55, 0.1)', border: '1px solid rgba(212, 175, 55, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                    <span style={{ fontSize: '32px' }}>🔒</span>
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 900, color: '#fff', fontStyle: 'italic', letterSpacing: '-0.02em', textTransform: 'uppercase', marginBottom: '8px' }}>Access Restricted</h2>
                <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255, 255, 255, 0.3)', textAlign: 'center', lineHeight: '1.6', maxWidth: '240px' }}>{getRestrictionMessage('kdk')}</p>
                <button onClick={() => router.push('/')} style={{ marginTop: '32px', padding: '16px 32px', background: 'rgba(255, 255, 255, 0.05)', color: '#fff', fontSize: '11px', fontWeight: 900, borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Back to Dashboard</button>
            </div>
        );
    }

    const [step, setStep] = useState(1);
    const [allMembers, setAllMembers] = useState<Member[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [tempGuests, setTempGuests] = useState<Member[]>([]);
    const [showGuestInput, setShowGuestInput] = useState(false);
    const [newGuestName, setNewGuestName] = useState("");

    const [sessionId, setSessionId] = useState<string>(() => {
        const d = new Date();
        const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
        return `KDK-${dateStr}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    });
    const [sessionTitle, setSessionTitle] = useState(() => {
        const d = new Date();
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yy}${mm}${dd}_KDK_01`;
    });
    const [matches, setMatches] = useState<Match[]>([]);
    const [activeMatchIds, setActiveMatchIds] = useState<string[]>([]);
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, AttendeeConfig>>({});

    const [genMode, setGenMode] = useState<KDKConcept>('RANDOM');
    const [totalCourts, setTotalCourts] = useState(2);
    const [matchTime, setMatchTime] = useState(30);
    const [fixedPartners, setFixedPartners] = useState<[string, string][]>([]);
    const [fixedTeamMode, setFixedTeamMode] = useState(false);
    const [partnerSelectSource, setPartnerSelectSource] = useState<string | null>(null);
    const [targetGames, setTargetGames] = useState(4);
    const [matchRules, setMatchRules] = useState("1:1 시작, 노에드, 타이 3:3 시작 7포인트 선승");

    const [firstPrize, setFirstPrize] = useState(10000);
    const [bottom25Late, setBottom25Late] = useState(3000);
    const [bottom25Penalty, setBottom25Penalty] = useState(5000);
    const [accountInfo, setAccountInfo] = useState("카카오뱅크 3333-01-5235337 (곽민섭)");
    const [currentTime, setCurrentTime] = useState("");
    const [showScoreModal, setShowScoreModal] = useState<string | null>(null);
    const [tempScores, setTempScores] = useState({ s1: 0, s2: 0 });
    const [showRankingModal, setShowRankingModal] = useState(false);
    const [userRole, setUserRole] = useState<UserRole>('CEO');
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'RANKING'>('MATCHES');
    const [showWarning, setShowWarning] = useState(false);
    const [warningMsg, setWarningMsg] = useState("");

    const [showGuestDataModal, setShowGuestDataModal] = useState(false);
    const [showMemberEditModal, setShowMemberEditModal] = useState(false);
    const [hasSkippedGuestInfo, setHasSkippedGuestInfo] = useState(false);
    const [isMembersLoading, setIsMembersLoading] = useState(true);
    const [isMembersError, setIsMembersError] = useState(false);
    const [showCeremony, setShowCeremony] = useState(false);
    const [spinningMatchId, setSpinningMatchId] = useState<string | null>(null);

    const allMatchesScored = useMemo(() => {
        return matches.length > 0 && matches.every(m => m.status === 'complete');
    }, [matches]);

    // Stage 1: Reveal & Ceremony
    const handleStartCeremony = () => {
        if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
        setActiveTab('RANKING');
        setShowCeremony(true);
        // Auto-scroll to top for the banner
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Stage 2: Official Archive & Shutdown (Admin Only)
    const handleFinalArchive = async () => {
        if (!confirm("🏆 대회를 공식적으로 종료하고 '심층 기록소'에 박제하시겠습니까?\n(라이브 데이터가 삭제되고 아카이브 포털로 즉시 이동합니다.)")) return;

        try {
            setIsGenerating(true);
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0];

            // 1. Snapshot Ranking Data
            const rankingSnapshot = allPlayersInRanking.map(p => {
                const member = (allMembers || []).find(x => x?.id === p.id) || (tempGuests || []).find(x => x?.id === p.id);
                return {
                    id: p.id,
                    name: p.name,
                    wins: p.wins || 0,
                    losses: p.losses || 0,
                    diff: p.diff || 0,
                    avatar: member?.avatar_url || ''
                };
            });

            const sessionRecord = {
                id: sessionId,
                title: sessionTitle || `Tournament ${dateStr}`,
                date: dateStr,
                ranking_data: rankingSnapshot,
                player_metadata: attendeeConfigs,
                total_matches: matches.length,
                total_rounds: (matches.length > 0) ? Math.max(...matches.map(m => m.round || 1)) : 1
            };

            const { error: sessError } = await supabase.from('sessions_archive').upsert([sessionRecord]);
            if (sessError) throw sessError;

            // 2. Cleanup Live Data from Supabase
            const { error: delError } = await supabase.from('matches').delete().eq('session_id', sessionId);
            if (delError) console.error("Cleanup Error (Non-Fatal):", delError);

            // 3. Clear Local State
            actualReset();

            // 4. Redirect to Archive Portal
            router.push(`/archive?session=${sessionId}`);

        } catch (err: any) {
            alert("공식 종료 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGuestDataSave = (id: string, age: number, isWinner: boolean) => {
        setAttendeeConfigs(prev => ({
            ...prev,
            [id]: {
                ...(prev[id] || { id, name: "Unknown", group: 'A', startTime: '19:00', endTime: '22:00' } as any),
                age,
                isWinner
            }
        }));
    };

    const validateGroups = (): { ok: boolean; msg: string } => {
        const attendees = Array.from(selectedIds).map(id => {
            const config = attendeeConfigs[id];
            // If no config found (rare, but possible if newly selected), default to A
            return config?.group || 'A';
        });

        const countA = attendees.filter(g => g === 'A').length;
        const countB = attendees.filter(g => g === 'B').length;

        if (countA > 0 && countA < 4) {
            return { ok: false, msg: "A조 인원이 부족합니다 (최소 4명 필요)" };
        }
        if (countB > 0 && countB < 4) {
            return { ok: false, msg: "B조 인원이 부족합니다 (최소 4명 필요)" };
        }
        if (countA === 0 && countB === 0) {
            return { ok: false, msg: "최소 1명 이상의 참석자가 필요합니다" };
        }

        return { ok: true, msg: "" };
    };

    const handleStep1Confirm = () => {
        const result = validateGroups();
        if (!result.ok) {
            setWarningMsg(result.msg);
            setShowWarning(true);
            return;
        }
        setStep(2);
    };

    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const resetSession = () => {
        // --- 1. Immediate Storage Purge ---
        localStorage.removeItem('kdk_live_session');

        // --- 2. Brutal Page Refresh (Ensures 100% state cleanup) ---
        window.location.reload();

        // (The code below is maintained for semantic completeness, though reload() will execute immediately)
        setMatches([]);
        setActiveMatchIds([]);
        setAttendeeConfigs({});
        setStep(1);
        setFixedPartners([]);
        setFixedTeamMode(false);
        setShowResetConfirm(false);
        setSelectedIds(new Set());
        setTempGuests([]);
        setHasSkippedGuestInfo(false);
        setShowCeremony(false);
        setActiveTab('MATCHES');
    };

    const confirmReset = () => {
        setShowResetConfirm(true);
    };

    const actualReset = () => {
        resetSession();
    };


    const restoreSession = () => {
        try {
            const saved = localStorage.getItem('kdk_live_session');
            if (!saved) return;

            const data = JSON.parse(saved);
            if (data.matches) setMatches(data.matches || []);
            if (data.attendeeConfigs) setAttendeeConfigs(data.attendeeConfigs || {});
            if (data.selectedIds) setSelectedIds(new Set(data.selectedIds || []));
            if (data.tempGuests) setTempGuests(data.tempGuests || []);
            if (data.step) setStep(data.step || 1);
            if (data.sessionTitle) setSessionTitle(data.sessionTitle);
            if (data.sessionId) setSessionId(data.sessionId);

            console.log("Session restored from LocalStorage");
        } catch (e) {
            console.error("Session Restoration Error:", e);
        }
    };

    useEffect(() => {
        fetchMembers();
        restoreSession();

        // Migrate all 18:00 configs to 19:00
        setAttendeeConfigs(prev => {
            const next = { ...prev };
            let changed = false;
            Object.keys(next).forEach(id => {
                if (next[id].startTime === '18:00') {
                    next[id] = { ...next[id], startTime: '19:00' };
                    changed = true;
                }
            });
            return changed ? next : prev;
        });

        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' }));
        }, 1000);

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (selectedIds.size > 0 || step > 1) {
                e.preventDefault();
                e.returnValue = '';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            clearInterval(timer);
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);

    // Save to LocalStorage
    useEffect(() => {
        if (step > 1 || selectedIds.size > 0) {
            const data = {
                matches,
                attendeeConfigs,
                selectedIds: Array.from(selectedIds),
                tempGuests,
                step,
                sessionTitle,
                sessionId
            };
            localStorage.setItem('kdk_live_session', JSON.stringify(data));
        }
    }, [matches, attendeeConfigs, selectedIds, tempGuests, step, sessionTitle, sessionId]);

    // Independent Score Buffer for Active Modal
    useEffect(() => {
        if (showScoreModal && (tempScores.s1 > 0 || tempScores.s2 > 0)) {
            localStorage.setItem(`kdk_score_buffer_${showScoreModal}`, JSON.stringify(tempScores));
        }
    }, [tempScores, showScoreModal]);

    // Restore Score Buffer on Open
    useEffect(() => {
        if (showScoreModal) {
            const saved = localStorage.getItem(`kdk_score_buffer_${showScoreModal}`);
            if (saved) {
                try {
                    setTempScores(JSON.parse(saved));
                } catch (e) { console.error(e); }
            }
        }
    }, [showScoreModal]);

    const fetchMembers = async () => {
        try {
            setIsMembersLoading(true);
            setIsMembersError(false);
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: profile } = await supabase.from('profiles').select('club_role').eq('id', user.id).single();
                if (profile) setUserRole(profile.club_role as UserRole);
            }

            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";

            let query = supabase.from('members').select('*');
            if (clubId) {
                query = query.eq('club_id', clubId);
            }

            const { data, error } = await query.order('nickname');

            if (error) throw error;
            setAllMembers(data || []);
        } catch (err) {
            console.error("Fetch Members Error:", err);
            setIsMembersError(true);
        } finally {
            setIsMembersLoading(false);
        }
    };

    const toggleMember = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
            // Auto-populate attendee config if member has data
            const member = allMembers.find(m => m.id === id);
            if (member && !attendeeConfigs[id]) {
                const isAwardWinner = (member.achievements || '').includes('우승') ||
                    (member.achievements || '').includes('준우승') ||
                    (member.achievements || '').includes('입상');

                setAttendeeConfigs(prev => ({
                    ...prev,
                    [id]: {
                        id,
                        name: member.nickname,
                        group: (member.position || '').toUpperCase().includes('B') ? 'B' : 'A',
                        startTime: '19:00',
                        endTime: '22:00',
                        age: member.age,
                        isWinner: isAwardWinner
                    }
                }));
            }
        }
        setSelectedIds(next);
    };

    const addQuickGuest = () => {
        if (!newGuestName.trim()) return;
        const guest: Member = { id: `g-${Date.now()}`, nickname: newGuestName.trim(), is_guest: true };
        setTempGuests(prev => [...prev, guest]);
        const next = new Set(selectedIds);
        next.add(guest.id);
        setSelectedIds(next);
        setNewGuestName("");
        setShowGuestInput(false);
    };


    const getPlayerName = (id: string) => {
        const m = [...(allMembers || []), ...(tempGuests || [])].find(x => x?.id === id);
        if (!m) return "???";
        // User Requirement: Use Real Names (stored as nickname) strictly. No nicknames/aliases.
        const name = m?.nickname || attendeeConfigs?.[id]?.name || "???";
        const isGuest = m?.is_guest || attendeeConfigs?.[id]?.is_guest;
        return isGuest ? `${name} (G)` : name;
    };

    const generateKDK = async () => {
        // Late Gaming: Permission Check at Final Button
        if (hasPermission('kdk') !== 'WRITE') {
            alert(getRestrictionMessage('kdk'));
            return;
        }

        const result = validateGroups();
        if (!result.ok) {
            setWarningMsg(result.msg);
            setShowWarning(true);
            return;
        }

        const selectedAttendees = Array.from(selectedIds).map(id => {
            const m = allMembers.find(x => x.id === id) || tempGuests.find(x => x.id === id);
            const conf = attendeeConfigs[id] || { group: m?.position || 'A' };
            const group = (conf.group || 'A').toUpperCase().includes('B') ? 'B' : 'A';
            return { id, group };
        });

        const countA = selectedAttendees.filter(a => a.group === 'A').length;
        const countB = selectedAttendees.filter(a => a.group === 'B').length;

        if (countA < 4) {
            setWarningMsg("A조 인원이 부족합니다 (최소 4명 필요)");
            setShowWarning(true);
            return;
        }

        if (countB > 0 && countB < 4) {
            setWarningMsg("B조 인원이 부족합니다 (최소 4명 필요)");
            setShowWarning(true);
            return;
        }

        setIsGenerating(true);
        try {
            const attendees = Array.from(selectedIds).map(id => {
                const m = allMembers.find(x => x.id === id) || tempGuests.find(x => x.id === id);
                const conf = attendeeConfigs[id] || { group: 'A', startTime: '19:00', endTime: '22:00' };
                return {
                    id,
                    name: m?.nickname || "Unknown",
                    group: conf.group,
                    times: [conf.startTime, conf.endTime] as [string, string],
                    isGuest: m?.is_guest,
                    achievements: !!conf.isWinner, // Use actual isWinner flag
                    age: conf.age,
                    mbti: m?.mbti,
                    birthdate: conf.age ? String(new Date().getFullYear() - conf.age) : undefined, // Encode age as birth year for engine
                } as any;
            });

            const groupCourtMap: Record<string, number[]> = {
                'A': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                'B': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            };

            const kdkMatches = generateKdkMatches(attendees, groupCourtMap, targetGames, genMode, fixedPartners, fixedTeamMode);

            // Convert KdkMatch to internal Match
            const formattedMatches: Match[] = kdkMatches.map(km => ({
                id: km.id,
                playerIds: [...km.team1, ...km.team2].map(name => attendees.find(a => a.name === name)?.id || name),
                court: km.court,
                status: 'waiting',
                mode: 'KDK',
                round: km.round,
                teams: [km.team1, km.team2],
                groupName: km.group
            })) as any;

            // ENABLE DB SAVE (Sync Live Matches)
            try {
                const dbMatches = formattedMatches.map(m => ({
                    ...m,
                    club_id: process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819",
                    session_title: sessionTitle || 'Tournament',
                    player_names: m.playerIds.map(pid => getPlayerName(pid))
                }));
                const { error: matchError } = await supabase.from('matches').insert(dbMatches);
                if (matchError) console.warn("Live Match Sync Error:", matchError);
            } catch (err) {
                console.error("Critical Sync Failure:", err);
            }

            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]); // 딩-동!
            setMatches(formattedMatches);
            setStep(3);
        } catch (err: any) {
            console.error(err);
            alert("대진 생성 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const startMatch = async (matchId: string) => {
        // Find lowest available court number
        const inUseCourts = matches.filter(m => m.status === 'playing').map(m => m.court || 0);
        let nextCourt = 1;
        while (inUseCourts.includes(nextCourt)) nextCourt++;

        const nextActive = [...activeMatchIds, matchId];
        const nextMatches = matches.map(m => m.id === matchId ? { ...m, status: 'playing' as const, court: nextCourt } : m);
        setActiveMatchIds(nextActive);
        setMatches(nextMatches);
    };

    const cancelMatch = async (matchId: string) => {
        try {
            if (window.navigator?.vibrate) window.navigator.vibrate(50);
            setSpinningMatchId(matchId); // Start spin feedback

            // 1. Supabase Sync (Update status to waiting and clear court)
            const { error: syncError } = await supabase
                .from('matches')
                .update({ status: 'waiting', court: null })
                .eq('id', matchId)
                .eq('session_id', sessionId);

            if (syncError) console.warn("Cancel match sync error:", syncError);

            // 2. Local State Update
            setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'waiting', court: null } : m));
            setActiveMatchIds(prev => prev.filter(id => id !== matchId));

            setTimeout(() => setSpinningMatchId(null), 500); // 0.5s Fast spin as requested
        } catch (err: any) {
            console.error("Cancel match error:", err);
            setSpinningMatchId(null);
            alert("경기 취소 중 오류가 발생했습니다: " + err.message);
        }
    };

    const updateMatchCourt = (matchId: string) => {
        const courtStr = prompt("변경할 코트 번호를 입력하세요", "1");
        if (courtStr === null) return;
        const courtNum = parseInt(courtStr) || 1;
        setMatches(prev => prev.map(m => m.id === matchId ? { ...m, court: courtNum } : m));
    };

    const syncMatchScore = async (matchId: string) => {
        try {
            if (window.navigator?.vibrate) window.navigator.vibrate(50);
            setSpinningMatchId(matchId);
            const { data, error } = await supabase.from('matches').select('score1, score2').eq('id', matchId).single();
            if (!error && data) {
                setMatches(prev => prev.map(m => m.id === matchId ? { ...m, score1: data.score1 ?? m.score1, score2: data.score2 ?? m.score2 } : m));
                if (showScoreModal === matchId) setTempScores({ s1: data.score1 || 0, s2: data.score2 || 0 });
            }
            setTimeout(() => setSpinningMatchId(null), 1000);
        } catch (err) {
            console.error(err);
            setSpinningMatchId(null);
        }
    };

    const handleMemberEditConfirm = async () => {
        const result = validateGroups();
        if (!result.ok) {
            setWarningMsg(result.msg);
            setShowWarning(true);
            return;
        }

        // Mid-tournament re-generate logic
        const completedMatches = matches.filter(m => m.status === 'complete');
        const activeMatches = matches.filter(m => m.status === 'playing');

        setIsGenerating(true);
        try {
            // Re-map players
            const attendees = Array.from(selectedIds).map(id => {
                const m = allMembers.find(x => x.id === id) || tempGuests.find(x => x.id === id);
                const conf = attendeeConfigs[id] || { group: 'A', startTime: '19:00', endTime: '22:00' };
                return {
                    id,
                    name: m?.nickname || "Unknown",
                    group: conf.group,
                    times: [conf.startTime, conf.endTime] as [string, string],
                    isGuest: m?.is_guest,
                    achievements: !!conf.isWinner,
                    age: conf.age,
                    mbti: m?.mbti,
                    birthdate: conf.age ? String(new Date().getFullYear() - conf.age) : undefined,
                } as any;
            });

            const groupCourtMap: Record<string, number[]> = { 'A': [1, 2, 3, 4, 5, 6], 'B': [1, 2, 3, 4, 5, 6] };

            // DECISION: We keep COMPLETED and PLAYING matches as is.
            // We re-generate only the FUTURE matches.
            const newMatches = generateKdkMatches(
                attendees,
                groupCourtMap,
                targetGames,
                genMode,
                fixedPartners,
                fixedTeamMode,
                [...completedMatches, ...activeMatches] as any
            );

            // Convert to internal format
            const formattedMatches: Match[] = newMatches.map(km => {
                const existing = matches.find(em => em.id === km.id);
                if (existing) return existing; // Keep existing status/score

                return {
                    id: km.id,
                    playerIds: km.playerIds || [],
                    court: km.court,
                    status: 'waiting',
                    mode: 'KDK',
                    round: km.round,
                    score1: 0,
                    score2: 0
                };
            }) as any;

            setMatches(formattedMatches);
            setShowMemberEditModal(false);
        } catch (err: any) {
            alert("대진 재구성 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const finishMatch = async (matchId: string, s1: number, s2: number) => {
        try {
            // 1. Prepare match data for archiving
            const matchToFinish = matches.find(m => m.id === matchId);
            if (!matchToFinish) return;

            // Type Safety: Ensure scores are numbers
            const numS1 = Number(s1);
            const numS2 = Number(s2);

            // Data Sanitization: Exclude internal UI fields like 'teams' (array of arrays) that may fail DB serialization
            const { teams, ...safeMatchData } = matchToFinish as any;

            const pNames = matchToFinish.playerIds?.map(pid => getPlayerName(pid)) || [];
            const finishedMatchData: any = {
                ...safeMatchData,
                score1: numS1,
                score2: numS2,
                status: 'complete',
                player_names: pNames,
                session_title: sessionTitle,
                match_date: new Date().toISOString()
            };

            // 2. Local state update for immediate feedback (MUST HAVE playerIds for UI)
            const nextMatches = matches.map(m => m.id === matchId ? finishedMatchData : m);
            const nextActive = activeMatchIds.filter(id => id !== matchId);
            setMatches(nextMatches);
            setActiveMatchIds(nextActive);
            setShowScoreModal(null);
            if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);

            // 3. Automated Server Archiving: Sanitized for DB
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const matchDateStr = `${yyyy}-${mm}-${dd}`;

            // Deterministic Unique ID for Upsert (Session + Round + Court)
            const deterministicId = `arch-${sessionId}-${matchToFinish.round}-${matchToFinish.court}`;

            const archiveRecord = {
                id: deterministicId, // Use deterministic ID for upsert
                score1: numS1,
                score2: numS2,
                player_names: pNames,
                session_title: sessionTitle || 'Live Match',
                session_id: sessionId,
                match_date: matchDateStr,
                round: matchToFinish.round,
                court: matchToFinish.court,
                player_ids: matchToFinish.playerIds
            };

            // Critical check to see if match exists in live table to move it
            const { data: liveRow } = await supabase.from('matches').select('id').eq('id', matchId).single();

            // UPSERT into Archive (prevents duplicates from concurrent submissions)
            const { error: insError } = await supabase.from('matches_archive').upsert([archiveRecord], { onConflict: 'id' });

            if (insError) {
                console.error("Archive Insert Error:", insError);
                // Enhanced Alert for debugging
                alert(`아카이브 저장 실패: ${insError.message}\n상세: ${JSON.stringify(insError)}`);
                throw insError;
            }

            // Delete from Live if it was there
            if (liveRow) {
                const { error: delError } = await supabase.from('matches').delete().eq('id', matchId);
                if (delError) console.warn("Live Delete Sync Error (Match archived but not deleted from live):", delError);
            }

            // Clear Score Buffer
            localStorage.removeItem(`kdk_score_buffer_${matchId}`);
        } catch (err: any) {
            console.error("Critical Finish Match Failure:", err);
            alert("경기 결과 저장에 실패했습니다: " + (err.message || "Unknown error"));
            // We do NOT revert local state here to avoid confusion, 
            // the user can retry or check the archive later.
        }
    };

    const playerStats = useMemo(() => {
        const res: Record<string, { wins: number, losses: number, diff: number, games: number }> = {};
        matches?.filter(m => m?.status === 'complete')?.forEach(m => {
            m?.playerIds?.forEach((pid, idx) => {
                if (!res[pid]) res[pid] = { wins: 0, losses: 0, diff: 0, games: 0 };
                const isTeam1 = idx < 2;
                const score1 = Number(m?.score1 || 0);
                const score2 = Number(m?.score2 || 0);
                const win = isTeam1 ? (score1 > score2) : (score2 > score1);
                const d = isTeam1 ? (score1 - score2) : (score2 - score1);

                res[pid].games += 1;
                if (win) res[pid].wins += 1;
                else res[pid].losses += 1;
                res[pid].diff += d;
            });
        });
        return res;
    }, [matches]);

    const allPlayersInRanking = useMemo(() => {
        const participantIds = (selectedIds?.size > 0)
            ? Array.from(selectedIds)
            : Array.from(new Set((matches || []).flatMap(m => m?.playerIds || [])));

        return participantIds.map(id => {
            const m = (allMembers || []).find(x => x?.id === id) || (tempGuests || []).find(x => x?.id === id);
            const conf = attendeeConfigs?.[id] || { name: m?.nickname || id, group: 'A', is_guest: m?.is_guest };
            return {
                id,
                name: m?.nickname || id,
                is_guest: m?.is_guest || conf?.is_guest,
                group: conf?.group || 'A',
                age: conf?.age || 0,
                ...(playerStats?.[id] || { wins: 0, losses: 0, diff: 0, games: 0 })
            };
        }).sort((a, b) => (b?.wins || 0) - (a?.wins || 0) || (b?.diff || 0) - (a?.diff || 0));
    }, [playerStats, attendeeConfigs, selectedIds, matches, allMembers, tempGuests]);

    const execCopySchedule = () => {
        if (!matches || matches.length === 0) {
            alert("데이터를 불러오는 중입니다...");
            return;
        }

        // [v3.2 - FINAL REQUESTED TEMPLATE]
        let text = `📌 오늘의 대진표: ${sessionTitle || 'Live Tournament'}\n`;
        text += `⚖️ 규칙: ${matchRules || '1:1 시작, 노에드, 타이 3:3 시작 7포인트 선승'}\n`;
        text += `💰 상벌금: 우승 ${firstPrize.toLocaleString()} / 벌금 ${bottom25Late.toLocaleString()} / 벌금 ${bottom25Penalty.toLocaleString()}\n`;
        text += `━━━━━━━━━━━━━━\n`;
        
        const uniqueGroups = [...new Set(matches.map(m => m.groupName || 'A'))].sort();
        const hasMultipleGroups = uniqueGroups.length > 1;

        uniqueGroups.forEach(group => {
            if (hasMultipleGroups) {
                text += `\n📍 '${group}'조 대진표\n`;
            }
            
            const groupMatches = matches.filter(m => (m.groupName || 'A') === group);
            const rounds = [...new Set(groupMatches.map(m => m.round || 1))].sort((a, b) => a - b);

            rounds.forEach(r => {
                text += `\n📍 ${r}라운드\n`;
                const roundMatches = groupMatches.filter(m => m.round === r).sort((a, b) => (a.id || '').localeCompare(b.id || ''));
                roundMatches.forEach(m => {
                    const teamA = `${getPlayerName(m.playerIds[0])}/${getPlayerName(m.playerIds[1])}`;
                    const teamB = `${getPlayerName(m.playerIds[2])}/${getPlayerName(m.playerIds[3])}`;
                    // STRICT FORMAT: No court, just players
                    text += `${teamA} vs ${teamB}\n`;
                });
            });
            
            if (hasMultipleGroups) {
                text += `\n━━━━━━━━━━━━━━\n`;
            }
        });

        text = text.trim();
        if (!hasMultipleGroups) {
            text += `\n━━━━━━━━━━━━━━`;
        }
        text += `\n※ 상세 결과 확인: https://teyeon-system.vercel.app/kdk`;
        
        console.log("Copied Match Schedule v3.2 (No Courts, No '지각')");
        navigator.clipboard.writeText(text);
        alert("실시간 대진표가 클립보드에 복사되었습니다! ✅");
    };

    const copyFinalResults = () => {
        if (!matches || matches.length === 0) {
            alert("데이터를 불러오는 중입니다...");
            return;
        }

        let text = `🏆 오늘의 최종 결과: ${sessionTitle || 'Live Tournament'}\n`;
        text += `🏦 계좌: ${accountInfo}\n`;
        text += `━━━━━━━━━━━━━━\n\n`;

        const sortedPlayers = [...allPlayersInRanking];
        const totalCount = sortedPlayers.length;

        // Logical Settlement Rules (MBTI/AGE/RANDOM Consistency)
        const bottomHalfCount = Math.ceil(totalCount / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const fineCount = bottomHalfCount - penaltyCount;

        sortedPlayers.forEach((p, i) => {
            const originalRank = i + 1;
            let rankPrefix = (originalRank === 1) ? '🥇 ' : (originalRank === 2) ? '🥈 ' : (originalRank === 3) ? '🥉 ' : `${originalRank}위 `;

            const isPenaltyTier = i >= (totalCount - penaltyCount);
            const isFineTier = !isPenaltyTier && i >= (totalCount - bottomHalfCount);

            let prizePenaltyText = '';
            if (originalRank === 1 && !p.is_guest) {
                prizePenaltyText = ` [💰 +${firstPrize.toLocaleString()}원]`;
            } else if (isPenaltyTier) {
                prizePenaltyText = ` [💸 -${bottom25Penalty.toLocaleString()}원]`;
            } else if (isFineTier) {
                prizePenaltyText = ` [💸 -${bottom25Late.toLocaleString()}원]`;
            } else {
                prizePenaltyText = ` [0원]`;
            }

            text += `${rankPrefix}${p.name}${p.is_guest ? ' (G)' : ''}: ${p.wins}승 ${p.losses}패${prizePenaltyText}\n`;
        });

        text += `\n━━━━━━━━━━━━━━\n`;
        text += `※ 전체 아카이브 확인: https://teyeon-system.vercel.app/archive?session=${sessionId}`;

        navigator.clipboard.writeText(text);
        alert("최종 결과 및 정산 현황이 복사되었습니다! ✅");
    };

    function addMinutesToTime(time: string, mins: number) {
        const [h, m] = time.split(':').map(Number);
        const total = h * 60 + m + mins;
        const nh = Math.floor(total / 60) % 24;
        const nm = total % 60;
        return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
    }

    const busyPlayerIds = new Set(matches.filter(m => m.status === 'playing').flatMap(m => m.playerIds || []));

    // --- Step 1: Attendee Selection ---
    if (step === 1) {
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative">




                <header className="grid grid-cols-3 px-6 mb-1 items-center h-12">
                    <div className="flex items-center">
                        <ManualRecoveryButton
                            onRestore={(data) => {
                                setMatches(data.matches || []);
                                setAttendeeConfigs(data.attendeeConfigs || {});
                                setSelectedIds(new Set(data.selectedIds || []));
                                setTempGuests(data.tempGuests || []);
                                setStep(data.step || 1);
                                setSessionTitle(data.sessionTitle || "");
                                if (data.settings?.finance) {
                                    setFirstPrize(data.settings.finance.firstPrize);
                                    setBottom25Late(data.settings.finance.bottom25Late);
                                    setBottom25Penalty(data.settings.finance.bottom25Penalty);
                                    setAccountInfo(data.settings.finance.accountInfo);
                                }
                            }}
                        />
                    </div>

                    <div className="text-center flex flex-col items-center">
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-1 inline-block leading-none scale-90">Step 01</span>
                        <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">참석자 확정</h1>
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={() => setShowResetConfirm(true)}
                            className="h-9 px-3 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group"
                            title="전체 데이터 초기화"
                        >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                            <span className="text-[9px] font-black uppercase tracking-tighter">초기화</span>
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-2 no-scrollbar" style={{ paddingBottom: '240px' }}>



                    <DataStateView
                        isLoading={isMembersLoading}
                        isError={isMembersError}
                        onRetry={fetchMembers}
                        loadingComponent={
                            <div className="grid grid-cols-3 gap-2">
                                {[...Array(12)].map((_, i) => <Skeleton key={i} size="lg" />)}
                            </div>
                        }
                    >
                        <section className="space-y-4">
                            <div className="grid grid-cols-3 gap-x-3 gap-y-6 py-1">
                                {[...allMembers, ...tempGuests].map(m => {
                                    const isSelected = selectedIds.has(m.id);
                                    const isGuest = m.is_guest || m.id.startsWith('guest-');
                                    return (
                                        <div
                                            key={m.id}
                                            onClick={() => toggleMember(m.id)}
                                            className={`h-22 rounded-[24px] border-2 transition-all flex flex-col items-center justify-center cursor-pointer text-center px-1
                                            ${isSelected
                                                    ? 'bg-[#C9B075] border-white/20 text-black shadow-[0_10px_25px_rgba(201,176,117,0.4)] scale-100 z-10'
                                                    : 'bg-[#1A1A1A] border-white/5 text-white/90 hover:bg-white/10 hover:border-white/10 scale-95 opacity-80 shadow-lg'}`}
                                        >
                                            <span className="text-[15px] font-bold break-keep leading-tight px-1 drop-shadow-sm">
                                                {m.nickname}{isGuest ? ' (G)' : ''}
                                            </span>
                                            {isGuest && <span className={`text-[8px] font-black uppercase mt-1 ${isSelected ? 'text-black/60' : 'text-[#C9B075]'}`}>Guest</span>}
                                        </div>
                                    );
                                })}

                                {showGuestInput ? (
                                    <div className="h-20 rounded-2xl border border-[#C9B075] bg-black/40 px-2 flex items-center gap-1 animate-in zoom-in-95">
                                        <input
                                            autoFocus
                                            value={newGuestName}
                                            onChange={(e) => setNewGuestName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') addQuickGuest();
                                                if (e.key === 'Escape') setShowGuestInput(false);
                                            }}
                                            placeholder="이름"
                                            className="w-full bg-transparent text-sm font-black text-[#C9B075] outline-none text-center"
                                        />
                                        <button onClick={() => addQuickGuest()} className="text-[#C9B075] font-black px-1">↵</button>
                                    </div>
                                ) : (
                                    <button onClick={() => setShowGuestInput(true)} className="h-20 rounded-2xl border-2 border-dashed border-[#C9B075]/40 bg-[#C9B075]/5 text-[#C9B075] flex flex-col items-center justify-center active:scale-95 hover:bg-[#C9B075]/10 hover:border-[#C9B075]/60 transition-all group">
                                        <span className="text-3xl font-bold group-hover:scale-125 transition-transform text-[#C9B075] leading-none mb-1">+</span>
                                        <span className="text-[9px] font-black uppercase tracking-tighter text-[#C9B075]">ADD GUEST</span>
                                    </button>
                                )}
                            </div>
                        </section>
                    </DataStateView>



                </div>


                <div className="fixed bottom-[120px] left-1/2 -translate-x-1/2 w-full max-w-[480px] px-6 z-[70] pointer-events-none">
                    <div className="relative">
                        <div className="absolute inset-x-0 -inset-y-4 bg-gradient-to-t from-[#121212] via-[#121212]/80 to-transparent backdrop-blur-md rounded-[40px] -z-10" />

                        <button
                            onClick={handleStep1Confirm}
                            style={{
                                width: '100%',
                                padding: '8px 0',
                                borderRadius: '999px',
                                background: '#C9B075',
                                color: '#000000',
                                border: '1px solid rgba(255, 255, 255, 0.4)',
                                fontSize: '14px',
                                fontWeight: 1000,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                WebkitTextFillColor: '#000000',
                                transition: 'all 0.15s',
                                boxShadow: '0 10px 30px rgba(201,176,117,0.4)',
                            }}
                            className="active:scale-95 pointer-events-auto"
                        >
                            참석자 확정 및 설정 ➡️
                        </button>
                    </div>
                </div>

                {showResetConfirm && (
                    <CustomConfirmModal
                        title="초기화 확인"
                        message="모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다."
                        onConfirm={actualReset}
                        onCancel={() => setShowResetConfirm(false)}
                    />
                )}
                {showWarning && (
                    <WarningModal
                        message={warningMsg}
                        onClose={() => setShowWarning(false)}
                    />
                )}
            </main>
        );
    }

    // --- Step 2: Settings Dashboard ---
    // FORCE_REBUILD_v28: 2026-04-07T12:35:00Z
    if (step === 2) {
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];
        const availablePlayersForPartnering = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id) && !fixedPartners.flat().includes(m.id));

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative pb-60" style={{ paddingBottom: "160px" }}>





                <header className="grid grid-cols-3 px-6 mb-4 items-center h-12 shrink-0">
                    <div className="flex items-center">
                        <button
                            onClick={() => setStep(1)}
                            className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-95 transition-all text-white/60 hover:text-white"
                        >
                            <span className="text-xl">←</span>
                        </button>
                    </div>

                    <div className="text-center flex flex-col items-center">
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-1 inline-block leading-none scale-90">Step 02</span>
                        <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">경기 대진 설정</h1>
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={() => setShowResetConfirm(true)}
                            className="h-9 px-3 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group"
                            title="전체 데이터 초기화"
                        >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                            <span className="text-[9px] font-black uppercase tracking-tighter">초기화</span>
                        </button>
                    </div>
                </header>

                <div className="px-6 space-y-12 max-w-lg mx-auto w-full">


                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" />
                            <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Archive Title</h3>
                        </div>
                        <input
                            type="text"
                            value={sessionTitle}
                            onChange={(e) => setSessionTitle(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-[24px] px-6 py-5 text-sm font-black text-white focus:border-[#C9B075]/50 focus:bg-white/[0.08] transition-all outline-none"
                            placeholder="Ex: 2026-03-27 테연 정기전"
                        />
                    </section>


                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px' }}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-[13px] font-bold text-[#C9B075] tracking-[0.3em] uppercase flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                ATTENDEE MATRIX
                            </h3>
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{attendees.length} ACTIVE</span>
                        </div>
                        <div className="space-y-2 no-scrollbar" style={{ maxHeight: '480px', overflowY: 'auto' }}>
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                return (
                                    <div key={m.id} style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '20px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

                                        <span style={{ fontSize: '14px', fontWeight: 900, color: 'rgba(255,255,255,0.9)' }}>
                                            {m.name}{m.is_guest ? ' (G)' : ''}
                                        </span>

                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, isLate: !config.isLate } }))}
                                                    style={{ width: '32px', height: '32px', borderRadius: '10px', border: config.isLate ? '1px solid #f97316' : '1px solid rgba(255,255,255,0.1)', background: config.isLate ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '16px' }}
                                                >🕒</button>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0A0A0A', borderRadius: '12px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '13px', fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: '46px', cursor: 'pointer' }}>
                                                        {timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}
                                                    </select>
                                                    <span style={{ color: '#6B7280', fontSize: '10px', fontWeight: 700 }}>TO</span>
                                                    <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '13px', fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: '46px', cursor: 'pointer' }}>
                                                        {timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}
                                                    </select>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))}
                                                    style={{ width: '40px', height: '40px', borderRadius: '12px', background: config.group === 'A' ? '#C9B075' : '#0A0A0A', color: config.group === 'A' ? '#000' : '#fff', border: config.group === 'A' ? 'none' : '1px solid #555', fontWeight: 900, fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
                                                >A</button>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))}
                                                    style={{ width: '40px', height: '40px', borderRadius: '12px', background: config.group === 'B' ? '#C9B075' : '#0A0A0A', color: config.group === 'B' ? '#000' : '#fff', border: config.group === 'B' ? 'none' : '1px solid #555', fontWeight: 900, fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.15s' }}
                                                >B</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>


                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px' }}>
                        <div className="space-y-6">
                            <h4 className="text-[13px] font-bold text-[#C9B075] uppercase tracking-[0.3em] flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                CORE STRATEGY
                            </h4>
                            <div className="grid grid-cols-2 gap-4" style={{ marginTop: '20px' }}>
                                {(['RANDOM', 'AGE', 'AWARD', 'MBTI'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setGenMode(mode)}
                                        style={{
                                            background: '#141414',
                                            border: genMode === mode ? '1px solid #C9B075' : '1px solid #2A2A2A',
                                            color: genMode === mode ? '#C9B075' : '#6B7280',
                                            transform: genMode === mode ? 'scale(1.03)' : 'scale(1)',
                                            borderRadius: '24px',
                                            padding: '24px 8px',
                                            fontSize: '14px',
                                            fontWeight: 1000,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        {mode === 'RANDOM' ? 'RANDOM' : mode === 'AGE' ? 'YB/OB' : mode === 'AWARD' ? '입상/비입상' : 'MBTI'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-6 mt-10">
                            <div className="flex items-center justify-between">
                                <h4 className="text-[13px] font-bold text-[#C9B075] uppercase tracking-[0.3em] flex items-center gap-3">
                                    <span className="w-2 h-2 rounded-full bg-[#C9B075]" />
                                    FIXED PARTNERS
                                </h4>
                                <button
                                    onClick={() => setFixedTeamMode(!fixedTeamMode)}
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: '99px',
                                        fontSize: '12px',
                                        fontWeight: 800,
                                        border: fixedTeamMode ? '1px solid #C9B075' : '1px solid rgba(255,255,255,0.3)',
                                        background: fixedTeamMode ? '#C9B075' : 'transparent',
                                        color: fixedTeamMode ? '#000' : 'rgba(255,255,255,0.7)',
                                        cursor: 'pointer',
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase'
                                    }}
                                >
                                    {fixedTeamMode ? 'TEAM MODE' : 'ROUND 1 ONLY'}
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                                {fixedPartners.map((pair, idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '20px 24px', borderRadius: '24px', border: '1px solid #2A2A2A' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '15px', fontWeight: 1000, color: '#FFFFFF' }}>
                                            <span>{getPlayerName(pair[0])}</span>
                                            <span style={{ color: '#C9B075', fontSize: '18px' }}>♥</span>
                                            <span>{getPlayerName(pair[1])}</span>
                                        </div>
                                        <button onClick={() => setFixedPartners(prev => prev.filter((_, i) => i !== idx))} className="w-10 h-10 rounded-full bg-[#1C1C1C] flex items-center justify-center text-red-500/50 hover:bg-red-500/20 hover:text-red-500 transition-all text-2xl leading-none">×</button>
                                    </div>
                                ))}
                                <button
                                    onClick={() => setPartnerSelectSource('NEW')}
                                    style={{
                                        width: '100%', padding: '14px 0',
                                        border: '1px dashed #555',
                                        borderRadius: '20px',
                                        fontSize: '13px',
                                        fontWeight: 900,
                                        color: '#A0A0A0',
                                        background: '#141414',
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                        transition: 'all 0.15s'
                                    }}
                                >
                                    + ADD FIXED PARTNER
                                </button>
                            </div>
                        </div>
                    </section>


                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '28px 24px', marginTop: '12px', overflow: 'visible' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <h4 style={{ fontSize: '13px', fontWeight: 900, color: '#C9B075', textTransform: 'uppercase', letterSpacing: '0.3em', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C9B075', flexShrink: 0, display: 'inline-block' }} />
                                CONSTRAINTS
                            </h4>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#D1D5DB', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Courts</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setTotalCourts(Math.max(1, totalCourts - 1))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#C9B075', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{totalCourts}</span>
                                    <button onClick={() => setTotalCourts(totalCourts + 1)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#D1D5DB', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Match Mins</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setMatchTime(Math.max(30, matchTime - 30))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#C9B075', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{matchTime}</span>
                                    <button onClick={() => setMatchTime(matchTime + 30)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginTop: '24px' }}>
                            <h4 style={{ fontSize: '13px', fontWeight: 900, color: '#4ADE80', textTransform: 'uppercase', letterSpacing: '0.3em', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ADE80', flexShrink: 0, display: 'inline-block' }} />
                                FINANCIALS
                            </h4>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <span style={{ fontSize: '13px', fontWeight: 800, color: '#D1D5DB', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prize Gold</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setFirstPrize(Math.max(0, firstPrize - 5000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#ffffff', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(firstPrize / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setFirstPrize(firstPrize + 5000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#FACC15', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tier 1 Fine</span>
                                    <span style={{ fontSize: '10px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bottom 25%~50%</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setBottom25Late(Math.max(0, bottom25Late - 1000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#ffffff', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(bottom25Late / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Late(bottom25Late + 1000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#141414', padding: '0 20px', height: '80px', borderRadius: '20px', border: '1px solid #222' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tier 2 Fine</span>
                                    <span style={{ fontSize: '10px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Bottom 0%~25%</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '160px', height: '40px' }}>
                                    <button onClick={() => setBottom25Penalty(Math.max(0, bottom25Penalty - 1000))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>−</button>
                                    <span style={{ fontSize: '28px', fontWeight: 900, color: '#ffffff', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px', flex: 'none' }}>{(bottom25Penalty / 1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Penalty(bottom25Penalty + 1000)} style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>+</button>
                                </div>
                            </div>
                        </div>


                        <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #333' }}>
                            <h4 style={{ fontSize: '13px', fontWeight: 900, color: '#C9B075', textTransform: 'uppercase', letterSpacing: '0.3em', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#C9B075', flexShrink: 0, display: 'inline-block' }} />
                                TOURNAMENT RULES
                            </h4>
                            <textarea
                                value={matchRules}
                                onChange={(e) => setMatchRules(e.target.value)}
                                style={{ width: '100%', background: '#141414', border: '1px solid #333', borderRadius: '16px', padding: '16px', fontSize: '14px', fontWeight: 600, color: '#E5E7EB', minHeight: '120px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6 }}
                                placeholder="토너먼트 규칙을 입력하세요..."
                            />
                        </div>
                    </section>



                </div>



                <div style={{ position: 'fixed', bottom: '120px', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '450px', padding: '0 20px', zIndex: 9999, pointerEvents: 'none', boxSizing: 'border-box' }}>
                    <div style={{ width: '100%', margin: '0 auto', pointerEvents: 'auto' }}>
                        <button
                            disabled={isGenerating}
                            onClick={generateKDK}
                            style={{
                                width: '100%',
                                padding: '8px 0',
                                borderRadius: '999px',
                                background: isGenerating ? '#1A1A1A' : '#C9B075',
                                color: '#000000',
                                border: '1px solid rgba(255, 255, 255, 0.4)',
                                fontSize: '14px',
                                fontWeight: 1000,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                cursor: isGenerating ? 'not-allowed' : 'pointer',
                                WebkitTextFillColor: '#000000',
                                transition: 'all 0.15s',
                                boxShadow: '0 10px 30px rgba(201,176,117,0.4)',
                            }}
                        >
                            {isGenerating ? 'GENERATE...' : '최종 대진 자동 생성! 🚀'}
                        </button>
                    </div>
                </div>


                {partnerSelectSource && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                        <div style={{ background: '#1C1C1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '32px', width: '100%', maxWidth: '400px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontSize: '11px', fontWeight: 900, color: '#C9B075', letterSpacing: '0.4em', textTransform: 'uppercase', marginBottom: '6px' }}>Strategy</div>
                                    <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#ffffff', margin: 0, letterSpacing: '-0.02em' }}>SELECT PARTNER</h3>
                                </div>
                                <button onClick={() => setPartnerSelectSource(null)} style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '360px', overflowY: 'auto' }}>
                                {availablePlayersForPartnering.map(p => {
                                    const isSelected = partnerSelectSource !== 'NEW' && partnerSelectSource === p.id;
                                    return (
                                        <button
                                            key={p.id}
                                            onClick={() => {
                                                if (partnerSelectSource === 'NEW') {
                                                    setPartnerSelectSource(p.id);
                                                } else {
                                                    setFixedPartners(prev => [...prev, [partnerSelectSource as string, p.id]]);
                                                    setPartnerSelectSource(null);
                                                }
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '16px 20px',
                                                borderRadius: '16px',
                                                background: isSelected ? '#C9B075' : '#252525',
                                                border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.08)',
                                                color: isSelected ? '#000' : '#fff',
                                                fontSize: '16px', fontWeight: 800,
                                                cursor: 'pointer',
                                                transition: 'all 0.15s',
                                                textAlign: 'left'
                                            }}
                                        >
                                            <span>{p.nickname}{p.is_guest ? ' (G)' : ''}</span>
                                            <span style={{ fontSize: '11px', fontWeight: 600, color: isSelected ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{p.is_guest ? 'GUEST' : 'MEMBER'}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <p style={{ textAlign: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0 }}>
                                {partnerSelectSource === 'NEW' ? '첫 번째 플레이어를 선택하세요' : (allMembers.find(x => x.id === partnerSelectSource)?.nickname + (allMembers.find(x => x.id === partnerSelectSource)?.is_guest ? ' (G)' : '')) + '의 파트너를 선택하세요'}
                            </p>
                        </div>
                    </div>
                )}

                {showWarning && (
                    <WarningModal
                        message={warningMsg}
                        onClose={() => setShowWarning(false)}
                    />
                )}
            </main>
        );
    }

    // --- Step 3: Live Dashboard ---
    const activeMatchForScore = showScoreModal ? matches.find(m => m.id === showScoreModal) : null;

    return (
        <main className="flex flex-col min-h-screen bg-gradient-to-br from-[#0a0a0b] via-[#121214] to-[#0a0a0b] text-white font-sans w-full relative pb-60" style={{ paddingBottom: "160px" }}>
            <header className="px-6 pt-4 flex items-center justify-between gap-4 mb-2 h-12">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowResetConfirm(true)}
                        className="h-10 px-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                        title="전체 데이터 초기화"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        <span className="text-[10px] font-black uppercase tracking-tighter">초기화</span>
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={execCopySchedule} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20" title="대진표 공유">📋</button>
                    <button onClick={copyFinalResults} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20" title="결과 보고">🏆</button>
                </div>
            </header>

            <div
                className="w-full border-y border-white/10 px-5 flex flex-col gap-3 relative z-10"
                style={{ paddingTop: '24px', paddingBottom: '24px', marginBottom: '0px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(24px)', boxShadow: '0 10px 30px rgba(0,0,0,0.6)' }}
            >
                {/* LINE 1: SESSION & WIN/PEN */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest shrink-0 [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">SESSION:</span>
                        <span className="text-[10px] font-bold text-white truncate uppercase tracking-tighter drop-shadow-sm">{sessionTitle || '260407_KDK_01'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest leading-none [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">WIN:</span>
                            <span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none drop-shadow-sm">10K</span>
                        </div>
                        <div className="mx-1.5 w-px h-2 bg-white/10" />
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest leading-none [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">PEN:</span>
                            <span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none drop-shadow-sm">3~5K</span>
                        </div>
                        <button onClick={() => setShowMemberEditModal(true)} className="ml-1 text-[#C9B075]/60 hover:text-[#C9B075] text-[10px] hover:scale-110 transition-transform active:scale-90">⚙️</button>
                    </div>
                </div>
                
                {/* LINE 2: RULES */}
                <div className="flex items-center gap-1.5 pt-2 border-t border-white/5">
                    <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest shrink-0 [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">RULES:</span>
                    <span className="text-[10px] font-bold text-white tracking-tighter leading-tight italic uppercase truncate drop-shadow-sm">
                        1:1 시작, 노에드, 타이 3:3 (7포인트 선승)
                    </span>
                </div>
            </div>

            <div className="flex-1 px-4 space-y-0 overflow-y-auto pb-60 no-scrollbar antialiased" style={{ background: '#0f1115' }}>
                {activeTab === 'MATCHES' ? (
                    <>
                        <section className="h-auto" style={{ marginTop: '0px', position: 'relative', zIndex: 10 }}>
                            <div className="flex flex-col" style={{ marginBottom: '16px' }}>
                                <div className="flex items-center gap-3 ml-2">
                                    <h2 className="text-2xl font-black italic tracking-tighter uppercase text-white">NOW PLAYING</h2>
                                    {activeMatchIds.length > 0 && (
                                        <span className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-[10px] font-black tracking-widest uppercase border border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                            {activeMatchIds.length} LIVE
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 h-1.5 w-48 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" />
                            </div>

                            {activeMatchIds.length === 0 ? (
                                <div className="py-16 text-center text-white/20 border border-dashed border-white/10 rounded-2xl text-[12px] uppercase font-black tracking-widest">Waiting for next round...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-5 mt-4">
                                    {activeMatchIds.map((mId) => {
                                        const m = matches.find(x => x.id === mId);
                                        if (!m) return null;

                                        const allMatchesInGroupSorted = matches.filter(mx => {
                                            const p0 = mx.playerIds[0];
                                            const pGroup = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                            const nGroup = (pGroup || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                            return nGroup === (m.groupName || 'A');
                                        }).sort((a, b) => {
                                            if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                            return a.id.localeCompare(b.id);
                                        });
                                        const matchNo = allMatchesInGroupSorted.findIndex(x => x.id === m.id) + 1;
                                        const normalizedGroup = m.groupName || 'A';

                                        return (
                                            <div key={mId} className="rounded-[32px] p-2 relative flex flex-col justify-between h-full group transition-all" style={{ transform: 'none', background: 'rgba(255, 255, 255, 0.07)', backdropFilter: 'blur(64px)', border: 'none', borderTop: '2px solid rgba(255, 255, 255, 0.1)', borderLeft: '1px solid rgba(255, 255, 255, 0.05)', boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.2), 0 20px 50px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.5), 0 30px 60px -15px rgba(0, 255, 255, 0.08)' }}>

                                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 flex-grow">

                                                    {/* TEAM A BLOCK */}
                                                    <div className="relative bg-white/5 rounded-[18px] h-20 pt-12 flex flex-col items-center justify-center border border-white/5 w-full overflow-hidden">
                                                        {/* GROUP-MATCH ID BADGE (BRUSHED GOLD MEDAL) */}
                                                        <div className={`absolute top-1 left-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-[#8E7A4A] via-[#A89462] to-[#8E7A4A] text-black text-[10px] font-black flex items-center justify-center shadow-[0_0_10px_rgba(142,122,74,0.2)] z-10 whitespace-nowrap border border-white/10`}>
                                                            {normalizedGroup}·G{matchNo}
                                                        </div>
                                                        <span className="text-white/90 text-[13px] font-black text-center leading-normal relative z-0 truncate w-full px-2">
                                                            {getPlayerName(m.playerIds[0])}<br />{getPlayerName(m.playerIds[1])}
                                                        </span>
                                                    </div>

                                                    {/* Central VS */}
                                                    <div className="text-[#C9B075] font-black text-[8px] uppercase text-center italic opacity-60 drop-shadow-[0_0_5px_rgba(201,176,117,0.3)]">vs</div>

                                                    {/* TEAM B BLOCK */}
                                                    <div className="relative bg-white/5 rounded-[18px] h-20 pt-12 flex flex-col items-center justify-center border border-white/5 w-full overflow-hidden">
                                                        {/* BLUE ROLLBACK UTILITY (Symmetrical to Left Badge) */}
                                                        <button
                                                            type="button"
                                                            onClick={() => cancelMatch(mId)}
                                                            className="absolute top-2 right-2 w-7 h-7 bg-blue-500/10 text-blue-500 rounded-lg border border-blue-500/20 flex items-center justify-center transition-all z-30 active:scale-90 hover:bg-blue-500/20 focus:outline-none"
                                                            title="웨이팅 리스트로 복귀"
                                                        >
                                                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className={`pointer-events-none ${spinningMatchId === mId ? 'animate-spin' : ''}`}><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                                                        </button>
                                                        <span className="text-white/90 text-[13px] font-black text-center leading-normal relative z-0 truncate w-full px-2">
                                                            {getPlayerName(m.playerIds[2])}<br />{getPlayerName(m.playerIds[3])}
                                                        </span>
                                                    </div>

                                                </div>

                                                {/* SCORE INPUT BUTTON (REFINED METALLIC OUTLINE) */}
                                                <button
                                                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setTempScores({ s1: m.score1 ?? 1, s2: m.score2 ?? 1 }); setShowScoreModal(mId); }}
                                                    className="w-full h-12 bg-transparent border border-[#8E7A4A]/40 hover:bg-[#8E7A4A]/25 active:scale-95 transition-all rounded-2xl flex items-center justify-center mt-3 shrink-0"
                                                    style={{ background: 'linear-gradient(to right, rgba(142,122,74,0.1), transparent, rgba(142,122,74,0.1))', boxShadow: '0 0 15px rgba(142,122,74,0.2), inset 0 0 10px rgba(142,122,74,0.1)', filter: 'drop-shadow(0 0 10px rgba(142,122,74,0.3))' }}
                                                >
                                                    <span className="bg-gradient-to-r from-[#8E7A4A] via-[#A89462] to-[#8E7A4A] bg-clip-text text-transparent text-[12px] font-black uppercase tracking-[0.25em] [text-shadow:0_0_15px_rgba(142,122,74,0.3)]">SCORE INPUT 🏆</span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                        <div style={{ marginTop: '64px' }}>
                            {(() => {
                                const waitingMatches = matches.filter(m => m.status === 'waiting');
                                if (waitingMatches.length === 0) return (
                                    <div className="py-10 text-center opacity-10 text-[10px] uppercase font-black tracking-widest border border-dashed border-white/5 rounded-[32px]">No Matches in Queue</div>
                                );

                                return ['A', 'B'].map(group => {
                                    const groupMatches = waitingMatches.filter(m => {
                                        const p0 = m.playerIds[0];
                                        const p0Group = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                        const normalizedGroup = (p0Group || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                        return normalizedGroup === group;
                                    }).sort((a, b) => {
                                        if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                        return a.id.localeCompare(b.id);
                                    });

                                    if (groupMatches.length === 0) return null;

                                    return (
                                        <div key={group} className="space-y-3">
                                            <div className="flex flex-col" style={{ marginBottom: '16px', marginTop: '64px' }}>
                                                <h3 className="text-2xl font-black italic tracking-tighter uppercase text-white ml-2">WAITING LIST</h3>
                                                <div className="mt-2 h-1.5 w-48 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" />
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                {groupMatches.map((m) => {
                                                    const allMatchesInGroupSorted = matches.filter(mx => {
                                                        const p0 = mx.playerIds[0];
                                                        const pGroup = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                                        const nGroup = (pGroup || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                                        return nGroup === group;
                                                    }).sort((a, b) => {
                                                        if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                                        return a.id.localeCompare(m.id);
                                                    });
                                                    const matchNo = allMatchesInGroupSorted.findIndex(x => x.id === m.id) + 1;
                                                    const busyPlayers = m.playerIds.filter(pid => busyPlayerIds.has(pid));
                                                    const hasConflict = busyPlayers.length > 0;

                                                    return (
                                                        <div key={m.id} className="rounded-2xl active:scale-98 transition-all relative group grid grid-cols-[50px_1fr_80px] items-center overflow-hidden" style={{ transform: 'none', paddingLeft: '16px', paddingRight: '16px', paddingTop: '24px', paddingBottom: '24px', background: 'rgba(255, 255, 255, 0.07)', backdropFilter: 'blur(64px)', border: 'none', borderTop: '2px solid rgba(255, 255, 255, 0.1)', borderLeft: '1px solid rgba(255, 255, 255, 0.05)', boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.2), 0 20px 50px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.5), 0 30px 60px -15px rgba(0, 255, 255, 0.08)', filter: 'drop-shadow(0 0 10px rgba(142,122,74,0.2))' }}>
                                                            <div className="flex items-center justify-center">
                                                                <div className="w-9 h-9 bg-gradient-to-br from-[#8E7A4A] via-[#A89462] to-[#8E7A4A] text-black rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(142,122,74,0.2)] shrink-0 border border-white/20">
                                                                    <span className="text-[12px] font-black uppercase">G{matchNo}</span>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center justify-center gap-4 text-center px-2">
                                                                <span className="flex-1 text-white text-[17px] font-bold truncate leading-none">{getPlayerName(m.playerIds[0])}/{getPlayerName(m.playerIds[1])}</span>
                                                                <span className="text-[#C9B075] text-[10px] font-black uppercase italic tracking-widest opacity-20 shrink-0">vs</span>
                                                                <span className="flex-1 text-white text-[17px] font-bold truncate leading-none">{getPlayerName(m.playerIds[2])}/{getPlayerName(m.playerIds[3])}</span>
                                                            </div>

                                                            <div className="flex items-center justify-end pr-2">
                                                                <button
                                                                    disabled={hasConflict}
                                                                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); startMatch(m.id); }}
                                                                    className={`px-6 py-3.5 rounded-2xl text-[13px] font-black uppercase transition-all shadow-xl whitespace-nowrap active:scale-95 ${hasConflict ? 'bg-zinc-800 text-white/5 cursor-not-allowed' : '!bg-[#8E7A4A] !text-black hover:bg-[#72623B] shadow-[0_4px_15px_rgba(142,122,74,0.2)]'}`}
                                                                    style={{ backgroundColor: hasConflict ? undefined : '#8E7A4A', color: hasConflict ? undefined : '#000000' }}
                                                                >
                                                                    투입 🚀
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {matches.some(m => m.status === 'complete') && (
                            <div style={{ marginTop: '64px' }}>
                                <h3 className="text-2xl font-black italic tracking-tighter uppercase text-white ml-2">COMPLETED MATCHES</h3>
                                <div className="mt-2 h-1.5 w-48 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" style={{ marginBottom: '16px' }} />
                                <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                                    {matches.filter(m => m.status === 'complete').sort((a, b) => {
                                        const gA = a.groupName || 'A';
                                        const gB = b.groupName || 'A';
                                        if (gA !== gB) return gA.localeCompare(gB);
                                        const groupMatchesSorted = matches.filter(mx => mx.groupName === gA).sort((x, y) => (x.round || 0) - (y.round || 0) || x.id.localeCompare(y.id));
                                        return groupMatchesSorted.findIndex(x => x.id === a.id) - groupMatchesSorted.findIndex(x => x.id === b.id);
                                    }).map(m => {
                                        const groupMatchesSorted = matches.filter(mx => mx.groupName === (m.groupName || 'A')).sort((a, b) => {
                                            if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                            return a.id.localeCompare(b.id);
                                        });
                                        const gMatchNo = groupMatchesSorted.findIndex(x => x.id === m.id) + 1;

                                        return (
                                            <div key={m.id} onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setShowScoreModal(m.id); }} className="rounded-xl transition-all active:scale-98 relative overflow-hidden group" style={{ transform: 'none', padding: '12px', background: 'rgba(255, 255, 255, 0.07)', backdropFilter: 'blur(64px)', border: 'none', borderTop: '2px solid rgba(255, 255, 255, 0.1)', borderLeft: '1px solid rgba(255, 255, 255, 0.05)', boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.2), 0 20px 50px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.5), 0 30px 60px -15px rgba(0, 255, 255, 0.08)' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: '8px', width: '100%' }}>
                                                    <div className="px-2 py-0.5 rounded-md bg-[#C9B075]/20 text-[#C9B075] text-[10px] font-black border border-[#C9B075]/30 tracking-tighter uppercase self-center">
                                                        {m.groupName || 'A'}-G{gMatchNo}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0px' }}>
                                                        <span className="text-sm font-black text-white/60 whitespace-nowrap truncate text-right leading-tight uppercase" style={{ flex: 1, paddingRight: '4px' }}>{getPlayerName(m.playerIds[0])}<br />{getPlayerName(m.playerIds[1])}</span>
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '50px', flexShrink: 0 }}>
                                                            <span className="text-lg font-black text-[#C9B075]">{m.score1}:{m.score2}</span>
                                                        </div>
                                                        <span className="text-sm font-black text-white/60 whitespace-nowrap truncate text-left leading-tight uppercase" style={{ flex: 1, paddingLeft: '4px' }}>{getPlayerName(m.playerIds[2])}<br />{getPlayerName(m.playerIds[3])}</span>
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'center', marginTop: '4px' }}>
                                                    <span className="text-[6px] font-black text-gray-300 uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity">Tap to edit</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="pb-40">
                        <RankingView
                            sessionMatches={matches}
                            configs={attendeeConfigs}
                            allPlayers={allPlayersInRanking}
                            allMembers={allMembers}
                            tempGuests={tempGuests}
                            sessionId={sessionId}
                            sessionTitle={sessionTitle}
                            actualReset={actualReset}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty, account: accountInfo }}
                            copyMatchTable={execCopySchedule}
                            copyFinalResults={copyFinalResults}
                            ceremonyMode={showCeremony}
                            onFinalize={handleFinalArchive}
                            isGenerating={isGenerating}
                            isAdmin={role === 'CEO'}
                        />
                    </div>
                )}
            </div>

            <nav className="fixed bottom-24 bg-white/5 backdrop-blur-2xl border border-white/10 shadow-[0_20px_100px_rgba(0,0,0,0.8)] left-1/2 -translate-x-1/2 rounded-[32px] p-2 w-[94%] max-w-[440px] flex items-center justify-between gap-3 z-[90]">
                <button
                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab('MATCHES'); }}
                    className={`flex-1 rounded-[24px] py-6 flex items-center justify-center gap-5 transition-all active:scale-95 uppercase tracking-tighter ${activeTab === 'MATCHES' ? 'bg-[#C9B075]/10 text-[#C9B075] font-black text-[22px] shadow-[0_0_20px_rgba(201,176,117,0.2),inset_0_0_10px_rgba(201,176,117,0.1)] border border-[#C9B075]/30' : 'text-white/40 font-bold text-[20px] hover:text-white/60'}`}
                >
                    🔥 MATCHES
                </button>
                <button
                    onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab('RANKING'); }}
                    className={`flex-1 rounded-[24px] py-6 flex items-center justify-center gap-5 transition-all active:scale-95 uppercase tracking-tighter ${activeTab === 'RANKING' ? 'bg-white/10 text-white font-black text-[22px] shadow-[0_0_20px_rgba(255,255,255,0.05)] border border-white/20' : 'text-white/40 font-bold text-[20px] hover:text-white/60'}`}
                >
                    📊 RANKING
                </button>
            </nav>


            {allMatchesScored && step === 3 && activeTab === 'MATCHES' && (
                <div className="fixed bottom-[200px] left-1/2 -translate-x-1/2 w-full max-w-[450px] px-6 z-[60] animate-in slide-in-from-bottom-10 fade-in duration-500">
                    <button
                        onClick={handleStartCeremony}
                        className="w-full py-5 bg-gradient-to-r from-[#C9B075] to-[#B8860B] text-black font-bold rounded-full shadow-[0_20px_60px_rgba(212,175,55,0.4)] active:scale-95 transition-all text-[13px] tracking-[0.2em] uppercase flex items-center justify-center gap-3 border border-white/20 animate-pulse"
                    >
                        <span>🏆 즉시 순위 및 축하 화면 보러가기</span>
                    </button>
                </div>
            )}

            {showRankingModal && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-black/98 backdrop-blur-2xl">
                    <header className="p-6 border-b border-white/5 flex items-center justify-between bg-[#14141F]">
                        <h2 className="text-xl font-black italic tracking-tighter text-white">LIVE LEADERBOARD</h2>
                        <button onClick={() => setShowRankingModal(false)} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-xl text-white">×</button>
                    </header>
                    <div className="flex-1 overflow-y-auto p-4">
                        <RankingView
                            sessionMatches={matches}
                            configs={attendeeConfigs}
                            allPlayers={allPlayersInRanking}
                            allMembers={allMembers}
                            tempGuests={tempGuests}
                            sessionId={sessionId}
                            sessionTitle={sessionTitle}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty, account: accountInfo }}
                            copyMatchTable={execCopySchedule}
                            copyFinalResults={copyFinalResults}
                            ceremonyMode={showCeremony}
                            onFinalize={handleFinalArchive}
                            isGenerating={isGenerating}
                            isAdmin={role === 'CEO'}
                        />
                    </div>
                </div>
            )}

            {activeMatchForScore && (
                <div className="fixed inset-0 z-[200] flex items-end justify-center">
                    <div className="absolute inset-0 bg-black/95 backdrop-blur-xl" onClick={() => setShowScoreModal(null)}></div>
                    <div className="relative w-full max-w-lg bg-white/5 backdrop-blur-2xl border-t border-white/20 rounded-t-[40px] p-8 pb-10 shadow-[0_-20px_100px_rgba(0,0,0,0.8)] animate-in slide-in-from-bottom duration-300">
                        <header className="flex flex-col items-center gap-2 mb-8 text-center px-4">
                            <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.4em] uppercase">Set Final Result</span>
                            <div className="mt-2 py-2 px-6 bg-[#C9B075]/20 rounded-2xl border border-[#C9B075]/30">
                                <h3 className="text-xl font-black italic text-white tracking-tight uppercase">🏆 WINNER SELECTION</h3>
                            </div>
                        </header>
                        <div className="grid grid-cols-2 gap-8 mb-10">
                            {[0, 1].map(side => (
                                <div key={side} className="flex flex-col gap-4">
                                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest text-center truncate">{getPlayerName(activeMatchForScore.playerIds[side * 2])} & {getPlayerName(activeMatchForScore.playerIds[side * 2 + 1])}</span>
                                    <div className="text-5xl font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent text-center mb-2 drop-shadow-[0_0_15px_rgba(201,176,117,0.4)]">{side === 0 ? tempScores.s1 : tempScores.s2}</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[0, 1, 2, 3, 4, 5, 6].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => {
                                                    if (window.navigator?.vibrate) window.navigator.vibrate(50); // 탁!
                                                    const val = Math.min(6, Math.max(0, n));
                                                    setTempScores(p => side === 0 ? ({ ...p, s1: val }) : ({ ...p, s2: val }));
                                                }}
                                                className={`h-12 rounded-xl text-lg font-black transition-all ${(side === 0 ? tempScores.s1 : tempScores.s2) === n ? 'bg-[#C9B075] text-black scale-105 shadow-[0_0_15px_rgba(201,176,117,0.4)]' : 'bg-white/5 text-white/30 border border-white/5'}`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowScoreModal(null)} className="flex-1 py-5 bg-white/5 border border-white/10 text-white/60 font-black rounded-full uppercase text-xs tracking-widest active:scale-95 transition-all">Cancel</button>
                            <button disabled={tempScores.s1 === tempScores.s2} onClick={() => finishMatch(activeMatchForScore.id, tempScores.s1, tempScores.s2)} className="flex-[2] py-5 bg-[#C9B075] text-black font-black rounded-full uppercase text-xs tracking-widest shadow-xl disabled:opacity-20 active:scale-95 transition-all font-black border border-white/20">Confirm Score 🏆</button>
                        </div>
                    </div>
                </div>
            )}

            {showMemberEditModal && (
                <div className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-2xl flex flex-col p-6 overflow-hidden">
                    <header className="flex items-center justify-between mb-8 border-b border-white/10 pb-6">
                        <div className="flex flex-col">
                             <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.4em] uppercase mb-1">Live Management</span>
                             <h2 className="text-2xl font-black italic text-white uppercase tracking-tighter">참석자 수시 수정</h2>
                        </div>
                        <button onClick={() => setShowMemberEditModal(false)} className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-white/20 text-3xl hover:bg-white/10 transition-colors">×</button>
                    </header>
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                        <section className="space-y-4">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">Toggle Active Players</h3>
                            <div className="grid grid-cols-4 gap-3">
                                {[...allMembers, ...tempGuests].map(m => {
                                    const isSelected = selectedIds.has(m.id);
                                    const isBusy = busyPlayerIds.has(m.id);
                                    return (
                                        <div
                                            key={m.id}
                                            onClick={() => {
                                                if (isBusy) {
                                                    alert("현재 경기 중인 선수는 기권 처리할 수 없습니다. 경기가 끝난 후 조정해 주세요.");
                                                    return;
                                                }
                                                toggleMember(m.id);
                                            }}
                                            className={`h-16 rounded-2xl border transition-all flex flex-col items-center justify-center cursor-pointer text-center px-1
                                            ${isSelected
                                                    ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-lg scale-105'
                                                    : 'bg-white/[0.05] border-white/10 text-white/40'}
                                            ${isBusy ? 'opacity-30 border-dashed cursor-not-allowed' : ''}`}
                                        >
                                            <span className="text-[10px] font-black truncate w-full px-1">{m.nickname}</span>
                                            {isBusy && <span className="text-[6px] font-bold text-red-500 uppercase">Busy</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                        <p className="text-[10px] font-bold text-white/30 leading-relaxed uppercase tracking-widest text-center italic">
                            💡 선수를 추가하거나 제거하면, <br />아직 투입되지 않은 모든 자동 대진이 다시 생성됩니다.
                        </p>
                    </div>
                    <div className="mt-8">
                        <button
                            disabled={isGenerating}
                            onClick={handleMemberEditConfirm}
                            className={`w-full py-5 rounded-full font-black text-xs uppercase tracking-[0.2em] shadow-2xl ${isGenerating ? 'bg-white/10 text-white/10' : 'bg-[#C9B075] text-black'}`}
                        >
                            {isGenerating ? '대진 재구성 중...' : '💾 실시간 인원 변경사항 적용'}
                        </button>
                    </div>
                </div>
            )}

            {showResetConfirm && (
                <CustomConfirmModal
                    title="대진표 초기화"
                    message="현재 진행 중인 모든 대진과 선택된 멤버 정보를 삭제하고 처음부터 다시 시작하시겠습니까?"
                    onConfirm={actualReset}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}
            {showWarning && (
                <WarningModal
                    message={warningMsg}
                    onClose={() => setShowWarning(false)}
                />
            )}
        </main>
    );
}

function ManualRecoveryButton({ onRestore }: { onRestore: (data: any) => void }) {
    const [hasSession, setHasSession] = useState(false);
    useEffect(() => {
        const saved = localStorage.getItem('kdk_live_session');
        if (saved) setHasSession(true);
    }, []);

    if (!hasSession) return null;

    return (
        <button
            onClick={() => {
                const saved = localStorage.getItem('kdk_live_session');
                if (saved) {
                    try {
                        const data = JSON.parse(saved);
                        onRestore(data);
                    } catch (e) { console.error(e); }
                }
            }}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all active:scale-95 group whitespace-nowrap"
        >
            <span className="text-[12px] group-hover:scale-110 transition-transform grayscale group-hover:grayscale-0">📂</span>
            <span>이전 데이터 불러오기</span>
        </button>
    );
}

function GuestDataModal({ guests, configs, onSave, onClose }: { guests: any[], configs: Record<string, AttendeeConfig>, onSave: (id: string, age: number, isWinner: boolean) => void, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={onClose}></div>
            <div className="relative w-full max-w-md bg-white/5 border border-white/10 rounded-[40px] p-8 shadow-[0_20px_100px_rgba(0,0,0,0.8)] space-y-6 max-h-[90vh] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom-8 backdrop-blur-2xl">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.4em] uppercase mb-1">Guest Registry</span>
                        <h3 className="text-xl font-black italic text-white tracking-tighter uppercase">게스트 상세 정보</h3>
                    </div>
                    <button onClick={onClose} className="text-white/20 text-3xl">×</button>
                </div>

                <div className="space-y-4">
                    {guests.map(g => {
                        const conf = configs[g.id] || {};
                        return (
                            <div key={g.id} className="bg-white/5 border border-white/10 rounded-3xl p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-black text-white/90">{g.name}</span>
                                    <span className="text-[8px] font-black bg-[#C9B075]/20 text-[#C9B075] uppercase tracking-[0.2em] border border-[#C9B075]/30 px-2 py-1 rounded-full">Guest</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-white/30 uppercase tracking-widest">Age (나이)</label>
                                        <input
                                            type="number"
                                            placeholder="나이"
                                            value={conf.age || ''}
                                            onChange={(e) => onSave(g.id, parseInt(e.target.value) || 0, !!conf.isWinner)}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm font-black text-white outline-none focus:border-[#C9B075]/50 transition-colors"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-white/30 uppercase tracking-widest">Winner? (입상여부)</label>
                                        <button
                                            onClick={() => onSave(g.id, conf.age || 0, !conf.isWinner)}
                                            className={`w-full py-3 rounded-xl border font-black text-[10px] tracking-widest transition-all active:scale-95 ${conf.isWinner ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-lg shadow-[#C9B075]/20' : 'bg-white/5 border-white/10 text-white/20'}`}
                                        >
                                            {conf.isWinner ? '🏆 YES (OB)' : 'NO (YB)'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="pt-4">
                    <button
                        onClick={onClose}
                        className="w-full py-5 bg-gradient-to-r from-[#C9B075] to-[#B8860B] text-black font-black rounded-2xl shadow-2xl active:scale-95 transition-all text-sm uppercase tracking-[0.2em] border border-white/20"
                    >
                        Save & Continue ➡️
                    </button>
                </div>
            </div>
        </div>
    );
}


function ArchiveSection({ onLoad }: { onLoad: (session: any) => void }) {
    const [archives, setArchives] = useState<any[]>([]);
    useEffect(() => {
        supabase.from('matches_archive').select('*').order('created_at', { ascending: false }).limit(5)
            .then(({ data }) => { if (data) setArchives(data); });
    }, []);

    const handleLoad = (raw: any) => {
        const session = {
            id: raw.id,
            title: raw.title,
            ...(raw.data || {})
        };
        onLoad(session);
    };

    if (archives.length === 0) return null;
    return (
        <section className="space-y-4">
            <h3 className="text-[10px] font-black text-white/30 tracking-[0.3em] uppercase px-2 flex items-center gap-2">📦 Load History</h3>
            <div className="space-y-2">
                {archives.map(a => (
                    <button key={a.id} onClick={() => handleLoad(a)} className="w-full bg-white/[0.03] border border-white/5 p-4 rounded-[20px] flex items-center justify-between group hover:border-[#C9B075]/30 transition-all text-left">
                        <div className="flex flex-col"><span className="text-xs font-black text-white/60">{a.note?.startsWith('{') ? JSON.parse(a.note).title : a.note}</span><span className="text-[8px] font-bold text-white/20 uppercase">{new Date(a.created_at).toLocaleDateString()}</span></div>
                        <span className="text-[10px] font-black text-[#C9B075]">OPEN →</span>
                    </button>
                ))}
            </div>
        </section>
    );
}

function RankingView({ sessionMatches, configs, prizes, allPlayers: players, allMembers, tempGuests, sessionId, sessionTitle, actualReset, copyMatchTable, copyFinalResults, ceremonyMode, onFinalize, isGenerating, isAdmin }: any) {
    const [sortKey, setSortKey] = useState<string>('rk');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    // Confetti / Particle State (Simple CSS-based)
    const [showConfetti, setShowConfetti] = useState(false);
    useEffect(() => {
        if (ceremonyMode) {
            setShowConfetti(true);
            const timer = setTimeout(() => setShowConfetti(false), 5000);
            return () => clearTimeout(timer);
        }
    }, [ceremonyMode]);

    const toggleSort = (key: string) => {
        if (sortKey === key) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'age' ? 'asc' : 'desc'); // Default to youngest first for age, desc for others
        }
    };

    const calculateSettlement = (p: any, idx: number, total: number) => {
        let amount = 0;
        let note = "";

        const isWinner = idx === 0 && !p.is_guest;

        // Bottom 50% split logic:
        // Total players = T
        // Bottom group size B = ceil(T/2)
        // Penalty group P (Tier 2) = ceil(B/2)
        // Fine group F (Tier 1) = B - P
        const bottomHalfCount = Math.ceil(total / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const fineCount = bottomHalfCount - penaltyCount;

        const isPenaltyTier = idx >= (total - penaltyCount); // Very bottom
        const isFineTier = !isPenaltyTier && idx >= (total - bottomHalfCount); // Next bottom

        let performancePenalty = 0;
        if (isWinner) {
            performancePenalty = prizes.first || 10000;
            note = `👑 우승 (+${(performancePenalty / 1000).toFixed(0)}k)`;
        } else if (isPenaltyTier) {
            performancePenalty = -(prizes.l2 || 5000);
            note = `📉 벌금 (-${(Math.abs(performancePenalty) / 1000).toFixed(0)}k)`;
        } else if (isFineTier) {
            performancePenalty = -(prizes.l1 || 3000);
            note = `📉 벌금 (-${(Math.abs(performancePenalty) / 1000).toFixed(0)}k)`;
        }

        if (p.is_guest) {
            amount = -5000 + performancePenalty;
            note = performancePenalty !== 0
                ? `❗ 게스트(-5k) + ${note.split(' ')[1]}`
                : "❗ 게스트 (-5,000)";
        } else {
            amount = performancePenalty;
        }

        return { amount, note, isWinner, isPenaltyTier, isFineTier };
    };

    const generatePlayerList = (filterGroup?: string) => {
        return players
            .filter((p: any) => !filterGroup || p.group === filterGroup);
    };

    const getSortedPlayers = (pList: any[]) => {
        const sorted = [...(pList || [])].map((p, i) => ({ ...p, rk: i + 1 }));
        return sorted.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];

            if (sortKey === 'rk') {
                valA = a.rk;
                valB = b.rk;
            }

            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const hasGroups = Object.values(configs).some((c: any) => c.group === 'B');

    const getPlayerNameLocal = (id: string) => {
        const p = (players || []).find((x: any) => x?.id === id);
        if (!p) return "???";
        return p?.is_guest ? `${p.name} (G)` : p.name;
    };

    const RankingTable = ({ players, title }: { players: any[], title: string }) => (
        <section className="space-y-4 mb-8">
            <div className="flex flex-col mb-2">
                <h3 className="text-[12px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.3em] uppercase px-4 flex items-center justify-between">
                    <span>{title}</span>
                    <span className="text-white/20 text-[9px]">{players.length} Players</span>
                </h3>
                <div className="mt-1 h-px w-24 ml-4 bg-gradient-to-r from-[#C9B075]/30 to-transparent" />
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-[32px] overflow-hidden overflow-x-auto shadow-2xl">
                <table className="min-w-[600px] w-full text-[10px] border-collapse">
                    <thead>
                        <tr className="bg-white/5 text-white/40 font-black uppercase tracking-tighter text-[11px] border-b border-white/5">
                            <th onClick={() => toggleSort('rk')} className="py-5 px-4 text-center w-10 cursor-pointer hover:text-white transition-colors">Rk {sortKey === 'rk' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('name')} className="py-5 px-2 text-left cursor-pointer hover:text-white transition-colors">Player {sortKey === 'name' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th className="py-5 px-1 text-center">Fine</th>
                            <th onClick={() => toggleSort('diff')} className="py-5 px-1 text-center cursor-pointer hover:text-white transition-colors">Diff {sortKey === 'diff' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('age')} className="py-5 px-1 text-center cursor-pointer hover:text-[#C9B075] transition-colors text-[#C9B075]/60">Age {sortKey === 'age' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('wins')} className="py-5 px-1 text-center cursor-pointer hover:text-white transition-colors">W {sortKey === 'wins' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('losses')} className="py-5 px-1 text-center cursor-pointer hover:text-white transition-colors">L {sortKey === 'losses' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th className="py-5 px-1 text-center">Gm</th>
                            <th className="py-5 px-4 text-right">Note</th>
                        </tr>
                    </thead>
                    <tbody className="text-[13px]">
                        {getSortedPlayers(players).map((p) => {
                            const originalIdx = players.findIndex((x: any) => x.id === p.id);
                            const { amount, note, isWinner, isPenaltyTier, isFineTier } = calculateSettlement(p, originalIdx, players.length);
                            const isBottom = isPenaltyTier || isFineTier;
                            return (
                                <tr key={p.id} className={`border-t border-white/5 last:border-0 hover:bg-white/[0.04] transition-all ${isWinner ? 'bg-[#C9B075]/10' : isBottom ? 'bg-red-500/[0.02]' : ''}`}>
                                    <td className={`py-5 px-4 text-center font-black italic ${isWinner ? 'text-[#C9B075] text-lg [text-shadow:0_0_10px_rgba(201,176,117,0.5)]' : isBottom ? 'text-red-500/40' : 'text-white/20'}`}>
                                        {isWinner ? '👑' : players.findIndex((x: any) => x.id === p.id) + 1}
                                    </td>
                                    <td className="py-5 px-2">
                                        <div className="flex flex-col">
                                            <span className={`font-bold ${isWinner ? 'text-[#C9B075] text-base font-black' : 'text-white'}`}>{p.name} {p.is_guest ? '(G)' : ''}</span>
                                            {isWinner && <span className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest leading-none mt-0.5">Tournament MVP</span>}
                                        </div>
                                    </td>
                                    <td className={`py-5 px-1 text-center font-black text-xs ${amount > 0 ? 'text-[#4ADE80]' : amount < 0 ? 'text-red-500' : 'text-white/20'}`}>
                                        {amount !== 0 ? `${amount > 0 ? '+' : ''}${amount.toLocaleString()}` : '-'}
                                    </td>
                                    <td className={`py-5 px-1 text-center font-black ${p.diff > 0 ? 'text-white' : 'text-white/40'}`}>
                                        {p.diff > 0 ? `+${p.diff}` : p.diff}
                                    </td>
                                    <td className="py-5 px-1 text-center font-bold text-white/40">{p.age || '-'}</td>
                                    <td className="py-5 px-1 text-center font-bold text-[#4ADE80]">{p.wins}</td>
                                    <td className="py-5 px-1 text-center font-bold text-red-500/60">{p.losses}</td>
                                    <td className="py-5 px-1 text-center font-bold text-white/20">{p.games}</td>
                                    <td className="py-5 px-4 text-right font-black text-[10px] whitespace-nowrap">
                                        <span className={`px-2 py-1 rounded-lg ${amount > 0 ? 'bg-[#C9B075]/20 text-[#C9B075] border border-[#C9B075]/30' : amount < 0 ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'text-white/20'}`}>
                                            {note || '-'}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );

    const finalizeTournament = async () => {
        if (!confirm("모든 경기를 정산하고 이번 대진표를 아카이브에 최종 저장하시겠습니까?\n(랭킹과 상세 기록이 심층 기록소로 안전하게 이관됩니다.)")) return;

        try {
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200]);

            // 1. Archival Snapshot (Ranking, Metadata, etc.)
            const today = new Date();
            const dateStr = today.toISOString().split('T')[0];

            const rankingSnapshot = players.map((p: any) => {
                const member = (allMembers || []).find((x: any) => x?.id === p.id) || (tempGuests || []).find((x: any) => x?.id === p.id);
                return {
                    id: p.id,
                    name: p.name,
                    wins: p.wins || 0,
                    losses: p.losses || 0,
                    diff: p.diff || 0,
                    avatar: member?.avatar_url || ''
                };
            });

            const sessionRecord = {
                id: sessionId,
                title: sessionTitle || `Tournament ${dateStr}`,
                date: dateStr,
                ranking_data: rankingSnapshot,
                player_metadata: configs,
                total_matches: sessionMatches.length,
                total_rounds: (sessionMatches.length > 0) ? Math.max(...sessionMatches.map((m: any) => m.round || 1)) : 1
            };

            const { error: archiveError } = await supabase.from('sessions_archive').upsert([sessionRecord]);
            if (archiveError) throw archiveError;

            // 2. Celebration/Confirmation
            alert("🏆 토너먼트가 성공적으로 정산되었습니다!\n전체 경기와 최종 순위가 '심층 기록소'에 안전하게 보존됩니다.");

            // 3. Final local cleanup
            actualReset();
        } catch (e: any) {
            console.error("Finalize Error:", e);
            alert("정산 및 아카이브 저장 중 오류가 발생했습니다: " + (e.message || "다시 시도해 주세요"));
        }
    };

    return (
        <div className="space-y-6 pb-40 relative overflow-hidden">

            {ceremonyMode && (
                <div className="py-8 px-4 bg-gradient-to-b from-[#C9B075]/20 to-transparent border-t-2 border-[#C9B075]/40 animate-in fade-in slide-in-from-top-4 duration-1000">
                    <div className="flex flex-col items-center text-center space-y-3">
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase animate-pulse">Official Results Announced</span>
                        <h2 className="text-3xl font-bold italic text-white tracking-tighter uppercase drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">
                            🏆 오늘 대회의 최종 순위입니다!
                        </h2>
                        <div className="h-0.5 w-12 bg-[#C9B075] rounded-full mx-auto" />
                    </div>
                </div>
            )}

            {showConfetti && (
                <div className="absolute inset-0 pointer-events-none z-[100] flex justify-center overflow-hidden">
                    {[...Array(20)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute top-[-10px] w-2 h-2 bg-[#C9B075] rounded-full animate-confetti-fall"
                            style={{
                                left: `${Math.random() * 100}%`,
                                animationDelay: `${Math.random() * 2}s`,
                                opacity: Math.random()
                            }}
                        />
                    ))}
                </div>
            )}

            <RankingTable players={players} title="🏆 실시간 통합 랭킹" />

            {hasGroups && (
                <>
                    <div className="h-px bg-white/5 mx-6 my-10" />
                    <RankingTable players={generatePlayerList('A')} title="🅰️ A조 순위" />
                    <RankingTable players={generatePlayerList('B')} title="🅱️ B조 순위" />
                </>
            )}

            <div className="flex items-center gap-2">
                <button
                    onClick={copyMatchTable}
                    className="flex-1 py-4 bg-white/5 border border-white/10 text-white/60 text-[11px] font-black uppercase tracking-widest rounded-3xl hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                >
                    <span>📋 대진표 공유</span>
                </button>
                <button
                    onClick={copyFinalResults}
                    className="flex-1 py-4 bg-[#C9B075] text-black text-[11px] font-black uppercase tracking-widest rounded-3xl hover:scale-[1.02] active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                    <span>🏆 최종결과 공유</span>
                </button>
            </div>


            <div className="mt-12 bg-white/5 backdrop-blur-xl border border-[#C9B075]/20 rounded-[40px] p-8 space-y-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <svg width="100" height="100" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
                </div>
                <div className="text-center space-y-2">
                    <span className="text-[11px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.4em] uppercase block">Tournament Official Closure</span>
                    <h4 className="text-xl font-black italic text-white tracking-tighter uppercase relative">
                        대회 결과 최종 확정 및 저장
                        <div className="mt-1 h-0.5 w-16 mx-auto bg-gradient-to-r from-transparent via-[#C9B075]/50 to-transparent" />
                    </h4>
                    <p className="text-[10px] text-white/40 font-medium max-w-[200px] mx-auto leading-relaxed mt-4">이 버튼을 누르면 오늘의 경기 기록이 아카이브로 전송되며, 라이브 대진표가 종료됩니다.</p>
                </div>

                {isAdmin ? (
                    <button
                        onClick={onFinalize}
                        disabled={isGenerating}
                        className="w-full py-5 bg-[#C9B075] text-black text-[13px] font-bold rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 border-none outline-none"
                    >
                        <span>📅 공식 종료 및 데이터 보존 🚀</span>
                        {isGenerating && <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>}
                    </button>
                ) : (
                    <div className="w-full py-5 bg-white/5 border border-white/10 rounded-2xl flex flex-col items-center justify-center gap-1 opacity-60">
                        <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">운영진 전용</span>
                        <span className="text-[8px] text-white/20 font-bold uppercase">Staff will finalize the tournament soon</span>
                    </div>
                )}

                <div className="flex items-center justify-between px-2 pt-2 text-[10px] font-bold text-white/20 uppercase tracking-tighter">
                    <span>Immutable History</span>
                    <span>Admin Controls</span>
                </div>
            </div>
        </div>
    );
}

function WarningModal({ message, onClose }: { message: string, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-xs bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[40px] p-8 shadow-[0_20px_100px_rgba(0,0,0,0.8)] flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl font-black text-white italic tracking-tighter uppercase underline decoration-[#C9B075]/30 underline-offset-4">Warning</h3>
                    <p className="text-sm font-bold text-white/70 leading-relaxed whitespace-pre-wrap px-2">{message}</p>
                </div>
                <button
                    onClick={onClose}
                    className="w-full py-4 bg-[#C9B075] text-black font-black rounded-[20px] shadow-xl active:scale-95 transition-all text-sm uppercase tracking-widest border border-white/20"
                >
                    확인했습니다
                </button>
            </div>
        </div>
    );
}

function CustomConfirmModal({ title, message, onConfirm, onCancel }: { title: string, message: string, onConfirm: () => void, onCancel: () => void }) {
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/60 backdrop-blur-xl animate-in fade-in duration-300">
            <style jsx global>{`
                @keyframes confetti-fall {
                    0% { transform: translateY(-10vh) rotate(0deg); }
                    100% { transform: translateY(110vh) rotate(720deg); }
                }
                .animate-confetti-fall {
                    animation: confetti-fall 4s linear forwards;
                }
            `}</style>
            <div className="w-full max-w-sm bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[40px] p-10 shadow-[0_20px_100px_rgba(0,0,0,0.8)] flex flex-col items-center text-center space-y-8 animate-in zoom-in-95 duration-300">
                <div className="w-24 h-24 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                    <span className="text-5xl">⚠️</span>
                </div>
                <div className="space-y-3">
                    <h3 className="text-xl font-black text-red-500 italic tracking-tighter uppercase underline decoration-white/10 underline-offset-8">{title}</h3>
                    <p className="text-base font-bold text-white/70 leading-relaxed px-2">{message}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full">
                    <button
                        onClick={onCancel}
                        className="py-6 bg-white/10 text-white/60 font-black rounded-3xl active:scale-95 transition-all text-[14px] uppercase tracking-widest border border-white/5"
                    >
                        취소
                    </button>
                    <button
                        onClick={onConfirm}
                        className="py-6 bg-gradient-to-r from-red-600 to-red-500 text-white font-black rounded-3xl shadow-[0_10px_30px_rgba(239,68,68,0.4)] active:scale-95 transition-all text-[14px] uppercase tracking-widest border border-red-400/20"
                    >
                        데이터 초기화
                    </button>
                </div>
            </div>
        </div>
    );
}
