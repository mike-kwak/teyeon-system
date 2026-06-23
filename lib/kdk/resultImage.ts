// KDK 결과표 이미지 생성 — LIVE COURT(순위 탭)와 Archive 상세가 공유하는 단일 소스.
//
// 핵심 원칙:
//   - 순수 렌더러. 입력으로 "이미 준비된 행 데이터"만 받는다(점수 재계산/정산 로직 없음).
//   - 같은 입력이면 어디서 호출하든 동일한 PNG 가 나온다 → LIVE COURT 와 Archive 결과 이미지 일치.
//   - 캔버스 그리기 코드는 기존 RankingTab 의 검증된 로직을 그대로 옮긴 것(레이아웃/색상 동일).
//
// 이 파일은 'use client' 컴포넌트에서만 호출된다(document/canvas 필요).

// ── 색상 팔레트 (기존 reportColors 와 동일) ──────────────────────────────────
export const REPORT_COLORS = {
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
} as const;

// ── 순위 이미지 입력 타입 ────────────────────────────────────────────────────
/** 행 단위 정산 — 공식 확정 스냅샷에서 온 값. 임의 계산 금지. */
export interface RankingRowSettlement {
    penaltyAmount: number;   // 벌금 (음수 / 0)
    guestFeeAmount: number;  // 게스트비 (음수 / 0)
    prizeAmount: number;     // 상금 (양수 / 0)
    finalAmount: number;     // 최종
}

export interface RankingImageRow {
    rank: number;
    name: string;
    wins: number;
    losses: number;
    diff: number;
    /** 정산 스냅샷이 있는 행에만. 없으면 정산 셀에 '-' 표기. */
    settlement?: RankingRowSettlement;
}

export interface RankingImageSection {
    title: string;
    groupKey: 'ALL' | 'A' | 'B';
    rows: RankingImageRow[];
}

export interface RankingImageInput {
    sessionTitle: string;
    /** 우상단 제목 (예: "전체 순위"). */
    heading: string;
    /** 제목 아래 한 줄 (날짜·확정 라인 등). 없으면 생략. */
    subline?: string;
    footerLeft?: string;
    footerRight: string;
    /** 세션에 정산 스냅샷이 있으면 true → 벌금/최종 컬럼 표시. false → 득실까지만. */
    hasSettlement: boolean;
    sections: RankingImageSection[];
}

const MONEY_RED = '#dc2626';
const MONEY_GREEN = '#047857';
const MONEY_GRAY = '#6b7280';

function fmtSignedMoney(n: number): string {
    if (n > 0) return `+${n.toLocaleString()}`;
    if (n < 0) return `-${Math.abs(n).toLocaleString()}`;
    return '0';
}

// ── 경기표 이미지 입력 타입 ──────────────────────────────────────────────────
export type MatchTableImageKind = 'schedule' | 'results';

export interface MatchTableSectionRow {
    isSection: true;
    sectionLabel: string;
    groupKey: string;
}
export interface MatchTableDataRow {
    isSection?: false;
    no: number;
    group: string;
    groupKey: string;
    round: string;
    matchNo: string;
    teamA: string;
    teamB: string;
    score: string;
}
export type MatchTableRow = MatchTableSectionRow | MatchTableDataRow;

export interface MatchTableImageInput {
    sessionTitle: string;
    kind: MatchTableImageKind;
    /** 우상단 제목 (예: "경기 결과표"). */
    title: string;
    rows: MatchTableRow[];
    /** 우상단 타임스탬프 라벨. */
    generatedAtLabel: string;
}

type DrawTextOptions = {
    size?: number;
    weight?: number | string;
    color?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    maxWidth?: number;
};

