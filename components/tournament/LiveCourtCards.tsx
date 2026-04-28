'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Trophy, Play, RotateCw, Layers, XCircle } from 'lucide-react';
import { Match } from '@/lib/tournament_types';

interface CardProps {
    match: Match;
    getPlayerName: (id: string, matchId?: string) => string;
}

const PlayerBadge = ({ name }: { name: string }) => {
    const isGuest = name.includes('(G)');
    const cleanName = name.replace(' (G)', '');
    return (
        <span className="truncate">
            {cleanName}
            {isGuest && <span className="text-[10px] ml-1 text-[#C9B075]/60 italic font-medium">(G)</span>}
        </span>
    );
};

// 1. 진행 중인 경기 카드 (Original Slim Style)
export const PlayingMatchCard = ({ 
    match, 
    onInputScore, 
    getPlayerName,
    isAdmin = false,
    onCancel,
    spinning = false,
    matchNo
}: CardProps & { 
    onInputScore: (m: Match) => void;
    isAdmin?: boolean;
    onCancel?: (id: string) => void;
    spinning?: boolean;
    matchNo?: number;
}) => {
    const normalizedGroup = match.groupName || (match as any).group || 'A';
    const isGroupB = normalizedGroup === 'B';
    const groupColor = isGroupB ? '#00E5FF' : '#C9B075';

    return (
        <div className="bg-[#1A1A1A] rounded-[32px] p-0.5 border border-white/5 shadow-2xl relative overflow-hidden group">
            <div className="p-6 pb-2 relative z-10">
                <div className="flex items-center justify-between mb-6 px-1">
                    <div className="flex items-center gap-2 opacity-30">
                        <span className="text-[9px] font-black uppercase tracking-widest text-white">GROUP {normalizedGroup}</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-white">MATCH {matchNo || 1}</span>
                        <RotateCw size={8} className={`ml-1 ${spinning ? 'animate-spin' : ''}`} />
                    </div>
                    {isAdmin && onCancel && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onCancel(match.id); }}
                            className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-white/20 hover:text-red-500 transition-all active:scale-90"
                        >
                            <XCircle size={12} />
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-2">
                    <div className="bg-[#262626] rounded-[24px] py-6 px-4 text-center border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-[16px] font-black text-white leading-tight mb-1"><PlayerBadge name={getPlayerName(match.playerIds[0], match.id)} /></span>
                        <span className="text-[16px] font-black text-white leading-tight"><PlayerBadge name={getPlayerName(match.playerIds[1], match.id)} /></span>
                    </div>
                    <span className="text-white/10 font-black italic text-[10px] uppercase tracking-widest">vs</span>
                    <div className="bg-[#262626] rounded-[24px] py-6 px-4 text-center border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-[16px] font-black text-white leading-tight mb-1"><PlayerBadge name={getPlayerName(match.playerIds[2], match.id)} /></span>
                        <span className="text-[16px] font-black text-white leading-tight"><PlayerBadge name={getPlayerName(match.playerIds[3], match.id)} /></span>
                    </div>
                </div>
            </div>

            <button 
                onClick={() => onInputScore(match)} 
                className="w-full py-5 bg-[#C9B075]/5 hover:bg-[#C9B075]/10 text-[#C9B075] font-black text-[11px] uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all border-t border-white/5 italic relative z-10"
            >
                INPUT SCORE <Trophy size={12} fill="#C9B075" />
            </button>
        </div>
    );
};

// 2. 대기 경기 카드 (Original Round Badge Style)
export const WaitingMatchCard = ({ 
    match, 
    index, 
    onStart, 
    getPlayerName,
    matchNo
}: CardProps & { 
    index: number; 
    onStart: (id: string) => void;
    matchNo?: number;
}) => {
    const normalizedGroup = match.groupName || (match as any).group || 'A';
    const isGroupB = normalizedGroup === 'B';
    const displayIndex = matchNo || index + 1;

    return (
        <div 
            onClick={() => onStart(match.id)} 
            className={`rounded-[32px] bg-[#1A1A1A] border p-6 flex items-center justify-between group active:scale-98 transition-all shadow-lg cursor-pointer ${isGroupB ? 'border-cyan-500/10 hover:border-cyan-500/20' : 'border-white/5 hover:border-[#C9B075]/20'}`}
        >
            <div className="flex items-center gap-6">
                <div className="w-12 h-12 bg-[#262626] rounded-full flex flex-col items-center justify-center border border-white/5 shadow-inner">
                    <span className="text-white/20 font-black text-[8px] uppercase leading-none mb-0.5">R{match.round || 1}</span>
                    <span className={`${isGroupB ? 'text-cyan-500' : 'text-[#C9B075]'} font-black text-sm italic leading-none`}>{isGroupB ? 'B' : 'G'}{displayIndex}</span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-[15px] font-black text-white/80">
                        {getPlayerName(match.playerIds[0], match.id)} / {getPlayerName(match.playerIds[1], match.id)}
                    </span>
                    <span className={`text-[9px] font-black italic opacity-10`}>vs</span>
                    <span className="text-[15px] font-black text-white/80">
                        {getPlayerName(match.playerIds[2], match.id)} / {getPlayerName(match.playerIds[3], match.id)}
                    </span>
                </div>
            </div>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity pr-2">
                <Play size={14} fill={isGroupB ? '#00E5FF' : '#C9B075'} className="text-transparent" />
            </div>
        </div>
    );
};

// 3. 완료 경기 카드 (Original Final Style)
export const CompletedMatchCard = ({ 
    match, 
    index, 
    onEdit, 
    getPlayerName,
    matchNo
}: CardProps & { 
    index: number; 
    onEdit: (m: Match) => void;
    matchNo?: number;
}) => {
    const normalizedGroup = match.groupName || (match as any).group || 'A';
    const displayIndex = matchNo || index + 1;

    return (
        <div 
            onClick={() => onEdit(match)}
            className="rounded-[32px] bg-[#1A1A1A] border border-white/5 p-7 relative overflow-hidden group active:scale-[0.98] transition-all shadow-xl"
        >
            <div className="flex items-center gap-2 mb-5 opacity-20 px-1">
                <span className="text-[8px] font-black uppercase tracking-widest text-white">GROUP {normalizedGroup}</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span className="text-[8px] font-black uppercase tracking-widest text-white">MATCH {displayIndex}</span>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="text-right flex flex-col gap-0.5">
                    <span className="text-[15px] font-black text-white leading-tight truncate">{getPlayerName(match.playerIds[0], match.id)}</span>
                    <span className="text-[15px] font-black text-white leading-tight truncate">{getPlayerName(match.playerIds[1], match.id)}</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-4">
                    <div className="flex items-center gap-3">
                        <span className="text-[28px] font-black text-[#C9B075] leading-none">{match.score1}</span>
                        <span className="text-[18px] font-black text-white/5 leading-none">:</span>
                        <span className="text-[28px] font-black text-[#C9B075] leading-none">{match.score2}</span>
                    </div>
                    <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.2em] italic">FINAL WIN</span>
                </div>
                <div className="text-left flex flex-col gap-0.5">
                    <span className="text-[15px] font-black text-white leading-tight truncate">{getPlayerName(match.playerIds[2], match.id)}</span>
                    <span className="text-[15px] font-black text-white leading-tight truncate">{getPlayerName(match.playerIds[3], match.id)}</span>
                </div>
            </div>

            <div className="mt-5 flex items-center justify-center gap-2 text-[8px] font-black text-white/5 uppercase tracking-widest italic group-hover:text-white/20 transition-colors">
                TAP TO EDIT <Layers size={10} />
            </div>
        </div>
    );
};
