'use client';

import React from 'react';
import { RotateCw, CheckCircle2, Trophy, Layers } from 'lucide-react';
import { Match } from '@/lib/tournament_types';
import PlayerNameTag from './PlayerNameTag';

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
    // A조: Blue / B조: Amber — 현장에서 즉시 구분되도록 대비 강화 (Cool Light 톤 유지, 네온 지양).
    return {
        normalizedGroup,
        isGroupB,
        label: isGroupB ? 'B조' : 'A조',
        shortLabel: isGroupB ? 'B' : 'A',
        accentColor: isGroupB ? '#C2710C' : '#2563EB',
        softBg: isGroupB ? '#FFF4E2' : '#EEF6FF',       // 카드 전체 배경(soft amber / soft blue)
        softBorder: isGroupB ? '#F2C77F' : '#B9D5F5',   // 강화된 테두리 — A/B 현장 즉시 구분
        headerBg: isGroupB ? '#FFE8C2' : '#E5F1FF',     // 카드 배경보다 약간 진한 헤더 톤
    };
};

// 선수명 렌더 — 공통 PlayerNameTag 사용(이름 한 줄 + (G) 배지 분리 + 길이별 폰트 축소).
//   기존 PlayerNameRow 시그니처({name, fontSize})를 유지해 호출부를 그대로 둔다.
//   fontSize 는 "이름 4자 이하" 기준 base 폰트로 전달된다.
const PlayerNameRow = ({ name, fontSize = 16 }: { name: string; fontSize?: number }) => (
    <PlayerNameTag name={name} baseSize={fontSize} weight={800} live />
);

