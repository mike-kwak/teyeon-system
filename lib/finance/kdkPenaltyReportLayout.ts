// KDK 누적 벌금 이미지 리포트 — 페이지 레이아웃(순수 함수, DOM·DB 미접속).
//
//   - 데이터는 공유 V1 의 buildPenaltyShareContent 결과(PenaltyShareContent)를 그대로 쓴다. 새 금액 계산 없음.
//   - 출력 기준 폭 1080(논리 px). 한 장 최대 높이 MAX_PAGE_HEIGHT 를 넘으면 "행 단위"로 다음 장에 이어 그린다.
//     → 명단을 자르거나 상위 N명만 표시하지 않는다. 행은 쪼개지지 않고, 섹션 제목은 첫 행과 함께 넘어간다.
//   - 각 장: 브랜드 헤더(1장은 큰 헤더) · 조회 기간 · 페이지 번호 · 하단 TEYEON · SINCE 2024.
//   - 실제 그리기는 components/finance/kdkPenaltyReportCanvas.ts 가 이 명세대로 한다(높이도 이 값 그대로).

import { STATS_NOTES, type PenaltyShareContent, type ShareLine, type ShareTab } from './kdkPenaltyHistoryShare';
import { STATS_VIEW_LABEL, type StatsOverview, type StatsView } from './kdkPenaltyStatsModel';

export const REPORT_WIDTH = 1080;
export const MAX_PAGE_HEIGHT = 1920;
export const REPORT_PADDING = 56;

export const H = {
    headerFirst: 262,
    headerCont: 168,
    kpi: 452,
    kpiNoSplit: 368,
    // 표 가독성(카카오톡 확대 없이 읽히도록): 섹션 제목 + 표 머리 124, 행 88. 렌더러가 이 값 그대로 그린다.
    sectionHeader: 124,
    row: 88,
    empty: 88,
    sectionGap: 28,
    notes: 196,
    /** V6: 안내 4줄 초과 시 줄당 추가 높이. */
    noteLine: 30,
    /** V6: 금액 외 표시 방식의 회원 참가 · 벌금 발생 개요 띠(KPI 아래). */
    statsStrip: 96,
    pageFooter: 96,
} as const;

export type ReportBlock =
    | { type: 'kpi'; height: number }
    | { type: 'section'; side: 'member' | 'guest'; count: number; continued: boolean; height: number }
    | { type: 'row'; side: 'member' | 'guest'; index: number; line: ShareLine; height: number }
    | { type: 'empty'; side: 'member' | 'guest'; height: number }
    | { type: 'gap'; height: number }
    | { type: 'notes'; lines: string[]; height: number };

export interface ReportPage {
    pageNo: number;
    pageCount: number;
    first: boolean;
    blocks: ReportBlock[];
    /** 논리 px 높이(헤더 + 블록 + 하단). */
    height: number;
}

export interface ReportKpi {
    billable: number;
    paid: number;
    unpaid: number;
    /** 0~1, 청구 대상 0 이면 null(화면 formatRate 와 같은 값). */
    paidRate: number | null;
    memberBillable: number;
    guestBillable: number;
    excludedAmount: number;
    excludedCount: number;
    reviewAmount: number;
    reviewCount: number;
}

export interface ReportDocument {
    tab: ShareTab;
    tabLabel: string;
    /** V6 표시 방식('amount' = V5 그대로). */
    view: StatsView;
    viewLabel: string;
    /** V6 회원 참가 · 벌금 발생 개요(금액 외 표시 방식에서만). */
    stats: StatsOverview | null;
    periodText: string;
    baseDate: string;
    kpi: ReportKpi;
    /** 회원 / 게스트 명단(공유 V1 과 같은 정렬·동명 표시·비대상만 제외). */
    members: ShareLine[];
    guests: ShareLine[];
    pages: ReportPage[];
}

export const TAB_LABEL: Record<ShareTab, string> = { all: '전체', member: '회원', guest: '게스트' };

export function reportNotes(tab: ShareTab, hasGuests: boolean, withStats = false): string[] {
    const out = [
        '선택 기간 기준 KDK 벌금 정산 현황',
        '비대상 벌금은 청구 대상 집계에서 제외',
        '확인 필요 금액은 부과·미납 합계에서 제외',
    ];
    if (withStats) out.push(...STATS_NOTES);
    if (tab !== 'member' && hasGuests) out.push('게스트는 동일 이름 기준 집계(공식 개인별 누적 아님)');
    return out;
}

/** 안내 블록 높이 — 4줄까지 V5 와 같고, 넘으면 줄 수만큼 늘린다(잘림 방지). */
export function notesHeight(lineCount: number): number {
    return H.notes + Math.max(0, lineCount - 4) * H.noteLine;
}

