'use client';

import React from 'react';

interface Player {
    id: string;
    name: string;
    wins: number;
    losses: number;
    diff: number;
    is_guest?: boolean;
    avatar?: string;
    pf?: number;
    pa?: number;
}

interface RankingRowProps {
    player: Player;
    rank: number;
    amount: number;
}

export default function RankingRow({ player, rank, amount }: RankingRowProps) {
    return (
        <div 
            className="h-14 rounded-2xl px-4 grid grid-cols-[2rem_2.5rem_1fr_1.8rem_2rem_1.8rem_2rem_2rem_2.5rem_5.5rem] gap-1 items-center bg-white/[0.03] border border-white/5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_4px_10px_rgba(0,0,0,0.2)] hover:bg-white/[0.08] transition-all group overflow-hidden"
        >
            <div className="text-center font-bold text-[13px] text-white/30 italic group-hover:text-white/60 transition-colors uppercase">
                {rank}
            </div>
            <div className="flex items-center justify-center">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center">
                    {player.avatar ? (
                        <img src={player.avatar} alt={player.name} className="w-full h-full object-cover" />
                    ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/10">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08c-1.29 1.94-3.5 3.22-6 3.22z"/>
                        </svg>
                    )}
                </div>
            </div>
            <div className="text-left font-black text-[15px] text-white tracking-tighter leading-tight truncate pl-2">
                {player.name}
                {player.is_guest && <span className="ml-1 text-[9px] text-[#C9B075]/40 italic">G</span>}
            </div>
            <div className="text-right text-[11px] font-black text-white/50">{player.wins + player.losses}</div>
            <div className="text-right text-[15px] font-black text-[#00e5ff] drop-shadow-[0_0_15px_rgba(0,229,255,0.6)]">{player.wins}</div>
            <div className="text-right text-[13px] font-black text-white/60">{player.losses}</div>
            <div className="text-right text-[11px] font-black text-white/50">{player.pf || 0}</div>
            <div className="text-right text-[11px] font-black text-white/50">{player.pa || 0}</div>
            <div className="text-right font-black text-[15px] text-[#00e5ff] drop-shadow-[0_0_12px_rgba(0,229,255,0.4)]">
                {player.diff > 0 ? `+${player.diff}` : player.diff}
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
}
