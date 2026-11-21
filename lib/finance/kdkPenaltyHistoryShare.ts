// KDK 누적 벌금 현황 — 공유 텍스트(카카오톡 붙여넣기용) 생성. 순수 함수, DB 미접속.
//
// 원칙:
//   - 새 계산식 없음. 화면과 같은 함수(inPeriod · summarizeRecords · aggregateMembers · groupGuestsByName)만 쓴다.
//     → 공유 금액 = 화면 요약 카드 금액(총 부과액 = billableAmount, 납부 완료 = paidAmount, 미납 = unpaidAmount).
//   - 대상은 선택 기간의 "전체" 집계. 화면의 검색어·더보기(페이지 단위 표시)는 반영하지 않는다.
//   - 포함: 회원 표시 이름 · 게스트 표시 이름 · 부과/납부/미납 · 기간 · 기준일.
//     제외: 내부 ID · 연락처 · 메모 · 세션 ID 등 원본 식별값(레코드의 이름·금액 필드만 읽는다).
//   - 비대상(not_target · exempt)은 기존 집계 정책대로 부과·미납에서 제외. 비대상만 있는 사람은 목록에서 뺀다.

import { formatWon } from './formatFinanceAmount';
import {
    aggregateMembers,
    groupGuestsByName,
    inPeriod,
    summarizeRecords,
    type PenaltyHistoryRecord,
    type PenaltyHistorySummary,
    type PeriodRange,
} from './kdkPenaltyHistoryModel';

export type ShareTab = 'all' | 'member' | 'guest';

export interface ShareLine {
    name: string;
    billable: number;
    paid: number;
    unpaid: number;
    review: number;
}

export interface PenaltyShareContent {
    tab: ShareTab;
    periodText: string;
    baseDate: string;
    /** 탭 범위 요약(전체 탭 = 회원 + 게스트). */
    summary: PenaltyHistorySummary;
    memberSummary: PenaltyHistorySummary;
    guestSummary: PenaltyHistorySummary;
    members: ShareLine[];
    guests: ShareLine[];
}

export const SHARE_TITLE = 'TEYEON KDK 누적 벌금 현황';

const dot = (d: string) => d.replace(/-/g, '.');

