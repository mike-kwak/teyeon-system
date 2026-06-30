'use client';

import React, { useState, useEffect, useRef } from 'react';
import RankingRow from './tournament/RankingRow';
import { InitialAvatar } from './tournament/InitialAvatar';
import PlayerNameTag from './tournament/PlayerNameTag';

import { Match, RankedPlayer } from '@/lib/tournament_types';

interface RankingTabProps {
    players: RankedPlayer[];
    sessionTitle?: string;
    isArchive?: boolean;
    isAdmin?: boolean;
    prizes?: { first: number, l1: number, l2: number };
    onShareMatch?: () => void;
    onShareResult?: () => void;
    onFinalize?: () => void;
    isGenerating?: boolean;
    ceremonyMode?: boolean;
    snapshot_data?: any[];
    detailedResults?: PlayerDetailedResult[];
    matches?: Match[];
}

interface PlayerDetailedResult {
    id: string;
    rank: number;
    name: string;
    group: string;
    wins: number;
    losses: number;
    pointsForByMatch: number[];
    pointsAgainstByMatch: number[];
    pointsForTotal: number;
    pointsAgainstTotal: number;
    diff: number;
}

export default function RankingTab({ 
    players, 
    sessionTitle, 
    isArchive = false, 
    isAdmin = false,
    prizes = { first: 10000, l1: 3000, l2: 5000 },
    onShareMatch,
    onShareResult,
    onFinalize,
    isGenerating,
    ceremonyMode = false,
    snapshot_data = [],
    detailedResults = [],
    matches = []
}: RankingTabProps) {
    const [sortKey, setSortKey] = useState<string>('rk');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [activeRankingTab, setActiveRankingTab] = useState<'ALL' | 'A' | 'B'>('ALL');
    const [detailExportStatus, setDetailExportStatus] = useState('');
    const [tableExportStatus, setTableExportStatus] = useState('');
    const detailCaptureRef = useRef<HTMLDivElement | null>(null);
    
    // Safety guard for players array
    const playersList = players || [];

    const uniqueGroups = Array.from(new Set(playersList.map((p) => p.group).filter(Boolean)));
    const showTabs = uniqueGroups.length > 1;

    const [showConfetti, setShowConfetti] = useState(false);
    useEffect(() => {
        if (ceremonyMode) {
            setShowConfetti(true);
            const timer = setTimeout(() => setShowConfetti(false), 5000);
            return () => clearTimeout(timer);
        }
    }, [ceremonyMode]);

    const guestFee = 10000;
    const guestFeeLabel = `게스트 ${guestFee.toLocaleString()}`;
    const finalImageLabels = {
        personalDetail: '\uAC1C\uC778\uBCC4 \uC0C1\uC138\uD45C',
        finalOverallButton: '\uCD5C\uC885 \uC804\uCCB4',
        finalGroupsButton: '\uC870\uBCC4 \uACB0\uACFC',
        fullSchedule: '\uC804\uCCB4 \uB300\uC9C4\uD45C',
        matchResults: '\uACBD\uAE30 \uACB0\uACFC\uD45C',
        overallTitle: '\uC624\uB298\uC758 \uCD5C\uC885 \uACB0\uACFC - \uC804\uCCB4 \uC21C\uC704',
        groupsTitle: '\uC870\uBCC4 \uCD5C\uC885 \uACB0\uACFC',
        overallSection: '\uC804\uCCB4 \uCD5C\uC885 \uC21C\uC704',
        groupASection: 'A\uC870 \uC21C\uC704',
        groupBSection: 'B\uC870 \uC21C\uC704',
        prizeLine: '\uC0C1\uAE08/\uBC8C\uAE08',
        rankSuffix: '\uC704',
        win: '\uC2B9',
        loss: '\uD328',
        won: '\uC6D0',
        archiveNote: '\uC0C1\uC138 \uACB0\uACFC\uB294 Archive\uC5D0\uC11C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
    };
    const reportColors = {
        page: '#ffffff',
        border: '#cbd5e1',
        borderStrong: '#94a3b8',
        header: '#e5e7eb',
        headerAlt: '#eef2f7',
        row: '#ffffff',
        rowAlt: '#f8fafc',
        text: '#111827',
        muted: '#4b5563',
        goldBg: '#fef3c7',
        goldText: '#92400e',
        blueBg: '#e0f2fe',
        blueText: '#0369a1',
        penaltyBg: '#fff1f2',
        penaltyText: '#dc2626',
        plusText: '#047857',
    };
    const isGuestRankedPlayer = (player: any) => {
        const id = String(player?.id || '');
        const name = String(player?.name || '');
        return player?.is_guest === true
            || player?.isGuest === true
            || /^manual-guest-/i.test(id)
            || /^g-/i.test(id)
            || /^manual-guest-/i.test(name)
            || /\s*\(G\)$/i.test(name)
            || /\s+g$/i.test(name);
    };

    // Associate members who attend like a regular member (no (G) marker, no PEN signal)
    // but still owe the guest fee every session. The fee is added to settlement amount;
    // it does NOT mark them as guest for display purposes nor strip the 1st-place award.
    const ASSOCIATE_GUEST_FEE_NAMES: ReadonlySet<string> = new Set(['차형원']);
    const isAssociateGuestFeeMember = (player: any) => {
        const candidates = [player?.name, player?.nickname, player?.displayName]
            .map((v) => String(v || '').replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').replace(/\s+/g, '').trim())
            .filter((v) => v.length > 0);
        return candidates.some((c) => ASSOCIATE_GUEST_FEE_NAMES.has(c));
    };

    const calculateSettlement = (p: any, idx: number, total: number) => {
        let amount = 0;
        const bottomHalfCount = Math.ceil(total / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const isPenaltyTier = idx >= (total - penaltyCount);
        const isFineTier = !isPenaltyTier && idx >= (total - bottomHalfCount);
        const isGuest = isGuestRankedPlayer(p);
        // Associate members aren't displayed as guests, but their fee is folded into settlement.
        const owesGuestFee = isGuest || isAssociateGuestFeeMember(p);

        let performancePenalty = 0;
        if (idx === 0 && !isGuest) {
            performancePenalty = prizes.first || 10000;
        } else if (isPenaltyTier) {
            performancePenalty = -(prizes.l2 || 5000);
        } else if (isFineTier) {
            performancePenalty = -(prizes.l1 || 3000);
        }

        amount = performancePenalty - (owesGuestFee ? guestFee : 0);

        return { amount, isPenaltyTier, isFineTier };
    };

    const unknownPlayerLabel = '\uBBF8\uD655\uC778';
    const genericGuestLabel = '\uAC8C\uC2A4\uD2B8';

    const isGenericGuestLabel = (value?: string) => {
        const normalized = String(value || '')
            .trim()
            .replace(/\s*\(G\)$/i, '')
            .replace(/\s+g$/i, '')
            .trim();
        return normalized.toLowerCase() === 'guest' || normalized === genericGuestLabel;
    };

    const formatKDKPlayerName = (value?: string) => {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';
        if (/^manual-guest-/i.test(trimmed)) {
            const guestName = trimmed.replace(/^manual-guest-/i, '').replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').trim();
            return guestName && !isGenericGuestLabel(guestName) ? `${guestName}(G)` : '';
        }
        if (/^g-\d+/i.test(trimmed)) {
            return '게스트(G)';
        }
        if (/\s+g$/i.test(trimmed)) {
            const guestName = trimmed.replace(/\s+g$/i, '').trim();
            return guestName && !isGenericGuestLabel(guestName) ? `${guestName}(G)` : '';
        }
        const normalized = trimmed.replace(/\s*\(G\)$/i, '(G)');
        return isGenericGuestLabel(normalized) ? '' : normalized;
    };

    const isLikelyKDKId = (value?: string) => {
        const raw = String(value || '').trim();
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
            || /^[a-z0-9-]{18,}$/i.test(raw);
    };

    const resolveKDKPlayerDisplayName = (name?: string, id?: string) => {
        const nameCandidate = formatKDKPlayerName(name);
        if (nameCandidate && !isLikelyKDKId(nameCandidate)) return nameCandidate;

        const idCandidate = formatKDKPlayerName(id);
        if (idCandidate && !isLikelyKDKId(idCandidate)) return idCandidate;

        return unknownPlayerLabel;
    };

    const generatePlayerList = (filterGroup?: string) => {
        return playersList.filter((p) => !filterGroup || p.group === filterGroup);
    };

    const getSortedPlayers = (pList: any[]) => {
        const sorted = [...(pList || [])].map((p, i) => ({ ...p, rk: i + 1 }));
        return sorted.sort((a, b) => {
            let valA = a[sortKey];
            let valB = b[sortKey];
            if (sortKey === 'rk') { valA = a.rk; valB = b.rk; }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const RankingTable = ({ players: tablePlayers, title }: { players: RankedPlayer[], title: string }) => {
        // [v34.0] Since useRanking hook now handles deterministic sorting and trends,
        // we simply map the ranks based on the provided array order.
        const sorted = tablePlayers.map((p, i) => ({ ...p, name: resolveKDKPlayerDisplayName(p.name, p.id), rk: i + 1 }));
        const top3 = sorted.slice(0, 3);
        const others = sorted.slice(3);

        return (
            <section className="flex flex-col">
                <div className="relative mt-24 mb-0">
                    <div className="flex items-end justify-center gap-2 w-full px-2 max-w-2xl mx-auto relative z-10 overflow-visible">
                        {[1, 0, 2].map((idx) => {
                            const p = top3[idx];
                            if (!p) return <div key={idx} className={`${idx === 0 ? 'w-[40%]' : 'w-[28%]'} h-2`} />;
                            const isFirst = idx === 0;
                            const isSecond = idx === 1;
                            const widthClass = isFirst ? 'w-[45%]' : 'w-[28%]';
                            
                            return (
                                <div
                                    key={p.id}
                                    className={`relative ${widthClass} transition-all duration-700 flex flex-col justify-end`}
                                >
                                    <div
                                        className="flex w-full flex-col items-center pt-6 pb-6 relative"
                                        style={{
                                            borderRadius: 28,
                                            background: '#FFFFFF',
                                            border: isFirst ? '2px solid #F4C979' : '1px solid #DCE8F5',
                                            boxShadow: isFirst
                                                ? '0 14px 32px rgba(244,201,121,0.20), 0 4px 12px rgba(15,45,85,0.06)'
                                                : '0 10px 24px rgba(15,45,85,0.06)',
                                        }}
                                    >
                                        <div className="relative mb-5">
                                            {p.avatar ? (
                                                <div
                                                    className="flex items-center justify-center rounded-full overflow-hidden"
                                                    style={{
                                                        width: isFirst ? 80 : 64,
                                                        height: isFirst ? 80 : 64,
                                                        background: isFirst ? '#FFF8E6' : '#F6FAFD',
                                                        border: isFirst ? '2px solid #F4C979' : '1px solid #DCE8F5',
                                                    }}
                                                >
                                                    <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                                                </div>
                                            ) : (
                                                <InitialAvatar
                                                    name={p.name}
                                                    size={isFirst ? 80 : 64}
                                                    fontSize={isFirst ? 28 : 22}
                                                />
                                            )}
                                            <div
                                                className="absolute -bottom-1 -right-1 flex items-center justify-center text-base"
                                                style={{
                                                    width: 28, height: 28, borderRadius: '50%',
                                                    background: '#FFFFFF',
                                                    border: '1px solid #DCE8F5',
                                                    boxShadow: '0 4px 10px rgba(15,45,85,0.08)',
                                                }}
                                            >
                                                {isFirst ? '🏆' : (idx === 1 ? '🥈' : '🥉')}
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-center gap-2 w-full px-3 relative z-10">
                                            <div className="w-full">
                                                <PlayerNameTag
                                                    name={p.name}
                                                    isGuest={isGuestRankedPlayer(p)}
                                                    baseSize={isFirst ? 24 : 16}
                                                    weight={900}
                                                />
                                            </div>

                                            <div
                                                className="flex items-center justify-center gap-2"
                                                style={{ fontSize: 11, fontWeight: 900 }}
                                            >
                                                <span style={{ color: '#0F2747' }}>{p.wins}<span style={{ color: '#56729A', marginLeft: 2 }}>승</span></span>
                                                <span style={{ color: '#0F2747' }}>{p.losses}<span style={{ color: '#56729A', marginLeft: 2 }}>패</span></span>
                                                <span style={{ color: '#C7DCF1' }}>/</span>
                                                <span style={{ color: p.diff > 0 ? '#16A085' : p.diff < 0 ? '#C0392B' : '#56729A' }}>
                                                    {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                </span>
                                            </div>

                                            {isFirst && (
                                                <div
                                                    className="mt-4 inline-flex items-center"
                                                    style={{
                                                        padding: '5px 14px', borderRadius: 999,
                                                        background: '#FFF4DE', border: '1px solid #F4C979',
                                                    }}
                                                >
                                                    <span style={{ color: '#B7791F', fontSize: 11, fontWeight: 900, letterSpacing: '0.06em' }}>
                                                        상금 ₩{(prizes.first || 10000).toLocaleString()}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="h-6" aria-hidden="true" />

                <div className="flex-1 space-y-2 px-4 mb-32 relative z-0">
                    <div
                        className="grid gap-1 px-4 pb-3 mb-2"
                        style={{
                            gridTemplateColumns: '2rem 2.2rem 1fr 1.5rem 1.5rem 1.5rem 1.7rem 1.7rem 2rem 5.2rem',
                            borderBottom: '1px solid #DCE8F5',
                            fontSize: 10, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase',
                            color: '#7A93B3',
                        }}
                    >
                        <span className="text-center">#</span>
                        <span className="text-center" style={{ opacity: 0 }}>IMG</span>
                        <span className="text-left pl-2">선수</span>
                        <span className="text-right">P</span>
                        <span className="text-right" style={{ color: '#1F5FB5' }}>W</span>
                        <span className="text-right">L</span>
                        <span className="text-right">PF</span>
                        <span className="text-right">PA</span>
                        <span className="text-right" style={{ color: '#1F5FB5' }}>+/-</span>
                        <span className="text-center" style={{ color: '#B7791F' }}>벌금</span>
                    </div>
                    {others.map((p, i) => {
                        const localRank = i + 4;
                        const originalIdx = players.findIndex((x) => x.id === p.id);
                        const { amount } = calculateSettlement(p, originalIdx, players.length);
                        return (
                            <RankingRow 
                                key={p.id}
                                player={p}
                                rank={localRank}
                                amount={amount}
                            />
                        );
                    })}
                </div>
            </section>
        );
    };

    const activeDetailedResults = (activeRankingTab === 'ALL'
        ? detailedResults
        : detailedResults.filter((row) => row.group === activeRankingTab)
    ).map((row, index) => ({ ...row, name: resolveKDKPlayerDisplayName(row.name, row.id), displayRank: index + 1 }));
    const maxDetailGameCount = Math.max(
        0,
        ...activeDetailedResults.map((row) => Math.max(row.pointsForByMatch.length, row.pointsAgainstByMatch.length))
    );
    const detailGameColumns = Array.from({ length: maxDetailGameCount }, (_, index) => index);

    const DetailScoreCells = ({ values }: { values: number[] }) => (
        <>
            {detailGameColumns.map((columnIndex) => (
                <td
                    key={columnIndex}
                    className="px-3 py-3 text-center"
                    style={{
                        borderRight: '1px solid #E1EAF5',
                        fontWeight: 700,
                        color: values[columnIndex] !== undefined ? '#3F5B82' : '#9CB2CC',
                    }}
                >
                    {values[columnIndex] ?? '-'}
                </td>
            ))}
        </>
    );

    const getDetailExportFileName = () => {
        const safeSessionTitle = (sessionTitle || 'KDK_DETAIL_RESULTS')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_');
        return `${safeSessionTitle}_PERSONAL_DETAIL.png`;
    };

    const getRankedPlayerNameById = (playerId?: string) => {
        if (!playerId) return '';
        const found = playersList.find((player) => player.id === playerId);
        return formatKDKPlayerName(found?.name);
    };

    const normalizeKDKGroup = (value?: string) => {
        const raw = String(value || '').trim().toUpperCase();
        if (raw.includes('B') || raw.includes('BLUE')) return 'B';
        return 'A';
    };

    const normalizeExplicitKDKGroup = (value?: string) => {
        const raw = String(value || '').trim().toUpperCase();
        if (raw.includes('B') || raw.includes('BLUE')) return 'B';
        if (raw.includes('A') || raw.includes('GOLD')) return 'A';
        return '';
    };

    const getGroupLabel = (group?: string) => {
        return normalizeKDKGroup(group) === 'B' ? 'B조' : 'A조';
    };

    const getMatchPlayerName = (match: Match, index: number) => {
        const storedName = formatKDKPlayerName(match.playerNames?.[index] || match.player_names?.[index]);
        if (storedName) return storedName;
        const teamIndex = index < 2 ? 0 : 1;
        const teamPlayerIndex = index < 2 ? index : index - 2;
        const teamName = formatKDKPlayerName(match.teams?.[teamIndex]?.[teamPlayerIndex]);
        if (teamName) return teamName;
        return formatKDKPlayerName(match.playerIds?.[index]) || '이름 확인중';
    };

    const getSafeMatchPlayerName = (match: Match, index: number) => {
        const storedName = formatKDKPlayerName(match.playerNames?.[index] || match.player_names?.[index]);
        if (storedName && !isLikelyKDKId(storedName)) return storedName;

        const playerId = match.playerIds?.[index];
        if (/^manual-guest-/i.test(String(playerId || ''))) return formatKDKPlayerName(playerId);

        const rankedName = getRankedPlayerNameById(playerId);
        if (rankedName && !isLikelyKDKId(rankedName)) return rankedName;

        const teamIndex = index < 2 ? 0 : 1;
        const teamPlayerIndex = index < 2 ? index : index - 2;
        const teamName = formatKDKPlayerName(match.teams?.[teamIndex]?.[teamPlayerIndex]);
        if (teamName && !isLikelyKDKId(teamName)) return teamName;

        const idFallback = formatKDKPlayerName(playerId);
        if (idFallback && !isLikelyKDKId(idFallback)) return idFallback;
        return '미확인';
    };

    const getMatchTeamLabel = (match: Match, startIndex: number) => {
        return `${getSafeMatchPlayerName(match, startIndex)} / ${getSafeMatchPlayerName(match, startIndex + 1)}`;
    };

    const getMatchSortValue = (match: Match, index: number) => {
        return Number((match as any).order ?? (match as any).matchNo ?? match.court ?? index + 1) || index + 1;
    };

    const sortMatchesForExport = (source: Match[], groupFirst: boolean) => {
        const sourceIndex = new Map(source.map((match, index) => [match.id, index]));
        return [...source].sort((a, b) => {
            const aIndex = sourceIndex.get(a.id) ?? 0;
            const bIndex = sourceIndex.get(b.id) ?? 0;
            if (groupFirst) {
                const groupDiff = normalizeKDKGroup(a.groupName || a.group).localeCompare(normalizeKDKGroup(b.groupName || b.group));
                if (groupDiff !== 0) return groupDiff;
            }
            const roundDiff = (a.round || 0) - (b.round || 0);
            if (roundDiff !== 0) return roundDiff;
            if (!groupFirst) {
                const groupDiff = normalizeKDKGroup(a.groupName || a.group).localeCompare(normalizeKDKGroup(b.groupName || b.group));
                if (groupDiff !== 0) return groupDiff;
            }
            const orderDiff = getMatchSortValue(a, aIndex) - getMatchSortValue(b, bIndex);
            if (orderDiff !== 0) return orderDiff;
            return String(a.id).localeCompare(String(b.id));
        });
    };

    const sortedExportMatches = sortMatchesForExport(matches || [], false);

    const toMatchTableRow = (match: Match, index: number) => ({
        no: index + 1,
        group: getGroupLabel(match.groupName || match.group),
        groupKey: normalizeKDKGroup(match.groupName || match.group),
        round: `R${match.round || '-'}`,
        matchNo: `${getMatchSortValue(match, index)}경기`,
        teamA: getMatchTeamLabel(match, 0),
        teamB: getMatchTeamLabel(match, 2),
        score: `${match.score1 ?? 0} : ${match.score2 ?? 0}`,
    });

    const getPlayerGroupKey = (player: RankedPlayer) => {
        const playerName = formatKDKPlayerName(player.name);
        const comparableName = playerName.replace(/\s*\(G\)$/i, '').trim();
        const counts: Record<'A' | 'B', number> = { A: 0, B: 0 };
        let firstGroup = '';

        (matches || []).forEach((match) => {
            const groupKey = normalizeExplicitKDKGroup(match.groupName || match.group);
            if (!groupKey) return;
            for (let index = 0; index < 4; index += 1) {
                const matchId = String(match.playerIds?.[index] || '');
                const matchName = getSafeMatchPlayerName(match, index).replace(/\s*\(G\)$/i, '').trim();
                if (matchId === player.id || (!!comparableName && matchName === comparableName)) {
                    counts[groupKey] += 1;
                    if (!firstGroup) firstGroup = groupKey;
                }
            }
        });

        if (counts.B > counts.A) return 'B';
        if (counts.A > 0) return 'A';
        return firstGroup || normalizeKDKGroup(player.group);
    };

    type MatchTableExportKind = 'schedule' | 'results';

    const getMatchTableRows = (kind: MatchTableExportKind) => {
        if (kind === 'results') {
            const completedMatches = sortMatchesForExport((matches || []).filter((match) => match.status === 'complete'), true);
            let rowNo = 1;
            return ['A', 'B'].flatMap((groupKey) => {
                const groupMatches = completedMatches.filter((match) => normalizeKDKGroup(match.groupName || match.group) === groupKey);
                if (groupMatches.length === 0) return [];
                return [
                    {
                        isSection: true,
                        sectionLabel: `${getGroupLabel(groupKey)} 경기 결과`,
                        groupKey,
                    },
                    ...groupMatches.map((match) => ({
                        ...toMatchTableRow(match, rowNo - 1),
                        no: rowNo++,
                    })),
                ];
            });
        }

        return sortedExportMatches.map((match, index) => toMatchTableRow(match, index));
    };

    const getMatchTableExportFileName = (kind: MatchTableExportKind) => {
        const safeSessionTitle = (sessionTitle || 'KDK_MATCH_TABLE')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_');
        return `${safeSessionTitle}_${kind === 'schedule' ? 'FULL_MATCH_TABLE' : 'MATCH_RESULTS'}.png`;
    };

    const createMatchTableImageBlob = async (kind: MatchTableExportKind) => {
        const rows = getMatchTableRows(kind);
        const isResults = kind === 'results';
        const title = isResults ? finalImageLabels.matchResults : finalImageLabels.fullSchedule;
        const scale = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
        const padding = 36;
        const rowHeight = 48;
        const titleHeight = 112;
        const footerHeight = 30;
        const columns = isResults
            ? [
                { key: 'no', label: 'No', width: 54 },
                { key: 'group', label: '\uC870', width: 72 },
                { key: 'round', label: '\uB77C\uC6B4\uB4DC', width: 90 },
                { key: 'matchNo', label: '\uB300\uC9C4\uBC88\uD638', width: 88 },
                { key: 'teamA', label: '\uD3001', width: 270 },
                { key: 'score', label: '\uC810\uC218', width: 110 },
                { key: 'teamB', label: '\uD3002', width: 270 },
            ]
            : [
                { key: 'no', label: 'No', width: 54 },
                { key: 'group', label: '\uC870', width: 72 },
                { key: 'round', label: '\uB77C\uC6B4\uB4DC', width: 90 },
                { key: 'matchNo', label: '\uB300\uC9C4\uBC88\uD638', width: 88 },
                { key: 'teamA', label: '\uD3001', width: 305 },
                { key: 'teamB', label: '\uD3002', width: 305 },
            ];
        const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
        const emptyRows = rows.length === 0 ? 1 : 0;
        const width = Math.max(980, tableWidth + padding * 2);
        const height = titleHeight + rowHeight + Math.max(rows.length, emptyRows) * rowHeight + footerHeight + padding;

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext('2d')!;
        if (!ctx) throw new Error('Canvas context is unavailable.');
        ctx.scale(scale, scale);

        const drawText = (
            text: string,
            x: number,
            y: number,
            options: { size?: number; weight?: number | string; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; maxWidth?: number } = {}
        ) => {
            ctx.fillStyle = options.color || '#111827';
            ctx.font = `${options.weight || 800} ${options.size || 14}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            ctx.textAlign = options.align || 'center';
            ctx.textBaseline = options.baseline || 'middle';
            ctx.fillText(text, x, y, options.maxWidth);
        };

        const fitText = (text: string, x: number, y: number, maxWidth: number, options: { size: number; minSize?: number; weight?: number | string; color?: string; align?: CanvasTextAlign } ) => {
            let size = options.size;
            const minSize = options.minSize || 12;
            ctx.font = `${options.weight || 800} ${size}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            while (size > minSize && ctx.measureText(text).width > maxWidth) {
                size -= 1;
                ctx.font = `${options.weight || 800} ${size}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            }
            drawText(text, x, y, { ...options, size, maxWidth });
        };

        ctx.fillStyle = reportColors.page;
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = reportColors.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(padding / 2, padding / 2, width - padding, height - padding);

        drawText('TEYEON KDK', padding, 36, { align: 'left', size: 13, weight: 900, color: '#9a741c' });
        drawText(sessionTitle || 'KDK SESSION', padding, 66, { align: 'left', size: 28, weight: 900, color: reportColors.text });
        drawText(title, width - padding, 66, { align: 'right', size: 23, weight: 900, color: reportColors.text });
        drawText(new Date().toLocaleString('ko-KR'), width - padding, 96, { align: 'right', size: 12, weight: 800, color: reportColors.muted });

        const tableX = padding;
        let y = titleHeight;
        let x = tableX;
        columns.forEach((column) => {
            ctx.fillStyle = reportColors.header;
            ctx.fillRect(x, y, column.width, rowHeight);
            ctx.strokeStyle = reportColors.borderStrong;
            ctx.lineWidth = 1.3;
            ctx.strokeRect(x, y, column.width, rowHeight);
            drawText(column.label, x + column.width / 2, y + rowHeight / 2, { size: 13, weight: 900, color: '#1f2937' });
            x += column.width;
        });

        y += rowHeight;
        if (rows.length === 0) {
            ctx.fillStyle = reportColors.rowAlt;
            ctx.fillRect(tableX, y, tableWidth, rowHeight);
            ctx.strokeStyle = reportColors.border;
            ctx.strokeRect(tableX, y, tableWidth, rowHeight);
            drawText(isResults ? '완료된 경기가 없습니다' : '대진이 없습니다', tableX + tableWidth / 2, y + rowHeight / 2, { size: 16, weight: 900, color: reportColors.muted });
        } else {
            rows.forEach((row, rowIndex) => {
                if ((row as any).isSection) {
                    const sectionColor = row.groupKey === 'B' ? reportColors.blueText : reportColors.goldText;
                    ctx.fillStyle = row.groupKey === 'B' ? reportColors.blueBg : reportColors.goldBg;
                    ctx.fillRect(tableX, y, tableWidth, rowHeight);
                    ctx.strokeStyle = row.groupKey === 'B' ? '#38bdf8' : '#d97706';
                    ctx.lineWidth = 1.4;
                    ctx.strokeRect(tableX, y, tableWidth, rowHeight);
                    drawText((row as any).sectionLabel, tableX + 18, y + rowHeight / 2, { align: 'left', size: 15, weight: 900, color: sectionColor });
                    y += rowHeight;
                    return;
                }

                const rowAccent = row.groupKey === 'B' ? '#38bdf8' : '#d97706';
                ctx.fillStyle = rowIndex % 2 === 0 ? reportColors.row : reportColors.rowAlt;
                ctx.fillRect(tableX, y, tableWidth, rowHeight);
                ctx.fillStyle = rowAccent;
                ctx.fillRect(tableX, y, 6, rowHeight);
                ctx.strokeStyle = reportColors.border;
                ctx.lineWidth = 1.1;
                ctx.strokeRect(tableX, y, tableWidth, rowHeight);

                x = tableX;
                columns.forEach((column) => {
                    const value = String((row as any)[column.key] ?? '');
                    const isTeam = column.key === 'teamA' || column.key === 'teamB';
                    const isScore = column.key === 'score';
                    const color = column.key === 'group'
                        ? row.groupKey === 'B' ? reportColors.blueText : reportColors.goldText
                        : isScore ? reportColors.text : '#1f2937';
                    if (isTeam) {
                        fitText(value, x + column.width / 2, y + rowHeight / 2, column.width - 18, { size: 16, minSize: 12, weight: 900, color });
                    } else {
                        drawText(value, x + column.width / 2, y + rowHeight / 2, { size: isScore ? 18 : 14, weight: 900, color });
                    }
                    ctx.strokeStyle = reportColors.border;
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x, y, column.width, rowHeight);
                    x += column.width;
                });

                y += rowHeight;
            });
        }

        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to create match table image.'));
            }, 'image/png', 0.95);
        });
    };

    const createDetailedResultImageBlob = async () => {
        if (activeDetailedResults.length === 0 || maxDetailGameCount === 0) {
            throw new Error('No detailed result rows to export.');
        }

        const scale = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
        const padding = 36;
        const rowHeight = 48;
        const headerTopHeight = 48;
        const headerSubHeight = 38;
        const titleHeight = 96;
        const footerHeight = 28;
        const scoreColWidth = 52;
        const columns = [
            { label: '\uC21C\uC704', width: 66 },
            { label: '\uC131\uBA85', width: 150 },
            { label: finalImageLabels.win, width: 56 },
            { label: finalImageLabels.loss, width: 56 },
        ];
        const pointsWidth = maxDetailGameCount * scoreColWidth + 70;
        const tableWidth = columns.reduce((sum, column) => sum + column.width, 0) + pointsWidth + pointsWidth + 72;
        const width = Math.max(920, tableWidth + padding * 2);
        const height = titleHeight + headerTopHeight + headerSubHeight + activeDetailedResults.length * rowHeight + footerHeight + padding;

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext('2d')!;
        if (!ctx) throw new Error('Canvas context is unavailable.');
        ctx.scale(scale, scale);

        const drawText = (
            text: string,
            x: number,
            y: number,
            options: { size?: number; weight?: number | string; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; maxWidth?: number } = {}
        ) => {
            ctx.fillStyle = options.color || '#111827';
            ctx.font = `${options.weight || 800} ${options.size || 14}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            ctx.textAlign = options.align || 'center';
            ctx.textBaseline = options.baseline || 'middle';
            ctx.fillText(text, x, y, options.maxWidth);
        };

        const fitText = (text: string, x: number, y: number, maxWidth: number, options: { size: number; minSize?: number; weight?: number | string; color?: string; align?: CanvasTextAlign }) => {
            let size = options.size;
            const minSize = options.minSize || 11;
            ctx.font = `${options.weight || 800} ${size}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            while (size > minSize && ctx.measureText(text).width > maxWidth) {
                size -= 1;
                ctx.font = `${options.weight || 800} ${size}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            }
            drawText(text, x, y, { ...options, size, maxWidth });
        };

        const drawCell = (
            text: string,
            x: number,
            y: number,
            w: number,
            h: number,
            options: { bg?: string; color?: string; weight?: number | string; size?: number; align?: CanvasTextAlign; fit?: boolean } = {}
        ) => {
            ctx.fillStyle = options.bg || reportColors.row;
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = reportColors.border;
            ctx.lineWidth = 1.1;
            ctx.strokeRect(x, y, w, h);
            if (options.fit) {
                fitText(text, x + w / 2, y + h / 2, w - 12, {
                    size: options.size || 14,
                    minSize: 10,
                    weight: options.weight || 800,
                    color: options.color || reportColors.text,
                    align: options.align || 'center',
                });
            } else {
                drawText(text, x + w / 2, y + h / 2, {
                    color: options.color || reportColors.text,
                    weight: options.weight || 800,
                    size: options.size || 14,
                    align: options.align || 'center',
                });
            }
        };

        ctx.fillStyle = reportColors.page;
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = reportColors.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(padding / 2, padding / 2, width - padding, height - padding);

        drawText('TEYEON KDK', padding, 36, { align: 'left', size: 13, weight: 900, color: '#9a741c' });
        drawText(sessionTitle || 'KDK SESSION', padding, 66, { align: 'left', size: 28, weight: 900, color: reportColors.text });
        drawText(finalImageLabels.personalDetail, width - padding, 66, { align: 'right', size: 22, weight: 900, color: reportColors.text });

        const tableX = padding;
        let y = titleHeight;
        const drawHeaderCell = (text: string, x: number, cellY: number, w: number, h: number, bg = '#e5e7eb') => {
            drawCell(text, x, cellY, w, h, { bg, color: '#1f2937', weight: 900, size: 13, fit: true });
            ctx.strokeStyle = reportColors.borderStrong;
            ctx.lineWidth = 1.4;
            ctx.strokeRect(x, cellY, w, h);
        };

        let x = tableX;
        columns.forEach((column) => {
            drawHeaderCell(column.label, x, y, column.width, headerTopHeight + headerSubHeight);
            x += column.width;
        });
        drawHeaderCell('\uAC8C\uC784\uB4DD\uC810', x, y, pointsWidth, headerTopHeight, '#e2e8f0');
        const pfX = x;
        x += pointsWidth;
        drawHeaderCell('\uAC8C\uC784\uC2E4\uC810', x, y, pointsWidth, headerTopHeight, '#e2e8f0');
        const paX = x;
        x += pointsWidth;
        drawHeaderCell('\uB4DD\uC2E4', x, y, 72, headerTopHeight + headerSubHeight, '#e2e8f0');

        y += headerTopHeight;
        x = pfX;
        detailGameColumns.forEach((columnIndex) => {
            drawHeaderCell(String(columnIndex + 1), x, y, scoreColWidth, headerSubHeight, reportColors.headerAlt);
            x += scoreColWidth;
        });
        drawHeaderCell('\uD569\uACC4', x, y, 70, headerSubHeight, '#fef3c7');
        x = paX;
        detailGameColumns.forEach((columnIndex) => {
            drawHeaderCell(String(columnIndex + 1), x, y, scoreColWidth, headerSubHeight, reportColors.headerAlt);
            x += scoreColWidth;
        });
        drawHeaderCell('\uD569\uACC4', x, y, 70, headerSubHeight, '#fef3c7');

        y += headerSubHeight;
        activeDetailedResults.forEach((row, rowIndex) => {
            const rowBg = rowIndex % 2 === 0 ? reportColors.row : reportColors.rowAlt;

            x = tableX;
            drawCell(String(row.displayRank), x, y, columns[0].width, rowHeight, { bg: rowBg, color: reportColors.goldText, weight: 900, size: 15 });
            x += columns[0].width;
            drawCell(row.name, x, y, columns[1].width, rowHeight, { bg: rowBg, color: reportColors.text, weight: 900, size: 15, fit: true });
            x += columns[1].width;
            drawCell(String(row.wins), x, y, columns[2].width, rowHeight, { bg: rowBg, color: reportColors.plusText, weight: 900, size: 15 });
            x += columns[2].width;
            drawCell(String(row.losses), x, y, columns[3].width, rowHeight, { bg: rowBg, color: reportColors.penaltyText, weight: 900, size: 15 });
            x += columns[3].width;

            detailGameColumns.forEach((columnIndex) => {
                drawCell(String(row.pointsForByMatch[columnIndex] ?? '-'), x, y, scoreColWidth, rowHeight, { bg: rowBg, color: '#374151', weight: 800, size: 14 });
                x += scoreColWidth;
            });
            drawCell(String(row.pointsForTotal), x, y, 70, rowHeight, { bg: '#fff7ed', color: reportColors.text, weight: 900, size: 15 });
            x += 70;
            detailGameColumns.forEach((columnIndex) => {
                drawCell(String(row.pointsAgainstByMatch[columnIndex] ?? '-'), x, y, scoreColWidth, rowHeight, { bg: rowBg, color: '#374151', weight: 800, size: 14 });
                x += scoreColWidth;
            });
            drawCell(String(row.pointsAgainstTotal), x, y, 70, rowHeight, { bg: '#fff7ed', color: reportColors.text, weight: 900, size: 15 });
            x += 70;
            drawCell(row.diff > 0 ? `+${row.diff}` : String(row.diff), x, y, 72, rowHeight, {
                bg: rowBg,
                color: row.diff > 0 ? reportColors.plusText : row.diff < 0 ? reportColors.penaltyText : reportColors.muted,
                weight: 900,
                size: 15,
            });
            y += rowHeight;
        });

        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to create detail result image.'));
            }, 'image/png', 0.95);
        });
    };

    const downloadDetailedResultImage = (blob: Blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = getDetailExportFileName();
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const copyDetailedResultImage = async (blob: Blob) => {
        if (
            typeof window === 'undefined' ||
            typeof navigator === 'undefined' ||
            !navigator.clipboard ||
            typeof navigator.clipboard.write !== 'function' ||
            typeof (window as any).ClipboardItem !== 'function'
        ) {
            throw new Error('Image clipboard is not supported.');
        }

        const ClipboardItemCtor = (window as any).ClipboardItem;
        await navigator.clipboard.write([
            new ClipboardItemCtor({
                [blob.type]: blob,
            }),
        ]);
    };

    const downloadImageBlob = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const copyImageBlob = async (blob: Blob) => {
        if (
            typeof window === 'undefined' ||
            typeof navigator === 'undefined' ||
            !navigator.clipboard ||
            typeof navigator.clipboard.write !== 'function' ||
            typeof (window as any).ClipboardItem !== 'function'
        ) {
            throw new Error('Image clipboard is not supported.');
        }

        const ClipboardItemCtor = (window as any).ClipboardItem;
        await navigator.clipboard.write([
            new ClipboardItemCtor({
                [blob.type]: blob,
            }),
        ]);
    };

    const getFinalResultPlayerName = (player: RankedPlayer) => {
        const manualGuestName = formatKDKPlayerName(player.name);
        const idGuestName = formatKDKPlayerName(player.id);
        const sourceName = manualGuestName && !isLikelyKDKId(manualGuestName) ? manualGuestName : idGuestName;
        const cleanName = sourceName && !isLikelyKDKId(sourceName) ? sourceName : '미확인';
        const isGuest = player.is_guest || /^manual-guest-/i.test(player.id) || /^g-/i.test(player.id);
        return isGuest && !cleanName.endsWith('(G)') ? `${cleanName}(G)` : cleanName;
    };

    type FinalResultExportKind = 'overall' | 'groups';

    const getFinalResultExportFileName = (kind: FinalResultExportKind = 'overall') => {
        const safeSessionTitle = (sessionTitle || 'KDK_FINAL_RESULTS')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_');
        return `${safeSessionTitle}_${kind === 'overall' ? 'FINAL_OVERALL' : 'FINAL_GROUPS'}.png`;
    };

    const createFinalResultImageBlob = async (kind: FinalResultExportKind = 'overall') => {
        if (playersList.length === 0) throw new Error('No final result rows to export.');

        const totalCount = playersList.length;
        const buildFinalRows = (sourcePlayers: RankedPlayer[]) => {
            return sourcePlayers.map((player, index) => {
                const overallIndex = playersList.findIndex((candidate) => candidate.id === player.id);
                const settlementIndex = overallIndex >= 0 ? overallIndex : index;
                const amountInfo = calculateSettlement(player, settlementIndex, totalCount);
                return {
                    rank: index + 1,
                    name: getFinalResultPlayerName(player),
                    wins: player.wins,
                    losses: player.losses,
                    amount: amountInfo.amount,
                };
            });
        };

        const groupAPlayers = playersList.filter((player) => getPlayerGroupKey(player) === 'A');
        const groupBPlayers = playersList.filter((player) => getPlayerGroupKey(player) === 'B');
        const finalSections: Array<{
            title: string;
            groupKey: 'ALL' | 'A' | 'B';
            rows: ReturnType<typeof buildFinalRows>;
        }> = kind === 'overall'
            ? [{ title: finalImageLabels.overallSection, groupKey: 'ALL', rows: buildFinalRows(playersList) }]
            : [
                ...(groupAPlayers.length > 0 ? [{ title: finalImageLabels.groupASection, groupKey: 'A' as const, rows: buildFinalRows(groupAPlayers) }] : []),
                ...(groupBPlayers.length > 0 ? [{ title: finalImageLabels.groupBSection, groupKey: 'B' as const, rows: buildFinalRows(groupBPlayers) }] : []),
            ];

        if (finalSections.length === 0) throw new Error('No final result rows to export.');

        const scale = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
        const padding = 36;
        const rowHeight = 50;
        const sectionHeight = 44;
        const titleHeight = 156;
        const footerHeight = 52;
        const width = 920;
        const bodyHeight = finalSections.reduce((sum, section) => sum + sectionHeight + section.rows.length * rowHeight, 0);
        const height = titleHeight + bodyHeight + footerHeight + padding;

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext('2d')!;
        if (!ctx) throw new Error('Canvas context is unavailable.');
        ctx.scale(scale, scale);

        const drawText = (
            text: string,
            x: number,
            y: number,
            options: { size?: number; weight?: number | string; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; maxWidth?: number } = {}
        ) => {
            ctx.fillStyle = options.color || '#111827';
            ctx.font = `${options.weight || 800} ${options.size || 14}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            ctx.textAlign = options.align || 'left';
            ctx.textBaseline = options.baseline || 'middle';
            ctx.fillText(text, x, y, options.maxWidth);
        };

        const fitText = (text: string, x: number, y: number, maxWidth: number, options: { size: number; minSize?: number; weight?: number | string; color?: string; align?: CanvasTextAlign }) => {
            let size = options.size;
            const minSize = options.minSize || 12;
            ctx.font = `${options.weight || 800} ${size}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            while (size > minSize && ctx.measureText(text).width > maxWidth) {
                size -= 1;
                ctx.font = `${options.weight || 800} ${size}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            }
            drawText(text, x, y, { ...options, size, maxWidth });
        };

        ctx.fillStyle = reportColors.page;
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = reportColors.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(padding / 2, padding / 2, width - padding, height - padding);

        drawText('TEYEON KDK', padding, 38, { size: 14, weight: 900, color: '#9a741c' });
        drawText(sessionTitle || 'KDK SESSION', padding, 70, { size: 30, weight: 900, color: reportColors.text });
        drawText(kind === 'overall' ? finalImageLabels.overallTitle : finalImageLabels.groupsTitle, width - padding, 70, {
            align: 'right',
            size: 25,
            weight: 900,
            color: reportColors.text,
        });
        drawText(`${finalImageLabels.prizeLine}: 1${finalImageLabels.rankSuffix} ${prizes.first.toLocaleString()} / L1 ${prizes.l1.toLocaleString()} / L2 ${prizes.l2.toLocaleString()} / ${guestFeeLabel}`, padding, 118, {
            size: 14,
            weight: 800,
            color: reportColors.muted,
        });

        let y = titleHeight;
        finalSections.forEach((section) => {
            const isGroupB = section.groupKey === 'B';
            const isGroupAll = section.groupKey === 'ALL';
            ctx.fillStyle = isGroupAll ? reportColors.header : isGroupB ? reportColors.blueBg : reportColors.goldBg;
            ctx.fillRect(padding, y, width - padding * 2, sectionHeight);
            ctx.strokeStyle = isGroupAll ? reportColors.borderStrong : isGroupB ? '#38bdf8' : '#d97706';
            ctx.lineWidth = 1.4;
            ctx.strokeRect(padding, y, width - padding * 2, sectionHeight);
            drawText(section.title, padding + 18, y + sectionHeight / 2, {
                size: 17,
                weight: 900,
                color: isGroupAll ? '#1f2937' : isGroupB ? reportColors.blueText : reportColors.goldText,
            });
            y += sectionHeight;

            section.rows.forEach((row, index) => {
                const isPenaltyRow = row.amount < 0;
                ctx.fillStyle = isPenaltyRow
                    ? reportColors.penaltyBg
                    : row.rank === 1
                        ? '#fff7d6'
                        : row.rank === 2
                            ? '#f3f4f6'
                            : row.rank === 3
                                ? '#ffedd5'
                                : index % 2 === 0 ? reportColors.row : reportColors.rowAlt;
                ctx.fillRect(padding, y, width - padding * 2, rowHeight);
                if (isPenaltyRow) {
                    ctx.fillStyle = reportColors.penaltyText;
                    ctx.fillRect(padding, y, 5, rowHeight);
                }
                ctx.strokeStyle = reportColors.border;
                ctx.lineWidth = 1.1;
                ctx.strokeRect(padding, y, width - padding * 2, rowHeight);
                [padding + 64, padding + 470, padding + 585].forEach((lineX) => {
                    ctx.beginPath();
                    ctx.moveTo(lineX, y);
                    ctx.lineTo(lineX, y + rowHeight);
                    ctx.stroke();
                });

                const rankText = row.rank <= 3 ? `${row.rank}${finalImageLabels.rankSuffix}` : `${row.rank}`;
                const rankColor = row.rank === 1 ? '#b45309' : row.rank === 2 ? '#4b5563' : row.rank === 3 ? '#c2410c' : reportColors.muted;
                drawText(rankText, padding + 32, y + rowHeight / 2, {
                    size: row.rank <= 3 ? 18 : 15,
                    weight: 900,
                    color: rankColor,
                    align: 'center',
                });
                fitText(row.name, padding + 76, y + rowHeight / 2, 360, {
                    size: 20,
                    minSize: 14,
                    weight: 900,
                    color: reportColors.text,
                });
                drawText(`${row.wins}${finalImageLabels.win} ${row.losses}${finalImageLabels.loss}`, padding + 488, y + rowHeight / 2, {
                    size: 16,
                    weight: 900,
                    color: reportColors.muted,
                });

                const amountText = row.amount > 0
                    ? `+${row.amount.toLocaleString()}${finalImageLabels.won}`
                    : row.amount < 0
                        ? `-${Math.abs(row.amount).toLocaleString()}${finalImageLabels.won}`
                        : `0${finalImageLabels.won}`;
                drawText(amountText, width - padding - 18, y + rowHeight / 2, {
                    align: 'right',
                    size: 18,
                    weight: 900,
                    color: row.amount > 0 ? reportColors.plusText : row.amount < 0 ? reportColors.penaltyText : reportColors.muted,
                });

                y += rowHeight;
            });
        });

        drawText(finalImageLabels.archiveNote, padding, height - 38, { size: 13, weight: 800, color: '#6b7280' });
        drawText(new Date().toLocaleString('ko-KR'), width - padding, height - 38, { align: 'right', size: 12, weight: 800, color: '#9ca3af' });

        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to create final result image.'));
            }, 'image/png', 0.95);
        });
    };

    const handleFinalResultImageAction = async (kind: FinalResultExportKind, mode: 'download' | 'copy') => {
        try {
            setTableExportStatus('최종 결과 이미지를 준비 중입니다.');
            const blob = await createFinalResultImageBlob(kind);
            const fileName = getFinalResultExportFileName(kind);

            if (mode === 'copy') {
                try {
                    await copyImageBlob(blob);
                    const message = '이미지가 복사되었습니다. 카카오톡 채팅방에서 붙여넣기 해주세요.';
                    setTableExportStatus(message);
                    alert(message);
                    return;
                } catch (copyError) {
                    console.warn('[KDK Final Result Image Copy]', copyError);
                    downloadImageBlob(blob, fileName);
                    const message = '이미지 복사가 지원되지 않아 PNG로 저장했습니다. 카카오톡에 첨부해주세요.';
                    setTableExportStatus(message);
                    alert(message);
                    return;
                }
            }

            downloadImageBlob(blob, fileName);
            setTableExportStatus('최종 결과 이미지를 저장했습니다.');
        } catch (error) {
            console.warn('[KDK Final Result Image]', error);
            setTableExportStatus('최종 결과 이미지 생성에 실패했습니다.');
            alert('최종 결과 이미지를 만들지 못했습니다.');
        }
    };

    const handleMatchTableImageAction = async (kind: MatchTableExportKind, mode: 'download' | 'copy') => {
        const label = kind === 'schedule' ? '전체 대진표' : '경기 결과표';
        try {
            setTableExportStatus(`${label} 이미지를 준비 중입니다.`);
            const blob = await createMatchTableImageBlob(kind);
            const fileName = getMatchTableExportFileName(kind);

            if (mode === 'copy') {
                try {
                    await copyImageBlob(blob);
                    const message = '이미지가 복사되었습니다. 카카오톡 채팅방에서 붙여넣기 해주세요.';
                    setTableExportStatus(message);
                    alert(message);
                    return;
                } catch (copyError) {
                    console.warn('[KDK Match Table Image Copy]', copyError);
                    downloadImageBlob(blob, fileName);
                    const message = '이미지 복사가 지원되지 않아 PNG로 저장했습니다. 카카오톡에 첨부해주세요.';
                    setTableExportStatus(message);
                    alert(message);
                    return;
                }
            }

            downloadImageBlob(blob, fileName);
            setTableExportStatus(`${label} 이미지를 저장했습니다.`);
        } catch (error) {
            console.warn('[KDK Match Table Image]', error);
            setTableExportStatus(`${label} 이미지 생성에 실패했습니다.`);
            alert(`${label} 이미지를 만들지 못했습니다.`);
        }
    };

    const handleDetailedResultImageAction = async (mode: 'download' | 'copy' | 'share') => {
        try {
            setDetailExportStatus(
                mode === 'copy'
                    ? '복사할 이미지를 준비 중입니다.'
                    : mode === 'share'
                        ? '공유 이미지를 준비 중입니다.'
                        : '저장 이미지를 준비 중입니다.'
            );
            const blob = await createDetailedResultImageBlob();

            if (mode === 'copy') {
                try {
                    await copyDetailedResultImage(blob);
                    const message = '이미지가 복사되었습니다. 카카오톡 채팅방에서 붙여넣기 해주세요.';
                    setDetailExportStatus(message);
                    alert(message);
                    return;
                } catch (copyError) {
                    console.warn('[KDK Detail Result Image Copy]', copyError);
                    downloadDetailedResultImage(blob);
                    const message = '이미지 복사를 지원하지 않아 PNG로 저장했습니다. 카카오톡에는 저장한 이미지를 첨부해 주세요.';
                    setDetailExportStatus(message);
                    alert(message);
                    return;
                }
            }

            const file = new File([blob], getDetailExportFileName(), { type: 'image/png' });
            const shareData = {
                files: [file],
                title: '개인별 상세 결과표',
                text: sessionTitle ? `${sessionTitle} 개인별 상세 결과표` : 'KDK 개인별 상세 결과표',
            } as ShareData & { files: File[] };
            const shareNavigator = navigator as Navigator & { canShare?: (data?: ShareData & { files?: File[] }) => boolean };
            const canShareFiles =
                mode === 'share' &&
                typeof navigator !== 'undefined' &&
                typeof navigator.share === 'function' &&
                (!shareNavigator.canShare || shareNavigator.canShare(shareData));

            if (canShareFiles) {
                await navigator.share(shareData);
                setDetailExportStatus('공유가 완료되었습니다.');
                return;
            }

            downloadDetailedResultImage(blob);
            setDetailExportStatus(mode === 'share' ? '공유를 지원하지 않아 이미지로 저장했습니다.' : '이미지를 저장했습니다.');
        } catch (error) {
            console.warn('[KDK Detail Result Image]', error);
            setDetailExportStatus('이미지 생성에 실패했습니다.');
            alert('상세 결과표 이미지를 만들지 못했습니다.');
        }
    };

    const ImageExportPanel = () => {
        const ButtonPair = ({
            title,
            icon,
            onDownload,
            onCopy,
            disabled = false,
        }: {
            title: string;
            icon: string;
            onDownload: () => void;
            onCopy: () => void;
            disabled?: boolean;
        }) => (
            <div
                className="min-w-0"
                style={{
                    borderRadius: 20,
                    background: '#FFFFFF',
                    border: '1px solid #DCE8F5',
                    padding: 16,
                    display: 'flex', flexDirection: 'column', gap: 14,
                    boxShadow: '0 4px 12px rgba(15,45,85,0.04)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span
                        style={{
                            flexShrink: 0,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 32, height: 32, borderRadius: 10,
                            background: '#EEF5FB', border: '1px solid #DCE8F5',
                            fontSize: 16,
                        }}
                    >
                        {icon}
                    </span>
                    <span
                        style={{
                            minWidth: 0, flex: 1,
                            margin: 0,
                            fontSize: 14, fontWeight: 900, color: '#0F2747',
                            letterSpacing: '-0.01em',
                            lineHeight: 1.25,
                            wordBreak: 'keep-all',
                        }}
                    >
                        {title}
                    </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={onDownload}
                        className="transition active:scale-[0.98] disabled:cursor-not-allowed"
                        style={{
                            borderRadius: 12, height: 40,
                            background: disabled ? '#F1F5F9' : '#FFFFFF',
                            border: '1px solid #DCE8F5',
                            color: disabled ? '#9CB2CC' : '#1F5FB5',
                            fontSize: 13, fontWeight: 900, letterSpacing: '0.04em',
                            whiteSpace: 'nowrap',
                            opacity: disabled ? 0.55 : 1,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                        }}
                    >
                        저장
                    </button>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={onCopy}
                        className="transition active:scale-[0.98] disabled:cursor-not-allowed"
                        style={{
                            borderRadius: 12, height: 40,
                            background: disabled ? '#F1F5F9' : 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
                            border: 'none',
                            color: disabled ? '#9CB2CC' : '#FFFFFF',
                            fontSize: 13, fontWeight: 900, letterSpacing: '0.04em',
                            whiteSpace: 'nowrap',
                            boxShadow: disabled ? 'none' : '0 6px 14px rgba(37,99,235,0.22)',
                            opacity: disabled ? 0.55 : 1,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                        }}
                    >
                        복사
                    </button>
                </div>
            </div>
        );

        return (
            <section
                className="mx-4 mt-6"
                style={{
                    borderRadius: 22,
                    background: '#FFFFFF',
                    border: '1px solid #DCE8F5',
                    padding: 18,
                    boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                }}
            >
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                            <h3
                                style={{
                                    margin: 0, fontSize: 16, fontWeight: 900,
                                    letterSpacing: '-0.02em', color: '#0F2747',
                                }}
                            >
                                결과 공유
                            </h3>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.5, color: '#56729A' }}>
                            카카오톡 공유용 이미지와 결과표를 저장하거나 복사합니다.
                        </p>
                    </div>
                    <span
                        className="shrink-0 whitespace-nowrap"
                        style={{
                            borderRadius: 999, padding: '4px 10px',
                            background: '#EAF3FC', border: '1px solid #C7DCF1',
                            color: '#1F5FB5', fontSize: 10, fontWeight: 900,
                            letterSpacing: '0.18em', textTransform: 'uppercase',
                        }}
                    >
                        PNG
                    </span>
                </div>

                {(detailExportStatus || tableExportStatus) && (
                    <div
                        className="mb-3 overflow-hidden text-ellipsis"
                        style={{
                            borderRadius: 14,
                            background: '#EEF5FB',
                            border: '1px solid #DCE8F5',
                            padding: '8px 12px',
                            fontSize: 11.5, fontWeight: 700,
                            color: '#3F5B82',
                        }}
                    >
                        {tableExportStatus || detailExportStatus}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ButtonPair
                        title={finalImageLabels.personalDetail}
                        icon="📊"
                        disabled={maxDetailGameCount === 0 || activeDetailedResults.length === 0}
                        onDownload={() => handleDetailedResultImageAction('download')}
                        onCopy={() => handleDetailedResultImageAction('copy')}
                    />
                    <ButtonPair
                        title={finalImageLabels.finalOverallButton}
                        icon="🏆"
                        disabled={playersList.length === 0}
                        onDownload={() => handleFinalResultImageAction('overall', 'download')}
                        onCopy={() => handleFinalResultImageAction('overall', 'copy')}
                    />
                    <ButtonPair
                        title={finalImageLabels.finalGroupsButton}
                        icon="🎯"
                        disabled={playersList.length === 0}
                        onDownload={() => handleFinalResultImageAction('groups', 'download')}
                        onCopy={() => handleFinalResultImageAction('groups', 'copy')}
                    />
                    <ButtonPair
                        title={finalImageLabels.fullSchedule}
                        icon="🎾"
                        disabled={sortedExportMatches.length === 0}
                        onDownload={() => handleMatchTableImageAction('schedule', 'download')}
                        onCopy={() => handleMatchTableImageAction('schedule', 'copy')}
                    />
                    <ButtonPair
                        title={finalImageLabels.matchResults}
                        icon="📑"
                        onDownload={() => handleMatchTableImageAction('results', 'download')}
                        onCopy={() => handleMatchTableImageAction('results', 'copy')}
                    />
                </div>
            </section>
        );
    };

    const DetailedResultTable = () => {
        if (activeDetailedResults.length === 0) return null;

        return (
            <section
                ref={detailCaptureRef}
                className="mx-4 mt-6"
                style={{
                    borderRadius: 22,
                    background: '#FFFFFF',
                    border: '1px solid #DCE8F5',
                    padding: 18,
                    boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                }}
            >
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                            <h3
                                style={{
                                    margin: 0, fontSize: 16, fontWeight: 900,
                                    letterSpacing: '-0.02em', color: '#0F2747',
                                }}
                            >
                                개인별 상세 결과표
                            </h3>
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 600, lineHeight: 1.5, color: '#56729A' }}>
                            완료된 경기 기준으로 선수별 득점/실점을 정리합니다.
                        </p>
                    </div>
                    <span
                        className="shrink-0 whitespace-nowrap"
                        style={{
                            borderRadius: 999, padding: '4px 10px',
                            background: '#FFF4DE', border: '1px solid #F4C979',
                            color: '#B7791F', fontSize: 10, fontWeight: 900,
                            letterSpacing: '0.1em',
                        }}
                    >
                        완료 경기 기준
                    </span>
                </div>

                {detailExportStatus && (
                    <div
                        className="mb-3 overflow-hidden text-ellipsis"
                        style={{
                            borderRadius: 14,
                            background: '#EEF5FB',
                            border: '1px solid #DCE8F5',
                            padding: '8px 12px',
                            fontSize: 11.5, fontWeight: 700,
                            color: '#3F5B82',
                        }}
                    >
                        {detailExportStatus}
                    </div>
                )}

                {maxDetailGameCount === 0 ? (
                    <div
                        style={{
                            borderRadius: 16,
                            border: '1px dashed #C7DCF1',
                            background: '#F8FBFE',
                            padding: '24px 16px',
                            textAlign: 'center',
                            fontSize: 12, fontWeight: 700,
                            color: '#7A93B3',
                        }}
                    >
                        완료된 경기 결과가 생기면 선수별 득점/실점 상세표가 표시됩니다.
                    </div>
                ) : (
                    <div
                        className="overflow-x-auto"
                        style={{
                            borderRadius: 14,
                            border: '1px solid #DCE8F5',
                            background: '#FFFFFF',
                        }}
                    >
                        <table className="min-w-max w-full border-collapse" style={{ fontSize: 12 }}>
                            <thead>
                                <tr
                                    style={{
                                        background: '#EEF5FB',
                                        borderBottom: '1px solid #DCE8F5',
                                        fontSize: 10, fontWeight: 900,
                                        letterSpacing: '0.12em',
                                        color: '#1F5FB5',
                                    }}
                                >
                                    <th rowSpan={2} className="min-w-[52px] px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5' }}>순위</th>
                                    <th rowSpan={2} className="min-w-[96px] px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5' }}>성명</th>
                                    <th rowSpan={2} className="min-w-[42px] px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5' }}>승</th>
                                    <th rowSpan={2} className="min-w-[42px] px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5' }}>패</th>
                                    <th colSpan={maxDetailGameCount + 1} className="px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5' }}>게임득점</th>
                                    <th colSpan={maxDetailGameCount + 1} className="px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5' }}>게임실점</th>
                                    <th rowSpan={2} className="min-w-[54px] px-3 py-3 text-center">득실</th>
                                </tr>
                                <tr
                                    style={{
                                        background: '#F8FBFE',
                                        borderBottom: '1px solid #DCE8F5',
                                        fontSize: 10, fontWeight: 900,
                                        letterSpacing: '0.1em',
                                        color: '#56729A',
                                    }}
                                >
                                    {detailGameColumns.map((columnIndex) => (
                                        <th key={`pf-${columnIndex}`} className="min-w-[42px] px-3 py-2 text-center" style={{ borderRight: '1px solid #E1EAF5' }}>
                                            {columnIndex + 1}
                                        </th>
                                    ))}
                                    <th className="min-w-[54px] px-3 py-2 text-center" style={{ borderRight: '1px solid #DCE8F5', color: '#1F5FB5' }}>합계</th>
                                    {detailGameColumns.map((columnIndex) => (
                                        <th key={`pa-${columnIndex}`} className="min-w-[42px] px-3 py-2 text-center" style={{ borderRight: '1px solid #E1EAF5' }}>
                                            {columnIndex + 1}
                                        </th>
                                    ))}
                                    <th className="min-w-[54px] px-3 py-2 text-center" style={{ borderRight: '1px solid #DCE8F5', color: '#1F5FB5' }}>합계</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeDetailedResults.map((row, rowIndex) => {
                                    const isLast = rowIndex === activeDetailedResults.length - 1;
                                    const rowBg = rowIndex % 2 === 0 ? '#FFFFFF' : '#F8FBFE';
                                    return (
                                        <tr
                                            key={row.id}
                                            style={{
                                                background: rowBg,
                                                borderBottom: isLast ? 'none' : '1px solid #E1EAF5',
                                                fontWeight: 800,
                                                color: '#0F2747',
                                            }}
                                        >
                                            <td className="px-3 py-3 text-center" style={{ borderRight: '1px solid #E1EAF5', color: '#1F5FB5' }}>{row.displayRank}</td>
                                            <td className="max-w-[160px] truncate px-3 py-3 text-center" style={{ borderRight: '1px solid #E1EAF5' }}>{row.name}</td>
                                            <td className="px-3 py-3 text-center" style={{ borderRight: '1px solid #E1EAF5', color: '#1F5FB5' }}>{row.wins}</td>
                                            <td className="px-3 py-3 text-center" style={{ borderRight: '1px solid #E1EAF5', color: '#C0392B' }}>{row.losses}</td>
                                            <DetailScoreCells values={row.pointsForByMatch} />
                                            <td className="px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5', borderLeft: '1px solid #DCE8F5', color: '#1F5FB5', fontWeight: 900 }}>{row.pointsForTotal}</td>
                                            <DetailScoreCells values={row.pointsAgainstByMatch} />
                                            <td className="px-3 py-3 text-center" style={{ borderRight: '1px solid #DCE8F5', borderLeft: '1px solid #DCE8F5', color: '#1F5FB5', fontWeight: 900 }}>{row.pointsAgainstTotal}</td>
                                            <td className="px-3 py-3 text-center" style={{
                                                color: row.diff > 0 ? '#16A085' : row.diff < 0 ? '#C0392B' : '#7A93B3',
                                                fontWeight: 900,
                                            }}>
                                                {row.diff > 0 ? `+${row.diff}` : row.diff}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        );
    };

    return (
        <div className="flex flex-col min-h-screen relative" style={{ background: '#F4F8FC', color: '#0F2747' }}>
            <style jsx global>{`
                @keyframes confetti-fall {
                    0% { transform: translateY(-10vh) rotate(0deg); opacity:1; }
                    100% { transform: translateY(110vh) rotate(720deg); opacity:0; }
                }
                .animate-confetti-fall { animation: confetti-fall 4.5s linear forwards; }
            `}</style>

            <div className="flex-1">
                {isArchive ? (
                    <div className="sticky top-0 z-[100] px-6 py-4 flex items-center justify-between" style={{ background: '#FFFFFF', borderBottom: '1px solid #DCE8F5', boxShadow: '0 4px 16px rgba(15,45,85,0.06)' }}>
                        <div className="flex flex-col">
                            <span style={{ display: 'block', fontSize: 9, fontWeight: 900, color: '#3B82F6', letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 2 }}>아카이브</span>
                            <h2 className="truncate" style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F2747', letterSpacing: '-0.02em', maxWidth: 200 }}>{sessionTitle}</h2>
                        </div>
                        <div style={{ padding: '4px 12px', borderRadius: 999, background: '#EAF3FC', border: '1px solid #C7DCF1', color: '#1F5FB5', fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                            공식 기록
                        </div>
                    </div>
                ) : (
                    showTabs && (
                        <div className="sticky top-0 z-50 py-3 -mx-4 px-4 mb-4" style={{ background: '#F4F8FC', borderBottom: '1px solid #DCE8F5' }}>
                            <div className="flex max-w-sm mx-auto" style={{ background: '#FFFFFF', borderRadius: 18, padding: 4, border: '1px solid #DCE8F5', boxShadow: '0 6px 16px rgba(15,45,85,0.05)' }}>
                                {['ALL', 'A', 'B'].map((tab) => {
                                    const active = activeRankingTab === tab;
                                    return (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveRankingTab(tab as any)}
                                            className="flex-1 transition-all"
                                            style={{
                                                padding: '10px 0', borderRadius: 14,
                                                fontSize: 12, fontWeight: 900, letterSpacing: '0.04em',
                                                background: active ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)' : 'transparent',
                                                color: active ? '#FFFFFF' : '#56729A',
                                                border: 'none',
                                                boxShadow: active ? '0 6px 14px rgba(37,99,235,0.22)' : 'none',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {tab === 'ALL' ? '전체' : `${tab}조`}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )
                )}

                {ceremonyMode && (
                    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[100] px-6 py-2 bg-gradient-to-r from-[#C9B075] to-[#E5D29B] rounded-full shadow-[0_10px_40px_rgba(201,176,117,0.6)] animate-in slide-in-from-top-10 duration-700 border border-white/50">
                        <span className="text-[10px] font-black text-black tracking-[0.2em] uppercase italic">🏆 CHAMPIONSHIP CELEBRATION</span>
                    </div>
                )}

                {showConfetti && (
                    <div className="absolute inset-x-0 top-0 pointer-events-none z-[100] h-screen overflow-hidden flex justify-center">
                        {[...Array(30)].map((_, i) => (
                            <div key={i} className="absolute top-[-20px] w-2.5 h-2.5 bg-[#C9B075] rounded-full animate-confetti-fall" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 4}s`, background: i % 2 === 0 ? '#C9B075' : '#E5D29B' }} />
                        ))}
                    </div>
                )}

                {activeRankingTab === 'ALL' && <RankingTable players={players} title="INTEGRATED LEADERBOARD" />}
                {activeRankingTab === 'A' && <RankingTable players={generatePlayerList('A')} title="GROUP A" />}
                {activeRankingTab === 'B' && <RankingTable players={generatePlayerList('B')} title="GROUP B" />}

                <DetailedResultTable />
                <ImageExportPanel />

                {/* 텍스트 공유 — 카카오톡 paste 등용 (ImageExportPanel과 별개 핸들러) */}
                <div className="mt-4 mb-6 mx-4">
                    <div
                        style={{
                            borderRadius: 22,
                            background: '#FFFFFF',
                            border: '1px solid #DCE8F5',
                            padding: 18,
                            boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2563EB' }} />
                            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 900, letterSpacing: '0.02em', color: '#1F5FB5' }}>
                                텍스트 빠른 복사
                            </h4>
                        </div>
                        <p style={{ margin: '0 0 14px', fontSize: 11.5, fontWeight: 600, lineHeight: 1.5, color: '#56729A' }}>
                            카카오톡 등에 바로 붙여넣을 수 있는 텍스트 요약을 복사합니다.
                        </p>
                        <div className="grid grid-cols-2 gap-2.5">
                            <button
                                onClick={onShareMatch}
                                className="flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                                style={{
                                    height: 52, borderRadius: 14,
                                    background: '#F8FBFE', border: '1px solid #DCE8F5',
                                    color: '#1F5FB5', fontSize: 13, fontWeight: 900,
                                    letterSpacing: '0.02em',
                                    cursor: 'pointer',
                                }}
                            >
                                <span style={{ fontSize: 15 }}>📋</span>
                                대진표
                            </button>
                            <button
                                onClick={onShareResult}
                                className="flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                                style={{
                                    height: 52, borderRadius: 14,
                                    background: '#F8FBFE', border: '1px solid #DCE8F5',
                                    color: '#1F5FB5', fontSize: 13, fontWeight: 900,
                                    letterSpacing: '0.02em',
                                    cursor: 'pointer',
                                }}
                            >
                                <span style={{ fontSize: 15 }}>🏆</span>
                                최종 결과
                            </button>
                        </div>
                    </div>
                </div>

                {/* 공식 기록 확정 — 순위 탭 콘텐츠의 마지막 섹션(일반 문서 흐름).
                    sticky/fixed/overlay 아님. 아래 padding 으로 경기/순위 탭 바 + BottomNav 와 겹치지 않게 확보. */}
                {!isArchive && (
                    <section
                        style={{
                            position: 'relative',
                            width: '100%',
                            maxWidth: 420,
                            margin: '28px auto 0',
                            padding: '0 16px',
                            paddingBottom: 'calc(var(--bottom-nav-area) + 96px + env(safe-area-inset-bottom))',
                            boxSizing: 'border-box',
                        }}
                    >
                        <div
                            style={{
                                display: 'flex', flexDirection: 'column', gap: 12,
                                borderRadius: 20,
                                background: '#FFFFFF',
                                border: '1px solid #DCE8F5',
                                padding: '16px',
                                boxShadow: '0 10px 28px rgba(15,45,85,0.10)',
                            }}
                        >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'center' }}>
                                <span style={{
                                    fontSize: 10, fontWeight: 900, color: '#3B82F6',
                                    letterSpacing: '0.22em', textTransform: 'uppercase',
                                }}>
                                    FINAL ARCHIVE
                                </span>
                                <p style={{
                                    margin: 0, fontSize: 11.5, fontWeight: 700, lineHeight: 1.5,
                                    color: '#3F5B82',
                                }}>
                                    이 세션의 최종 결과를 Archive와 개인 기록에 반영합니다.
                                </p>
                            </div>
                            <button
                                disabled={isGenerating}
                                onClick={() => {
                                    if (!isAdmin) {
                                        alert("관리자만 아카이브를 확정할 수 있습니다.");
                                        return;
                                    }
                                    onFinalize?.();
                                }}
                                className="w-full transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                                style={{
                                    height: 54, borderRadius: 16,
                                    background: isAdmin
                                        ? 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)'
                                        : '#F6FAFD',
                                    color: isAdmin ? '#FFFFFF' : '#9CB2CC',
                                    border: isAdmin ? 'none' : '1px solid #DCE8F5',
                                    fontSize: 14, fontWeight: 900, letterSpacing: '0.04em',
                                    boxShadow: isAdmin ? '0 14px 30px rgba(37,99,235,0.30)' : 'none',
                                    cursor: isGenerating || !isAdmin ? 'not-allowed' : 'pointer',
                                    opacity: isGenerating ? 0.6 : 1,
                                }}
                            >
                                <span style={{ fontSize: 18 }}>{isAdmin ? '🏆' : '🔒'}</span>
                                <span>{isGenerating ? '저장 중...' : (isAdmin ? '공식 기록 확정' : '관리자 전용')}</span>
                            </button>
                        </div>
                    </section>
                )}

                {isArchive && snapshot_data && snapshot_data.length > 0 && (
                    <section className="px-6 pb-20 space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
                        <div className="flex items-center gap-4">
                            <div className="w-2 h-10 bg-[#C9B075] rounded-full shadow-[0_0_20px_rgba(201,176,117,0.4)]" />
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: '#56729A' }}>Historical Evidence</span>
                                <h3 className="text-2xl font-black italic text-white uppercase tracking-tight">ATMOSPHERE REPLAY</h3>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {snapshot_data.map((m: any, idx: number) => {
                                const isB = (m.court || m.groupName) === 'B';
                                const color = isB ? '#00e5ff' : '#C9B075';
                                return (
                                    <div key={idx} className="bg-white/[0.03] border-t-2 border-white/20 rounded-[24px] overflow-hidden shadow-2xl relative group">
                                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent pointer-events-none" />
                                        <div className="px-6 py-3 border-b border-white/5 bg-white/5 flex items-center justify-between">
                                            <span className="text-[10px] font-black tracking-[0.3em] uppercase opacity-40 italic" style={{ color }}>
                                                {isB ? 'B COURT' : 'A COURT'} • MATCH {(idx + 1).toString().padStart(2, '0')}
                                            </span>
                                            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Archive ID: #{idx + 101}</span>
                                        </div>
                                        <div className="p-8 flex flex-col items-center gap-6">
                                            {/* v11: Identity Resolution - 박멸 Unknown */}
                                            {(() => {
                                                const pIds = m.player_ids || m.playerIds || [];
                                                // Resolve names via: 
                                                // 1. Explicit snapshot names
                                                // 2. Current players list (ranking)
                                                // 3. Fallback logic
                                                const resolveName = (idx: number) => {
                                                    if (m.player_names?.[idx] && m.player_names[idx] !== 'Unknown' && m.player_names[idx] !== '?') return m.player_names[idx];
                                                    if (m.playerNames?.[idx] && m.playerNames[idx] !== 'Unknown' && m.playerNames[idx] !== '?') return m.playerNames[idx];
                                                    const pid = pIds[idx];
                                                    const found = playersList.find(p => p.id === pid);
                                                    return found?.name || 'Unknown';
                                                };

                                                return (
                                                    <div className="flex items-center justify-between w-full relative">
                                                        <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(0)}</span>
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(1)}</span>
                                                        </div>
                                                        
                                                        <div className="flex flex-col items-center shrink-0 px-8 relative">
                                                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/10 group-hover:bg-[#C9B075]/20 transition-colors" />
                                                            <div className="bg-black/60 backdrop-blur-3xl px-6 py-3 rounded-2xl border border-white/10 relative z-10 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
                                                                <span className="text-3xl font-[1000] text-white tracking-tighter tabular-nums drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                                                                    {m.score1 !== undefined ? m.score1 : (m.s1 || '0')}:{m.score2 !== undefined ? m.score2 : (m.s2 || '0')}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(2)}</span>
                                                            <span className="text-[13px] font-black text-white/90 truncate w-full text-center tracking-tighter drop-shadow-sm">{resolveName(3)}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>

        </div>
    );
}
