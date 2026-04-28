'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Zap, Trophy, Play, RotateCw, Layers, XCircle } from 'lucide-react';
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

// 1. 진행 중인 경기 카드 (KDK Capsule Style)
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
        <div className="bg-[#1E1E1E] rounded-[48px] p-1 border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.8)] relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none -mr-4 -mt-4"><Zap size={100} className="text-[#C9B075]" /></div>
            
            <div className="p-8 pb-4 relative z-10">
                <div className="flex items-center justify-between mb-8 px-2">
                    <div className="flex items-center gap-2 opacity-40">
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#C9B075]">ROUND {match.round || 1}</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span className={`text-[10px] font-black uppercase tracking-widest`} style={{ color: groupColor }}>{normalizedGroup}조</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">{matchNo || 1} 경기</span>
                        <RotateCw size={10} className={`ml-1 ${spinning ? 'animate-spin' : ''}`} />
                    </div>
                    {isAdmin && onCancel && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onCancel(match.id); }}
                            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/20 hover:text-red-500 hover:bg-red-500/10 transition-all active:scale-90"
                        >
                            <XCircle size={14} />
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
                    <div className="bg-[#2A2A2A] rounded-[32px] py-7 px-4 text-center border border-white/5 flex flex-col items-center justify-center shadow-inner">
                        <span className="text-[18px] font-[1000] text-white leading-none truncate max-w-full mb-1.5"><PlayerBadge name={getPlayerName(match.playerIds[0], match.id)} /></span>
                        <span className="text-[18px] font-[1000] text-white leading-none truncate max-w-full"><PlayerBadge name={getPlayerName(match.playerIds[1], match.id)} /></span>
                    </div>
                    <span className="text-white/20 font-black italic text-sm uppercase tracking-widest">vs</span>
                    <div className="bg-[#2A2A2A] rounded-[32px] py-7 px-4 text-center border border-white/5 flex flex-col items-center justify-center shadow-inner">
                        <span className="text-[18px] font-[1000] text-white leading-none truncate max-w-full mb-1.5"><PlayerBadge name={getPlayerName(match.playerIds[2], match.id)} /></span>
                        <span className="text-[18px] font-[1000] text-white leading-none truncate max-w-full"><PlayerBadge name={getPlayerName(match.playerIds[3], match.id)} /></span>
                    </div>
                </div>
            </div>

            <button 
                onClick={() => onInputScore(match)} 
                className="w-full py-6 bg-black/40 hover:bg-[#C9B075]/10 text-[#C9B075] font-black text-[13px] uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all border-t border-white/5 italic relative z-10 group-hover:bg-[#C9B075]/5"
            >
                INPUT SCORE <Trophy size={14} fill="#C9B075" />
            </button>
        </div>
    );
};

// 2. 대기 경기 카드 (Rx Gx Circle Style)
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
            className={`rounded-[40px] bg-[#1A1A1A] border p-7 flex items-center justify-between group active:scale-95 transition-all shadow-xl cursor-pointer ${isGroupB ? 'border-cyan-500/10 hover:border-cyan-500/30' : 'border-white/5 hover:border-[#C9B075]/30'}`}
        >
            <div className="flex items-center gap-7">
                <div className="w-14 h-14 bg-[#2A2A2A] rounded-full flex flex-col items-center justify-center border border-white/10 group-hover:bg-[#C9B075]/10 transition-all shadow-inner">
                    <span className="text-white/20 font-black text-[9px] uppercase leading-none mb-0.5">R{match.round || 1}</span>
                    <span className={`${isGroupB ? 'text-cyan-500' : 'text-[#C9B075]'} font-black text-sm italic leading-none`}>{isGroupB ? 'B' : 'G'}{displayIndex}</span>
                </div>
                <div className="flex items-center gap-5">
                    <span className="text-[16px] font-[1000] text-white/90 group-hover:text-white transition-colors">
                        {getPlayerName(match.playerIds[0], match.id)} / {getPlayerName(match.playerIds[1], match.id)}
                    </span>
                    <span className={`text-[10px] font-black italic ${isGroupB ? 'text-cyan-500/20' : 'text-white/10'}`}>vs</span>
                    <span className="text-[16px] font-[1000] text-white/90 group-hover:text-white transition-colors">
                        {getPlayerName(match.playerIds[2], match.id)} / {getPlayerName(match.playerIds[3], match.id)}
                    </span>
                </div>
            </div>
            <div className={`w-6 h-6 rounded-full border border-white/10 flex items-center justify-center opacity-10 group-hover:opacity-100 transition-opacity`}>
                <Zap size={12} fill={isGroupB ? '#00E5FF' : 'white'} />
            </div>
        </div>
    );
};

// 3. 완료 경기 카드 (Final Win Style)
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
            className="rounded-[48px] bg-gradient-to-br from-[#1E1E1E] to-[#141414] border border-white/5 p-8 relative overflow-hidden group active:scale-[0.98] transition-all shadow-2xl"
        >
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none -mr-4 -mt-4"><Zap size={80} className="text-[#C9B075]" /></div>
            
            <div className="flex items-center gap-2 mb-6 opacity-20 px-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-[#C9B075]">GROUP {normalizedGroup}</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white">MATCH {String(displayIndex).padStart(2, '0')}</span>
                <RotateCw size={8} className="ml-1" />
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="text-right flex flex-col gap-1">
                    <span className="text-[16px] font-[1000] text-white leading-none truncate">{getPlayerName(match.playerIds[0], match.id)}</span>
                    <span className="text-[16px] font-[1000] text-white leading-none truncate">{getPlayerName(match.playerIds[1], match.id)}</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 px-6">
                    <div className="flex items-center gap-4">
                        <span className="text-[32px] font-[1000] text-[#C9B075] leading-none drop-shadow-[0_0_10px_rgba(201,176,117,0.3)]">{match.score1}</span>
                        <span className="text-[20px] font-black text-white/10 leading-none">:</span>
                        <span className="text-[32px] font-[1000] text-[#C9B075] leading-none drop-shadow-[0_0_10px_rgba(201,176,117,0.3)]">{match.score2}</span>
                    </div>
                    <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] italic">FINAL WIN</span>
                </div>
                <div className="text-left flex flex-col gap-1">
                    <span className="text-[16px] font-[1000] text-white leading-none truncate">{getPlayerName(match.playerIds[2], match.id)}</span>
                    <span className="text-[16px] font-[1000] text-white leading-none truncate">{getPlayerName(match.playerIds[3], match.id)}</span>
                </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2 text-[9px] font-black text-white/10 uppercase tracking-widest italic group-hover:text-white/30 transition-colors">
                TAP TO EDIT <Layers size={10} />
            </div>
        </div>
    );
};