/** 블록 흐름 → 페이지. 행·KPI·안내는 쪼개지 않는다. 섹션 제목은 다음 행과 같은 장에 둔다. */
function paginate(flow: ReportBlock[]): ReportPage[] {
    const pages: { blocks: ReportBlock[]; used: number; first: boolean }[] = [];
    const capacity = (first: boolean) => MAX_PAGE_HEIGHT - (first ? H.headerFirst : H.headerCont) - H.pageFooter;
    let cur = { blocks: [] as ReportBlock[], used: 0, first: true };
    let currentSection: Extract<ReportBlock, { type: 'section' }> | null = null;

    const newPage = () => {
        pages.push(cur);
        cur = { blocks: [], used: 0, first: false };
    };

    for (let i = 0; i < flow.length; i++) {
        const b = flow[i];
        if (b.type === 'section') currentSection = b;
        if (b.type === 'notes') currentSection = null;
        // 섹션 제목은 바로 다음 블록(첫 행/빈 행)과 함께 들어가야 한다.
        const need = b.type === 'section' && flow[i + 1] ? b.height + flow[i + 1].height : b.height;
        if (b.type === 'gap' && cur.used + b.height > capacity(cur.first)) continue; // 페이지 끝 간격은 생략.
        if (cur.blocks.length > 0 && cur.used + need > capacity(cur.first)) {
            newPage();
            if (b.type === 'gap') continue;
            // 섹션이 이어지는 중이면 새 장에 "(계속)" 제목을 다시 단다.
            if ((b.type === 'row' || b.type === 'empty') && currentSection) {
                const cont = { ...currentSection, continued: true };
                cur.blocks.push(cont);
                cur.used += cont.height;
            }
        }
        cur.blocks.push(b);
        cur.used += b.height;
    }
    if (cur.blocks.length > 0 || pages.length === 0) pages.push(cur);

    // 장 끝의 빈 간격 제거.
    for (const p of pages) {
        while (p.blocks.length && p.blocks[p.blocks.length - 1].type === 'gap') {
            p.used -= p.blocks[p.blocks.length - 1].height;
            p.blocks.pop();
        }
    }
    return pages.map((p, i) => ({
        pageNo: i + 1,
        pageCount: pages.length,
        first: i === 0,
        blocks: p.blocks,
        height: (p.first ? H.headerFirst : H.headerCont) + p.used + H.pageFooter,
    }));
}

export function buildReportDocument(content: PenaltyShareContent): ReportDocument {
    const s = content.summary;
    const kpi: ReportKpi = {
        billable: s.billableAmount,
        paid: s.paidAmount,
        unpaid: s.unpaidAmount,
        paidRate: s.paidRate,
        memberBillable: content.memberSummary.billableAmount,
        guestBillable: content.guestSummary.billableAmount,
        excludedAmount: s.excludedAmount,
        excludedCount: s.excludedCount,
        reviewAmount: s.reviewAmount,
        reviewCount: s.reviewCount,
    };

    const view: StatsView = content.view ?? 'amount';
    const stats = view !== 'amount' ? content.stats ?? null : null;
    const kpiHeight = (content.tab === 'all' ? H.kpi : H.kpiNoSplit) + (stats ? H.statsStrip : 0);
    const flow: ReportBlock[] = [{ type: 'kpi', height: kpiHeight }];
    const addSection = (side: 'member' | 'guest', lines: ShareLine[]) => {
        flow.push({ type: 'gap', height: H.sectionGap });
        flow.push({ type: 'section', side, count: lines.length, continued: false, height: H.sectionHeader });
        if (lines.length === 0) flow.push({ type: 'empty', side, height: H.empty });
        lines.forEach((line, idx) => flow.push({ type: 'row', side, index: idx + 1, line, height: H.row }));
    };
    if (content.tab !== 'guest') addSection('member', content.members);
    if (content.tab !== 'member') addSection('guest', content.guests);
    flow.push({ type: 'gap', height: H.sectionGap });
    const notes = reportNotes(content.tab, content.guests.length > 0, !!stats);
    flow.push({ type: 'notes', lines: notes, height: notesHeight(notes.length) });

    return {
        tab: content.tab,
        tabLabel: TAB_LABEL[content.tab],
        view,
        viewLabel: STATS_VIEW_LABEL[view],
        stats,
        periodText: content.periodText,
        baseDate: content.baseDate,
        kpi,
        members: content.members,
        guests: content.guests,
        pages: paginate(flow),
    };
}

/** 저장 파일명: TEYEON_KDK_Penalty_YYYY-MM-DD_01.png (기준일 · 2자리 순번). */
export function reportFileName(baseDate: string, pageNo: number): string {
    return `TEYEON_KDK_Penalty_${baseDate.replace(/\./g, '-')}_${String(pageNo).padStart(2, '0')}.png`;
}
