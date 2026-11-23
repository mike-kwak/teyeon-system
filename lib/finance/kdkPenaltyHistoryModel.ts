// KDK 누적 벌금 현황 — 집계 모델(순수 함수, DB 미접속).
//
// 원칙(조회 전용 · 기존 정산 규칙 재사용):
//   - 세션별 행 판정은 세션 정산 화면과 "같은 함수"(kdkSettlementService.buildKdkPenaltyRows)를 쓴다.
//     → 세션 정산 화면의 총 벌금/납부/미납을 세션별로 더한 값 = 누적 현황 값(중복·누락 없음).
//   - 상태 문자열이 아니라 유효 납부액(취소 제외)으로 판정 — pending 이라도 완납이면 납부 완료.
//   - not_target / exempt 는 미납이 아니다(비대상 금액으로 따로 집계).
//   - 미등록 · 회원 연결 필요 · 게스트 식별값 확인 필요는 "확인 필요"로 따로 집계(미납으로 단정하지 않음).
//   - 귀속 날짜 = KDK 세션 개최일(납부일·정정일 아님).
//   - 게스트는 세션별 기록(session_id + participant_id)으로만 다룬다. 이름이 같아도 합치지 않는다.
//   - 세션 행에 연결되지 않는 청구·납부(동명 오매칭 정정분, 미연결 납부 등)는 합계에 넣지 않고 "예외"로 보여준다.

import { buildKdkPenaltyRows, type KdkPenaltyPaymentStatus } from './kdkSettlementService';
import { summarizeReceivable } from './calculatePaymentStatus';
import type { GuestPenaltyRecord } from './kdkGuestPenaltyService';
import type { KdkSettlementEntry } from './kdkPenaltyService';
import type { FinanceDuesPayment, FinanceDuesReceivable, FinanceReceivableStatus } from '@/types/finance';
import type { ParticipationRecord } from './kdkPenaltyStatsModel';

// ── 입력(원본 데이터셋) ──────────────────────────────────────────────────────

export interface HistorySessionInput {
    /** teyeon_archive_v1.id */
    id: string;
    /** 'YYYY-MM-DD' — 세션 개최일. 없으면 null. */
    date: string | null;
    title: string;
    /** 공식 Archive settlement_data. 스냅샷 자체가 없으면 null(0원으로 단정하지 않음). */
    settlementData: KdkSettlementEntry[] | null;
}

export interface HistoryGuestPaymentInput {
    session_id: string;
    participant_id: string;
    amount: number;
    status: 'paid' | 'cancelled' | string;
    paid_at: string | null;
}

export interface PenaltyHistoryDataset {
    /** 공식 · 비테스트 · KDK 세션만. */
    sessions: HistorySessionInput[];
    members: { id: string; nickname: string | null }[];
    /** receivable_type='penalty' 청구 전체(세션 연결 여부 무관). */
    receivables: FinanceDuesReceivable[];
    /** 위 청구들에 연결된 납부 전체(취소 포함). */
    payments: FinanceDuesPayment[];
    /** payment_type='penalty' · receivable_id 없음(청구 미연결) 납부. 취소 포함. */
    unlinkedPayments: FinanceDuesPayment[];
    /** 게스트 납부 저장소 적용 여부(false 면 세션 정산 화면과 같이 게스트는 확인 필요로 표시). */
    guestAvailable: boolean;
    /** kdk_guest_penalty_payments(charge_type='penalty') 전체(취소 포함). */
    guestPayments: HistoryGuestPaymentInput[];
}

// ── 출력 ────────────────────────────────────────────────────────────────────

/** 화면 상태 4분류. 색상과 함께 텍스트로도 구분한다. */
export type PenaltyBucket = 'paid' | 'unpaid' | 'excluded' | 'review';

