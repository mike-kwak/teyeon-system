'use client';

import React, { useState, useEffect } from 'react';
import RankingRow from './tournament/RankingRow';

interface Player {
    id: string;
    name: string;
    wins: number;
    losses: number;
    diff: number;
    group?: 'A' | 'B';
    rk?: number;
    is_guest?: boolean;
    avatar?: string;
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
    snapshot_data?: any[];
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
    snapshot_data = []
}: RankingTabProps) {
    const [sortKey, setSortKey] = useState<string>('rk');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [activeRankingTab, setActiveRankingTab] = useState<'ALL' | 'A' | 'B'>('ALL');
    
    // Safety guard for players array
    const playersList = players || [];

    const uniqueGroups = Array.from(new Set(playersList.map((p) => p.group).filter(Boolean)));
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
        return playersList.filter((p) => !filterGroup || p.group === filterGroup);
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
                                            flex items-center justify-center rounded-full bg-white/5 backdrop-blur-3xl border border-white/20 relative shadow-2xl mb-6 overflow-hidden
                                            ${isFirst ? 'w-20 h-20 border-[#C9B075]/40' : 'w-16 h-16'}
                                        `}>
                                            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/20 via-transparent to-transparent opacity-60 pointer-events-none" />
                                            {p.avatar ? (
                                                <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <span className={`${isFirst ? 'text-5xl' : 'text-3xl'} select-none text-white/10`}>
                                                    {isFirst ? '🏆' : (idx === 1 ? '🥈' : '🥉')}
                                                </span>
                                            )}
                                            
                                            {/* Badge for Rank Emoji */}
                                            {p.avatar && (
                                                <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-black/80 rounded-full flex items-center justify-center border border-white/20 text-xs">
                                                    {isFirst ? '🏆' : (idx === 1 ? '🥈' : '🥉')}
                                                </div>
                                            )}
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
                    <div className="grid grid-cols-[2rem_2.5rem_1fr_1.8rem_2rem_1.8rem_2rem_2rem_2.5rem_5.5rem] gap-1 px-4 pb-6 text-[11px] font-black text-white/40 tracking-widest border-b border-white/10 uppercase italic overflow-visible">
                        <span className="text-center opacity-60">#</span>
                        <span className="text-center opacity-0">IMG</span>
                        <span className="text-left pl-2 opacity-60">PLAYER</span>
                        <span className="text-right opacity-40">P</span>
                        <span className="text-right text-[#00e5ff]">W</span>
                        <span className="text-right opacity-60">L</span>
                        <span className="text-right opacity-40">PF</span>
                        <span className="text-right opacity-40">PA</span>
                        <span className="text-right text-[#00e5ff]">+/-</span>
                        <span className="text-center text-[#C9B075]">FINE</span>
                    </div>
                    {others.map((p) => {
                        const originalIdx = players.findIndex((x) => x.id === p.id);
                        const { amount } = calculateSettlement(p, originalIdx, players.length);
                        return (
                            <RankingRow 
                                key={p.id}
                                player={p}
                                rank={originalIdx + 1}
                                amount={amount}
                            />
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

                 <div className="flex flex-col gap-6 mt-32 mb-40 px-6 pb-[250px]">
                    <button onClick={onShareMatch} className="w-full py-8 bg-white/5 border border-white/10 text-white text-[13px] font-black uppercase tracking-[0.3em] rounded-[28px] hover:bg-white/10 transition-all flex items-center justify-center gap-6 italic shadow-lg active:scale-95 shadow-black/20">
                        <span className="text-xl">📋</span>
                        {isArchive ? 'SHARE REPORT' : '대진표 공유'}
                    </button>
                    <button onClick={onShareResult} className="w-full py-8 bg-white/5 border border-white/10 text-white text-[13px] font-black uppercase tracking-[0.3em] rounded-[28px] hover:bg-white/10 transition-all flex items-center justify-center gap-6 italic shadow-lg active:scale-95 shadow-black/20">
                        <span className="text-xl">🏆</span>
                        {isArchive ? 'SHARE CHAMPIONS' : '최종결과 공유'}
                    </button>
                </div>

                {isArchive && snapshot_data && snapshot_data.length > 0 && (
                    <section className="px-6 pb-20 space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
                        <div className="flex items-center gap-4">
                            <div className="w-2 h-10 bg-[#C9B075] rounded-full shadow-[0_0_20px_rgba(201,176,117,0.4)]" />
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black text-[#C9B075]/60 uppercase tracking-[0.3em]">Historical Evidence</span>
                                <h3 className="text-2xl font-black italic text-white uppercase tracking-tight">ATMOSPHERE REPLAY</h3>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {snapshot_data.map((m: any, idx: number) => {
                                const isB = (m.court || m.groupName) === 'B';
                                const color = isB ? '#00e5ff' : '#C9B075';
                                return (
                                    <div key={idx} className="bg-white/[0.03] border-t-2 border-white/20 rounded-[24px] overflow-hidden shadow-2xl relative group">
                                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent pointer-events-none" />
                                        <div className="px-6 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
                                            <span className="text-[10px] font-black tracking-[0.3em] uppercase opacity-40 italic" style={{ color }}>
                                                {isB ? 'B COURT' : 'A COURT'} • MATCH {(idx + 1).toString().padStart(2, '0')}
                                            </span>
                                            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Archive ID: #{idx + 101}</span>
                                        </div>
                                        <div className="p-8 flex flex-col items-center gap-6">
                                            {/* v11: Identity Resolution - 박멸 Unknown */}
                                            {(() => {
                                                const pIds = m.player_ids || m.playerIds || [];
                                                // Resolve names via: 
                                                // 1. Explicit snapshot names
                                                // 2. Current players list (ranking)
                                                // 3. Fallback logic
                                                const resolveName = (idx: number) => {
                                                    if (m.player_names?.[idx] && m.player_names[idx] !== 'Unknown' && m.player_names[idx] !== '?') return m.player_names[idx];
                                                    if (m.playerNames?.[idx] && m.playerNames[idx] !== 'Unknown' && m.playerNames[idx] !== '?') return m.playerNames[idx];
                                                    const pid = pIds[idx];
                                                    const found = playersList.find(p => p.id === pid);
                                                    return found?.name || 'Unknown';
                                                };

                                                return (
                                                    <div className="flex items-center justify-between w-full relative">
                                                        <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(0)}</span>
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(1)}</span>
                                                        </div>
                                                        
                                                        <div className="flex flex-col items-center shrink-0 px-8 relative">
                                                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/10 group-hover:bg-[#C9B075]/20 transition-colors" />
                                                            <div className="bg-black/60 backdrop-blur-3xl px-6 py-3 rounded-2xl border border-white/10 relative z-10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
                                                                <span className="text-3xl font-[1000] text-white tracking-tighter tabular-nums drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                                                                    {m.score1 !== undefined ? m.score1 : (m.s1 || '0')}:{m.score2 !== undefined ? m.score2 : (m.s2 || '0')}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(2)}</span>
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(3)}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>

            {!isArchive && (
                <div className="fixed bottom-[145px] left-1/2 -translate-x-1/2 w-[92%] max-w-[420px] z-[100]">
                    <button
                        disabled={isGenerating}
                        onClick={() => {
                            if (!isAdmin) {
                                alert("관리자만 아카이브를 확정할 수 있습니다.");
                                return;
                            }
                            onFinalize?.();
                        }}
                        className={`w-full h-14 text-black font-black rounded-2xl uppercase text-[13px] tracking-[0.35em] shadow-2xl active:scale-95 transition-all border border-white/30 relative overflow-hidden group flex items-center justify-center gap-4 ${!isAdmin ? 'opacity-40 grayscale' : ''}`}
                        style={{
                            background: isAdmin ? 'linear-gradient(to right, #8E7A4A, #A89462, #8E7A4A)' : 'rgba(255,255,255,0.1)',
                            boxShadow: isAdmin ? '0 10px 30px rgba(142,122,74,0.4), inset 0 0 10px rgba(255,255,255,0.3)' : 'none',
                            color: isAdmin ? '#000' : 'rgba(255,255,255,0.5)'
                        }}
                    >
                        {isAdmin && <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />}
                        <span className="text-xl drop-shadow-md">{isAdmin ? '🏆' : '🔒'}</span>
                        <span className="italic">{isGenerating ? 'ARCHIVING...' : (isAdmin ? 'FINAL TOURNAMENT ARCHIVE' : 'ADMINS ONLY')}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
