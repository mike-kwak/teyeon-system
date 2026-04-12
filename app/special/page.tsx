
'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Member, Match } from '@/lib/tournament_types';
import MemberSelector from '@/components/tournament/MemberSelector';
import RankingTab from '@/components/RankingTab';

import { WarningModal, CustomConfirmModal } from '@/components/tournament/Modals';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import { Trash2, GripVertical, Plus, Play, CheckCircle2, Trophy, LayoutGrid, Save, Calendar, Sparkles } from 'lucide-react';

export default function SpecialMatchPage() {
    const router = useRouter();
    const { role, hasPermission, getRestrictionMessage } = useAuth();
    const isAdmin = role === 'CEO' || role === 'Staff' || role === 'ADMIN';

    const [step, setStep] = useState(0);
    const [selectedMode, setSelectedMode] = useState<string | null>(null);
    const [allMembers, setAllMembers] = useState<Member[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [tempGuests, setTempGuests] = useState<Member[]>([]);
    const [isMembersLoading, setIsMembersLoading] = useState(true);
    const [isMembersError, setIsMembersError] = useState(false);

    // Manual Drafting State
    const [draftSlots, setDraftSlots] = useState<(string | null)[]>([null, null, null, null]);
    const [matchQueue, setMatchQueue] = useState<Match[]>([]);
    const [sessionId, setSessionId] = useState<string>(() => `SP-${Date.now()}`);
    const [sessionTitle, setSessionTitle] = useState("");
    
    // Scoring State
    const [activeMatchForScore, setActiveMatchForScore] = useState<Match | null>(null);
    const [tempScores, setTempScores] = useState({ s1: 0, s2: 0 });
    
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showWarning, setShowWarning] = useState(false);
    const [warningMsg, setWarningMsg] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'RANKING'>('MATCHES');
    const [activeMatchTab, setActiveMatchTab] = useState<'NOW' | 'WAITING' | 'COMPLETED'>('NOW');
    
    // Financial Tier System (Aligned with KDK)
    const [firstPrize, setFirstPrize] = useState(10000);
    const [bottom25Late, setBottom25Late] = useState(3000);
    const [bottom25Penalty, setBottom25Penalty] = useState(5000);
    const [accountInfo, setAccountInfo] = useState("정산 계좌를 입력하세요");
    
    // Attendee Configuration (Aligned with KDK for Age sorting)
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, any>>({});

    const playerStats = useMemo(() => {
        const stats: Record<string, { id: string, name: string, wins: number, losses: number, diff: number, pf: number, pa: number }> = {};
        
        // Initialize for all selected players
        Array.from(selectedIds).forEach(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            stats[id] = { id, name: m?.nickname || "Unknown", wins: 0, losses: 0, diff: 0, pf: 0, pa: 0 };
        });

        matchQueue.filter(m => m.status === 'complete').forEach(m => {
            const s1 = m.score1 || 0;
            const s2 = m.score2 || 0;

            m.playerIds.forEach((pid, idx) => {
                if (!stats[pid]) return;
                const isTeam1 = idx < 2;
                const win = isTeam1 ? (s1 > s2) : (s2 > s1);
                
                if (win) {
                    stats[pid].wins++;
                } else {
                    stats[pid].losses++;
                }
                stats[pid].diff += isTeam1 ? (s1 - s2) : (s2 - s1);
                stats[pid].pf += isTeam1 ? s1 : s2;
                stats[pid].pa += isTeam1 ? s2 : s1;
            });
        });

        return stats;
    }, [matchQueue, selectedIds, allMembers, tempGuests]);

    const allPlayersInRanking = useMemo(() => {
        return Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            const conf = attendeeConfigs[id] || { age: m?.age || 99 };
            return {
                id,
                name: m?.nickname || "Unknown",
                is_guest: !!m?.is_guest,
                age: conf.age || m?.age || 99,
                ...(playerStats[id] || { wins: 0, losses: 0, diff: 0, pf: 0, pa: 0 })
            };
        }).sort((a, b) => 
            (b.wins - a.wins) || 
            (b.diff - a.diff) || 
            ((a.age || 99) - (b.age || 99))
        );
    }, [playerStats, selectedIds, allMembers, tempGuests, attendeeConfigs]);


    useEffect(() => {
        fetchMembers();
        const saved = localStorage.getItem('special_live_session');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                if (data.sessionId) {
                    // If already a session, maybe redirect to Live Court?
                    // For now just allow editing
                    setMatchQueue(data.matches || []);
                    setSessionId(data.sessionId);
                    setSessionTitle(data.sessionTitle);
                    setSelectedIds(new Set(data.selectedIds || []));
                    setTempGuests(data.tempGuests || []);
                    if (data.attendeeConfigs) setAttendeeConfigs(data.attendeeConfigs);
                    if (data.prizes) {
                        setFirstPrize(data.prizes.firstPrize);
                        setBottom25Late(data.prizes.bottom25Late);
                        setBottom25Penalty(data.prizes.bottom25Penalty);
                    }
                    if (data.matches && data.matches.length > 0) {
                        setStep(3); // Jump to Live if session is active
                    }
                }
            } catch (e) { console.error(e); }
        }
    }, []);

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
            const member = allMembers.find(m => m.id === id);
            if (member && !attendeeConfigs[id]) {
                setAttendeeConfigs(prev => ({
                    ...prev,
                    [id]: {
                        id,
                        name: member.nickname,
                        age: member.age || 99,
                        isWinner: (member.achievements || '').includes('우승')
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
            const { data: serverData } = await supabase
                .from('teyeon_archive_v1')
                .select('raw_data')
                .order('created_at', { ascending: false })
                .limit(20);
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
        } catch (err) {
            setSessionTitle(`${prefix}01`);
        }
    };

    const handleStep1Confirm = () => {
        if (selectedIds.size < 4) {
            alert("최소 4명의 참가자가 필요합니다.");
            return;
        }
        findNextAvailableTitle();
        setStep(2);
    };

    const handleReorder = (newOrder: Match[]) => {
        setMatchQueue(newOrder);
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
        if (draftSlots.includes(null)) {
            alert("4명의 선수를 모두 채워주세요.");
            return;
        }
        const newMatch: Match = {
            id: `special-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            playerIds: draftSlots as string[],
            court: null,
            status: 'waiting',
            mode: 'SPECIAL',
            round: matchQueue.length + 1,
            teams: [
                [draftSlots[0]!, draftSlots[1]!],
                [draftSlots[2]!, draftSlots[3]!]
            ]
        };
        setMatchQueue(prev => [...prev, newMatch]);
        setDraftSlots([null, null, null, null]);
    };

    const removeMatchFromQueue = (id: string) => {
        setMatchQueue(prev => prev.filter(m => m.id !== id));
    };

    const startSpecialSession = async () => {
        if (matchQueue.length === 0) {
            alert("최소 1개 이상의 대진이 필요합니다.");
            return;
        }

        setIsSubmitting(true);
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const dbMatches = matchQueue.map((m, idx) => ({
                ...m,
                round: idx + 1,
                session_id: sessionId,
                club_id: clubId,
                session_title: sessionTitle,
                status: m.status || 'waiting', // Default to waiting
                player_names: m.playerIds.map(pid => getPlayerName(pid))
            }));

            const { error } = await supabase.rpc('sync_tournament_matches', { p_matches: dbMatches });
            if (error) throw error;

            // Save to LocalStorage
            const sessionData = {
                sessionId,
                sessionTitle,
                matches: matchQueue,
                selectedIds: Array.from(selectedIds),
                tempGuests,
                attendeeConfigs,
                prizes: { firstPrize, bottom25Late, bottom25Penalty }
            };
            localStorage.setItem('special_live_session', JSON.stringify(sessionData));

            setStep(3); // Go to Live Dashboard
            alert("스페셜 매치 라이브 세션이 시작되었습니다! 📡");
        } catch (err: any) {
            alert("동기화 실패: " + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const getPlayerName = (id: string) => {
        const m = [...allMembers, ...tempGuests].find(x => x.id === id);
        return m?.nickname || "Unknown";
    };

    const handleStartMatch = async (matchId: string) => {
        const nextQueue = matchQueue.map(m => 
            m.id === matchId ? { ...m, status: 'live' as const } : m
        );
        setMatchQueue(nextQueue);
        
        // Push update to DB
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const target = nextQueue.find(m => m.id === matchId)!;
            const dbMatch = {
                ...target,
                session_id: sessionId,
                club_id: clubId,
                status: 'live',
                session_title: sessionTitle,
                player_names: target.playerIds.map(pid => getPlayerName(pid))
            };
            await supabase.rpc('sync_tournament_matches', { p_matches: [dbMatch] });
        } catch (e) {
            console.error("Sync Error:", e);
        }
    };

    const updateMatchScore = async (matchId: string, s1: number, s2: number) => {
        const nextQueue = matchQueue.map(m => 
            m.id === matchId ? { ...m, score1: s1, score2: s2, status: 'complete' as const } : m
        );
        setMatchQueue(nextQueue);
        setActiveMatchForScore(null);

        // Auto-save to local and try sync
        const sessionData = {
            sessionId,
            sessionTitle,
            matches: nextQueue,
            selectedIds: Array.from(selectedIds),
            tempGuests
        };
        localStorage.setItem('special_live_session', JSON.stringify(sessionData));

        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const target = nextQueue.find(m => m.id === matchId)!;
            const dbMatch = {
                ...target,
                session_id: sessionId,
                club_id: clubId,
                session_title: sessionTitle,
                player_names: target.playerIds.map(pid => getPlayerName(pid))
            };
            await supabase.rpc('sync_tournament_matches', { p_matches: [dbMatch] });
        } catch (e) {
            console.error("Sync Error:", e);
        }
    };

    const handleFinalArchive = async () => {
        if (!confirm("모든 경기가 완료되었습니다. 아카이브에 박제하시겠습니까?")) return;
        setIsSubmitting(true);
        
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            
            // Build Ranking Data for Archive (Simple win/loss calculation)
            const stats: Record<string, { id: string, name: string, wins: number, losses: number, diff: number }> = {};
            matchQueue.forEach(m => {
                m.playerIds.forEach((pid, i) => {
                    if (!stats[pid]) stats[pid] = { id: pid, name: getPlayerName(pid), wins: 0, losses: 0, diff: 0 };
                    const s1 = m.score1 || 0, s2 = m.score2 || 0;
                    const win = (i < 2) ? (s1 > s2) : (s2 > s1);
                    if (win) stats[pid].wins++; else stats[pid].losses++;
                    stats[pid].diff += (i < 2) ? (s1 - s2) : (s2 - s1);
                });
            });

            const archiveData = {
                id: sessionId,
                title: sessionTitle,
                date: new Date().toISOString().split('T')[0],
                club_id: clubId,
                type: 'CUSTOM',
                snapshot_data: matchQueue.map(m => ({
                    ...m,
                    player_names: m.playerIds.map(pid => getPlayerName(pid))
                })),
                ranking_data: allPlayersInRanking, // Use pre-sorted players with age
                prizes: { firstPrize, bottom25Late, bottom25Penalty },
                player_metadata: Array.from(selectedIds).reduce((acc, id) => {
                    const m = [...allMembers, ...tempGuests].find(x => x.id === id);
                    acc[id] = { 
                        name: m?.nickname, 
                        avatar: m?.avatar_url,
                        age: attendeeConfigs[id]?.age || m?.age || 99
                    };
                    return acc;
                }, {} as any)
            };


            const { error } = await supabase.from('teyeon_archive_v1').insert([{ id: sessionId, raw_data: archiveData }]);
            if (error) throw error;

            // Mark as finished locally
            localStorage.removeItem('special_live_session');
            setShowArchiveSuccess(true);
            setTimeout(() => {
                router.push('/archive');
            }, 3000);
        } catch (err: any) {
            alert("아카이브 실패: " + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (step === 0) {
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full max-w-[480px] mx-auto pb-20 overflow-hidden relative">
                {/* Background Shimmer Elements */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#C9B075]/5 rounded-full blur-[120px] -z-10" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#C9B075]/3 rounded-full blur-[100px] -z-10" />

                <header className="px-8 pt-20 pb-12 flex flex-col items-center text-center">
                    <motion.div 
                        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 px-4 py-1.5 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-6"
                    >
                        <Sparkles size={14} className="text-[#C9B075]" />
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase">Selection Protocol</span>
                    </motion.div>
                    <motion.h1 
                        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                        className="text-4xl font-black italic text-white tracking-tighter uppercase leading-tight"
                    >
                        어떤 게임을<br />진행하시겠습니까?
                    </motion.h1>
                    <motion.p 
                        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                        className="text-[12px] font-bold text-white/30 tracking-[0.2em] uppercase mt-4"
                    >
                        Choose your strategic mode to begin
                    </motion.p>
                </header>

                <div className="px-8 space-y-6">
                    {/* 1. Custom Mode - THE PREMIUM CHOICE */}
                    <motion.button
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
                        onClick={() => { setSelectedMode('CUSTOM'); setStep(1); }}
                        className="w-full group relative overflow-hidden rounded-[32px] p-8 text-left bg-[#1A1C20] border-2 border-[#C9B075]/40 hover:border-[#C9B075] transition-all active:scale-[0.98] shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
                    >
                        {/* Shimmer Effect */}
                        <motion.div 
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-[#C9B075]/10 to-transparent skew-x-12"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        />
                        {/* Sparkle Particles */}
                        <div className="absolute inset-0 pointer-events-none">
                            {[...Array(6)].map((_, i) => (
                                <motion.div 
                                    key={i}
                                    className="absolute w-1 h-1 bg-[#C9B075] rounded-full"
                                    animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 0.5] }}
                                    transition={{ duration: 2 + Math.random(), repeat: Infinity, delay: Math.random() * 2 }}
                                    style={{ top: `${Math.random() * 100}%`, left: `${Math.random() * 100}%` }}
                                />
                            ))}
                        </div>

                        <div className="relative z-10 flex items-center justify-between">
                            <div className="space-y-2">
                                <h3 className="text-2xl font-black italic text-white tracking-tight group-hover:text-[#C9B075] transition-colors uppercase">스페셜 매치</h3>
                                <p className="text-[11px] font-bold text-[#C9B075]/60 leading-tight uppercase tracking-widest">100% 자율 매칭 및 실시간 스페셜 매치 대진 설계</p>
                            </div>
                            <div className="w-16 h-16 rounded-2xl bg-[#C9B075]/20 border border-[#C9B075]/30 flex items-center justify-center text-[#C9B075] group-hover:scale-110 transition-transform shadow-[0_0_20px_rgba(201,176,117,0.2)]">
                                <LayoutGrid size={32} />
                            </div>
                        </div>
                    </motion.button>

                    {/* 2. Monthly Match */}
                    <motion.button
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
                        onClick={() => { setSelectedMode('MONTHLY'); setStep(1); }}
                        className="w-full group relative overflow-hidden rounded-[32px] p-8 text-left bg-white/[0.03] border border-white/5 hover:bg-white/5 hover:border-white/20 transition-all active:scale-[0.98]"
                    >
                        <div className="relative z-10 flex items-center justify-between">
                            <div className="space-y-2">
                                <h3 className="text-2xl font-black italic text-white/80 tracking-tight group-hover:text-white transition-colors uppercase">월례회 모드</h3>
                                <p className="text-[11px] font-bold text-white/30 leading-tight uppercase tracking-widest">자동 대진 엔진 및 클럽 정산 최적화</p>
                            </div>
                            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:scale-110 transition-transform">
                                <Calendar size={32} />
                            </div>
                        </div>
                    </motion.button>

                    {/* 3. Tournament Match */}
                    <motion.button
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
                        onClick={() => { setSelectedMode('TOURNAMENT'); setStep(1); }}
                        className="w-full group relative overflow-hidden rounded-[32px] p-8 text-left bg-white/[0.03] border border-white/5 hover:bg-white/5 hover:border-white/20 transition-all active:scale-[0.98]"
                    >
                        <div className="relative z-10 flex items-center justify-between">
                            <div className="space-y-2">
                                <h3 className="text-2xl font-black italic text-white/80 tracking-tight group-hover:text-white transition-colors uppercase">토너먼트</h3>
                                <p className="text-[11px] font-bold text-white/30 leading-tight uppercase tracking-widest">강력한 스페셜 매치 빌더 및 챔피언 추적</p>
                            </div>
                            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:scale-110 transition-transform">
                                <Trophy size={32} />
                            </div>
                        </div>
                    </motion.button>
                </div>

                <div className="mt-12 text-center opacity-20 flex flex-col items-center">
                    <span className="text-[10px] font-black uppercase tracking-[0.5em] italic">TEYEON PRESTIGE PROTOCOL</span>
                    <div className="w-12 h-[1px] bg-white/30 mt-4" />
                </div>
            </main>
        );
    }

    if (step === 1) {
        return (
            <MemberSelector
                allMembers={allMembers}
                tempGuests={tempGuests}
                selectedIds={selectedIds}
                isMembersLoading={isMembersLoading}
                isMembersError={isMembersError}
                title="스페셜 매치"
                onToggle={toggleMember}
                onAddGuest={(name) => {
                    const guest: Member = { id: `g-${Date.now()}`, nickname: name, is_guest: true };
                    setTempGuests(prev => [...prev, guest]);
                    const next = new Set(selectedIds);
                    next.add(guest.id);
                    setSelectedIds(next);
                }}
                onFetchMembers={fetchMembers}
                onConfirm={handleStep1Confirm}
                onReset={() => setShowResetConfirm(true)}
                onRestore={(data) => {
                    setMatchQueue(data.matches || []);
                    setSessionId(data.sessionId);
                    setSessionTitle(data.sessionTitle);
                    setSelectedIds(new Set(data.selectedIds || []));
                    setTempGuests(data.tempGuests || []);
                    setStep(2);
                }}
                onBack={() => setStep(0)}
                sessionKey="special_live_session"
            />
        );
    }

    if (step === 3) {
        return (
            <main className="flex flex-col min-h-screen bg-[#0a0a0b] text-white font-sans w-full max-w-[480px] mx-auto relative pb-40 overflow-hidden">
                {/* Background Glow */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#C9B075]/5 rounded-full blur-[120px] -z-10" />
                
                {/* Header */}
                <header className="px-6 pt-12 pb-6 flex flex-col items-center text-center relative z-10">
                    <motion.div 
                        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-2 px-4 py-1.5 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-4"
                    >
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] font-[1000] text-[#C9B075] tracking-[0.4em] uppercase">Special Live Dashboard</span>
                    </motion.div>
                    <h1 className="text-3xl font-black italic text-white tracking-tighter uppercase mb-2">{sessionTitle}</h1>
                    <div className="flex items-center gap-2 opacity-30">
                        <Calendar size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">{new Date().toISOString().split('T')[0]}</span>
                    </div>
                </header>

                {/* Primary Tabs */}
                <nav className="px-6 mb-8 relative z-10">
                    <div className="flex bg-white/5 p-1.5 rounded-[24px] border border-white/5 backdrop-blur-xl shadow-2xl">
                        {(['MATCHES', 'RANKING'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => {
                                    setActiveTab(tab);
                                    if (window.navigator?.vibrate) window.navigator.vibrate(10);
                                }}
                                className={`flex-1 py-3.5 rounded-full text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-[#C9B075] text-black shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </nav>

                <div className="flex-1 px-6 overflow-y-auto no-scrollbar relative z-10">
                    {activeTab === 'MATCHES' ? (
                        <>
                            {/* Sub-tabs for matches */}
                            <div className="flex gap-2 mb-6 overflow-x-auto no-scrollbar pb-2">
                                {(['NOW', 'WAITING', 'COMPLETED'] as const).map(sub => {
                                    const count = matchQueue.filter(m => 
                                        sub === 'NOW' ? m.status === 'live' : 
                                        sub === 'WAITING' ? m.status === 'waiting' : 
                                        m.status === 'complete'
                                    ).length;
                                    
                                    return (
                                        <button
                                            key={sub}
                                            onClick={() => setActiveMatchTab(sub)}
                                            className={`px-5 py-2.5 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${activeMatchTab === sub ? 'bg-white text-black border-white' : 'bg-white/5 text-white/30 border-white/5'}`}
                                        >
                                            {sub} <span className="ml-1 opacity-40 font-mono text-[10px]">({count})</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Match List */}
                            <div className="space-y-4">
                                {matchQueue.filter(m => 
                                    activeMatchTab === 'NOW' ? m.status === 'live' : 
                                    activeMatchTab === 'WAITING' ? m.status === 'waiting' : 
                                    m.status === 'complete'
                                ).length === 0 ? (
                                    <div className="py-32 flex flex-col items-center justify-center text-white/5 border border-dashed border-white/5 rounded-[40px]">
                                        <LayoutGrid size={48} className="mb-4 opacity-10" />
                                        <span className="text-[10px] font-black uppercase tracking-[0.3em]">No Matches in Pipeline</span>
                                    </div>
                                ) : (
                                    matchQueue.filter(m => 
                                        activeMatchTab === 'NOW' ? m.status === 'live' : 
                                        activeMatchTab === 'WAITING' ? m.status === 'waiting' : 
                                        m.status === 'complete'
                                    ).map((m, idx) => (
                                        <motion.div 
                                            layout key={m.id}
                                            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                                            className={`relative rounded-[32px] p-8 overflow-hidden transition-all border-t ${m.status === 'live' ? 'bg-[#1A1A1A] border-white/20 shadow-[0_20px_50px_rgba(201,176,117,0.1)]' : 'bg-white/[0.03] border-white/5'}`}
                                        >
                                            {m.status === 'live' && <div className="absolute top-0 right-0 w-32 h-32 bg-[#C9B075]/10 blur-3xl -z-10" />}
                                            
                                            <div className="flex items-center justify-between mb-8">
                                                <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] italic">Round {m.round || idx + 1}</span>
                                                {m.status === 'live' && (
                                                    <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-red-500 rounded-full text-[9px] font-black tracking-widest uppercase border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                                                        <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
                                                        LIVE
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6 mb-8">
                                                <div className="space-y-2 text-center">
                                                    <div className="text-base font-black text-white truncate">{getPlayerName(m.playerIds[0])}</div>
                                                    <div className="text-base font-black text-white truncate">{getPlayerName(m.playerIds[1])}</div>
                                                </div>
                                                <div className="flex flex-col items-center gap-1">
                                                    {m.status === 'complete' ? (
                                                        <div className="flex gap-2 text-3xl font-black italic">
                                                            <span className={m.score1! > m.score2! ? 'text-[#C9B075]' : 'text-white/20'}>{m.score1}</span>
                                                            <span className="text-white/10">:</span>
                                                            <span className={m.score2! > m.score1! ? 'text-[#C9B075]' : 'text-white/20'}>{m.score2}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[#C9B075] font-black italic text-xl opacity-20">VS</span>
                                                    )}
                                                </div>
                                                <div className="space-y-2 text-center">
                                                    <div className="text-base font-black text-white truncate">{getPlayerName(m.playerIds[2])}</div>
                                                    <div className="text-base font-black text-white truncate">{getPlayerName(m.playerIds[3])}</div>
                                                </div>
                                            </div>

                                            <div className="pt-6 border-t border-white/5">
                                                {m.status === 'waiting' && isAdmin && (
                                                    <button 
                                                        onClick={() => handleStartMatch(m.id)}
                                                        className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-black rounded-2xl text-[11px] uppercase tracking-[0.2em] border border-white/10 transition-all active:scale-95"
                                                    >
                                                        투입하기 🚀
                                                    </button>
                                                )}
                                                {m.status === 'live' && isAdmin && (
                                                    <button 
                                                        onClick={() => { setTempScores({ s1: 0, s2: 0 }); setActiveMatchForScore(m); }}
                                                        className="w-full py-4 bg-[#C9B075] text-black font-black rounded-2xl text-[11px] uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95"
                                                    >
                                                        결과 입력 🏆
                                                    </button>
                                                )}
                                                {m.status === 'complete' && (
                                                    <div className="text-center text-[10px] font-black text-[#C9B075] uppercase tracking-widest flex items-center justify-center gap-2 italic">
                                                        <CheckCircle2 size={12} className="text-emerald-500" /> OFFICIAL RECORDED
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    ))
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="space-y-6">
                             <RankingTab
                                players={allPlayersInRanking}
                                sessionTitle={sessionTitle}
                                isArchive={false}
                                isAdmin={isAdmin}
                                prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                                onShareMatch={() => alert("스페셜 매치 대진표가 클립보드에 복사되었습니다.")}
                                onShareResult={() => alert("최종 결과가 클립보드에 복사되었습니다.")}
                                onFinalize={handleFinalArchive}
                                isGenerating={isSubmitting}
                            />
                        </div>
                    )}

                </div>

                {/* Footer Controls */}
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[440px] px-6">
                    <div className="bg-black/60 backdrop-blur-3xl border border-white/10 p-2.5 rounded-full shadow-[0_30px_100px_rgba(0,0,0,0.8)] flex gap-3">
                        {isAdmin && (
                            <button 
                                onClick={() => setStep(2)}
                                className="w-16 h-16 bg-white/5 hover:bg-white/10 text-[#C9B075] rounded-full flex items-center justify-center transition-all active:scale-90 border border-white/10"
                                title="Add Matches"
                            >
                                <Plus size={24} strokeWidth={3} />
                            </button>
                        )}
                        <button
                            disabled={isSubmitting || !matchQueue.every(m => m.status === 'complete')}
                            onClick={handleFinalArchive}
                            className="flex-1 h-16 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black font-black rounded-full flex items-center justify-center gap-4 shadow-[0_10px_40px_rgba(201,176,117,0.4)] active:scale-95 transition-all uppercase tracking-[0.2em] text-xs disabled:opacity-20 disabled:grayscale"
                        >
                            <Save size={20} />
                            <span>최종 아카이브 전송</span>
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    const selectedMembers = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id));

    return (
        <main className="flex flex-col min-h-screen bg-[#0a0a0b] text-white font-sans w-full max-w-[480px] mx-auto pb-40 relative">
            {/* Header */}
            <header className="fixed top-0 w-full max-w-[480px] z-50 bg-black/60 backdrop-blur-2xl border-b border-white/5 h-20 flex items-center px-8 justify-between">
                <button onClick={() => setStep(1)} className="p-3 bg-white/5 rounded-full text-white/40 hover:text-white transition-colors"><Plus className="rotate-45" size={20} /></button>
                <div className="text-center flex flex-col">
                    <span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase mb-1">Custom Builder</span>
                    <h1 className="text-xl font-black italic tracking-tighter text-white uppercase truncate max-w-[200px]">{sessionTitle || '새로운 세션'}</h1>
                </div>
                <button onClick={() => setShowResetConfirm(true)} className="p-3 bg-red-500/10 rounded-full text-red-500 hover:bg-red-500/20 transition-all"><Trash2 size={18} /></button>
            </header>

            <div className="mt-28 px-8 space-y-12 pb-40">
                {/* Financial Standards Section (Aligned with KDK) */}
                <section className="bg-white/5 border border-white/10 rounded-[32px] p-6 space-y-4">
                    <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase mb-4 text-center">Financial Standards</h3>
                    
                    <div className="grid grid-cols-1 gap-4">
                        {/* Prize */}
                        <div className="flex items-center justify-between bg-black/40 p-4 rounded-2xl border border-white/5">
                            <span className="text-[12px] font-black text-white/60">WINNER PRIZE</span>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setFirstPrize(p => Math.max(0, p - 5000))} className="w-8 h-8 rounded-lg bg-white/5 text-white/40 flex items-center justify-center font-bold"> - </button>
                                <span className="text-lg font-black text-[#C9B075] font-mono w-16 text-center">{(firstPrize/1000).toFixed(0)}K</span>
                                <button onClick={() => setFirstPrize(p => p + 5000)} className="w-8 h-8 rounded-lg bg-white/5 text-white/40 flex items-center justify-center font-bold"> + </button>
                            </div>
                        </div>

                        {/* Fine Tier 1 */}
                        <div className="flex items-center justify-between bg-black/40 p-4 rounded-2xl border border-white/5">
                            <div className="flex flex-col">
                                <span className="text-[12px] font-black text-white/60 uppercase">Fine Tier 1</span>
                                <span className="text-[8px] font-bold text-white/20 uppercase">Bottom 25%~50%</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setBottom25Late(p => Math.max(0, p - 1000))} className="w-8 h-8 rounded-lg bg-white/5 text-white/40 flex items-center justify-center font-bold"> - </button>
                                <span className="text-lg font-black text-white/90 font-mono w-16 text-center">{(bottom25Late/1000).toFixed(0)}K</span>
                                <button onClick={() => setBottom25Late(p => p + 1000)} className="w-8 h-8 rounded-lg bg-white/5 text-white/40 flex items-center justify-center font-bold"> + </button>
                            </div>
                        </div>

                         {/* Fine Tier 2 */}
                         <div className="flex items-center justify-between bg-black/40 p-4 rounded-2xl border border-white/5">
                            <div className="flex flex-col">
                                <span className="text-[12px] font-black text-rose-500 uppercase">Penalty Tier 2</span>
                                <span className="text-[8px] font-bold text-white/20 uppercase">Bottom 0%~25%</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setBottom25Penalty(p => Math.max(0, p - 1000))} className="w-8 h-8 rounded-lg bg-white/5 text-white/40 flex items-center justify-center font-bold"> - </button>
                                <span className="text-lg font-black text-rose-500 font-mono w-16 text-center">{(bottom25Penalty/1000).toFixed(0)}K</span>
                                <button onClick={() => setBottom25Penalty(p => p + 1000)} className="w-8 h-8 rounded-lg bg-white/5 text-white/40 flex items-center justify-center font-bold"> + </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Player Bank */}
                <section>
                    <div className="flex items-center justify-between mb-6 px-1">
                        <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">Player Bank</h3>
                        <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">{selectedMembers.length} Available</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar">
                        {selectedMembers.map(m => (
                            <button
                                key={m.id}
                                onClick={() => addToDraft(m.id)}
                                disabled={draftSlots.includes(m.id)}
                                className={`shrink-0 h-16 px-6 rounded-2xl font-black text-sm tracking-tight transition-all border
                                ${draftSlots.includes(m.id) ? 'bg-white/5 border-white/5 text-white/5 opacity-20' : 'bg-[#1A1A1A] border-white/10 text-white/80 active:scale-95 hover:border-[#C9B075]/30'}`}
                            >
                                {m.nickname}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Drafting Slots */}
                <section className="bg-[#1A1A1A] rounded-[40px] p-8 border border-white/5 shadow-2xl relative overflow-hidden group">
                    <div className="absolute -top-12 -right-12 w-32 h-32 bg-[#C9B075]/5 rounded-full blur-3xl group-hover:bg-[#C9B075]/10 transition-all" />
                    <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase mb-8 text-center opacity-40">Match Construction</h3>
                    
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
                        <div className="space-y-4">
                            {[0, 1].map(i => (
                                <div key={i} onClick={() => removeFromDraft(i)} className="h-24 rounded-[28px] bg-black/40 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group/slot hover:border-[#C9B075]/30 transition-all">
                                    {draftSlots[i] ? (
                                        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
                                            <span className="font-black text-white text-lg tracking-tighter">{getPlayerName(draftSlots[i]!)}</span>
                                            <div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/20 opacity-0 group-hover/slot:opacity-100 transition-opacity text-red-500 text-[8px] font-black uppercase text-center tracking-widest">REMOVE</div>
                                        </motion.div>
                                    ) : (
                                        <Plus className="text-white/5 group-hover/slot:text-[#C9B075]/20 transition-colors" size={28} />
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-col items-center gap-2">
                             <div className="w-px h-12 bg-gradient-to-b from-transparent via-[#C9B075]/20 to-transparent" />
                             <span className="text-[#C9B075] font-black italic text-3xl opacity-10 tracking-widest">VS</span>
                             <div className="w-px h-12 bg-gradient-to-t from-transparent via-[#C9B075]/20 to-transparent" />
                        </div>
                        <div className="space-y-4">
                            {[2, 3].map(i => (
                                <div key={i} onClick={() => removeFromDraft(i)} className="h-24 rounded-[28px] bg-black/40 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group/slot hover:border-[#C9B075]/30 transition-all">
                                    {draftSlots[i] ? (
                                        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
                                            <span className="font-black text-white text-lg tracking-tighter">{getPlayerName(draftSlots[i]!)}</span>
                                            <div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/20 opacity-0 group-hover/slot:opacity-100 transition-opacity text-red-500 text-[8px] font-black uppercase text-center tracking-widest">REMOVE</div>
                                        </motion.div>
                                    ) : (
                                        <Plus className="text-white/5 group-hover/slot:text-[#C9B075]/20 transition-colors" size={28} />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={addMatchToQueue}
                        disabled={draftSlots.includes(null)}
                        className="w-full mt-12 py-5 bg-[#C9B075] text-black font-black rounded-[20px] shadow-[0_15px_30px_rgba(201,176,117,0.2)] active:scale-95 transition-all text-[11px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 disabled:opacity-20 disabled:grayscale"
                    >
                        <Plus size={18} strokeWidth={4} /> Add To Current Queue
                    </button>
                </section>

                {/* Match Queue with Reorder */}
                <section className="pb-32">
                    <div className="flex items-center justify-between mb-8 px-1">
                        <div className="flex flex-col">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase mb-1">Draft Sequence</h3>
                            <p className="text-[9px] font-bold text-white/20 uppercase">Drag to Reorder Rounds</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <AnimatePresence>
                                {isOptimizing && (
                                    <motion.span 
                                        initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                                        className="text-[9px] font-black text-[#C9B075] italic tracking-widest animate-pulse"
                                    >
                                        최적화 중...
                                    </motion.span>
                                )}
                            </AnimatePresence>
                            <span className="px-3 py-1 bg-white/5 rounded-full text-[10px] font-black text-white/40 uppercase tracking-widest">{matchQueue.length} Matches</span>
                        </div>
                    </div>

                    <Reorder.Group axis="y" values={matchQueue} onReorder={handleReorder} className="space-y-4">
                        <AnimatePresence mode="popLayout">
                            {matchQueue.map((m, idx) => (
                                <Reorder.Item 
                                    key={m.id} 
                                    value={m}
                                    initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                                    className="bg-white/5 border border-white/5 p-6 rounded-[24px] flex items-center gap-6 cursor-grab active:cursor-grabbing hover:bg-white/[0.08] transition-all group"
                                >
                                    <div className="flex flex-col items-center">
                                        <span className="text-[10px] font-black text-[#C9B075] italic">R</span>
                                        <span className="text-xl font-black text-white italic tracking-tighter">{(idx+1)}</span>
                                    </div>
                                    <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-center">
                                        <div className="text-[13px] font-black text-white/90 leading-tight">
                                            <div className="truncate">{getPlayerName(m.playerIds[0])}</div>
                                            <div className="truncate">{getPlayerName(m.playerIds[1])}</div>
                                        </div>
                                        <div className="text-[10px] font-black text-[#C9B075] opacity-20 italic">VS</div>
                                        <div className="text-[13px] font-black text-white/90 leading-tight">
                                            <div className="truncate">{getPlayerName(m.playerIds[2])}</div>
                                            <div className="truncate">{getPlayerName(m.playerIds[3])}</div>
                                        </div>
                                    </div>
                                    <button onClick={() => removeMatchFromQueue(m.id)} className="p-3 text-white/10 hover:text-red-500 transition-colors bg-white/5 rounded-2xl"><Trash2 size={18} /></button>
                                </Reorder.Item>
                            ))}
                        </AnimatePresence>
                    </Reorder.Group>
                    
                    {matchQueue.length === 0 && (
                        <div className="py-24 border-2 border-dashed border-white/5 rounded-[40px] flex flex-col items-center justify-center text-white/5 group">
                            <Plus size={48} className="mb-4 opacity-5 group-hover:opacity-20 transition-opacity" />
                            <span className="text-[10px] font-black uppercase tracking-[0.4em]">Empty Canvas — Build Your Match</span>
                        </div>
                    )}
                </section>
            </div>

            {/* Float Command Bar */}
            <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[440px] px-6">
                <button
                    disabled={isSubmitting || matchQueue.length === 0}
                    onClick={startSpecialSession}
                    className="w-full h-20 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black font-black rounded-full flex items-center justify-center gap-4 shadow-[0_20px_60px_rgba(201,176,117,0.4)] active:scale-95 transition-all disabled:opacity-20 uppercase tracking-[0.3em] border border-white/20 text-sm italic"
                >
                    <Play fill="black" size={20} />
                    <span>SYNC & START LIVE COURT 🏁</span>
                </button>
            </div>

            {showResetConfirm && (
                <CustomConfirmModal
                    title="초기화 확인"
                    message="현재 대진 구성을 모두 초기화하시겠습니까?"
                    onConfirm={() => {
                        setMatchQueue([]);
                        setDraftSlots([null, null, null, null]);
                        setShowResetConfirm(false);
                        localStorage.removeItem('special_live_session');
                    }}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}
        </main>
    );
}

