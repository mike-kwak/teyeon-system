'use client';

import React, { useState, useEffect, useRef } from 'react';
import RankingRow from './tournament/RankingRow';

import { RankedPlayer } from '@/lib/tournament_types';

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
    detailedResults = []
}: RankingTabProps) {
    const [sortKey, setSortKey] = useState<string>('rk');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [activeRankingTab, setActiveRankingTab] = useState<'ALL' | 'A' | 'B'>('ALL');
    const [detailExportStatus, setDetailExportStatus] = useState('');
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

    const calculateSettlement = (p: any, idx: number, total: number) => {
        let amount = 0;
        const bottomHalfCount = Math.ceil(total / 2);
        const penaltyCount = Math.ceil(bottomHalfCount / 2);
        const isPenaltyTier = idx >= (total - penaltyCount);
        const isFineTier = !isPenaltyTier && idx >= (total - bottomHalfCount);

        let performancePenalty = 0;
        if (idx === 0 && !p.is_guest) {
            performancePenalty = prizes.first || 10000;
        } else if (isPenaltyTier) {
            performancePenalty = -(prizes.l2 || 5000);
        } else if (isFineTier) {
            performancePenalty = -(prizes.l1 || 3000);
        }

        if (p.is_guest) {
            amount = -5000 + performancePenalty;
        } else {
            amount = performancePenalty;
        }

        return { amount, isPenaltyTier, isFineTier };
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
        const sorted = tablePlayers.map((p, i) => ({ ...p, rk: i + 1 }));
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
                                    <div className="bg-white/5 backdrop-blur-3xl rounded-[40px] border-t border-t-white/30 border-l border-l-white/10 shadow-[0_40px_80px_-15px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.3)] flex flex-col items-center pt-6 pb-6 w-full relative">
                                        <div className={`
                                            flex items-center justify-center rounded-full bg-white/5 backdrop-blur-3xl border border-white/20 relative shadow-2xl mb-6 overflow-hidden
                                            ${isFirst ? 'w-20 h-20 border-[#C9B075]/40' : 'w-16 h-16'}
                                        `}>
                                            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/20 via-transparent to-transparent opacity-60 pointer-events-none" />
                                            {p.avatar ? (
                                                <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <span className={`${isFirst ? 'text-5xl' : 'text-3xl'} select-none text-[#C9B075] drop-shadow-[0_0_20px_rgba(201,176,117,1)] opacity-100 font-bold`}>
                                                    {isFirst ? '🏆' : (idx === 1 ? '🥈' : '🥉')}
                                                </span>
                                            )}
                                            
                                            {/* Badge for Rank Emoji */}
                                            {p.avatar && (
                                                <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-black/80 rounded-full flex items-center justify-center border border-white/20 text-xs">
                                                    {isFirst ? '🏆' : (idx === 1 ? '🥈' : '🥉')}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex flex-col items-center gap-2.5 w-full px-4 relative z-10">
                                            <div className={`font-bold text-white text-center truncate w-full tracking-tighter drop-shadow-[0_10px_20px_rgba(0,0,0,1)] ${isFirst ? 'text-3xl' : 'text-lg'}`}>
                                                {p.name}
                                            </div>
                                            
                                            <div className="flex items-center gap-2 font-black tracking-widest uppercase text-[11px] relative z-20">
                                                <div className="flex items-center gap-0.5">
                                                    <span className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">{p.wins}</span>
                                                    <span className="text-white drop-shadow-[0_0_5px_rgba(0,0,0,1)]">승</span>
                                                </div>
                                                <div className="flex items-center gap-0.5">
                                                    <span className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">{p.losses}</span>
                                                    <span className="text-white drop-shadow-[0_0_5px_rgba(0,0,0,1)]">패</span>
                                                </div>
                                                <span className="opacity-30">/</span>
                                                <span className={p.diff > 0 ? 'text-[#00e5ff] drop-shadow-[0_0_8px_rgba(0,229,255,0.6)]' : 'text-white tracking-normal'}>
                                                    {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                </span>
                                            </div>

                                            {isFirst && (
                                                <div className="mt-5 px-6 py-2 rounded-full bg-[#C9B075] shadow-[0_4px_20px_rgba(201,176,117,0.4)]">
                                                    <span className="text-black font-black text-[12px] tracking-widest italic uppercase">
                                                        ₩{(prizes.first || 10000).toLocaleString()} PRIZE
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
                    <div className="grid grid-cols-[2rem_2.2rem_1fr_1.5rem_1.5rem_1.5rem_1.7rem_1.7rem_2rem_5.2rem] gap-1 px-4 pb-6 text-[11px] font-black text-white/40 tracking-widest border-b border-white/10 uppercase italic overflow-visible">
                        <span className="text-center opacity-60">#</span>
                        <span className="text-center opacity-0">IMG</span>
                        <span className="text-left pl-2 opacity-60">PLAYER</span>
                        <span className="text-right opacity-40">P</span>
                        <span className="text-right text-[#00e5ff]">W</span>
                        <span className="text-right opacity-60">L</span>
                        <span className="text-right opacity-40">PF</span>
                        <span className="text-right opacity-40">PA</span>
                        <span className="text-right text-[#00e5ff]">+/-</span>
                        <span className="text-center text-[#C9B075]">FINE</span>
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
    ).map((row, index) => ({ ...row, displayRank: index + 1 }));
    const maxDetailGameCount = Math.max(
        0,
        ...activeDetailedResults.map((row) => Math.max(row.pointsForByMatch.length, row.pointsAgainstByMatch.length))
    );
    const detailGameColumns = Array.from({ length: maxDetailGameCount }, (_, index) => index);

    const DetailScoreCells = ({ values }: { values: number[] }) => (
        <>
            {detailGameColumns.map((columnIndex) => (
                <td key={columnIndex} className="px-3 py-3 text-center font-black text-white/82">
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
            { label: '순위', width: 66 },
            { label: '성명', width: 150 },
            { label: '승', width: 56 },
            { label: '패', width: 56 },
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

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context is unavailable.');
        ctx.scale(scale, scale);

        const drawRoundedRect = (x: number, y: number, w: number, h: number, r: number, fillStyle: string, strokeStyle?: string) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            ctx.fillStyle = fillStyle;
            ctx.fill();
            if (strokeStyle) {
                ctx.strokeStyle = strokeStyle;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        };

        const drawText = (
            text: string,
            x: number,
            y: number,
            options: { size?: number; weight?: number | string; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline } = {}
        ) => {
            ctx.fillStyle = options.color || '#ffffff';
            ctx.font = `${options.weight || 800} ${options.size || 14}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
            ctx.textAlign = options.align || 'center';
            ctx.textBaseline = options.baseline || 'middle';
            ctx.fillText(text, x, y);
        };

        const drawCell = (text: string, x: number, y: number, w: number, h: number, color = '#f5f5f5', weight: number | string = 800, size = 14) => {
            drawText(text, x + w / 2, y + h / 2, { color, weight, size });
        };

        const backgroundGradient = ctx.createLinearGradient(0, 0, width, height);
        backgroundGradient.addColorStop(0, '#050505');
        backgroundGradient.addColorStop(0.5, '#10100d');
        backgroundGradient.addColorStop(1, '#050505');
        ctx.fillStyle = backgroundGradient;
        ctx.fillRect(0, 0, width, height);

        drawRoundedRect(padding / 2, padding / 2, width - padding, height - padding, 22, 'rgba(255,255,255,0.035)', 'rgba(201,176,117,0.35)');
        drawText('TEYEON KDK', padding, 36, { align: 'left', size: 13, weight: 900, color: '#c9b075' });
        drawText(sessionTitle || 'KDK SESSION', padding, 66, { align: 'left', size: 28, weight: 900, color: '#ffffff' });
        drawText('개인별 상세 결과표', width - padding, 66, { align: 'right', size: 22, weight: 900, color: '#f6df9a' });

        const tableX = padding;
        let y = titleHeight;
        const drawHeaderCell = (text: string, x: number, cellY: number, w: number, h: number, bg = 'rgba(201,176,117,0.18)') => {
            ctx.fillStyle = bg;
            ctx.fillRect(x, cellY, w, h);
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.strokeRect(x, cellY, w, h);
            drawCell(text, x, cellY, w, h, '#f6df9a', 900, 13);
        };

        let x = tableX;
        columns.forEach((column) => {
            drawHeaderCell(column.label, x, y, column.width, headerTopHeight + headerSubHeight);
            x += column.width;
        });
        drawHeaderCell('게임득점', x, y, pointsWidth, headerTopHeight);
        const pfX = x;
        x += pointsWidth;
        drawHeaderCell('게임실점', x, y, pointsWidth, headerTopHeight);
        const paX = x;
        x += pointsWidth;
        drawHeaderCell('득실', x, y, 72, headerTopHeight + headerSubHeight);

        y += headerTopHeight;
        x = pfX;
        detailGameColumns.forEach((columnIndex) => {
            drawHeaderCell(String(columnIndex + 1), x, y, scoreColWidth, headerSubHeight, 'rgba(255,255,255,0.055)');
            x += scoreColWidth;
        });
        drawHeaderCell('합계', x, y, 70, headerSubHeight, 'rgba(201,176,117,0.12)');
        x = paX;
        detailGameColumns.forEach((columnIndex) => {
            drawHeaderCell(String(columnIndex + 1), x, y, scoreColWidth, headerSubHeight, 'rgba(255,255,255,0.055)');
            x += scoreColWidth;
        });
        drawHeaderCell('합계', x, y, 70, headerSubHeight, 'rgba(201,176,117,0.12)');

        y += headerSubHeight;
        activeDetailedResults.forEach((row, rowIndex) => {
            const rowBg = rowIndex % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.02)';
            ctx.fillStyle = rowBg;
            ctx.fillRect(tableX, y, tableWidth, rowHeight);
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.strokeRect(tableX, y, tableWidth, rowHeight);

            x = tableX;
            drawCell(String(row.displayRank), x, y, columns[0].width, rowHeight, '#f6df9a', 900, 15);
            x += columns[0].width;
            drawCell(row.name, x, y, columns[1].width, rowHeight, '#ffffff', 900, 15);
            x += columns[1].width;
            drawCell(String(row.wins), x, y, columns[2].width, rowHeight, '#86efac', 900, 15);
            x += columns[2].width;
            drawCell(String(row.losses), x, y, columns[3].width, rowHeight, '#fca5a5', 900, 15);
            x += columns[3].width;

            detailGameColumns.forEach((columnIndex) => {
                drawCell(String(row.pointsForByMatch[columnIndex] ?? '-'), x, y, scoreColWidth, rowHeight, '#e5e7eb', 800, 14);
                x += scoreColWidth;
            });
            drawCell(String(row.pointsForTotal), x, y, 70, rowHeight, '#ffffff', 900, 15);
            x += 70;
            detailGameColumns.forEach((columnIndex) => {
                drawCell(String(row.pointsAgainstByMatch[columnIndex] ?? '-'), x, y, scoreColWidth, rowHeight, '#e5e7eb', 800, 14);
                x += scoreColWidth;
            });
            drawCell(String(row.pointsAgainstTotal), x, y, 70, rowHeight, '#ffffff', 900, 15);
            x += 70;
            drawCell(row.diff > 0 ? `+${row.diff}` : String(row.diff), x, y, 72, rowHeight, row.diff > 0 ? '#86efac' : row.diff < 0 ? '#fca5a5' : '#d1d5db', 900, 15);
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

    const DetailedResultTable = () => {
        if (activeDetailedResults.length === 0) return null;

        return (
            <section ref={detailCaptureRef} className="mx-4 mt-8 rounded-[28px] border border-[#C9B075]/18 bg-white/[0.035] p-4 shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
                <div className="mb-4 flex items-end justify-between gap-3 px-1">
                    <div>
                        <span className="text-[9px] font-black uppercase tracking-[0.28em] text-[#C9B075]/70">
                            Player Detail
                        </span>
                        <h3 className="mt-1 text-xl font-black italic uppercase tracking-tight text-white">
                            개인별 상세 결과표
                        </h3>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/38">
                            Completed only
                        </span>
                        {maxDetailGameCount > 0 && (
                            <div className="flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleDetailedResultImageAction('download')}
                                    className="rounded-xl border border-[#C9B075]/55 bg-[#C9B075]/12 px-3 py-2 text-[11px] font-black text-[#f5df9a] shadow-[0_0_18px_rgba(201,176,117,0.12)] transition active:scale-[0.98]"
                                >
                                    이미지 저장
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDetailedResultImageAction('copy')}
                                    className="rounded-xl border border-[#C9B075]/80 bg-gradient-to-r from-[#f7d77a] via-[#d6b85c] to-[#b89432] px-3 py-2 text-[11px] font-black text-[#f5df9a] shadow-[0_0_18px_rgba(247,215,122,0.24)] transition active:scale-[0.98]"
                                >
                                    이미지 복사
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDetailedResultImageAction('share')}
                                    className="rounded-xl border border-white/12 bg-white/[0.07] px-3 py-2 text-[11px] font-black text-white/82 transition active:scale-[0.98] md:hidden"
                                >
                                    공유
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                {detailExportStatus && (
                    <div className="mb-3 rounded-2xl border border-white/10 bg-black/24 px-3 py-2 text-[11px] font-bold text-white/48">
                        {detailExportStatus}
                    </div>
                )}

                {maxDetailGameCount === 0 ? (
                    <div className="rounded-[20px] border border-dashed border-white/10 py-8 text-center text-[12px] font-bold text-white/35">
                        완료된 경기 결과가 생기면 선수별 득점/실점 상세표가 표시됩니다.
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-[20px] border border-white/10 bg-black/28">
                        <table className="min-w-max w-full border-collapse text-[12px]">
                            <thead>
                                <tr className="border-b border-white/10 bg-[#C9B075]/10 text-[10px] font-black uppercase tracking-[0.14em] text-[#C9B075]">
                                    <th rowSpan={2} className="min-w-[52px] border-r border-white/10 px-3 py-3 text-center">순위</th>
                                    <th rowSpan={2} className="min-w-[96px] border-r border-white/10 px-3 py-3 text-center">성명</th>
                                    <th rowSpan={2} className="min-w-[42px] border-r border-white/10 px-3 py-3 text-center">승</th>
                                    <th rowSpan={2} className="min-w-[42px] border-r border-white/10 px-3 py-3 text-center">패</th>
                                    <th colSpan={maxDetailGameCount + 1} className="border-r border-white/10 px-3 py-3 text-center">게임득점</th>
                                    <th colSpan={maxDetailGameCount + 1} className="border-r border-white/10 px-3 py-3 text-center">게임실점</th>
                                    <th rowSpan={2} className="min-w-[54px] px-3 py-3 text-center">득실</th>
                                </tr>
                                <tr className="border-b border-white/10 bg-white/[0.035] text-[10px] font-black uppercase tracking-[0.12em] text-white/42">
                                    {detailGameColumns.map((columnIndex) => (
                                        <th key={`pf-${columnIndex}`} className="min-w-[42px] border-r border-white/5 px-3 py-2 text-center">{columnIndex + 1}</th>
                                    ))}
                                    <th className="min-w-[54px] border-r border-white/10 px-3 py-2 text-center text-[#C9B075]/80">합계</th>
                                    {detailGameColumns.map((columnIndex) => (
                                        <th key={`pa-${columnIndex}`} className="min-w-[42px] border-r border-white/5 px-3 py-2 text-center">{columnIndex + 1}</th>
                                    ))}
                                    <th className="min-w-[54px] border-r border-white/10 px-3 py-2 text-center text-[#C9B075]/80">합계</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeDetailedResults.map((row) => (
                                    <tr key={row.id} className="border-b border-white/5 text-white/72 last:border-b-0">
                                        <td className="border-r border-white/5 px-3 py-3 text-center font-black text-[#C9B075]">{row.displayRank}</td>
                                        <td className="border-r border-white/5 px-3 py-3 text-center font-black text-white">{row.name}</td>
                                        <td className="border-r border-white/5 px-3 py-3 text-center font-black text-emerald-300">{row.wins}</td>
                                        <td className="border-r border-white/5 px-3 py-3 text-center font-black text-red-300">{row.losses}</td>
                                        <DetailScoreCells values={row.pointsForByMatch} />
                                        <td className="border-x border-white/10 px-3 py-3 text-center font-black text-white">{row.pointsForTotal}</td>
                                        <DetailScoreCells values={row.pointsAgainstByMatch} />
                                        <td className="border-x border-white/10 px-3 py-3 text-center font-black text-white">{row.pointsAgainstTotal}</td>
                                        <td className={`px-3 py-3 text-center font-black ${row.diff > 0 ? 'text-emerald-300' : row.diff < 0 ? 'text-red-300' : 'text-white/62'}`}>
                                            {row.diff > 0 ? `+${row.diff}` : row.diff}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        );
    };

    return (
        <div className="flex flex-col min-h-screen relative">
            <style jsx global>{`
                @keyframes confetti-fall {
                    0% { transform: translateY(-10vh) rotate(0deg); opacity:1; }
                    100% { transform: translateY(110vh) rotate(720deg); opacity:0; }
                }
                .animate-confetti-fall { animation: confetti-fall 4.5s linear forwards; }
            `}</style>
            
            <div className="flex-1">
                {isArchive ? (
                    <div className="sticky top-0 z-[100] px-6 py-4 bg-black/60 backdrop-blur-2xl border-b border-white/10 flex items-center justify-between">
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.4em] uppercase mb-1">Historical Report</span>
                            <h2 className="text-xl font-black italic text-white tracking-tighter uppercase truncate max-w-[200px]">{sessionTitle}</h2>
                        </div>
                        <div className="px-4 py-1.5 bg-white/5 border border-white/10 rounded-full text-[9px] font-black text-white/40 uppercase tracking-widest">
                            Official Archive
                        </div>
                    </div>
                ) : (
                    showTabs && (
                        <div className="sticky top-0 z-50 py-3 bg-black/60 backdrop-blur-xl -mx-4 px-4 border-b border-white/10 mb-4 shadow-2xl">
                            <div className="flex bg-white/5 rounded-3xl p-1.5 border border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] max-w-sm mx-auto">
                                {['ALL', 'A', 'B'].map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveRankingTab(tab as any)}
                                        className={`flex-1 py-3 text-[11px] font-black rounded-2xl transition-all tracking-widest ${activeRankingTab === tab ? 'bg-gradient-to-r from-[#C9B075] to-[#A89462] text-black shadow-xl shadow-[#C9B075]/20' : 'text-white/40 hover:text-white/70'}`}
                                    >
                                        {tab === 'ALL' ? 'INTEGRATED' : `GROUP ${tab}`}
                                    </button>
                                ))}
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
                
                <div className="h-8" aria-hidden="true" />

                 <div className="flex flex-col gap-6 mt-32 mb-40 px-6 pb-[250px]">
                    <button onClick={onShareMatch} className="w-full py-8 bg-white/5 border border-white/10 text-white text-[13px] font-black uppercase tracking-[0.3em] rounded-[28px] hover:bg-white/10 transition-all flex items-center justify-center gap-6 italic shadow-lg active:scale-95 shadow-black/20">
                        <span className="text-xl">📋</span>
                        {isArchive ? 'SHARE REPORT' : '대진표 공유'}
                    </button>
                    <button onClick={onShareResult} className="w-full py-8 bg-white/5 border border-white/10 text-white text-[13px] font-black uppercase tracking-[0.3em] rounded-[28px] hover:bg-white/10 transition-all flex items-center justify-center gap-6 italic shadow-lg active:scale-95 shadow-black/20">
                        <span className="text-xl">🏆</span>
                        {isArchive ? 'SHARE CHAMPIONS' : '최종결과 공유'}
                    </button>
                </div>

                {isArchive && snapshot_data && snapshot_data.length > 0 && (
                    <section className="px-6 pb-20 space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
                        <div className="flex items-center gap-4">
                            <div className="w-2 h-10 bg-[#C9B075] rounded-full shadow-[0_0_20px_rgba(201,176,117,0.4)]" />
                            <div className="flex flex-col">
                                <span className="text-[9px] font-black text-[#C9B075]/60 uppercase tracking-[0.3em]">Historical Evidence</span>
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

            {!isArchive && (
                <div className="fixed bottom-[145px] left-1/2 -translate-x-1/2 w-[92%] max-w-[420px] z-[100]">
                    <button
                        disabled={isGenerating}
                        onClick={() => {
                            if (!isAdmin) {
                                alert("관리자만 아카이브를 확정할 수 있습니다.");
                                return;
                            }
                            onFinalize?.();
                        }}
                        className={`w-full h-14 text-black font-black rounded-2xl uppercase text-[13px] tracking-[0.35em] shadow-2xl active:scale-95 transition-all border border-white/30 relative overflow-hidden group flex items-center justify-center gap-4 ${!isAdmin ? 'opacity-40 grayscale' : ''}`}
                        style={{
                            background: isAdmin ? 'linear-gradient(to right, #8E7A4A, #A89462, #8E7A4A)' : 'rgba(255,255,255,0.1)',
                            boxShadow: isAdmin ? '0 10px 30px rgba(142,122,74,0.4), inset 0 0 10px rgba(255,255,255,0.3)' : 'none',
                            color: isAdmin ? '#000' : 'rgba(255,255,255,0.5)'
                        }}
                    >
                        {isAdmin && <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />}
                        <span className="text-xl drop-shadow-md">{isAdmin ? '🏆' : '🔒'}</span>
                        <span className="italic">{isGenerating ? 'ARCHIVING...' : (isAdmin ? 'FINAL TOURNAMENT ARCHIVE' : 'ADMINS ONLY')}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
