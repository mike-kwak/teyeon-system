'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { generateKdkMatches, Player as KdkPlayer, Match as KdkMatch } from '@/lib/kdk';
import { RotateCw, CheckCircle2 } from 'lucide-react';
import PremiumSpinner from '@/components/PremiumSpinner';
import { DataStateView } from '@/components/DataStateView';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import RankingTab from '@/components/RankingTab';


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
    const [showToast, setShowToast] = useState(false);
    const [toastMsg, setToastMsg] = useState("결과가 안전하게 기록되었습니다");

    // [v12.0] 개방형 권한 시스템: Admin 여부 판별
    const isAdmin = role === 'CEO' || role === 'Staff' || role === 'ADMIN';

    // 권한 제한 알림 헬퍼
    const triggerAccessDenied = (msg: string = "관리자만 대진을 생성/수정할 수 있습니다.") => {
        setToastMsg(msg);
        setShowToast(true);
        if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
        setTimeout(() => setShowToast(false), 3000);
    };

    useEffect(() => {
        // Force unregister stale service workers
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for(let registration of registrations) {
                    registration.unregister();
                }
            });
        }
        console.clear();
        console.log("🏁 TEYEON SYSTEM v5.1 STABLE: ALL SYSTEMS GO");
    }, []);

    // [v12.0] REDIRECT REMOVED: Guests can now view the portal
    /* 
    useEffect(() => {
        if (role === 'GUEST') {
            alert("정회원 이상만 이용 가능한 메뉴입니다. 대시보드로 이동합니다.");
            router.push('/');
        }
    }, [role, router]);
    */

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
    const [allActiveSessions, setAllActiveSessions] = useState<{ id: string, title: string, matchCount: number, playerCount: number, lastActivity: string }[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [showGateway, setShowGateway] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'RANKING'>('MATCHES');

    const [showWarning, setShowWarning] = useState(false);
    const [warningMsg, setWarningMsg] = useState("");

    const [showMemberEditModal, setShowMemberEditModal] = useState(false);
    const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);
    const [celebrationMode, setCelebrationMode] = useState(false);
    const [isMembersLoading, setIsMembersLoading] = useState(true);
    const [isMembersError, setIsMembersError] = useState(false);
    const [showCeremony, setShowCeremony] = useState(false);
    const [spinningMatchId, setSpinningMatchId] = useState<string | null>(null);

    // --- [v7.0 ABSOLUTE] 12전 13기: 서버 굴복 및 로컬 강제 저장 통합 헬퍼 ---
    const absoluteSyncRPC = async (data: any) => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        
        // 1. 현장 DB ID 경보 (CEO Verification)
        const projectId = supabaseUrl.split('//')[1]?.split('.')[0] || 'Unknown';
        console.log(`🏙️ [ABSOLUTE] TARGET PROJECT ID: ${projectId}`);
        console.table(data);

        try {
            const endpoint = `${supabaseUrl}/rest/v1/rpc/final_sync_v7_absolute`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'params=single-object', // 마법의 헤더: JSON 전체를 단일 인자로 매핑
                    'x-client-info': 'teyeon-absolute-v7.0'
                },
                body: JSON.stringify(data) // 래핑 없이 순수 객체 전송
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }
            console.log("✅ [ABSOLUTE] SERVER SYNC SUCCESS");
            return { error: null };
        } catch (err: any) {
            console.error("❌ [ABSOLUTE] SERVER SYNC FAILED, FORCING LOCAL SAVE:", err);
            
            // 3. '12전 13기' 로컬 강제 저장 (Offline First)
            try {
                const queue = JSON.parse(localStorage.getItem('teyeon_offline_sync_queue') || '[]');
                queue.push({ ...data, timestamp: new Date().toISOString() });
                localStorage.setItem('teyeon_offline_sync_queue', JSON.stringify(queue));
                console.warn("🛡️ [ABSOLUTE] DATA SECURED IN LOCAL STORAGE");
                return { error: null }; // 성공으로 간주하여 화면 진행
            } catch (localErr) {
                console.error("CRITICAL: Local storage save failed", localErr);
                return { error: err };
            }
        }
    };

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
            // [CEO 현장 검증 로직 가동]
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

            const rawDataPayload = {
                title: sessionTitle || `Tournament ${dateStr}`,
                date: dateStr,
                ranking_data: rankingSnapshot,
                snapshot_data: matches.map(m => {
                    const pNames = m.playerIds.map(pid => getPlayerName(pid));
                    const pAvatars = m.playerIds.map(pid => {
                        const mem = (allMembers || []).find(x => x?.id === pid) || (tempGuests || []).find(x => x?.id === pid);
                        return mem?.avatar_url || '';
                    });
                    return {
                        ...m,
                        player_ids: m.playerIds || [], 
                        player_names: pNames,
                        player_avatars: pAvatars,
                        group_name: m.groupName || 'A'
                    };
                }),
                player_metadata: attendeeConfigs,
                total_matches: matches.length,
                total_rounds: (matches.length > 0) ? Math.max(...matches.map(m => m.round || 1)) : 1
            };

            // [v10.0 SAVE OR DIE] 통신 전 로컬에 즉시 박제 (Safety First)
            try {
                const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
                const failoverItem = {
                    id: sessionId,
                    raw_data: rawDataPayload,
                    failover: true, // 서버 확인 전까지는 임시 상태
                    created_at: new Date().toISOString()
                };
                const filtered = failovers.filter((f: any) => f.id !== sessionId);
                filtered.push(failoverItem);
                localStorage.setItem('kdk_archive_failover', JSON.stringify(filtered));
                console.warn("🛡️ [v10.0] PRE-EMPTIVE LOCAL BACKUP SECURED");
            } catch (err) {
                console.error("Local backup failed", err);
            }

            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
            const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
            const endpoint = `${supabaseUrl}/rest/v1/teyeon_archive_v1`;

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`,
                        'Prefer': 'resolution=merge-duplicates',
                        'Cache-Control': 'no-cache'
                    },
                    body: JSON.stringify({ id: sessionId, raw_data: rawDataPayload })
                });

                if (!response.ok) throw new Error("Server Rejected");
                console.log("✅ [v10.0] SERVER ARCHIVE SUCCESS");
            } catch (err: any) {
                console.error("❌ [v10.0] SERVER FAILED, PROCEEDING WITH LOCAL ARCHIVE:", err);
                // [v10.0] CEO Request: Specific wording
                alert("서버 통신 지연으로 기기에 임시 저장되었습니다. 아카이브에서 확인 가능합니다.");
            }

            // [v10.0] Championship Celebration (금색 가루 뿌리기)
            setShowArchiveSuccess(true);
            setShowConfetti(true);
            setCelebrationMode(true);
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200, 100, 200]);
            
            // Celebration Delay for pure satisfaction
            await new Promise(r => setTimeout(r, 4500));

            // 3. Cleanup Live Data from Supabase
            const { error: delError } = await supabase.from('matches').delete().eq('session_id', sessionId);
            if (delError) console.error("Cleanup Error (Non-Fatal):", delError);

            // 4. Clear Local State
            actualReset();

            // 5. Redirect to Archive Portal
            router.push(`/archive?session=${sessionId}`);

        } catch (err: any) {
            alert("공식 종료 실패: " + err.message);
        } finally {
            setIsGenerating(false);
        }
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
        setAttendeeConfigs({});
        setStep(1);
        setFixedPartners([]);
        setFixedTeamMode(false);
        setShowResetConfirm(false);
        setSelectedIds(new Set());
        setTempGuests([]);
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
            
            // After fetching members, check for active session in DB
            await syncActiveSession();
        } catch (err) {
            console.error("Fetch Members Error:", err);
            setIsMembersError(true);
        } finally {
            setIsMembersLoading(false);
        }
    };

    const syncActiveSession = async () => {
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            
            const { data, error } = await supabase
                .from('matches')
                .select('*')
                .eq('club_id', clubId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (data && data.length > 0) {
                // Group by session
                const sessionsMap: Record<string, { id: string, title: string, matches: any[], players: Set<string>, lastActivity: string }> = {};
                
                data.forEach(m => {
                    const sId = m.session_id || 'LEGACY';
                    if (!sessionsMap[sId]) {
                        sessionsMap[sId] = {
                            id: sId,
                            title: m.session_title || 'Unnamed Tournament',
                            matches: [],
                            players: new Set(),
                            lastActivity: m.created_at
                        };
                    }
                    sessionsMap[sId].matches.push(m);
                    (m.playerIds || []).forEach((pid: string) => sessionsMap[sId].players.add(pid));
                });

                const sessionList = Object.values(sessionsMap).map(s => ({
                    id: s.id,
                    title: s.title,
                    matchCount: s.matches.length,
                    playerCount: s.players.size,
                    lastActivity: s.lastActivity
                }));

                setAllActiveSessions(sessionList);

                // Gatekeeper Logic
                if (!selectedSessionId) {
                    if (sessionList.length === 1) {
                        // Auto-entry if only one session
                        const soleSession = sessionsMap[sessionList[0].id];
                        setMatches(soleSession.matches.map(m => ({
                            id: m.id,
                            playerIds: m.player_ids || m.playerIds || [], // Fix: Map DB snake_case to state camelCase
                            court: m.court,
                            status: m.status,
                            score1: m.score1,
                            score2: m.score2,
                            mode: m.mode || 'KDK',
                            round: m.round,
                            teams: m.teams,
                            groupName: m.group_name || m.groupName // Support both snake/camel
                        })));
                        setSessionId(soleSession.id);
                        setSessionTitle(soleSession.title);
                        setSelectedSessionId(soleSession.id);
                        setStep(3);
                    } else if (sessionList.length > 1) {
                        setShowGateway(true);
                    }
                } else {
                    // Refresh current session data if already selected
                    const currentSession = sessionsMap[selectedSessionId];
                    if (currentSession) {
                        setMatches(currentSession.matches.map(m => ({
                            id: m.id,
                            playerIds: m.player_ids || m.playerIds || [], // Fix: Map DB snake_case to state camelCase
                            court: m.court,
                            status: m.status,
                            score1: m.score1,
                            score2: m.score2,
                            mode: m.mode || 'KDK',
                            round: m.round,
                            teams: m.teams,
                            groupName: m.group_name || m.groupName // Support both snake/camel
                        })));
                    }
                }
            } else {
                setAllActiveSessions([]);
                setShowGateway(false);
            }
        } catch (err) {
            console.error("Active session sync failure:", err);
        }
    };

    const enterSession = (sId: string) => {
        const target = allActiveSessions.find(s => s.id === sId);
        if (target) {
            setSelectedSessionId(sId);
            setShowGateway(false);
            setSessionId(sId);
            setSessionTitle(target.title);
            setStep(3);
            // Trigger a re-sync to get the full match data for this session
            syncActiveSession();
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
                    session_id: sessionId, // CRITICAL: Added missing session_id
                    club_id: process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819",
                    session_title: sessionTitle || 'Tournament',
                    player_names: m.playerIds.map(pid => getPlayerName(pid))
                }));
                const { error: matchError } = await supabase.rpc('sync_tournament_matches', {
                    p_matches: dbMatches
                });
                if (matchError) {
                    console.error("❌ Live Match Sync Error:", matchError);
                    // Detailed logging for debugging
                    if (matchError.message?.includes('uuid')) {
                        console.warn("UUID Mismatch detected. Please apply the SQL migration to change 'matches.id' to TEXT.");
                    }
                } else {
                    console.log("✅ Live Match Sync Success");
                }
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
        
        // 1. Local state update
        setActiveMatchIds(nextActive);
        setMatches(nextMatches);

        // 2. DB Sync via RPC (v7.0 ABSOLUTE)
        await absoluteSyncRPC({
            match_id: matchId.toString(),
            status: 'playing',
            score1: 0,
            score2: 0
        });

        // 3. Manual Invalidation (sync state from server)
        await syncActiveSession();
    };

    const cancelMatch = async (matchId: string) => {
        try {
            if (window.navigator?.vibrate) window.navigator.vibrate(50);
            setSpinningMatchId(matchId); // Start spin feedback
            // 1. Supabase Sync via RPC (v7.0 ABSOLUTE)
            const { error: syncError } = await absoluteSyncRPC({
                match_id: matchId.toString(),
                status: 'waiting',
                score1: 0,
                score2: 0
            });

            if (syncError) console.error("❌ Cancel match sync error:", syncError);

            // 2. Local State Update & Invalidation
            setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'waiting', court: null } : m));
            setActiveMatchIds(prev => prev.filter(id => id !== matchId));

            // 3. Manual Invalidation (sync state from server)
            await syncActiveSession();

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

            // 3. DB Sync via RPC (v7.0 ABSOLUTE)
            const { error: syncError } = await absoluteSyncRPC({
                match_id: matchId.toString(),
                status: 'complete',
                score1: numS1,
                score2: numS2
            });
            
            if (syncError) {
                console.error("Match result sync error:", syncError);
                throw syncError;
            }

            // 4. Immediate 'Invalidation' (Manual State Refresh before safety reload)
            await syncActiveSession(); 
            window.location.reload();

            // Success: Trigger Toast instead of Alert
            setShowToast(true);
            setTimeout(() => setShowToast(false), 3000);

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
        const res: Record<string, { wins: number, losses: number, diff: number, games: number, pf: number, pa: number }> = {};
        matches?.filter(m => m?.status === 'complete')?.forEach(m => {
            m?.playerIds?.forEach((pid, idx) => {
                if (!res[pid]) res[pid] = { wins: 0, losses: 0, diff: 0, games: 0, pf: 0, pa: 0 };
                const isTeam1 = idx < 2;
                const score1 = Number(m?.score1 || 0);
                const score2 = Number(m?.score2 || 0);
                const win = isTeam1 ? (score1 > score2) : (score2 > score1);
                const d = isTeam1 ? (score1 - score2) : (score2 - score1);

                res[pid].games += 1;
                res[pid].pf += isTeam1 ? score1 : score2;
                res[pid].pa += isTeam1 ? score2 : score1;
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
                ...(playerStats?.[id] || { wins: 0, losses: 0, diff: 0, games: 0, pf: 0, pa: 0 })
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
                        <div className="absolute inset-x-0 -inset-y-4 bg-gradient-to-t from-[#121212] via-[#121212]/80 to-transparent backdrop-blur-md rounded-[24px] -z-10" />

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

                    <div className="text-center flex flex-col items-center gap-2">
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-1 inline-block leading-none scale-90">Step 02</span>
                            <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">경기 대진 설정</h1>
                        </div>
                        {isAdmin && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#C9B075] rounded-full shadow-[0_5px_15px_rgba(201,176,117,0.3)] animate-in fade-in zoom-in duration-500">
                                <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                                <span className="text-[9px] font-black text-black uppercase tracking-widest leading-none">CEO MODE</span>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={() => {
                                if (!isAdmin) return triggerAccessDenied();
                                setShowResetConfirm(true);
                            }}
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
                            onClick={() => {
                                if (!isAdmin) return triggerAccessDenied();
                                generateKDK();
                            }}
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

    if (showGateway && step === 3) {
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-zinc-900 opacity-50" />
                
                <header className="relative z-10 p-8 flex flex-col items-center text-center">
                    <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.5em] uppercase mb-4 animate-pulse">
                        Live Court Gateway
                    </span>
                    <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase drop-shadow-2xl">
                        중계 세션 선택
                    </h1>
                    <div className="mt-4 h-1 w-24 bg-gradient-to-r from-transparent via-[#C9B075] to-transparent opacity-40" />
                </header>

                <div className="relative z-10 flex-1 px-6 pb-20 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                    {allActiveSessions.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center px-12 opacity-20 group">
                            <div className="w-20 h-20 rounded-full border border-dashed border-white/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <span className="text-4xl">📡</span>
                            </div>
                            <h2 className="text-lg font-black uppercase tracking-widest mb-2">No Active Matches</h2>
                            <p className="text-[10px] font-medium leading-relaxed uppercase tracking-tighter max-w-xs">
                                현재 진행 중인 공개 세션이 없습니다.<br />관리자가 경기를 생성하면 여기에 표시됩니다.
                            </p>
                        </div>
                    ) : (
                        allActiveSessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()).map((s, idx) => {
                            const isLatest = idx === 0;
                            return (
                                <button
                                    key={s.id}
                                    onClick={() => enterSession(s.id)}
                                    className={`
                                        relative w-full rounded-[24px] p-8 text-left transition-all active:scale-[0.98] group overflow-hidden
                                        bg-white/5 backdrop-blur-3xl border-t border-t-white/20 border-l border-l-white/10
                                        shadow-[0_40px_80px_-15px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.3)]
                                        ${isLatest ? 'border-[#C9B075]/30' : ''}
                                    `}
                                >
                                    {isLatest && (
                                        <div className="absolute -inset-[3px] rounded-[42px] bg-gradient-to-b from-[#C9B075] via-[#C9B075]/10 to-transparent -z-10 opacity-40 blur-[4px]" />
                                    )}

                                    <div className="flex items-start justify-between mb-8">
                                        <div className="flex flex-col gap-1">
                                            <span className={`text-[10px] font-black tracking-[0.3em] uppercase ${isLatest ? 'text-[#C9B075]' : 'text-white/40'}`}>
                                                {s.id.includes('KDK') ? '정기 KDK 매치' : '스페셜 매치'}
                                            </span>
                                            <h2 className="text-2xl font-black italic tracking-tighter text-white uppercase group-hover:text-[#C9B075] transition-colors leading-none">
                                                {s.title}
                                            </h2>
                                        </div>
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]">
                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                                            <span className="text-[9px] font-black text-red-500/80 uppercase tracking-widest">LIVE</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4 border-t border-white/5 pt-6">
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1 font-mono">참가 인원</span>
                                            <span className="text-lg font-black text-white italic">{s.playerCount}<span className="text-[10px] ml-0.5 opacity-30">명</span></span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1 font-mono">진행 경기</span>
                                            <span className="text-lg font-black text-white italic">{s.matchCount}<span className="text-[10px] ml-0.5 opacity-30">회</span></span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-[8px] font-black text-white/20 uppercase tracking-widest mb-1 font-mono">상태</span>
                                            <span className="text-[10px] font-black text-[#C9B075] uppercase tracking-tighter mt-2">입장하기 ➡️</span>
                                        </div>
                                    </div>

                                    {/* Pulse Background */}
                                    {isLatest && (
                                        <div className="absolute inset-0 bg-gradient-to-tr from-[#C9B075]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>

                { (allActiveSessions.length === 0 || isAdmin) && (
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full px-8 pb-4">
                        <button
                            onClick={() => { 
                                if (!isAdmin) return triggerAccessDenied("새로운 경기는 관리자만 생성 가능합니다.");
                                setShowGateway(false); 
                                setStep(1); 
                                setSelectedSessionId(null); 
                                setMatches([]); 
                                setSessionId(""); 
                                setSessionTitle(""); 
                            }}
                            className="w-full py-5 rounded-full bg-white/5 border border-white/10 text-white/40 font-black text-[11px] uppercase tracking-[0.3em] active:scale-95 transition-all hover:bg-white/10 hover:text-white"
                        >
                            {isAdmin ? '+ 새로운 대회 생성하기' : '준비 된 경기가 없습니다'}
                        </button>
                    </div>
                )}
            </main>
        );
    }

    return (
        <main className="flex flex-col min-h-screen bg-gradient-to-br from-[#0a0a0b] via-[#121214] to-[#0a0a0b] text-white font-sans w-full relative pb-60" style={{ paddingBottom: "160px" }}>
            <header className="px-6 pt-4 flex items-center justify-between gap-4 mb-2 h-14 relative z-[100]">
                <div className="flex items-center gap-2">
                    {isAdmin && (
                        <div className="flex items-center gap-2 mr-2">
                             <div className="flex items-center gap-1.5 px-3 py-1 bg-[#C9B075] rounded-full shadow-[0_8px_20px_rgba(201,176,117,0.3)] border border-white/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                                <span className="text-[9px] font-[1000] text-black uppercase tracking-widest leading-none">ADMIN MODE</span>
                            </div>
                        </div>
                    )}
                    {isAdmin && (
                        <button
                            onClick={() => setShowResetConfirm(true)}
                            className="h-10 px-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                            title="전체 데이터 초기화"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-500"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                            <span className="text-[10px] font-black uppercase tracking-tighter">초기화</span>
                        </button>
                    )}
                    {allActiveSessions.length > 1 && (
                        <button
                            onClick={() => setShowGateway(true)}
                            className="h-10 px-4 rounded-full bg-[#C9B075]/10 border border-[#C9B075]/30 flex items-center gap-2 text-[#C9B075] hover:bg-[#C9B075]/20 transition-all active:scale-95 group shadow-[0_0_15px_rgba(201,176,117,0.1)]"
                        >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-60"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                            <span className="text-[10px] font-black uppercase tracking-tighter">다른 경기</span>
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={execCopySchedule} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20" title="대진표 공유">📋</button>
                    <button onClick={copyFinalResults} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20" title="결과 보고">🏆</button>
                </div>
            </header>

            <div
                className={`w-full px-5 flex flex-col gap-2 relative z-50 ${activeTab === 'RANKING' ? 'border-b border-white/5 pb-2 pt-2' : 'border-y border-white/10 py-6'}`}
                style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(32px)', boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}
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
                        {isAdmin && (
                            <button onClick={() => setShowMemberEditModal(true)} className="ml-1 text-[#C9B075]/60 hover:text-[#C9B075] text-[10px] hover:scale-110 transition-transform active:scale-90">⚙️</button>
                        )}
                    </div>
                </div>

                {/* LINE 2: RULES (Only in Matches) */}
                {activeTab === 'MATCHES' && (
                    <div className="flex items-center gap-1.5 pt-2 border-t border-white/5">
                        <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest shrink-0 [text-shadow:0_1px_2px_rgba(0,0,0,0.3)]">RULES:</span>
                        <span className="text-[10px] font-bold text-white tracking-tighter leading-tight italic uppercase truncate drop-shadow-sm">
                            1:1 시작, 노에드, 타이 3:3 (7포인트 선승)
                        </span>
                    </div>
                )}
            </div>

            <div className="flex-1 px-4 space-y-0 overflow-y-auto pb-60 no-scrollbar antialiased" style={{ background: '#14161a' }}>
                {activeTab === 'MATCHES' && (
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
                                            const p0 = mx.playerIds?.[0];
                                            if (!p0) return false;
                                            const pGroup = attendeeConfigs[p0]?.group || (allMembers || []).find(x => x.id === p0)?.position || 'A';
                                            const nGroup = (pGroup || 'A').toUpperCase().includes('B') ? 'B' : 'A';
                                            return nGroup === (m.groupName || 'A');
                                        }).sort((a, b) => {
                                            if (a.round !== b.round) return (a.round || 0) - (b.round || 0);
                                            return (a.id || '').localeCompare(b.id || '');
                                        });
                                        const matchNo = allMatchesInGroupSorted.findIndex(x => x.id === m.id) + 1;
                                        const normalizedGroup = m.groupName || 'A';
                                        const isGroupB = normalizedGroup === 'B';
                                        const groupColor = isGroupB ? '#00E5FF' : '#C9B075';
                                        const cardGlow = isGroupB ? '0 0 15px rgba(0, 229, 255, 0.2)' : '0 0 15px rgba(201, 176, 117, 0.05)';

                                        return (
                                            <div key={mId} className="rounded-[32px] relative flex flex-col justify-between h-full group transition-all overflow-hidden" style={{ transform: 'none', background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(64px)', border: 'none', borderTop: `2px solid ${isGroupB ? 'rgba(0, 229, 255, 0.3)' : 'rgba(255, 255, 255, 0.3)'}`, boxShadow: `0 20px 50px rgba(0,0,0,0.9), ${cardGlow}` }}>
                                                
                                                {/* SECTION HEADER BAR */}
                                                <div className="flex items-center justify-center px-4 py-2 bg-white/5 border-b border-white/10 overflow-hidden relative group/header">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <span className="text-[10px] font-mono font-bold tracking-[0.2em] uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" style={{ color: groupColor }}>
                                                            GROUP {normalizedGroup} • MATCH {matchNo.toString().padStart(2, '0')}
                                                        </span>
                                                        <RotateCw className={`w-3 h-3 transition-colors ${spinningMatchId === mId ? 'animate-spin' : 'opacity-40'}`} style={{ color: groupColor }} />
                                                    </div>
                                                    
                                                    {role === 'CEO' && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); if (window.navigator?.vibrate) window.navigator.vibrate(50); cancelMatch(mId); }}
                                                            className="absolute right-2 flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-90 hover:bg-white/5 group/refresh"
                                                            title="웨이팅 리스트로 복귀"
                                                        >
                                                            <div className="sr-only">Cancel Match</div>
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="p-2 flex flex-col justify-center flex-1 py-8">
                                                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 flex-grow">

                                                        {/* TEAM A BLOCK */}
                                                        <div className="relative bg-white/5 rounded-[18px] h-[68px] flex flex-col items-center justify-center border border-white/5 w-full overflow-hidden">
                                                            <div className="flex flex-col items-center justify-center w-full px-2 gap-0.5 min-w-0">
                                                                <span className="text-white font-black text-center leading-none relative z-0 truncate w-full flex-shrink" style={{ fontSize: '13px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                                                    {getPlayerName(m.playerIds[0])}
                                                                </span>
                                                                <span className="text-white font-black text-center leading-none relative z-0 truncate w-full flex-shrink" style={{ fontSize: '13px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                                                    {getPlayerName(m.playerIds[1])}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Sleek Success Toast */}
                                                        {showToast && (
                                                            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[2000] animate-in fade-in slide-in-from-bottom-4 duration-300 w-[90%] max-w-sm">
                                                                <div className="bg-[#1C1C1E] border border-[#D4AF37]/30 text-white px-6 py-3.5 rounded-2xl shadow-2xl flex items-center justify-center gap-3 backdrop-blur-xl">
                                                                    <div className="w-4 h-4 rounded-full bg-[#D4AF37]/20 flex items-center justify-center">
                                                                        <CheckCircle2 className={`w-3 h-3 ${toastMsg.includes('관리자') ? 'text-red-400' : 'text-[#4ADE80]'}`} />
                                                                    </div>
                                                                    <span className="text-[10px] font-black uppercase tracking-widest italic text-center">{toastMsg}</span>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="font-black text-[8px] uppercase text-center italic opacity-60 shrink-0" style={{ color: groupColor, filter: `drop-shadow(0 0 5px ${groupColor}4D)` }}>vs</div>

                                                        {/* TEAM B BLOCK */}
                                                        <div className="relative bg-white/5 rounded-[18px] h-[68px] flex flex-col items-center justify-center border border-white/5 w-full overflow-hidden">
                                                            <div className="flex flex-col items-center justify-center w-full px-2 gap-0.5 min-w-0">
                                                                <span className="text-white font-black text-center leading-none relative z-0 truncate w-full flex-shrink" style={{ fontSize: '13px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                                                    {getPlayerName(m.playerIds[2])}
                                                                </span>
                                                                <span className="text-white font-black text-center leading-none relative z-0 truncate w-full flex-shrink" style={{ fontSize: '13px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                                                    {getPlayerName(m.playerIds[3])}
                                                                </span>
                                                            </div>
                                                        </div>

                                                    </div>

                                                    {/* SCORE INPUT BUTTON (REFINED METALLIC OUTLINE) */}
                                                    <button
                                                        onClick={() => { 
                                                            if (!isAdmin) return triggerAccessDenied("결과는 관리자만 입력할 수 있습니다.");
                                                            if (window.navigator?.vibrate) window.navigator.vibrate(50); 
                                                            setTempScores({ s1: m.score1 ?? 1, s2: m.score2 ?? 1 }); 
                                                            setShowScoreModal(mId); 
                                                        }}
                                                        className="w-full h-11 bg-transparent border border-[#8E7A4A]/40 hover:bg-[#8E7A4A]/25 active:scale-95 transition-all rounded-[14px] flex items-center justify-center shrink-0"
                                                        style={{ background: 'linear-gradient(to right, rgba(142,122,74,0.1), transparent, rgba(142,122,74,0.1))', boxShadow: '0 0 15px rgba(142,122,74,0.2), inset 0 0 10px rgba(142,122,74,0.1)', filter: 'drop-shadow(0 0 5px rgba(142,122,74,0.3))' }}
                                                    >
                                                        <span className="bg-gradient-to-r from-[#8E7A4A] via-[#A89462] to-[#8E7A4A] bg-clip-text text-transparent text-[11px] font-black uppercase tracking-[0.25em]">{isAdmin ? 'INPUT SCORE 🏆' : 'LIVE BROADCAST 📡'}</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                        <div style={{ marginTop: '32px' }}>
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

                                    const isB = group === 'B';
                                    const col = isB ? '#00E5FF' : '#C9B075';

                                    return (
                                        <div key={group} className="space-y-3">
                                            <div className="flex flex-col" style={{ marginBottom: '16px', marginTop: '32px' }}>
                                                <h3 className="text-2xl font-black italic tracking-tighter uppercase text-white ml-2" style={{ filter: 'drop-shadow(0 2px 4px rgba(255,255,255,0.2))' }}>{isB ? 'BLUE' : 'GOLD'} WAITING</h3>
                                                <div className="mt-2 h-1.5 w-48 ml-2" style={{ background: `linear-gradient(to right, ${col}, ${col}33, transparent)` }} />
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
                                                        <div key={m.id} className="rounded-2xl active:scale-98 transition-all relative group grid grid-cols-[50px_1fr_80px] items-center overflow-hidden" style={{ transform: 'none', paddingLeft: '16px', paddingRight: '16px', paddingTop: '24px', paddingBottom: '24px', background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(64px)', border: 'none', borderTop: `2px solid ${isB ? 'rgba(0, 229, 255, 0.3)' : 'rgba(255, 255, 255, 0.3)'}`, boxShadow: `0 20px 50px rgba(0,0,0,0.9), 0 0 15px ${isB ? 'rgba(0, 229, 255, 0.1)' : 'rgba(201, 176, 117, 0.03)'}`, filter: `drop-shadow(0 0 10px ${col}33)` }}>
                                                            <div className="flex items-center justify-center">
                                                                <div className="w-9 h-9 text-black rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,0,0,0.2)] shrink-0 border border-white/20" style={{ background: `linear-gradient(135deg, ${col}, ${col}aa)` }}>
                                                                    <span className="text-[12px] font-black uppercase">G{matchNo}</span>
                                                                </div>
                                                            </div>

                                                            <div className="flex items-center justify-center gap-4 text-center px-2 min-w-0" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                                                <span className="flex-1 text-white font-bold truncate leading-none" style={{ fontSize: '17px' }}>
                                                                    {getPlayerName(m.playerIds[0]).replace(' (G)', '')}
                                                                    {getPlayerName(m.playerIds[0]).includes('(G)') && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic">(G)</span>}
                                                                    /
                                                                    {getPlayerName(m.playerIds[1]).replace(' (G)', '')}
                                                                    {getPlayerName(m.playerIds[1]).includes('(G)') && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic">(G)</span>}
                                                                </span>
                                                                <span className="text-[10px] font-black uppercase italic tracking-widest opacity-20 shrink-0" style={{ color: col }}>vs</span>
                                                                <span className="flex-1 text-white font-bold truncate leading-none" style={{ fontSize: '17px' }}>
                                                                    {getPlayerName(m.playerIds[2]).replace(' (G)', '')}
                                                                    {getPlayerName(m.playerIds[2]).includes('(G)') && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic">(G)</span>}
                                                                    /
                                                                    {getPlayerName(m.playerIds[3]).replace(' (G)', '')}
                                                                    {getPlayerName(m.playerIds[3]).includes('(G)') && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic">(G)</span>}
                                                                </span>
                                                            </div>

                                                            <div className="flex items-center justify-end pr-2">
                                                                <button
                                                                    onClick={() => { 
                                                                        if (!isAdmin) return triggerAccessDenied("경기 투입은 관리자만 제어할 수 있습니다.");
                                                                        if (window.navigator?.vibrate) window.navigator.vibrate(50); 
                                                                        startMatch(m.id); 
                                                                    }}
                                                                    className={`px-6 py-3.5 rounded-2xl text-[13px] font-black uppercase transition-all shadow-xl whitespace-nowrap active:scale-95 ${hasConflict && isAdmin ? 'bg-zinc-800 text-white/5 cursor-not-allowed' : '!text-black hover:opacity-90'}`}
                                                                    style={{ backgroundColor: hasConflict && isAdmin ? undefined : col, color: hasConflict && isAdmin ? undefined : '#000000', boxShadow: hasConflict && isAdmin ? 'none' : `0 4px 15px ${col}66` }}
                                                                >
                                                                    {isAdmin ? '투입 🚀' : '진행 대기'}
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
                            <div style={{ marginTop: '32px' }}>
                                <h3 className="text-2xl font-black italic tracking-tighter uppercase text-white ml-2" style={{ filter: 'drop-shadow(0 2px 4px rgba(255,255,255,0.2))' }}>COMPLETED MATCHES</h3>
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
                                            <div key={m.id} onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); setShowScoreModal(m.id); }} className="rounded-[24px] relative flex flex-col justify-between h-full group transition-all overflow-hidden" style={{ transform: 'none', background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(64px)', border: 'none', borderTop: '2px solid rgba(255, 255, 255, 0.15)', borderLeft: '1px solid rgba(255, 255, 255, 0.05)', boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.2), 0 20px 50px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.5)' }}>
                                                {/* SECTION HEADER BAR */}
                                                <div className="flex items-center justify-center gap-2 px-4 py-2 bg-white/5 border-b border-white/10 overflow-hidden relative">
                                                    <span className="text-[10px] font-mono font-bold tracking-[0.2em] uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]" style={{ color: m.groupName === 'B' ? '#00E5FF' : '#C9B075' }}>
                                                        GROUP {(m.groupName || 'A')} • MATCH {gMatchNo.toString().padStart(2, '0')}
                                                    </span>
                                                    <div className="absolute right-4 h-2 w-2 rounded-full bg-[#10B981]/20 border border-[#10B981]/30 opacity-40 shrink-0" />
                                                </div>

                                                <div className="flex-1 flex flex-col justify-center px-3 py-8">
                                                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 w-full">
                                                        <div className="flex flex-col items-center justify-center min-w-0">
                                                            <span className="text-white/70 font-black text-center leading-tight truncate w-full" style={{ fontSize: '12px' }}>{getPlayerName(m.playerIds[0])}</span>
                                                            <span className="text-white/70 font-black text-center leading-tight truncate w-full" style={{ fontSize: '12px' }}>{getPlayerName(m.playerIds[1])}</span>
                                                        </div>
                                                        <div className="flex flex-col items-center flex-shrink-0 px-2">
                                                            <span className="text-lg font-black text-[#C9B075] leading-none">{m.score1}:{m.score2}</span>
                                                            <span className="text-[6px] font-black text-white/20 uppercase mt-1">FINAL</span>
                                                        </div>
                                                        <div className="flex flex-col items-center justify-center min-w-0">
                                                            <span className="text-white/70 font-black text-center leading-tight truncate w-full" style={{ fontSize: '12px' }}>{getPlayerName(m.playerIds[2])}</span>
                                                            <span className="text-white/70 font-black text-center leading-tight truncate w-full" style={{ fontSize: '12px' }}>{getPlayerName(m.playerIds[3])}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="pb-3 text-center transition-all duration-300">
                                                    <span className="text-[8px] font-black text-white/30 uppercase tracking-[0.3em] group-hover:text-[#C9B075]/60 group-hover:tracking-[0.4em] transition-all">TAP TO EDIT ✎</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}
                {activeTab === 'RANKING' && (
                    <div className="flex-1 animate-in fade-in slide-in-from-bottom-5 duration-500">
                        <RankingTab
                            players={allPlayersInRanking}
                            sessionTitle={sessionTitle}
                            isArchive={false}
                            isAdmin={isAdmin}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                            onShareMatch={execCopySchedule}
                            onShareResult={copyFinalResults}
                            onFinalize={handleFinalArchive}
                            isGenerating={isGenerating}
                            ceremonyMode={showCeremony}
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
                        <RankingTab
                            players={allPlayersInRanking}
                            sessionTitle={sessionTitle}
                            isArchive={false}
                            isAdmin={role === 'CEO'}
                            prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                            onShareMatch={execCopySchedule}
                            onShareResult={copyFinalResults}
                            onFinalize={handleFinalArchive}
                            isGenerating={isGenerating}
                            ceremonyMode={showCeremony}
                        />
                    </div>
                </div>
            )}

            {activeMatchForScore && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/85 backdrop-blur-md" onClick={() => setShowScoreModal(null)}></div>
                    <div className="relative w-full max-w-lg rounded-[40px] p-8 pb-10 animate-in fade-in zoom-in duration-300 max-h-[95vh] overflow-y-auto no-scrollbar flex flex-col" style={{ background: 'rgba(18, 20, 24, 0.95)', backdropFilter: 'blur(64px)', borderTop: '2px solid rgba(255, 255, 255, 0.2)', boxShadow: '0 50px 100px rgba(0,0,0,0.9)' }}>
                        <header className="flex flex-col items-center gap-2 text-center px-4 shrink-0" style={{ marginBottom: '28px' }}>
                            <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.5em] uppercase opacity-80">Match Protocol</span>
                            <div className="mt-2 py-3 px-10 bg-[#C9B075]/10 rounded-2xl border border-[#C9B075]/20 shadow-[0_0_30px_rgba(201,176,117,0.1)]">
                                <h3 className="text-xl font-black italic text-white tracking-tight uppercase flex items-center gap-3">
                                    <span className="text-[#C9B075]">🏆</span> WINNER SELECTION
                                </h3>
                            </div>
                        </header>

                        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-6" style={{ marginBottom: '4px' }}>
                            {[0, 1].map(side => (
                                <React.Fragment key={side}>
                                    <div className="flex flex-col gap-10">
                                        <div className="flex flex-col items-center text-center px-1">
                                            <span className="text-3xl font-black text-white leading-[1.1] mb-2" style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.8))' }}>
                                                {getPlayerName(activeMatchForScore.playerIds[side * 2])}<br />{getPlayerName(activeMatchForScore.playerIds[side * 2 + 1])}
                                            </span>
                                            <div className="h-1 w-12 bg-[#C9B075] rounded-full mt-3 shadow-[0_0_10px_rgba(201,176,117,0.5)]" />
                                        </div>

                                        <div className="text-8xl font-black bg-gradient-to-b from-white to-white/40 bg-clip-text text-transparent text-center mb-4" style={{ filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.6))' }}>
                                            {side === 0 ? tempScores.s1 : tempScores.s2}
                                        </div>

                                        <div className="grid grid-cols-3 gap-3 px-1">
                                            {[0, 1, 2, 3, 4, 5, 6].map(n => (
                                                <button
                                                    key={n}
                                                    onClick={() => {
                                                        if (window.navigator?.vibrate) window.navigator.vibrate(50);
                                                        const val = Math.min(6, Math.max(0, n));
                                                        setTempScores(p => side === 0 ? ({ ...p, s1: val }) : ({ ...p, s2: val }));
                                                    }}
                                                    className="h-14 rounded-xl text-xl font-black transition-all active:scale-90"
                                                    style={{
                                                        background: (side === 0 ? tempScores.s1 : tempScores.s2) === n ? 'rgba(201, 176, 117, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                                        color: (side === 0 ? tempScores.s1 : tempScores.s2) === n ? '#C9B075' : 'rgba(255, 255, 255, 0.15)',
                                                        border: (side === 0 ? tempScores.s1 : tempScores.s2) === n ? '1px solid rgba(201, 176, 117, 0.5)' : '1px solid transparent',
                                                        boxShadow: (side === 0 ? tempScores.s1 : tempScores.s2) === n ? '0 0 20px rgba(201, 176, 117, 0.4)' : 'inset 0 1px 1px rgba(255, 255, 255, 0.1)'
                                                    }}
                                                >
                                                    {n}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {side === 0 && <div className="w-px bg-white/10 my-4" />}
                                </React.Fragment>
                            ))}
                        </div>

                        <div className="flex gap-4 px-4 shrink-0" style={{ marginTop: '32px', marginBottom: '8px' }}>
                            <button onClick={() => setShowScoreModal(null)} className="flex-1 h-20 bg-white/5 border border-white/5 text-white/30 font-black rounded-[24px] uppercase text-[10px] tracking-[0.2em] active:scale-95 transition-all">Cancel</button>
                            <button
                                disabled={tempScores.s1 === tempScores.s2}
                                onClick={() => finishMatch(activeMatchForScore.id, tempScores.s1, tempScores.s2)}
                                className="flex-[3] h-20 text-black font-black rounded-[24px] uppercase text-2xl tracking-[0.2em] shadow-xl disabled:opacity-20 active:scale-95 transition-all border border-white/20"
                                style={{
                                    background: 'linear-gradient(to right, #8E7A4A, #A89462, #8E7A4A)',
                                    boxShadow: '0 10px 40px rgba(142,122,74,0.5), inset 0 0 20px rgba(255,255,255,0.2)'
                                }}
                            >
                                Confirm Score 🏆
                            </button>
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
            {showArchiveSuccess && (
                <div className="fixed inset-0 z-[5000] bg-black flex flex-col items-center justify-center animate-in fade-in duration-1000">
                    {/* [v10.0] Golden Confetti Sprinkling */}
                    <div className="absolute inset-0 pointer-events-none z-[5001] overflow-hidden">
                        {[...Array(50)].map((_, i) => (
                            <div 
                                key={i} 
                                className="absolute top-[-20px] w-2 h-2 rounded-full animate-bounce" 
                                style={{ 
                                    left: `${Math.random() * 100}%`, 
                                    animation: `falling ${2 + Math.random() * 3}s linear infinite`,
                                    background: i % 2 === 0 ? '#C9B075' : '#E5D29B',
                                    opacity: Math.random(),
                                    transform: `scale(${0.5 + Math.random()})`
                                }} 
                            />
                        ))}
                    </div>
                    <style jsx>{`
                        @keyframes falling {
                            0% { transform: translateY(-10vh) rotate(0deg); }
                            100% { transform: translateY(110vh) rotate(720deg); }
                        }
                    `}</style>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#C9B075]/30 via-transparent to-transparent" />
                    <div className="relative z-10 flex flex-col items-center text-center px-12 space-y-8">
                        <div className="w-40 h-40 rounded-full bg-[#C9B075]/10 border-2 border-[#C9B075]/50 flex items-center justify-center animate-bounce shadow-[0_0_80px_rgba(201,176,117,0.5)]">
                            <span className="text-8xl drop-shadow-2xl">🏆</span>
                        </div>
                        <div className="space-y-4">
                            <h2 className="text-5xl font-black italic text-white uppercase tracking-tighter drop-shadow-[0_0_30px_rgba(201,176,117,0.8)]">
                                Championship<br />Archived
                            </h2>
                            <p className="text-[#C9B075] text-xs font-black uppercase tracking-[0.6em] animate-pulse">
                                대회가 명예의 전당에 박제되었습니다
                            </p>
                        </div>
                        <div className="flex gap-3">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="w-2 h-2 rounded-full bg-[#C9B075] animate-ping" style={{ animationDelay: `${i * 0.2}s` }} />
                            ))}
                        </div>
                    </div>
                </div>
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

function WarningModal({ message, onClose }: { message: string, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 bg-black/70 backdrop-blur-md animate-in fade-in duration-300">
            <div className="w-full max-w-sm bg-[#1A1C20] border border-white/10 rounded-[40px] p-8 shadow-[0_30px_100px_rgba(0,0,0,0.9)] flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-300">
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-4xl shadow-[0_0_30px_rgba(239,68,68,0.2)]">⚠️</div>
                <div className="space-y-2">
                    <h3 className="text-xl font-black text-white italic tracking-tighter uppercase">Security Warning</h3>
                    <p className="text-sm font-bold text-white/60 leading-relaxed whitespace-pre-wrap px-2">{message}</p>
                </div>
                <button onClick={onClose} className="w-full py-4 bg-[#C9B075] text-black font-black rounded-[20px] shadow-xl active:scale-95 transition-all text-xs uppercase tracking-widest border border-white/20">확인 완료</button>
            </div>
        </div>
    );
}

function CustomConfirmModal({ title, message, onConfirm, onCancel }: { title: string, message: string, onConfirm: () => void, onCancel: () => void }) {
    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
            <div className="w-full max-w-sm bg-[#1A1C20] border border-white/10 rounded-[40px] p-10 shadow-[0_40px_100px_rgba(0,0,0,0.9)] flex flex-col items-center text-center space-y-8 animate-in zoom-in-95 duration-300">
                <div className="w-24 h-24 rounded-full bg-red-600/10 border border-red-600/20 flex items-center justify-center text-5xl shadow-[0_0_40px_rgba(220,38,38,0.2)]">⚔️</div>
                <div className="space-y-3">
                    <h3 className="text-2xl font-black text-red-500 italic tracking-tighter uppercase">{title}</h3>
                    <p className="text-base font-bold text-white/60 leading-relaxed px-2">{message}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full pt-10">
                    <button onClick={onCancel} className="py-8 bg-white/5 text-white/40 font-black rounded-[24px] active:scale-95 transition-all uppercase tracking-widest border border-white/10 text-lg">취소</button>
                    <button onClick={onConfirm} className="py-8 bg-red-600 text-white font-black rounded-[24px] shadow-[0_20px_50px_rgba(220,38,38,0.5)] active:scale-95 transition-all uppercase tracking-widest border border-red-500/20 text-lg">데이터 초기화</button>
                </div>
            </div>
        </div>
    );
}
