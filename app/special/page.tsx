
'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Member, Match } from '@/lib/tournament_types';
import MemberSelector from '@/components/tournament/MemberSelector';
import { WarningModal, CustomConfirmModal } from '@/components/tournament/Modals';
import { Reorder, motion, AnimatePresence } from 'framer-motion';
import { Trash2, GripVertical, Plus, Play, CheckCircle2, Trophy, Swords as SwordsIcon, Save } from 'lucide-react';

export default function SpecialMatchPage() {
    const router = useRouter();
    const { role, hasPermission, getRestrictionMessage } = useAuth();
    const isAdmin = role === 'CEO' || role === 'Staff' || role === 'ADMIN';

    const [step, setStep] = useState(1);
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
        if (next.has(id)) next.delete(id);
        else next.add(id);
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

            // Save to LocalStorage for Gatekeeper
            const sessionData = {
                sessionId,
                sessionTitle,
                matches: matchQueue,
                selectedIds: Array.from(selectedIds),
                tempGuests
            };
            localStorage.setItem('special_live_session', JSON.stringify(sessionData));

            setStep(2); // Stay on drafting page which now acts as Live Court
            alert("스페셜 세션이 동기화되었습니다! 🚀");
        } catch (err: any) {
            alert("동기화 실패: " + err.message);
        } finally {
            setIsSubmitting(false);
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
                type: 'SPECIAL',
                snapshot_data: matchQueue.map(m => ({
                    ...m,
                    player_names: m.playerIds.map(pid => getPlayerName(pid))
                })),
                ranking_data: Object.values(stats).sort((a,b) => b.wins - a.wins || b.diff - a.diff).map((s, i) => ({ ...s, rank: i + 1 })),
                player_metadata: Array.from(selectedIds).reduce((acc, id) => {
                    const m = [...allMembers, ...tempGuests].find(x => x.id === id);
                    acc[id] = { name: m?.nickname, avatar: m?.avatar_url };
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
                sessionKey="special_live_session"
            />
        );
    }

    const selectedMembers = [...allMembers, ...tempGuests].filter(m => selectedIds.has(m.id));

    return (
        <main className="flex flex-col min-h-screen bg-[#121212] text-white font-sans w-full max-w-[480px] mx-auto pb-40">
            <header className="fixed top-0 w-full max-w-[480px] z-50 bg-black/80 backdrop-blur-xl border-b border-white/5 h-16 flex items-center px-6 justify-between">
                <button onClick={() => setStep(1)} className="p-2 bg-white/5 rounded-full text-white/40"><Plus className="rotate-45" size={20} /></button>
                <div className="text-center flex flex-col">
                    <span className="text-[10px] font-black text-[#C9B075] tracking-widest uppercase">Special Match</span>
                    <h1 className="text-xl font-black italic tracking-tighter text-white uppercase">{sessionTitle}</h1>
                </div>
                <button onClick={() => setShowResetConfirm(true)} className="p-2 bg-red-500/10 rounded-full text-red-500"><Trash2 size={18} /></button>
            </header>

            <div className="mt-20 px-6 space-y-8">
                {/* Player Bank */}
                <section>
                    <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase mb-4 px-1">Selected Players</h3>
                    <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar">
                        {selectedMembers.map(m => (
                            <button
                                key={m.id}
                                onClick={() => addToDraft(m.id)}
                                disabled={draftSlots.includes(m.id)}
                                className={`shrink-0 h-14 px-5 rounded-2xl font-bold transition-all border
                                ${draftSlots.includes(m.id) ? 'bg-white/5 border-white/5 text-white/10 opacity-30 select-none' : 'bg-[#1A1A1A] border-white/10 text-white/80 active:scale-95'}`}
                            >
                                {m.nickname}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Drafting Slots */}
                <section className="bg-[#1A1A1A] rounded-[32px] p-6 border border-white/5 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5"><Swords size={60} /></div>
                    <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase mb-6 text-center">Match Construction</h3>
                    
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                        <div className="space-y-3">
                            {[0, 1].map(i => (
                                <div key={i} onClick={() => removeFromDraft(i)} className="h-16 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center cursor-pointer relative overflow-hidden group">
                                    {draftSlots[i] ? (
                                        <>
                                            <span className="font-black text-white">{getPlayerName(draftSlots[i]!)}</span>
                                            <div className="absolute inset-0 bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-red-500 text-[8px] font-bold">REMOVE</div>
                                        </>
                                    ) : (
                                        <span className="text-white/10 text-xs font-black uppercase">P{i+1}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="text-[#C9B075] font-black italic text-xl opacity-30">VS</div>
                        <div className="space-y-3">
                            {[2, 3].map(i => (
                                <div key={i} onClick={() => removeFromDraft(i)} className="h-16 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center cursor-pointer relative overflow-hidden group">
                                    {draftSlots[i] ? (
                                        <>
                                            <span className="font-black text-white">{getPlayerName(draftSlots[i]!)}</span>
                                            <div className="absolute inset-0 bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-red-500 text-[8px] font-bold">REMOVE</div>
                                        </>
                                    ) : (
                                        <span className="text-white/10 text-xs font-black uppercase">P{i+1}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={addMatchToQueue}
                        className="w-full mt-8 py-4 bg-[#C9B075] text-black font-black rounded-2xl shadow-lg active:scale-95 transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2"
                    >
                        <Plus size={18} strokeWidth={3} /> Add Match
                    </button>
                </section>

                {/* Match Queue with Reorder */}
                <section>
                    <div className="flex items-center justify-between mb-4 px-1">
                        <h3 className="text-[10px] font-black text-[#C9B075] tracking-[0.3em] uppercase">Match Queue</h3>
                        <span className="text-[10px] font-bold text-white/20 uppercase">{matchQueue.length} Matches</span>
                    </div>

                    <Reorder.Group axis="y" values={matchQueue} onReorder={setMatchQueue} className="space-y-3">
                        <AnimatePresence>
                            {matchQueue.map((m) => (
                                <Reorder.Item
                                    key={m.id}
                                    value={m}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="bg-[#1A1A1A] border border-white/5 rounded-2xl p-4 flex items-center gap-4 group active:cursor-grabbing"
                                >
                                    <div className="text-white/10 group-hover:text-[#C9B075]/40 transition-colors"><GripVertical size={20} /></div>
                                    <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                                        <div className="text-right flex flex-col min-w-0">
                                            <span className="font-bold text-sm truncate">{getPlayerName(m.playerIds[0])}</span>
                                            <span className="font-bold text-sm truncate">{getPlayerName(m.playerIds[1])}</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-1">
                                            {m.status === 'complete' ? (
                                                <div className="bg-[#C9B075] text-black px-2 py-0.5 rounded-lg text-[10px] font-black">
                                                    {m.score1}:{m.score2}
                                                </div>
                                            ) : (
                                                <div className="text-[8px] font-black text-[#C9B075]/40 italic uppercase">vs</div>
                                            )}
                                        </div>
                                        <div className="text-left flex flex-col min-w-0">
                                            <span className="font-bold text-sm truncate">{getPlayerName(m.playerIds[2])}</span>
                                            <span className="font-bold text-sm truncate">{getPlayerName(m.playerIds[3])}</span>
                                        </div>
                                    </div>
                                    
                                    {m.status !== 'complete' ? (
                                        <button 
                                            onClick={() => {
                                                setTempScores({ s1: 0, s2: 0 });
                                                setActiveMatchForScore(m);
                                            }}
                                            className="h-10 px-4 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black hover:bg-white/10 transition-all uppercase"
                                        >
                                            Score
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={() => {
                                                setTempScores({ s1: m.score1 || 0, s2: m.score2 || 0 });
                                                setActiveMatchForScore(m);
                                            }}
                                            className="p-2 text-[#C9B075] opacity-40 hover:opacity-100"
                                        >
                                            <Trophy size={16} />
                                        </button>
                                    )}
                                    <button onClick={() => removeMatchFromQueue(m.id)} className="p-2 text-white/5 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                                </Reorder.Item>
                            ))}
                        </AnimatePresence>
                    </Reorder.Group>
                    
                    {matchQueue.length === 0 && (
                        <div className="py-20 border-2 border-dashed border-white/5 rounded-[32px] flex flex-col items-center justify-center text-white/10">
                            <Plus size={40} className="mb-2 opacity-5" />
                            <span className="text-[10px] font-black uppercase tracking-widest">No matches drafted</span>
                        </div>
                    )}
                </section>
            </div>

            {/* Scoring Modal */}
            <AnimatePresence>
                {activeMatchForScore && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/85 backdrop-blur-md" 
                            onClick={() => setActiveMatchForScore(null)} 
                        />
                        <motion.div 
                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                            className="relative w-full max-w-lg rounded-[40px] p-8 pb-10 flex flex-col bg-[#121418] border-t-2 border-white/20 shadow-2xl"
                        >
                            <header className="flex flex-col items-center gap-2 text-center mb-10">
                                <span className="text-[10px] font-black text-[#C9B075] tracking-[0.5em] uppercase opacity-80">Score Input</span>
                                <h3 className="text-xl font-black italic text-white tracking-tight uppercase">Manual Match Result</h3>
                            </header>

                            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-6 mb-8">
                                {[0, 1].map(side => (
                                    <React.Fragment key={side}>
                                        <div className="flex flex-col gap-6">
                                            <div className="flex flex-col items-center text-center">
                                                <span className="text-xl font-black text-white leading-tight">
                                                    {getPlayerName(activeMatchForScore.playerIds[side * 2])}<br />
                                                    {getPlayerName(activeMatchForScore.playerIds[side * 2 + 1])}
                                                </span>
                                            </div>

                                            <div className="text-7xl font-black text-[#C9B075] text-center">
                                                {side === 0 ? tempScores.s1 : tempScores.s2}
                                            </div>

                                            <div className="grid grid-cols-4 gap-2">
                                                {[0, 1, 2, 3, 4, 5, 6].map(n => (
                                                    <button
                                                        key={n}
                                                        onClick={() => setTempScores(p => side === 0 ? ({ ...p, s1: n }) : ({ ...p, s2: n }))}
                                                        className={`h-12 rounded-lg font-black transition-all ${ (side === 0 ? tempScores.s1 : tempScores.s2) === n ? 'bg-[#C9B075] text-black shadow-[0_0_15px_#C9B07588]' : 'bg-white/5 text-white/20' }`}
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

                            <div className="flex gap-4">
                                <button onClick={() => setActiveMatchForScore(null)} className="flex-1 h-16 bg-white/5 text-white/30 font-black rounded-2xl uppercase text-[10px] tracking-widest active:scale-95 transition-all">Cancel</button>
                                <button
                                    disabled={tempScores.s1 === tempScores.s2}
                                    onClick={() => updateMatchScore(activeMatchForScore.id, tempScores.s1, tempScores.s2)}
                                    className="flex-[3] h-16 bg-[#C9B075] text-black font-black rounded-2xl uppercase text-lg tracking-widest shadow-xl disabled:opacity-20 active:scale-95 transition-all"
                                >
                                    Confirm Score 🏆
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Float Command Bar */}
            <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-[440px] px-6 flex gap-3">
                {matchQueue.length > 0 && matchQueue.every(m => m.status === 'complete') ? (
                    <button
                        disabled={isSubmitting}
                        onClick={handleFinalArchive}
                        className="w-full h-20 bg-gradient-to-r from-[#C9B075] to-[#B8860B] text-black font-black rounded-full flex items-center justify-center gap-4 shadow-[0_20px_50px_rgba(201,176,117,0.3)] active:scale-95 transition-all uppercase tracking-[0.2em] border border-white/20 animate-pulse"
                    >
                        <Save size={24} />
                        <span>FINALIZE & ARCHIVE 🏆</span>
                    </button>
                ) : (
                    <button
                        disabled={isSubmitting || matchQueue.length === 0}
                        onClick={startSpecialSession}
                        className="w-full h-20 bg-gradient-to-r from-[#C9B075] to-[#B8860B] text-black font-black rounded-full flex items-center justify-center gap-4 shadow-[0_20px_50px_rgba(201,176,117,0.3)] active:scale-95 transition-all disabled:opacity-20 uppercase tracking-[0.2em] border border-white/20"
                    >
                        <Play fill="black" size={24} />
                        <span>SYNC & CONTINUE 🚀</span>
                    </button>
                )}
            </div>

            {showArchiveSuccess && (
                <div className="fixed inset-0 z-[5000] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-1000">
                    <div className="relative z-10 flex flex-col items-center text-center px-12 space-y-8">
                        <div className="w-40 h-40 rounded-full bg-[#C9B075]/10 border-2 border-[#C9B075]/50 flex items-center justify-center animate-bounce shadow-[0_0_80px_rgba(201,176,117,0.5)]">
                            <Trophy size={80} className="text-[#C9B075]" />
                        </div>
                        <div className="space-y-4">
                            <h2 className="text-4xl font-black italic text-white uppercase tracking-tighter">Special Match<br />Archived</h2>
                            <p className="text-[#C9B075] text-[10px] font-black uppercase tracking-[0.6em] animate-pulse">명예의 전당 박제 완료</p>
                        </div>
                    </div>
                </div>
            )}

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

function Swords({ size, color = "currentColor" }: { size: number, color?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
            <line x1="13" y1="19" x2="19" y2="13" />
            <line x1="16" y1="16" x2="20" y2="20" />
            <line x1="19" y1="21" x2="20" y2="20" />
            <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
            <line x1="5" y1="14" x2="9" y2="18" />
            <line x1="7" y1="17" x2="4" y2="20" />
            <line x1="3" y1="21" x2="4" y2="20" />
        </svg>
    );
}
