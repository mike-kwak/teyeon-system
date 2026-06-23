'use client';

import React from 'react';
import { FileImage, Layers, ListChecks, Download, Copy } from 'lucide-react';
import {
    renderRankingImageBlob,
    renderMatchTableImageBlob,
    shareImageBlob,
    type RankingImageSection,
    type MatchTableRow,
    type ShareImageMode,
    type ShareImageResult,
} from '@/lib/kdk/resultImage';

/**
 * Archive 공식 기록 상세 — "결과 공유" 섹션.
 *
 * Archive 에 저장된 확정 데이터(ranking_data / snapshot_data)만으로 결과표 이미지를 재생성한다.
 * LIVE COURT 진행 state 에 의존하지 않으며, lib/kdk/resultImage 의 동일 렌더러를 사용한다.
 *   - 전체 순위 / 조별 순위: 저장된 순위(승·패·득실) 기준. 정산 금액은 Archive 미저장이라
 *     득실(+/-)을 우측 컬럼으로 표기한다(공식 값 재계산 없음).
 *   - 경기 결과표: 저장된 경기 스냅샷(팀/점수) 기준.
 */

export interface ArchiveEntrySettlement {
    penaltyAmount: number;
    guestFeeAmount: number;
    prizeAmount: number;
    finalAmount: number;
}

export interface ArchiveRankingEntry {
    name: string;
    wins: number;
    losses: number;
    diff: number;
    /** 공식 확정 정산 스냅샷이 있을 때만. */
    settlement?: ArchiveEntrySettlement;
}

export interface ArchiveMatchEntry {
    groupKey: 'A' | 'B' | '';
    round: number | null;
    matchNo: number;
    teamA: string;
    teamB: string;
    score1: number;
    score2: number;
}

interface ArchiveResultShareProps {
    sessionTitle: string;
    sessionDateLabel: string;
    confirmedAtLabel?: string;
    isOfficial: boolean;
    /** 정산 스냅샷(settlement_data) 존재 여부 — 이미지에 벌금/최종 컬럼 표시. */
    hasSettlement: boolean;
    overall: ArchiveRankingEntry[];
    groupA: ArchiveRankingEntry[];
    groupB: ArchiveRankingEntry[];
    matches: ArchiveMatchEntry[];
    hasGroupSplit: boolean;
}

function rankingRows(entries: ArchiveRankingEntry[]) {
    return entries.map((e, index) => ({
        rank: index + 1,
        name: e.name,
        wins: e.wins,
        losses: e.losses,
        diff: e.diff,
        settlement: e.settlement,
    }));
}

