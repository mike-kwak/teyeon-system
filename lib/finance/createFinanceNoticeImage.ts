// 회비 납부 현황 "이미지 공유" — 공개 공지 불변 스냅샷만으로 1080px PNG 를 native Canvas 로 생성.
//
// 설계:
//   - 기존 KDK 공유 이미지(lib/kdk/resultImage.ts)와 동일한 native Canvas 방식 재사용
//     → html2canvas/html-to-image 등 신규 dependency 추가 없음.
//   - 현재 viewport 를 캡처하지 않고, 스냅샷 데이터로 공유 전용 레이아웃을 직접 그린다.
//   - 회원 수에 따라 높이 자동 확장. 폭은 1080px 고정(요청 권장).
//   - 저장/복사 폴백은 기존 downloadImageBlob / copyTextSafe 재사용.

import { downloadImageBlob } from '../kdk/resultImage';
import { copyTextSafe } from '../clubScheduleShare';
import { formatWon } from './formatFinanceAmount';
import { formatReferenceDot, groupPriorArrears } from './noticesService';
import type {
    NoticeSnapshotMember,
    NoticeExcludedMember,
    NoticeStats,
    PriorArrearLine,
    PriorArrearsStats,
} from './noticesService';
import type { FinancePaymentAccountSnapshot } from './paymentAccount';

const C = {
    page: '#FFFFFF',
    text: '#0F172A',
    muted: '#64748B',
    slate: '#475569',
    teal: '#0E7C76',
    tealSoft: '#0F766E',
    red: '#B91C1C',
    amber: '#92400E',
    border: '#E2E8F0',
    headerBg: '#F8FAFC',
    rowAlt: '#FBFDFE',
    line: '#EEF2F6',
};

export interface FinanceNoticeImageInput {
    title: string;
    referenceDate: string;     // 'YYYY-MM-DD'
    targetYear: number;
    targetMonth: number;
    stats: NoticeStats;
    members: NoticeSnapshotMember[];
    excluded: NoticeExcludedMember[];
    priorArrears?: PriorArrearLine[];
    priorArrearsStats?: PriorArrearsStats | null;
    overallOutstandingAmount?: number | null;
    paymentAccount?: FinancePaymentAccountSnapshot | null;
}

const W = 1080;
const PAD = 48;
const INNER = W - PAD * 2;

