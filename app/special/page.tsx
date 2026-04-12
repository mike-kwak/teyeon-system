
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
import { Trash2, GripVertical, Plus, Play, CheckCircle2, Trophy, LayoutGrid, Save, Calendar, Sparkles, RotateCw } from 'lucide-react';

export default function SpecialMatchPage() {
    const router = useRouter();
    const { role, hasPermission, getRestrictionMessage } = useAuth();
    const isAdmin = role === 'CEO' || role === 'ADMIN';

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
            const { id: statsId, name: statsName, ...restStats } = playerStats[id] || { id, name: m?.nickname || "Unknown", wins: 0, losses: 0, diff: 0, pf: 0, pa: 0 };
            
            return {
                id: statsId,
                name: statsName,
                ...restStats,
                is_guest: !!m?.is_guest,
                age: conf.age || m?.age || 99
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

        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const dbMatches = matchQueue.map((m, idx) => ({
                ...m,
                round: idx + 1,
                session_id: sessionId,
                club_id: clubId,
                session_title: sessionTitle,
                status: m.status || 'waiting', 
                player_names: m.playerIds.map(pid => getPlayerName(pid))
            }));

            const { error } = await supabase.rpc('sync_tournament_matches', { p_matches: dbMatches });
            if (error) {
                console.error("DB Sync Warning:", error.message);
                // Proceed anyway after logging, but maybe show a subtle warning inside Live Court
            }
        } catch (err: any) {
            console.error("Sync Logic Failure (Proceeding with Local Session):", err.message);
        } finally {
            // Save to LocalStorage Always
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

            setStep(3); 
            setIsSubmitting(false);
        }
    };

    const getPlayerName = (id: string) => {
        const p = [...allMembers, ...tempGuests].find(m => m.id === id);
        return p ? p.nickname + (p.is_guest ? ' (G)' : '') : '???';
    };

    const PlayerNameBadge = ({ id }: { id: string }) => {
        const name = getPlayerName(id);
        const isGuest = name.includes('(G)');
        const cleanName = name.replace(' (G)', '');
        return (
            <span className="truncate">
                {cleanName}
                {isGuest && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic font-medium">(G)</span>}
            </span>
        );
    };

    const handleStartMatch = async (matchId: string) => {
        const nextQueue = matchQueue.map(m => 
            m.id === matchId ? { ...m, status: 'playing' as const } : m
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
                status: 'playing',
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

    const execCopySchedule = () => {
        const text = `[${sessionTitle}] 스페셜 매치 대진표\n` + 
            matchQueue.map((m, i) => `G${i+1}: ${getPlayerName(m.playerIds[0])}, ${getPlayerName(m.playerIds[1])} vs ${getPlayerName(m.playerIds[2])}, ${getPlayerName(m.playerIds[3])}`).join('\n');
        navigator.clipboard.writeText(text);
        alert("대진표가 클립보드에 복사되었습니다. 📋");
    };

    const copyFinalResults = () => {
        const text = `[${sessionTitle}] 스페셜 매치 최종 결과\n` + 
            allPlayersInRanking.map((p, i) => `${i+1}위: ${p.name} (${p.wins}승 ${p.losses}패, 득실 ${p.diff})`).join('\n');
        navigator.clipboard.writeText(text);
        alert("최종 결과가 클립보드에 복사되었습니다. 🏆");
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
                        className="text-[42px] font-[900] italic text-white tracking-[-0.05em] uppercase leading-none"
                        style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}
                    >
                        SPECIAL MATCHES
                    </motion.h1>
                    <motion.p 
                        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                        className="text-[11px] font-black text-white/30 tracking-[0.2em] uppercase mt-3"
                    >
                        SELECT YOUR OPTIMIZED TOURNAMENT PROTOCOL
                    </motion.p>

                </header>

                <div className="px-8 space-y-6">
                    {/* 1. MANUAL MODE - THE CUSTOM CHOICE */}
                    <motion.button
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
                        onClick={() => { setSelectedMode('CUSTOM'); setStep(1); }}
                        className="w-full group relative overflow-hidden rounded-[40px] h-[170px] text-left border-2 border-[#C9B075]/30 hover:border-[#C9B075] transition-all active:scale-[0.98] shadow-[0_25px_60px_rgba(0,0,0,0.8)] bg-[#0A0A0A]/80 backdrop-blur-2xl"
                    >
                        {/* Background Image with Deep Overlay */}
                        <div 
                            className="absolute inset-0 bg-cover bg-center grayscale opacity-10 group-hover:scale-110 group-hover:opacity-30 transition-all duration-1000"
                            style={{ backgroundImage: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/luxury_tennis_special_match_bg_1776010591068.png")' }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                        {/* Shimmer Effect */}
                        <motion.div 
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-[#C9B075]/5 to-transparent skew-x-12"
                            animate={{ x: ['-100%', '200%'] }}
                            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                        />

                        <div className="relative z-10 h-full flex items-center justify-between px-10">
                            <div className="flex-1 pr-4 space-y-2">
                                <h3 className="text-[32px] font-[1000] italic text-[#C9B075] tracking-tight uppercase leading-none drop-shadow-2xl">MANUAL MODE</h3>
                                <p className="text-[12px] font-black text-white/50 leading-snug tracking-tight">수동 매칭 및 직접 점수 입력</p>
                            </div>
                            <div className="w-16 h-16 shrink-0 rounded-[24px] bg-[#C9B075]/10 border border-[#C9B075]/20 flex items-center justify-center text-[#C9B075] group-hover:scale-110 transition-transform shadow-[inset_0_0_20px_rgba(201,176,117,0.1)]">
                                <LayoutGrid size={32} strokeWidth={2.5} />
                            </div>
                        </div>
                    </motion.button>

                    {/* 2. Monthly Match */}
                    <motion.button
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
                        onClick={() => { setSelectedMode('MONTHLY'); setStep(1); }}
                        className="w-full group relative overflow-hidden rounded-[40px] h-[170px] text-left border border-white/10 hover:border-[#C9B075]/40 transition-all active:scale-[0.98] shadow-2xl bg-[#0A0A0A]/80 backdrop-blur-2xl"
                    >
                        {/* Background Image */}
                        <div 
                            className="absolute inset-0 bg-cover bg-center grayscale opacity-10 group-hover:grayscale-0 group-hover:opacity-30 transition-all duration-1000"
                            style={{ backgroundImage: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/luxury_club_management_texture_1776010630008.png")' }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                        <div className="relative z-10 h-full flex items-center justify-between px-10">
                            <div className="flex-1 pr-4 space-y-2">
                                <h3 className="text-[32px] font-[1000] italic text-white group-hover:text-white transition-colors uppercase leading-none">MONTHLY MATCH</h3>
                                <p className="text-[12px] font-black text-white/30 leading-snug tracking-tight">테연 월례회 전용 자동 시스템</p>
                            </div>
                            <div className="w-16 h-16 shrink-0 rounded-[24px] bg-white/5 border border-white/10 flex items-center justify-center text-white/20 group-hover:scale-110 group-hover:text-white group-hover:bg-[#C9B075]/10 group-hover:border-[#C9B075]/20 transition-all">
                                <Calendar size={32} />
                            </div>
                        </div>
                    </motion.button>

                    {/* 3. Tournament Match */}
                    <motion.button
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
                        onClick={() => { setSelectedMode('TOURNAMENT'); setStep(1); }}
                        className="w-full group relative overflow-hidden rounded-[40px] h-[170px] text-left border border-white/10 hover:border-[#C9B075]/40 transition-all active:scale-[0.98] shadow-2xl bg-[#0A0A0A]/80 backdrop-blur-2xl"
                    >
                        {/* Background Image */}
                        <div 
                            className="absolute inset-0 bg-cover bg-center grayscale opacity-10 group-hover:grayscale-0 group-hover:opacity-30 transition-all duration-1000"
                            style={{ backgroundImage: 'url("/brain/d480949b-af88-4b89-95c1-d020c66a33ad/kdk_strategic_engine_bg_1776010611021.png")' }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                        <div className="relative z-10 h-full flex items-center justify-between px-10">
                            <div className="flex-1 pr-4 space-y-2">
                                <h3 className="text-[32px] font-[1000] italic text-white group-hover:text-white transition-colors uppercase leading-none">TOURNAMENT</h3>
                                <p className="text-[12px] font-black text-white/30 leading-snug tracking-tight">강력한 자동 토너먼트 빌더</p>
                            </div>
                            <div className="w-16 h-16 shrink-0 rounded-[24px] bg-white/5 border border-white/10 flex items-center justify-center text-white/20 group-hover:scale-110 group-hover:text-white transition-all">
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
            <main className="flex flex-col min-h-screen bg-gradient-to-br from-[#0a0a0b] via-[#121214] to-[#0a0a0b] text-white font-sans w-full max-w-[480px] mx-auto relative pb-60 overflow-hidden" style={{ paddingBottom: "160px" }}>
                {/* Header (KDK Cockpit Style) */}
                <header className="px-6 pt-4 flex items-center justify-between gap-4 mb-2 h-14 relative z-[100]">
                    <div className="flex items-center gap-2">
                        {isAdmin && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#C9B075] rounded-full shadow-[0_8px_20px_rgba(201,176,117,0.3)] border border-white/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                                <span className="text-[9px] font-[1000] text-black uppercase tracking-widest leading-none">ADMIN MODE</span>
                            </div>
                        )}
                        {isAdmin && (
                            <button
                                onClick={() => setShowResetConfirm(true)}
                                className="h-10 px-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                                title="전체 데이터 초기화"
                            >
                                <RotateCw size={12} className="group-hover:rotate-180 transition-transform duration-500" />
                                <span className="text-[10px] font-black uppercase tracking-tighter">초기화</span>
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={execCopySchedule} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20" title="대진표 공유">📋</button>
                        <button onClick={copyFinalResults} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20" title="결과 보고">🏆</button>
                    </div>
                </header>

                {/* Session Info Bar (KDK Style) */}
                <div 
                    className={`w-full px-5 flex flex-col gap-2 relative z-50 ${activeTab === 'RANKING' ? 'border-b border-white/5 pb-2 pt-2' : 'border-y border-white/10 py-6'}`}
                    style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(32px)', boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}
                >
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest shrink-0">SESSION:</span>
                            <span className="text-[10px] font-bold text-white truncate uppercase tracking-tighter">{sessionTitle}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <div className="flex items-center gap-1">
                                <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest leading-none">WIN:</span>
                                <span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none">{(firstPrize/1000).toFixed(0)}K</span>
                            </div>
                            <div className="mx-1.5 w-px h-2 bg-white/10" />
                            <div className="flex items-center gap-1">
                                <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest leading-none text-red-500">PEN:</span>
                                <span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none">{(bottom25Penalty/1000).toFixed(0)}K</span>
                            </div>
                        </div>
                    </div>
                    {activeTab === 'MATCHES' && (
                        <div className="flex items-center gap-1.5 pt-2 border-t border-white/5">
                            <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent uppercase tracking-widest shrink-0">DATE:</span>
                            <span className="text-[10px] font-bold text-white tracking-tighter leading-tight italic uppercase truncate">
                                {new Date().toISOString().split('T')[0]}
                            </span>
                        </div>
                    )}
                </div>

                {/* Primary Nav Tabs (KDK Cockpit Style) */}
                <nav className="px-6 my-6 relative z-10 w-full flex justify-center">
                    <div className="flex bg-[#1A1A1A]/60 p-1.5 rounded-[24px] border border-white/5 backdrop-blur-xl shadow-2xl w-full">
                        {(['MATCHES', 'RANKING'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => {
                                    setActiveTab(tab);
                                    if (window.navigator?.vibrate) window.navigator.vibrate(10);
                                }}
                                className={`flex-1 py-3.5 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${activeTab === tab ? 'bg-[#C9B075] text-black shadow-[0_10px_20px_rgba(201,176,117,0.3)]' : 'text-white/40 hover:text-white/60'}`}
                            >
                                <span className={activeTab === tab ? 'opacity-100' : 'opacity-40 grayscale'}>
                                    {tab === 'MATCHES' ? '🔥' : '📊'}
                                </span>
                                {tab}
                            </button>
                        ))}
                    </div>
                </nav>

                <div className="flex-1 px-4 overflow-y-auto no-scrollbar relative z-10" style={{ background: '#0a0a0b' }}>
                    {activeTab === 'MATCHES' ? (
                        <div className="space-y-12 pb-20">
                            {/* NOW PLAYING Section */}
                            <section>
                                <div className="flex flex-col mb-6">
                                    <div className="flex items-center gap-3 ml-2">
                                        <h2 className="text-2xl font-black italic tracking-tighter uppercase text-white">NOW PLAYING</h2>
                                        {matchQueue.filter(m => m.status === 'playing').length > 0 && (
                                            <span className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-[10px] font-black tracking-widest uppercase border border-red-500/30">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                                {matchQueue.filter(m => m.status === 'playing').length} LIVE
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-2 h-1.5 w-48 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" />
                                </div>

                                <div className="space-y-3">
                                    {matchQueue.filter(m => m.status === 'playing').length === 0 ? (
                                        <div className="py-10 text-center text-white/10 border border-dashed border-white/5 rounded-2xl text-[10px] uppercase font-black tracking-[0.4em]">Waiting for next round...</div>
                                    ) : (
                                        matchQueue.filter(m => m.status === 'playing').map((m, idx) => (
                                            <motion.div 
                                                layout key={m.id}
                                                className="rounded-2xl relative grid grid-cols-[50px_1fr_90px] items-center overflow-hidden p-6 bg-white/5 backdrop-blur-3xl border-t-2 border-white/20 shadow-2xl"
                                            >
                                                <div className="flex items-center justify-center">
                                                    <div className="w-9 h-9 bg-gradient-to-br from-[#C9B075] to-[#E5D29B] text-black rounded-full flex items-center justify-center shadow-lg border border-white/20">
                                                        <span className="text-[12px] font-black italic">G{m.round || idx + 1}</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-center gap-3 text-center px-2 min-w-0">
                                                    <div className="flex-1 flex flex-col items-center justify-center truncate">
                                                        <span className="text-[16px] font-black text-white truncate max-w-full"><PlayerNameBadge id={m.playerIds[0]} /></span>
                                                        <div className="h-px w-4 bg-white/10 my-0.5" />
                                                        <span className="text-[16px] font-black text-white truncate max-w-full"><PlayerNameBadge id={m.playerIds[1]} /></span>
                                                    </div>
                                                    <span className="text-[#C9B075] font-black italic text-[10px] opacity-30 italic">vs</span>
                                                    <div className="flex-1 flex flex-col items-center justify-center truncate">
                                                        <span className="text-[16px] font-black text-white truncate max-w-full"><PlayerNameBadge id={m.playerIds[2]} /></span>
                                                        <div className="h-px w-4 bg-white/10 my-0.5" />
                                                        <span className="text-[16px] font-black text-white truncate max-w-full"><PlayerNameBadge id={m.playerIds[3]} /></span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-end">
                                                    <button 
                                                        onClick={() => { setTempScores({ s1: 0, s2: 0 }); setActiveMatchForScore(m); }}
                                                        className="px-4 py-2.5 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black font-black rounded-xl text-[9px] uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                                                    >
                                                        SCORE 🏆
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ))
                                    )}
                                </div>
                            </section>

                            {/* WAITING Section */}
                            <section>
                                <div className="flex flex-col mb-6">
                                    <h2 className="text-2xl font-black italic tracking-tighter uppercase text-white ml-2">GOLD WAITING</h2>
                                    <div className="mt-2 h-1.5 w-48 ml-2 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/20 to-transparent" />
                                </div>

                                <div className="space-y-3">
                                    {matchQueue.filter(m => m.status === 'waiting').length === 0 ? (
                                        <div className="py-10 text-center text-white/5 border border-dashed border-white/5 rounded-2xl text-[10px] uppercase font-black tracking-[0.4em]">No Matches in Queue</div>
                                    ) : (
                                        matchQueue.filter(m => m.status === 'waiting').map((m, idx) => (
                                            <motion.div 
                                                layout key={m.id}
                                                className="rounded-2xl relative grid grid-cols-[50px_1fr_90px] items-center overflow-hidden p-6 bg-white/5 backdrop-blur-3xl border-t-2 border-white/20 shadow-2xl"
                                            >
                                                <div className="flex items-center justify-center">
                                                    <div className="w-9 h-9 bg-gradient-to-br from-[#C9B075] to-[#E5D29B] text-black rounded-full flex items-center justify-center shadow-lg border border-white/20">
                                                        <span className="text-[12px] font-black italic">G{m.round || idx + 1}</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-center gap-3 text-center px-2 min-w-0">
                                                    <div className="flex-1 flex items-center justify-center gap-1.5 truncate">
                                                        <span className="text-[16px] font-black text-white truncate max-w-full"><PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} /></span>
                                                    </div>
                                                    <span className="text-[#C9B075] font-black italic text-[10px] opacity-30 italic">vs</span>
                                                    <div className="flex-1 flex items-center justify-center gap-1.5 truncate">
                                                        <span className="text-[16px] font-black text-white truncate max-w-full"><PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} /></span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-end">
                                                    <button 
                                                        onClick={() => handleStartMatch(m.id)}
                                                        className="px-4 py-2.5 bg-white/10 text-[#C9B075] font-black rounded-xl text-[9px] uppercase tracking-widest border border-[#C9B075]/20 active:scale-95 transition-all"
                                                    >
                                                        투입하기 🚀
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ))
                                    )}
                                </div>
                            </section>

                            {/* COMPLETED Section */}
                            <section>
                                <div className="flex flex-col mb-6">
                                    <h2 className="text-2xl font-black italic tracking-tighter uppercase text-white/30 ml-2">ARCHIVED</h2>
                                    <div className="mt-2 h-0.5 w-32 ml-2 bg-white/10" />
                                </div>

                                <div className="space-y-3 opacity-50">
                                    {matchQueue.filter(m => m.status === 'complete').map((m, idx) => (
                                        <div key={m.id} className="rounded-2xl relative grid grid-cols-[50px_1fr_90px] items-center overflow-hidden p-6 bg-white/[0.03] border-t border-white/10">
                                            <div className="flex items-center justify-center">
                                                <div className="w-9 h-9 bg-white/5 text-white/40 rounded-full flex items-center justify-center border border-white/5">
                                                    <span className="text-[12px] font-black italic">G{m.round || idx + 1}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-center gap-3 text-center px-4">
                                                <span className="flex-1 text-[14px] font-black text-white/60 truncate uppercase"><PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} /></span>
                                                <div className="flex flex-col items-center gap-0.5 translate-y-[-2px]">
                                                    <span className="text-xl font-black italic tracking-tighter text-white/20">{m.score1}:{m.score2}</span>
                                                </div>
                                                <span className="flex-1 text-[14px] font-black text-white/60 truncate uppercase"><PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} /></span>
                                            </div>
                                            <div className="flex justify-end p-2 opacity-20">
                                                <CheckCircle2 size={16} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="space-y-0 px-2 pt-4">
                             <RankingTab
                                players={allPlayersInRanking}
                                sessionTitle={sessionTitle}
                                isArchive={false}
                                isAdmin={isAdmin}
                                prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }}
                                onShareMatch={execCopySchedule}
                                onShareResult={copyFinalResults}
                                onFinalize={handleFinalArchive}
                                isGenerating={isSubmitting}
                            />
                        </div>
                    )}
                </div>

                {/* Footer Controls */}
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-8 z-[100]">
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-3xl border border-white/10 p-2.5 rounded-full shadow-[0_35px_100px_rgba(0,0,0,0.9)] flex gap-3">
                        {isAdmin && (
                            <button 
                                onClick={() => setStep(2)}
                                className="w-16 h-16 bg-white/5 hover:bg-white/10 text-[#C9B075] rounded-full flex items-center justify-center transition-all active:scale-90 border border-white/10 shadow-inner"
                                title="Add Matches"
                            >
                                <Plus size={24} strokeWidth={3} />
                            </button>
                        )}
                        <button
                            disabled={isSubmitting || !matchQueue.every(m => m.status === 'complete')}
                            onClick={handleFinalArchive}
                            className="flex-1 h-16 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black font-[1000] rounded-full flex items-center justify-center gap-4 shadow-[0_10px_40px_rgba(201,176,117,0.4)] active:scale-95 transition-all uppercase tracking-[0.3em] text-[11px] disabled:opacity-20 disabled:grayscale"
                        >
                            <Save size={18} />
                            <span>최종 아카이브 전송</span>
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    const selectedMembers = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id));

    return (
        <main className="flex flex-col min-h-screen bg-[#0a0a0b] text-white font-sans w-full max-w-[480px] mx-auto pb-96 relative">
            {/* Header (Integrated with Flow or Higher Z-Index) */}
            <header className="fixed top-0 w-full max-w-[480px] z-[70] bg-black/80 backdrop-blur-3xl border-b border-white/10 h-24 flex items-center px-8 justify-between shadow-2xl">
                <button 
                    onClick={() => setStep(1)} 
                    className="p-3 bg-white/5 rounded-2xl text-white/40 hover:text-white transition-all active:scale-95 border border-white/5"
                >
                    <Plus className="rotate-45" size={20} />
                </button>
                <div className="text-center flex flex-col">
                    <span className="text-[10px] font-[1000] text-[#C9B075] tracking-[0.5em] uppercase mb-1 drop-shadow-sm">Custom Protocol</span>
                    <h1 className="text-xl font-black italic tracking-tighter text-white uppercase truncate max-w-[200px] drop-shadow-2xl">{sessionTitle || 'New Session'}</h1>
                </div>
                <button 
                    onClick={() => setShowResetConfirm(true)} 
                    className="p-3 bg-red-500/10 rounded-2xl text-red-500 hover:bg-red-500/20 transition-all border border-red-500/20 active:scale-95 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                >
                    <Trash2 size={18} />
                </button>
            </header>

            <div className="mt-52 px-8 space-y-12 pb-[300px]">
                {/* Financial Standards Section (Aligned with KDK) */}
                <section className="bg-[#0A0A0A]/80 backdrop-blur-3xl border border-[#C9B075]/20 rounded-[40px] p-8 space-y-6 shadow-2xl">
                    <h3 className="text-[10px] font-[1000] text-[#C9B075] tracking-[0.4em] uppercase mb-4 text-center">Financial Protocol</h3>
                    
                    <div className="grid grid-cols-1 gap-4">
                        {/* Prize */}
                        <div className="flex items-center justify-between bg-white/5 p-5 rounded-[24px] border border-white/5">
                            <span className="text-[12px] font-black text-white/60 uppercase tracking-widest">Winner Prize</span>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setFirstPrize(p => Math.max(0, p - 5000))} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold hover:bg-white/10 transition-colors"> - </button>
                                <span className="text-xl font-black text-[#C9B075] font-mono w-20 text-center">{(firstPrize/1000).toFixed(0)}K</span>
                                <button onClick={() => setFirstPrize(p => p + 5000)} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold hover:bg-white/10 transition-colors"> + </button>
                            </div>
                        </div>

                        {/* Fine Tier 1 */}
                        <div className="flex items-center justify-between bg-white/5 p-5 rounded-[24px] border border-white/5">
                            <div className="flex flex-col">
                                <span className="text-[12px] font-black text-white/60 uppercase tracking-widest">Fine Tier 1</span>
                                <span className="text-[9px] font-bold text-white/20 uppercase">Bottom 25%~50%</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setBottom25Late(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold hover:bg-white/10 transition-colors"> - </button>
                                <span className="text-xl font-black text-white font-mono w-20 text-center">{(bottom25Late/1000).toFixed(0)}K</span>
                                <button onClick={() => setBottom25Late(p => p + 1000)} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold hover:bg-white/10 transition-colors"> + </button>
                            </div>
                        </div>

                         {/* Fine Tier 2 */}
                         <div className="flex items-center justify-between bg-white/5 p-5 rounded-[24px] border border-white/5">
                            <div className="flex flex-col">
                                <span className="text-[12px] font-black text-rose-500 uppercase tracking-widest">Penalty Tier 2</span>
                                <span className="text-[9px] font-bold text-white/20 uppercase">Bottom 0%~25%</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <button onClick={() => setBottom25Penalty(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold hover:bg-white/10 transition-colors"> - </button>
                                <span className="text-xl font-black text-rose-500 font-mono w-20 text-center">{(bottom25Penalty/1000).toFixed(0)}K</span>
                                <button onClick={() => setBottom25Penalty(p => p + 1000)} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold hover:bg-white/10 transition-colors"> + </button>
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
                    <div className="flex gap-3 overflow-x-auto pb-6 no-scrollbar mask-grad-right">
                        {selectedMembers.map(m => (
                            <button
                                key={m.id}
                                onClick={() => addToDraft(m.id)}
                                disabled={draftSlots.includes(m.id)}
                                className={`shrink-0 h-14 px-6 rounded-2xl font-[1000] text-sm tracking-tight transition-all border shadow-lg
                                ${draftSlots.includes(m.id) ? 'bg-white/5 border-white/5 text-white/5' : 'bg-[#1C1C1E] border-white/10 text-white/80 active:scale-95 hover:border-[#C9B075]/40 hover:text-white'}`}
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
                        className="w-full mt-10 py-5 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black font-[1000] rounded-[24px] shadow-[0_15px_40px_rgba(201,176,117,0.4)] active:scale-95 transition-all text-[13px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 disabled:opacity-20 disabled:grayscale border-2 border-white/20"
                    >
                        <Plus size={20} strokeWidth={4} /> Add To Current Queue
                    </button>
                </section>

                {/* Match Queue with Reorder */}
                <section className="pb-40">
                    <div className="flex items-center justify-between mb-8 px-1">
                        <div className="flex flex-col">
                             <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase group-hover:tracking-[0.5em] transition-all">Draft Sequence</h3>
                             <div className="flex items-center gap-3 mt-1">
                                <span className="text-[16px] font-black text-white italic tracking-tighter">{matchQueue.length} Matches Planned</span>
                                <AnimatePresence>
                                    {isOptimizing && (
                                        <motion.span 
                                            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
                                            className="text-[9px] font-black text-[#C9B075] italic tracking-widest animate-pulse"
                                        >
                                            • 최적화 중...
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                             </div>
                        </div>
                        {matchQueue.length > 0 && (
                            <button 
                                onClick={() => {
                                    setStep(3);
                                    if (window.navigator?.vibrate) window.navigator.vibrate(50);
                                }}
                                className="px-8 py-4 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black text-[12px] font-[1000] rounded-full uppercase tracking-widest shadow-[0_10px_30px_rgba(201,176,117,0.4)] active:scale-90 transition-all italic flex items-center gap-2"
                            >
                                Start Live Court <Play size={14} fill="black" />
                            </button>
                        )}
                    </div>

                    <Reorder.Group axis="y" values={matchQueue} onReorder={handleReorder} className="space-y-3 px-1">
                        <AnimatePresence mode="popLayout">
                            {matchQueue.map((m, idx) => (
                                <Reorder.Item 
                                    key={m.id} 
                                    value={m}
                                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                                    className="rounded-2xl relative grid grid-cols-[50px_1fr_60px] items-center overflow-hidden p-6 bg-white/5 backdrop-blur-3xl border-t-2 border-white/20 shadow-2xl cursor-grab active:cursor-grabbing hover:bg-white/[0.08] transition-all group mb-1.5"
                                >
                                    <div className="flex items-center justify-center">
                                        <div className="w-9 h-9 bg-gradient-to-br from-[#C9B075] to-[#E5D29B] text-black rounded-full flex items-center justify-center shadow-lg border border-white/20">
                                            <span className="text-[12px] font-black italic">G{idx + 1}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-center gap-4 text-center px-2 min-w-0">
                                        <span className="flex-1 text-white font-bold truncate leading-none text-right" style={{ fontSize: '16px' }}>
                                            <PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} />
                                        </span>
                                        <span className="text-[10px] font-black uppercase italic tracking-widest opacity-20 shrink-0 text-[#C9B075]">vs</span>
                                        <span className="flex-1 text-white font-bold truncate leading-none text-left" style={{ fontSize: '16px' }}>
                                            <PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} />
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-end">
                                        <button 
                                            onClick={() => removeMatchFromQueue(m.id)} 
                                            className="p-3 text-white/20 hover:text-red-500 transition-all bg-white/5 rounded-2xl active:scale-90"
                                            title="대진 삭제"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
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

            {/* Float Command Bar (KDK Style Gold Bar) */}
            <div className="fixed bottom-28 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-8 z-[100]">
                <button
                    disabled={isSubmitting || matchQueue.length === 0}
                    onClick={startSpecialSession}
                    className="w-full h-20 bg-gradient-to-r from-[#C9B075] via-[#F3E5AB] to-[#C9B075] text-black font-[1000] rounded-[24px] flex items-center justify-center gap-4 shadow-[0_20px_60px_rgba(201,176,117,0.5)] active:scale-95 transition-all disabled:opacity-20 uppercase tracking-[0.4em] border-2 border-white/30 text-[13px] italic"
                >
                    <Play fill="black" size={24} />
                    <span>SYNC & START LIVE COURT 🏁</span>
                </button>
            </div>

            {/* Reset Confirmation Modal */}
            {showResetConfirm && (
                <CustomConfirmModal
                    title="전체 데이터 초기화"
                    message="현재 진행 중인 모든 대진과 설정이 삭제됩니다. 정말 초기화하시겠습니까?"
                    confirmText="예, 초기화합니다"
                    onConfirm={() => {
                        setMatchQueue([]);
                        setSelectedIds(new Set());
                        setTempGuests([]);
                        setDraftSlots([null, null, null, null]);
                        setShowResetConfirm(false);
                        localStorage.removeItem('special_live_session');
                        setStep(0); // Return to mode selection
                    }}
                    onCancel={() => setShowResetConfirm(false)}
                />
            )}
        </main>
    );
}