/** 공유 기준일 — 생성 시점의 기기 로컬 날짜 'YYYY.MM.DD'. */
export function localBaseDate(now: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}.${p(now.getMonth() + 1)}.${p(now.getDate())}`;
}

/** 조회 기간 표기. 양끝이 열려 있으면 '전체 기간'. */
export function sharePeriodText(range: PeriodRange): string {
    if (!range.from && !range.to) return '전체 기간';
    return `${range.from ? dot(range.from) : '처음'} ~ ${range.to ? dot(range.to) : '현재'}`;
}

/** 미납 내림차순 → 부과 내림차순 → 이름 → 원래 순서(안정). */
function sortLines<T extends ShareLine>(lines: T[]): T[] {
    return lines
        .map((l, i) => ({ l, i }))
        .sort((a, b) => (b.l.unpaid - a.l.unpaid)
            || (b.l.billable - a.l.billable)
            || a.l.name.localeCompare(b.l.name, 'ko')
            || (a.i - b.i))
        .map((x) => x.l);
}

/** 공유할 금액이 하나라도 있는 줄만(비대상만 있는 줄 제외). */
const hasShareableAmount = (l: ShareLine) => l.billable > 0 || l.paid > 0 || l.unpaid > 0 || l.review > 0;

/** 동명이인(서로 다른 회원)은 합치지 않고 이름 뒤에 구분 표시를 붙인다. */
function markHomonyms(lines: ShareLine[]): ShareLine[] {
    const count = new Map<string, number>();
    for (const l of lines) count.set(l.name, (count.get(l.name) || 0) + 1);
    const seen = new Map<string, number>();
    return lines.map((l) => {
        if ((count.get(l.name) || 0) < 2) return l;
        const n = (seen.get(l.name) || 0) + 1;
        seen.set(l.name, n);
        return { ...l, name: `${l.name} (동명 ${n})` };
    });
}

export function buildPenaltyShareContent(
    allRecords: PenaltyHistoryRecord[],
    range: PeriodRange,
    tab: ShareTab,
    now: Date = new Date(),
): PenaltyShareContent {
    const periodRecords = allRecords.filter((r) => inPeriod(r.sessionDate, range));
    const memberRecords = periodRecords.filter((r) => r.side === 'member');
    const guestRecords = periodRecords.filter((r) => r.side === 'guest');
    const tabRecords = tab === 'all' ? periodRecords : tab === 'member' ? memberRecords : guestRecords;

    const members = tab === 'guest' ? [] : markHomonyms(sortLines(
        aggregateMembers(memberRecords)
            .map((m) => ({ name: m.name, billable: m.billableAmount, paid: m.paidAmount, unpaid: m.unpaidAmount, review: m.reviewAmount }))
            .filter(hasShareableAmount),
    ));
    const guestGroups = tab === 'member' ? [] : groupGuestsByName(guestRecords);
    const knownGuests = sortLines(guestGroups.filter((g) => !g.unknown).map(toGuestLine).filter(hasShareableAmount));
    const unknownGuests = guestGroups.filter((g) => g.unknown).map(toGuestLine).filter(hasShareableAmount);

    return {
        tab,
        periodText: sharePeriodText(range),
        baseDate: localBaseDate(now),
        summary: summarizeRecords(tabRecords),
        memberSummary: summarizeRecords(memberRecords),
        guestSummary: summarizeRecords(guestRecords),
        members,
        // 이름 확인 불가 묶음은 화면과 같이 맨 아래.
        guests: [...knownGuests, ...unknownGuests],
    };
}

function toGuestLine(g: ReturnType<typeof groupGuestsByName>[number]): ShareLine {
    return {
        name: g.name,
        billable: g.summary.billableAmount,
        paid: g.summary.paidAmount,
        unpaid: g.summary.unpaidAmount,
        review: g.summary.reviewAmount,
    };
}

/**
 * 목록 한 줄. 금액은 청구 대상(billableAmount, 비대상·확인 필요 제외).
 *   게스트는 화면 게스트 목록의 큰 숫자(벌금 원금)와 혼동하지 않도록 '청구 대상' 라벨을 쓴다.
 */
function formatLine(l: ShareLine, i: number, amountLabel: '부과' | '청구 대상'): string {
    const base = `${i + 1}. ${l.name} — ${amountLabel} ${formatWon(l.billable)} / 납부 ${formatWon(l.paid)} / 미납 ${formatWon(l.unpaid)}`;
    return l.review > 0 ? `${base} / 확인 필요 ${formatWon(l.review)}` : base;
}

function summaryLines(label: string, s: PenaltyHistorySummary): string[] {
    const out = [
        `[${label}]`,
        `총 부과: ${formatWon(s.billableAmount)}`,
        `납부 완료: ${formatWon(s.paidAmount)}`,
        `미납: ${formatWon(s.unpaidAmount)}`,
    ];
    if (s.reviewAmount > 0) out.push(`확인 필요: ${formatWon(s.reviewAmount)} (부과·미납 미포함)`);
    return out;
}

export function formatPenaltyShareText(c: PenaltyShareContent): string {
    const lines: string[] = [`🎾 ${SHARE_TITLE}`, '', `조회 기간: ${c.periodText}`, `기준일: ${c.baseDate}`, ''];
    const label = c.tab === 'all' ? '전체 요약' : c.tab === 'member' ? '회원 요약' : '게스트 요약';
    lines.push(...summaryLines(label, c.summary));
    if (c.tab === 'all') {
        lines.push(`(회원 ${formatWon(c.memberSummary.billableAmount)} · 게스트 ${formatWon(c.guestSummary.billableAmount)})`);
    }

    if (c.tab !== 'guest') {
        lines.push('', '[회원별 누적 벌금]');
        if (c.members.length === 0) lines.push('해당 기간 회원 벌금 기록 없음');
        else lines.push(...c.members.map((l, i) => formatLine(l, i, '부과')));
    }
    if (c.tab !== 'member') {
        lines.push('', '[게스트별 누적 벌금]');
        if (c.guests.length === 0) lines.push('해당 기간 게스트 벌금 기록 없음');
        else lines.push(...c.guests.map((l, i) => formatLine(l, i, '청구 대상')));
    }

    lines.push('', '※ 선택 기간 기준 KDK 벌금 정산 현황', '※ 비대상 벌금은 부과·납부 집계에서 제외');
    if (c.tab !== 'member' && c.guests.length > 0) lines.push('※ 게스트는 동일 이름 기준 합계(공식 개인별 누적 아님)');
    return lines.join('\n');
}

export function buildPenaltyShareText(allRecords: PenaltyHistoryRecord[], range: PeriodRange, tab: ShareTab, now: Date = new Date()): string {
    return formatPenaltyShareText(buildPenaltyShareContent(allRecords, range, tab, now));
}
