'use client';

import React, { useState, useEffect } from 'react';

interface Player {
    id: string;
    name: string;
    wins: number;
    losses: number;
    diff: number;
    group?: 'A' | 'B';
    rk?: number;
    is_guest?: boolean;
}

interface RankingTabProps {
    players: Player[];
    sessionTitle?: string;
    isArchive?: boolean;
    isAdmin?: boolean;
    prizes?: { first: number, l1: number, l2: number };
    onShareMatch?: () => void;
    onShareResult?: () => void;
    onFinalize?: () => void;
    isGenerating?: boolean;
    ceremonyMode?: boolean;
    matchSnapshot?: any[];
}

export default function RankingTab({ 
    players, 
    sessionTitle, 
    isArchive = false, 
    isAdmin = false,
    prizes = { first: 10000, l1: 3000, l2: 5000 },
    onShareMatch,
    onShareResult,
    onFinalize,
    isGenerating,
    ceremonyMode = false,
    matchSnapshot = []
}: RankingTabProps) {
    const [sortKey, setSortKey] = useState<string>('rk');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [activeRankingTab, setActiveRankingTab] = useState<'ALL' | 'A' | 'B'>('ALL');

    const uniqueGroups = Array.from(new Set(players.map((p) => p.group).filter(Boolean)));
    const showTabs = uniqueGroups.length > 1;

    const [showConfetti, setShowConfetti] = useState(false);
    useEffect(() => {
        if (ceremonyMode) {
            setShowConfetti(true);
            const timer = setTimeout(() => setShowConfetti(false), 5000);
            return () => clearTimeout(timer);
        }
    }, [ceremonyMode]);

    const calculateSettlement = (p: any, idx: number, total: number) => {
        let amount = 0;
        const bottomHalfCount = Math.ceil(total / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const isPenaltyTier = idx >= (total - penaltyCount);
        const isFineTier = !isPenaltyTier && idx >= (total - bottomHalfCount);

        let performancePenalty = 0;
        if (idx === 0 && !p.is_guest) {
            performancePenalty = prizes.first || 10000;
        } else if (isPenaltyTier) {
            performancePenalty = -(prizes.l2 || 5000);
        } else if (isFineTier) {
            performancePenalty = -(prizes.l1 || 3000);
        }

        if (p.is_guest) {
            amount = -5000 + performancePenalty;
        } else {
            amount = performancePenalty;
        }

        return { amount, isPenaltyTier, isFineTier };
    };

    const generatePlayerList = (filterGroup?: string) => {
        return players.filter((p) => !filterGroup || p.group === filterGroup);
    };

    const getSortedPlayers = (pList: any[]) => {
        const sorted = [...(pList || [])].map((p, i) => ({ ...p, rk: i + 1 }));
        return sorted.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];
            if (sortKey === 'rk') { valA = a.rk; valB = b.rk; }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const RankingTable = ({ players: tablePlayers, title }: { players: any[], title: string }) => {
        const sorted = getSortedPlayers(tablePlayers);
        const top3 = sorted.slice(0, 3);
        const others = sorted.slice(3);

        return (
            <section className="flex flex-col">
                <div className="relative mt-24 mb-0">
                    <div className="flex items-end justify-center gap-2 w-full px-2 max-w-2xl mx-auto relative z-10 overflow-visible">
                        {[1, 0, 2].map((idx) => {
                            const p = top3[idx];
                            if (!p) return <div key={idx} className={`${idx === 0 ? 'w-[40%]' : 'w-[28%]'} h-2`} />;
                            const isFirst = idx === 0;
                            const isSecond = idx === 1;
                            const widthClass = isFirst ? 'w-[45%]' : 'w-[28%]';
                            
                            return (
                                <div 
                                    key={p.id} 
                                    className={`relative ${widthClass} transition-all duration-700 flex flex-col justify-end`}
                                >
                                    <div className="bg-white/5 backdrop-blur-3xl rounded-[40px] border-t border-t-white/30 border-l border-l-white/10 shadow-[0_40px_80px_-15px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.3)] flex flex-col items-center pt-6 pb-6 w-full relative">
                                        <div className={`
                                            flex items-center justify-center rounded-full bg-white/5 backdrop-blur-3xl border border-white/20 relative shadow-2xl mb-6
                                            ${isFirst ? 'w-20 h-20 border-[#C9B075]/30' : 'w-16 h-16'}
                                        `}>
                                            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/20 via-transparent to-transparent opacity-60 pointer-events-none" />
                                            <span className={`${isFirst ? 'text-5xl' : 'text-3xl'} select-none`}>
                                                {isFirst ? '🏆' : (idx === 1 ? '🥈' : '🥉')}
                                            </span>
                                        </div>

                                        <div className="flex flex-col items-center gap-2.5 w-full px-4 relative z-10">
                                            <div className={`font-bold text-white text-center truncate w-full tracking-tighter drop-shadow-[0_10px_20px_rgba(0,0,0,1)] ${isFirst ? 'text-3xl' : 'text-lg'}`}>
                                                {p.name}
                                            </div>
                                            
                                            <div className="flex items-center gap-2 font-black tracking-widest uppercase text-[11px] relative z-20">
                                                <div className="flex items-center gap-0.5">
                                                    <span className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">{p.wins}</span>
                                                    <span className="text-white drop-shadow-[0_0_5px_rgba(0,0,0,1)]">승</span>
                                                </div>
                                                <div className="flex items-center gap-0.5">
                                                    <span className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">{p.losses}</span>
                                                    <span className="text-white drop-shadow-[0_0_5px_rgba(0,0,0,1)]">패</span>
                                                </div>
                                                <span className="opacity-30">/</span>
                                                <span className={p.diff > 0 ? 'text-[#00e5ff] drop-shadow-[0_0_8px_rgba(0,229,255,0.6)]' : 'text-white tracking-normal'}>
                                                    {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                </span>
                                            </div>

                                            {isFirst && (
                                                <div className="mt-5 px-6 py-2 rounded-full bg-[#C9B075] shadow-[0_4px_20px_rgba(201,176,117,0.4)]">
                                                    <span className="text-black font-black text-[12px] tracking-widest italic uppercase">
                                                        ₩{(prizes.first || 10000).toLocaleString()} PRIZE
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="h-6" aria-hidden="true" />

                <div className="flex-1 space-y-2 px-4 mb-32 relative z-0">
                    <div className="grid grid-cols-[2.8rem_1fr_1.8rem_2rem_1.8rem_2rem_2rem_2.5rem_6.2rem] gap-1 px-4 pb-10 text-[13px] font-black text-white tracking-widest border-b border-white/20 uppercase italic overflow-visible">
                        <span className="text-center opacity-60 whitespace-nowrap">순위</span>
                        <span className="text-left pl-4 opacity-60 whitespace-nowrap">참가자</span>
                        <span className="text-right opacity-40 whitespace-nowrap">P</span>
                        <span className="text-right text-[#00e5ff] whitespace-nowrap">승</span>
                        <span className="text-right opacity-60 whitespace-nowrap">패</span>
                        <span className="text-right opacity-60 whitespace-nowrap">PF</span>
                        <span className="text-right opacity-60 whitespace-nowrap">PA</span>
                        <span className="text-right text-[#00e5ff] whitespace-nowrap">득실</span>
                        <span className="text-center pr-2 whitespace-nowrap text-[#C9B075]">정산</span>
                    </div>
                    {others.map((p) => {
                        const originalIdx = players.findIndex((x) => x.id === p.id);
                        const { amount } = calculateSettlement(p, originalIdx, players.length);
                        return (
                            <div key={p.id}
                                className="h-14 rounded-2xl px-4 grid grid-cols-[2.8rem_1fr_1.8rem_2rem_1.8rem_2rem_2rem_2.5rem_6.2rem] gap-1 items-center bg-white/[0.03] border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_4px_10px_rgba(0,0,0,0.2)] hover:bg-white/[0.08] transition-all group overflow-hidden"
                            >
                                <div className="text-center font-bold text-[13px] text-white/30 italic group-hover:text-white/60 transition-colors">{originalIdx + 1}</div>
                                <div className="text-left font-black text-[15.5px] text-white tracking-tighter truncate pl-4">
                                    {p.name}{p.is_guest && <span className="ml-1 text-[9px] text-[#C9B075]/40 italic">G</span>}
                                </div>
                                <div className="text-right text-[11px] font-black text-white/50">{p.wins + p.losses}</div>
                                <div className="text-right text-[15px] font-black text-[#00e5ff] drop-shadow-[0_0_15px_rgba(0,229,255,0.6)]">{p.wins}</div>
                                <div className="text-right text-[13px] font-black text-white/60">{p.losses}</div>
                                <div className="text-right text-[11px] font-black text-white/50">{(p as any).pf || 0}</div>
                                <div className="text-right text-[11px] font-black text-white/50">{(p as any).pa || 0}</div>
                                <div className={`text-right font-black text-[15px] text-[#00e5ff] drop-shadow-[0_0_12px_rgba(0,229,255,0.4)]`}>
                                    {p.diff > 0 ? `+${p.diff}` : p.diff}
                                </div>
                                <div className={`text-center text-[14px] tracking-tighter ${amount < 0 ? 'text-rose-500 font-bold drop-shadow-[0_0_15px_rgba(244,63,94,0.6)]' : amount > 0 ? 'text-[#C9B075] font-black text-[15px]' : 'text-white/10 font-bold'}`}>
                                    {amount !== 0 ? (
                                        <div className="flex items-center justify-center gap-0.5">
                                            <span className="text-[10px] font-black opacity-60 translate-y-[1px]">₩</span>
                                            <span>{`${amount > 0 ? '+' : ''}${amount.toLocaleString()}`}</span>
                                        </div>
                                    ) : '0'}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        );
    };

    return (
        <div className="flex flex-col min-h-screen relative">
            <style jsx global>{`
                @keyframes confetti-fall {
                    0% { transform: translateY(-10vh) rotate(0deg); opacity:1; }
                    100% { transform: translateY(110vh) rotate(720deg); opacity:0; }
                }
                .animate-confetti-fall { animation: confetti-fall 4.5s linear forwards; }
            `}</style>
            
            <div className="flex-1">
                {isArchive ? (
                    <div className="sticky top-0 z-[100] px-6 py-4 bg-black/60 backdrop-blur-2xl border-b border-white/10 flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.4em] uppercase mb-1">Historical Report</span>
                            <h2 className="text-xl font-black italic text-white tracking-tighter uppercase truncate max-w-[200px]">{sessionTitle}</h2>
                        </div>
                        <div className="px-4 py-1.5 bg-white/5 border border-white/10 rounded-full text-[9px] font-black text-white/40 uppercase tracking-widest">
                            Official Archive
                        </div>
                    </div>
                ) : (
                    showTabs && (
                        <div className="sticky top-0 z-50 py-3 bg-black/60 backdrop-blur-xl -mx-4 px-4 border-b border-white/10 mb-4 shadow-2xl">
                            <div className="flex bg-white/5 rounded-3xl p-1.5 border border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] max-w-sm mx-auto">
                                {['ALL', 'A', 'B'].map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveRankingTab(tab as any)}
                                        className={`flex-1 py-3 text-[11px] font-black rounded-2xl transition-all tracking-widest ${activeRankingTab === tab ? 'bg-gradient-to-r from-[#C9B075] to-[#A89462] text-black shadow-xl shadow-[#C9B075]/20' : 'text-white/40 hover:text-white/70'}`}
                                    >
                                        {tab === 'ALL' ? 'INTEGRATED' : `GROUP ${tab}`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )
                )}

                {ceremonyMode && (
                    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[100] px-6 py-2 bg-gradient-to-r from-[#C9B075] to-[#E5D29B] rounded-full shadow-[0_10px_40px_rgba(201,176,117,0.6)] animate-in slide-in-from-top-10 duration-700 border border-white/50">
                        <span className="text-[10px] font-black text-black tracking-[0.2em] uppercase italic">🏆 CHAMPIONSHIP CELEBRATION</span>
                    </div>
                )}

                {showConfetti && (
                    <div className="absolute inset-x-0 top-0 pointer-events-none z-[100] h-screen overflow-hidden flex justify-center">
                        {[...Array(30)].map((_, i) => (
                            <div key={i} className="absolute top-[-20px] w-2.5 h-2.5 bg-[#C9B075] rounded-full animate-confetti-fall" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 4}s`, background: i % 2 === 0 ? '#C9B075' : '#E5D29B' }} />
                        ))}
                    </div>
                )}

                {activeRankingTab === 'ALL' && <RankingTable players={players} title="INTEGRATED LEADERBOARD" />}
                {activeRankingTab === 'A' && <RankingTable players={generatePlayerList('A')} title="GROUP A" />}
                {activeRankingTab === 'B' && <RankingTable players={generatePlayerList('B')} title="GROUP B" />}
                
                <div className="h-8" aria-hidden="true" />

                 <div className="flex flex-col gap-6 mt-32 mb-48 px-6">
                    <button onClick={onShareMatch} className="w-full py-6 bg-white/5 border border-white/10 text-white text-[12px] font-black uppercase tracking-[0.3em] rounded-[24px] hover:bg-white/10 transition-all flex items-center justify-center gap-6 italic">
                        <span className="text-lg">📋</span>
                        {isArchive ? 'SHARE REPORT' : '대진표 공유'}
                    </button>
                    <button onClick={onShareResult} className="w-full py-6 bg-white/5 border border-white/10 text-white text-[12px] font-black uppercase tracking-[0.3em] rounded-[24px] hover:bg-white/10 transition-all flex items-center justify-center gap-6 italic">
                        <span className="text-lg">🏆</span>
                        {isArchive ? 'SHARE CHAMPIONS' : '최종결과 공유'}
                    </button>
                </div>

                {isArchive && matchSnapshot && matchSnapshot.length > 0 && (
                    <section className="px-6 pb-20 space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
                        <div className="flex items-center gap-4">
                            <div className="w-2 h-10 bg-[#C9B075] rounded-full shadow-[0_0_20px_rgba(201,176,117,0.4)]" />
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black text-[#C9B075]/60 uppercase tracking-[0.3em]">Historical Evidence</span>
                                <h3 className="text-2xl font-black italic text-white uppercase tracking-tight">ATMOSPHERE REPLAY</h3>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {matchSnapshot.map((m: any, idx: number) => {
                                const isB = (m.court || m.groupName) === 'B';
                                const color = isB ? '#00e5ff' : '#C9B075';
                                return (
                                    <div key={idx} className="bg-white/[0.03] border-t-2 border-white/20 rounded-[36px] overflow-hidden shadow-2xl relative group">
                                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent pointer-events-none" />
                                        <div className="px-6 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
                                            <span className="text-[10px] font-black tracking-[0.3em] uppercase opacity-40 italic" style={{ color }}>
                                                {isB ? 'B COURT' : 'A COURT'} • MATCH {(idx + 1).toString().padStart(2, '0')}
                                            </span>
                                            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Archive ID: #{idx + 101}</span>
                                        </div>
                                        <div className="p-8 flex flex-col items-center gap-6">
                                            <div className="flex items-center justify-between w-full relative">
                                                <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                                                    <span className="text-sm font-black text-white/90 truncate w-full text-center tracking-tighter">{m.p1_name || m.playerNames?.[0] || 'Unknown'}</span>
                                                    <span className="text-sm font-black text-white/90 truncate w-full text-center tracking-tighter">{m.p2_name || m.playerNames?.[1] || 'Unknown'}</span>
                                                </div>
                                                
                                                <div className="flex flex-col items-center shrink-0 px-8 relative">
                                                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/10 group-hover:bg-[#C9B075]/20 transition-colors" />
                                                    <div className="bg-black/40 backdrop-blur-xl px-5 py-2 rounded-2xl border border-white/10 relative z-10">
                                                        <span className="text-3xl font-black text-white tracking-tighter tabular-nums drop-shadow-xl">
                                                            {m.s1 || m.score1 !== undefined ? m.score1 : '0'}:{m.s2 || m.score2 !== undefined ? m.score2 : '0'}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                                                    <span className="text-sm font-black text-white/90 truncate w-full text-center tracking-tighter">{m.p3_name || m.playerNames?.[2] || 'Unknown'}</span>
                                                    <span className="text-sm font-black text-white/90 truncate w-full text-center tracking-tighter">{m.p4_name || m.playerNames?.[3] || 'Unknown'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>

            {!isArchive && isAdmin && (
                <div className="fixed bottom-[110px] left-1/2 -translate-x-1/2 w-[92%] max-w-[420px] z-[100]">
                    <button
                        disabled={isGenerating}
                        onClick={onFinalize}
                        className="w-full h-14 text-black font-black rounded-2xl uppercase text-[13px] tracking-[0.35em] shadow-2xl active:scale-95 transition-all border border-white/30 relative overflow-hidden group flex items-center justify-center gap-4"
                        style={{
                            background: 'linear-gradient(to right, #8E7A4A, #A89462, #8E7A4A)',
                            boxShadow: '0 10px 30px rgba(142,122,74,0.4), inset 0 0 10px rgba(255,255,255,0.3)'
                        }}
                    >
                        <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                        <span className="text-xl drop-shadow-md">🏆</span>
                        <span className="italic">{isGenerating ? 'ARCHIVING...' : 'FINAL TOURNAMENT ARCHIVE'}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