function safeFileBase(title: string): string {
    return (title || 'KDK_ARCHIVE').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function nowLabel(): string {
    // 이미지 하단 타임스탬프(표시용). 공식 값과 무관.
    return new Date().toLocaleString('ko-KR');
}

type ShareKind = 'overall' | 'groups' | 'results';

export default function ArchiveResultShare({
    sessionTitle,
    sessionDateLabel,
    confirmedAtLabel,
    isOfficial,
    hasSettlement,
    overall,
    groupA,
    groupB,
    matches,
    hasGroupSplit,
}: ArchiveResultShareProps) {
    const [status, setStatus] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const [busy, setBusy] = React.useState<string | null>(null);

    const fileBase = safeFileBase(sessionTitle);
    const subline = [sessionDateLabel, isOfficial ? '공식 기록' : '미확정 기록'].filter(Boolean).join(' · ');
    const footerRight = confirmedAtLabel ? `확정 ${confirmedAtLabel}` : nowLabel();

    const buildBlob = async (kind: ShareKind): Promise<Blob> => {
        if (kind === 'overall') {
            const sections: RankingImageSection[] = [
                { title: '전체 순위', groupKey: 'ALL', rows: rankingRows(overall) },
            ];
            return renderRankingImageBlob({
                sessionTitle, heading: '전체 순위', subline,
                footerLeft: 'Archive 공식 기록', footerRight, hasSettlement, sections,
            });
        }
        if (kind === 'groups') {
            const sections: RankingImageSection[] = [
                ...(groupA.length > 0 ? [{ title: 'A조 순위', groupKey: 'A' as const, rows: rankingRows(groupA) }] : []),
                ...(groupB.length > 0 ? [{ title: 'B조 순위', groupKey: 'B' as const, rows: rankingRows(groupB) }] : []),
            ];
            return renderRankingImageBlob({
                sessionTitle, heading: '조별 순위', subline,
                footerLeft: 'Archive 공식 기록', footerRight, hasSettlement, sections,
            });
        }
        // results — A조/B조 섹션 + 순차 번호 (LIVE COURT 경기 결과표와 동일 구조)
        const rows: MatchTableRow[] = [];
        let rowNo = 1;
        (['A', 'B'] as const).forEach((g) => {
            const groupMatches = matches.filter((m) => m.groupKey === g);
            if (groupMatches.length === 0) return;
            rows.push({ isSection: true, sectionLabel: `${g}조 경기 결과`, groupKey: g });
            groupMatches.forEach((m) => {
                rows.push({
                    no: rowNo++,
                    group: `${g}조`,
                    groupKey: g,
                    round: `R${m.round ?? '-'}`,
                    matchNo: `${m.matchNo}경기`,
                    teamA: m.teamA,
                    teamB: m.teamB,
                    score: `${m.score1} : ${m.score2}`,
                });
            });
        });
        // 그룹 미지정 경기는 별도 섹션으로 노출(숨기지 않음).
        const ungrouped = matches.filter((m) => m.groupKey !== 'A' && m.groupKey !== 'B');
        if (ungrouped.length > 0) {
            rows.push({ isSection: true, sectionLabel: '조 미지정 경기', groupKey: '' });
            ungrouped.forEach((m) => {
                rows.push({
                    no: rowNo++,
                    group: '-',
                    groupKey: '',
                    round: `R${m.round ?? '-'}`,
                    matchNo: `${m.matchNo}경기`,
                    teamA: m.teamA,
                    teamB: m.teamB,
                    score: `${m.score1} : ${m.score2}`,
                });
            });
        }
        return renderMatchTableImageBlob({
            sessionTitle, kind: 'results', title: '경기 결과표', rows, generatedAtLabel: footerRight,
        });
    };

    const feedback = (result: ShareImageResult, label: string) => {
        if (result === 'copied') setStatus({ tone: 'ok', text: `${label} 이미지를 복사했습니다. 카카오톡에 붙여넣기 해주세요.` });
        else if (result === 'copy-fallback-downloaded') setStatus({ tone: 'ok', text: `${label} 이미지 복사가 지원되지 않아 PNG로 저장했습니다.` });
        else setStatus({ tone: 'ok', text: `${label} 이미지를 저장했습니다.` });
    };

    const run = async (kind: ShareKind, mode: ShareImageMode, label: string, fileSuffix: string) => {
        const busyKey = `${kind}-${mode}`;
        setBusy(busyKey);
        setStatus(null);
        try {
            const blob = await buildBlob(kind);
            const result = await shareImageBlob(blob, `${fileBase}_${fileSuffix}.png`, mode);
            feedback(result, label);
        } catch (err) {
            console.warn('[ArchiveResultShare]', err);
            setStatus({ tone: 'error', text: `${label} 이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.` });
        } finally {
            setBusy(null);
        }
    };

    const overallEmpty = overall.length === 0;
    const groupEmpty = !hasGroupSplit || (groupA.length === 0 && groupB.length === 0);
    const matchEmpty = matches.length === 0;

    return (
        <section
            style={{
                borderRadius: 22, background: '#FFFFFF',
                border: '1px solid #DCE8F5', padding: 16,
                boxShadow: '0 10px 24px rgba(15,45,85,0.05)',
                display: 'flex', flexDirection: 'column', gap: 12,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 4, height: 18, background: 'linear-gradient(180deg, #2563EB, #1F5FB5)', borderRadius: 2 }} />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#0F2747' }}>결과 공유</h3>
                <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9CB2CC' }}>SHARE</span>
            </div>
            <p style={{ margin: '-2px 0 2px', fontSize: 11.5, fontWeight: 700, lineHeight: 1.5, color: '#56729A' }}>
                공식 확정된 결과표를 다시 저장하거나 복사할 수 있습니다.
            </p>

            <ShareRow
                icon={<FileImage size={15} />}
                label="전체 순위 이미지"
                disabled={overallEmpty}
                busy={busy}
                busyKeyPrefix="overall"
                onDownload={() => run('overall', 'download', '전체 순위', 'OVERALL_RANK')}
                onCopy={() => run('overall', 'copy', '전체 순위', 'OVERALL_RANK')}
            />
            <ShareRow
                icon={<Layers size={15} />}
                label="조별 순위 이미지"
                disabled={groupEmpty}
                disabledNote={groupEmpty ? '조 구분이 없는 세션입니다.' : undefined}
                busy={busy}
                busyKeyPrefix="groups"
                onDownload={() => run('groups', 'download', '조별 순위', 'GROUP_RANK')}
                onCopy={() => run('groups', 'copy', '조별 순위', 'GROUP_RANK')}
            />
            <ShareRow
                icon={<ListChecks size={15} />}
                label="경기 결과표"
                disabled={matchEmpty}
                disabledNote={matchEmpty ? '저장된 경기 기록이 없습니다.' : undefined}
                busy={busy}
                busyKeyPrefix="results"
                onDownload={() => run('results', 'download', '경기 결과표', 'MATCH_RESULTS')}
                onCopy={() => run('results', 'copy', '경기 결과표', 'MATCH_RESULTS')}
            />

            {status && (
                <p
                    role="status"
                    style={{
                        margin: 0, fontSize: 11.5, fontWeight: 800, lineHeight: 1.5,
                        color: status.tone === 'ok' ? '#16A085' : '#C0392B',
                    }}
                >
                    {status.text}
                </p>
            )}
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, lineHeight: 1.5, color: '#7A93B3' }}>
                {hasSettlement
                    ? '* 벌금·게스트비·상금·최종 금액은 공식 확정 시점에 박제된 정산 스냅샷입니다.'
                    : '* 이 기록에는 정산 스냅샷이 없어 승·패·득실까지만 표시됩니다.'}
            </p>
        </section>
    );
}

