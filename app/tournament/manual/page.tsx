'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, Layout, Hash, Play, Trash2, Plus, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import PremiumSpinner from '@/components/PremiumSpinner';

interface Member {
    id: string;
    nickname: string;
    position?: string;
    is_guest?: boolean;
}

interface DraftTeam {
    players: string[]; // [id1, id2]
}

interface DraftMatch {
    id: string;
    team1: string[];
    team2: string[];
    court: number;
}

export default function ManualMatchLab() {
    const router = useRouter();
    const { role, user } = useAuth();
    const [allMembers, setAllMembers] = useState<Member[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Draft State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [currentPair, setCurrentPair] = useState<string[]>([]);
    const [teams, setTeams] = useState<DraftTeam[]>([]);
    const [matches, setMatches] = useState<DraftMatch[]>([]);
    const [nextCourt, setNextCourt] = useState(1);
    const [sessionTitle, setSessionTitle] = useState("");

    // [v12.0] 개방형 권한 시스템
    const isAdmin = role === 'CEO' || role === 'ADMIN';

    // 권한 제한 알림 헬퍼
    const triggerAccessDenied = () => {
        alert("관리자만 매치를 생성하거나 프로토콜을 시작할 수 있습니다.");
        if (window.navigator?.vibrate) window.navigator.vibrate([100, 50, 100]);
    };

    // [v12.0] REDIRECT REMOVED: Guests can now view the lab
    /*
    useEffect(() => {
        if (!isAdmin && !isLoading) {
            router.push('/tournament');
        }
    }, [isAdmin, isLoading, router]);
    */

    useEffect(() => {
        fetchMembers();
        const dateStr = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
        setSessionTitle(`${dateStr} 스페셜 매치`);
    }, []);

    const fetchMembers = async () => {
        try {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('members')
                .select('id, nickname, position')
                .order('nickname');
            if (error) throw error;
            setAllMembers(data || []);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMember = (id: string) => {
        if (!isAdmin) return triggerAccessDenied();
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedIds(next);
    };

    const addToPair = (id: string) => {
        if (!isAdmin) return triggerAccessDenied();
        if (currentPair.includes(id)) {
            setCurrentPair(prev => prev.filter(p => p !== id));
            return;
        }
        if (currentPair.length >= 2) return;
        setCurrentPair(prev => [...prev, id]);
    };

    const finalizeTeam = () => {
        if (!isAdmin) return triggerAccessDenied();
        if (currentPair.length !== 2) return;
        setTeams(prev => [...prev, { players: [...currentPair] }]);
        setCurrentPair([]);
    };

    const removeTeam = (index: number) => {
        if (!isAdmin) return triggerAccessDenied();
        setTeams(prev => prev.filter((_, i) => i !== index));
    };

    const createMatch = (teamAIdx: number, teamBIdx: number) => {
        if (!isAdmin) return triggerAccessDenied();
        const teamA = teams[teamAIdx];
        const teamB = teams[teamBIdx];
        
        const newMatch: DraftMatch = {
            id: `manual-${Date.now()}`,
            team1: teamA.players,
            team2: teamB.players,
            court: nextCourt
        };

        setMatches(prev => [...prev, newMatch]);
        // Remove used teams from list
        setTeams(prev => prev.filter((_, i) => i !== teamAIdx && i !== teamBIdx));
        setNextCourt(prev => prev + 1);
    };

    const removeMatch = (mId: string) => {
        if (!isAdmin) return triggerAccessDenied();
        const match = matches.find(m => m.id === mId);
        if (!match) return;
        
        // Put teams back in list
        setTeams(prev => [
            ...prev, 
            { players: match.team1 }, 
            { players: match.team2 }
        ]);
        setMatches(prev => prev.filter(m => m.id !== mId));
        setNextCourt(prev => Math.max(1, prev - 1));
    };

    const startProtocol = async () => {
        if (!isAdmin) return triggerAccessDenied();
        if (matches.length === 0) return;
        
        const id = crypto.randomUUID();
        const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";

        const formattedMatches = matches.map((m, idx) => ({
            id: m.id,
            session_id: id,
            session_title: sessionTitle || 'Manual Special Match',
            club_id: clubId,
            playerIds: [...m.team1, ...m.team2],
            player_names: [...m.team1, ...m.team2].map(pid => allMembers.find(mm => mm.id === pid)?.nickname || '???'),
            court: m.court,
            status: 'playing', // Start immediately as they are manually created
            mode: 'MANUAL',
            round: 1,
            teams: [m.team1, m.team2],
            groupName: 'S' // Special
        }));

        try {
            setIsLoading(true);
            const { error } = await supabase.from('matches').insert(formattedMatches);
            if (error) throw error;
            router.push('/kdk');
        } catch (err) {
            console.error(err);
            alert("Protocol Start Failed");
            setIsLoading(false);
        }
    };

    const getMemberName = (id: string) => allMembers.find(m => m.id === id)?.nickname || "???";

    if (isLoading) return <PremiumSpinner />;

    return (
        <main className="min-h-screen bg-[#0a0a0b] text-white font-sans w-full relative pb-40 overflow-x-hidden">
            {/* Header */}
            <header className="px-6 pt-12 pb-6 flex flex-col gap-6 sticky top-0 bg-[#0a0a0b]/90 backdrop-blur-xl z-[100] border-b border-white/5">
                <div className="flex items-center justify-between">
                    <Link 
                        href="/tournament"
                        className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-all text-white/60 hover:text-white"
                    >
                        <ArrowLeft size={20} />
                    </Link>
                    <div className="flex items-center gap-2">
                        {isAdmin && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#C9B075] rounded-full shadow-[0_5px_15px_rgba(201,176,117,0.3)] mr-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                                <span className="text-[9px] font-black text-black uppercase tracking-widest leading-none">ADMIN MODE</span>
                            </div>
                        )}
                        <div className="flex items-center gap-2 px-4 py-1.5 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20">
                            <Layout size={14} className="text-[#C9B075]" />
                            <span className="text-[10px] font-black text-[#C9B075] tracking-[0.2em] uppercase">Custom Lab</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1 px-2">
                    <h1 className="text-4xl font-black italic text-white tracking-tighter uppercase leading-none">CUSTOM DRAFT</h1>
                    <input 
                        value={sessionTitle}
                        onChange={(e) => setSessionTitle(e.target.value)}
                        className="bg-transparent border-none text-[12px] font-bold text-[#C9B075] tracking-widest uppercase mt-1 outline-none focus:text-white transition-colors"
                        placeholder="PROTOCOL TITLE"
                    />
                </div>
            </header>

            <div className="px-6 pt-8 space-y-12 max-w-lg mx-auto w-full">
                
                {/* Stage 1: Attendance */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.3em] flex items-center gap-2">
                            <Users size={14} /> 1. Select Attendees
                        </h3>
                        <span className="text-[10px] font-black text-[#C9B075]">{selectedIds.size} Selected</span>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-2">
                        {allMembers.map(m => (
                            <button
                                key={m.id}
                                onClick={() => toggleMember(m.id)}
                                className={`h-14 rounded-2xl border transition-all flex items-center justify-center text-[10px] font-black uppercase px-2 text-center
                                ${selectedIds.has(m.id) 
                                    ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-lg scale-105' 
                                    : 'bg-white/5 border-white/10 text-white/40'}`}
                            >
                                {m.nickname}
                            </button>
                        ))}
                    </div>
                </section>

                {/* Stage 2: Team Pairing */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.3em] flex items-center gap-2">
                            <Plus size={14} /> 2. Manual Pairing
                        </h3>
                    </div>

                    <div className="bg-white/[0.03] border border-white/5 rounded-[32px] p-6 space-y-6">
                        {/* Draft Area */}
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-center gap-4">
                                <div className={`w-24 h-24 rounded-2xl border-2 border-dashed flex items-center justify-center transition-all
                                    ${currentPair[0] ? 'border-[#C9B075] bg-[#C9B075]/10 text-white' : 'border-white/10 text-white/10'}`}>
                                    {currentPair[0] ? (
                                        <div className="flex flex-col items-center">
                                            <span className="text-xs font-black uppercase">{getMemberName(currentPair[0])}</span>
                                            <button onClick={() => addToPair(currentPair[0])} className="mt-1 text-[8px] text-red-400 font-bold uppercase">Remove</button>
                                        </div>
                                    ) : <UserPlus size={24} />}
                                </div>
                                <span className="text-[#C9B075] font-black italic">PAIR</span>
                                <div className={`w-24 h-24 rounded-2xl border-2 border-dashed flex items-center justify-center transition-all
                                    ${currentPair[1] ? 'border-[#C9B075] bg-[#C9B075]/10 text-white' : 'border-white/10 text-white/10'}`}>
                                    {currentPair[1] ? (
                                        <div className="flex flex-col items-center">
                                            <span className="text-xs font-black uppercase">{getMemberName(currentPair[1])}</span>
                                            <button onClick={() => addToPair(currentPair[1])} className="mt-1 text-[8px] text-red-400 font-bold uppercase">Remove</button>
                                        </div>
                                    ) : <UserPlus size={24} />}
                                </div>
                            </div>
                            
                            <button 
                                disabled={currentPair.length < 2}
                                onClick={finalizeTeam}
                                className={`w-full h-12 rounded-2xl border font-black uppercase tracking-widest text-[11px] transition-all
                                ${currentPair.length === 2 ? 'bg-[#C9B075] border-[#C9B075] text-black shadow-lg active:scale-95' : 'bg-white/5 border-white/10 text-white/20'}`}
                            >
                                Confirm Team
                            </button>
                        </div>

                        {/* List of Attendees to pair (only selected ones not in teams) */}
                        <div className="pt-6 border-t border-white/5">
                            <h4 className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em] mb-4 text-center italic">Available for Pairing</h4>
                            <div className="flex flex-wrap gap-2 justify-center">
                                {Array.from(selectedIds).filter(id => !teams.some(t => t.players.includes(id)) && !matches.some(m => [...m.team1, ...m.team2].includes(id)) && !currentPair.includes(id)).map(id => (
                                    <button
                                        key={id}
                                        onClick={() => addToPair(id)}
                                        className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] font-black text-white/60 hover:text-white transition-all uppercase"
                                    >
                                        {getMemberName(id)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Stage 3: Match Configuration */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-[11px] font-black text-white/40 uppercase tracking-[0.3em] flex items-center gap-2">
                            <Play size={14} /> 3. Match Config
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                        {/* Drafted Teams waiting for match */}
                        <div className="space-y-3">
                            <h4 className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest ml-2">Pending Teams</h4>
                            <div className="flex flex-col gap-2">
                                {teams.length === 0 && <div className="py-8 border border-dashed border-white/5 rounded-3xl text-center text-white/10 text-[10px] font-bold uppercase">No teams created yet</div>}
                                {teams.map((t, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl p-4">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-black text-white">{getMemberName(t.players[0])} + {getMemberName(t.players[1])}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {teams.length >= 2 && (
                                                <select 
                                                    onChange={(e) => createMatch(idx, parseInt(e.target.value))}
                                                    className="bg-[#C9B075] text-black font-black text-[10px] px-3 py-2 rounded-xl border-none outline-none appearance-none"
                                                    defaultValue=""
                                                >
                                                    <option value="" disabled>VS TEAM</option>
                                                    {teams.map((st, sidx) => sidx !== idx ? (
                                                        <option key={sidx} value={sidx}>
                                                            vs {getMemberName(st.players[0])}/{getMemberName(st.players[1])}
                                                        </option>
                                                    ) : null)}
                                                </select>
                                            )}
                                            <button onClick={() => removeTeam(idx)} className="text-white/20 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Created Matches */}
                        <div className="space-y-3 pt-4 border-t border-white/5">
                            <h4 className="text-[9px] font-black text-[#4ADE80] uppercase tracking-widest ml-2">Active Matches</h4>
                            <div className="flex flex-col gap-3">
                                {matches.map((m, idx) => (
                                    <div key={m.id} className="relative group overflow-hidden rounded-3xl bg-gradient-to-br from-white/10 to-transparent border border-white/10 p-5 flex items-center justify-between">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <Hash size={12} className="text-[#C9B075]" />
                                                <span className="text-[10px] font-black text-white/40 uppercase">Court {m.court}</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-base font-black text-white">{getMemberName(m.team1[0])}/{getMemberName(m.team1[1])}</span>
                                                <span className="text-[#C9B075] font-black italic text-xs">VS</span>
                                                <span className="text-base font-black text-white">{getMemberName(m.team2[0])}/{getMemberName(m.team2[1])}</span>
                                            </div>
                                        </div>
                                        <button onClick={() => removeMatch(m.id)} className="text-white/20 hover:text-red-500 transition-colors p-2"><Trash2 size={18} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Final Action */}
                <div className="pt-10">
                    <button
                        onClick={startProtocol}
                        disabled={matches.length === 0}
                        className={`w-full h-16 rounded-[24px] font-black uppercase tracking-[0.3em] text-sm flex items-center justify-center gap-3 transition-all
                        ${matches.length > 0 
                            ? 'bg-gradient-to-r from-[#C9B075] to-[#B8860B] text-black shadow-[0_20px_60px_rgba(201,176,117,0.4)] active:scale-95' 
                            : 'bg-white/5 text-white/10 cursor-not-allowed'}`}
                    >
                        START PROTOCOL <Play size={18} />
                    </button>
                    <p className="mt-4 text-center text-[9px] font-bold text-white/20 uppercase tracking-widest italic leading-relaxed px-10">
                        경기를 시작하면 즉시 전 구장 중계 화면이<br />선택한 대진으로 전환됩니다.
                    </p>
                </div>

            </div>

            {/* Background elements */}
            <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-[#C9B075]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
            <div className="fixed bottom-0 left-0 w-[400px] h-[400px] bg-[#C9B075]/3 rounded-full blur-[100px] -z-10 pointer-events-none" />
        </main>
    );
}