// 경기 경과 시간 포맷 — 60분 미만 MM:SS, 60분 이상 H:MM:SS. 미래/파싱 실패는 표시하지 않음.
const formatMatchElapsed = (startedAt: string, nowMs: number): string | null => {
    const start = new Date(startedAt).getTime();
    if (!Number.isFinite(start)) return null;
    const totalSec = Math.max(0, Math.floor((nowMs - start) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// NOW PLAYING 경기 타이머 — source of truth 는 DB matches.started_at(서버 now() 저장).
//   1초 interval 재렌더를 이 작은 컴포넌트 안에 가둬 운영 페이지 전체 재렌더를 유발하지 않는다.
//   경과는 매 tick 절대 시각(Date.now - started_at)으로 재계산하므로 백그라운드/화면 잠금 복귀
//   직후에도 누적 오차 없이 정확하다(visibilitychange 시 즉시 1회 보정).
const MatchTimer = ({ startedAt, color }: { startedAt: string; color: string }) => {
    const [nowMs, setNowMs] = React.useState(() => Date.now());
    React.useEffect(() => {
        const tick = () => setNowMs(Date.now());
        tick();
        const timer = setInterval(tick, 1000);
        const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [startedAt]);

    const label = formatMatchElapsed(startedAt, nowMs);
    if (label == null) return null;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '1px 9px', borderRadius: 999,
            background: '#FFFFFF', border: '1px solid #DCE8F5',
            color,
            fontSize: 12, fontWeight: 900, letterSpacing: '0.06em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
        }}>
            ⏱ {label}
        </span>
    );
};

// 1. 진행 중인 경기 카드 (NOW PLAYING)
export const PlayingMatchCard = ({
    match,
    onInputScore,
    getPlayerName,
    isAdmin = false,
    onCancel,
    spinningMatchId,
    matchNo,
    showToast,
    toastMsg,
    onStartTimer,
    timerPending = false,
}: CardProps & {
    onInputScore: (id: string, s1: number, s2: number) => void;
    isAdmin?: boolean;
    onCancel?: (id: string) => void;
    spinningMatchId?: string | null;
    matchNo?: number;
    showToast?: boolean;
    toastMsg?: string;
    /** 경기 타이머 "시작" 핸들러 — 전달된 화면(KDK)에서만 타이머 UI 노출. /special 미전달 → 무변화. */
    onStartTimer?: (id: string) => void;
    timerPending?: boolean;
}) => {
    const groupMeta = getGroupPresentation(match.groupName || (match as any).group);
    const { normalizedGroup, accentColor, softBg, softBorder, headerBg } = groupMeta;

    return (
        <div
            style={{
                position: 'relative',
                display: 'flex', flexDirection: 'column', height: '100%',
                borderRadius: 18,
                // 카드 전체를 조별 soft 톤으로 채워 A(blue)/B(amber)를 즉시 구분. 테두리도 강화 톤.
                background: softBg,
                border: `1px solid ${softBorder}`,
                boxShadow: '0 10px 24px rgba(15,45,85,0.06)',
                overflow: 'hidden',
            }}
        >
            {/* SECTION HEADER BAR — 카드 배경보다 약간 진한 헤더 톤 + accent 텍스트 */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '8px 12px',
                background: headerBg, borderBottom: `1px solid ${softBorder}`,
                position: 'relative',
            }}>
                <span style={{
                    fontSize: 10, fontWeight: 900, letterSpacing: '0.18em',
                    textTransform: 'uppercase', color: accentColor,
                    fontFamily: 'monospace',
                }}>
                    ROUND {match.round || 1} · {normalizedGroup}조 · {Math.max(1, matchNo || 1)}경기
                </span>

                {isAdmin && onCancel && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (window.navigator?.vibrate) window.navigator.vibrate(50);
                            onCancel(match.id);
                        }}
                        title="대기열로 복귀"
                        style={{
                            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            minWidth: 56, height: 26, padding: '0 8px',
                            borderRadius: 999,
                            background: '#FFFFFF', border: '1px solid #DCE8F5',
                            color: '#3B5A85',
                            fontSize: 10, fontWeight: 900, letterSpacing: '0.06em',
                            cursor: 'pointer',
                            boxShadow: '0 2px 6px rgba(15,45,85,0.06)',
                        }}
                    >
                        <RotateCw size={11} />
                        복귀
                    </button>
                )}
            </div>

            {/* 경기 타이머 상태 줄 — 헤더 바로 아래 붙는 "얇은 상태 줄"(하단 hairline 으로 상단 블록에 앵커).
                시작 전 "시작 대기"(+운영자 시작 버튼) / 시작 후 ⏱ 경과 시간. 두 상태 모두 고정 높이(28px)
                같은 기준선에서 전환돼 카드 높이가 흔들리지 않는다.
                onStartTimer 미전달 + started_at 없음(/special 등)이면 줄 자체를 렌더하지 않는다. */}
            {(match.startedAt || onStartTimer) && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    height: 24, padding: '0 10px', minWidth: 0,
                    borderBottom: `1px solid ${softBorder}`,
                }}>
                    {match.startedAt ? (
                        <MatchTimer startedAt={match.startedAt} color="#0F2747" />
                    ) : (
                        <>
                            <span style={{
                                fontSize: 10, fontWeight: 900, letterSpacing: '0.14em',
                                textTransform: 'uppercase', color: '#7A93B3',
                                whiteSpace: 'nowrap',
                            }}>
                                시작 대기
                            </span>
                            {isAdmin && onStartTimer && (
                                <button
                                    type="button"
                                    disabled={timerPending}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (window.navigator?.vibrate) window.navigator.vibrate(50);
                                        onStartTimer(match.id);
                                    }}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        height: 20, padding: '0 10px',
                                        borderRadius: 999,
                                        background: timerPending ? '#E7F5F0' : '#EAFBF4',
                                        border: '1px solid #9BDFC6',
                                        color: timerPending ? '#7FAF9F' : '#0E8A63',
                                        fontSize: 10.5, fontWeight: 900, letterSpacing: '0.08em',
                                        whiteSpace: 'nowrap',
                                        cursor: timerPending ? 'not-allowed' : 'pointer',
                                        boxShadow: timerPending ? 'none' : '0 2px 6px rgba(14,138,99,0.14)',
                                    }}
                                >
                                    ▶ {timerPending ? '...' : '시작'}
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, padding: '14px 3px' }}>
                <div style={{
                    display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
                    alignItems: 'center', gap: 2,
                }}>
                    {/* TEAM A */}
                    <div style={{
                        minHeight: 68,
                        borderRadius: 14,
                        background: '#F8FBFE', border: '1px solid #E1EAF5',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        padding: '4px 3px', minWidth: 0,
                    }}>
                        <div style={{ width: '100%', textAlign: 'center', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                            <PlayerNameRow name={getPlayerName(match.playerIds[0], match.id)} fontSize={16} />
                        </div>
                        <div style={{ width: '100%', textAlign: 'center', overflow: 'hidden', display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                            <PlayerNameRow name={getPlayerName(match.playerIds[1], match.id)} fontSize={16} />
                        </div>
                    </div>

                    <span style={{
                        flexShrink: 0,
                        fontSize: 8, fontWeight: 900, textTransform: 'uppercase',
                        color: accentColor, padding: '1px 2px',
                        borderRadius: 999, border: `1px solid ${softBorder}`,
                    }}>VS</span>

                    {/* TEAM B */}
                    <div style={{
                        minHeight: 68,
                        borderRadius: 14,
                        background: '#F8FBFE', border: '1px solid #E1EAF5',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        padding: '4px 3px', minWidth: 0,
                    }}>
                        <div style={{ width: '100%', textAlign: 'center', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                            <PlayerNameRow name={getPlayerName(match.playerIds[2], match.id)} fontSize={16} />
                        </div>
                        <div style={{ width: '100%', textAlign: 'center', overflow: 'hidden', display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                            <PlayerNameRow name={getPlayerName(match.playerIds[3], match.id)} fontSize={16} />
                        </div>
                    </div>
                </div>

                {/* SCORE INPUT BUTTON */}
                <button
                    onClick={() => {
                        if (window.navigator?.vibrate) window.navigator.vibrate(50);
                        onInputScore(match.id, match.score1 ?? 1, match.score2 ?? 1);
                    }}
                    style={{
                        width: '100%', height: 44, marginTop: 12, flexShrink: 0,
                        borderRadius: 14,
                        background: 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                        color: '#FFFFFF',
                        border: 'none',
                        fontSize: 12.5, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        cursor: 'pointer',
                        boxShadow: '0 10px 22px rgba(37,99,235,0.22)',
                        transition: 'all 0.15s',
                    }}
                >
                    점수 입력
                    <Trophy size={14} color="#FFFFFF" />
                </button>
            </div>

            {/* Scoped Toast Indicator (logic preserved) */}
            {showToast && toastMsg && (
                <div style={{
                    position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 2000, width: '90%',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        background: '#FFFFFF', border: '1px solid #DCE8F5',
                        color: '#0F2747',
                        padding: '8px 14px', borderRadius: 12,
                        boxShadow: '0 8px 20px rgba(15,45,85,0.12)',
                        backdropFilter: 'blur(6px)',
                    }}>
                        <CheckCircle2 size={11} color={toastMsg.includes('관리자') ? '#EF4444' : '#16A085'} />
                        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                            {toastMsg}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

// 2. 대기 경기 카드 (WAITING) — 투입 버튼 구조 반드시 유지
export const WaitingMatchCard = ({
    match,
    index,
    onStart,
    getPlayerName,
    matchNo,
    isAdmin = false,
    isStartingMatch = false,
    hasConflict = false,
}: CardProps & {
    index: number;
    onStart: (id: string) => void;
    matchNo?: number;
    isAdmin?: boolean;
    isStartingMatch?: boolean;
    hasConflict?: boolean;
}) => {
    const groupMeta = getGroupPresentation(match.groupName || (match as any).group);
    const { normalizedGroup, accentColor, softBg, softBorder } = groupMeta;
    const displayIndex = matchNo || index + 1;
    const disabled = isStartingMatch || hasConflict;

    return (
        <div
            key={match.id}
            style={{
                position: 'relative',
                display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 80px',
                alignItems: 'center', gap: 10,
                padding: '12px 12px',
                borderRadius: 16,
                background: '#FFFFFF', border: `1px solid ${softBorder}`,
                boxShadow: '0 6px 16px rgba(15,45,85,0.05)',
            }}
        >
            {/* Col 1: Group + index badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: softBg, border: `1px solid ${softBorder}`,
                    color: accentColor,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                }}>
                    <span style={{ fontSize: 8, fontWeight: 900, lineHeight: 1, opacity: 0.7, color: accentColor }}>R{match.round || 1}</span>
                    <span style={{ fontSize: 12, fontWeight: 900, lineHeight: 1, color: accentColor }}>
                        {normalizedGroup}{Math.max(1, displayIndex)}
                    </span>
                </div>
            </div>

            {/* Col 2: Players — 팀별 2-line 세로 배치 (게스트 페어도 잘리지 않음) */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
                alignItems: 'center', gap: 8,
                minWidth: 0,
            }}>
                <div style={{
                    minWidth: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 3,
                }}>
                    <PlayerNameRow name={getPlayerName(match.playerIds[0], match.id)} fontSize={16} />
                    <PlayerNameRow name={getPlayerName(match.playerIds[1], match.id)} fontSize={16} />
                </div>
                <span style={{
                    flexShrink: 0, padding: '2px 6px',
                    fontSize: 9, fontWeight: 900,
                    color: accentColor,
                    borderRadius: 999, border: `1px solid ${softBorder}`,
                }}>VS</span>
                <div style={{
                    minWidth: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 3,
                }}>
                    <PlayerNameRow name={getPlayerName(match.playerIds[2], match.id)} fontSize={16} />
                    <PlayerNameRow name={getPlayerName(match.playerIds[3], match.id)} fontSize={16} />
                </div>
            </div>

            {/* Col 3: 진행중 badge (충돌 시) + 투입/대기 버튼 */}
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                gap: 6, alignSelf: 'stretch', justifyContent: 'center',
            }}>
                {hasConflict && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        borderRadius: 999, padding: '2px 7px',
                        background: '#FFF4DE', border: '1px solid #F4C979',
                        color: '#B7791F',
                        fontSize: 9, fontWeight: 900, lineHeight: 1,
                        letterSpacing: '0.04em', whiteSpace: 'nowrap',
                    }}>
                        진행중
                    </span>
                )}
                <button
                    onClick={() => {
                        if (window.navigator?.vibrate) window.navigator.vibrate(50);
                        onStart(match.id);
                    }}
                    disabled={disabled}
                    style={{
                        padding: '8px 12px',
                        borderRadius: 12,
                        background: disabled ? '#E1EAF5' : 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                        color: disabled ? '#9CB2CC' : '#FFFFFF',
                        border: 'none',
                        fontSize: 11.5, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        boxShadow: disabled ? 'none' : '0 8px 18px rgba(37,99,235,0.22)',
                        transition: 'all 0.15s',
                        width: '100%',
                    }}
                >
                    {isStartingMatch ? '...' : hasConflict ? '대기중' : (isAdmin ? '투입' : '대기')}
                </button>
            </div>
        </div>
    );
};

// 3. 완료 경기 카드 (COMPLETED)
export const CompletedMatchCard = ({
    match,
    index,
    onEdit,
    getPlayerName,
    matchNo,
    isAdmin = false,
    onResetStatus,
}: CardProps & {
    index: number;
    onEdit: (m: Match) => void;
    matchNo?: number;
    isAdmin?: boolean;
    onResetStatus?: (id: string) => void;
}) => {
    const { normalizedGroup, accentColor, softBg, softBorder } = getGroupPresentation(match.groupName || (match as any).group);
    const displayIndex = matchNo || index + 1;

    return (
        <div
            key={match.id}
            onClick={() => {
                if (window.navigator?.vibrate) window.navigator.vibrate(50);
                onEdit(match);
            }}
            style={{
                position: 'relative',
                display: 'flex', flexDirection: 'column', minHeight: '100%',
                borderRadius: 18,
                background: softBg, border: `1px solid ${softBorder}`,
                cursor: 'pointer',
                overflow: 'hidden',
            }}
        >
            {/* 상단 accent line — A조 Blue / B조 Amber 즉시 구분 */}
            <div style={{ height: 3, background: accentColor }} />
            {/* HEADER BAR */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '6px 12px',
                background: softBg, borderBottom: `1px solid ${softBorder}`,
                position: 'relative',
            }}>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 10, fontWeight: 900, letterSpacing: '0.16em',
                    textTransform: 'uppercase', color: accentColor,
                    fontFamily: 'monospace',
                }}>
                    <span style={{
                        padding: '1px 6px', borderRadius: 999,
                        background: '#FFFFFF', border: `1px solid ${softBorder}`,
                        letterSpacing: '0.02em',
                    }}>{normalizedGroup}조</span>
                    MATCH {displayIndex.toString().padStart(2, '0')}
                </span>
                {isAdmin && onResetStatus && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onResetStatus(match.id);
                        }}
                        title="경기 다시 진행"
                        style={{
                            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                            width: 26, height: 26, borderRadius: 8,
                            background: 'transparent', border: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: accentColor, cursor: 'pointer',
                        }}
                    >
                        <RotateCw size={12} />
                    </button>
                )}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '14px 12px' }}>
                <div style={{
                    display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
                    alignItems: 'center', gap: 8,
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, gap: 2 }}>
                        <PlayerNameRow name={getPlayerName(match.playerIds[0], match.id)} fontSize={14} />
                        <PlayerNameRow name={getPlayerName(match.playerIds[1], match.id)} fontSize={14} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, padding: '0 4px' }}>
                        <span style={{
                            fontSize: 26, fontWeight: 900, lineHeight: 1,
                            letterSpacing: '0.04em', color: '#1F5FB5',
                        }}>
                            {match.score1}:{match.score2}
                        </span>
                        <span style={{
                            marginTop: 4, fontSize: 8, fontWeight: 900,
                            color: '#9CB2CC', letterSpacing: '0.22em', textTransform: 'uppercase',
                        }}>
                            FINAL
                        </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, gap: 2 }}>
                        <PlayerNameRow name={getPlayerName(match.playerIds[2], match.id)} fontSize={14} />
                        <PlayerNameRow name={getPlayerName(match.playerIds[3], match.id)} fontSize={14} />
                    </div>
                </div>
            </div>
            <div style={{ padding: '0 0 10px', textAlign: 'center' }}>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 9, fontWeight: 900,
                    color: '#7A93B3', letterSpacing: '0.3em', textTransform: 'uppercase',
                }}>
                    TAP TO EDIT
                    <Layers size={10} />
                </span>
            </div>
        </div>
    );
};