function font(weight: number | string, size: number): string {
    return `${weight} ${size}px "Noto Sans KR", "Malgun Gothic", Arial, sans-serif`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** 회비 현황 PNG(1080px) 생성. */
export async function renderFinanceNoticeImageBlob(input: FinanceNoticeImageInput): Promise<Blob> {
    const priorGroups = groupPriorArrears(input.priorArrears ?? []);
    const annualNames = input.members.filter((m) => m.annualFeePaid).map((m) => m.displayName);
    const hasPrior = priorGroups.length > 0;
    const priorRemaining = input.priorArrearsStats?.remainingAmount
        ?? priorGroups.reduce((s, g) => s + g.totalRemaining, 0);
    const overall = input.overallOutstandingAmount ?? (input.stats.totalRemaining + priorRemaining);

    // ── 높이 계산 ──
    const headerH = 150;
    const titleH = 130;
    const summaryRowH = 116;
    const summaryH = summaryRowH * 2 + 8;
    const accountH = input.paymentAccount ? 150 : 0;
    const tableHeadH = 58;
    const tableRowH = 64;
    const tableH = 44 + tableHeadH + Math.max(1, input.members.length) * tableRowH + 24;
    const sideTitleH = 40;
    const priorRowH = 56;
    const priorBlockH = hasPrior ? (sideTitleH + priorGroups.length * priorRowH + 24) : 0;
    const annualBlockH = annualNames.length > 0 ? (sideTitleH + Math.ceil(annualNames.length / 2) * 36 + 24) : 0;
    const sideH = Math.max(priorBlockH, annualBlockH);
    const amountSummaryH = 120;
    const footerH = 110;
    const gap = 28;

    let totalH = PAD + headerH + titleH + gap + summaryH + gap;
    if (accountH) totalH += accountH + gap;
    totalH += tableH + gap;
    if (sideH) totalH += sideH + gap;
    totalH += amountSummaryH + gap + footerH + PAD;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = Math.ceil(totalH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is unavailable.');

    const text = (s: string, x: number, y: number, o: { size: number; weight?: number | string; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; maxWidth?: number } ) => {
        ctx.fillStyle = o.color || C.text;
        ctx.font = font(o.weight ?? 800, o.size);
        ctx.textAlign = o.align || 'left';
        ctx.textBaseline = o.baseline || 'middle';
        ctx.fillText(s, x, y, o.maxWidth);
    };
    const fit = (s: string, x: number, y: number, maxW: number, o: { size: number; minSize?: number; weight?: number | string; color?: string; align?: CanvasTextAlign }) => {
        let size = o.size;
        const min = o.minSize ?? 13;
        ctx.font = font(o.weight ?? 800, size);
        while (size > min && ctx.measureText(s).width > maxW) { size -= 1; ctx.font = font(o.weight ?? 800, size); }
        text(s, x, y, { ...o, size, maxWidth: maxW });
    };
    const pill = (label: string, cx: number, cy: number, bg: string, fg: string, border: string) => {
        ctx.font = font(800, 22);
        const tw = ctx.measureText(label).width;
        const pw = tw + 28, ph = 38;
        ctx.fillStyle = bg; roundRectPath(ctx, cx - pw / 2, cy - ph / 2, pw, ph, 8); ctx.fill();
        ctx.strokeStyle = border; ctx.lineWidth = 1.5; roundRectPath(ctx, cx - pw / 2, cy - ph / 2, pw, ph, 8); ctx.stroke();
        text(label, cx, cy + 1, { size: 22, weight: 800, color: fg, align: 'center' });
    };

    // 배경
    ctx.fillStyle = C.page;
    ctx.fillRect(0, 0, W, canvas.height);

    let y = PAD;

    // ── 헤더(로고 + 브랜드) ──
    const logo = await loadImage('/logos/teyeon-logo-current.png');
    const logoSize = 96;
    if (logo) {
        ctx.drawImage(logo, PAD, y, logoSize, logoSize);
    }
    const brandX = PAD + (logo ? logoSize + 22 : 0);
    text('TEYEON', brandX, y + 38, { size: 44, weight: 900, color: C.text });
    text('TENNIS CLUB · SINCE 2024', brandX, y + 78, { size: 19, weight: 800, color: C.teal });
    y += headerH;

    // ── 타이틀 ──
    ctx.strokeStyle = C.text; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    text('TEYEON 회비 납부 현황', W / 2, y + 52, { size: 40, weight: 900, color: C.text, align: 'center' });
    const ref = formatReferenceDot(input.referenceDate);
    text(`${ref} 기준`, W / 2 - 130, y + 100, { size: 24, weight: 900, color: C.teal, align: 'center' });
    text(`${input.targetYear}년 ${input.targetMonth}월 회비`, W / 2 + 130, y + 100, { size: 22, weight: 800, color: C.slate, align: 'center' });
    y += titleH + gap;

    // ── 요약 그리드 3x2 ──
    const cellW = (INNER - 2 * 8) / 3;
    const drawCell = (col: number, row: number, label: string, value: string, valColor: string) => {
        const cx = PAD + col * (cellW + 8);
        const cyy = y + row * (summaryRowH + 8);
        ctx.fillStyle = C.headerBg; roundRectPath(ctx, cx, cyy, cellW, summaryRowH, 12); ctx.fill();
        ctx.strokeStyle = C.border; ctx.lineWidth = 1.5; roundRectPath(ctx, cx, cyy, cellW, summaryRowH, 12); ctx.stroke();
        text(label, cx + cellW / 2, cyy + 38, { size: 20, weight: 800, color: C.muted, align: 'center' });
        text(value, cx + cellW / 2, cyy + 80, { size: 34, weight: 900, color: valColor, align: 'center' });
    };
    drawCell(0, 0, '전체 회원', `${input.stats.totalMembers}`, C.text);
    drawCell(1, 0, '납부 대상', `${input.stats.targetCount}`, C.text);
    drawCell(2, 0, '회비 제외', `${input.excluded.length}`, C.text);
    drawCell(0, 1, '납부 완료', `${input.stats.paidCount}`, C.teal);
    drawCell(1, 1, '일부 납부', `${input.stats.partialCount}`, C.amber);
    drawCell(2, 1, '미납', `${input.stats.unpaidCount}`, C.red);
    y += summaryH + gap;

    // ── 입금 계좌 ──
    if (input.paymentAccount) {
        ctx.fillStyle = C.page; ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
        roundRectPath(ctx, PAD, y, INNER, accountH - 16, 14); ctx.fill(); ctx.stroke();
        text('회비 입금 계좌', PAD + 28, y + 40, { size: 22, weight: 900, color: C.text });
        text(`${input.paymentAccount.bankName}`, PAD + 28, y + 80, { size: 22, weight: 800, color: C.slate });
        text(`${input.paymentAccount.accountNumberDisplay}`, PAD + 28, y + 112, { size: 30, weight: 900, color: C.text });
        text(`예금주 ${input.paymentAccount.accountHolder}`, W - PAD - 28, y + 112, { size: 22, weight: 800, color: C.slate, align: 'right' });
        y += accountH + gap;
    }

    // ── 회원별 납부 현황 표 ──
    text('회원별 납부 현황', PAD, y + 16, { size: 24, weight: 900, color: C.text });
    y += 44;
    // 컬럼: No / 이름 / 납부 대상 / 납부 완료 / 남은 금액 / 상태
    const cols = [
        { key: 'no', label: 'No.', w: 70, align: 'center' as CanvasTextAlign },
        { key: 'name', label: '이름', w: 250, align: 'left' as CanvasTextAlign },
        { key: 'due', label: '납부 대상', w: 190, align: 'right' as CanvasTextAlign },
        { key: 'paid', label: '납부 완료', w: 190, align: 'right' as CanvasTextAlign },
        { key: 'remain', label: '남은 금액', w: 190, align: 'right' as CanvasTextAlign },
        { key: 'status', label: '상태', w: INNER - (70 + 250 + 190 + 190 + 190), align: 'center' as CanvasTextAlign },
    ];
    // 표 헤더
    ctx.fillStyle = C.headerBg; roundRectPath(ctx, PAD, y, INNER, tableHeadH, 10); ctx.fill();
    let cx = PAD;
    for (const col of cols) {
        const tx = col.align === 'left' ? cx + 18 : col.align === 'right' ? cx + col.w - 18 : cx + col.w / 2;
        text(col.label, tx, y + tableHeadH / 2, { size: 20, weight: 900, color: C.slate, align: col.align });
        cx += col.w;
    }
    y += tableHeadH;
    const statusOf = (m: NoticeSnapshotMember): { label: string; bg: string; fg: string; bd: string } => {
        if (m.status === 'paid') return { label: '납부 완료', bg: '#E7F6EF', fg: '#047857', bd: '#A7E3C9' };
        if (m.status === 'partial') return { label: '일부 납부', bg: '#FEF3D7', fg: '#92400E', bd: '#F4D58A' };
        return { label: '미납', bg: '#FCE4E4', fg: '#B91C1C', bd: '#F3B4B4' };
    };
    input.members.forEach((m, i) => {
        if (i % 2 === 1) { ctx.fillStyle = C.rowAlt; ctx.fillRect(PAD, y, INNER, tableRowH); }
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD, y + tableRowH); ctx.lineTo(W - PAD, y + tableRowH); ctx.stroke();
        const midY = y + tableRowH / 2;
        cx = PAD;
        const cellText = (val: string, col: typeof cols[number], color: string, weight = 800, size = 22) => {
            const tx = col.align === 'left' ? cx + 18 : col.align === 'right' ? cx + col.w - 18 : cx + col.w / 2;
            if (col.key === 'name') fit(val, tx, midY, col.w - 24, { size, weight, color, align: col.align });
            else text(val, tx, midY, { size, weight, color, align: col.align });
        };
        cellText(String(i + 1), cols[0], C.muted, 800, 20); cx += cols[0].w;
        cellText(m.displayName, cols[1], C.text, 900, 23); cx += cols[1].w;
        cellText(formatWon(m.amountDue), cols[2], C.slate, 800, 21); cx += cols[2].w;
        cellText(formatWon(m.amountPaid), cols[3], C.teal, 800, 21); cx += cols[3].w;
        cellText(formatWon(m.remainingAmount), cols[4], m.remainingAmount > 0 ? C.red : C.muted, 900, 21); cx += cols[4].w;
        const st = statusOf(m);
        pill(st.label, cx + cols[5].w / 2, midY, st.bg, st.fg, st.bd);
        y += tableRowH;
    });
    y += 24 + gap;

    // ── 이전 월 이월 미납 / 연회비 납부 완료 (좌우 2단) ──
    if (sideH > 0) {
        const colGap = 24;
        const halfW = (INNER - colGap) / 2;
        const leftX = PAD;
        const rightX = PAD + halfW + colGap;
        const startY = y;

        if (hasPrior) {
            text('이전 월 이월 미납', leftX, startY + 16, { size: 22, weight: 900, color: C.text });
            let yy = startY + sideTitleH;
            for (const g of priorGroups) {
                const monthsLabel = `${g.months[0].targetYear}년 ${g.months.map((mm) => `${mm.targetMonth}월`).join(', ')}`;
                text(g.displayName, leftX + 6, yy + priorRowH / 2 - 12, { size: 21, weight: 900, color: C.text });
                text(monthsLabel, leftX + 6, yy + priorRowH / 2 + 14, { size: 17, weight: 700, color: C.muted });
                text(formatWon(g.totalRemaining), leftX + halfW - 6, yy + priorRowH / 2, { size: 22, weight: 900, color: C.red, align: 'right' });
                ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(leftX, yy + priorRowH); ctx.lineTo(leftX + halfW, yy + priorRowH); ctx.stroke();
                yy += priorRowH;
            }
        }
        if (annualNames.length > 0) {
            text('연회비 납부 완료', rightX, startY + 16, { size: 22, weight: 900, color: C.teal });
            let yy = startY + sideTitleH;
            for (let i = 0; i < annualNames.length; i += 2) {
                const a = annualNames[i];
                const b = annualNames[i + 1];
                text(`· ${a}`, rightX + 6, yy + 18, { size: 21, weight: 800, color: C.tealSoft });
                if (b) text(`· ${b}`, rightX + halfW / 2 + 6, yy + 18, { size: 21, weight: 800, color: C.tealSoft });
                yy += 36;
            }
        }
        y = startY + sideH + gap;
    }

    // ── 금액 요약 ──
    const sumCellW = (INNER - 2 * 8) / 3;
    const amtCell = (col: number, label: string, value: number, strong: boolean) => {
        const ax = PAD + col * (sumCellW + 8);
        ctx.fillStyle = strong ? '#FFF1F1' : C.headerBg; roundRectPath(ctx, ax, y, sumCellW, amountSummaryH - 8, 12); ctx.fill();
        ctx.strokeStyle = strong ? '#F3B4B4' : C.border; ctx.lineWidth = 1.5; roundRectPath(ctx, ax, y, sumCellW, amountSummaryH - 8, 12); ctx.stroke();
        text(label, ax + sumCellW / 2, y + 38, { size: 20, weight: 800, color: C.muted, align: 'center' });
        text(formatWon(value), ax + sumCellW / 2, y + 78, { size: 30, weight: 900, color: value > 0 ? C.red : C.teal, align: 'center' });
    };
    amtCell(0, `${input.targetMonth}월 남은 금액`, input.stats.totalRemaining, false);
    amtCell(1, '이전 월 미납', priorRemaining, false);
    amtCell(2, '현재 전체 미납', overall, true);
    y += amountSummaryH + gap;

    // ── 푸터 브랜드 ──
    text('TEYEON TENNIS CLUB', W / 2, y + 30, { size: 24, weight: 900, color: C.text, align: 'center' });
    text('함께하는 테니스, 함께 성장하는 클럽', W / 2, y + 66, { size: 19, weight: 700, color: C.muted, align: 'center' });

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Failed to create finance notice image.')), 'image/png', 0.96);
    });
}