function ShareRow({
    icon, label, disabled, disabledNote, busy, busyKeyPrefix, onDownload, onCopy,
}: {
    icon: React.ReactNode;
    label: string;
    disabled?: boolean;
    disabledNote?: string;
    busy: string | null;
    busyKeyPrefix: string;
    onDownload: () => void;
    onCopy: () => void;
}) {
    const downloadBusy = busy === `${busyKeyPrefix}-download`;
    const copyBusy = busy === `${busyKeyPrefix}-copy`;
    const anyBusy = busy !== null;
    return (
        <div
            style={{
                borderRadius: 14, border: '1px solid #E1EAF5', background: '#F8FBFE',
                padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-flex', color: '#2563EB' }}>{icon}</span>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0F2747' }}>{label}</span>
                {disabled && disabledNote && (
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, color: '#9CB2CC' }}>{disabledNote}</span>
                )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                    type="button"
                    onClick={onDownload}
                    disabled={disabled || anyBusy}
                    style={primaryBtn(disabled || anyBusy)}
                >
                    <Download size={14} />
                    {downloadBusy ? '준비 중…' : '저장'}
                </button>
                <button
                    type="button"
                    onClick={onCopy}
                    disabled={disabled || anyBusy}
                    style={secondaryBtn(disabled || anyBusy)}
                >
                    <Copy size={14} />
                    {copyBusy ? '준비 중…' : '복사'}
                </button>
            </div>
        </div>
    );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
    return {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 44, borderRadius: 12, border: 'none',
        background: disabled ? '#AEC6E6' : 'linear-gradient(90deg, #2563EB 0%, #1D9BF0 100%)',
        color: '#FFFFFF', fontSize: 12.5, fontWeight: 900,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled ? 'none' : '0 8px 18px rgba(37,99,235,0.20)',
    };
}
function secondaryBtn(disabled: boolean): React.CSSProperties {
    return {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 44, borderRadius: 12,
        background: '#FFFFFF', border: '1px solid #DCE8F5',
        color: disabled ? '#AEC6E6' : '#1F5FB5', fontSize: 12.5, fontWeight: 900,
        cursor: disabled ? 'not-allowed' : 'pointer',
    };
}
