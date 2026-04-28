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
import { Trash2, Plus, Play, CheckCircle2, Trophy, LayoutGrid, Save, Calendar, Sparkles, RotateCw, ArrowLeft, Clock, Zap, Target } from 'lucide-react';

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
    const [matchQueue, setMatchQueue] = useState<Match[]>([]);
    const [sessionId, setSessionId] = useState<string>(() => `SP-${Date.now()}`);
    const [sessionTitle, setSessionTitle] = useState("");
    
    // Scoring State
    const [activeMatchForScore, setActiveMatchForScore] = useState<Match | null>(null);
    const [tempScores, setTempScores] = useState({ s1: 0, s2: 0 });
    
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [activeTab, setActiveTab] = useState<'MATCHES' | 'RANKING'>('MATCHES');
    
    // Configuration Aligned with High-Fidelity UI
    const [totalCourts, setTotalCourts] = useState(1);
    const [matchMins, setMatchMins] = useState(30);
    const [firstPrize, setFirstPrize] = useState(10000);
    const [bottom25Late, setBottom25Late] = useState(3000);
    const [bottom25Penalty, setBottom25Penalty] = useState(5000);
    
    const [attendeeConfigs, setAttendeeConfigs] = useState<Record<string, AttendeeConfig>>({});

    const playerStats = useMemo(() => {
        const stats: Record<string, { id: string, name: string, wins: number, losses: number, diff: number, pf: number, pa: number }> = {};
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
                if (win) stats[pid].wins++; else stats[pid].losses++;
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
        }).sort((a, b) => (b.wins - a.wins) || (b.diff - a.diff) || ((a.age || 99) - (b.age || 99)));
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
                    if (data.constraints) {
                        setTotalCourts(data.constraints.totalCourts || 1);
                        setMatchMins(data.constraints.matchMins || 30);
                    }
                    if (data.matches && data.matches.length > 0) setStep(4);
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
        const newMatch: Match = {
            id: `special-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            playerIds: draftSlots as string[],
            court: null, status: 'waiting', mode: 'SPECIAL', round: matchQueue.length + 1,
            teams: [[draftSlots[0]!, draftSlots[1]!], [draftSlots[2]!, draftSlots[3]!]]
        };
        setMatchQueue(prev => [...prev, newMatch]);
        setDraftSlots([null, null, null, null]);
    };

    const removeMatchFromQueue = (id: string) => { setMatchQueue(prev => prev.filter(m => m.id !== id)); };

    const startSpecialSession = async () => {
        if (matchQueue.length === 0) { alert("최소 1개 이상의 대진이 필요합니다."); return; }
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const dbMatches = matchQueue.map((m, idx) => ({
                ...m, round: idx + 1, session_id: sessionId, club_id: clubId, session_title: sessionTitle, status: m.status || 'waiting', 
                player_names: m.playerIds.map(pid => getPlayerName(pid))
            }));
            await supabase.rpc('sync_tournament_matches', { p_matches: dbMatches });
        } catch (err: any) { console.error("Sync Logic Failure:", err.message); } finally {
            const sessionData = {
                sessionId, sessionTitle, matches: matchQueue, selectedIds: Array.from(selectedIds), tempGuests, attendeeConfigs,
                prizes: { firstPrize, bottom25Late, bottom25Penalty },
                constraints: { totalCourts, matchMins }
            };
            localStorage.setItem('special_live_session', JSON.stringify(sessionData));
            setStep(4);
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
        return (<span className="truncate">{cleanName}{isGuest && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic font-medium">(G)</span>}</span>);
    };

    const handleStartMatch = async (matchId: string) => {
        const nextQueue = matchQueue.map(m => m.id === matchId ? { ...m, status: 'playing' as const } : m);
        setMatchQueue(nextQueue);
        try {
            const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
            const target = nextQueue.find(m => m.id === matchId)!;
            const dbMatch = { ...target, session_id: sessionId, club_id: clubId, status: 'playing', session_title: sessionTitle, player_names: target.playerIds.map(pid => getPlayerName(pid)) };
            await supabase.rpc('sync_tournament_matches', { p_matches: [dbMatch] });
        } catch (e) { console.error("Sync Error:", e); }
    };

    const updateMatchScore = async (matchId: string, s1: number, s2: number) => {
        const nextQueue = matchQueue.map(m => m.id === matchId ? { ...m, score1: s1, score2: s2, status: 'complete' as const } : m);
        setMatchQueue(nextQueue);
        setActiveMatchForScore(null);
        localStorage.setItem('special_live_session', JSON.stringify({ sessionId, sessionTitle, matches: nextQueue, selectedIds: Array.from(selectedIds), tempGuests }));
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

    // --- [STEP 2] High-Fidelity Configuration (Refined) ---
    if (step === 2) {
        const attendees = Array.from(selectedIds).map(id => {
            const m = [...allMembers, ...tempGuests].find(x => x.id === id);
            return { id, name: m?.nickname || 'Unknown', is_guest: !!m?.is_guest };
        });
        const timeOptions = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00"];

        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full max-w-[480px] mx-auto relative pb-60">
                <header className="grid grid-cols-3 px-6 mb-4 items-center h-12 shrink-0 pt-4 relative z-[100]">
                    <div className="flex items-center"><button onClick={() => setStep(1)} className="w-10 h-10 rounded-full flex items-center justify-center border border-[#C9B075]/30 bg-[#C9B075]/10 text-[#C9B075] active:scale-95 transition-all"><ArrowLeft size={18} /></button></div>
                    <div className="text-center flex flex-col items-center gap-2"><div className="flex flex-col items-center"><span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase px-3 py-1 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 mb-1 leading-none scale-90">Step 02</span><h1 className="text-3xl font-black italic tracking-tighter uppercase text-white leading-none">경기 대진 설정</h1></div></div>
                </header>

                <div className="px-6 space-y-8 w-full pt-12 overflow-y-auto no-scrollbar pb-40">
                    {/* 1. Archive Title */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2"><span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" /><h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Archive Title</h3></div>
                        <input type="text" value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-[24px] px-6 py-5 text-sm font-black text-white outline-none transition-all" />
                    </section>

                    {/* 2. Attendee Matrix */}
                    <section style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '32px', padding: '24px' }}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-[11px] font-bold text-[#C9B075] tracking-[0.3em] uppercase flex items-center gap-3"><span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" />ATTENDEE MATRIX</h3>
                            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">{attendees.length} ACTIVE</span>
                        </div>
                        <div className="space-y-3">
                            {attendees.map(m => {
                                const config = attendeeConfigs[m.id] || { id: m.id, name: m.name, startTime: "19:00", endTime: "22:00", group: "A" };
                                return (
                                    <div key={m.id} className="bg-[#0A0A0A] border border-white/5 rounded-2xl p-4 flex flex-col gap-3">
                                        <span className="text-[15px] font-black text-white/90">{m.name}{m.is_guest ? ' (G)' : ''}</span>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40"><Clock size={16} /></div>
                                                <div className="flex items-center gap-2 bg-black border border-white/10 rounded-xl px-3 py-2">
                                                    <select value={config.startTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, startTime: e.target.value } }))} className="bg-transparent text-white text-[13px] font-black outline-none appearance-none w-11 text-center">{timeOptions.map(t => <option key={t} value={t} className="bg-[#1C1C1E]">{t}</option>)}</select>
                                                    <span className="text-white/20 text-[9px] font-black">TO</span>
                                                    <select value={config.endTime} onChange={e => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, endTime: e.target.value } }))} className="bg-transparent text-white text-[13px] font-black outline-none appearance-none w-11 text-center">{timeOptions.map(t => <option key={t} value={t} className="bg-[#1C1C1E]">{t}</option>)}</select>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'A' } }))} className={`w-11 h-11 rounded-xl font-black transition-all flex items-center justify-center border ${config.group === 'A' ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-lg' : 'bg-white/5 border-white/10 text-white/40'}`}>A</button>
                                                <button onClick={() => setAttendeeConfigs(prev => ({ ...prev, [m.id]: { ...config, group: 'B' } }))} className={`w-11 h-11 rounded-xl font-black transition-all flex items-center justify-center border ${config.group === 'B' ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-lg' : 'bg-white/5 border-white/10 text-white/40'}`}>B</button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* 3. Constraints (Image 2 style) */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2"><span className="w-1.5 h-1.5 rounded-full bg-[#C9B075]" /><h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Constraints</h3></div>
                        <div className="grid grid-cols-1 gap-3">
                             <div className="bg-[#141414] border border-white/10 rounded-[24px] p-6 flex items-center justify-between">
                                <div className="flex flex-col"><span className="text-[12px] font-black text-white/80 uppercase tracking-widest">Total Courts</span></div>
                                <div className="flex items-center gap-6">
                                    <button onClick={() => setTotalCourts(p => Math.max(1, p - 1))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">-</button>
                                    <span className="text-2xl font-black text-[#C9B075] w-10 text-center">{totalCourts}</span>
                                    <button onClick={() => setTotalCourts(p => p + 1)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">+</button>
                                </div>
                             </div>
                             <div className="bg-[#141414] border border-white/10 rounded-[24px] p-6 flex items-center justify-between">
                                <div className="flex flex-col"><span className="text-[12px] font-black text-white/80 uppercase tracking-widest">Match Mins</span></div>
                                <div className="flex items-center gap-6">
                                    <button onClick={() => setMatchMins(p => Math.max(5, p - 5))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">-</button>
                                    <span className="text-2xl font-black text-[#C9B075] w-10 text-center">{matchMins}</span>
                                    <button onClick={() => setMatchMins(p => p + 5)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">+</button>
                                </div>
                             </div>
                        </div>
                    </section>

                    {/* 4. Financials (Image 2 style) */}
                    <section className="space-y-4">
                        <div className="flex items-center gap-3 px-2"><span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" /><h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em]">Financials</h3></div>
                        <div className="grid grid-cols-1 gap-3">
                             <div className="bg-[#141414] border border-white/10 rounded-[24px] p-6 flex items-center justify-between">
                                <span className="text-[12px] font-black text-white/80 uppercase tracking-widest">Prize Gold</span>
                                <div className="flex items-center gap-6">
                                    <button onClick={() => setFirstPrize(p => Math.max(0, p - 5000))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">-</button>
                                    <span className="text-2xl font-black text-white w-16 text-center">{(firstPrize/1000).toFixed(0)}k</span>
                                    <button onClick={() => setFirstPrize(p => p + 5000)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">+</button>
                                </div>
                             </div>
                             <div className="bg-[#141414] border border-white/10 rounded-[24px] p-6 flex items-center justify-between">
                                <div className="flex flex-col"><span className="text-[12px] font-black text-[#C9B075] uppercase tracking-widest">Tier 1 Fine</span><span className="text-[9px] font-bold text-white/20">BOTTOM 25%~50%</span></div>
                                <div className="flex items-center gap-6">
                                    <button onClick={() => setBottom25Late(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">-</button>
                                    <span className="text-2xl font-black text-white w-16 text-center">{(bottom25Late/1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Late(p => p + 1000)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">+</button>
                                </div>
                             </div>
                             <div className="bg-[#141414] border border-white/10 rounded-[24px] p-6 flex items-center justify-between">
                                <div className="flex flex-col"><span className="text-[12px] font-black text-rose-500 uppercase tracking-widest">Tier 2 Fine</span><span className="text-[9px] font-bold text-white/20">BOTTOM 0%~25%</span></div>
                                <div className="flex items-center gap-6">
                                    <button onClick={() => setBottom25Penalty(p => Math.max(0, p - 1000))} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">-</button>
                                    <span className="text-2xl font-black text-white w-16 text-center">{(bottom25Penalty/1000).toFixed(0)}k</span>
                                    <button onClick={() => setBottom25Penalty(p => p + 1000)} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-xl font-bold">+</button>
                                </div>
                             </div>
                        </div>
                    </section>
                </div>

                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-8 z-[200]">
                    <button onClick={startMatchBuilder} className="w-full h-20 rounded-[40px] bg-[#C9B075] text-black font-[1000] text-lg uppercase tracking-wider shadow-[0_20px_50px_rgba(201,176,117,0.4)] active:scale-95 transition-all border-none">매뉴얼 대진 생성 시작! 🚀</button>
                </div>
            </main>
        );
    }

    // --- [STEP 3] Manual Match Builder (Pure Drafting - Image 3 Style) ---
    if (step === 3) {
        const selectedMembers = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id));
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full max-w-[480px] mx-auto pb-96 relative overflow-x-hidden">
                <header className="fixed top-0 w-full max-w-[480px] z-[150] bg-black/90 backdrop-blur-3xl border-b border-white/10 h-20 flex items-center px-8 justify-between">
                    <button onClick={() => setStep(2)} className="p-3 bg-white/5 rounded-2xl text-white/40 active:scale-90 transition-all"><ArrowLeft size={20} /></button>
                    <div className="text-center flex flex-col"><span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase leading-none mb-1">BUILDER</span><h1 className="text-xl font-black italic tracking-tighter text-white uppercase truncate max-w-[200px] leading-none">{sessionTitle}</h1></div>
                    <button onClick={() => setShowResetConfirm(true)} className="p-3 bg-red-500/10 rounded-2xl text-red-500 active:scale-95 transition-all"><Trash2 size={18} /></button>
                </header>

                <div className="mt-28 px-8 space-y-12 pb-[300px]">
                    {/* Player Bank */}
                    <section>
                        <div className="flex items-center justify-between mb-6 px-1">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">Player Bank</h3>
                            <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">{selectedMembers.length} Available</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {selectedMembers.map(m => (
                                <button key={m.id} onClick={() => addToDraft(m.id)} disabled={draftSlots.includes(m.id)} className={`h-11 px-5 rounded-xl font-black text-[13px] tracking-tight transition-all border ${draftSlots.includes(m.id) ? 'bg-white/5 border-transparent text-transparent' : 'bg-[#141414] border-white/5 text-white/80 active:scale-95 hover:border-[#C9B075]/40 hover:text-white'}`}>{m.nickname}</button>
                            ))}
                        </div>
                    </section>

                    {/* Match Construction (Image 3 Style - Minimalist) */}
                    <section className="bg-[#141414] rounded-[40px] p-8 border border-white/5 shadow-2xl relative">
                        <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase mb-10 text-center opacity-40">Match Construction</h3>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
                            <div className="space-y-4">{[0, 1].map(i => (<div key={i} onClick={() => removeFromDraft(i)} className="h-28 rounded-[32px] bg-black/60 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group hover:border-[#C9B075]/30 transition-all">{draftSlots[i] ? (<motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center"><span className="font-black text-white text-[17px] tracking-tight">{getPlayerName(draftSlots[i]!)}</span><div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/10 text-red-500 text-[8px] font-black uppercase text-center opacity-0 group-hover:opacity-100 transition-opacity">REMOVE</div></motion.div>) : (<Plus className="text-white/5" size={32} />)}</div>))}</div>
                            <div className="flex flex-col items-center gap-2"><div className="w-px h-16 bg-gradient-to-b from-transparent via-[#C9B075]/20 to-transparent" /><span className="text-[#C9B075] font-black italic text-4xl opacity-10 tracking-widest">VS</span><div className="w-px h-16 bg-gradient-to-t from-transparent via-[#C9B075]/20 to-transparent" /></div>
                            <div className="space-y-4">{[2, 3].map(i => (<div key={i} onClick={() => removeFromDraft(i)} className="h-28 rounded-[32px] bg-black/60 border border-white/5 flex items-center justify-center cursor-pointer relative overflow-hidden group hover:border-[#C9B075]/30 transition-all">{draftSlots[i] ? (<motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center"><span className="font-black text-white text-[17px] tracking-tight">{getPlayerName(draftSlots[i]!)}</span><div className="absolute inset-x-0 bottom-0 py-1 bg-red-500/10 text-red-500 text-[8px] font-black uppercase text-center opacity-0 group-hover:opacity-100 transition-opacity">REMOVE</div></motion.div>) : (<Plus className="text-white/5" size={32} />)}</div>))}</div>
                        </div>
                        <button onClick={addMatchToQueue} disabled={draftSlots.includes(null)} className="w-full mt-10 py-5 bg-white/5 text-[#C9B075] font-black rounded-[24px] border border-[#C9B075]/20 active:scale-95 transition-all text-[12px] uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-10"><Plus size={18} strokeWidth={4} /> Add to current Queue</button>
                    </section>

                    {/* Match Queue */}
                    <section className="pb-40">
                         <div className="flex items-center justify-between mb-8 px-1">
                            <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">{matchQueue.length} Matches Planned</h3>
                            {matchQueue.length > 0 && (<button onClick={startSpecialSession} className="px-6 py-4 bg-[#C9B075] text-black text-[12px] font-black rounded-full uppercase tracking-widest active:scale-90 transition-all italic flex items-center gap-2">Start Live Court <Play size={14} fill="black" /></button>)}
                        </div>
                        <Reorder.Group axis="y" values={matchQueue} onReorder={handleReorder} className="space-y-3 px-1">
                            {matchQueue.map((m, idx) => (
                                <Reorder.Item key={m.id} value={m} className="rounded-[24px] grid grid-cols-[50px_1fr_60px] items-center p-6 bg-white/5 border border-white/5 shadow-xl cursor-grab active:cursor-grabbing mb-2 transition-all">
                                    <div className="flex items-center justify-center"><div className="w-9 h-9 bg-white/10 text-[#C9B075] rounded-full flex items-center justify-center border border-[#C9B075]/20"><span className="text-[12px] font-black italic">G{idx + 1}</span></div></div>
                                    <div className="flex items-center justify-center gap-4 text-center px-2 min-w-0"><span className="flex-1 text-white font-bold truncate text-right text-[15px]"><PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} /></span><span className="text-[10px] font-black uppercase italic tracking-widest opacity-20 text-[#C9B075]">vs</span><span className="flex-1 text-white font-bold truncate text-left text-[15px]"><PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} /></span></div>
                                    <div className="flex items-center justify-end"><button onClick={() => removeMatchFromQueue(m.id)} className="p-3 text-white/20 hover:text-red-500 transition-all active:scale-90"><Trash2 size={16} /></button></div>
                                </Reorder.Item>
                            ))}
                        </Reorder.Group>
                    </section>
                </div>

                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-8 z-[200]">
                    <button disabled={isSubmitting || matchQueue.length === 0} onClick={startSpecialSession} className="w-full h-20 bg-gradient-to-r from-[#C9B075] via-[#F3E5AB] to-[#C9B075] text-black font-[1000] rounded-[40px] flex items-center justify-center gap-4 shadow-2xl active:scale-95 transition-all disabled:opacity-20 uppercase tracking-[0.3em] text-[13px] italic"><Play fill="black" size={24} /> <span>SYNC & START LIVE COURT 🏁</span></button>
                </div>
            </main>
        );
    }

    // --- [STEP 4] Live Court (Minimal Score Entry Modal) ---
    if (step === 4) {
        return (
            <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full max-w-[480px] mx-auto relative pb-60 overflow-hidden" style={{ paddingBottom: "160px" }}>
                <header className="px-6 pt-6 flex items-center justify-between gap-4 mb-2 h-14 relative z-[100]">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-[#C9B075] rounded-full border border-white/20"><span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" /><span className="text-[9px] font-black text-black uppercase tracking-widest">LIVE MODE</span></div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={execCopySchedule} className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center text-[#C9B075] active:scale-90 transition-all">📋</button>
                        <button onClick={copyFinalResults} className="w-10 h-10 bg-white/5 border border-white/10 rounded-full flex items-center justify-center text-[#C9B075] active:scale-90 transition-all">🏆</button>
                    </div>
                </header>

                <div className="w-full px-5 flex flex-col gap-2 relative z-50 border-y border-white/5 py-6 mt-4" style={{ background: 'rgba(10,10,10,0.8)', backdropFilter: 'blur(32px)' }}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5 min-w-0"><span className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest shrink-0">SESSION:</span><span className="text-[10px] font-bold text-white truncate uppercase tracking-tighter">{sessionTitle}</span></div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <div className="flex items-center gap-1"><span className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest leading-none">WIN:</span><span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none">{(firstPrize/1000).toFixed(0)}K</span></div>
                            <div className="mx-1.5 w-px h-2 bg-white/10" />
                            <div className="flex items-center gap-1"><span className="text-[9px] font-black text-rose-500 uppercase tracking-widest leading-none">PEN:</span><span className="text-[10px] font-bold text-white tracking-tighter uppercase leading-none">{(bottom25Penalty/1000).toFixed(0)}K</span></div>
                        </div>
                    </div>
                </div>

                <nav className="px-6 my-6 relative z-10 w-full flex justify-center">
                    <div className="flex bg-[#141414] p-1 rounded-full border border-white/5 shadow-2xl w-full">
                        {(['MATCHES', 'RANKING'] as const).map(tab => (
                            <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${activeTab === tab ? 'bg-[#C9B075] text-black' : 'text-white/30'}`}>{tab}</button>
                        ))}
                    </div>
                </nav>

                <div className="flex-1 px-4 overflow-y-auto no-scrollbar relative z-10">
                    {activeTab === 'MATCHES' ? (
                        <div className="space-y-12 pb-20 pt-4">
                            <section>
                                <div className="flex items-center gap-3 ml-2 mb-6"><h2 className="text-xl font-black italic tracking-tighter uppercase text-white">NOW PLAYING</h2>{matchQueue.filter(m => m.status === 'playing').length > 0 && (<span className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 text-red-500 rounded-full text-[9px] font-black tracking-widest animate-pulse">LIVE</span>)}</div>
                                <div className="space-y-3">
                                    {matchQueue.filter(m => m.status === 'playing').map((m, idx) => (
                                        <div key={m.id} className="rounded-[32px] grid grid-cols-[50px_1fr_80px] items-center p-6 bg-white/5 border border-white/5 shadow-xl">
                                            <div className="flex items-center justify-center"><div className="w-9 h-9 bg-[#C9B075] text-black rounded-full flex items-center justify-center shadow-lg"><span className="text-[12px] font-black italic">G{m.round || idx + 1}</span></div></div>
                                            <div className="flex items-center justify-center gap-2 text-center px-2 min-w-0">
                                                <div className="flex-1 flex flex-col items-center justify-center truncate"><span className="text-[15px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[0]} /></span><div className="h-px w-3 bg-white/10 my-0.5" /><span className="text-[15px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[1]} /></span></div>
                                                <span className="text-[#C9B075] font-black italic text-[9px] opacity-20">vs</span>
                                                <div className="flex-1 flex flex-col items-center justify-center truncate"><span className="text-[15px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[2]} /></span><div className="h-px w-3 bg-white/10 my-0.5" /><span className="text-[15px] font-black text-white truncate"><PlayerNameBadge id={m.playerIds[3]} /></span></div>
                                            </div>
                                            <div className="flex items-center justify-end"><button onClick={() => { setTempScores({ s1: 0, s2: 0 }); setActiveMatchForScore(m); }} className="px-4 py-2 bg-[#C9B075] text-black font-black rounded-xl text-[9px] tracking-widest active:scale-95">SCORE</button></div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                            <section>
                                <h2 className="text-xl font-black italic tracking-tighter uppercase text-white/30 ml-2 mb-6">WAITING</h2>
                                <div className="space-y-3">
                                    {matchQueue.filter(m => m.status === 'waiting').map((m, idx) => (
                                        <div key={m.id} className="rounded-[32px] grid grid-cols-[50px_1fr_80px] items-center p-6 bg-white/[0.02] border border-white/5 opacity-50">
                                            <div className="flex items-center justify-center"><div className="w-9 h-9 bg-white/5 text-[#C9B075] rounded-full flex items-center justify-center border border-white/10"><span className="text-[12px] font-black italic">G{m.round || idx + 1}</span></div></div>
                                            <div className="flex items-center justify-center gap-2 text-center px-2 min-w-0"><span className="flex-1 text-[14px] font-bold text-white/60 truncate"><PlayerNameBadge id={m.playerIds[0]} /> / <PlayerNameBadge id={m.playerIds[1]} /></span><span className="text-[#C9B075] opacity-20 italic font-black text-[9px]">vs</span><span className="flex-1 text-[14px] font-bold text-white/60 truncate"><PlayerNameBadge id={m.playerIds[2]} /> / <PlayerNameBadge id={m.playerIds[3]} /></span></div>
                                            <div className="flex items-center justify-end"><button onClick={() => handleStartMatch(m.id)} className="px-4 py-2 bg-white/5 text-[#C9B075] font-black rounded-xl text-[9px] border border-white/10 active:scale-95">START</button></div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    ) : (
                        <RankingTab players={allPlayersInRanking} sessionTitle={sessionTitle} isArchive={false} isAdmin={isAdmin} prizes={{ first: firstPrize, l1: bottom25Late, l2: bottom25Penalty }} onShareMatch={execCopySchedule} onShareResult={copyFinalResults} onFinalize={handleFinalArchive} isGenerating={isSubmitting} />
                    )}
                </div>

                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-8 z-[100]">
                    <div className="bg-[#141414] border border-white/5 p-2 rounded-full shadow-2xl flex gap-3">
                        {isAdmin && (<button onClick={() => setStep(3)} className="w-16 h-16 bg-white/5 text-[#C9B075] rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-all"><Plus size={24} strokeWidth={3} /></button>)}
                        <button disabled={isSubmitting || !matchQueue.every(m => m.status === 'complete')} onClick={handleFinalArchive} className="flex-1 h-16 bg-[#C9B075] text-black font-[1000] rounded-full flex items-center justify-center gap-4 shadow-lg active:scale-95 transition-all uppercase tracking-widest text-[11px] disabled:opacity-20">최종 아카이브 전송</button>
                    </div>
                </div>

                {activeMatchForScore && (
                    <div className="fixed inset-0 z-[2000] flex items-center justify-center px-8 bg-black/95 backdrop-blur-md">
                        <div className="w-full max-w-[360px] bg-[#141414] rounded-[40px] p-8 border border-white/10 shadow-2xl">
                             <div className="text-center mb-8"><span className="text-[10px] font-black text-[#C9B075] tracking-[0.4em] uppercase">ENTER SCORE</span><h3 className="text-xl font-black italic tracking-tighter text-white mt-1 uppercase">MATCH RESULTS</h3></div>
                             <div className="grid grid-cols-2 gap-8 mb-10">
                                <div className="flex flex-col items-center gap-4"><span className="text-[11px] font-black text-white/40 uppercase tracking-widest text-center h-8 leading-none flex items-center truncate max-w-full"><PlayerNameBadge id={activeMatchForScore.playerIds[0]} /> / <PlayerNameBadge id={activeMatchForScore.playerIds[1]} /></span><div className="flex items-center gap-4"><button onClick={() => setTempScores(p => ({ ...p, s1: Math.max(0, p.s1 - 1) }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">-</button><span className="text-4xl font-black text-[#C9B075] font-mono">{tempScores.s1}</span><button onClick={() => setTempScores(p => ({ ...p, s1: p.s1 + 1 }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">+</button></div></div>
                                <div className="flex flex-col items-center gap-4"><span className="text-[11px] font-black text-white/40 uppercase tracking-widest text-center h-8 leading-none flex items-center truncate max-w-full"><PlayerNameBadge id={activeMatchForScore.playerIds[2]} /> / <PlayerNameBadge id={activeMatchForScore.playerIds[3]} /></span><div className="flex items-center gap-4"><button onClick={() => setTempScores(p => ({ ...p, s2: Math.max(0, p.s2 - 1) }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">-</button><span className="text-4xl font-black text-[#C9B075] font-mono">{tempScores.s2}</span><button onClick={() => setTempScores(p => ({ ...p, s2: p.s2 + 1 }))} className="w-10 h-10 rounded-full bg-white/5 text-white/40 font-bold">+</button></div></div>
                             </div>
                             <div className="flex flex-col gap-3">
                                <button onClick={() => updateMatchScore(activeMatchForScore.id, tempScores.s1, tempScores.s2)} className="w-full py-5 bg-[#C9B075] text-black font-black rounded-full shadow-lg active:scale-95 transition-all uppercase tracking-widest text-sm">기록 저장 💾</button>
                                <button onClick={() => setActiveMatchForScore(null)} className="w-full py-4 text-white/20 font-black uppercase tracking-widest text-[10px]">취소</button>
                             </div>
                        </div>
                    </div>
                )}
            </main>
        );
    }

    return (
        <AnimatePresence>
            {showResetConfirm && (
                <div className="fixed inset-0 z-[3000] flex items-center justify-center px-8 bg-black/90 backdrop-blur-md">
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