// ── 공유 오케스트레이션 ──────────────────────────────────────────────────────
export type FinanceShareResult = 'shared' | 'downloaded-copied' | 'downloaded' | 'failed';

/**
 * 이미지 공유 — Web Share API 파일 공유 우선(이미지 + 링크 문구), 미지원 시 PNG 저장 + 링크 클립보드 복사.
 */
export async function shareFinanceNoticeImage(
    blob: Blob,
    fileName: string,
    opts: { title: string; text: string; url: string },
): Promise<FinanceShareResult> {
    try {
        const file = new File([blob], fileName, { type: 'image/png' });
        const shareData = { files: [file], title: opts.title, text: opts.text } as ShareData & { files: File[] };
        const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { canShare?: (d?: ShareData & { files?: File[] }) => boolean }) | undefined;
        if (nav && typeof nav.share === 'function' && (!nav.canShare || nav.canShare(shareData))) {
            try {
                await nav.share(shareData);
                return 'shared';
            } catch (e: unknown) {
                if ((e as { name?: string })?.name === 'AbortError') return 'shared';
                // 그 외엔 폴백.
            }
        }
        downloadImageBlob(blob, fileName);
        const copied = await copyTextSafe(opts.url);
        return copied ? 'downloaded-copied' : 'downloaded';
    } catch (e) {
        console.warn('[Finance/notice/shareImage]', e);
        return 'failed';
    }
}
