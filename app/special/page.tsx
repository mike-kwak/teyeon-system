'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Member, Match, AttendeeConfig } from '@/lib/tournament_types';
import MemberSelector from '@/components/tournament/MemberSelector';
import RankingTab from '@/components/RankingTab';

import { WarningModal, CustomConfirmModal } from '@/components/tournament/Modals';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import { Trash2, GripVertical, Plus, Play, CheckCircle2, Trophy, LayoutGrid, Save, Calendar, Sparkles, RotateCw, ArrowLeft } from 'lucide-react';
import PremiumSpinner from '@/components/PremiumSpinner';

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
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, AttendeeConfig>>({});

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
            const conf = attendeeConfigs[id] || { age: m?.age || 99, group: 'A' };
            const { id: statsId, name: statsName, ...restStats } = playerStats[id] || { id, name: m?.nickname || "Unknown", wins: 0, losses: 0, diff: 0, pf: 0, pa: 0 };
            
            return {
                id: statsId,
                name: statsName,
                ...restStats,
                is_guest: !!m?.is_guest,
                age: conf.age || m?.age || 99,
                group: conf.group || 'A'
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
                        setStep(4); // Shifted from 3 to 4
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
        setStep(2); // Goes to the new Settings step
    };

    const startMatchBuilder = () => {
        setStep(3); // Goes to the drafting step
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

            setStep(4); // Live Court
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
                ranking_data: allPlayersInRanking, 
                prizes: { firstPrize, bottom25Late, bottom25Penalty },
                player_metadata: Array.from(selectedIds).reduce((acc, id) => {
                    const m = [...allMembers, ...tempGuests].find(x => x.id === id);
                    const config = attendeeConfigs[id];
                    acc[id] = { 
                        name: m?.nickname, 
                        avatar: m?.avatar_url,
                        age: config?.age || m?.age || 99,
                        group: config?.group || 'A'
                    };
                    return acc;
                }, {} as any)
            };

            const { error } = await supabase.from('teyeon_archive_v1').insert([{ id: sessionId, raw_data: archiveData }]);
            if (error) throw error;

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

    // --- [STEP 0] Mode Selection ---
    if (step === 0) {
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full max-w-[480px] mx-auto pb-20 overflow-hidden relative">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#C9B075]/5 rounded-full blur-[120px] -z-10" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#C9B075]/3 rounded-full blur-[100px] -z-10" />

                <header className="px-8 pt-20 pb-12 flex flex-col items-center text-center">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-1.5 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-6">
                        <Sparkles size={14} className="text-[#C9B075]" />
                        <span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase">Selection Protocol</span>
                    </motion.div>
                    <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-[42px] font-[1000] italic text-white tracking-[-0.05em] uppercase leading-none">SPECIAL MATCHES</motion.h1>
                    <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-[11px] font-black text-white/30 tracking-[0.2em] uppercase mt-3">SELECT YOUR OPTIMIZED TOURNAMENT PROTOCOL</motion.p>
                </header>

                <div className="px-8 space-y-6">
                    <motion.button initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} onClick={() => { setSelectedMode('CUSTOM'); setStep(1); }} className="w-full group relative overflow-hidden rounded-[40px] h-[170px] text-left border-2 border-[#C9B075]/30 hover:border-[#C9B075] transition-all active:scale-[0.98] shadow-2xl bg-[#0A0A0A]/80 backdrop-blur-2xl">
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                        <div className="relative z-10 h-full flex items-center justify-between px-10">
                            <div className="flex-1 pr-4 space-y-2">
                                <h3 className="text-[32px] font-[1000] italic text-[#C9B075] tracking-tight uppercase leading-none">MANUAL MODE</h3>
                                <p className="text-[12px] font-black text-white/50 leading-snug tracking-tight">수동 매칭 및 직접 점수 입력</p>
                            </div>
                            <div className="w-16 h-16 shrink-0 rounded-[24px] bg-[#C9B075]/10 border border-[#C9B075]/20 flex items-center justify-center text-[#C9B075] group-hover:scale-110 transition-transform">
                                <LayoutGrid size={32} strokeWidth={2.5} />
                            </div>
                        </div>
                    </motion.button>

                    <motion.button initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} onClick={() => { setSelectedMode('MONTHLY'); setStep(1); }} className="w-full group relative overflow-hidden rounded-[40px] h-[170px] text-left border border-white/10 hover:border-[#C9B075]/40 transition-all active:scale-[0.98] shadow-2xl bg-[#0A0A0A]/80 backdrop-blur-2xl">
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                        <div className="relative z-10 h-full flex items-center justify-between px-10">
                            <div className="flex-1 pr-4 space-y-2">
                                <h3 className="text-[32px] font-[1000] italic text-white uppercase leading-none">MONTHLY MATCH</h3>
                                <p className="text-[12px] font-black text-white/30 leading-snug tracking-tight">테연 월례회 전용 자동 시스템</p>
                            </div>
                            <div className="w-16 h-16 shrink-0 rounded-[24px] bg-white/5 border border-white/10 flex items-center justify-center text-white/20 group-hover:scale-110 transition-all"><Calendar size={32} /></div>
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

    // --- [STEP 1] Member Selection ---
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
                    setAttendeeConfigs(data.attendeeConfigs || {});
                    setStep(2);
                }}
                onBack={() => setStep(0)}
                sessionKey="special_live_session"
            />
        );
    }

    // --- [STEP 2] High-Fidelity Configuration (NEW) ---
    if (step === 2) {
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full max-w-[480px] mx-auto relative pb-60" style={{ paddingBottom: "160px" }}>
                <header className="grid grid-cols-3 px-6 mb-4 items-center h-12 shrink-0 pt-4 relative z-[100]">
                    <div className="flex items-center">
                        <button onClick={() => setStep(1)} className="w-10 h-10 rounded-full flex items-center justify-center border border-[#C9B075]/30 bg-[#C9B075]/10 text-[#C9B075] hover:bg-[#C9B075]/20 active:scale-95 transition-all">
                            <span className="text-xl leading-none -mt-0.5">←</span>
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
                         <button onClick={() => setShowResetConfirm(true)} className="h-9 px-3 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group">
                            <RotateCw size={12} className="group-hover:rotate-180 transition-transform duration-500" />
                            <span className="text-[9px] font-black uppercase tracking-tighter">초기화</span>
                        </button>
                    </div>
                </header>

                <div className="px-6 space-y-12 w-full pt-12">
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" />
                            <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Archive Title</h3>
                        </div>
                        <input type="text" value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-[24px] px-6 py-5 text-sm font-black text-white focus:border-[#C9B075]/50 outline-none transition-all" placeholder="Ex: 260428_SPECIAL_01" />
                    </section>

                    <section style={{ background: '#1E1E1E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '40px', padding: '32px', marginBottom: '12px' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-[13px] font-bold text-[#C9B075] tracking-[0.3em] uppercase flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-[#C9B075]" />ATTENDEE MATRIX</h3>
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{attendees.length} ACTIVE</span>
                        </div>
                        <div className="space-y-2 no-scrollbar" style={{ maxHeight: '480px', overflowY: 'auto' }}>
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                return (
                                    <div key={m.id} style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '20px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <span style={{ fontSize: '14px', fontWeight: 900, color: 'rgba(255,255,255,0.9)' }}>{m.name}{m.is_guest ? ' (G)' : ''}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <button onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, isLate: !config.isLate } }))} style={{ width: '32px', height: '32px', borderRadius: '10px', border: config.isLate ? '1px solid #f97316' : '1px solid rgba(255,255,255,0.1)', background: config.isLate ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '16px' }}>🕒</button>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0A0A0A', borderRadius: '12px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '13px', fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: '46px', cursor: 'pointer' }}>{timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}</select>
                                                    <span style={{ color: '#6B7280', fontSize: '10px', fontWeight: 700 }}>TO</span>
                                                    <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} style={{ background: 'transparent', color: '#ffffff', fontSize: '13px', fontWeight: 700, outline: 'none', appearance: 'none', textAlign: 'center', width: '46px', cursor: 'pointer' }}>{timeOptions.map(t => <option key={t} value={t} style={{ background: '#1C1C28' }}>{t}</option>)}</select>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: config.group === 'A' ? '#C9B075' : '#0A0A0A', color: config.group === 'A' ? '#000' : '#fff', border: config.group === 'A' ? 'none' : '1px solid #555', fontWeight: 900, fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.15s' }}>A</button>
                                                <button onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))} style={{ width: '40px', height: '40px', borderRadius: '12px', background: config.group === 'B' ? '#C9B075' : '#0A0A0A', color: config.group === 'B' ? '#000' : '#fff', border: config.group === 'B' ? 'none' : '1px solid #555', fontWeight: 900, fontSize: '15px', display: 'flex', alignItems: 'center', justifyCenter: 'center', transition: '0.15s' }}>B</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <div className="pt-10">
                        <button onClick={startMatchBuilder} style={{ width: '100%', height: '64px', borderRadius: '99px', background: '#C9B075', color: '#000', fontSize: '16px', fontWeight: 1000, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.2s', border: 'none', boxShadow: '0 10px 30px rgba(201,176,117,0.3)' }} className="active:scale-95">매뉴얼 대진 생성 시작! 🚀</button>
                    </div>
                </div>
            </main>
        );
    }

    // --- [STEP 3] Manual Match Drafting (Original Step 2) ---
    if (step === 3) {
        const selectedMembers = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id));
        return (
            <main className="flex flex-col min-h-screen bg-[#0a0a0b] text-white font-sans w-full max-w-[480px] mx-auto pb-96 relative">
                <header className="fixed top-0 w-full max-w-[480px] z-[70] bg-black/80 backdrop-blur-3xl border-b border-white/10 h-24 flex items-center px-8 justify-between shadow-2xl">
                    <button onClick={() => setStep(2)} className="p-3 bg-white/5 rounded-2xl text-white/40 hover:text-white transition-all active:scale-95 border border-white/5"><ArrowLeft size={20} /></button>
                    <div className="text-center flex flex-col">
                        <span className="text-[10px] font-[1000] text-[#C9B075] tracking-[0.5em] uppercase mb-1">Step 03: Builder</span>
                        <h1 className="text-xl font-black italic tracking-tighter text-white uppercase truncate max-w-[200px]">{sessionTitle || 'New Session'}</h1>
                    </div>
                    <button onClick={() => setShowResetConfirm(true)} className="p-3 bg-red-500/10 rounded-2xl text-red-500 hover:bg-red-500/20 transition-all border border-red-500/20 active:scale-95 shadow-[0_0_15px_rgba(239,68,68,0.2)]"><Trash2 size={18} /></button>
                </header>

                <div className="mt-40 px-8 space-y-12 pb-[300px]">
                    <section className="bg-[#0A0A0A]/80 backdrop-blur-3xl border border-[#C9B075]/20 rounded-[40px] p-8 space-y-6 shadow-2xl">
                        <h3 className="text-[10px] font-[1000] text-[#C9B075] tracking-[0.4em] uppercase mb-4 text-center">Financial Protocol</h3>
                        <div className="grid grid-cols-1 gap-4">
                            <div className="flex items-center justify-between bg-white/5 p-5 rounded-[24px] border border-white/5">
                                <span className="text-[12px] font-black text-white/60 uppercase tracking-widest">Winner Prize</span>
                                <div className="flex items-center gap-4">
                                    <button onClick={() => setFirstPrize(p => Math.max(0, p - 5000))} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold">-</button>
                                    <span className="text-xl font-black text-[#C9B075] font-mono w-20 text-center">{(firstPrize/1000).toFixed(0)}K</span>
                                    <button onClick={() => setFirstPrize(p => p + 5000)} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold">+</button>
                                </div>
                            </div>
                            <div className="flex items-center justify-between bg-white/5 p-5 rounded-[24px] border border-white/5">
                                <div className="flex flex-col"><span className="text-[12px] font-black text-white/60 uppercase tracking-widest">Fine Tier 1</span><span className="text-[9px] font-bold text-white/20 uppercase">Bottom 25%~50%</span></div>
                                <div className="flex items-center gap-4">
                                    <button onClick={() => setBottom25Late(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold">-</button>
                                    <span className="text-xl font-black text-white font-mono w-20 text-center">{(bottom25Late/1000).toFixed(0)}K</span>
                                    <button onClick={() => setBottom25Late(p => p + 1000)} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold">+</button>
                                </div>
                            </div>
                            <div className="flex items-center justify-between bg-white/5 p-5 rounded-[24px] border border-white/5">
                                <div className="flex flex-col"><span className="text-[12px] font-black text-rose-500 uppercase tracking-widest">Penalty Tier 2</span><span className="text-[9px] font-bold text-white/20 uppercase">Bottom 0%~25%</span></div>
                                <div className="flex items-center gap-4">
                                    <button onClick={() => setBottom25Penalty(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold">-</button>
                                    <span className="text-xl font-black text-rose-500 font-mono w-20 text-center">{(bottom25Penalty/1000).toFixed(0)}K</span>
                                    <button onClick={() => setBottom25Penalty(p => p + 1000)} className="w-10 h-10 rounded-xl bg-white/5 text-white/40 flex items-center justify-center font-bold">+</button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <div className="flex items-center justify-between mb-6 px-1">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">Player Bank</h3>
                            <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">{selectedMembers.length} Available</span>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-6 no-scrollbar mask-grad-right">
                            {selectedMembers.map(m => (
                                <button key={m.id} onClick={() => addToDraft(m.id)} disabled={draftSlots.includes(m.id)} className={`shrink-0 h-14 px-6 rounded-2xl font-[1000] text-sm tracking-tight transition-all border shadow-lg ${draftSlots.includes(m.id) ? 'bg-white/5 border-white/5 text-white/0' : 'bg-[#1C1C1E] border-white/10 text-white/80 active:scale-95 hover:border-[#C9B075]/40 hover:text-white'}`}>{m.nickname}</button>
                            ))}
                        </div>
                    </section>

                    <section className="bg-[#1A1A1A] rounded-[40px] p-8 border border-white/5 shadow-2xl relative overflow-hidden group">
                        <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase mb-8 text-center opacity-40">Match Construction</h3>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
                            <div className="space-y-4">{[0, 1].map(i => (<div key={i} onClick={() => removeFromDraft(i)} className="h-24 rounded-[28px] bg-black/40 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group/slot transition-all">{draftSlots[i] ? (<motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center"><span className="font-black text-white text-lg tracking-tighter">{getPlayerName(draftSlots[i]!)}</span><div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/20 opacity-0 group-hover/slot:opacity-100 transition-opacity text-red-500 text-[8px] font-black uppercase text-center tracking-widest">REMOVE</div></motion.div>) : (<Plus className="text-white/5 group-hover/slot:text-[#C9B075]/20 transition-colors" size={28} />)}</div>))}</div>
                            <div className="flex flex-col items-center gap-2"><div className="w-px h-12 bg-gradient-to-b from-transparent via-[#C9B075]/20 to-transparent" /><span className="text-[#C9B075] font-black italic text-3xl opacity-10 tracking-widest">VS</span><div className="w-px h-12 bg-gradient-to-t from-transparent via-[#C9B075]/20 to-transparent" /></div>
                            <div className="space-y-4">{[2, 3].map(i => (<div key={i} onClick={() => removeFromDraft(i)} className="h-24 rounded-[28px] bg-black/40 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group/slot transition-all">{draftSlots[i] ? (<motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center"><span className="font-black text-white text-lg tracking-tighter">{getPlayerName(draftSlots[i]!)}</span><div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/20 opacity-0 group-hover/slot:opacity-100 transition-opacity text-red-500 text-[8px] font-black uppercase text-center tracking-widest">REMOVE</div></motion.div>) : (<Plus className="text-white/5 group-hover/slot:text-[#C9B075]/20 transition-colors" size={28} />)}</div>))}</div>
                        </div>
                        <button onClick={addMatchToQueue} disabled={draftSlots.includes(null)} className="w-full mt-10 py-5 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black font-[1000] rounded-[24px] shadow-lg active:scale-95 transition-all text-[13px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 disabled:opacity-20 border-2 border-white/20"><Plus size={20} strokeWidth={4} /> Add To Current Queue</button>
                    </section>

                    <section className="pb-40">
                         <div className="flex items-center justify-between mb-8 px-1">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">{matchQueue.length} Matches Planned</h3>
                            {matchQueue.length > 0 && (<button onClick={startSpecialSession} className="px-8 py-4 bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] text-black text-[12px] font-[1000] rounded-full uppercase tracking-widest shadow-lg active:scale-90 transition-all italic flex items-center gap-2">Start Live Court <Play size={14} fill="black" /></button>)}
                        </div>
                        <Reorder.Group axis="y" values={matchQueue} onReorder={handleReorder} className="space-y-3 px-1">
                            {matchQueue.map((m, idx) => (
                                <Reorder.Item key={m.id} value={m} className="rounded-2xl relative grid grid-cols-[50px_1fr_60px] items-center overflow-hidden p-6 bg-white/5 backdrop-blur-3xl border-t-2 border-white/20 shadow-2xl cursor-grab active:cursor-grabbing mb-1.5">
                                    <div className="flex items-center justify-center"><div className="w-9 h-9 bg-gradient-to-br from-[#C9B075] to-[#E5D29B] text-black rounded-full flex items-center justify-center shadow-lg border border-white/20"><span className="text-[12px] font-black italic">G{idx + 1}</span></div></div>
                                    <div className="flex items-center justify-center gap-4 text-center px-2 min-w-0"><span className="flex-1 text-white font-bold truncate text-right text-[16px]"><PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} /></span><span className="text-[10px] font-black uppercase italic tracking-widest opacity-20 text-[#C9B075]">vs</span><span className="flex-1 text-white font-bold truncate text-left text-[16px]"><PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} /></span></div>
                                    <div className="flex items-center justify-end"><button onClick={() => removeMatchFromQueue(m.id)} className="p-3 text-white/20 hover:text-red-500 transition-all bg-white/5 rounded-2xl active:scale-90"><Trash2 size={16} /></button></div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    </section>
                </div>

                <div className="fixed bottom-28 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-8 z-[100]">
                    <button disabled={isSubmitting || matchQueue.length === 0} onClick={startSpecialSession} className="w-full h-20 bg-gradient-to-r from-[#C9B075] via-[#F3E5AB] to-[#C9B075] text-black font-[1000] rounded-[24px] flex items-center justify-center gap-4 shadow-[0_20px_60px_rgba(201,176,117,0.5)] active:scale-95 transition-all disabled:opacity-20 uppercase tracking-[0.4em] border-2 border-white/30 text-[13px] italic"><Play fill="black" size={24} /> <span>SYNC & START LIVE COURT 🏁</span></button>
                </div>
            </main>
        );
    }

    // --- [STEP 4] Live Court (Original Step 3) ---
    if (step === 4) {
        return (
            <main className="flex flex-col min-h-screen bg-gradient-to-br from-[#0a0a0b] via-[#121214] to-[#0a0a0b] text-white font-sans w-full max-w-[480px] mx-auto relative pb-60 overflow-hidden" style={{ paddingBottom: "160px" }}>
                <header className="px-6 pt-4 flex items-center justify-between gap-4 mb-2 h-14 relative z-[100]">
                    <div className="flex items-center gap-2">
                        {isAdmin && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#C9B075] rounded-full shadow-[0_8px_20px_rgba(201,176,117,0.3)] border border-white/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                                <span className="text-[9px] font-[1000] text-black uppercase tracking-widest leading-none">ADMIN MODE</span>
                            </div>
                        )}
                        {isAdmin && (
                            <button onClick={() => setShowResetConfirm(true)} className="h-10 px-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-500/80 hover:bg-red-500/20 transition-all active:scale-95 group shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                                <RotateCw size={12} className="group-hover:rotate-180 transition-transform duration-500" />
                                <span className="text-[10px] font-black uppercase tracking-tighter">초기화</span>
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={execCopySchedule} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20">📋</button>
                        <button onClick={copyFinalResults} className="w-10 h-10 bg-[#C9B075]/10 border border-[#C9B075]/30 rounded-full flex items-center justify-center text-[#C9B075] text-sm active:scale-90 transition-all hover:bg-[#C9B075]/20">🏆</button>
                    </div>
                </header>

                <div className="w-full px-5 flex flex-col gap-2 relative z-50 border-y border-white/10 py-6" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(32px)' }}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest shrink-0">SESSION:</span>
                            <span className="text-[10px] font-bold text-white truncate uppercase tracking-tighter">{sessionTitle}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <div className="flex items-center gap-1"><span className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest leading-none">WIN:</span><span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none">{(firstPrize/1000).toFixed(0)}K</span></div>
                            <div className="mx-1.5 w-px h-2 bg-white/10" />
                            <div className="flex items-center gap-1"><span className="text-[9px] font-black text-rose-500 uppercase tracking-widest leading-none">PEN:</span><span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none">{(bottom25Penalty/1000).toFixed(0)}K</span></div>
                        </div>
                    </div>
                </div>

                <nav className="px-6 my-6 relative z-10 w-full flex justify-center">
                    <div className="flex bg-[#1A1A1A]/60 p-1.5 rounded-[24px] border border-white/5 backdrop-blur-xl shadow-2xl w-full">
                        {(['MATCHES', 'RANKING'] as const).map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3.5 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${activeTab === tab ? 'bg-[#C9B075] text-black shadow-lg' : 'text-white/40'}`}>
                                <span>{tab === 'MATCHES' ? '🔥' : '📊'}</span>
                                {tab}
                            </button>
                        ))}
                    </div>
                </nav>

                <div className="flex-1 px-4 overflow-y-auto no-scrollbar relative z-10">
                    {activeTab === 'MATCHES' ? (
                        <div className="space-y-12 pb-20">
                            <section>
                                <div className="flex items-center gap-3 ml-2 mb-6"><h2 className="text-2xl font-black italic tracking-tighter uppercase text-white">NOW PLAYING</h2>{matchQueue.filter(m => m.status === 'playing').length > 0 && (<span className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-[10px] font-black tracking-widest border border-red-500/30 active animate-pulse">LIVE</span>)}</div>
                                <div className="space-y-3">
                                    {matchQueue.filter(m => m.status === 'playing').map((m, idx) => (
                                        <motion.div layout key={m.id} className="rounded-2xl grid grid-cols-[50px_1fr_90px] items-center p-6 bg-white/5 border-t-2 border-white/20 shadow-2xl">
                                            <div className="flex items-center justify-center"><div className="w-9 h-9 bg-gradient-to-br from-[#C9B075] to-[#E5D29B] text-black rounded-full flex items-center justify-center shadow-lg"><span className="text-[12px] font-black italic">G{m.round || idx + 1}</span></div></div>
                                            <div className="flex items-center justify-center gap-3 text-center px-2 min-w-0">
                                                <div className="flex-1 flex flex-col items-center justify-center truncate"><span className="text-[16px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[0]} /></span><div className="h-px w-4 bg-white/10 my-0.5" /><span className="text-[16px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[1]} /></span></div>
                                                <span className="text-[#C9B075] font-black italic text-[10px] opacity-30 italic">vs</span>
                                                <div className="flex-1 flex flex-col items-center justify-center truncate"><span className="text-[16px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[2]} /></span><div className="h-px w-4 bg-white/10 my-0.5" /><span className="text-[16px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[3]} /></span></div>
                                            </div>
                                            <div className="flex items-center justify-end"><button onClick={() => { setTempScores({ s1: 0, s2: 0 }); setActiveMatchForScore(m); }} className="px-4 py-2.5 bg-[#C9B075] text-black font-black rounded-xl text-[9px] uppercase tracking-widest shadow-lg active:scale-95">SCORE</button></div>
                                        </motion.div>
                                    ))}
                                </div>
                            </section>
                            <section>
                                <h2 className="text-2xl font-black italic tracking-tighter uppercase text-white ml-2 mb-6">GOLD WAITING</h2>
                                <div className="space-y-3">
                                    {matchQueue.filter(m => m.status === 'waiting').map((m, idx) => (
                                        <motion.div layout key={m.id} className="rounded-2xl grid grid-cols-[50px_1fr_90px] items-center p-6 bg-white/5 border-t-2 border-white/20 shadow-2xl opacity-60">
                                            <div className="flex items-center justify-center"><div className="w-9 h-9 bg-white/10 text-[#C9B075] rounded-full flex items-center justify-center border border-[#C9B075]/20"><span className="text-[12px] font-black italic">G{m.round || idx + 1}</span></div></div>
                                            <div className="flex items-center justify-center gap-3 text-center px-2 min-w-0"><span className="flex-1 text-[16px] font-black text-white/80 truncate"><PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} /></span><span className="text-[#C9B075] opacity-20 italic font-black text-[10px]">vs</span><span className="flex-1 text-[16px] font-black text-white/80 truncate"><PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} /></span></div>
                                            <div className="flex items-center justify-end"><button onClick={() => handleStartMatch(m.id)} className="px-4 py-2.5 bg-white/10 text-[#C9B075] font-black rounded-xl text-[9px] uppercase tracking-widest border border-[#C9B075]/20 active:scale-95 transition-all">START 🚀</button></div>
                                        </motion.div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    ) : (
                        <RankingTab players={allPlayersInRanking} sessionTitle={sessionTitle} isArchive={false} isAdmin={isAdmin} prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }} onShareMatch={execCopySchedule} onShareResult={copyFinalResults} onFinalize={handleFinalArchive} isGenerating={isSubmitting} />
                    )}
                </div>

                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-8 z-[100]">
                    <div className="bg-[#0A0A0A]/80 backdrop-blur-3xl border border-white/10 p-2.5 rounded-full shadow-2xl flex gap-3">
                        {isAdmin && (<button onClick={() => setStep(3)} className="w-16 h-16 bg-white/5 text-[#C9B075] rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-all"><Plus size={24} strokeWidth={3} /></button>)}
                        <button disabled={isSubmitting || !matchQueue.every(m => m.status === 'complete')} onClick={handleFinalArchive} className="flex-1 h-16 bg-[#C9B075] text-black font-[1000] rounded-full flex items-center justify-center gap-4 shadow-lg active:scale-95 transition-all uppercase tracking-[0.3em] text-[11px] disabled:opacity-20"><Save size={18} /><span>최종 아카이브 전송</span></button>
                    </div>
                </div>

                {/* Score Entry Modal */}
                {activeMatchForScore && (
                    <div className="fixed inset-0 z-[2000] flex items-center justify-center px-8 bg-black/90 backdrop-blur-md">
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-[360px] bg-[#1A1A1A] rounded-[40px] p-8 border border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.8)]">
                             <div className="text-center mb-8"><span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase">Enter Score</span><h3 className="text-2xl font-black italic tracking-tighter text-white mt-1 uppercase">MATCH RESULTS</h3></div>
                             <div className="grid grid-cols-2 gap-8 mb-10">
                                <div className="flex flex-col items-center gap-4"><span className="text-[11px] font-black text-white/40 uppercase tracking-widest text-center h-8 leading-none flex items-center truncate max-w-full"><PlayerNameBadge id={activeMatchForScore.playerIds[0]} /> / <PlayerNameBadge id={activeMatchForScore.playerIds[1]} /></span><div className="flex items-center gap-4"><button onClick={() => setTempScores(p => ({ ...p, s1: Math.max(0, p.s1 - 1) }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">-</button><span className="text-4xl font-black text-[#C9B075] font-mono">{tempScores.s1}</span><button onClick={() => setTempScores(p => ({ ...p, s1: p.s1 + 1 }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">+</button></div></div>
                                <div className="flex flex-col items-center gap-4"><span className="text-[11px] font-black text-white/40 uppercase tracking-widest text-center h-8 leading-none flex items-center truncate max-w-full"><PlayerNameBadge id={activeMatchForScore.playerIds[2]} /> / <PlayerNameBadge id={activeMatchForScore.playerIds[3]} /></span><div className="flex items-center gap-4"><button onClick={() => setTempScores(p => ({ ...p, s2: Math.max(0, p.s2 - 1) }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">-</button><span className="text-4xl font-black text-[#C9B075] font-mono">{tempScores.s2}</span><button onClick={() => setTempScores(p => ({ ...p, s2: p.s2 + 1 }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">+</button></div></div>
                             </div>
                             <div className="flex flex-col gap-3">
                                <button onClick={() => updateMatchScore(activeMatchForScore.id, tempScores.s1, tempScores.s2)} className="w-full py-5 bg-[#C9B075] text-black font-black rounded-full shadow-lg active:scale-95 transition-all uppercase tracking-widest text-sm">기록 저장 💾</button>
                                <button onClick={() => setActiveMatchForScore(null)} className="w-full py-4 text-white/30 font-black uppercase tracking-widest text-[10px]">취소</button>
                             </div>
                        </motion.div>
                    </div>
                )}
            </main>
        );
    }

    return null;
}
