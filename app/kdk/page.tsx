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
                ...(prev[id] || { id, name: "Unknown", group: 'A', startTime: '18:00', endTime: '22:00' } as any),
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
                        startTime: '18:00',
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
        return isGuest ? `${name}(G)` : name;
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
                const conf = attendeeConfigs[id] || { group: 'A', startTime: '18:00', endTime: '22:00' };
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
                teams: [km.team1, km.team2]
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

    const updateMatchCourt = (matchId: string) => {
        const courtStr = prompt("변경할 코트 번호를 입력하세요", "1");
        if (courtStr === null) return;
        const courtNum = parseInt(courtStr) || 1;
        setMatches(prev => prev.map(m => m.id === matchId ? { ...m, court: courtNum } : m));
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
                const conf = attendeeConfigs[id] || { group: 'A', startTime: '18:00', endTime: '22:00' };
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

            const groupCourtMap: Record<string, number[]> = { 'A': [1,2,3,4,5,6], 'B': [1,2,3,4,5,6] };
            
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

    const copyMatchTable = () => {
        let text = `📌 오늘의 대진표: ${sessionTitle}\n`;
        text += `⚖️ 규칙: ${matchRules}\n`;
        text += `💰 상벌금: 1등 ${firstPrize.toLocaleString()}원 / 하위 ${bottom25Late.toLocaleString()}~${bottom25Penalty.toLocaleString()}원\n`;
        text += `━━━━━━━━━━━━━━\n`;
        
        const matchesByRound: Record<number, Match[]> = {};
        matches.forEach(m => {
            const r = m.round || 1;
            if (!matchesByRound[r]) matchesByRound[r] = [];
            matchesByRound[r].push(m);
        });

        Object.entries(matchesByRound).sort(([a], [b]) => Number(a) - Number(b)).forEach(([round, roundMatches]) => {
            text += `📍 ${round}라운드\n`;
            roundMatches.forEach((m, idx) => {
                text += `${idx + 1}코트: ${getPlayerName(m.playerIds[0])}/${getPlayerName(m.playerIds[1])} vs ${getPlayerName(m.playerIds[2])}/${getPlayerName(m.playerIds[3])}\n`;
            });
            text += `\n`;
        });

        text += `━━━━━━━━━━━━━━\n`;
        text += `※ 상세 결과 확인: ${window.location.origin}/kdk`;
        
        navigator.clipboard.writeText(text);
        alert("📋 대진표 텍스트가 복사되었습니다!");
    };

    const copyFinalResults = () => {
        let text = `📌 오늘의 대진표: ${sessionTitle}\n`;
        text += `실시간 및 확정 랭킹 및 벌금 현황\n`;
        text += `🏦 계좌: ${accountInfo}\n`;
        text += `━━━━━━━━━━━━━━\n\n`;
        
        const sortedPlayers = [...allPlayersInRanking];
        const totalCount = sortedPlayers.length;
        // Bottom 25% get penalties
        const penaltyThreshold = Math.ceil(totalCount * 0.25);
        const penaltyStartIndex = totalCount - penaltyThreshold;

        sortedPlayers.forEach((p, i) => {
            let rankPrefix = '';
            if (i === 0) rankPrefix = '🥇 ';
            else if (i === 1) rankPrefix = '🥈 ';
            else if (i === 2) rankPrefix = '🥉 ';
            else rankPrefix = `${i + 1}위 `;

            let prizePenalty = '';
            if (i === 0) {
                prizePenalty = ` [💰 +${firstPrize.toLocaleString()}원]`;
            } else if (i >= penaltyStartIndex) {
                const isLate = attendeeConfigs[p.id]?.isLate;
                const amt = isLate ? bottom25Late : bottom25Penalty;
                prizePenalty = ` [💸 -${amt.toLocaleString()}원]`;
            } else {
                prizePenalty = ` [0원]`;
            }

            text += `${rankPrefix}${p.name}${p.is_guest?'(G)':''}: ${p.wins}승 ${p.losses}패${prizePenalty}\n`;
        });

        text += `\n━━━━━━━━━━━━━━\n`;
        text += `※ 전체 결과 확인: ${window.location.origin}/kdk`;
        
        navigator.clipboard.writeText(text);
        alert("📊 최종 결과 및 벌금 현황이 복사되었습니다!");
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
            <main className="flex flex-col h-screen bg-[#121212] text-white font-sans w-full relative overflow-hidden">
                
                {/* Elite Compact Header Spacer (4px) */}
                <div className="h-1 w-full shrink-0" />

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
                        <h1 className="text-xl font-[1000] italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">참석자 확정</h1>
                        <div className="mt-1 flex items-center justify-center gap-2 opacity-40">
                             <div className="h-px w-3 bg-[#C9B075]/30" />
                             <span className="text-[8px] font-black text-white uppercase tracking-widest leading-none">{selectedIds.size} READY</span>
                             <div className="h-px w-3 bg-[#C9B075]/30" />
                        </div>
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

                <div className="flex-1 overflow-y-auto px-6 py-2 no-scrollbar">
                    {/* Top Breathing Space (4px) */}
                    <div className="h-1 w-full shrink-0" />

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
                            <div className="grid grid-cols-3 gap-3 py-1">
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
                                                {m.nickname}{isGuest ? '(G)' : ''}
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
                                    <button onClick={() => setShowGuestInput(true)} className="h-20 rounded-2xl border-2 border-dashed border-[#D4AF37]/40 bg-[#D4AF37]/5 text-[#D4AF37] flex flex-col items-center justify-center active:scale-95 hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/60 transition-all group">
                                        <span className="text-3xl font-bold group-hover:scale-125 transition-transform text-[#D4AF37] leading-none mb-1">+</span>
                                        <span className="text-[9px] font-black uppercase tracking-tighter text-[#D4AF37]">ADD GUEST</span>
                                    </button>
                                )}
                            </div>
                        </section>
                    </DataStateView>
                    
                    {/* Invisible Spacer to prevent list from being hidden behind fixed button */}
                    <div className="h-44 w-full shrink-0" />
                </div>

                {/* Fixed Footer: Action Anchor (bottom-28) */}
                <div className="fixed bottom-[112px] left-0 right-0 px-6 z-[70] pointer-events-none">
                    <div className="max-w-md mx-auto relative">
                        {/* High-Contrast Separation Layer */}
                        <div className="absolute inset-x-0 -inset-y-4 bg-gradient-to-t from-[#121212] via-[#121212]/80 to-transparent backdrop-blur-md rounded-[40px] -z-10" />
                        
                        <button 
                            onClick={handleStep1Confirm} 
                            className="w-full py-5 bg-black text-[#D4AF37] font-[1000] text-lg rounded-[28px] shadow-[0_0_40px_rgba(212,175,55,0.4)] border-2 border-[#D4AF37] active:scale-95 flex items-center justify-center gap-3 pointer-events-auto transition-all"
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
    // FORCE_REBUILD_v26: 2026-04-03T02:52:00Z
    if (step === 2) {
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];
        const availablePlayersForPartnering = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id) && !fixedPartners.flat().includes(m.id));

        return (
            <main className="flex flex-col min-h-screen bg-[#111111] text-white font-sans w-full relative overflow-y-auto no-scrollbar">
                
                {/* Elite Compact Header Spacer (4px) */}

                <div className="h-1 w-full shrink-0" />

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
                        <h1 className="text-xl font-[1000] italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">경기 대진 설정</h1>
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
                    
                    {/* Archive Identity Section */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
                            <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Archive Title</h3>
                        </div>
                        <input 
                            type="text" 
                            value={sessionTitle} 
                            onChange={(e) => setSessionTitle(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-[24px] px-6 py-5 text-sm font-black text-white focus:border-[#D4AF37]/50 focus:bg-white/[0.08] transition-all outline-none"
                            placeholder="Ex: 2026-03-27 테연 정기전"
                        />
                    </section>

                    {/* Attendee Matrix Section */}
                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px' }}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-[13px] font-[1000] text-[#D4AF37] tracking-[0.3em] uppercase flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#D4AF37]" />
                                ATTENDEE MATRIX
                            </h3>
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{attendees.length} ACTIVE</span>
                        </div>
                        <div className="space-y-3 max-h-[440px] overflow-y-auto pr-2 custom-scrollbar no-scrollbar">
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                return (
                                    <div key={m.id} className="bg-[#121212] border border-white/5 rounded-[24px] p-4 flex items-center justify-between gap-4 group hover:border-[#D4AF37]/20 transition-all">
                                        <div className="flex flex-col min-w-[80px]">
                                            <span className="text-[14px] font-[1000] text-white/90 group-hover:text-[#D4AF37] transition-colors">{m.name}</span>
                                            <span className="text-[8px] font-black text-white/10 uppercase tracking-tighter">{m.is_guest ? 'Guest (G)' : 'Member'}</span>
                                        </div>
                                        <div className="flex items-center gap-4 flex-1 justify-end">
                                            <div className="flex items-center gap-2">
                                                <button 
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, isLate: !config.isLate } }))}
                                                    className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition-all ${config.isLate ? 'bg-orange-500/20 border-orange-500/50 text-orange-500' : 'bg-white/5 border-white/10 text-white/10 hover:text-white/30'}`}
                                                >
                                                    <span className="text-xl text-inherit">🕒</span>
                                                </button>
                                                <div className="flex items-center gap-2 bg-[#1C1C1C] rounded-2xl px-2 py-1 border border-white/10">
                                                    <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} className="bg-transparent text-[14px] font-[1000] text-white outline-none appearance-none text-center min-w-[50px] cursor-pointer">
                                                        {timeOptions.map(t => <option key={t} value={t} className="bg-[#1C1C28]">{t}</option>)}
                                                    </select>
                                                    <span className="text-[10px] font-[1000] text-gray-500">TO</span>
                                                    <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} className="bg-transparent text-[14px] font-[1000] text-white outline-none appearance-none text-center min-w-[50px] cursor-pointer">
                                                        {timeOptions.map(t => <option key={t} value={t} className="bg-[#1C1C28]">{t}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', background: '#0A0A0A', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.05)', padding: '6px', gap: '8px' }}>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))}
                                                    style={{
                                                        width: '48px', height: '48px', borderRadius: '14px',
                                                        background: config.group === 'A' ? '#C9B075' : '#0A0A0A',
                                                        color: config.group === 'A' ? '#000000' : '#FFFFFF',
                                                        border: config.group === 'A' ? 'none' : '1px solid #6B7280',
                                                        fontWeight: 1000, fontSize: '16px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        transform: config.group === 'A' ? 'scale(1.05)' : 'scale(1)',
                                                        transition: 'all 0.15s',
                                                        cursor: 'pointer'
                                                    }}
                                                >A</button>
                                                <button
                                                    onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))}
                                                    style={{
                                                        width: '48px', height: '48px', borderRadius: '14px',
                                                        background: config.group === 'B' ? '#C9B075' : '#0A0A0A',
                                                        color: config.group === 'B' ? '#000000' : '#FFFFFF',
                                                        border: config.group === 'B' ? 'none' : '1px solid #6B7280',
                                                        fontWeight: 1000, fontSize: '16px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        transform: config.group === 'B' ? 'scale(1.05)' : 'scale(1)',
                                                        transition: 'all 0.15s',
                                                        cursor: 'pointer'
                                                    }}
                                                >B</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* Generation Strategy Section */}
                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px' }}>
                        <div className="space-y-6">
                            <h4 className="text-[13px] font-[1000] text-[#D4AF37] uppercase tracking-[0.3em] flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#D4AF37]" />
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
                                        {mode === 'RANDOM' ? 'RANDOM' : mode === 'AGE' ? 'AGE SPLIT' : mode === 'AWARD' ? 'HISTORY' : 'MBTI'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-6 mt-10">
                            <div className="flex items-center justify-between">
                                <h4 className="text-[13px] font-[1000] text-[#D4AF37] uppercase tracking-[0.3em] flex items-center gap-3">
                                    <span className="w-2 h-2 rounded-full bg-[#D4AF37]" />
                                    FIXED PARTNERS
                                </h4>
                                <button onClick={() => setFixedTeamMode(!fixedTeamMode)} className={`px-4 py-2 rounded-full text-[10px] font-black transition-all border-2 ${fixedTeamMode ? 'bg-[#D4AF37] text-black border-white/20' : 'text-white/20 border-white/10'}`}>
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

                    {/* Constraints & Rules Section */}
                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px 32px 32px 36px', marginTop: '12px', overflow: 'visible' }}>
                        <div className="space-y-6">
                            <h4 className="text-[13px] font-[1000] text-[#D4AF37] uppercase tracking-[0.3em] flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#D4AF37]" />
                                CONSTRAINTS
                            </h4>
                            <div className="space-y-5">
                                <div className="flex items-center justify-between bg-[#121212] px-6 py-8 rounded-[28px] border border-[#222] shadow-md">
                                    <span className="text-[13px] font-[1000] text-gray-200 uppercase tracking-[0.1em]">Total Courts</span>
                                    <div className="flex items-center gap-6">
                                        <button onClick={() => setTotalCourts(Math.max(1, totalCourts - 1))} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">-</button>
                                        <span className="text-3xl font-[1000] text-[#D4AF37] min-w-[30px] text-center drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">{totalCourts}</span>
                                        <button onClick={() => setTotalCourts(totalCourts + 1)} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">+</button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between bg-[#121212] px-6 py-8 rounded-[28px] border border-[#222] shadow-md">
                                    <span className="text-[13px] font-[1000] text-gray-200 uppercase tracking-[0.1em]">Match Mins</span>
                                    <div className="flex items-center gap-6">
                                        <button onClick={() => setMatchTime(Math.max(30, matchTime - 30))} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">-</button>
                                        <span className="text-3xl font-[1000] text-[#D4AF37] min-w-[50px] text-center drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">{matchTime}</span>
                                        <button onClick={() => setMatchTime(matchTime + 30)} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">+</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6 mt-10">
                            <h4 className="text-[13px] font-[1000] text-[#4ADE80] uppercase tracking-[0.3em] flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#4ADE80]" />
                                FINANCIALS
                            </h4>
                            <div className="space-y-5">
                                <div className="flex items-center justify-between bg-[#121212] px-6 py-8 rounded-[28px] border border-[#222] shadow-md">
                                    <span className="text-[13px] font-[1000] text-gray-200 uppercase tracking-[0.1em]">Prize Gold</span>
                                    <div className="flex items-center gap-6">
                                        <button onClick={() => setFirstPrize(Math.max(0, firstPrize - 5000))} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">-</button>
                                        <span className="text-3xl font-[1000] text-white min-w-[60px] text-center">{(firstPrize/1000).toFixed(0)}k</span>
                                        <button onClick={() => setFirstPrize(firstPrize + 5000)} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">+</button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between bg-[#121212] px-6 py-8 rounded-[28px] border border-[#222] shadow-md">
                                    <div className="flex flex-col">
                                        <span className="text-[13px] font-[1000] text-[#FACC15] uppercase tracking-[0.1em]">Tier 1 Fine</span>
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Bottom 25%~50%</span>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <button onClick={() => setBottom25Late(Math.max(0, bottom25Late - 1000))} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">-</button>
                                        <span className="text-3xl font-[1000] text-white min-w-[60px] text-center">{(bottom25Late/1000).toFixed(0)}k</span>
                                        <button onClick={() => setBottom25Late(bottom25Late + 1000)} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">+</button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between bg-[#121212] px-6 py-8 rounded-[28px] border border-[#222] shadow-md">
                                    <div className="flex flex-col">
                                        <span className="text-[13px] font-[1000] text-red-500 uppercase tracking-[0.1em]">Tier 2 Fine</span>
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Bottom 0%~25%</span>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <button onClick={() => setBottom25Penalty(Math.max(0, bottom25Penalty - 1000))} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">-</button>
                                        <span className="text-3xl font-[1000] text-white min-w-[60px] text-center">{(bottom25Penalty/1000).toFixed(0)}k</span>
                                        <button onClick={() => setBottom25Penalty(bottom25Penalty + 1000)} className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl text-white/40 hover:text-white active:scale-95 transition-all">+</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pt-8 border-t border-[#333] space-y-4">
                            <h4 className="text-[13px] font-[1000] text-[#D4AF37] uppercase tracking-[0.3em] flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-[#D4AF37]" />
                                TOURNAMENT RULES
                            </h4>
                            <textarea 
                                value={matchRules} 
                                onChange={(e) => setMatchRules(e.target.value)} 
                                className="w-full bg-[#121212] border border-[#333] rounded-[28px] p-8 text-[15px] font-[1000] text-gray-200 min-h-[160px] outline-none focus:border-[#D4AF37]/50 focus:text-white transition-all break-words" 
                                placeholder="Edit tournament rules, policies, and local ground conventions..." 
                            />
                        </div>
                    </section>
                </div>
                
                {/* Physical Scroll Enforcer — h-40 ONLY */}
                <div style={{ height: '160px', width: '100%', flexShrink: 0 }} />

                {/* Fixed Footer: Action Anchor - INLINE FORCED */}
                <div style={{ position: 'fixed', bottom: '144px', left: 0, right: 0, padding: '0 24px', zIndex: 9999, textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ maxWidth: '448px', margin: '0 auto', position: 'relative', display: 'inline-block', width: '100%', pointerEvents: 'auto' }}>
                        {/* Hard BG separator */}
                        <div style={{ position: 'absolute', inset: '-24px -0px', background: '#1A1A1A', borderRadius: '40px', zIndex: -1, boxShadow: '0 -20px 60px rgba(0,0,0,0.95)' }} />
                        <button
                            disabled={isGenerating}
                            onClick={generateKDK}
                            style={{
                                width: '100%',
                                padding: '22px 0',
                                borderRadius: '28px',
                                background: isGenerating ? '#1C1C1C' : '#C9B075',
                                color: isGenerating ? '#6B7280' : '#000000',
                                border: isGenerating ? '3px solid #333' : '3px solid #A89060',
                                fontSize: '18px',
                                fontWeight: 900,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '12px',
                                cursor: isGenerating ? 'not-allowed' : 'pointer',
                                boxShadow: isGenerating ? 'none' : '0 0 30px rgba(201,176,117,0.4)',
                                transition: 'all 0.15s',
                                WebkitTextFillColor: isGenerating ? '#6B7280' : '#000000'
                            }}
                        >
                            {isGenerating ? 'GENERATE TOURNAMENT...' : '최종 대진 자동 생성! 🚀'}
                        </button>
                    </div>
                </div>

                {/* Partner Selection Overlay */}
                {partnerSelectSource && (
                    <div className="fixed inset-0 bg-[#121212]/95 backdrop-blur-xl z-[100] flex items-center justify-center p-6">
                        <div className="bg-[#1C1C1C] border border-white/10 rounded-[48px] w-full max-w-md p-10 space-y-8 shadow-[0_30px_100px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-300">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em]">Strategy</span>
                                    <h3 className="text-xl font-[1000] italic text-white tracking-tighter uppercase">SELECT PARTNER</h3>
                                </div>
                                <button onClick={() => setPartnerSelectSource(null)} className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-all text-3xl font-light">×</button>
                            </div>
                            <div className="grid grid-cols-2 gap-4 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar no-scrollbar">
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
                                            className={`p-6 rounded-[24px] border-2 transition-all text-[13px] font-black text-left flex flex-col gap-1 ${isSelected ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-xl ring-4 ring-[#D4AF37]/20 scale-105' : 'bg-white/5 border-white/10 text-white/70 hover:border-white/30 hover:bg-white/[0.08]'}`}
                                        >
                                            <span>{p.nickname}</span>
                                            <span className="text-[8px] opacity-40 uppercase tracking-widest">{p.is_guest ? 'Guest' : 'Member'}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="text-center">
                                <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em] animate-pulse">
                                    {partnerSelectSource === 'NEW' ? 'Select identity of first player' : 'Pick a partner for ' + getPlayerName(partnerSelectSource)}
                                </p>
                            </div>
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
        <main className="flex flex-col min-h-screen bg-[#121212] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
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
                    <button onClick={copyMatchTable} className="w-10 h-10 bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-full flex items-center justify-center text-[#D4AF37] text-sm active:scale-90 transition-all hover:bg-[#D4AF37]/20" title="대진표 공유">📋</button>
                    <button onClick={copyFinalResults} className="w-10 h-10 bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-full flex items-center justify-center text-[#D4AF37] text-sm active:scale-90 transition-all hover:bg-[#D4AF37]/20" title="결과 보고">🏆</button>
                </div>
            </header>

            <div className="px-6 mb-8">
                <div className="bg-gradient-to-br from-[#1E1E2E] to-[#14141F] border border-[#D4AF37]/30 rounded-[32px] p-6 shadow-2xl space-y-4 relative overflow-hidden">
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[8px] font-black text-[#D4AF37] uppercase tracking-[0.4em]">Tournament Info</span>
                            <button onClick={() => setShowMemberEditModal(true)} className="text-[#D4AF37] text-[9px] font-black underline underline-offset-4 decoration-[#D4AF37]/30 hover:text-white transition-colors">인원 수정 (기권/추가)</button>
                        </div>
                        <input 
                            value={sessionTitle} 
                            onChange={(e) => setSessionTitle(e.target.value)}
                            className="w-full bg-transparent text-xl font-black italic text-white tracking-tighter outline-none border-b border-transparent focus:border-[#D4AF37]/20 transition-all"
                            placeholder="Session Title"
                        />
                    </div>
                    <div className="h-px bg-white/5" />
                    <div className="grid grid-cols-[1.5fr_1fr] gap-4">
                        <div className="space-y-1 overflow-hidden">
                            <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Match Rules</span>
                            <input 
                                value={matchRules} 
                                onChange={(e) => setMatchRules(e.target.value)}
                                className="w-full bg-black/20 border border-white/5 rounded-xl px-3 h-10 text-[9px] font-bold text-white/60 outline-none focus:border-[#D4AF37]/20 truncate"
                                placeholder="Rules..."
                            />
                        </div>
                        <div className="space-y-1">
                            <span className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Prizes & Penalties</span>
                            <div className="bg-black/20 border border-white/5 rounded-xl p-3 space-y-1">
                                <p className="text-[9px] font-bold text-[#D4AF37]">🥇 {firstPrize.toLocaleString()}원</p>
                                <p className="text-[9px] font-bold text-red-400/80">📉 {bottom25Late.toLocaleString()}~{bottom25Penalty.toLocaleString()}원</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 space-y-8 overflow-y-auto">
                {activeTab === 'MATCHES' ? (
                    <>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-[10px] font-black text-white/30 tracking-[0.3em] uppercase">Now Playing</h3>
                                {activeMatchIds.length > 0 && <span className="text-[8px] font-black text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded border border-[#D4AF37]/20">{activeMatchIds.length} ACTIVE</span>}
                            </div>
                            {activeMatchIds.length === 0 ? (
                                <div className="py-20 text-center opacity-20 text-[10px] uppercase font-black tracking-widest border border-dashed border-white/5 rounded-[32px]">Waiting for next round...</div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    {activeMatchIds.map((mId) => {
                                        const m = matches.find(x => x.id === mId);
                                        if (!m) return null;
                                        const p0 = m.playerIds[0];
                                        const p0Group = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                        const isGroupB = (p0Group || 'A').toUpperCase().includes('B');

                                        return (
                                            <div key={mId} className="group relative bg-[#000000] border border-white/5 rounded-[32px] p-4 shadow-xl active:scale-95 transition-all flex flex-col justify-between min-h-[140px]">
                                                <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-white/5 border border-white/10">
                                                    <span className={`text-[8px] font-black italic ${isGroupB ? 'text-blue-400' : 'text-[#D4AF37]'}`}>{isGroupB ? 'B' : 'A'}조</span>
                                                </div>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); updateMatchCourt(mId); }}
                                                    className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-[10px] font-black italic text-[#D4AF37] border border-white/10"
                                                >
                                                    #{m.court}
                                                </button>
                                                <div onClick={() => { setTempScores({ s1: m.score1 ?? 1, s2: m.score2 ?? 1 }); setShowScoreModal(mId); }} className="space-y-3">
                                                    <div className="flex justify-between items-start px-1 pt-4">
                                                        <div className="flex flex-col gap-0.5 max-w-[45%]">
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[0])}</p>
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[1])}</p>
                                                        </div>
                                                        <span className="text-[8px] font-black text-[#D4AF37]/40 italic pt-1 text-center flex-1">VS</span>
                                                        <div className="flex flex-col gap-0.5 max-w-[45%] text-right">
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[2])}</p>
                                                            <p className="text-[11px] font-black text-white/80 truncate">{getPlayerName(m.playerIds[3])}</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-full py-2 bg-white/[0.03] rounded-xl text-center">
                                                        <span className="text-[8px] font-black text-white/20 uppercase tracking-widest group-hover:text-[#D4AF37] transition-colors">Score Input</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="space-y-8">
                            {(() => {
                                const waitingMatches = matches.filter(m => m.status === 'waiting');
                                if (waitingMatches.length === 0) return (
                                    <div className="py-10 text-center opacity-10 text-[10px] uppercase font-black tracking-widest border border-dashed border-white/5 rounded-[32px]">No Matches in Queue</div>
                                );

                                return [ 'A', 'B' ].map(group => {
                                    const groupMatches = waitingMatches.filter(m => {
                                        const p0 = m.playerIds[0];
                                        const p0Group = attendeeConfigs[p0]?.group || allMembers.find(x => x.id === p0)?.position || 'A';
                                        
                                        const normalizedGroup = (p0Group || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                        return normalizedGroup === group;
                                    });

                                    if (groupMatches.length === 0) return null;

                                    return (
                                        <div key={group} className="space-y-4">
                                            <h3 className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase px-2 flex items-center gap-2">
                                                <span className={`w-4 h-4 rounded flex items-center justify-center text-[8px] text-black font-black ${group === 'A' ? 'bg-[#D4AF37]' : 'bg-blue-500'}`}>{group}</span>
                                                {group}조 대기 경기
                                            </h3>
                                            <div className="grid grid-cols-1 gap-2">
                                                {groupMatches.map(m => {
                                                    const busyPlayers = m.playerIds.filter(pid => busyPlayerIds.has(pid));
                                                    const hasConflict = busyPlayers.length > 0;
                                                    return (
                                                        <div key={m.id} className={`bg-white/[0.03] border border-white/5 p-5 rounded-[24px] flex items-center justify-between transition-all ${hasConflict ? 'opacity-30' : ''}`}>
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[8px] font-bold text-white/20 uppercase">Round {m.round}</span>
                                                                    {hasConflict && (
                                                                        <span className="text-[7px] font-black text-red-500/60 uppercase tracking-tighter">
                                                                            Conflict: {busyPlayers.map(pid => getPlayerName(pid)).join(', ')}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className={`text-xs font-bold transition-colors ${hasConflict ? 'text-white/20' : 'text-white/60'}`}>
                                                                    {getPlayerName(m.playerIds[0])}/{getPlayerName(m.playerIds[1])} vs {getPlayerName(m.playerIds[2])}/{getPlayerName(m.playerIds[3])}
                                                                </span>
                                                            </div>
                                                            <button 
                                                                disabled={hasConflict}
                                                                onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); startMatch(m.id); }} 
                                                                className={`text-[10px] font-black uppercase px-3 py-1 rounded-lg ${hasConflict ? 'bg-white/5 text-white/5 cursor-not-allowed' : 'bg-[#D4AF37] text-black active:scale-95'}`}
                                                            >
                                                                {hasConflict ? 'BUSY' : '투입 🚀'}
                                                            </button>
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
                            <div className="space-y-4 pt-8">
                                <h3 className="text-[10px] font-black text-[#D4AF37]/40 tracking-[0.3em] uppercase px-2">Completed Matches</h3>
                                <div className="grid grid-cols-1 gap-3">
                                    {matches.filter(m => m.status === 'complete').reverse().map(m => (
                                        <div key={m.id} onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setShowScoreModal(m.id); }} className="bg-white/[0.02] border border-white/5 p-8 rounded-[32px] flex flex-col items-center gap-4 backdrop-blur-sm shadow-[0_4px_30px_rgba(0,0,0,0.4)] group">
                                            <div className="flex items-center gap-8 w-full justify-center">
                                                <span className="text-[12px] font-black text-white/50 truncate flex-1 text-right">{getPlayerName(m.playerIds[0])} / {getPlayerName(m.playerIds[1])}</span>
                                                <div className="flex flex-col items-center px-6">
                                                    <span className="text-4xl font-black text-[#4ADE80] drop-shadow-[0_0_15px_rgba(74,222,128,0.6)]">{m.score1} : {m.score2}</span>
                                                </div>
                                                <span className="text-[12px] font-black text-white/50 truncate flex-1 text-left">{getPlayerName(m.playerIds[2])} / {getPlayerName(m.playerIds[3])}</span>
                                            </div>
                                            <span className="text-[9px] font-black text-white/10 uppercase tracking-widest group-hover:text-[#C9B075]/60 transition-colors">Tap to edit result</span>
                                        </div>
                                    ))}
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
                            copyMatchTable={copyMatchTable}
                            copyFinalResults={copyFinalResults}
                            ceremonyMode={showCeremony}
                            onFinalize={handleFinalArchive}
                            isGenerating={isGenerating}
                            isAdmin={role === 'CEO'}
                        />
                    </div>
                )}
            </div>

            <nav className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black/95 to-transparent z-50">
                <div className="max-w-xs mx-auto bg-white/5 border border-white/10 backdrop-blur-2xl rounded-full p-1.5 flex shadow-2xl">
                    {(['MATCHES', 'RANKING'] as const).map(t => (
                        <button key={t} onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setActiveTab(t); }} className={`flex-1 py-3 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-white/40 hover:text-white'}`}>{t === 'MATCHES' ? '🔥 Matches' : '📊 Ranking'}</button>
                    ))}
                </div>
            </nav>

            {/* Floating Ceremony Trigger Button (Visible when all matches scored) */}
            {allMatchesScored && step === 3 && activeTab === 'MATCHES' && (
                <div className="fixed bottom-24 left-0 right-0 px-6 z-50 animate-in slide-in-from-bottom-10 fade-in duration-500">
                    <button 
                        onClick={handleStartCeremony}
                        className="w-full py-5 bg-gradient-to-r from-[#D4AF37] to-[#B8860B] text-black font-[1000] rounded-[28px] shadow-[0_20px_60px_rgba(212,175,55,0.4)] active:scale-95 transition-all text-[13px] tracking-[0.2em] uppercase flex items-center justify-center gap-3 border border-white/20 animate-pulse"
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
                            copyMatchTable={copyMatchTable}
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
                    <div className="relative w-full max-w-lg bg-[#14141F] border-t border-white/10 rounded-t-[40px] p-8 pb-10 shadow-2xl animate-in slide-in-from-bottom duration-300">
                        <header className="flex flex-col items-center gap-2 mb-8 text-center px-4">
                            <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase">Set Final Result</span>
                            <div className="mt-2 py-2 px-6 bg-[#D4AF37]/10 rounded-2xl border border-[#D4AF37]/20">
                                <h3 className="text-xl font-black italic text-white tracking-tight">🏆 WINNER SELECTION</h3>
                            </div>
                        </header>
                        <div className="grid grid-cols-2 gap-8 mb-10">
                            {[0, 1].map(side => (
                                <div key={side} className="flex flex-col gap-4">
                                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest text-center truncate">{getPlayerName(activeMatchForScore.playerIds[side*2])} & {getPlayerName(activeMatchForScore.playerIds[side*2+1])}</span>
                                    <div className="text-5xl font-black text-[#D4AF37] text-center mb-2">{side === 0 ? tempScores.s1 : tempScores.s2}</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[0,1,2,3,4,5,6].map(n => (
                                            <button 
                                                key={n} 
                                                onClick={() => {
                                                    if (window.navigator?.vibrate) window.navigator.vibrate(50); // 탁!
                                                    const val = Math.min(6, Math.max(0, n));
                                                    setTempScores(p => side === 0 ? ({ ...p, s1: val }) : ({ ...p, s2: val }));
                                                }} 
                                                className={`h-12 rounded-xl text-lg font-black transition-all ${ (side === 0 ? tempScores.s1 : tempScores.s2) === n ? 'bg-[#D4AF37] text-black scale-105' : 'bg-white/5 text-white/30'}`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowScoreModal(null)} className="flex-1 py-5 bg-white/5 border border-white/10 text-white font-black rounded-[28px] uppercase text-xs tracking-widest">Cancel</button>
                            <button disabled={tempScores.s1 === tempScores.s2} onClick={() => finishMatch(activeMatchForScore.id, tempScores.s1, tempScores.s2)} className="flex-[2] py-5 bg-[#D4AF37] text-black font-black rounded-[28px] uppercase text-xs tracking-widest shadow-xl disabled:opacity-20 font-black">Confirm Score 🏆</button>
                        </div>
                    </div>
                </div>
            )}
            
            {showMemberEditModal && (
                <div className="fixed inset-0 z-[300] bg-black/95 backdrop-blur-xl flex flex-col p-6 overflow-hidden">
                    <header className="flex items-center justify-between mb-8">
                        <h2 className="text-xl font-black italic text-white uppercase tracking-tighter">참석자 수시 수정</h2>
                        <button onClick={() => setShowMemberEditModal(false)} className="text-white/20 text-3xl">×</button>
                    </header>
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                        <section className="space-y-4">
                            <h3 className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase">Toggle Active Players</h3>
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
                                                ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-lg scale-105' 
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
                            💡 선수를 추가하거나 제거하면, <br/>아직 투입되지 않은 모든 자동 대진이 다시 생성됩니다.
                        </p>
                    </div>
                    <div className="mt-8">
                        <button 
                            disabled={isGenerating}
                            onClick={handleMemberEditConfirm}
                            className={`w-full py-5 rounded-[28px] font-black text-xs uppercase tracking-[0.2em] shadow-2xl ${isGenerating ? 'bg-white/10 text-white/10' : 'bg-[#D4AF37] text-black'}`}
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
            <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose}></div>
            <div className="relative w-full max-w-md bg-[#1C1C28] border border-white/10 rounded-[40px] p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto custom-scrollbar animate-in slide-in-from-bottom-8">
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.4em] uppercase mb-1">Guest Registry</span>
                        <h3 className="text-xl font-black italic text-white tracking-tighter uppercase">게스트 상세 정보</h3>
                    </div>
                    <button onClick={onClose} className="text-white/20 text-3xl">×</button>
                </div>
                
                <div className="space-y-4">
                    {guests.map(g => {
                        const conf = configs[g.id] || {};
                        return (
                            <div key={g.id} className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-black text-white">{g.name}</span>
                                    <span className="text-[8px] font-black text-[#D4AF37] uppercase tracking-[0.2em] bg-[#D4AF37]/10 px-2 py-1 rounded">Guest</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-white/30 uppercase tracking-widest">Age (나이)</label>
                                        <input 
                                            type="number" 
                                            placeholder="나이"
                                            value={conf.age || ''}
                                            onChange={(e) => onSave(g.id, parseInt(e.target.value) || 0, !!conf.isWinner)}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs font-bold text-white outline-none focus:border-[#D4AF37]/50"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[9px] font-black text-white/30 uppercase tracking-widest">Winner? (입상여부)</label>
                                        <button 
                                            onClick={() => onSave(g.id, conf.age || 0, !conf.isWinner)}
                                            className={`w-full py-3 rounded-xl border font-black text-[10px] tracking-widest transition-all ${conf.isWinner ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'bg-white/5 border-white/10 text-white/20'}`}
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
                        className="w-full py-5 bg-gradient-to-r from-[#D4AF37] to-[#B8860B] text-black font-black rounded-2xl shadow-2xl active:scale-95 transition-all text-xs uppercase tracking-[0.2em]"
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
                    <button key={a.id} onClick={() => handleLoad(a)} className="w-full bg-white/[0.03] border border-white/5 p-4 rounded-[20px] flex items-center justify-between group hover:border-[#D4AF37]/30 transition-all text-left">
                        <div className="flex flex-col"><span className="text-xs font-black text-white/60">{a.note?.startsWith('{') ? JSON.parse(a.note).title : a.note}</span><span className="text-[8px] font-bold text-white/20 uppercase">{new Date(a.created_at).toLocaleDateString()}</span></div>
                        <span className="text-[10px] font-black text-[#D4AF37]">OPEN →</span>
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
            note = `👑 우승 상물 (+${(performancePenalty/1000).toFixed(0)}k)`;
        } else if (isPenaltyTier) {
            performancePenalty = -(prizes.l2 || 5000);
            note = `📉 패널티 (-${(Math.abs(performancePenalty)/1000).toFixed(0)}k)`;
        } else if (isFineTier) {
            performancePenalty = -(prizes.l1 || 3000);
            note = `📉 하위권 벌금 (-${(Math.abs(performancePenalty)/1000).toFixed(0)}k)`;
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
        return p?.is_guest ? `${p.name}(G)` : p.name;
    };

    const RankingTable = ({ players, title }: { players: any[], title: string }) => (
        <section className="space-y-4 mb-8">
            <h3 className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase px-2 flex items-center justify-between">
                <span>{title}</span>
                <span className="text-white/20">{players.length} Players</span>
            </h3>
            <div className="bg-white/[0.03] border border-white/5 rounded-[32px] overflow-hidden overflow-x-auto">
                <table className="min-w-[600px] w-full text-[10px] border-collapse">
                    <thead>
                        <tr className="bg-white/5 text-white/40 font-black uppercase tracking-tighter text-[11px]">
                            <th onClick={() => toggleSort('rk')} className="py-5 px-4 text-center w-10 cursor-pointer hover:text-white transition-colors">Rk {sortKey === 'rk' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('name')} className="py-5 px-2 text-left cursor-pointer hover:text-white transition-colors">Player {sortKey === 'name' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th className="py-5 px-1 text-center">Fine</th>
                            <th onClick={() => toggleSort('diff')} className="py-5 px-1 text-center cursor-pointer hover:text-white transition-colors">Diff {sortKey === 'diff' && (sortDir === 'asc' ? '▴' : '▾')}</th>
                            <th onClick={() => toggleSort('age')} className="py-5 px-1 text-center cursor-pointer hover:text-[#D4AF37] transition-colors text-[#D4AF37]/60">Age {sortKey === 'age' && (sortDir === 'asc' ? '▴' : '▾')}</th>
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
                                <tr key={p.id} className={`border-t border-white/5 last:border-0 hover:bg-white/[0.04] transition-all ${isWinner ? 'bg-[#D4AF37]/5' : isBottom ? 'bg-red-500/[0.02]' : ''}`}>
                                    <td className={`py-5 px-4 text-center font-black italic ${isWinner ? 'text-[#D4AF37] text-lg' : isBottom ? 'text-red-500/40' : 'text-white/20'}`}>
                                        {isWinner ? '👑' : players.findIndex((x: any) => x.id === p.id) + 1}
                                    </td>
                                    <td className="py-5 px-2">
                                        <div className="flex flex-col">
                                            <span className={`font-bold ${isWinner ? 'text-[#D4AF37] text-base' : 'text-white'}`}>{p.name} {p.is_guest ? '(G)' : ''}</span>
                                            {isWinner && <span className="text-[9px] font-black text-[#D4AF37]/60 uppercase tracking-widest">Tournament MVP</span>}
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
                                        <span className={`px-2 py-1 rounded-lg ${amount > 0 ? 'bg-[#D4AF37]/10 text-[#D4AF37]' : amount < 0 ? 'bg-red-500/10 text-red-500' : 'text-white/20'}`}>
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
            {/* Celebration Ceremony Header */}
            {ceremonyMode && (
                <div className="py-8 px-4 bg-gradient-to-b from-[#D4AF37]/20 to-transparent border-t-2 border-[#D4AF37]/40 animate-in fade-in slide-in-from-top-4 duration-1000">
                    <div className="flex flex-col items-center text-center space-y-3">
                        <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.5em] uppercase animate-pulse">Official Results Announced</span>
                        <h2 className="text-3xl font-[1000] italic text-white tracking-tighter uppercase drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">
                            🏆 오늘 대회의 최종 순위입니다!
                        </h2>
                        <div className="h-0.5 w-12 bg-[#D4AF37] rounded-full mx-auto" />
                    </div>
                </div>
            )}

            {showConfetti && (
                <div className="absolute inset-0 pointer-events-none z-[100] flex justify-center overflow-hidden">
                    {[...Array(20)].map((_, i) => (
                        <div 
                            key={i} 
                            className="absolute top-[-10px] w-2 h-2 bg-[#D4AF37] rounded-full animate-confetti-fall"
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
                    className="flex-1 py-4 bg-[#D4AF37] text-black text-[11px] font-black uppercase tracking-widest rounded-3xl hover:scale-[1.02] active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                    <span>🏆 최종결과 공유</span>
                </button>
            </div>

            {/* Stage 3: Official Staff Closure (Final archival button) */}
            <div className="mt-12 bg-[#000000] border border-[#D4AF37]/20 rounded-[40px] p-8 space-y-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <svg width="100" height="100" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
                </div>
                <div className="text-center space-y-2">
                    <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.4em] uppercase block">Tournament Official Closure</span>
                    <h4 className="text-xl font-black italic text-white tracking-tighter uppercase underline decoration-[#D4AF37]/30 underline-offset-4">대회 결과 최종 확정 및 저장</h4>
                    <p className="text-[10px] text-white/30 font-medium max-w-[200px] mx-auto leading-relaxed">이 버튼을 누르면 오늘의 경기 기록이 아카이브로 전송되며, 라이브 대진표가 종료됩니다.</p>
                </div>

                {isAdmin ? (
                    <button 
                        onClick={onFinalize}
                        disabled={isGenerating}
                        className="w-full py-5 bg-[#D4AF37] text-black text-[13px] font-[1000] rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 border-none outline-none"
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/95 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-xs bg-[#000000] border border-white/10 rounded-[40px] p-8 shadow-2xl flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl font-black text-white italic tracking-tighter uppercase underline decoration-[#D4AF37]/30 underline-offset-4">Warning</h3>
                    <p className="text-sm font-bold text-white/60 leading-relaxed whitespace-pre-wrap">{message}</p>
                </div>
                <button 
                    onClick={onClose}
                    className="w-full py-4 bg-[#D4AF37] text-black font-black rounded-[20px] shadow-xl active:scale-95 transition-all text-sm uppercase tracking-widest"
                >
                    확인했습니다
                </button>
            </div>
        </div>
    );
}

function CustomConfirmModal({ title, message, onConfirm, onCancel }: { title: string, message: string, onConfirm: () => void, onCancel: () => void }) {
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
            <style jsx global>{`
                @keyframes confetti-fall {
                    0% { transform: translateY(-10vh) rotate(0deg); }
                    100% { transform: translateY(110vh) rotate(720deg); }
                }
                .animate-confetti-fall {
                    animation: confetti-fall 4s linear forwards;
                }
            `}</style>
            <div className="w-full max-w-xs bg-[#1E1E2E] border border-white/10 rounded-[40px] p-8 shadow-2xl flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center">
                    <span className="text-4xl">⚠️</span>
                </div>
                <div className="space-y-2">
                    <h3 className="text-xl font-black text-[#D4AF37] italic tracking-tighter uppercase underline decoration-white/10 underline-offset-8">{title}</h3>
                    <p className="text-sm font-bold text-white/60 leading-relaxed">{message}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full">
                    <button 
                        onClick={onCancel}
                        className="py-5 bg-white/10 text-white/60 font-black rounded-2xl active:scale-95 transition-all text-[12px] uppercase tracking-widest border border-white/5"
                    >
                        취소
                    </button>
                    <button 
                        onClick={onConfirm}
                        className="py-5 bg-[#D4AF37] text-black font-black rounded-2xl shadow-[0_10px_20px_rgba(212,175,55,0.3)] active:scale-95 transition-all text-[12px] uppercase tracking-widest"
                    >
                        데이터 초기화
                    </button>
                </div>
            </div>
        </div>
    );
}
