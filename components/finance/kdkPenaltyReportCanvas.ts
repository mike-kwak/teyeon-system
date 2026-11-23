'use client';

// KDK 누적 벌금 이미지 리포트 — Canvas 2D 렌더러(브라우저 전용, 외부 업로드·서버 요청 없음).
//   - 레이아웃(페이지 분할·높이)은 lib/finance/kdkPenaltyReportLayout.ts 명세를 그대로 따른다.
//   - 기존 RankingTab 이미지 저장과 같은 방식(Canvas 2D → toBlob PNG). 추가 라이브러리 없음.
//   - 로고는 같은 출처 정적 파일만 사용(캔버스 오염 없음). 3초 안에 못 불러오면 텍스트 로고로 대체.

import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    H,
    REPORT_PADDING as PAD,
    REPORT_WIDTH as W,
    type ReportBlock,
    type ReportDocument,
    type ReportPage,
} from '@/lib/finance/kdkPenaltyReportLayout';
import { STATS_SECTION_LABEL, type ShareLine } from '@/lib/finance/kdkPenaltyHistoryShare';
import { formatPenaltyRate, type StatsView } from '@/lib/finance/kdkPenaltyStatsModel';
import { formatRate } from './KdkPenaltyHistoryUI';

export const REPORT_SCALE = 2;
const LOGO_SRC = '/logos/teyeon-logo-transparent-512.png';
const FONT = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Segoe UI", sans-serif';

const C = {
    bg: '#EEF2F7',
    card: '#FFFFFF',
    border: '#DCE3EC',
    navy: '#0F172A',
    teal: '#0F9F98',
    tealDark: '#0E7C76',
    slate: '#64748B',
    slateLight: '#94A3B8',
    red: '#B91C1C',
    amber: '#92400E',
    tableHead: '#E6ECF3',
    rowAlt: '#F8FAFC',
};

const CW = W - PAD * 2; // 콘텐츠 폭
// 표 열(콘텐츠 좌측 기준 x, 폭). 금액 열을 넓혀 큰 글자에서도 7자리 금액이 줄지 않게 한다.
const COL = { idx: { x: 0, w: 56 }, name: { x: 66, w: 340 }, billable: { x: 412, w: 184 }, paid: { x: 598, w: 184 }, unpaid: { x: 784, w: 184 } };
// 표 글자 크기(논리 px, 출력은 ×2)
const T = { head: 22, index: 24, name: 34, nameMin: 26, name2: 26, name2Min: 20, amount: 31, amountMin: 22, review: 18, sectionTitle: 32, empty: 24 };

// V6 통계 표(회원 · 금액 외 표시 방식): # | 회원 | 지표 4열. 모드의 중심 지표를 이름 바로 옆에 두고 강조한다.
//   글자 크기는 V5 와 같다(가로로 억지로 줄이지 않음). 이름이 넘치면 V5 와 같이 2줄로 그린다.
type StatKey = 'amount' | 'participation' | 'penalty' | 'rate';
const STAT_W: Record<StatKey, number> = { amount: 200, participation: 128, penalty: 128, rate: 140 };
const STAT_HEAD: Record<StatKey, string> = { amount: '누적 벌금', participation: '참가', penalty: '벌금 발생', rate: '발생률' };
const STAT_ORDER: Record<Exclude<StatsView, 'amount'>, StatKey[]> = {
    summary: ['amount', 'participation', 'penalty', 'rate'],
    participation: ['participation', 'penalty', 'rate', 'amount'],
    penalty: ['penalty', 'participation', 'rate', 'amount'],
};
const STAT_NAME_X = 66;
function statColumns(view: Exclude<StatsView, 'amount'>): { key: StatKey; x: number; w: number }[] {
    const keys = STAT_ORDER[view];
    const total = keys.reduce((a, k) => a + STAT_W[k], 0);
    let x = CW - total;
    return keys.map((key) => { const c = { key, x, w: STAT_W[key] }; x += STAT_W[key]; return c; });
}
function statNameWidth(view: Exclude<StatsView, 'amount'>): number {
    return statColumns(view)[0].x - STAT_NAME_X - 8;
}
/** 회원 줄 + 금액 외 표시 방식이면 통계 표로 그린다. */
function statsViewOf(view: StatsView | undefined, side: 'member' | 'guest', line?: ShareLine): Exclude<StatsView, 'amount'> | null {
    if (!view || view === 'amount' || side !== 'member') return null;
    if (line && line.participation == null) return null;
    return view;
}