export interface PenaltyHistoryRecord {
    /** 세션 + 행 식별(동명이인 구분). */
    key: string;
    sessionId: string;
    sessionDate: string | null;
    sessionTitle: string;
    /** member = 회원 원장(청구) 기준 · guest = 게스트 세션 기록. */
    side: 'member' | 'guest';
    memberId: string | null;
    /** 공식 settlement player_id(게스트는 세션 내 participant_id). 화면에 노출하지 않는다. */
    playerId: string | null;
    /** 표시 이름(내부 접두사/(G) 제거). */
    displayName: string;
    /** 원본에서 실제 이름을 얻었는지(false 면 '게스트' 등 대체 표시 — 이름 묶음에서 별도 그룹). */
    nameKnown: boolean;
    isGuest: boolean;
    amount: number;
    amountPaid: number;
    /** 미납 잔액 — unpaid 버킷만 양수. */
    remaining: number;
    status: KdkPenaltyPaymentStatus;
    bucket: PenaltyBucket;
    paidAt: string | null;
}

export interface PenaltyHistorySummary {
    recordCount: number;
    /** 벌금 원금(스냅샷/청구 금액 합) = 청구 대상 + 비대상 + 확인 필요. 세션 정산 화면 '총 벌금'과 같은 정의. */
    grossAmount: number;
    /** 청구 대상 금액(납부 완료 + 미납/일부 버킷). */
    billableAmount: number;
    /** 유효 납부액(취소 제외) 합 — 세션 정산 화면 '납부 완료 금액'과 같은 정의. */
    paidAmount: number;
    /** 미납 잔액 — 세션 정산 화면 '미납 금액'과 같은 정의. */
    unpaidAmount: number;
    /** 비대상·면제 금액(미납 아님). */
    excludedAmount: number;
    /** 확인 필요 금액(미등록 · 회원 연결 필요 · 게스트 식별값 확인 필요). */
    reviewAmount: number;
    /** 비대상·면제 행에 남아 있는 유효 납부액(paidAmount 에 포함). 보통 0. */
    excludedPaidAmount: number;
    /** 납부율 = (청구 대상 - 미납) / 청구 대상. 청구 대상이 0이면 null. 0~1. */
    paidRate: number | null;
    paidCount: number;
    unpaidCount: number;
    excludedCount: number;
    reviewCount: number;
}

export interface PenaltySessionSummary extends PenaltyHistorySummary {
    sessionId: string;
    date: string | null;
    title: string;
    hasSnapshot: boolean;
    memberGross: number;
    guestGross: number;
}

export interface OrphanReceivable {
    receivableId: string;
    memberId: string;
    memberName: string;
    sessionId: string | null;
    sessionDate: string | null;
    amountDue: number;
    storedStatus: FinanceReceivableStatus;
    /** 유효 납부액 기준 판정(summarizeReceivable). */
    derivedStatus: string;
    validPaid: number;
    reason: 'no_session_link' | 'session_not_official' | 'no_snapshot' | 'not_in_settlement' | 'duplicate';
}

export interface OrphanGuestPayment {
    sessionId: string;
    sessionDate: string | null;
    amount: number;
    paidAt: string | null;
    reason: 'session_not_official' | 'no_snapshot' | 'not_in_settlement';
}

export interface UnlinkedPaymentItem {
    paymentId: string;
    memberId: string;
    memberName: string;
    amount: number;
    paidAt: string | null;
}

export interface PenaltyHistoryExceptions {
    /** 정산 스냅샷이 없는 공식 세션(벌금 0원으로 단정하지 않음). */
    noSnapshotSessions: { id: string; date: string | null; title: string }[];
    /** 개최일 정보가 없는 세션(기간 필터에서 제외됨). */
    undatedSessionCount: number;
    /** 세션 벌금 행에 연결되지 않은 회원 벌금 청구(합계 미포함). */
    orphanReceivables: OrphanReceivable[];
    /** 세션 게스트 벌금 행에 연결되지 않은 게스트 납부(status='paid', 합계 미포함). */
    orphanGuestPayments: OrphanGuestPayment[];
    /** 청구에 연결되지 않은 유효 벌금 납부(합계 미포함). */
    unlinkedPayments: UnlinkedPaymentItem[];
    /** 유효 납부액이 벌금보다 큰 기록(중복 납부 의심). 합계는 세션 정산 화면과 같은 기준(유효 납부 전액)으로 둔다. */
    overpaidRecords: PenaltyHistoryRecord[];
    /** 참고: 취소(soft-cancel)되어 유효 납부에서 제외된 회원 납부 건수 / 게스트 납부 건수. */
    voidedMemberPaymentCount: number;
    cancelledGuestPaymentCount: number;
    guestAvailable: boolean;
}

