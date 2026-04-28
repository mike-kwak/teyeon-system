'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Match, Member, AttendeeConfig, RankedPlayer } from '@/lib/tournament_types';
import { useRanking } from '@/hooks/useRanking';
import MemberSelector from '@/components/tournament/MemberSelector';
import RankingTab from '@/components/RankingTab';

import { WarningModal, CustomConfirmModal } from '@/components/tournament/Modals';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import { Trash2, Plus, Play, CheckCircle2, Trophy, LayoutGrid, Save, Calendar, Sparkles, RotateCw, ArrowLeft, Clock, Target, Layers, ClipboardCheck, Info, Search } from 'lucide-react';
import { PlayingMatchCard, WaitingMatchCard, CompletedMatchCard } from '@/components/tournament/LiveCourtCards';
import { ScoreEntryModal } from '@/components/tournament/ScoreEntryModal';

export default function SpecialMatchPage() {
    const router = useRouter();
    const { role } = useAuth();
    const isAdmin = role === 'CEO' || role === 'ADMIN';

    const [step, setStep] = useState(0);
    const [allMembers, setAllMembers] = useState<Member[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [tempGuests, setTempGuests] = useState<Member[]>([]);
    const [isMembersLoading, setIsMembersLoading] = useState(true);
    const [isMembersError, setIsMembersError] = useState(false);

    // Manual Drafting State
    const [draftSlots, setDraftSlots] = useState<(string | null)[]>([null, null, null, null]);
    const [draftGroup, setDraftGroup] = useState<'A' | 'B'>('A');
    const [matchQueue, setMatchQueue] = useState<Match[]>([]);
    const [sessionId, setSessionId] = useState<string>(() => `SP-${Date.now()}`);
    const [sessionTitle, setSessionTitle] = useState("");
    
    // Scoring State
    const [activeMatchForScore, setActiveMatchForScore] = useState<Match | null>(null);
    const [tempScores, setTempScores] = useState({ s1: 0, s2: 0 });
    
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isStartingMatch, setIsStartingMatch] = useState(false);
    const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [bankFilter, setBankFilter] = useState<'ALL' | 'A' | 'B'>('ALL');
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'RANKING'>('MATCHES');
    
    // Configuration Aligned with KDK Production
    const [totalCourts, setTotalCourts] = useState(1);
    const [matchMins, setMatchMins] = useState(30);
    const [firstPrize, setFirstPrize] = useState(10000);
    const [bottom25Late, setBottom25Late] = useState(3000);
    const [bottom25Penalty, setBottom25Penalty] = useState(5000);
    
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, AttendeeConfig>>({});

    // [v5.7] FORCE CACHE BUSTING & VERSION SYNC
    useEffect(() => {
        const VERSION = "6.2";
        const savedVersion = localStorage.getItem('teyeon_special_version');
        if (savedVersion !== VERSION) {
            localStorage.setItem('teyeon_special_version', VERSION);
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
            }
            window.location.reload();
        }
    }, []);

    const selectedMembersList = useMemo(() => {
        const combined = [...allMembers, ...tempGuests];
        return combined.filter(m => selectedIds.has(m.id));
    }, [allMembers, tempGuests, selectedIds]);

    const { ranking: allPlayersInRanking, playerStats } = useRanking(
        matchQueue,
        allMembers,
        tempGuests,
        selectedIds,
        attendeeConfigs
    );

    const [isCheckingDB, setIsCheckingDB] = useState(false);

    useEffect(() => {
        fetchMembers();
        loadSession();
    }, []);

    const loadSession = async () => {
        setIsCheckingDB(true);
        // 1. Try Server Data First (for cross-device sync)
        try {
            const { data: serverSessions } = await supabase
                .from('teyeon_special_sessions')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1);

            if (serverSessions && serverSessions.length > 0) {
                const latest = serverSessions[0];
                const diff = Date.now() - new Date(latest.created_at).getTime();
                if (diff < 24 * 60 * 60 * 1000) { // Within 24h
                    const raw = latest.raw_data;
                    setMatchQueue(raw.matches || []);
                    setSessionId(latest.session_id);
                    setSessionTitle(raw.sessionTitle);
                    setSelectedIds(new Set(raw.selectedIds || []));
                    setTempGuests(raw.tempGuests || []);
                    setAttendeeConfigs(raw.attendeeConfigs || {});
                    setStep(4);
                    setIsCheckingDB(false);
                    return;
                }
            }
        } catch (e) { console.error("Server sync failed:", e); }

        // 2. Fallback to Local Storage
        const saved = localStorage.getItem('special_live_session');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                setMatchQueue(data.matches || []);
                setSessionId(data.sessionId);
                setSessionTitle(data.sessionTitle);
                setSelectedIds(new Set(data.selectedIds || []));
                setTempGuests(data.tempGuests || []);
                if (data.attendeeConfigs) setAttendeeConfigs(data.attendeeConfigs);
                if (data.matches?.length > 0) setStep(4);
            } catch (e) { console.error(e); }
        }
        setIsCheckingDB(false);
    };

    const syncCurrentQueueToDB = async (queue: Match[]) => {
        try {
            const payload = {
                sessionId,
                sessionTitle,
                matches: queue,
                selectedIds: Array.from(selectedIds),
                tempGuests,
                attendeeConfigs,
                timestamp: new Date().toISOString()
            };

            // [v5.7] FULL SESSION CLOUD SYNC
            await supabase.from('teyeon_special_sessions').upsert({
                session_id: sessionId,
                raw_data: payload,
                created_at: new Date().toISOString()
            }, { onConflict: 'session_id' });

            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const dbMatches = queue.map((m, idx) => ({
                ...m, 
                round: m.round || (idx + 1), 
                session_id: sessionId, 
                club_id: clubId, 
                session_title: sessionTitle, 
                status: m.status || 'waiting', 
                mode: 'SPECIAL',
                player_names: m.playerIds.map(pid => getPlayerName(pid))
            }));
            await supabase.rpc('sync_tournament_matches', { p_matches: dbMatches });
        } catch (e) { console.error("Real-time Sync Error:", e); }
    };

    const checkDBForActiveSession = async () => {
        setIsCheckingDB(true);
        try {
            // Broad search for any active matches with SP- prefix
            const { data, error } = await supabase
                .from('matches')
                .select('*')
                .eq('mode', 'SPECIAL')
                .ilike('session_id', 'SP-%')
                .in('status', ['playing', 'waiting'])
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) throw error;

            if (data && data.length > 0) {
                const latestSid = data[0].session_id;
                const latestTitle = data[0].session_title;
                const sessionMatches = data.filter(m => m.session_id === latestSid);
                
                if (confirm(`[클라우드 동기화] 진행 중인 세션(${latestTitle})을 발견했습니다. 불러오시겠습니까?`)) {
                    const reconstructedQueue = sessionMatches.map(m => {
                        const pIds = m.player_ids || m.playerIds || [];
                        return {
                            ...m,
                            playerIds: pIds,
                            teams: m.teams || [[pIds[0], pIds[1]], [pIds[2], pIds[3]]]
                        };
                    });
                    
                    const allPlayerIdsInSession = new Set(reconstructedQueue.flatMap(m => m.playerIds));
                    setMatchQueue(reconstructedQueue);
                    setSessionId(latestSid);
                    setSessionTitle(latestTitle);
                    setSelectedIds(allPlayerIdsInSession);
                    setStep(4);
                    
                    const sessionData = {
                        sessionId: latestSid, sessionTitle: latestTitle, matches: reconstructedQueue, 
                        selectedIds: Array.from(allPlayerIdsInSession), tempGuests: [], attendeeConfigs: {},
                        prizes: { firstPrize, bottom25Late, bottom25Penalty },
                        constraints: { totalCourts, matchMins }
                    };
                    localStorage.setItem('special_live_session', JSON.stringify(sessionData));
                } else {
                    alert("새 세션을 시작합니다.");
                }
            } else {
                alert("활성화된 수동 모드 세션을 찾을 수 없습니다. PC에서 대진 생성을 진행 중인지 확인해 주세요.");
            }
        } catch (e: any) {
            console.error("Session Recovery Error:", e);
            alert("동기화 실패: " + e.message);
        } finally {
            setIsCheckingDB(false);
        }
    };

    const fetchMembers = async () => {
        try {
            setIsMembersLoading(true);
            const { data, error } = await supabase.from('members').select('*').order('nickname');
            if (error) throw error;
            setAllMembers(data || []);
        } catch (err) {
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
            const member = [...allMembers, ...tempGuests].find(m => m.id === id);
            if (member && !attendeeConfigs[id]) {
                setAttendeeConfigs(prev => ({
                    ...prev,
                    [id]: {
                        id,
                        name: member.nickname,
                        age: member.age || 99,
                        group: (member.position || '').toUpperCase().includes('B') ? 'B' : 'A',
                        startTime: '19:00',
                        endTime: '22:00'
                    }
                }));
            }
        }
        setSelectedIds(next);
    };

    const findNextAvailableTitle = async () => {
        const d = new Date();
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const prefix = `${yy}${mm}${dd}_SPECIAL_`;
        try {
            const { data: serverData } = await supabase.from('teyeon_archive_v1').select('raw_data').order('created_at', { ascending: false }).limit(10);
            const serverTitles = (serverData || []).map(d => d.raw_data?.title || '');
            let maxSuffix = 0;
            const regex = new RegExp(`^${prefix}(\\d{2})$`);
            serverTitles.forEach(t => {
                const match = t.match(regex);
                if (match) {
                    const suffix = parseInt(match[1]);
                    if (suffix > maxSuffix) maxSuffix = suffix;
                }
            });
            setSessionTitle(`${prefix}${String(maxSuffix + 1).padStart(2, '0')}`);
        } catch (err) { setSessionTitle(`${prefix}01`); }
    };

    const handleStep1Confirm = () => {
        if (selectedIds.size < 4) { alert("최소 4명의 참가자가 필요합니다."); return; }
        findNextAvailableTitle();
        setStep(2);
    };

    const startMatchBuilder = () => { setStep(3); };

    const handleReorder = (newOrder: Match[]) => {
        setMatchQueue(newOrder);
        syncCurrentQueueToDB(newOrder); // Cloud Sync
        setIsOptimizing(true);
        setTimeout(() => setIsOptimizing(false), 800);
    };

    const addToDraft = (id: string) => {
        const firstEmpty = draftSlots.indexOf(null);
        if (firstEmpty === -1) return;
        const next = [...draftSlots];
        next[firstEmpty] = id;
        setDraftSlots(next);
    };

    const removeFromDraft = (index: number) => {
        const next = [...draftSlots];
        next[index] = null;
        setDraftSlots(next);
    };

    const addMatchToQueue = () => {
        if (draftSlots.includes(null)) { alert("4명의 선수를 모두 채워주세요."); return; }
        
        // [v6.1] Automated Round Calculation based on Courts & Groups
        const groupMatches = matchQueue.filter(m => m.group === draftGroup);
        const slotsPerGroupPerRound = Math.max(1, Math.floor(totalCourts / 2));
        const calculatedRound = Math.floor(groupMatches.length / slotsPerGroupPerRound) + 1;

        const newMatch: Match = {
            id: `special-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            playerIds: draftSlots as string[],
            court: null, status: 'waiting', mode: 'SPECIAL', 
            round: calculatedRound,
            group: draftGroup,
            teams: [[draftSlots[0]!, draftSlots[1]!], [draftSlots[2]!, draftSlots[3]!]]
        };
        const nextQueue = [...matchQueue, newMatch];
        setMatchQueue(nextQueue);
        syncCurrentQueueToDB(nextQueue); // Cloud Sync
        setDraftSlots([null, null, null, null]);
    };

    const removeMatchFromQueue = (id: string) => { 
        const nextQueue = matchQueue.filter(m => m.id !== id);
        setMatchQueue(nextQueue); 
        syncCurrentQueueToDB(nextQueue); // Cloud Sync
    };

    const startSpecialSession = async () => {
        if (matchQueue.length === 0) { alert("최소 1개 이상의 대진이 필요합니다."); return; }
        setIsSubmitting(true);
        try {
            const payload = {
                sessionId,
                sessionTitle,
                matches: matchQueue,
                selectedIds: Array.from(selectedIds),
                tempGuests,
                attendeeConfigs,
                timestamp: new Date().toISOString()
            };

            // [v5.7] FINAL SERVER SYNC
            await supabase.from('teyeon_special_sessions').upsert({
                session_id: sessionId,
                raw_data: payload,
                created_at: new Date().toISOString()
            }, { onConflict: 'session_id' });

            localStorage.setItem('special_live_session', JSON.stringify(payload));
            setStep(4);
        } catch (err: any) { 
            console.error("Sync Logic Failure:", err.message); 
            setStep(4); // Fallback to local
        } finally {
            setIsSubmitting(false);
        }
    };

    const getPlayerName = (id: string) => {
        const p = [...allMembers, ...tempGuests].find(m => m.id === id);
        if (p) return p.nickname + (p.is_guest ? ' (G)' : '');
        
        // [v5.1] Rescue Full Names for Guests
        if (id.includes('iseul')) return "강이슬 (G)";
        if (id.includes('hoyoung')) return "장호영 (G)";
        if (id.includes('jinhee')) return "주진희 (G)";
        if (id.includes('heungki')) return "민흥기 (G)";
        if (id.includes('eunji')) return "황은지 (G)";
        
        return '???';
    };

    const PlayerNameBadge = ({ id }: { id: string }) => {
        const name = getPlayerName(id);
        const isGuest = name.includes('(G)');
        const cleanName = name.replace(' (G)', '');
        return (<span className="truncate">{cleanName}{isGuest && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic font-medium">(G)</span>}</span>);
    };

    const handleStartMatch = async (matchId: string) => {
        if (isStartingMatch) return;
        
        // Safety Checks
        const playingMatches = matchQueue.filter(m => m.status === 'playing');
        if (playingMatches.length >= totalCourts) {
            alert(`이미 설정된 모든 코트(${totalCourts}개)가 사용 중입니다. 기존 경기를 종료해주세요.`);
            return;
        }

        const target = matchQueue.find(m => m.id === matchId);
        if (!target) return;
        const playingPlayerIds = new Set(playingMatches.flatMap(m => m.playerIds));
        const conflictingPlayers = target.playerIds.filter(pid => playingPlayerIds.has(pid));
        if (conflictingPlayers.length > 0) {
            const names = conflictingPlayers.map(pid => getPlayerName(pid)).join(', ');
            alert(`선수 중복: ${names} 선수가 이미 다른 경기에서 플레이 중입니다.`);
            return;
        }

        setIsStartingMatch(true);
        const nextQueue = matchQueue.map(m => m.id === matchId ? { ...m, status: 'playing' as const } : m);
        setMatchQueue(nextQueue);
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const dbMatch = { ...target, status: 'playing' as const, session_id: sessionId, club_id: clubId, session_title: sessionTitle, player_names: target.playerIds.map(pid => getPlayerName(pid)) };
            await supabase.rpc('sync_tournament_matches', { p_matches: [dbMatch] });
        } catch (e) { console.error("Sync Error:", e); } finally {
            setIsStartingMatch(false);
        }
    };

    const updateMatchScore = async (matchId: string, s1: number, s2: number) => {
        const nextQueue = matchQueue.map(m => m.id === matchId ? { ...m, score1: s1, score2: s2, status: 'complete' as const } : m);
        setMatchQueue(nextQueue);
        setActiveMatchForScore(null);
        localStorage.setItem('special_live_session', JSON.stringify({ sessionId, sessionTitle, matches: nextQueue, selectedIds: Array.from(selectedIds), tempGuests, attendeeConfigs, prizes: { firstPrize, bottom25Late, bottom25Penalty }, constraints: { totalCourts, matchMins } }));
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const target = nextQueue.find(m => m.id === matchId)!;
            const dbMatch = { ...target, session_id: sessionId, club_id: clubId, session_title: sessionTitle, player_names: target.playerIds.map(pid => getPlayerName(pid)) };
            await supabase.rpc('sync_tournament_matches', { p_matches: [dbMatch] });
        } catch (e) { console.error("Sync Error:", e); }
    };

    const handleFinalArchive = async () => {
        if (!confirm("모든 경기가 완료되었습니다. 아카이브에 박제하시겠습니까?")) return;
        setIsSubmitting(true);
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const archiveData = {
                id: sessionId, title: sessionTitle, date: new Date().toISOString().split('T')[0], club_id: clubId, type: 'CUSTOM',
                snapshot_data: matchQueue.map(m => ({ ...m, player_names: m.playerIds.map(pid => getPlayerName(pid)) })),
                ranking_data: allPlayersInRanking, prizes: { firstPrize, bottom25Late, bottom25Penalty },
                player_metadata: Array.from(selectedIds).reduce((acc, id) => {
                    const m = [...allMembers, ...tempGuests].find(x => x.id === id);
                    const config = attendeeConfigs[id];
                    acc[id] = { name: m?.nickname, avatar: m?.avatar_url, age: config?.age || m?.age || 99, group: config?.group || 'A' };
                    return acc;
                }, {} as any)
            };
            const { error } = await supabase.from('teyeon_archive_v1').insert([{ id: sessionId, raw_data: archiveData }]);
            if (error) throw error;
            localStorage.removeItem('special_live_session');
            setShowArchiveSuccess(true);
            setTimeout(() => { router.push('/archive'); }, 3000);
        } catch (err: any) { alert("아카이브 실패: " + err.message); } finally { setIsSubmitting(false); }
    };

    const execCopySchedule = () => {
        const text = `[${sessionTitle}] 스페셜 매치 대진표\n` + matchQueue.map((m, i) => `G${i+1}: ${getPlayerName(m.playerIds[0])}, ${getPlayerName(m.playerIds[1])} vs ${getPlayerName(m.playerIds[2])}, ${getPlayerName(m.playerIds[3])}`).join('\n');
        navigator.clipboard.writeText(text); alert("대진표가 클립보드에 복사되었습니다. 📋");
    };

    const copyFinalResults = () => {
        const text = `[${sessionTitle}] 스페셜 매치 최종 결과\n` + allPlayersInRanking.map((p, i) => `${i+1}위: ${p.name} (${p.wins}승 ${p.losses}패, 득실 ${p.diff})`).join('\n');
        navigator.clipboard.writeText(text); alert("최종 결과가 클립보드에 복사되었습니다. 🏆");
    };

    if (step === 0) {
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full max-w-[480px] mx-auto pb-20 overflow-hidden relative">
                <header className="px-8 pt-20 pb-12 flex flex-col items-center text-center">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-1.5 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-6"><Sparkles size={14} className="text-[#C9B075]" /><span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase">Selection Protocol</span></motion.div>
                    <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-[42px] font-[1000] italic text-white tracking-[-0.05em] uppercase leading-none">SPECIAL MATCHES</motion.h1>
                    <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-[11px] font-black text-white/30 tracking-[0.2em] uppercase mt-3">SELECT YOUR OPTIMIZED TOURNAMENT PROTOCOL</motion.p>
                </header>
                <div className="px-8 space-y-6">
                    <motion.button initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} onClick={() => setStep(1)} className="w-full group relative overflow-hidden rounded-[40px] h-[170px] text-left border-2 border-[#C9B075]/30 hover:border-[#C9B075] transition-all active:scale-[0.98] shadow-2xl bg-[#0A0A0A]/80 backdrop-blur-2xl">
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                        <div className="relative z-10 h-full flex items-center justify-between px-10"><div className="flex-1 pr-4 space-y-2"><h3 className="text-[32px] font-[1000] italic text-[#C9B075] tracking-tight uppercase leading-none">MANUAL MODE</h3><p className="text-[12px] font-black text-white/50 leading-snug tracking-tight">수동 매칭 및 직접 점수 입력</p></div><div className="w-16 h-16 shrink-0 rounded-[24px] bg-[#C9B075]/10 border border-[#C9B075]/20 flex items-center justify-center text-[#C9B075] group-hover:scale-110 transition-transform"><LayoutGrid size={32} strokeWidth={2.5} /></div></div>
                    </motion.button>
                </div>
            </main>
        );
    }

    if (step === 1) {
        return (
            <MemberSelector allMembers={allMembers} tempGuests={tempGuests} selectedIds={selectedIds} isMembersLoading={isMembersLoading} isMembersError={isMembersError} title="스페셜 매치" onToggle={toggleMember} onAddGuest={(name) => { const guest: Member = { id: `g-${Date.now()}`, nickname: name, is_guest: true }; setTempGuests(prev => [...prev, guest]); const next = new Set(selectedIds); next.add(guest.id); setSelectedIds(next); }} onFetchMembers={fetchMembers} onConfirm={handleStep1Confirm} onReset={() => setShowResetConfirm(true)} onRestore={(data) => { setMatchQueue(data.matches || []); setSessionId(data.sessionId); setSessionTitle(data.sessionTitle); setSelectedIds(new Set(data.selectedIds || [])); setTempGuests(data.tempGuests || []); setAttendeeConfigs(data.attendeeConfigs || {}); setStep(2); }} onBack={() => setStep(0)} sessionKey="special_live_session" />
        );
    }

    // --- [STEP 2] Settings Dashboard ---
    if (step === 2) {
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative">
                <header className="grid grid-cols-3 px-6 mb-4 items-center h-28 shrink-0 pt-8 max-w-lg mx-auto w-full">
                    <div className="flex items-center"><button onClick={() => setStep(1)} className="w-10 h-10 rounded-full flex items-center justify-center border border-[#C9B075]/30 bg-[#C9B075]/10 text-[#C9B075] active:scale-95 transition-all shadow-[0_0_15px_rgba(201,176,117,0.1)]"><ArrowLeft size={18} /></button></div>
                    <div className="text-center flex flex-col items-center gap-2">
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-2 leading-none scale-90">Step 02</span>
                            <h1 className="text-3xl font-black italic tracking-tighter uppercase whitespace-nowrap text-white leading-none">경기 대진 설정</h1>
                        </div>
                    </div>
                </header>

                <div className="px-6 space-y-12 max-w-lg mx-auto w-full">
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2"><span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" /><h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Archive Title</h3></div>
                        <input type="text" value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-[24px] px-6 py-5 text-base font-black text-white outline-none focus:border-[#C9B075]/50 focus:bg-white/10 transition-all" />
                    </section>

                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px' }}>
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-[13px] font-bold text-[#C9B075] tracking-[0.3em] uppercase flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-[#C9B075]" />ATTENDEE MATRIX</h3>
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{attendees.length} ACTIVE</span>
                        </div>
                        <div className="space-y-3">
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                return (
                                    <div key={m.id} style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '24px', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <span style={{ fontSize: '15px', fontWeight: 900, color: 'rgba(255,255,255,0.95)' }}>{m.name}{m.is_guest ? ' (G)' : ''}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#0A0A0A', borderRadius: '14px', padding: '6px 12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                    <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '14px', fontWeight: 800, outline: 'none', appearance: 'none', textAlign: 'center', width: '48px', cursor: 'pointer' }}>{timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}</select>
                                                    <span style={{ color: '#6B7280', fontSize: '10px', fontWeight: 900 }}>TO</span>
                                                    <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '14px', fontWeight: 800, outline: 'none', appearance: 'none', textAlign: 'center', width: '48px', cursor: 'pointer' }}>{timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}</select>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))} className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm transition-all border ${config.group === 'A' ? 'bg-[#C9B075] text-black border-transparent' : 'bg-black text-white/40 border-white/10'}`}>A</button>
                                                <button onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))} className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm transition-all border ${config.group === 'B' ? 'bg-[#00E5FF] text-black border-transparent' : 'bg-black text-white/40 border-white/10'}`}>B</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px' }}>
                         <div className="space-y-10">
                            <div className="space-y-6">
                                <h3 className="text-[13px] font-bold text-[#C9B075] uppercase tracking-[0.3em] flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-[#C9B075]" />CONSTRAINTS</h3>
                                <div className="space-y-4">
                                    <div className="bg-[#141414] border border-white/5 rounded-[24px] p-6 flex items-center justify-between">
                                        <span className="text-[14px] font-[1000] text-white/70 uppercase tracking-tight">TOTAL COURTS</span>
                                        <div className="flex items-center gap-6">
                                            <button onClick={() => setTotalCourts(p => Math.max(1, p - 1))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">-</button>
                                            <span className="text-2xl font-black text-[#C9B075] w-10 text-center">{totalCourts}</span>
                                            <button onClick={() => setTotalCourts(p => p + 1)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">+</button>
                                        </div>
                                    </div>
                                    <div className="bg-[#141414] border border-white/5 rounded-[24px] p-6 flex items-center justify-between">
                                        <span className="text-[14px] font-[1000] text-white/70 uppercase tracking-tight">MATCH MINS</span>
                                        <div className="flex items-center gap-6">
                                            <button onClick={() => setMatchMins(p => Math.max(5, p - 5))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">-</button>
                                            <span className="text-2xl font-black text-[#C9B075] w-10 text-center">{matchMins}</span>
                                            <button onClick={() => setMatchMins(p => p + 5)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-6 pt-8 border-t border-white/5">
                                <h3 className="text-[13px] font-bold text-[#10b981] uppercase tracking-[0.3em] flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-[#10b981]" />FINANCIALS</h3>
                                <div className="space-y-4">
                                    <div className="bg-[#141414] border border-white/5 rounded-[24px] p-6 flex items-center justify-between">
                                        <span className="text-[14px] font-[1000] text-white/70 uppercase tracking-tight">Prize Gold</span>
                                        <div className="flex items-center gap-6">
                                            <button onClick={() => setFirstPrize(p => Math.max(0, p - 5000))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">-</button>
                                            <span className="text-2xl font-black text-white w-16 text-center">{(firstPrize/1000).toFixed(0)}k</span>
                                            <button onClick={() => setFirstPrize(p => p + 5000)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">+</button>
                                        </div>
                                    </div>
                                    <div className="bg-[#141414] border border-white/5 rounded-[24px] p-6 flex items-center justify-between">
                                        <div className="flex flex-col"><span className="text-[14px] font-[1000] text-[#C9B075] uppercase tracking-tight">Tier 1 Fine</span><span className="text-[9px] font-bold text-white/20">BOTTOM 25%~50%</span></div>
                                        <div className="flex items-center gap-6">
                                            <button onClick={() => setBottom25Late(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">-</button>
                                            <span className="text-2xl font-black text-white w-16 text-center">{(bottom25Late/1000).toFixed(0)}k</span>
                                            <button onClick={() => setBottom25Late(p => p + 1000)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">+</button>
                                        </div>
                                    </div>
                                    <div className="bg-[#141414] border border-white/5 rounded-[24px] p-6 flex items-center justify-between">
                                        <div className="flex flex-col"><span className="text-[14px] font-[1000] text-rose-500 uppercase tracking-tight">Tier 2 Fine</span><span className="text-[9px] font-bold text-white/20">BOTTOM 0%~25%</span></div>
                                        <div className="flex items-center gap-6">
                                            <button onClick={() => setBottom25Penalty(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">-</button>
                                            <span className="text-2xl font-black text-white w-16 text-center">{(bottom25Penalty/1000).toFixed(0)}k</span>
                                            <button onClick={() => setBottom25Penalty(p => p + 1000)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold active:scale-90 transition-all">+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                         </div>
                    </section>
                    
                    <div className="h-80" />
                </div>

                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[420px] px-6 z-[999]">
                    <button onClick={startMatchBuilder} className="w-full h-20 rounded-[40px] bg-black border-2 border-[#C9B075] text-white font-[1000] text-lg uppercase tracking-wider shadow-[0_15px_40px_rgba(0,0,0,0.8)] active:scale-95 transition-all flex items-center justify-center gap-3"><span>매뉴얼 대진 생성 시작!</span><span className="text-2xl">🚀</span></button>
                </div>
            </main>
        );
    }

    // --- [STEP 3] Manual Match Builder ---
    if (step === 3) {
        const selectedIdsInManual = draftSlots.filter(id => id !== null) as string[];
        const availableMembers = selectedMembersList.filter(m => !draftSlots.includes(m.id));
        
        // [v5.3] Group Filtering Logic
        const filteredBank = availableMembers.filter(m => {
            if (bankFilter === 'ALL') return true;
            const config = attendeeConfigs[m.id];
            return (config?.group || 'A') === bankFilter;
        });

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative">
                <header className="px-8 pt-8 mb-6 max-w-lg mx-auto w-full flex items-center justify-between">
                    <button onClick={() => setStep(2)} className="p-3 bg-white/5 rounded-2xl text-white/40 active:scale-90 transition-all"><ArrowLeft size={20} /></button>
                    <div className="text-center flex flex-col items-center">
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase leading-none mb-2">MANUAL BUILDER v5.3</span>
                        <h1 className="text-xl font-black italic tracking-tighter text-white uppercase truncate max-w-[200px] leading-none">{sessionTitle}</h1>
                    </div>
                    <button onClick={() => setShowResetConfirm(true)} className="p-3 bg-red-500/10 rounded-2xl text-red-500 active:scale-95 transition-all"><Trash2 size={18} /></button>
                </header>

                <div className="px-8 space-y-12 max-w-lg mx-auto w-full">
                    {/* PLAYER BANK WITH GROUP FILTER */}
                    <section className="min-h-[140px]">
                        <div className="flex items-center justify-between mb-8 px-1">
                            <div className="flex items-center gap-3">
                                <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">Player Bank</h3>
                                <span className="text-[9px] font-bold text-white/20 uppercase">{filteredBank.length} Avail</span>
                            </div>
                            
                            {/* [v5.3] Group Filter Toggles */}
                            <div className="flex items-center bg-white/5 rounded-full p-1 border border-white/10 scale-90 origin-right">
                                {(['ALL', 'A', 'B'] as const).map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setBankFilter(f)}
                                        className={`px-4 py-1.5 rounded-full text-[10px] font-black transition-all ${bankFilter === f ? 'bg-[#C9B075] text-black shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                                    >
                                        {f === 'ALL' ? 'ALL' : f + '조'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {filteredBank.length === 0 ? (
                                <p className="text-white/20 text-[12px] font-bold italic w-full text-center py-10 border border-dashed border-white/5 rounded-3xl">No members available in this group</p>
                            ) : (
                                filteredBank.map(m => (
                                    <button
                                        key={m.id}
                                        onClick={() => addToDraft(m.id)}
                                        className="h-12 px-6 rounded-2xl font-black text-[14px] tracking-tight bg-black border border-white/10 text-white/80 active:scale-95 hover:border-[#C9B075]/40 hover:text-white transition-all shadow-xl"
                                    >
                                        {m.nickname}
                                        <div className={`absolute top-1 right-2 w-1.5 h-1.5 rounded-full ${ (attendeeConfigs[m.id]?.group || 'A') === 'B' ? 'bg-[#00E5FF]' : 'bg-[#C9B075]' } opacity-40`} />
                                    </button>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="bg-[#141414] rounded-[48px] p-10 border border-white/5 shadow-2xl relative">
                        <div className="flex flex-col items-center mb-10 gap-4">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase opacity-40">Group Assignment</h3>
                            <div className="flex bg-black/50 p-1 rounded-2xl border border-white/10 w-full max-w-[200px]">
                                <button onClick={() => setDraftGroup('A')} className={`flex-1 py-3 rounded-xl text-sm font-black transition-all ${draftGroup === 'A' ? 'bg-[#C9B075] text-black shadow-lg' : 'text-white/40'}`}>A조</button>
                                <button onClick={() => setDraftGroup('B')} className={`flex-1 py-3 rounded-xl text-sm font-black transition-all ${draftGroup === 'B' ? 'bg-[#00E5FF] text-black shadow-lg' : 'text-white/40'}`}>B조</button>
                            </div>
                        </div>

                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-8">
                            <div className="space-y-4">{[0, 1].map(i => (<div key={i} onClick={() => removeFromDraft(i)} className="h-32 rounded-[36px] bg-black/60 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group hover:border-[#C9B075]/30 transition-all">{draftSlots[i] ? (<motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center"><span className="font-black text-white text-[18px] tracking-tight">{getPlayerName(draftSlots[i]!)}</span><div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/10 text-red-500 text-[9px] font-black uppercase text-center opacity-0 group-hover:opacity-100 transition-opacity">REMOVE</div></motion.div>) : (<Plus className="text-white/5" size={32} />)}</div>))}</div>
                            <div className="flex flex-col items-center gap-2"><div className="w-px h-20 bg-gradient-to-b from-transparent via-[#C9B075]/20 to-transparent" /><span className="text-[#C9B075] font-black italic text-5xl opacity-10 tracking-widest">VS</span><div className="w-px h-20 bg-gradient-to-t from-transparent via-[#C9B075]/20 to-transparent" /></div>
                            <div className="space-y-4">{[2, 3].map(i => (<div key={i} onClick={() => removeFromDraft(i)} className="h-32 rounded-[36px] bg-black/60 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group hover:border-[#C9B075]/30 transition-all">{draftSlots[i] ? (<motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center"><span className="font-black text-white text-[18px] tracking-tight">{getPlayerName(draftSlots[i]!)}</span><div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/10 text-red-500 text-[9px] font-black uppercase text-center opacity-0 group-hover:opacity-100 transition-opacity">REMOVE</div></motion.div>) : (<Plus className="text-white/5" size={32} />)}</div>))}</div>
                        </div>
                        <button onClick={addMatchToQueue} disabled={draftSlots.includes(null)} className={`w-full mt-10 py-6 font-black rounded-[30px] border active:scale-95 transition-all text-[13px] uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-10 ${draftGroup === 'A' ? 'bg-[#C9B075]/10 border-[#C9B075]/20 text-[#C9B075]' : 'bg-[#00E5FF]/10 border-[#00E5FF]/20 text-[#00E5FF]'}`}><Plus size={18} strokeWidth={4} /> Add to {draftGroup} Queue</button>
                    </section>

                    <section>
                         <div className="flex items-center justify-between mb-8 px-1">
                            <h3 className="text-[10px] font-black text-white/30 tracking-[0.3em] uppercase">{matchQueue.length} Matches Planned</h3>
                        </div>
                        <Reorder.Group axis="y" values={matchQueue} onReorder={handleReorder} className="space-y-4 px-1">
                            {matchQueue.map((m, idx) => (
                                <Reorder.Item key={m.id} value={m} className={`rounded-[30px] grid grid-cols-[60px_1fr_60px] items-center p-7 bg-white/5 border shadow-xl cursor-grab active:cursor-grabbing mb-2 transition-all ${m.group === 'B' ? 'border-cyan-500/20' : 'border-white/5'}`}>
                                    <div className="flex items-center justify-center"><div className={`w-10 h-10 rounded-full flex items-center justify-center border ${m.group === 'B' ? 'bg-cyan-500/20 text-cyan-500 border-cyan-500/20' : 'bg-white/10 text-[#C9B075] border-[#C9B075]/20'}`}><span className="text-[13px] font-black italic">{m.group === 'B' ? 'B' : 'G'}{idx + 1}</span></div></div>
                                    <div className="flex items-center justify-center gap-4 text-center px-2 min-w-0"><span className="flex-1 text-white font-black truncate text-right text-[16px]"><PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} /></span><span className={`text-[10px] font-black uppercase italic tracking-widest opacity-20 ${m.group === 'B' ? 'text-cyan-500' : 'text-[#C9B075]'}`}>vs</span><span className="flex-1 text-white font-black truncate text-left text-[16px]"><PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} /></span></div>
                                    <div className="flex items-center justify-end"><button onClick={() => removeMatchFromQueue(m.id)} className="p-3 text-white/20 hover:text-red-500 transition-all active:scale-90"><Trash2 size={18} /></button></div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    </section>
                    <div className="h-80" />
                </div>

                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[420px] px-6 z-[999]">
                    <button disabled={isSubmitting || matchQueue.length === 0} onClick={startSpecialSession} className="w-full h-20 bg-black border-2 border-[#C9B075] text-white font-[1000] rounded-[40px] flex items-center justify-center gap-4 shadow-[0_15px_40px_rgba(0,0,0,0.8)] active:scale-95 transition-all disabled:opacity-20 uppercase tracking-[0.2em] text-[13px] italic"><Play fill="white" size={24} /> <span>SYNC & START LIVE COURT 🏁</span></button>
                </div>
            </main>
        );
    }

    // --- [STEP 4] Live Court (Absolute 1:1 Parity) ---
    if (step === 4) {
        const groupAMatches = matchQueue.filter(m => (m.group || 'A') === 'A' && m.status === 'waiting');
        const groupBMatches = matchQueue.filter(m => m.group === 'B' && m.status === 'waiting');
        const playingMatches = matchQueue.filter(m => m.status === 'playing');
        const completedMatches = matchQueue.filter(m => m.status === 'complete');
        const playingPlayerIds = new Set(playingMatches.flatMap(m => m.playerIds));

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative pb-60" style={{ paddingBottom: "160px" }}>
                {/* [v5.5] MASTER HEADER (1:1 KDK IDENTITY) */}
                <header className="px-6 py-4 flex items-center justify-between h-18 relative z-[200] bg-[#09090B] border-b border-white/5 shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl">
                    <div className="flex-1 flex items-center gap-4">
                        {isAdmin && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-[#C9B075] border-[#C9B075] text-black shadow-[0_5px_15px_rgba(201,176,117,0.3)]">
                                <div className="w-2 h-2 rounded-full bg-black animate-pulse" />
                                <span className="text-[9px] font-[1000] uppercase tracking-widest">ADMIN</span>
                            </div>
                        )}
                    </div>
                    <div className="flex-[2] flex flex-col items-center">
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase opacity-40 leading-none mb-1">Special Session</span>
                        <h1 className="text-xl sm:text-2xl font-black italic tracking-tighter text-white uppercase truncate max-w-[200px] leading-none">
                            {sessionTitle || 'SPECIAL MATCH'}
                        </h1>
                    </div>
                    <div className="flex-1 flex items-center justify-end gap-3">
                        <button onClick={execCopySchedule} className="w-8 h-8 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-[#C9B075]">📋</button>
                        <button onClick={copyFinalResults} className="w-8 h-8 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-[#C9B075]">🏆</button>
                    </div>
                </header>

                <div className="w-full px-5 flex flex-col gap-2 relative z-50 py-4 border-b border-white/10" style={{ background: 'rgba(9, 9, 11, 0.85)', backdropFilter: 'blur(32px)' }}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1"><span className="text-[8px] font-black text-[#C9B075] opacity-50 uppercase">WIN:</span><span className="text-[9px] font-bold text-white">{firstPrize/1000}K</span></div>
                            <div className="flex items-center gap-1 ml-2"><span className="text-[8px] font-black text-[#C9B075] opacity-50 uppercase">PEN:</span><span className="text-[9px] font-bold text-white">{bottom25Penalty/1000}K</span></div>
                        </div>
                        <div className="flex items-center gap-3 overflow-hidden">
                            <span className="text-[9px] font-bold text-white/60 italic uppercase truncate whitespace-nowrap">1:1 시작, 노애드, 타이 3:3 시작</span>
                            {isAdmin && <button onClick={() => setStep(2)} className="text-[#C9B075]/40 text-[10px]">⚙️</button>}
                        </div>
                    </div>
                </div>

                <div className="flex-1 px-4 overflow-y-auto no-scrollbar" style={{ background: '#14161a' }}>
                    {activeTab === 'MATCHES' ? (
                        <div className="flex flex-col gap-10 py-8">
                            {/* NOW PLAYING */}
                            <section>
                                <div className="flex flex-col mb-4">
                                    <h2 className="text-xl font-black italic tracking-tighter uppercase text-white ml-2">NOW PLAYING</h2>
                                    <div className="mt-2 h-1 w-32 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" />
                                </div>
                                {playingMatches.length === 0 ? (
                                    <div className="py-16 text-center text-white/20 border border-dashed border-white/10 rounded-2xl text-[12px] uppercase font-black tracking-widest">WAITING FOR NEXT ROUND...</div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3">
                                        {playingMatches.map((m, idx) => (
                                            <div key={m.id} className="relative">
                                                <div className="absolute -top-2 left-4 z-50 bg-[#C9B075] text-black text-[9px] font-[1000] px-2 py-0.5 rounded-full shadow-lg italic">ROUND {m.round || idx + 1}</div>
                                                <PlayingMatchCard 
                                                    match={m} 
                                                    matchNo={idx + 1} 
                                                    getPlayerName={getPlayerName} 
                                                    isAdmin={isAdmin}
                                                    onInputScore={(id, s1, s2) => { setTempScores({ s1, s2 }); setActiveMatchForScore(matchQueue.find(x => x.id === id) || null); }}
                                                    onCancel={(id) => { if (confirm("취소하시겠습니까?")) setMatchQueue(prev => prev.map(mx => mx.id === id ? { ...mx, status: 'waiting' } : mx)); }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            {/* WAITING (Grouped by Round) */}
                            {['A', 'B'].map(group => {
                                const groupMatches = group === 'A' ? groupAMatches : groupBMatches;
                                if (groupMatches.length === 0) return null;
                                
                                // Group by round
                                const matchesByRound: Record<number, Match[]> = {};
                                groupMatches.forEach(m => {
                                    const r = m.round || 1;
                                    if (!matchesByRound[r]) matchesByRound[r] = [];
                                    matchesByRound[r].push(m);
                                });
                                const sortedRounds = Object.keys(matchesByRound).map(Number).sort((a, b) => a - b);
                                const col = group === 'B' ? '#00E5FF' : '#C9B075';

                                return (
                                    <section key={group} className="flex flex-col gap-6 mb-12">
                                        <div className="flex flex-col mb-2">
                                            <h3 className="text-xl font-black italic tracking-tighter uppercase text-white ml-2">{group === 'B' ? 'BLUE WAITING' : 'GOLD WAITING'}</h3>
                                            <div className="mt-2 h-1 w-32 ml-2" style={{ background: `linear-gradient(to right, ${col}, transparent)` }} />
                                        </div>

                                        {sortedRounds.map(roundNum => (
                                            <div key={roundNum} className="space-y-4">
                                                {/* Round Separator Line */}
                                                <div className="flex items-center gap-4 px-2 py-4">
                                                    <div className="h-px flex-1 bg-white/10" />
                                                    <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.4em] italic">ROUND {roundNum}</span>
                                                    <div className="h-px flex-1 bg-white/10" />
                                                </div>
                                                
                                                <div className="flex flex-col gap-3">
                                                    {matchesByRound[roundNum].map((m) => {
                                                        const globalIdx = matchQueue.findIndex(x => x.id === m.id);
                                                        return (
                                                            <WaitingMatchCard 
                                                                key={m.id} 
                                                                match={m} 
                                                                index={globalIdx} 
                                                                matchNo={globalIdx + 1} 
                                                                getPlayerName={getPlayerName} 
                                                                isAdmin={isAdmin} 
                                                                isStartingMatch={isStartingMatch} 
                                                                hasConflict={playingMatches.length >= totalCourts || m.playerIds.some(pid => playingPlayerIds.has(pid))} 
                                                                onStart={handleStartMatch} 
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </section>
                                );
                            })}

                            {/* COMPLETED */}
                            {completedMatches.length > 0 && (
                                <section>
                                    <div className="flex flex-col mb-4">
                                        <h3 className="text-xl font-black italic tracking-tighter uppercase text-white ml-2">COMPLETED MATCHES</h3>
                                        <div className="mt-2 h-1 w-32 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {completedMatches.map((m, idx) => (
                                            <CompletedMatchCard 
                                                key={m.id} 
                                                match={m} 
                                                index={idx} 
                                                getPlayerName={getPlayerName} 
                                                isAdmin={isAdmin}
                                                onResetStatus={(id) => { if (confirm("복구하시겠습니까?")) setMatchQueue(prev => prev.map(mx => mx.id === id ? { ...mx, status: 'playing', score1: 1, score2: 1 } : mx)); }}
                                                onEdit={(match) => { setTempScores({ s1: match.score1 || 0, s2: match.score2 || 0 }); setActiveMatchForScore(match); }}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>
                    ) : (
                        <div className="py-8">
                            <RankingTab players={allPlayersInRanking} sessionTitle={sessionTitle} isArchive={false} isAdmin={isAdmin} prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }} onShareMatch={execCopySchedule} onShareResult={copyFinalResults} onFinalize={handleFinalArchive} isGenerating={isSubmitting} />
                        </div>
                    )}
                </div>

                <nav className="fixed bottom-24 bg-white/5 backdrop-blur-2xl border border-white/10 shadow-[0_20px_100px_rgba(0,0,0,0.8)] left-1/2 -translate-x-1/2 rounded-[32px] p-2 w-[94%] max-w-[440px] flex items-center justify-between gap-3 z-[200]">
                    <button onClick={() => setActiveTab('MATCHES')} className={`flex-1 rounded-[24px] py-6 flex items-center justify-center transition-all ${activeTab === 'MATCHES' ? 'bg-[#C9B075]/10 text-[#C9B075] font-black text-[22px] border border-[#C9B075]/30' : 'text-white/40 font-bold text-[20px]'}`}>🔥 MATCHES</button>
                    <button onClick={() => setActiveTab('RANKING')} className={`flex-1 rounded-[24px] py-6 flex items-center justify-center transition-all ${activeTab === 'RANKING' ? 'bg-white/10 text-white font-black text-[22px] border border-white/20' : 'text-white/40 font-bold text-[20px]'}`}>📊 RANKING</button>
                </nav>

                {activeMatchForScore && (
                    <ScoreEntryModal match={activeMatchForScore} tempScores={tempScores} setTempScores={setTempScores} onSave={(matchId, s1, s2) => updateMatchScore(matchId, s1, s2)} onCancel={() => setActiveMatchForScore(null)} getPlayerName={getPlayerName} />
                )}
            </main>
        );
    }

    return (
        <AnimatePresence>
            {showResetConfirm && (
                <div className="fixed inset-0 z-[4000] flex items-center justify-center px-8 bg-black/90 backdrop-blur-md">
                    <div className="w-full max-w-[360px] bg-[#141414] rounded-[40px] p-8 border border-white/10 shadow-2xl text-center">
                        <h3 className="text-xl font-black italic tracking-tighter text-white uppercase mb-4">RESET SESSION?</h3>
                        <p className="text-sm text-white/40 font-bold leading-relaxed mb-10">진행 중인 모든 대진과 설정이 초기화됩니다.<br />정말 초기화하시겠습니까?</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => { setMatchQueue([]); setSelectedIds(new Set()); setTempGuests([]); setDraftSlots([null, null, null, null]); setShowResetConfirm(false); localStorage.removeItem('special_live_session'); setStep(0); }} className="w-full py-5 bg-red-500 text-white font-black rounded-full active:scale-95 transition-all uppercase tracking-widest text-sm">초기화 진행</button>
                            <button onClick={() => setShowResetConfirm(false)} className="w-full py-4 text-white/20 font-black uppercase tracking-widest text-[10px]">취소</button>
                        </div>
                    </div>
                </div>
            )}
        </AnimatePresence>
    );
}
