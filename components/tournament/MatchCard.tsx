'use client';

import React from 'react';
import { RotateCw, CheckCircle2 } from 'lucide-react';

interface Match {
    id: string;
    playerIds: string[];
    court?: number;
    status: 'waiting' | 'playing' | 'complete';
    mode?: string;
    round?: number;
    score1?: number;
    score2?: number;
    groupName?: string;
}

interface MatchCardProps {
    match: Match;
    isAdmin: boolean;
    role: string;
    getPlayerName: (id: string) => string;
    matchNo: number;
    spinningMatchId?: string | null;
    onCancel?: (id: string) => void;
    onInputScore: (id: string, s1: number, s2: number) => void;
    showToast?: boolean;
    toastMsg?: string;
}

export default function MatchCard({
    match,
    isAdmin,
    role,
    getPlayerName,
    matchNo,
    spinningMatchId,
    onCancel,
    onInputScore,
    showToast,
    toastMsg
}: MatchCardProps) {
    const normalizedGroup = match.groupName || 'A';
    const isGroupB = normalizedGroup === 'B';
    const groupColor = isGroupB ? '#00E5FF' : '#C9B075';
    const cardGlow = isGroupB ? '0 0 15px rgba(0, 229, 255, 0.2)' : '0 0 15px rgba(201, 176, 117, 0.05)';

    return (
        <div 
            className="rounded-2xl relative flex flex-col justify-between h-full group transition-all" 
            style={{ 
                transform: 'none', 
                background: 'rgba(255, 255, 255, 0.05)', 
                backdropFilter: 'blur(64px)', 
                border: 'none', 
                borderTop: `2px solid ${isGroupB ? 'rgba(0, 229, 255, 0.3)' : 'rgba(255, 255, 255, 0.3)'}`, 
                boxShadow: `0 20px 50px rgba(0,0,0,0.9), ${cardGlow}`, 
                overflow: 'hidden' 
            }}
        >
            {/* SECTION HEADER BAR */}
            <div className="flex items-center justify-center px-4 py-3 bg-white/5 border-b border-white/10 overflow-hidden relative group/header">
                <div className="flex items-center justify-center gap-2">
                    <span 
                        className="text-[10px] font-mono font-bold tracking-[0.2em] uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" 
                        style={{ color: groupColor }}
                    >
                        ROUND {match.round} • {normalizedGroup}조 • {matchNo}경기
                    </span>
                    <RotateCw 
                        className={`w-3 h-3 transition-colors ${spinningMatchId === match.id ? 'animate-spin' : 'opacity-40'}`} 
                        style={{ color: groupColor }} 
                    />
                </div>
                
                {role === 'CEO' && onCancel && (
                    <button
                        type="button"
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            if (window.navigator?.vibrate) window.navigator.vibrate(50); 
                            onCancel(match.id); 
                        }}
                        className="absolute right-2 flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-90 hover:bg-white/5 group/refresh"
                        title="웨이팅 리스트로 복귀"
                    >
                        <RotateCw className="w-3.5 h-3.5 opacity-20 group-hover:opacity-100 transition-opacity" />
                    </button>
                )}
            </div>

            <div className="p-2 flex flex-col justify-center flex-1 py-8">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 flex-grow">

                    {/* TEAM A BLOCK */}
                    <div className="relative bg-white/5 rounded-[18px] h-[68px] flex flex-col items-center justify-center border border-white/5 w-full overflow-hidden transition-all duration-300">
                        <div className="flex flex-col items-center justify-center w-full px-1 sm:px-2 gap-1 min-w-0">
                            <span className="text-white font-black leading-none relative z-0 truncate w-full text-center text-[clamp(12px,4vw,15px)]" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                {getPlayerName(match.playerIds[0]) || " "}
                            </span>
                            <span className="text-white font-black leading-none relative z-0 truncate w-full text-center text-[clamp(12px,4vw,15px)]" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                {getPlayerName(match.playerIds[1]) || " "}
                            </span>
                        </div>
                    </div>

                    {/* Sleek Success Toast (Scoped to card if needed, currently global in page but kept for logic consistency) */}
                    {showToast && toastMsg && (
                        <div className="fixed bottom-[115px] left-1/2 -translate-x-1/2 z-[2000] animate-in fade-in slide-in-from-bottom-4 duration-300 w-[90%] max-w-sm">
                            <div className="bg-[#1C1C1E] border border-[#D4AF37]/30 text-white px-6 py-3.5 rounded-2xl shadow-2xl flex items-center justify-center gap-3 backdrop-blur-xl">
                                <div className="w-4 h-4 rounded-full bg-[#D4AF37]/20 flex items-center justify-center">
                                    <CheckCircle2 className={`w-3 h-3 ${toastMsg.includes('관리자') ? 'text-red-400' : 'text-[#4ADE80]'}`} />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-widest italic text-center">{toastMsg}</span>
                            </div>
                        </div>
                    )}
                    
                    <div className="font-black text-[8px] uppercase text-center italic opacity-60 shrink-0" style={{ color: groupColor, filter: `drop-shadow(0 0 5px ${groupColor}4D)` }}>vs</div>

                    {/* TEAM B BLOCK */}
                    <div className="relative bg-white/5 rounded-[18px] h-[68px] flex flex-col items-center justify-center border border-white/5 w-full overflow-hidden transition-all duration-300">
                        <div className="flex flex-col items-center justify-center w-full px-1 sm:px-2 gap-1 min-w-0">
                            <span className="text-white font-black leading-none relative z-0 truncate w-full text-center text-[clamp(12px,4vw,15px)]" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                {getPlayerName(match.playerIds[2]) || " "}
                            </span>
                            <span className="text-white font-black leading-none relative z-0 truncate w-full text-center text-[clamp(12px,4vw,15px)]" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                {getPlayerName(match.playerIds[3]) || " "}
                            </span>
                        </div>
                    </div>

                </div>

                {/* SCORE INPUT BUTTON */}
                <button
                    onClick={() => { 
                        if (window.navigator?.vibrate) window.navigator.vibrate(50); 
                        onInputScore(match.id, match.score1 ?? 1, match.score2 ?? 1); 
                    }}
                    className="w-full h-11 bg-transparent border border-[#8E7A4A]/40 hover:bg-[#8E7A4A]/25 active:scale-95 transition-all rounded-[14px] flex items-center justify-center shrink-0 mt-4"
                    style={{ background: 'linear-gradient(to right, rgba(142,122,74,0.1), transparent, rgba(142,122,74,0.1))', boxShadow: '0 0 15px rgba(142,122,74,0.2), inset 0 0 10px rgba(142,122,74,0.1)', filter: 'drop-shadow(0 0 5px rgba(142,122,74,0.3))' }}
                >
                    <span className="bg-gradient-to-r from-[#8E7A4A] via-[#A89462] to-[#8E7A4A] bg-clip-text text-transparent text-[11px] font-black uppercase tracking-[0.25em]">INPUT SCORE 🏆</span>
                </button>
            </div>
        </div>
    );
}