export interface PenaltyHistory {
    records: PenaltyHistoryRecord[];
    sessions: PenaltySessionSummary[];
    exceptions: PenaltyHistoryExceptions;
    /** V6: 공식 세션 참가 기록(kdkPenaltyStatsModel.buildParticipations). 조회 service 가 붙인다(금액 집계와 무관). */
    participations?: ParticipationRecord[];
}

// ── 표시 이름 ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 표시 이름 정리: manual-guest- 접두 · (G) · 끝의 " g" 제거. UUID·빈 값은 대체 문구. */
export function cleanPenaltyDisplayName(name: string | null | undefined, isGuest = false): string {
    const s = String(name || '')
        .replace(/^manual-guest-/i, '')
        .replace(/\s*\(G\)\s*$/i, '')
        .replace(/\s+g$/i, '')
        .trim();
    if (!s || UUID_RE.test(s) || /^g-\d+/i.test(s)) return isGuest ? '게스트' : '이름 없음';
    return s;
}

/** 원본 이름에서 실제 이름을 얻을 수 있는지(빈 값 · UUID · g-타임스탬프 → false). */
export function isIdentifiablePenaltyName(name: string | null | undefined): boolean {
    const s = String(name || '')
        .replace(/^manual-guest-/i, '')
        .replace(/\s*\(G\)\s*$/i, '')
        .replace(/\s+g$/i, '')
        .trim();
    return !!s && !UUID_RE.test(s) && !/^g-\d+/i.test(s);
}

/**
 * 게스트 이름 묶음 키 — 명백한 표시 차이만 제거: 유니코드 정규화(NFC, 한글 자모 조합 차이) + 모든 공백 제거.
 *   대소문자·부분 일치·유사 이름·오타는 합치지 않는다('김민' ≠ '김민수', 'Kim' ≠ 'kim').
 */
export function guestNameKey(displayName: string): string {
    return displayName.normalize('NFC').replace(/\s+/g, '');
}

// ── 상태 분류 ────────────────────────────────────────────────────────────────

export function bucketOf(status: KdkPenaltyPaymentStatus): PenaltyBucket {
    switch (status) {
        case 'paid': return 'paid';
        case 'partial':
        case 'pending': return 'unpaid';
        case 'exempt':
        case 'not_target': return 'excluded';
        default: return 'review'; // unregistered · needs_link
    }
}

// ── 기간 ─────────────────────────────────────────────────────────────────────

