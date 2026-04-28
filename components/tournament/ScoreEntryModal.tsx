'use client';

import React from 'react';
import { Trophy, Save } from 'lucide-react';
import { Match } from '@/lib/tournament_types';

interface ScoreEntryModalProps {
    match: Match;
    tempScores: { s1: number, s2: number };
    setTempScores: (scores: { s1: number, s2: number }) => void;
    onSave: (matchId: string, s1: number, s2: number) => void;
    onCancel: () => void;
    getPlayerName: (id: string) => string;
}

export const ScoreEntryModal = ({ 
    match, 
    tempScores, 
    setTempScores, 
    onSave, 
    onCancel, 
    getPlayerName 
}: ScoreEntryModalProps) => {
    return (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center px-6 bg-black/98 backdrop-blur-2xl">
            <div className="w-full max-w-[380px] bg-[#0F0F0F] rounded-[56px] p-10 border border-white/10 shadow-[0_0_100px_rgba(0,0,0,1)] relative overflow-hidden flex flex-col items-center">
                
                <div className="text-center mb-10 relative z-10">
                    <span className="text-[10px] font-black text-[#C9B075] tracking-[0.6em] uppercase block mb-2 opacity-60">MATCH PROTOCOL</span>
                    <h3 className="text-2xl font-[1000] italic tracking-tight text-white uppercase flex items-center gap-3">
                        <Trophy size={20} className="text-[#C9B075]" /> WINNER SELECTION
                    </h3>
                </div>
                
                <div className="grid grid-cols-2 gap-px bg-white/5 w-full relative z-10 mb-10 rounded-3xl overflow-hidden">
                    {/* TEAM 1 SELECTOR */}
                    <div className="bg-[#0F0F0F] p-6 flex flex-col items-center gap-8">
                        <div className="flex flex-col items-center h-14 justify-center text-center">
                            <span className="text-[15px] font-[1000] text-white leading-tight mb-1 truncate w-full">{getPlayerName(match.playerIds[0])}</span>
                            <span className="text-[15px] font-[1000] text-white leading-tight truncate w-full">{getPlayerName(match.playerIds[1])}</span>
                            <div className="w-6 h-0.5 bg-[#C9B075] mt-2 opacity-40 rounded-full" />
                        </div>
                        <span className="text-[72px] font-[1000] text-white/90 font-mono tracking-tighter leading-none mb-4">{tempScores.s1}</span>
                        <div className="grid grid-cols-3 gap-2 w-full">
                            {[0, 1, 2, 3, 4, 5, 6].map(num => (
                                <button 
                                    key={`s1-${num}`} 
                                    onClick={() => setTempScores({ ...tempScores, s1: num })} 
                                    className={`h-12 rounded-xl flex items-center justify-center text-[18px] font-black transition-all ${tempScores.s1 === num ? 'bg-[#C9B075]/20 text-[#C9B075] shadow-[0_0_15px_rgba(201,176,117,0.2)]' : 'bg-[#1A1A1A] text-white/20'}`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* TEAM 2 SELECTOR */}
                    <div className="bg-[#0F0F0F] p-6 flex flex-col items-center gap-8 border-l border-white/5">
                        <div className="flex flex-col items-center h-14 justify-center text-center">
                            <span className="text-[15px] font-[1000] text-white leading-tight mb-1 truncate w-full">{getPlayerName(match.playerIds[2])}</span>
                            <span className="text-[15px] font-[1000] text-white leading-tight truncate w-full">{getPlayerName(match.playerIds[3])}</span>
                            <div className="w-6 h-0.5 bg-[#C9B075] mt-2 opacity-40 rounded-full" />
                        </div>
                        <span className="text-[72px] font-[1000] text-white/90 font-mono tracking-tighter leading-none mb-4">{tempScores.s2}</span>
                        <div className="grid grid-cols-3 gap-2 w-full">
                            {[0, 1, 2, 3, 4, 5, 6].map(num => (
                                <button 
                                    key={`s2-${num}`} 
                                    onClick={() => setTempScores({ ...tempScores, s2: num })} 
                                    className={`h-12 rounded-xl flex items-center justify-center text-[18px] font-black transition-all ${tempScores.s2 === num ? 'bg-[#C9B075]/20 text-[#C9B075] shadow-[0_0_15px_rgba(201,176,117,0.2)]' : 'bg-[#1A1A1A] text-white/20'}`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                
                <div className="flex flex-col gap-4 w-full relative z-10 px-4">
                    <button 
                        onClick={() => onSave(match.id, tempScores.s1, tempScores.s2)} 
                        className="w-full h-20 bg-[#C9B075]/10 border border-[#C9B075]/20 text-[#C9B075] font-[1000] rounded-[32px] flex items-center justify-center gap-4 active:scale-95 transition-all shadow-xl uppercase tracking-[0.3em] text-[13px] italic"
                    >
                        CONFIRM SCORE <Trophy size={18} fill="#C9B075" />
                    </button>
                    <button 
                        onClick={onCancel} 
                        className="w-full py-4 text-white/20 font-black uppercase tracking-widest text-[11px] hover:text-white transition-colors"
                    >
                        CANCEL
                    </button>
                </div>
            </div>
        </div>
    );
};