export function loadReportLogo(timeoutMs = 3000): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (v: HTMLImageElement | null) => { if (!done) { done = true; resolve(v); } };
        const t = setTimeout(() => finish(null), timeoutMs);
        img.onload = () => { clearTimeout(t); finish(img.naturalWidth > 0 ? img : null); };
        img.onerror = () => { clearTimeout(t); finish(null); };
        img.src = LOGO_SRC;
    });
}

type Ctx = CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, weight: number | string = 800) {
    ctx.font = `${weight} ${size}px ${FONT}`;
}

/** 폭에 맞춰 글자 크기를 줄이고(최소 minSize), 그래도 넘치면 말줄임. 실제 사용한 크기를 반환. */
function fitText(ctx: Ctx, text: string, maxW: number, size: number, minSize: number, weight: number | string = 800): { text: string; size: number } {
    let s = size;
    font(ctx, s, weight);
    while (ctx.measureText(text).width > maxW && s > minSize) { s -= 1; font(ctx, s, weight); }
    if (ctx.measureText(text).width <= maxW) return { text, size: s };
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return { text: `${t}…`, size: s };
}

function text(ctx: Ctx, str: string, x: number, y: number, o: { size: number; weight?: number | string; color: string; align?: CanvasTextAlign; maxW?: number; minSize?: number }) {
    ctx.fillStyle = o.color;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'middle';
    if (o.maxW) {
        const f = fitText(ctx, str, o.maxW, o.size, o.minSize ?? Math.round(o.size * 0.7), o.weight ?? 800);
        font(ctx, f.size, o.weight ?? 800);
        ctx.fillText(f.text, x, y);
        return;
    }
    font(ctx, o.size, o.weight ?? 800);
    ctx.fillText(str, x, y);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function drawLogo(ctx: Ctx, logo: HTMLImageElement | null, x: number, y: number, size: number) {
    if (logo) { ctx.drawImage(logo, x, y, size, size); return; }
    // 텍스트 로고 대체
    roundRect(ctx, x, y, size, size, size * 0.22, C.navy);
    text(ctx, 'T', x + size / 2, y + size / 2 + 1, { size: Math.round(size * 0.56), weight: 900, color: '#FFFFFF', align: 'center' });
}

function drawHeader(ctx: Ctx, doc: ReportDocument, page: ReportPage, logo: HTMLImageElement | null) {
    ctx.fillStyle = C.teal;
    ctx.fillRect(0, 0, W, 8);
    if (page.first) {
        drawLogo(ctx, logo, PAD, 40, 68);
        text(ctx, 'TEYEON TENNIS CLUB', PAD + 84, 62, { size: 25, weight: 900, color: C.navy });
        text(ctx, 'OFFICIAL FINANCE REPORT', PAD + 84, 92, { size: 16, weight: 800, color: C.tealDark });
        text(ctx, 'SINCE 2024', W - PAD, 62, { size: 18, weight: 800, color: C.slateLight, align: 'right' });
        drawTabChip(ctx, chipLabel(doc), W - PAD, 92);
        text(ctx, 'KDK 누적 벌금 리포트', PAD, 160, { size: 52, weight: 900, color: C.navy, maxW: CW, minSize: 40 });
        text(ctx, `조회 기간  ${doc.periodText}`, PAD, 214, { size: 23, weight: 700, color: C.slate });
        text(ctx, `기준일  ${doc.baseDate}`, W - PAD, 214, { size: 23, weight: 700, color: C.slate, align: 'right' });
        hr(ctx, H.headerFirst - 14);
    } else {
        drawLogo(ctx, logo, PAD, 34, 48);
        text(ctx, 'TEYEON TENNIS CLUB', PAD + 62, 50, { size: 20, weight: 900, color: C.navy });
        text(ctx, 'KDK 누적 벌금 리포트', PAD + 62, 74, { size: 16, weight: 800, color: C.tealDark });
        drawTabChip(ctx, chipLabel(doc), W - PAD, 58);
        text(ctx, `조회 기간  ${doc.periodText}`, PAD, 124, { size: 21, weight: 700, color: C.slate });
        text(ctx, `${page.pageNo} / ${page.pageCount}`, W - PAD, 124, { size: 21, weight: 900, color: C.navy, align: 'right' });
        hr(ctx, H.headerCont - 14);
    }
}

/** 탭 칩: V5(금액) = '전체' 등 그대로, V6 통계 = '전체 · 종합'. */
function chipLabel(doc: ReportDocument): string {
    return doc.view && doc.view !== 'amount' ? `${doc.tabLabel} · ${doc.viewLabel}` : doc.tabLabel;
}

function drawTabChip(ctx: Ctx, label: string, right: number, cy: number) {
    font(ctx, 17, 900);
    const w = ctx.measureText(label).width + 28;
    roundRect(ctx, right - w, cy - 17, w, 34, 8, '#DDF3F1');
    text(ctx, label, right - w / 2, cy + 1, { size: 17, weight: 900, color: C.tealDark, align: 'center' });
}

function hr(ctx: Ctx, y: number) {
    ctx.fillStyle = C.border;
    ctx.fillRect(PAD, y, CW, 2);
}

function drawKpi(ctx: Ctx, doc: ReportDocument, y: number) {
    const k = doc.kpi;
    const gap = 20, cw = (CW - gap) / 2, ch = 136;
    const cards: { label: string; value: string; sub: string; color: string }[] = [
        { label: '총 부과액', value: formatWon(k.billable), sub: '청구 대상 금액', color: C.navy },
        { label: '납부 완료액', value: formatWon(k.paid), sub: '유효 납부 합계', color: C.tealDark },
        { label: '미납액', value: formatWon(k.unpaid), sub: '미납 잔액', color: k.unpaid > 0 ? C.red : C.navy },
        { label: '납부율', value: formatRate(k.paidRate), sub: '부과액 대비 납부', color: C.tealDark },
    ];
    cards.forEach((c, i) => {
        const x = PAD + (i % 2) * (cw + gap);
        const cy = y + Math.floor(i / 2) * (ch + gap);
        roundRect(ctx, x, cy, cw, ch, 14, C.card, C.border);
        text(ctx, c.label, x + 26, cy + 34, { size: 21, weight: 800, color: C.slate });
        text(ctx, c.value, x + 26, cy + 80, { size: 44, weight: 900, color: c.color, maxW: cw - 52, minSize: 30 });
        text(ctx, c.sub, x + 26, cy + 116, { size: 16, weight: 700, color: C.slateLight });
    });
    let yy = y + ch * 2 + gap * 2;
    if (doc.tab === 'all') {
        const pills = [
            { label: '회원 부과액', value: formatWon(k.memberBillable) },
            { label: '게스트 청구 대상액', value: formatWon(k.guestBillable) },
        ];
        pills.forEach((p, i) => {
            const x = PAD + i * (cw + gap);
            roundRect(ctx, x, yy, cw, 64, 12, C.card, C.border);
            text(ctx, p.label, x + 24, yy + 33, { size: 20, weight: 800, color: C.slate });
            text(ctx, p.value, x + cw - 24, yy + 33, { size: 26, weight: 900, color: C.navy, align: 'right', maxW: cw * 0.5, minSize: 18 });
        });
        yy += 64 + gap;
    }
    const ex = `비대상 ${formatWon(k.excludedAmount)}${k.excludedCount ? ` (${k.excludedCount}건)` : ''}`;
    const rv = `확인 필요 ${formatWon(k.reviewAmount)}${k.reviewCount ? ` (${k.reviewCount}건)` : ''}`;
    text(ctx, `${ex}   ·   ${rv}   — 부과·미납 합계 미포함`, PAD + 4, yy + 20, { size: 19, weight: 700, color: k.reviewAmount > 0 ? C.amber : C.slate, maxW: CW - 8, minSize: 15 });
    if (doc.stats) drawStatsStrip(ctx, doc, yy + 44);
}

/** V6: 회원 참가 · 벌금 발생 개요 띠(H.statsStrip 안에 그린다). */
function drawStatsStrip(ctx: Ctx, doc: ReportDocument, y: number) {
    const s = doc.stats;
    if (!s) return;
    const cells = [
        { label: '공식 KDK 세션', value: `${s.sessionCount.toLocaleString('ko-KR')}회` },
        { label: '회원 참가(연인원)', value: `${s.memberParticipations.toLocaleString('ko-KR')}회` },
        { label: '회원 벌금 발생', value: `${s.memberPenalties.toLocaleString('ko-KR')}회` },
        { label: '벌금 발생률', value: formatPenaltyRate(s.memberPenaltyRate) },
    ];
    const h = 80;
    roundRect(ctx, PAD, y, CW, h, 12, C.card, C.border);
    const cw = CW / cells.length;
    cells.forEach((c, i) => {
        const x = PAD + i * cw;
        if (i > 0) { ctx.fillStyle = C.border; ctx.fillRect(x, y + 16, 1.5, h - 32); }
        text(ctx, c.label, x + cw / 2, y + 26, { size: 17, weight: 800, color: C.slate, align: 'center', maxW: cw - 16, minSize: 13 });
        text(ctx, c.value, x + cw / 2, y + 56, { size: 28, weight: 900, color: i === 3 ? C.tealDark : C.navy, align: 'center', maxW: cw - 16, minSize: 20 });
    });
}

function drawSection(ctx: Ctx, b: Extract<ReportBlock, { type: 'section' }>, y: number, view: StatsView = 'amount') {
    const sv = statsViewOf(view, b.side);
    const title = sv ? `회원별 ${STATS_SECTION_LABEL[sv]}` : b.side === 'member' ? '회원별 누적 벌금' : '게스트별 누적 벌금';
    ctx.fillStyle = C.teal;
    ctx.fillRect(PAD, y + 18, 6, 32);
    text(ctx, b.continued ? `${title} (계속)` : title, PAD + 18, y + 35, { size: T.sectionTitle, weight: 900, color: C.navy });
    text(ctx, `${b.count}${b.side === 'member' ? '명' : '개 이름'}`, W - PAD, y + 35, { size: 22, weight: 800, color: C.slate, align: 'right' });
    const ty = y + 66;
    roundRect(ctx, PAD, ty, CW, 54, 10, C.tableHead);
    if (sv) {
        text(ctx, '#', PAD + COL.idx.x + COL.idx.w / 2, ty + 28, { size: T.head, weight: 800, color: C.slate, align: 'center' });
        text(ctx, '회원', PAD + STAT_NAME_X, ty + 28, { size: T.head, weight: 800, color: C.slate });
        statColumns(sv).forEach((c, i) => text(ctx, STAT_HEAD[c.key], PAD + c.x + c.w - 14, ty + 28, {
            size: T.head, weight: i === 0 ? 900 : 800, color: i === 0 ? C.tealDark : C.slate, align: 'right',
        }));
        return;
    }
    const head = [
        { s: '#', c: COL.idx, align: 'center' as const },
        { s: b.side === 'member' ? '회원' : '게스트', c: COL.name, align: 'left' as const },
        { s: b.side === 'member' ? '부과' : '청구 대상', c: COL.billable, align: 'right' as const },
        { s: '납부', c: COL.paid, align: 'right' as const },
        { s: '미납', c: COL.unpaid, align: 'right' as const },
    ];
    for (const h of head) {
        const x = h.align === 'center' ? PAD + h.c.x + h.c.w / 2 : h.align === 'right' ? PAD + h.c.x + h.c.w - 14 : PAD + h.c.x;
        text(ctx, h.s, x, ty + 28, { size: T.head, weight: 800, color: C.slate, align: h.align });
    }
}

/** 이름을 1줄(큰 글자) → 2줄(작은 글자) 순으로 맞춘다. 2줄로도 넘치면 둘째 줄 말줄임. */
function fitName(ctx: Ctx, name: string, maxW: number, allowTwoLines: boolean): { lines: string[]; size: number } {
    const one = fitText(ctx, name, maxW, T.name, T.nameMin, 800);
    if (one.text === name || !allowTwoLines) {
        if (one.text === name) return { lines: [name], size: one.size };
        const tight = fitText(ctx, name, maxW, T.nameMin, T.name2Min, 800);
        return { lines: [tight.text], size: tight.size };
    }
    for (let s = T.name2; s >= T.name2Min; s--) {
        font(ctx, s, 800);
        // 앞줄에 최대한 담고 나머지를 둘째 줄로(글자 단위 — 한글 이름은 공백이 거의 없다).
        let cut = name.length;
        while (cut > 1 && ctx.measureText(name.slice(0, cut)).width > maxW) cut--;
        const rest = name.slice(cut);
        if (ctx.measureText(rest).width <= maxW) return { lines: [name.slice(0, cut), rest], size: s };
    }
    font(ctx, T.name2Min, 800);
    let cut = name.length;
    while (cut > 1 && ctx.measureText(name.slice(0, cut)).width > maxW) cut--;
    const second = fitText(ctx, name.slice(cut), maxW, T.name2Min, T.name2Min, 800);
    return { lines: [name.slice(0, cut), second.text], size: T.name2Min };
}

function drawRow(ctx: Ctx, line: ShareLine, index: number, y: number, view: StatsView = 'amount', side: 'member' | 'guest' = 'member') {
    if (index % 2 === 0) { ctx.fillStyle = C.rowAlt; ctx.fillRect(PAD, y, CW, H.row); }
    ctx.fillStyle = '#E8EDF3';
    ctx.fillRect(PAD, y + H.row - 1, CW, 1);
    const cy = y + H.row / 2;
    text(ctx, String(index), PAD + COL.idx.x + COL.idx.w / 2, cy, { size: T.index, weight: 800, color: C.slateLight, align: 'center' });
    const sv = statsViewOf(view, side, line);
    if (sv) { drawStatsRow(ctx, line, sv, cy); return; }
    // 이름: 1줄 34px(최소 26) → 넘치면 2줄 26px(최소 20). 확인 필요 표기가 있으면 1줄 + 아래 작은 줄.
    const hasReview = line.review > 0;
    const nm = fitName(ctx, line.name, COL.name.w, !hasReview);
    const nx = PAD + COL.name.x;
    if (nm.lines.length === 2) {
        const lh = nm.size + 6;
        nm.lines.forEach((l, i) => text(ctx, l, nx, cy + (i === 0 ? -lh / 2 : lh / 2), { size: nm.size, weight: 800, color: C.navy }));
    } else {
        text(ctx, nm.lines[0], nx, hasReview ? cy - 13 : cy, { size: nm.size, weight: 800, color: C.navy });
    }
    if (hasReview) text(ctx, `확인 필요 ${formatWon(line.review)} (합계 미포함)`, nx, cy + 22, { size: T.review, weight: 700, color: C.amber, maxW: COL.name.w, minSize: 14 });
    const amt = (v: number, c: { x: number; w: number }, color: string, weight = 800) =>
        text(ctx, formatWon(v), PAD + c.x + c.w - 14, cy, { size: T.amount, weight, color, align: 'right', maxW: c.w - 20, minSize: T.amountMin });
    amt(line.billable, COL.billable, C.navy);
    amt(line.paid, COL.paid, C.tealDark);
    amt(line.unpaid, COL.unpaid, line.unpaid > 0 ? C.red : C.slateLight, line.unpaid > 0 ? 900 : 700);
}

/** V6 통계 행: 이름(1줄 → 2줄) + 지표 4열(오른쪽 정렬 · 천 단위 쉼표). 중심 지표는 굵게. */
function drawStatsRow(ctx: Ctx, line: ShareLine, view: Exclude<StatsView, 'amount'>, cy: number) {
    const nameW = statNameWidth(view);
    const hasReview = line.review > 0;
    const nm = fitName(ctx, line.name, nameW, !hasReview);
    const nx = PAD + STAT_NAME_X;
    if (nm.lines.length === 2) {
        const lh = nm.size + 6;
        nm.lines.forEach((l, i) => text(ctx, l, nx, cy + (i === 0 ? -lh / 2 : lh / 2), { size: nm.size, weight: 800, color: C.navy }));
    } else {
        text(ctx, nm.lines[0], nx, hasReview ? cy - 13 : cy, { size: nm.size, weight: 800, color: C.navy });
    }
    if (hasReview) text(ctx, `확인 필요 ${formatWon(line.review)} (합계 미포함)`, nx, cy + 22, { size: T.review, weight: 700, color: C.amber, maxW: nameW, minSize: 14 });
    const value = (k: StatKey): string => k === 'amount' ? formatWon(line.billable)
        : k === 'participation' ? `${(line.participation ?? 0).toLocaleString('ko-KR')}회`
            : k === 'penalty' ? `${(line.penaltyCount ?? 0).toLocaleString('ko-KR')}회`
                : formatPenaltyRate(line.penaltyRate ?? null);
    statColumns(view).forEach((c, i) => {
        const color = i === 0 ? C.navy : c.key === 'rate' ? C.slate : '#334155';
        text(ctx, value(c.key), PAD + c.x + c.w - 14, cy, { size: T.amount, weight: i === 0 ? 900 : 700, color, align: 'right', maxW: c.w - 20, minSize: T.amountMin });
    });
}

function drawEmpty(ctx: Ctx, side: 'member' | 'guest', y: number, view: StatsView = 'amount') {
    ctx.fillStyle = C.card;
    ctx.fillRect(PAD, y, CW, H.empty);
    text(ctx, side === 'member' ? (statsViewOf(view, side) ? '해당 기간 회원 참가 기록 없음' : '해당 기간 회원 벌금 기록 없음') : '해당 기간 게스트 벌금 기록 없음', W / 2, y + H.empty / 2, { size: T.empty, weight: 700, color: C.slateLight, align: 'center' });
}

function drawNotes(ctx: Ctx, lines: string[], y: number) {
    roundRect(ctx, PAD, y, CW, H.notes - 8, 12, C.card, C.border);
    text(ctx, '안내', PAD + 24, y + 34, { size: 20, weight: 900, color: C.navy });
    lines.forEach((l, i) => text(ctx, `·  ${l}`, PAD + 24, y + 72 + i * 30, { size: 18, weight: 700, color: C.slate, maxW: CW - 48, minSize: 14 }));
}

function drawFooter(ctx: Ctx, page: ReportPage) {
    const y = page.height - H.pageFooter;
    hr(ctx, y + 14);
    text(ctx, 'TEYEON · SINCE 2024', PAD, y + 54, { size: 18, weight: 900, color: C.slate });
    text(ctx, 'KDK 누적 벌금 리포트', W / 2, y + 54, { size: 16, weight: 700, color: C.slateLight, align: 'center' });
    text(ctx, `${page.pageNo} / ${page.pageCount}`, W - PAD, y + 54, { size: 20, weight: 900, color: C.navy, align: 'right' });
}

/** 한 장을 캔버스에 그린다(논리 px 좌표, scale 배율). */
export function drawReportPage(canvas: HTMLCanvasElement, doc: ReportDocument, page: ReportPage, logo: HTMLImageElement | null, scale = REPORT_SCALE) {
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(page.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context is unavailable.');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, page.height);
    drawHeader(ctx, doc, page, logo);
    let y = page.first ? H.headerFirst : H.headerCont;
    for (const b of page.blocks) {
        switch (b.type) {
            case 'kpi': drawKpi(ctx, doc, y + 8); break;
            case 'section': drawSection(ctx, b, y, doc.view); break;
            case 'row': drawRow(ctx, b.line, b.index, y, doc.view, b.side); break;
            case 'empty': drawEmpty(ctx, b.side, y, doc.view); break;
            case 'notes': drawNotes(ctx, b.lines, y); break;
            case 'gap': break;
        }
        y += b.height;
    }
    drawFooter(ctx, page);
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 변환에 실패했습니다.'))), 'image/png');
    });
}

/** 전체 장을 PNG Blob 으로. 폰트 로딩 완료 후 그린다. */
export async function renderReportPngs(doc: ReportDocument, scale = REPORT_SCALE): Promise<Blob[]> {
    if (typeof document !== 'undefined' && document.fonts?.ready) {
        try { await document.fonts.ready; } catch { /* 폰트 대기 실패는 시스템 폰트로 진행 */ }
    }
    const logo = await loadReportLogo();
    const out: Blob[] = [];
    for (const page of doc.pages) {
        const canvas = document.createElement('canvas');
        drawReportPage(canvas, doc, page, logo, scale);
        out.push(await canvasToPng(canvas));
        canvas.width = 0; canvas.height = 0; // 메모리 해제(Safari 캔버스 메모리 한도 대비).
    }
    return out;
}
