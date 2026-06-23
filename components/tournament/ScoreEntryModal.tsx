'use client';

import React from 'react';
import { Trophy } from 'lucide-react';
import { Match } from '@/lib/tournament_types';

interface ScoreEntryModalProps {
    match: Match;
    tempScores: { s1: number, s2: number };
    setTempScores: (scores: { s1: number, s2: number }) => void;
    onSave: (matchId: string, s1: number, s2: number) => void;
    onCancel: () => void;
    getPlayerName: (id: string) => string;
}

const stripGuestSuffix = (name: string) => name.replace(/\s*\(G\)$/i, '');
const isGuestName = (name: string) => /\(G\)\s*$/i.test(name);

const GuestBadge = () => (
    <span
        aria-label="게스트"
        style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: '50%',
            background: '#FFF4DE', border: '1px solid #F4C979',
            color: '#B7791F',
            fontSize: 10, fontWeight: 900, lineHeight: 1,
            flexShrink: 0,
        }}
    >
        G
    </span>
);

const renderName = (rawName: string) => {
    const isGuest = isGuestName(rawName);
    const cleanName = stripGuestSuffix(rawName);
    // 작은 화면 대응: 자동 축소 + 최대 2줄 줄바꿈. (G)는 badge 로 분리.
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 0, maxWidth: '100%' }}>
            <span style={{
                minWidth: 0,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden', textAlign: 'center',
                overflowWrap: 'anywhere', wordBreak: 'keep-all',
            }}>{cleanName}</span>
            {isGuest && <GuestBadge />}
        </span>
    );
};