export type PeriodPreset = 'year' | '3m' | '6m' | 'all' | 'custom';
export interface PeriodRange { from: string | null; to: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(s: string | null | undefined): s is string {
    if (!s || !DATE_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 오늘(KST) 'YYYY-MM-DD'. */
export function todayKst(now: Date = new Date()): string {
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

function minusMonths(date: string, months: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const target = new Date(Date.UTC(y, m - 1 - months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return target.toISOString().slice(0, 10);
}

export type PeriodResolution =
    | { ok: true; range: PeriodRange; label: string }
    | { ok: false; error: string };

/** 기간 프리셋 → 세션 개최일 범위(양끝 포함). */
export function resolvePeriod(
    preset: PeriodPreset,
    custom: { from?: string | null; to?: string | null } = {},
    today: string = todayKst(),
): PeriodResolution {
    const year = today.slice(0, 4);
    switch (preset) {
        case 'year':
            return { ok: true, range: { from: `${year}-01-01`, to: `${year}-12-31` }, label: `${year}년` };
        case '3m':
            return { ok: true, range: { from: minusMonths(today, 3), to: today }, label: '지난 3개월' };
        case '6m':
            return { ok: true, range: { from: minusMonths(today, 6), to: today }, label: '지난 6개월' };
        case 'all':
            return { ok: true, range: { from: null, to: null }, label: '전체 기간' };
        case 'custom': {
            const from = custom.from || null;
            const to = custom.to || null;
            if (!from || !to) return { ok: false, error: '시작일과 종료일을 모두 선택해 주세요.' };
            if (!isValidDateString(from) || !isValidDateString(to)) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' };
            if (from > to) return { ok: false, error: '시작일이 종료일보다 늦습니다.' };
            return { ok: true, range: { from, to }, label: `${from.replace(/-/g, '.')} ~ ${to.replace(/-/g, '.')}` };
        }
    }
}

/** 세션 개최일이 범위 안인지(양끝 포함). 범위가 열려 있으면(전체) 날짜 미상도 포함. */
export function inPeriod(date: string | null, range: PeriodRange): boolean {
    if (!range.from && !range.to) return true;
    if (!date) return false;
    if (range.from && date < range.from) return false;
    if (range.to && date > range.to) return false;
    return true;
}

// ── 집계 ─────────────────────────────────────────────────────────────────────

export function summarizeRecords(records: PenaltyHistoryRecord[]): PenaltyHistorySummary {
    const s: PenaltyHistorySummary = {
        recordCount: records.length,
        grossAmount: 0, billableAmount: 0, paidAmount: 0, unpaidAmount: 0,
        excludedAmount: 0, reviewAmount: 0, excludedPaidAmount: 0, paidRate: null,
        paidCount: 0, unpaidCount: 0, excludedCount: 0, reviewCount: 0,
    };
    for (const r of records) {
        s.grossAmount += r.amount;
        // summarizePenaltyRows 와 같은 정의: 확인 필요(미등록·연결 필요)의 납부액은 0, 그 외 유효 납부액 전부.
        if (r.bucket !== 'review') s.paidAmount += r.amountPaid;
        switch (r.bucket) {
            case 'paid': s.paidCount += 1; s.billableAmount += r.amount; break;
            case 'unpaid': s.unpaidCount += 1; s.billableAmount += r.amount; s.unpaidAmount += r.remaining; break;
            case 'excluded': s.excludedCount += 1; s.excludedAmount += r.amount; s.excludedPaidAmount += r.amountPaid; break;
            case 'review': s.reviewCount += 1; s.reviewAmount += r.amount; break;
        }
    }
    s.paidRate = s.billableAmount > 0 ? Math.max(0, Math.min(1, (s.billableAmount - s.unpaidAmount) / s.billableAmount)) : null;
    return s;
}

function compareRecords(a: PenaltyHistoryRecord, b: PenaltyHistoryRecord): number {
    const d = String(b.sessionDate || '').localeCompare(String(a.sessionDate || ''));
    if (d !== 0) return d;
    const s = a.sessionId.localeCompare(b.sessionId);
    if (s !== 0) return s;
    const n = a.displayName.localeCompare(b.displayName, 'ko');
    if (n !== 0) return n;
    return a.key.localeCompare(b.key);
}

/** 원본 데이터셋 → 누적 기록(전체 기간). 기간 필터는 화면에서 inPeriod 로 적용한다. */
export function buildPenaltyHistory(ds: PenaltyHistoryDataset): PenaltyHistory {
    const memberName = new Map<string, string>();
    for (const m of ds.members) memberName.set(m.id, cleanPenaltyDisplayName(m.nickname));

    const recvBySession = new Map<string, FinanceDuesReceivable[]>();
    for (const r of ds.receivables) {
        const sid = r.related_kdk_session_id;
        if (!sid) continue;
        const arr = recvBySession.get(sid) || [];
        arr.push(r);
        recvBySession.set(sid, arr);
    }
    const guestBySession = new Map<string, HistoryGuestPaymentInput[]>();
    for (const g of ds.guestPayments) {
        const arr = guestBySession.get(g.session_id) || [];
        arr.push(g);
        guestBySession.set(g.session_id, arr);
    }

    const sessionById = new Map<string, HistorySessionInput>();
    for (const s of ds.sessions) sessionById.set(s.id, s);

    const usedReceivables = new Set<string>();
    const usedGuest = new Set<string>(); // `${session}\u0000${participant}`
    const records: PenaltyHistoryRecord[] = [];
    const sessions: PenaltySessionSummary[] = [];
    const noSnapshotSessions: PenaltyHistoryExceptions['noSnapshotSessions'] = [];
    let undatedSessionCount = 0;

    for (const session of ds.sessions) {
        if (!session.date) undatedSessionCount += 1;
        if (!Array.isArray(session.settlementData)) {
            noSnapshotSessions.push({ id: session.id, date: session.date, title: session.title });
            sessions.push({
                ...summarizeRecords([]), sessionId: session.id, date: session.date, title: session.title,
                hasSnapshot: false, memberGross: 0, guestGross: 0,
            });
            continue;
        }
        const recvs = recvBySession.get(session.id) || [];
        const recvIds = new Set(recvs.map((r) => r.id));
        const pays = ds.payments.filter((p) => p.receivable_id && recvIds.has(p.receivable_id));
        const paidByParticipant = new Map<string, GuestPenaltyRecord>();
        for (const g of guestBySession.get(session.id) || []) {
            if (g.status === 'paid') {
                const pid = String(g.participant_id);
                paidByParticipant.set(pid, { participantId: pid, amount: Number(g.amount || 0), paidAt: g.paid_at ?? null });
            }
        }
        const rows = buildKdkPenaltyRows(session.settlementData, ds.members, recvs, pays, {
            available: ds.guestAvailable,
            paidByParticipant,
        });

        const sessionRecords: PenaltyHistoryRecord[] = rows.map((r, idx) => {
            if (r.receivableId) usedReceivables.add(r.receivableId);
            if (r.isGuestPayable && r.playerId && r.status === 'paid') usedGuest.add(`${session.id}\u0000${r.playerId}`);
            const bucket = bucketOf(r.status);
            const side: 'member' | 'guest' = r.memberId ? 'member' : r.isGuest ? 'guest' : 'member';
            const name = r.memberId
                ? (memberName.get(r.memberId) || cleanPenaltyDisplayName(r.memberName || r.playerName))
                : cleanPenaltyDisplayName(r.playerName, r.isGuest);
            const rowKey = r.memberId ? `m:${r.memberId}` : r.playerId ? `g:${r.playerId}` : `n:${r.playerName}:${idx}`;
            return {
                key: `${session.id}|${rowKey}`,
                sessionId: session.id,
                sessionDate: session.date,
                sessionTitle: session.title,
                side,
                memberId: r.memberId,
                playerId: r.playerId,
                displayName: name,
                nameKnown: r.memberId ? true : isIdentifiablePenaltyName(r.playerName),
                isGuest: r.isGuest && !r.memberId,
                amount: r.amount,
                amountPaid: bucket === 'review' ? 0 : r.amountPaid,
                remaining: bucket === 'unpaid' ? Math.max(0, r.amount - r.amountPaid) : 0,
                status: r.status,
                bucket,
                paidAt: r.paidAt,
            };
        });
        records.push(...sessionRecords);
        const sum = summarizeRecords(sessionRecords);
        sessions.push({
            ...sum,
            sessionId: session.id, date: session.date, title: session.title, hasSnapshot: true,
            memberGross: sessionRecords.filter((r) => r.side === 'member').reduce((a, r) => a + r.amount, 0),
            guestGross: sessionRecords.filter((r) => r.side === 'guest').reduce((a, r) => a + r.amount, 0),
        });
    }

    // ── 예외: 세션 행에 연결되지 않은 청구 ──
    const orphanReceivables: OrphanReceivable[] = [];
    for (const r of ds.receivables) {
        if (usedReceivables.has(r.id)) continue;
        const sid = r.related_kdk_session_id || null;
        const session = sid ? sessionById.get(sid) : undefined;
        let reason: OrphanReceivable['reason'];
        if (!sid) reason = 'no_session_link';
        else if (!session) reason = 'session_not_official';
        else if (!Array.isArray(session.settlementData)) reason = 'no_snapshot';
        else {
            // 같은 세션·같은 회원 청구가 여럿이면 하나만 행에 연결된다(세션 정산 화면과 동일) → 중복.
            const dup = (recvBySession.get(sid) || []).some((o) => o.id !== r.id && o.member_id === r.member_id && usedReceivables.has(o.id));
            reason = dup ? 'duplicate' : 'not_in_settlement';
        }
        const s = summarizeReceivable(r, ds.payments);
        orphanReceivables.push({
            receivableId: r.id,
            memberId: r.member_id,
            memberName: memberName.get(r.member_id) || '회원 정보 없음',
            sessionId: sid,
            sessionDate: session?.date ?? null,
            amountDue: Math.max(0, r.amount_due),
            storedStatus: r.status,
            derivedStatus: s.derivedStatus,
            validPaid: s.amount_paid,
            reason,
        });
    }
    orphanReceivables.sort((a, b) => String(b.sessionDate || '').localeCompare(String(a.sessionDate || '')) || a.receivableId.localeCompare(b.receivableId));

    // ── 예외: 세션 게스트 행에 연결되지 않은 유효 게스트 납부 ──
    const orphanGuestPayments: OrphanGuestPayment[] = [];
    let cancelledGuestPaymentCount = 0;
    for (const g of ds.guestPayments) {
        if (g.status !== 'paid') { cancelledGuestPaymentCount += 1; continue; }
        if (usedGuest.has(`${g.session_id}\u0000${g.participant_id}`)) continue;
        const session = sessionById.get(g.session_id);
        orphanGuestPayments.push({
            sessionId: g.session_id,
            sessionDate: session?.date ?? null,
            amount: Number(g.amount || 0),
            paidAt: g.paid_at ?? null,
            reason: !session ? 'session_not_official' : !Array.isArray(session.settlementData) ? 'no_snapshot' : 'not_in_settlement',
        });
    }

    // ── 예외: 청구 미연결 납부 ──
    const unlinkedPayments: UnlinkedPaymentItem[] = ds.unlinkedPayments
        .filter((p) => !p.receivable_id && p.is_voided !== true)
        .map((p) => ({
            paymentId: p.id,
            memberId: p.member_id,
            memberName: memberName.get(p.member_id) || '회원 정보 없음',
            amount: Number(p.amount || 0),
            paidAt: p.paid_at ?? null,
        }))
        .sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')) || a.paymentId.localeCompare(b.paymentId));

    records.sort(compareRecords);
    sessions.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.sessionId.localeCompare(b.sessionId));

    return {
        records,
        sessions,
        exceptions: {
            noSnapshotSessions,
            undatedSessionCount,
            orphanReceivables,
            orphanGuestPayments,
            unlinkedPayments,
            overpaidRecords: records.filter((r) => r.amountPaid > r.amount),
            voidedMemberPaymentCount: ds.payments.filter((p) => p.is_voided === true).length
                + ds.unlinkedPayments.filter((p) => p.is_voided === true).length,
            cancelledGuestPaymentCount,
            guestAvailable: ds.guestAvailable,
        },
    };
}

// ── 회원별 누적 ──────────────────────────────────────────────────────────────

export interface MemberPenaltyAggregate {
    memberId: string;
    name: string;
    /** 벌금이 발생한 세션 수(비대상 포함, 서로 다른 세션 수). */
    sessionCount: number;
    billableAmount: number;
    paidAmount: number;
    unpaidAmount: number;
    excludedAmount: number;
    reviewAmount: number;
    /** 대표 상태: 미납 > 확인 필요 > 완납 > 비대상. */
    bucket: PenaltyBucket;
}

export function aggregateMembers(records: PenaltyHistoryRecord[]): MemberPenaltyAggregate[] {
    const byMember = new Map<string, { recs: PenaltyHistoryRecord[] }>();
    for (const r of records) {
        if (r.side !== 'member' || !r.memberId) continue;
        const e = byMember.get(r.memberId) || { recs: [] };
        e.recs.push(r);
        byMember.set(r.memberId, e);
    }
    const out: MemberPenaltyAggregate[] = [];
    for (const [memberId, { recs }] of byMember) {
        const s = summarizeRecords(recs);
        const bucket: PenaltyBucket = s.unpaidAmount > 0 ? 'unpaid'
            : s.reviewCount > 0 ? 'review'
                : s.billableAmount > 0 ? 'paid' : 'excluded';
        out.push({
            memberId,
            name: recs[0].displayName,
            sessionCount: new Set(recs.map((r) => r.sessionId)).size,
            billableAmount: s.billableAmount,
            paidAmount: s.paidAmount,
            unpaidAmount: s.unpaidAmount,
            excludedAmount: s.excludedAmount,
            reviewAmount: s.reviewAmount,
            bucket,
        });
    }
    // 총 청구액 내림차순 → 이름 → id (안정 정렬).
    return out.sort((a, b) => (b.billableAmount - a.billableAmount)
        || a.name.localeCompare(b.name, 'ko')
        || a.memberId.localeCompare(b.memberId));
}

/** 검색어 정규화(공백 제거 · 소문자). 이름 부분 일치 검색에만 사용(병합에는 쓰지 않는다). */
export function normalizeSearch(q: string | null | undefined): string {
    return String(q || '').replace(/\s+/g, '').toLowerCase();
}

export function matchesSearch(name: string, q: string): boolean {
    const nq = normalizeSearch(q);
    if (!nq) return true;
    return normalizeSearch(name).includes(nq);
}

// ── 게스트 동일 이름 묶음(화면 표시용) ─────────────────────────────────────────
//   ⚠ 동일 이름 ≠ 동일 인물. 금액은 "동일 이름 기준 합계"이며 공식 개인별 누적이 아니다.
//   - 게스트 기록(side='guest')만 묶는다. 회원 기록과는 절대 합치지 않는다.
//   - 키: guestNameKey(공백·NFC 차이만 제거). 부분 일치·유사 이름·오타 추정 병합 없음.
//   - 이름을 알 수 없는 기록(빈 값·내부 id)은 하나의 '이름 확인 불가' 그룹으로 분리한다.
//   - 원본 기록은 그대로 두고 화면에서만 묶는다 → 그룹 합계의 총합 = 게스트 전체 합계.

export const UNKNOWN_GUEST_GROUP_KEY = '\u0000unknown';

export interface GuestNameGroup {
    /** 묶음 키(이름 확인 불가 그룹은 UNKNOWN_GUEST_GROUP_KEY). */
    key: string;
    /** 대표 표시 이름(그룹 내 가장 최근 기록의 표시 이름). */
    name: string;
    /** 이름 확인 불가 그룹 여부. */
    unknown: boolean;
    /** 기록 수(= 벌금 발생 횟수). */
    count: number;
    /** 서로 다른 세션 수. */
    sessionCount: number;
    summary: PenaltyHistorySummary;
    /** 대표 상태: 미납 > 확인 필요 > 완납 > 비대상. */
    bucket: PenaltyBucket;
    /** 최신 세션 순 기록. */
    records: PenaltyHistoryRecord[];
}

export function groupGuestsByName(records: PenaltyHistoryRecord[]): GuestNameGroup[] {
    const map = new Map<string, PenaltyHistoryRecord[]>();
    for (const r of records) {
        if (r.side !== 'guest') continue;
        const key = r.nameKnown ? guestNameKey(r.displayName) : UNKNOWN_GUEST_GROUP_KEY;
        const arr = map.get(key) || [];
        arr.push(r);
        map.set(key, arr);
    }
    const groups: GuestNameGroup[] = [];
    for (const [key, recs] of map) {
        const sorted = [...recs].sort(compareRecords);
        const summary = summarizeRecords(sorted);
        const unknown = key === UNKNOWN_GUEST_GROUP_KEY;
        groups.push({
            key,
            name: unknown ? '이름 확인 불가' : sorted[0].displayName,
            unknown,
            count: sorted.length,
            sessionCount: new Set(sorted.map((r) => r.sessionId)).size,
            summary,
            bucket: summary.unpaidAmount > 0 ? 'unpaid'
                : summary.reviewCount > 0 ? 'review'
                    : summary.billableAmount > 0 ? 'paid' : 'excluded',
            records: sorted,
        });
    }
    // 벌금 합계 내림차순 → 이름 → 키(안정 정렬). 이름 확인 불가 그룹은 맨 아래.
    return groups.sort((a, b) => (Number(a.unknown) - Number(b.unknown))
        || (b.summary.grossAmount - a.summary.grossAmount)
        || a.name.localeCompare(b.name, 'ko')
        || a.key.localeCompare(b.key));
}
