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
        <div
            className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/98 px-3 backdrop-blur-2xl sm:px-6"
            style={{
                paddingTop: 'calc(16px + env(safe-area-inset-top))',
                paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
            }}
        >
            <div className="relative flex max-h-[calc(100dvh-32px)] w-full max-w-[380px] flex-col items-center overflow-x-hidden overflow-y-auto rounded-[36px] border border-white/10 bg-[#0F0F0F] p-5 shadow-[0_0_100px_rgba(0,0,0,1)] sm:rounded-[56px] sm:p-10">
                
                <div className="relative z-10 mb-5 text-center sm:mb-10">
                    <span className="text-[10px] font-black text-[#C9B075] tracking-[0.6em] uppercase block mb-2 opacity-60">MATCH PROTOCOL</span>
                    <h3 className="flex items-center gap-2 text-xl font-[1000] italic tracking-tight text-white uppercase sm:gap-3 sm:text-2xl">
                        <Trophy size={20} className="text-[#C9B075]" /> WINNER SELECTION
                    </h3>
                </div>
                
                <div className="relative z-10 mb-6 grid w-full grid-cols-2 gap-px overflow-hidden rounded-3xl bg-white/5 sm:mb-10">
                    {/* TEAM 1 SELECTOR */}
                    <div className="flex flex-col items-center gap-4 bg-[#0F0F0F] p-4 sm:gap-8 sm:p-6">
                        <div className="flex h-12 flex-col items-center justify-center text-center sm:h-14">
                            <span className="mb-1 w-full truncate text-[13px] font-[1000] leading-tight text-white sm:text-[15px]">{getPlayerName(match.playerIds[0])}</span>
                            <span className="w-full truncate text-[13px] font-[1000] leading-tight text-white sm:text-[15px]">{getPlayerName(match.playerIds[1])}</span>
                            <div className="w-6 h-0.5 bg-[#C9B075] mt-2 opacity-40 rounded-full" />
                        </div>
                        <span className="mb-2 font-mono text-[52px] font-[1000] leading-none tracking-tighter text-white/90 sm:mb-4 sm:text-[72px]">{tempScores.s1}</span>
                        <div className="grid w-full grid-cols-3 gap-1.5 sm:gap-2">
                            {[0, 1, 2, 3, 4, 5, 6].map(num => (
                                <button 
                                    key={`s1-${num}`} 
                                    onClick={() => setTempScores({ ...tempScores, s1: num })} 
                                    className={`flex h-10 items-center justify-center rounded-xl text-[15px] font-black transition-all sm:h-12 sm:text-[18px] ${tempScores.s1 === num ? 'bg-[#C9B075]/20 text-[#C9B075] shadow-[0_0_15px_rgba(201,176,117,0.2)]' : 'bg-[#1A1A1A] text-white/20'}`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* TEAM 2 SELECTOR */}
                    <div className="flex flex-col items-center gap-4 border-l border-white/5 bg-[#0F0F0F] p-4 sm:gap-8 sm:p-6">
                        <div className="flex h-12 flex-col items-center justify-center text-center sm:h-14">
                            <span className="mb-1 w-full truncate text-[13px] font-[1000] leading-tight text-white sm:text-[15px]">{getPlayerName(match.playerIds[2])}</span>
                            <span className="w-full truncate text-[13px] font-[1000] leading-tight text-white sm:text-[15px]">{getPlayerName(match.playerIds[3])}</span>
                            <div className="w-6 h-0.5 bg-[#C9B075] mt-2 opacity-40 rounded-full" />
                        </div>
                        <span className="mb-2 font-mono text-[52px] font-[1000] leading-none tracking-tighter text-white/90 sm:mb-4 sm:text-[72px]">{tempScores.s2}</span>
                        <div className="grid w-full grid-cols-3 gap-1.5 sm:gap-2">
                            {[0, 1, 2, 3, 4, 5, 6].map(num => (
                                <button 
                                    key={`s2-${num}`} 
                                    onClick={() => setTempScores({ ...tempScores, s2: num })} 
                                    className={`flex h-10 items-center justify-center rounded-xl text-[15px] font-black transition-all sm:h-12 sm:text-[18px] ${tempScores.s2 === num ? 'bg-[#C9B075]/20 text-[#C9B075] shadow-[0_0_15px_rgba(201,176,117,0.2)]' : 'bg-[#1A1A1A] text-white/20'}`}
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                
                <div className="relative z-10 flex w-full flex-col gap-3 px-1 pb-[env(safe-area-inset-bottom)] sm:gap-4 sm:px-4">
                    <button 
                        onClick={() => onSave(match.id, tempScores.s1, tempScores.s2)} 
                        className="flex h-14 w-full items-center justify-center gap-3 rounded-[24px] border border-[#C9B075]/20 bg-[#C9B075]/10 text-[11px] font-[1000] italic uppercase tracking-[0.18em] text-[#C9B075] shadow-xl transition-all active:scale-95 sm:h-20 sm:gap-4 sm:rounded-[32px] sm:text-[13px] sm:tracking-[0.3em]"
                    >
                        CONFIRM SCORE <Trophy size={18} fill="#C9B075" />
                    </button>
                    <button 
                        onClick={onCancel} 
                        className="w-full py-3 text-[11px] font-black uppercase tracking-widest text-white/20 transition-colors hover:text-white sm:py-4"
                    >
                        CANCEL
                    </button>
                </div>
            </div>
        </div>
    );
};
