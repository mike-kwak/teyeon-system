import React from 'react';
import { ChevronUp, ChevronDown, Minus } from 'lucide-react';
import { RankedPlayer } from '@/lib/tournament_types';
import { InitialAvatar } from './InitialAvatar';
import PlayerNameTag from './PlayerNameTag';

interface RankingRowProps {
    player: RankedPlayer;
    rank: number;
    amount: number;
}

export default function RankingRow({ player, rank, amount }: RankingRowProps) {
    const formatRankingPlayerName = (name?: string, id?: string) => {
        const normalizeGuest = (value?: string) => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (/^manual-guest-/i.test(raw)) {
                const guestName = raw.replace(/^manual-guest-/i, '').replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').trim();
                return guestName && !/^(guest|게스트)$/i.test(guestName) ? `${guestName}(G)` : '게스트(G)';
            }
            if (/^g-\d+/i.test(raw)) {
                return '게스트(G)';
            }
            if (/\s+g$/i.test(raw)) {
                const guestName = raw.replace(/\s+g$/i, '').trim();
                return guestName && !/^(guest|게스트)$/i.test(guestName) ? `${guestName}(G)` : '게스트(G)';
            }
            const cleaned = raw.replace(/\s*\(G\)$/i, '(G)');
            return /^(guest|게스트)$/i.test(cleaned.replace(/\(G\)$/i, '').trim()) && !cleaned.endsWith('(G)') ? '' : cleaned;
        };

        const byName = normalizeGuest(name);
        if (byName && byName !== id) return byName;
        const byId = normalizeGuest(id);
        return byId || '미확인';
    };

    const rawName = formatRankingPlayerName(player.name, player.id);
    const isGuest = /\(G\)\s*$/i.test(rawName) || !!player.is_guest;
    const cleanName = rawName.replace(/\s*\(G\)$/i, '');

    const trendIcon = () => {
        if (player.trend === 'up') return <ChevronUp className="w-3 h-3" style={{ color: '#16A085' }} />;
        if (player.trend === 'down') return <ChevronDown className="w-3 h-3" style={{ color: '#EF4444' }} />;
        return <Minus className="w-3 h-3" style={{ color: '#9CB2CC' }} />;
    };

    return (
        <div
            className="grid h-14 items-center gap-1 rounded-2xl px-4 transition-all"
            style={{
                gridTemplateColumns: '2rem 2.2rem 1fr 1.5rem 1.5rem 1.5rem 1.7rem 1.7rem 2rem 5.2rem',
                background: '#FFFFFF',
                border: '1px solid #DCE8F5',
                boxShadow: '0 4px 12px rgba(15,45,85,0.05)',
            }}
        >
            {/* Rank + trend */}
            <div className="flex flex-col items-center justify-center gap-0.5">
                <span style={{ fontSize: 13, fontWeight: 900, color: '#0F2747', lineHeight: 1 }}>
                    {rank}
                </span>
                <div className="flex items-center justify-center">{trendIcon()}</div>
            </div>

            {/* Avatar */}
            <div className="flex items-center justify-center">
                {player.avatar ? (
                    <div
                        style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: '#F6FAFD', border: '1px solid #DCE8F5',
                            overflow: 'hidden',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        <img src={player.avatar} alt={cleanName} className="w-full h-full object-cover" />
                    </div>
                ) : (
                    <InitialAvatar name={cleanName} size={32} />
                )}
            </div>

            {/* Name + G badge (공통 렌더러 — 한 줄 + 길이별 폰트 축소) */}
            <div className="flex min-w-0 items-center pl-2 text-left">
                <PlayerNameTag
                    name={rawName}
                    isGuest={isGuest}
                    baseSize={14}
                    weight={800}
                    justify="flex-start"
                />
            </div>

            {/* P (games) */}
            <div className="text-right" style={{ fontSize: 11, fontWeight: 800, color: '#7A93B3' }}>{player.games}</div>
            {/* W (wins) */}
            <div className="text-right" style={{ fontSize: 15, fontWeight: 900, color: '#1F5FB5' }}>{player.wins}</div>
            {/* L (losses) */}
            <div className="text-right" style={{ fontSize: 13, fontWeight: 800, color: '#56729A' }}>{player.losses}</div>
            {/* PF */}
            <div className="text-right" style={{ fontSize: 11, fontWeight: 700, color: '#7A93B3' }}>{player.pf || 0}</div>
            {/* PA */}
            <div className="text-right" style={{ fontSize: 11, fontWeight: 700, color: '#7A93B3' }}>{player.pa || 0}</div>

            {/* +/- diff */}
            <div
                className="text-right"
                style={{
                    fontSize: 14, fontWeight: 900,
                    color: player.diff > 0 ? '#16A085' : player.diff < 0 ? '#C0392B' : '#7A93B3',
                }}
            >
                {player.diff > 0 ? `+${player.diff}` : player.diff}
            </div>

            {/* FINE (settlement) */}
            <div
                className="text-center"
                style={{
                    fontSize: 13, fontWeight: 900,
                    color: amount < 0 ? '#C0392B' : amount > 0 ? '#1F5FB5' : '#9CB2CC',
                }}
            >
                {amount !== 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 1, whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, opacity: 0.7 }}>₩</span>
                        <span>{`${amount > 0 ? '+' : ''}${amount.toLocaleString()}`}</span>
                    </span>
                ) : (
                    '0'
                )}
            </div>
        </div>
    );
}