function font(weight: number | string | undefined, size: number | undefined): string {
    return `${weight || 800} ${size || 14}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
}

function createCanvasContext(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; scale: number } {
    const scale = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is unavailable.');
    ctx.scale(scale, scale);
    return { canvas, ctx, scale };
}

function toPngBlob(canvas: HTMLCanvasElement, errorLabel: string): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error(errorLabel));
        }, 'image/png', 0.95);
    });
}

// ── 순위 결과 이미지 (전체 / 조별) ───────────────────────────────────────────
// 승/패·득실 + (정산 스냅샷이 있으면) 벌금/최종 정산 금액을 함께 표기.
export async function renderRankingImageBlob(input: RankingImageInput): Promise<Blob> {
    const sections = input.sections.filter((s) => s.rows.length > 0);
    if (sections.length === 0) throw new Error('No ranking rows to export.');

    const hasSettlement = input.hasSettlement;
    const padding = 36;
    const rowHeight = hasSettlement ? 46 : 50;
    const sectionHeight = 44;
    const colHeaderHeight = 32;
    const titleHeight = 156;
    const footerHeight = 52;
    const width = 920;

    // 컬럼 앵커 (width 920 / padding 36 기준).
    const X_RANK_C = padding + 28;          // 순위 (center)
    const X_NAME_L = padding + 60;          // 선수 (left)
    const NAME_MAXW = hasSettlement ? 250 : 360;
    const X_WL_C = hasSettlement ? padding + 380 : padding + 488;   // 전적 (center)
    const X_DIFF_C = hasSettlement ? padding + 488 : width - padding - 24; // 득실 (center / right)
    const X_SETTLE_R = width - padding - 16; // 정산 (right)

    const bodyHeight = sections.reduce((sum, section) => sum + sectionHeight + colHeaderHeight + section.rows.length * rowHeight, 0);
    const height = titleHeight + bodyHeight + footerHeight + padding;

    const { canvas, ctx } = createCanvasContext(width, height);

    const drawText = (text: string, x: number, y: number, options: DrawTextOptions = {}) => {
        ctx.fillStyle = options.color || '#111827';
        ctx.font = font(options.weight, options.size);
        ctx.textAlign = options.align || 'left';
        ctx.textBaseline = options.baseline || 'middle';
        ctx.fillText(text, x, y, options.maxWidth);
    };

    const fitText = (text: string, x: number, y: number, maxWidth: number, options: { size: number; minSize?: number; weight?: number | string; color?: string; align?: CanvasTextAlign }) => {
        let size = options.size;
        const minSize = options.minSize || 12;
        ctx.font = font(options.weight, size);
        while (size > minSize && ctx.measureText(text).width > maxWidth) {
            size -= 1;
            ctx.font = font(options.weight, size);
        }
        drawText(text, x, y, { ...options, size, maxWidth });
    };

    ctx.fillStyle = REPORT_COLORS.page;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = REPORT_COLORS.borderStrong;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padding / 2, padding / 2, width - padding, height - padding);

    drawText('TEYEON KDK', padding, 38, { size: 14, weight: 900, color: '#9a741c' });
    drawText(input.sessionTitle || 'KDK SESSION', padding, 70, { size: 30, weight: 900, color: REPORT_COLORS.text });
    drawText(input.heading, width - padding, 70, { align: 'right', size: 25, weight: 900, color: REPORT_COLORS.text });
    const subline = input.subline
        ? (hasSettlement ? input.subline : `${input.subline} · 정산 정보 없음(득실만 표시)`)
        : (hasSettlement ? '' : '정산 정보 없음 · 득실만 표시');
    if (subline) {
        drawText(subline, padding, 118, { size: 14, weight: 800, color: REPORT_COLORS.muted });
    }

    let y = titleHeight;
    sections.forEach((section) => {
        const isGroupB = section.groupKey === 'B';
        const isGroupAll = section.groupKey === 'ALL';
        ctx.fillStyle = isGroupAll ? REPORT_COLORS.header : isGroupB ? REPORT_COLORS.blueBg : REPORT_COLORS.goldBg;
        ctx.fillRect(padding, y, width - padding * 2, sectionHeight);
        ctx.strokeStyle = isGroupAll ? REPORT_COLORS.borderStrong : isGroupB ? '#38bdf8' : '#d97706';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(padding, y, width - padding * 2, sectionHeight);
        drawText(section.title, padding + 18, y + sectionHeight / 2, {
            size: 17,
            weight: 900,
            color: isGroupAll ? '#1f2937' : isGroupB ? REPORT_COLORS.blueText : REPORT_COLORS.goldText,
        });
        y += sectionHeight;

        // 컬럼 라벨 행.
        ctx.fillStyle = REPORT_COLORS.headerAlt;
        ctx.fillRect(padding, y, width - padding * 2, colHeaderHeight);
        ctx.strokeStyle = REPORT_COLORS.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(padding, y, width - padding * 2, colHeaderHeight);
        const chC = y + colHeaderHeight / 2;
        drawText('순위', X_RANK_C, chC, { size: 12, weight: 900, color: '#475569', align: 'center' });
        drawText('선수', X_NAME_L, chC, { size: 12, weight: 900, color: '#475569', align: 'left' });
        drawText('전적', X_WL_C, chC, { size: 12, weight: 900, color: '#475569', align: 'center' });
        drawText('득실', X_DIFF_C, chC, { size: 12, weight: 900, color: '#475569', align: hasSettlement ? 'center' : 'right' });
        if (hasSettlement) {
            drawText('정산', X_SETTLE_R, chC, { size: 12, weight: 900, color: '#475569', align: 'right' });
        }
        y += colHeaderHeight;

        section.rows.forEach((row, index) => {
            const finalNeg = !!row.settlement && row.settlement.finalAmount < 0;
            ctx.fillStyle = finalNeg
                ? REPORT_COLORS.penaltyBg
                : row.rank === 1
                    ? '#fff7d6'
                    : row.rank === 2
                        ? '#f3f4f6'
                        : row.rank === 3
                            ? '#ffedd5'
                            : index % 2 === 0 ? REPORT_COLORS.row : REPORT_COLORS.rowAlt;
            ctx.fillRect(padding, y, width - padding * 2, rowHeight);
            if (finalNeg) {
                ctx.fillStyle = REPORT_COLORS.penaltyText;
                ctx.fillRect(padding, y, 5, rowHeight);
            }
            ctx.strokeStyle = REPORT_COLORS.border;
            ctx.lineWidth = 1.1;
            ctx.strokeRect(padding, y, width - padding * 2, rowHeight);

            const midY = y + rowHeight / 2;
            const rankText = row.rank <= 3 ? `${row.rank}위` : `${row.rank}`;
            const rankColor = row.rank === 1 ? '#b45309' : row.rank === 2 ? '#4b5563' : row.rank === 3 ? '#c2410c' : REPORT_COLORS.muted;
            drawText(rankText, X_RANK_C, midY, {
                size: row.rank <= 3 ? 18 : 15,
                weight: 900,
                color: rankColor,
                align: 'center',
            });
            fitText(row.name, X_NAME_L, midY, NAME_MAXW, {
                size: 20,
                minSize: 13,
                weight: 900,
                color: REPORT_COLORS.text,
            });
            drawText(`${row.wins}승 ${row.losses}패`, X_WL_C, midY, {
                size: 15,
                weight: 900,
                color: REPORT_COLORS.muted,
                align: 'center',
            });
            const diffText = row.diff > 0 ? `+${row.diff}` : String(row.diff);
            drawText(diffText, X_DIFF_C, midY, {
                size: 16,
                weight: 900,
                color: row.diff > 0 ? MONEY_GREEN : row.diff < 0 ? MONEY_RED : MONEY_GRAY,
                align: hasSettlement ? 'center' : 'right',
            });

            if (hasSettlement) {
                // 우측 정산 컬럼: 최종 금액(final_amount)만 한 줄. 0/정산없음은 회색 '-'.
                const s = row.settlement;
                const finalText = (!s || s.finalAmount === 0) ? '-' : fmtSignedMoney(s.finalAmount);
                const finalColor = (!s || s.finalAmount === 0)
                    ? MONEY_GRAY
                    : s.finalAmount > 0 ? MONEY_GREEN : MONEY_RED;
                drawText(finalText, X_SETTLE_R, midY, { size: 17, weight: 900, color: finalColor, align: 'right' });
            }

            y += rowHeight;
        });
    });

    if (input.footerLeft) {
        drawText(input.footerLeft, padding, height - 38, { size: 13, weight: 800, color: '#6b7280' });
    }
    drawText(input.footerRight, width - padding, height - 38, { align: 'right', size: 12, weight: 800, color: '#9ca3af' });

    return toPngBlob(canvas, 'Failed to create ranking image.');
}

// ── 경기표 이미지 (대진표 / 경기 결과표) ─────────────────────────────────────
// 기존 RankingTab.createMatchTableImageBlob 의 그리기 로직을 그대로 옮긴 순수 함수.
export async function renderMatchTableImageBlob(input: MatchTableImageInput): Promise<Blob> {
    const { rows, kind } = input;
    const isResults = kind === 'results';
    const padding = 36;
    const rowHeight = 48;
    const titleHeight = 112;
    const footerHeight = 30;
    const columns = isResults
        ? [
            { key: 'no', label: 'No', width: 54 },
            { key: 'group', label: '조', width: 72 },
            { key: 'round', label: '라운드', width: 90 },
            { key: 'matchNo', label: '대진번호', width: 88 },
            { key: 'teamA', label: '팀1', width: 270 },
            { key: 'score', label: '점수', width: 110 },
            { key: 'teamB', label: '팀2', width: 270 },
        ]
        : [
            { key: 'no', label: 'No', width: 54 },
            { key: 'group', label: '조', width: 72 },
            { key: 'round', label: '라운드', width: 90 },
            { key: 'matchNo', label: '대진번호', width: 88 },
            { key: 'teamA', label: '팀1', width: 305 },
            { key: 'teamB', label: '팀2', width: 305 },
        ];
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const emptyRows = rows.length === 0 ? 1 : 0;
    const width = Math.max(980, tableWidth + padding * 2);
    const height = titleHeight + rowHeight + Math.max(rows.length, emptyRows) * rowHeight + footerHeight + padding;

    const { canvas, ctx } = createCanvasContext(width, height);

    const drawText = (text: string, x: number, y: number, options: DrawTextOptions = {}) => {
        ctx.fillStyle = options.color || '#111827';
        ctx.font = font(options.weight, options.size);
        ctx.textAlign = options.align || 'center';
        ctx.textBaseline = options.baseline || 'middle';
        ctx.fillText(text, x, y, options.maxWidth);
    };

    const fitText = (text: string, x: number, y: number, maxWidth: number, options: { size: number; minSize?: number; weight?: number | string; color?: string; align?: CanvasTextAlign }) => {
        let size = options.size;
        const minSize = options.minSize || 12;
        ctx.font = font(options.weight, size);
        while (size > minSize && ctx.measureText(text).width > maxWidth) {
            size -= 1;
            ctx.font = font(options.weight, size);
        }
        drawText(text, x, y, { ...options, size, maxWidth });
    };

    ctx.fillStyle = REPORT_COLORS.page;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = REPORT_COLORS.borderStrong;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padding / 2, padding / 2, width - padding, height - padding);

    drawText('TEYEON KDK', padding, 36, { align: 'left', size: 13, weight: 900, color: '#9a741c' });
    drawText(input.sessionTitle || 'KDK SESSION', padding, 66, { align: 'left', size: 28, weight: 900, color: REPORT_COLORS.text });
    drawText(input.title, width - padding, 66, { align: 'right', size: 23, weight: 900, color: REPORT_COLORS.text });
    drawText(input.generatedAtLabel, width - padding, 96, { align: 'right', size: 12, weight: 800, color: REPORT_COLORS.muted });

    const tableX = padding;
    let y = titleHeight;
    let x = tableX;
    columns.forEach((column) => {
        ctx.fillStyle = REPORT_COLORS.header;
        ctx.fillRect(x, y, column.width, rowHeight);
        ctx.strokeStyle = REPORT_COLORS.borderStrong;
        ctx.lineWidth = 1.3;
        ctx.strokeRect(x, y, column.width, rowHeight);
        drawText(column.label, x + column.width / 2, y + rowHeight / 2, { size: 13, weight: 900, color: '#1f2937' });
        x += column.width;
    });

    y += rowHeight;
    if (rows.length === 0) {
        ctx.fillStyle = REPORT_COLORS.rowAlt;
        ctx.fillRect(tableX, y, tableWidth, rowHeight);
        ctx.strokeStyle = REPORT_COLORS.border;
        ctx.strokeRect(tableX, y, tableWidth, rowHeight);
        drawText(isResults ? '완료된 경기가 없습니다' : '대진이 없습니다', tableX + tableWidth / 2, y + rowHeight / 2, { size: 16, weight: 900, color: REPORT_COLORS.muted });
    } else {
        rows.forEach((row, rowIndex) => {
            if ((row as MatchTableSectionRow).isSection) {
                const sectionRow = row as MatchTableSectionRow;
                const sectionColor = sectionRow.groupKey === 'B' ? REPORT_COLORS.blueText : REPORT_COLORS.goldText;
                ctx.fillStyle = sectionRow.groupKey === 'B' ? REPORT_COLORS.blueBg : REPORT_COLORS.goldBg;
                ctx.fillRect(tableX, y, tableWidth, rowHeight);
                ctx.strokeStyle = sectionRow.groupKey === 'B' ? '#38bdf8' : '#d97706';
                ctx.lineWidth = 1.4;
                ctx.strokeRect(tableX, y, tableWidth, rowHeight);
                drawText(sectionRow.sectionLabel, tableX + 18, y + rowHeight / 2, { align: 'left', size: 15, weight: 900, color: sectionColor });
                y += rowHeight;
                return;
            }

            const dataRow = row as MatchTableDataRow;
            const rowAccent = dataRow.groupKey === 'B' ? '#38bdf8' : '#d97706';
            ctx.fillStyle = rowIndex % 2 === 0 ? REPORT_COLORS.row : REPORT_COLORS.rowAlt;
            ctx.fillRect(tableX, y, tableWidth, rowHeight);
            ctx.fillStyle = rowAccent;
            ctx.fillRect(tableX, y, 6, rowHeight);
            ctx.strokeStyle = REPORT_COLORS.border;
            ctx.lineWidth = 1.1;
            ctx.strokeRect(tableX, y, tableWidth, rowHeight);

            x = tableX;
            columns.forEach((column) => {
                const value = String((dataRow as unknown as Record<string, unknown>)[column.key] ?? '');
                const isTeam = column.key === 'teamA' || column.key === 'teamB';
                const isScore = column.key === 'score';
                const color = column.key === 'group'
                    ? dataRow.groupKey === 'B' ? REPORT_COLORS.blueText : REPORT_COLORS.goldText
                    : isScore ? REPORT_COLORS.text : '#1f2937';
                if (isTeam) {
                    fitText(value, x + column.width / 2, y + rowHeight / 2, column.width - 18, { size: 16, minSize: 12, weight: 900, color });
                } else {
                    drawText(value, x + column.width / 2, y + rowHeight / 2, { size: isScore ? 18 : 14, weight: 900, color });
                }
                ctx.strokeStyle = REPORT_COLORS.border;
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, column.width, rowHeight);
                x += column.width;
            });

            y += rowHeight;
        });
    }

    return toPngBlob(canvas, 'Failed to create match table image.');
}

// ── 저장 / 복사 공통 헬퍼 ────────────────────────────────────────────────────

export function downloadImageBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export function isImageClipboardSupported(): boolean {
    return typeof window !== 'undefined'
        && typeof navigator !== 'undefined'
        && !!navigator.clipboard
        && typeof navigator.clipboard.write === 'function'
        && typeof (window as unknown as { ClipboardItem?: unknown }).ClipboardItem === 'function';
}

export async function copyImageBlob(blob: Blob): Promise<void> {
    if (!isImageClipboardSupported()) {
        throw new Error('Image clipboard is not supported.');
    }
    const ClipboardItemCtor = (window as unknown as { ClipboardItem: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
    await navigator.clipboard.write([
        new ClipboardItemCtor({ [blob.type]: blob }) as ClipboardItem,
    ]);
}

export type ShareImageMode = 'download' | 'copy';
export type ShareImageResult = 'downloaded' | 'copied' | 'copy-fallback-downloaded';

/**
 * 모드에 따라 저장/복사. 복사 미지원·실패 시 PNG 다운로드로 자동 폴백.
 * 반환값으로 실제 수행 결과를 알려줘 호출부가 적절한 안내 문구를 띄울 수 있게 한다.
 */
export async function shareImageBlob(blob: Blob, fileName: string, mode: ShareImageMode): Promise<ShareImageResult> {
    if (mode === 'copy') {
        try {
            await copyImageBlob(blob);
            return 'copied';
        } catch {
            downloadImageBlob(blob, fileName);
            return 'copy-fallback-downloaded';
        }
    }
    downloadImageBlob(blob, fileName);
    return 'downloaded';
}
