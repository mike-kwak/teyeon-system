'use client';

import React from 'react';
import { RotateCw, CheckCircle2, Trophy, Layers } from 'lucide-react';
import { Match } from '@/lib/tournament_types';

interface CardProps {
    match: Match;
    getPlayerName: (id: string, matchId?: string) => string;
}

const normalizeDisplayGroup = (value?: string) => {
    const raw = String(value || 'A').trim().toUpperCase();
    if (raw.includes('BLUE') || raw === 'B') return 'B';
    if (raw.includes('GOLD') || raw === 'A') return 'A';
    return raw.includes('B') ? 'B' : 'A';
};

const getGroupPresentation = (value?: string) => {
    const normalizedGroup = normalizeDisplayGroup(value);
    const isGroupB = normalizedGroup === 'B';
    return {
        normalizedGroup,
        isGroupB,
        label: isGroupB ? 'BLUE / B조' : 'GOLD / A조',
        shortLabel: isGroupB ? 'BLUE' : 'GOLD',
        color: isGroupB ? '#00E5FF' : '#C9B075',
        guestAccent: isGroupB ? '#9BEBFF' : '#C9B075',
    };
};

// 1. 진행 중인 경기 카드 (Original MatchCard Rollback)
export const PlayingMatchCard = ({ 
    match, 
    onInputScore, 
    getPlayerName,
    isAdmin = false,
    onCancel,
    spinningMatchId,
    matchNo,
    showToast,
    toastMsg
}: CardProps & { 
    onInputScore: (id: string, s1: number, s2: number) => void;
    isAdmin?: boolean;
    onCancel?: (id: string) => void;
    spinningMatchId?: string | null;
    matchNo?: number;
    showToast?: boolean;
    toastMsg?: string;
}) => {
    const groupMeta = getGroupPresentation(match.groupName || (match as any).group);
    const { normalizedGroup, isGroupB, color: groupColor, guestAccent } = groupMeta;
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
                        className="hidden text-[10px] font-mono font-bold tracking-[0.2em] uppercase truncate drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                        style={{ color: groupColor }}
                    >
                        ROUND {match.round} • {normalizedGroup}조 • {matchNo}경기
                    </span>
                    <span
                        className="truncate text-[10px] font-mono font-bold uppercase tracking-[0.12em] drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                        style={{ color: groupColor }}
                    >
                        {`ROUND ${match.round || 1} · ${groupMeta.label} · ${Math.max(1, matchNo || 1)}경기`}
                    </span>
                </div>
                
                {isAdmin && onCancel && (
                    <button
                        type="button"
                        onClick={(e) => { 
                            e.stopPropagation(); 
                            if (window.navigator?.vibrate) window.navigator.vibrate(50); 
                            onCancel(match.id); 
                        }}
                        className="absolute right-2 flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-90 hover:bg-white/5 group/refresh"
                        title="대기열 리스트로 복구"
                    >
                        <RotateCw className="w-3.5 h-3.5 opacity-20 group-hover:opacity-100 transition-opacity" />
                    </button>
                )}
            </div>

            <div className="flex flex-1 flex-col justify-center px-2 py-8">
                <div className="grid flex-grow grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">

                    {/* TEAM A BLOCK */}
                    <div className="relative flex h-[68px] w-full min-w-0 flex-col items-center justify-center overflow-hidden rounded-[18px] border border-white/5 bg-white/5 transition-all duration-300">
                        <div className="flex flex-col items-center justify-center w-full px-1 sm:px-2 gap-1 min-w-0">
                            <div className="text-white font-black leading-none relative z-0 truncate w-full flex items-center justify-center gap-0.5" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                <span className="truncate text-[clamp(12px,4vw,15px)]">{getPlayerName(match.playerIds[0], match.id).replace(/\s*\(G\)$/i, '')}</span>
                                {getPlayerName(match.playerIds[0], match.id).includes('(G)') && <span className="text-[10px] italic shrink-0" style={{ color: guestAccent }}>(G)</span>}
                            </div>
                            <div className="text-white font-black leading-none relative z-0 truncate w-full flex items-center justify-center gap-0.5" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                <span className="truncate text-[clamp(12px,4vw,15px)]">{getPlayerName(match.playerIds[1], match.id).replace(/\s*\(G\)$/i, '')}</span>
                                {getPlayerName(match.playerIds[1], match.id).includes('(G)') && <span className="text-[10px] italic shrink-0" style={{ color: guestAccent }}>(G)</span>}
                            </div>
                        </div>
                    </div>

                    <div className="shrink-0 text-center text-[8px] font-black uppercase italic opacity-60" style={{ color: groupColor, filter: `drop-shadow(0 0 5px ${groupColor}4D)` }}>vs</div>

                    {/* TEAM B BLOCK */}
                    <div className="relative flex h-[68px] w-full min-w-0 flex-col items-center justify-center overflow-hidden rounded-[18px] border border-white/5 bg-white/5 transition-all duration-300">
                        <div className="flex flex-col items-center justify-center w-full px-1 sm:px-2 gap-1 min-w-0">
                            <div className="text-white font-black leading-none relative z-0 truncate w-full flex items-center justify-center gap-0.5" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                <span className="truncate text-[clamp(12px,4vw,15px)]">{getPlayerName(match.playerIds[2], match.id).replace(/\s*\(G\)$/i, '')}</span>
                                {getPlayerName(match.playerIds[2], match.id).includes('(G)') && <span className="text-[10px] italic shrink-0" style={{ color: guestAccent }}>(G)</span>}
                            </div>
                            <div className="text-white font-black leading-none relative z-0 truncate w-full flex items-center justify-center gap-0.5" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                                <span className="truncate text-[clamp(12px,4vw,15px)]">{getPlayerName(match.playerIds[3], match.id).replace(/\s*\(G\)$/i, '')}</span>
                                {getPlayerName(match.playerIds[3], match.id).includes('(G)') && <span className="text-[10px] italic shrink-0" style={{ color: guestAccent }}>(G)</span>}
                            </div>
                        </div>
                    </div>

                </div>

                {/* SCORE INPUT BUTTON */}
                <button
                    onClick={() => { 
                        if (window.navigator?.vibrate) window.navigator.vibrate(50); 
                        onInputScore(match.id, match.score1 ?? 1, match.score2 ?? 1); 
                    }}
                    className="mt-4 flex h-11 w-full shrink-0 items-center justify-center rounded-[14px] border border-[#8E7A4A]/40 bg-transparent transition-all hover:bg-[#8E7A4A]/25 active:scale-95"
                    style={{ background: 'linear-gradient(to right, rgba(142,122,74,0.1), transparent, rgba(142,122,74,0.1))', boxShadow: '0 0 15px rgba(142,122,74,0.2), inset 0 0 10px rgba(142,122,74,0.1)', filter: 'drop-shadow(0 0 5px rgba(142,122,74,0.3))' }}
                >
                    <span className="bg-gradient-to-r from-[#8E7A4A] via-[#A89462] to-[#8E7A4A] bg-clip-text text-transparent text-[11px] font-black uppercase tracking-[0.25em]">INPUT SCORE 🏆</span>
                </button>
            </div>

            {/* Scoped Toast Indicator (Optional but kept for logic) */}
            {showToast && toastMsg && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[2000] w-[90%]">
                    <div className="bg-[#1C1C1E]/90 border border-[#D4AF37]/30 text-white px-4 py-2 rounded-xl shadow-2xl flex items-center justify-center gap-2 backdrop-blur-xl">
                        <CheckCircle2 size={10} className={toastMsg.includes('관리자') ? 'text-red-400' : 'text-[#4ADE80]'} />
                        <span className="text-[9px] font-black uppercase tracking-widest italic">{toastMsg}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

// 2. 대기 경기 카드 (Original KDK Inline Rollback)
export const WaitingMatchCard = ({ 
    match, 
    index, 
    onStart, 
    getPlayerName,
    matchNo,
    isAdmin = false,
    isStartingMatch = false,
    hasConflict = false
}: CardProps & { 
    index: number; 
    onStart: (id: string) => void;
    matchNo?: number;
    isAdmin?: boolean;
    isStartingMatch?: boolean;
    hasConflict?: boolean;
}) => {
    const groupMeta = getGroupPresentation(match.groupName || (match as any).group);
    const { normalizedGroup, isGroupB, color: col, guestAccent } = groupMeta;
    const displayIndex = matchNo || index + 1;

    return (
        <div key={match.id} className="active:scale-98 relative grid grid-cols-[45px_minmax(0,1fr)_75px] items-center overflow-hidden rounded-2xl px-3 py-[22px] transition-all" style={{ transform: 'none', background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(64px)', border: 'none', borderTop: `2px solid ${isGroupB ? 'rgba(0, 229, 255, 0.3)' : 'rgba(255, 255, 255, 0.3)'}`, boxShadow: `0 20px 50px rgba(0,0,0,0.9), 0 0 15px ${isGroupB ? 'rgba(0, 229, 255, 0.1)' : 'rgba(201, 176, 117, 0.03)'}`, filter: `drop-shadow(0 0 10px ${col}33)` }}>
            <div className="flex items-center justify-center">
                <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-full border border-white/20 text-black shadow-[0_0_10px_rgba(0,0,0,0.2)]" style={{ background: `linear-gradient(135deg, ${col}, ${col}aa)` }}>
                    <span className="text-[8px] font-black leading-none opacity-40">R{match.round}</span>
                    <span className="text-[12px] font-[1000] leading-none uppercase">{isGroupB ? 'B' : 'G'}{Math.max(1, displayIndex)}</span>
                </div>
            </div>

            <div className="flex min-w-0 items-center justify-center gap-2 px-1 text-center sm:gap-2" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}>
                <span className="flex min-w-0 flex-1 items-center justify-center gap-0.5 truncate text-[14px] font-bold leading-none text-white sm:text-[17px]">
                    {getPlayerName(match.playerIds[0], match.id).replace(/\s*\(G\)$/i, '')}
                    {getPlayerName(match.playerIds[0], match.id).includes('(G)') && <span className="shrink-0 text-[10px] font-black italic drop-shadow-[0_0_8px_rgba(201,176,117,0.4)] sm:text-[11px]" style={{ color: guestAccent }}>(G)</span>}
                    /
                    {getPlayerName(match.playerIds[1], match.id).replace(/\s*\(G\)$/i, '')}
                    {getPlayerName(match.playerIds[1], match.id).includes('(G)') && <span className="shrink-0 text-[10px] font-black italic drop-shadow-[0_0_8px_rgba(201,176,117,0.4)] sm:text-[11px]" style={{ color: guestAccent }}>(G)</span>}
                </span>
                <span className="text-[9px] font-black uppercase italic tracking-tighter opacity-25 shrink-0" style={{ color: col }}>vs</span>
                <span className="flex min-w-0 flex-1 items-center justify-center gap-0.5 truncate text-[14px] font-bold leading-none text-white sm:text-[17px]">
                    {getPlayerName(match.playerIds[2], match.id).replace(/\s*\(G\)$/i, '')}
                    {getPlayerName(match.playerIds[2], match.id).includes('(G)') && <span className="shrink-0 text-[10px] font-black italic drop-shadow-[0_0_8px_rgba(201,176,117,0.4)] sm:text-[11px]" style={{ color: guestAccent }}>(G)</span>}
                    /
                    {getPlayerName(match.playerIds[3], match.id).replace(/\s*\(G\)$/i, '')}
                    {getPlayerName(match.playerIds[3], match.id).includes('(G)') && <span className="shrink-0 text-[10px] font-black italic drop-shadow-[0_0_8px_rgba(201,176,117,0.4)] sm:text-[11px]" style={{ color: guestAccent }}>(G)</span>}
                </span>
            </div>

            <div className="flex items-center justify-end">
                <button
                    onClick={() => { 
                        if (window.navigator?.vibrate) window.navigator.vibrate(50); 
                        onStart(match.id); 
                    }}
                    disabled={isStartingMatch || hasConflict}
                    className={`rounded-xl px-4 py-3 text-[12px] font-black uppercase shadow-xl transition-all active:scale-95 ${(isStartingMatch || hasConflict) ? 'bg-zinc-800 text-white/5 cursor-not-allowed opacity-50' : '!text-black hover:opacity-90'}`}
                    style={{ backgroundColor: (isStartingMatch || hasConflict) ? undefined : col, color: (isStartingMatch || hasConflict) ? undefined : '#000000', boxShadow: (isStartingMatch || hasConflict) ? 'none' : `0 4px 15px ${col}66` }}
                >
                    {isStartingMatch ? '...' : hasConflict ? '대기' : (isAdmin ? '투입' : '대기')}
                </button>
            </div>
        </div>
    );
};

// 3. 완료 경기 카드 (Original KDK Inline Rollback)
export const CompletedMatchCard = ({ 
    match, 
    index, 
    onEdit, 
    getPlayerName,
    matchNo,
    isAdmin = false,
    onResetStatus
}: CardProps & { 
    index: number; 
    onEdit: (m: Match) => void;
    matchNo?: number;
    isAdmin?: boolean;
    onResetStatus?: (id: string) => void;
}) => {
    const { normalizedGroup, isGroupB } = getGroupPresentation(match.groupName || (match as any).group);
    const displayIndex = matchNo || index + 1;
    const groupColor = normalizedGroup === 'B' ? 'rgba(0, 229, 255, 0.4)' : 'rgba(201, 176, 117, 0.5)';

    return (
        <div key={match.id} onClick={() => { if (window.navigator?.vibrate) window.navigator.vibrate(50); onEdit(match); }} className="rounded-[24px] relative flex flex-col justify-between h-full group transition-all overflow-hidden" style={{ transform: 'none', background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(64px)', border: 'none', borderTop: '2px solid rgba(255, 255, 255, 0.15)', borderLeft: '1px solid rgba(255, 255, 255, 0.05)', boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.2), 0 20px 50px rgba(0,0,0,0.8), 0 10px 20px rgba(0,0,0,0.5)' }}>
            {/* SECTION HEADER BAR */}
            <div className="flex items-center justify-center gap-2 px-4 py-2 bg-white/[0.02] border-b border-white/5 overflow-hidden relative">
                <span className="text-[10px] font-mono font-bold tracking-[0.2em] uppercase truncate" style={{ color: groupColor }}>
                    GROUP {normalizedGroup} • MATCH {displayIndex.toString().padStart(2, '0')}
                </span>
                {isAdmin && onResetStatus && (
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onResetStatus(match.id);
                        }}
                        className="absolute right-3 hover:bg-white/10 p-1.5 rounded-full transition-all text-white/40 hover:text-[#10B981] z-20"
                        title="경기 다시 진행"
                    >
                        <RotateCw size={12} strokeWidth={3} />
                    </button>
                )}
            </div>

            <div className="flex-1 flex flex-col justify-center px-1 py-4 sm:px-3 sm:py-8">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-2 w-full">
                    <div className="flex flex-col items-center justify-center min-w-0 gap-1 opacity-80">
                        <span className="text-white font-black leading-none truncate w-full text-center text-[clamp(11px,3vw,14px)]">{getPlayerName(match.playerIds[0], match.id)}</span>
                        <span className="text-white font-black leading-none truncate w-full text-center text-[clamp(11px,3vw,14px)]">{getPlayerName(match.playerIds[1], match.id)}</span>
                    </div>
                    <div className="flex flex-col items-center flex-shrink-0 px-1 sm:px-2 justify-center">
                        <span className="text-[clamp(24px,6vw,36px)] tracking-widest font-black text-[#C9B075]/40 leading-none mb-1">{match.score1}:{match.score2}</span>
                        <span className="text-[clamp(6px,2vw,8px)] font-black text-white/20 uppercase mt-1 tracking-widest">FINAL WIN</span>
                    </div>
                    <div className="flex flex-col items-center justify-center min-w-0 gap-1 opacity-80">
                        <span className="text-white font-black leading-none truncate w-full text-center text-[clamp(11px,3vw,14px)]">{getPlayerName(match.playerIds[2], match.id)}</span>
                        <span className="text-white font-black leading-none truncate w-full text-center text-[clamp(11px,3vw,14px)]">{getPlayerName(match.playerIds[3], match.id)}</span>
                    </div>
                </div>
            </div>
            <div className="pb-3 text-center transition-all duration-300">
                <span className="text-[8px] font-black text-white/30 uppercase tracking-[0.3em] group-hover:text-[#C9B075]/60 group-hover:tracking-[0.4em] transition-all">TAP TO EDIT <Layers size={10} className="inline ml-1 opacity-20" /></span>
            </div>
        </div>
    );
};