export const ScoreEntryModal = ({
    match,
    tempScores,
    setTempScores,
    onSave,
    onCancel,
    getPlayerName,
}: ScoreEntryModalProps) => {
    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 3000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(15, 45, 85, 0.55)', backdropFilter: 'blur(10px)',
                padding: '12px',
                paddingTop: 'calc(12px + env(safe-area-inset-top))',
                paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
                boxSizing: 'border-box',
            }}
        >
            <div
                style={{
                    position: 'relative', display: 'flex', flexDirection: 'column',
                    width: '100%', maxWidth: 380,
                    maxHeight: 'calc(100dvh - 24px)',
                    overflowX: 'hidden', overflowY: 'auto',
                    borderRadius: 28, border: '1px solid #DCE8F5',
                    background: '#FFFFFF', padding: 22,
                    boxShadow: '0 28px 80px rgba(15,45,85,0.20)',
                    boxSizing: 'border-box',
                }}
            >
                {/* HEADER */}
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                    <span style={{
                        display: 'inline-block', fontSize: 10, fontWeight: 900,
                        color: '#3B82F6', letterSpacing: '0.32em', textTransform: 'uppercase',
                        marginBottom: 6,
                    }}>
                        MATCH PROTOCOL
                    </span>
                    <h3 style={{
                        margin: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        fontSize: 19, fontWeight: 900, letterSpacing: '-0.02em',
                        color: '#0F2747',
                    }}>
                        <Trophy size={18} color="#2563EB" />
                        점수 입력
                    </h3>
                </div>

                {/* TEAM SELECTORS */}
                <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
                    marginBottom: 18,
                }}>
                    {/* TEAM 1 */}
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 16, padding: 14,
                        borderRadius: 20, border: '1px solid #E1EAF5',
                        background: '#F8FBFE',
                    }}>
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 64 }}>
                            <span style={{ width: '100%', textAlign: 'center', fontSize: 'clamp(15px, 5vw, 20px)', fontWeight: 900, lineHeight: 1.3, color: '#0F2747' }}>
                                {renderName(getPlayerName(match.playerIds[0]))}
                            </span>
                            <span style={{ width: '100%', textAlign: 'center', fontSize: 'clamp(15px, 5vw, 20px)', fontWeight: 900, lineHeight: 1.3, color: '#0F2747' }}>
                                {renderName(getPlayerName(match.playerIds[1]))}
                            </span>
                        </div>
                        <span style={{
                            margin: '6px 0 4px',
                            fontFamily: 'monospace',
                            fontSize: 56, fontWeight: 900, lineHeight: 1,
                            letterSpacing: '-0.04em', color: '#1F5FB5',
                        }}>
                            {tempScores.s1}
                        </span>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, width: '100%' }}>
                            {[0, 1, 2, 3, 4, 5, 6].map(num => {
                                const active = tempScores.s1 === num;
                                return (
                                    <button
                                        key={`s1-${num}`}
                                        onClick={() => setTempScores({ ...tempScores, s1: num })}
                                        style={{
                                            height: 44, borderRadius: 12,
                                            background: active ? '#2563EB' : '#FFFFFF',
                                            border: active ? 'none' : '1px solid #DCE8F5',
                                            color: active ? '#FFFFFF' : '#56729A',
                                            fontSize: 16, fontWeight: 900,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer',
                                            boxShadow: active ? '0 6px 14px rgba(37,99,235,0.26)' : 'none',
                                            transition: 'all 0.12s',
                                        }}
                                    >
                                        {num}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* TEAM 2 */}
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 16, padding: 14,
                        borderRadius: 20, border: '1px solid #E1EAF5',
                        background: '#F8FBFE',
                    }}>
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 64 }}>
                            <span style={{ width: '100%', textAlign: 'center', fontSize: 'clamp(15px, 5vw, 20px)', fontWeight: 900, lineHeight: 1.3, color: '#0F2747' }}>
                                {renderName(getPlayerName(match.playerIds[2]))}
                            </span>
                            <span style={{ width: '100%', textAlign: 'center', fontSize: 'clamp(15px, 5vw, 20px)', fontWeight: 900, lineHeight: 1.3, color: '#0F2747' }}>
                                {renderName(getPlayerName(match.playerIds[3]))}
                            </span>
                        </div>
                        <span style={{
                            margin: '6px 0 4px',
                            fontFamily: 'monospace',
                            fontSize: 56, fontWeight: 900, lineHeight: 1,
                            letterSpacing: '-0.04em', color: '#1F5FB5',
                        }}>
                            {tempScores.s2}
                        </span>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, width: '100%' }}>
                            {[0, 1, 2, 3, 4, 5, 6].map(num => {
                                const active = tempScores.s2 === num;
                                return (
                                    <button
                                        key={`s2-${num}`}
                                        onClick={() => setTempScores({ ...tempScores, s2: num })}
                                        style={{
                                            height: 44, borderRadius: 12,
                                            background: active ? '#2563EB' : '#FFFFFF',
                                            border: active ? 'none' : '1px solid #DCE8F5',
                                            color: active ? '#FFFFFF' : '#56729A',
                                            fontSize: 16, fontWeight: 900,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer',
                                            boxShadow: active ? '0 6px 14px rgba(37,99,235,0.26)' : 'none',
                                            transition: 'all 0.12s',
                                        }}
                                    >
                                        {num}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* CTAs */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button
                        onClick={() => onSave(match.id, tempScores.s1, tempScores.s2)}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                            width: '100%', height: 56,
                            borderRadius: 16,
                            background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                            color: '#FFFFFF',
                            border: 'none',
                            fontSize: 14.5, fontWeight: 900, letterSpacing: '0.02em',
                            boxShadow: '0 14px 28px rgba(37,99,235,0.26)',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                    >
                        저장하고 경기 완료
                        <Trophy size={17} color="#FFFFFF" />
                    </button>
                    <button
                        onClick={onCancel}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '100%', height: 44,
                            borderRadius: 14,
                            background: '#FFFFFF', border: '1px solid #DCE8F5',
                            color: '#3B5A85',
                            fontSize: 12.5, fontWeight: 800,
                            cursor: 'pointer',
                        }}
                    >
                        취소
                    </button>
                </div>
            </div>
        </div>
    );
};
