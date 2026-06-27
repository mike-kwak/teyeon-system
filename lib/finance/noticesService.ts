// TEYEON 재무 — 회원 공지용 미납 현황 공개 링크 service.
//   생성 시점 스냅샷을 finance_public_notices 에 고정 저장(불변).
//   공개 조회는 get_public_finance_notice RPC(anon 허용) 만 사용.

import { supabase } from '../supabase';
import { formatWon } from './formatFinanceAmount';
import { summarizeReceivable } from './calculatePaymentStatus';
import { isMonthlyFeeTargetMember, type FinanceMember } from './duesService';
import { isMemberOnLeaveAtMonth } from './leavesService';
import { FINANCE_PAYMENT_ACCOUNT, type FinancePaymentAccountSnapshot } from './paymentAccount';
import type { FinanceDuesPayment, FinanceDuesReceivable, FinanceMemberLeave } from '@/types/finance';

const TBL = 'finance_public_notices';

export type NoticeMemberStatus = 'paid' | 'partial' | 'pending';

/** 공개 스냅샷의 납부 대상 회원 1건 — 공개 가능 최소 정보만(연락처/계정/메모 없음). */
export interface NoticeSnapshotMember {
    displayName: string;
    itemTitle: string;
    amountDue: number;
    amountPaid: number;
    remainingAmount: number;
    status: NoticeMemberStatus;
    /** 선택 연도 연회비(월회비 12개월)를 모두 완납한 회원. 구버전 스냅샷엔 없음(optional). */
    annualFeePaid?: boolean;
    /** 공개 표시 문구. 연회비 완료 → '연회비 납부 완료', 그 외 → 월 상태 라벨. 구버전 스냅샷엔 없음. */
    statusLabel?: string;
}

/** 회비 제외 대상 1건 — 실명 + 사유(휴회/준회원/게스트/면제/비대상). 상세 사유/메모는 비공개. */
export interface NoticeExcludedMember {
    displayName: string;
    reason: string;
}

/** 공개 집계(스냅샷 고정). */
export interface NoticeStats {
    totalMembers: number;           // 전체 회원 수
    targetCount: number;            // 실제 월회비 납부 대상 = paid+partial+pending
    associateExcludedCount: number; // 준회원·게스트 제외
    leaveExcludedCount: number;     // 휴회 제외
    paidCount: number;
    partialCount: number;
    unpaidCount: number;
    totalDue: number;               // 총 납부 대상 금액
    totalPaid: number;              // 총 납부 완료 금액
    totalRemaining: number;         // 총 남은 금액
}

// ── 이전 월 이월 미납 (선택 월보다 이전, 같은 연도) ──────────────────────────
/** 이전 월 미납 1건 — 월별 청구 단위. 공개 화면/카카오는 회원별로 묶어 표시. */
export interface PriorArrearLine {
    memberId: string;
    displayName: string;
    targetYear: number;
    targetMonth: number;
    amountDue: number;
    amountPaid: number;
    remainingAmount: number;
    status: 'partial' | 'pending';
}

export interface PriorArrearsStats {
    memberCount: number;
    receivableCount: number;
    remainingAmount: number;
}

/** 회원별로 묶은 이전 월 미납(표시용). */
export interface PriorArrearGroup {
    displayName: string;
    months: PriorArrearLine[];   // 오래된 월부터.
    totalRemaining: number;
}

/** 관리자 목록/관리용 row. */
export interface FinancePublicNotice {
    id: string;
    token: string;
    title: string;
    target_year: number;
    target_month: number;
    reference_date: string;       // 'YYYY-MM-DD'
    public_note: string | null;
    total_target_count: number;
    paid_count: number;
    partial_count: number;
    unpaid_count: number;
    total_unpaid_amount: number;
    is_active: boolean;
    created_at: string;
    deactivated_at: string | null;
}

/** 공개 RPC 응답(get_public_finance_notice). 모두 스냅샷 고정값. */
export interface PublicNoticeView {
    title: string;
    targetYear: number;
    targetMonth: number;
    referenceDate: string;        // 'YYYY-MM-DD'
    publicNote: string | null;
    stats: NoticeStats;
    members: NoticeSnapshotMember[];
    excluded: NoticeExcludedMember[];
    /** 생성 시점 입금 계좌 스냅샷. 구버전 공지엔 없을 수 있어 optional. */
    paymentAccount?: FinancePaymentAccountSnapshot | null;
    /** 선택 월보다 이전(같은 연도)의 monthly_fee 이월 미납. 구버전 공지엔 없음(optional). */
    priorArrears?: PriorArrearLine[];
    priorArrearsStats?: PriorArrearsStats | null;
    /** 선택 월 남은 금액 + 이전 월 미납 합계. 구버전 공지엔 없음(optional). */
    overallOutstandingAmount?: number | null;
}

// ── 이름 표시 ────────────────────────────────────────────────────────────────
// TEYEON 내부 회원 공지용 — 미납자 이름은 항상 실명 전체 표시(가림 옵션 없음).
function fullName(name: string): string {
    return (name || '').trim() || '회원';
}

// ── 날짜 표시 ────────────────────────────────────────────────────────────────
/** 'YYYY-MM-DD' → '2026.06.23'. */
export function formatReferenceDot(dateStr: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
    if (!m) return dateStr || '';
    return `${m[1]}.${m[2]}.${m[3]}`;
}

/** 'YYYY-MM-DD' → '2026년 6월 23일'. */
export function formatReferenceKo(dateStr: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
    if (!m) return dateStr || '';
    return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

/** timestamptz(ISO) → 한국시간 'YYYY.MM.DD HH:mm' (Asia/Seoul). DB 원본은 timestamptz 유지, 표시만 변환. */
export function formatSeoulDateTime(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    // en-CA + hour12:false → 24시간제 '00'~'23'.
    return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 오늘 'YYYY-MM-DD' (로컬). */
export function todayISO(): string {
    const d = new Date();
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
}

// ── 스냅샷 빌드 ──────────────────────────────────────────────────────────────
/**
 * 선택된 (year, month) 의 전체 회비 납부 현황 스냅샷을 만든다.
 *   - 납부 대상(members) = 면제/비대상이 아닌 receivable 전체(paid / partial / pending).
 *   - 회비 제외(excluded) = 준회원·게스트 / 휴회 / 면제 / 비대상(실명 + 사유만).
 *   - 금액/대상 집계는 면제·비대상·준회원·휴회 제외.
 *   - 이름은 실명 전체로 저장(TEYEON 내부 회원 공지용). 정렬은 이름 가나다순.
 */
const STATUS_LABEL: Record<NoticeMemberStatus, string> = {
    paid: '납부 완료',
    partial: '일부 납부',
    pending: '미납',
};

export function buildNoticeSnapshot(opts: {
    members: FinanceMember[];
    receivables: FinanceDuesReceivable[];
    payments: FinanceDuesPayment[];
    leaves: FinanceMemberLeave[];
    year: number;
    month: number;
    /** 선택 연도 연회비 완료 회원 id — 공개 표에 '연회비 납부 완료' 로 표시. */
    annualPaidIds?: Set<string>;
}): { members: NoticeSnapshotMember[]; excluded: NoticeExcludedMember[]; stats: NoticeStats } {
    const { members, receivables, payments, leaves, year, month, annualPaidIds } = opts;

    const nameById: Record<string, string> = {};
    for (const m of members) nameById[m.id] = fullName(m.nickname || '회원');

    const target: NoticeSnapshotMember[] = [];
    let paidCount = 0, partialCount = 0, unpaidCount = 0;
    let totalDue = 0, totalPaid = 0, totalRemaining = 0;

    // 1) receivable 기준 — 납부 대상(paid/partial/pending) 본문 행 + 금액 집계.
    //    ⚠️ exempt/not_target(generic) 은 여기서 사유를 정하지 않는다(휴회/role 판정보다 먼저 처리 금지).
    //       사유 판정용 정보만 recvByMember 에 보관해 아래 우선순위에서 사용.
    const targetMemberIds = new Set<string>();
    const recvByMember = new Map<string, { status: string; exemptionReason: string | null }>();
    for (const r of receivables) {
        const s = summarizeReceivable(r, payments);
        const st = s.derivedStatus;
        if (st === 'paid' || st === 'partial' || st === 'pending') {
            targetMemberIds.add(r.member_id);
            if (st === 'paid') paidCount++;
            else if (st === 'partial') partialCount++;
            else unpaidCount++;
            totalDue += Math.max(0, r.amount_due);
            totalPaid += s.amount_paid;
            totalRemaining += s.remaining;
            const annualPaid = annualPaidIds?.has(r.member_id) ?? false;
            target.push({
                displayName: nameById[r.member_id] || '회원',
                itemTitle: r.title || `${year}년 ${month}월 회비`,
                amountDue: Math.max(0, r.amount_due),
                amountPaid: s.amount_paid,
                remainingAmount: s.remaining,
                status: st, // 'paid' | 'partial' | 'pending'
                annualFeePaid: annualPaid,
                statusLabel: annualPaid ? '연회비 납부 완료' : STATUS_LABEL[st],
            });
        } else {
            const prev = recvByMember.get(r.member_id);
            recvByMember.set(r.member_id, {
                status: r.status,
                exemptionReason: r.exemption_reason ?? prev?.exemptionReason ?? null,
            });
        }
    }

    // 2) 회비 제외 — member_id 단위 1회만(중복 방지). 우선순위로 가장 구체적인 사유 하나만 사용:
    //    준회원 → 게스트 → 해당 연·월 휴회 → exemption_reason '휴회' 포함 → exempt → not_target.
    //    role 은 trim 후 비교(기존 isMonthlyFeeTargetMember 재사용 — 준회원/게스트면 false).
    const excluded: NoticeExcludedMember[] = [];
    const excludedIds = new Set<string>();
    let associateExcludedCount = 0, leaveExcludedCount = 0;

    const reasonFor = (
        role: string,
        onLeave: boolean,
        recv?: { status: string; exemptionReason: string | null },
    ): string | null => {
        if (!isMonthlyFeeTargetMember(role)) return role === '게스트' ? '비대상(게스트)' : '비대상(준회원)';
        if (onLeave) return '면제(휴회)';
        if (recv?.exemptionReason && recv.exemptionReason.includes('휴회')) return '면제(휴회)';
        if (recv?.status === 'exempt') return '면제';
        if (recv?.status === 'not_target') return '비대상';
        return null;
    };

    for (const m of members) {
        const role = (m.role || '').trim();
        const onLeave = isMemberOnLeaveAtMonth(leaves, m.id, year, month);
        if (!isMonthlyFeeTargetMember(role)) associateExcludedCount++;
        else if (onLeave) leaveExcludedCount++;

        if (targetMemberIds.has(m.id) || excludedIds.has(m.id)) continue;
        const reason = reasonFor(role, onLeave, recvByMember.get(m.id));
        if (reason) {
            excluded.push({ displayName: nameById[m.id] || '회원', reason });
            excludedIds.add(m.id);
        }
    }

    // members 목록에 없는(드문) 면제/비대상 receivable 도 누락 없이 표시.
    for (const [mid, recv] of recvByMember) {
        if (targetMemberIds.has(mid) || excludedIds.has(mid)) continue;
        const reason = reasonFor('', false, recv);
        if (reason) {
            excluded.push({ displayName: nameById[mid] || '회원', reason });
            excludedIds.add(mid);
        }
    }

    // 정렬 — 본문/제외 모두 이름 가나다순(중립).
    target.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'));
    const reasonOrder: Record<string, number> = { '면제(휴회)': 0, '면제': 1, '비대상(준회원)': 2, '비대상(게스트)': 3, '비대상': 4 };
    excluded.sort((a, b) =>
        (reasonOrder[a.reason] ?? 9) - (reasonOrder[b.reason] ?? 9)
        || a.displayName.localeCompare(b.displayName, 'ko'),
    );

    const stats: NoticeStats = {
        totalMembers: members.length,
        targetCount: paidCount + partialCount + unpaidCount,
        associateExcludedCount,
        leaveExcludedCount,
        paidCount,
        partialCount,
        unpaidCount,
        totalDue,
        totalPaid,
        totalRemaining,
    };
    return { members: target, excluded, stats };
}

/**
 * 공지 스냅샷 생성 직전, 해당 receivable 들의 "유효 payment"만 DB 에서 새로 조회.
 *   - 화면 state 의 payments 는 다른 화면에서 취소(soft-cancel)된 직후 stale 일 수 있어,
 *     취소(is_voided=true)분이 유효처럼 남아 합산되는 문제(완료 금액 과다)를 막는다.
 *   - 조회 단계 .eq('is_voided', false) + 조회 후 is_voided !== true 이중 안전(기존 null 행 대비).
 *   - 합계 계산은 기존 summarizeReceivable 을 그대로 사용(별도 합계식 만들지 않음).
 */
export async function fetchValidNoticePayments(receivableIds: string[]): Promise<FinanceDuesPayment[]> {
    if (receivableIds.length === 0) return [];
    const { data, error } = await supabase
        .from('finance_dues_payments')
        .select('*')
        .in('receivable_id', receivableIds)
        .eq('is_voided', false);
    if (error) {
        console.warn('[Finance/notices/validPayments]', error?.message ?? error);
        return [];
    }
    return ((data || []) as FinanceDuesPayment[]).filter((p) => p.is_voided !== true);
}

// ── 이전 월 이월 미납 조회/집계 ──────────────────────────────────────────────
/**
 * 선택 월보다 이전(같은 연도)의 monthly_fee 이월 미납을 생성 직전 최신 DB 에서 조회.
 *   - receivable_type='monthly_fee', target_year=year, target_month < month, exempt/not_target 제외.
 *   - 유효 payment(is_voided=false)만 합산 → remaining = max(amount_due - paid, 0), remaining>0 만 포함.
 *   - paid_at(실제 납부일)은 월 판정에 사용하지 않는다(귀속월=target_month 기준).
 *   - 현재 페이지 state/이전 snapshot 재사용 금지 — 항상 fresh.
 */
export async function fetchPriorMonthArrears(opts: {
    year: number;
    month: number;
    nameById: Record<string, string>;
}): Promise<PriorArrearLine[]> {
    const { year, month, nameById } = opts;
    if (month <= 1) return [];
    const { data: recvData, error } = await supabase
        .from('finance_dues_receivables')
        .select('*')
        .eq('receivable_type', 'monthly_fee')
        .eq('target_year', year)
        .lt('target_month', month);
    if (error) {
        console.warn('[Finance/notices/priorArrears/recv]', error?.message ?? error);
        return [];
    }
    const recv = ((recvData || []) as FinanceDuesReceivable[])
        .filter((r) => r.status !== 'exempt' && r.status !== 'not_target' && r.target_month != null);
    const ids = recv.map((r) => r.id);
    const payments = await fetchValidNoticePayments(ids);
    const paidByRecv = new Map<string, number>();
    for (const p of payments) {
        if (p.is_voided === true || !p.receivable_id) continue;
        paidByRecv.set(p.receivable_id, (paidByRecv.get(p.receivable_id) || 0) + (p.amount || 0));
    }
    const lines: PriorArrearLine[] = [];
    for (const r of recv) {
        const due = Math.max(0, r.amount_due);
        const paid = paidByRecv.get(r.id) || 0;
        const remaining = Math.max(due - paid, 0);
        if (remaining <= 0) continue;
        lines.push({
            memberId: r.member_id,
            displayName: fullName(nameById[r.member_id] || '회원'),
            targetYear: r.target_year as number,
            targetMonth: r.target_month as number,
            amountDue: due,
            amountPaid: paid,
            remainingAmount: remaining,
            status: paid > 0 ? 'partial' : 'pending',
        });
    }
    return lines;
}

/** 이전 월 미납 집계(회원 수 / 청구 수 / 총 남은 금액). */
export function priorArrearsStatsOf(lines: PriorArrearLine[]): PriorArrearsStats {
    const members = new Set(lines.map((l) => l.memberId));
    return {
        memberCount: members.size,
        receivableCount: lines.length,
        remainingAmount: lines.reduce((s, l) => s + l.remainingAmount, 0),
    };
}

/**
 * 이전 월 미납을 회원별로 묶어 표시용 그룹으로 변환.
 *   - 정렬: 회원 합계 큰 순 → 이름 가나다순. 회원 내 월은 오래된 월부터.
 */
export function groupPriorArrears(lines: PriorArrearLine[]): PriorArrearGroup[] {
    const byMember = new Map<string, PriorArrearLine[]>();
    for (const l of lines) {
        const arr = byMember.get(l.memberId);
        if (arr) arr.push(l); else byMember.set(l.memberId, [l]);
    }
    const groups: PriorArrearGroup[] = [];
    for (const arr of byMember.values()) {
        const months = [...arr].sort((a, b) => a.targetMonth - b.targetMonth);
        groups.push({
            displayName: months[0]?.displayName || '회원',
            months,
            totalRemaining: months.reduce((s, l) => s + l.remainingAmount, 0),
        });
    }
    groups.sort((a, b) =>
        (b.totalRemaining - a.totalRemaining) || a.displayName.localeCompare(b.displayName, 'ko'));
    return groups;
}

// ── 토큰 ─────────────────────────────────────────────────────────────────────
/** 추측 어려운 24자 base62 랜덤 토큰(crypto). */
export function generatePublicToken(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(24);
    (globalThis.crypto || (window as any).crypto).getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
export interface CreateNoticeInput {
    title: string;
    targetYear: number;
    targetMonth: number;
    referenceDate: string;        // 'YYYY-MM-DD'
    publicNote: string | null;
    members: NoticeSnapshotMember[];
    excluded: NoticeExcludedMember[];
    stats: NoticeStats;
    /** 미지정 시 현재 공용 계좌(FINANCE_PAYMENT_ACCOUNT)를 포함. null 로 명시하면 제외. */
    paymentAccount?: FinancePaymentAccountSnapshot | null;
    /** 이전 월 이월 미납(월별 청구 단위). 없으면 빈 배열로 저장. */
    priorArrears?: PriorArrearLine[];
    priorArrearsStats?: PriorArrearsStats | null;
    overallOutstandingAmount?: number | null;
}

export async function createPublicNotice(input: CreateNoticeInput): Promise<FinancePublicNotice> {
    const token = generatePublicToken();
    let createdBy: string | null = null;
    try {
        const { data: u } = await supabase.auth.getUser();
        createdBy = u?.user?.id ?? null;
    } catch { /* createdBy 없이 진행 가능 */ }

    const { data, error } = await supabase
        .from(TBL)
        .insert({
            token,
            title: input.title.trim() || 'TEYEON 회비 납부 현황',
            target_year: input.targetYear,
            target_month: input.targetMonth,
            reference_date: input.referenceDate,
            // name_display_mode 는 DB 기본값 'full' 사용(실명 고정) — 클라이언트에서 전송하지 않음.
            public_note: input.publicNote && input.publicNote.trim() ? input.publicNote.trim() : null,
            total_target_count: input.stats.targetCount,
            paid_count: input.stats.paidCount,
            partial_count: input.stats.partialCount,
            unpaid_count: input.stats.unpaidCount,
            total_unpaid_amount: input.stats.totalRemaining,
            // 공개 필드 최소화: 실명 + 항목 + 금액 + 상태 + 사유 + 집계 + 입금 계좌. (member_id/연락처/메모 없음)
            snapshot_data: {
                stats: input.stats,
                members: input.members,
                excluded: input.excluded,
                paymentAccount: input.paymentAccount === undefined ? FINANCE_PAYMENT_ACCOUNT : input.paymentAccount,
                // 이전 월 이월 미납(선택 월보다 이전, 같은 연도). 구버전 호환 위해 항상 키 저장.
                priorArrears: input.priorArrears ?? [],
                priorArrearsStats: input.priorArrearsStats ?? null,
                overallOutstandingAmount: input.overallOutstandingAmount ?? null,
            },
            is_active: true,
            created_by: createdBy,
        })
        .select('*')
        .single();
    if (error) throw error;
    return data as FinancePublicNotice;
}

export async function listPublicNotices(): Promise<FinancePublicNotice[]> {
    const { data, error } = await supabase
        .from(TBL)
        .select('id, token, title, target_year, target_month, reference_date, public_note, total_target_count, paid_count, partial_count, unpaid_count, total_unpaid_amount, is_active, created_at, deactivated_at')
        .order('created_at', { ascending: false });
    if (error) {
        console.warn('[Finance/notices/list]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinancePublicNotice[];
}

export async function deactivatePublicNotice(id: string): Promise<void> {
    let by: string | null = null;
    try {
        const { data: u } = await supabase.auth.getUser();
        by = u?.user?.id ?? null;
    } catch { /* noop */ }
    const { error } = await supabase
        .from(TBL)
        .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivated_by: by })
        .eq('id', id);
    if (error) throw error;
}

/**
 * 공지 row 완전 삭제 — 운영자만(DELETE RLS). 주로 비활성 공지 정리용.
 *   삭제 후 기존 공개 URL 은 RPC 가 null 반환 → "공개되지 않은 공지" 표시.
 *   (납부 원본 데이터는 건드리지 않는다 — finance_public_notices row 만 삭제.)
 */
export async function deleteFinanceNotice(id: string): Promise<void> {
    const { error } = await supabase.from(TBL).delete().eq('id', id);
    if (error) throw error;
}

/** 공개 페이지 — token 으로 RPC 조회. 비활성/없음 → null. */
export async function fetchPublicNoticeByToken(token: string): Promise<PublicNoticeView | null> {
    const { data, error } = await supabase.rpc('get_public_finance_notice', { p_token: token });
    if (error) {
        console.warn('[Finance/notices/public]', error?.message ?? error);
        return null;
    }
    if (!data) return null;
    return data as PublicNoticeView;
}

// ── 공유 텍스트 ──────────────────────────────────────────────────────────────
/** 공개 URL — 절대 경로(브라우저 기준). */
export function publicNoticeUrl(token: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/finance/public/${token}`;
}

/** 남은 금액 큰 순 → 이름 가나다순. */
function byRemainingThenName<T extends { remainingAmount: number; displayName: string }>(a: T, b: T): number {
    return (b.remainingAmount - a.remainingAmount) || a.displayName.localeCompare(b.displayName, 'ko');
}

/**
 * 카카오톡 단체방 안내문 — 선택 월 회비 현황 + 이전 월 이월 미납 + 전체 미납 + 연회비 완료 + 계좌 + 링크.
 *   - 데이터는 생성된 공지의 불변 스냅샷(members/stats/priorArrears)만 사용(실시간 재조회 없음).
 *   - 선택 월 일부 납부/미납과 이전 월 미납은 별도 영역으로 분리(합치지 않음).
 *   - 면제/휴회/준회원/게스트 등은 members 에 애초에 없으므로 명단에 포함되지 않는다.
 */
export function buildKakaoNoticeText(opts: {
    year: number;
    month: number;
    referenceDate: string;
    url: string;
    members: NoticeSnapshotMember[];
    stats: NoticeStats;
    priorArrears?: PriorArrearLine[];
    paymentAccount?: FinancePaymentAccountSnapshot | null;
}): string {
    const { year, month, members, stats } = opts;
    const ref = formatReferenceDot(opts.referenceDate);

    const curPartial = members
        .filter((m) => m.amountPaid > 0 && m.remainingAmount > 0)
        .sort(byRemainingThenName);
    const curUnpaid = members
        .filter((m) => m.amountPaid <= 0 && m.remainingAmount > 0)
        .sort(byRemainingThenName);
    const annualNames = members.filter((m) => m.annualFeePaid).map((m) => m.displayName);

    const priorGroups = groupPriorArrears(opts.priorArrears ?? []);
    const priorRemaining = priorArrearsStatsOf(opts.priorArrears ?? []).remainingAmount;
    const currentRemaining = stats.totalRemaining;
    const overall = currentRemaining + priorRemaining;
    const noArrears = curPartial.length === 0 && curUnpaid.length === 0 && priorGroups.length === 0;

    const lines: string[] = [
        `[TEYEON ${month}월 회비 및 미납 현황]`,
        '',
        `${year}년 ${month}월 회비 납부 현황을 안내드립니다.`,
        `${ref} 기준`,
        '',
        `[${month}월 회비]`,
        `납부 대상 ${stats.targetCount}명`,
        `납부 완료 ${stats.paidCount}명`,
        `일부 납부 ${stats.partialCount}명`,
        `미납 ${stats.unpaidCount}명`,
        `${month}월 남은 금액 ${formatWon(currentRemaining)}`,
        '',
        `[${month}월 일부 납부]`,
        ...(curPartial.length > 0
            ? curPartial.map((m) => `- ${m.displayName}: 납부 ${formatWon(m.amountPaid)} / 남은 금액 ${formatWon(m.remainingAmount)}`)
            : ['- 없음']),
        '',
        `[${month}월 미납]`,
        ...(curUnpaid.length > 0
            ? curUnpaid.map((m) => `- ${m.displayName}: ${formatWon(m.remainingAmount)}`)
            : ['- 없음']),
        '',
        `[이전 월 이월 미납]`,
        ...(priorGroups.length > 0
            ? priorGroups.flatMap((g) => {
                const monthsStr = g.months.map((mm) => `${mm.targetMonth}월 ${formatWon(mm.remainingAmount)}`).join(' / ');
                const row = [`- ${g.displayName}: ${monthsStr}`];
                if (g.months.length > 1) row.push(`  이전 미납 합계 ${formatWon(g.totalRemaining)}`);
                return row;
            })
            : ['- 없음']),
        '',
        `이전 월 미납 ${formatWon(priorRemaining)}`,
        `현재 전체 미납 ${formatWon(overall)}`,
    ];

    if (noArrears) {
        lines.push('');
        lines.push('모든 대상 회원의 회비 납부가 완료되었습니다.');
    }

    if (annualNames.length > 0) {
        lines.push('');
        lines.push('[연회비 납부 완료]');
        for (const n of annualNames) lines.push(`- ${n}`);
    }

    if (opts.paymentAccount) {
        lines.push('');
        lines.push('입금 계좌');
        lines.push(`${opts.paymentAccount.bankName} ${opts.paymentAccount.accountNumberDisplay}`);
        lines.push(`예금주 ${opts.paymentAccount.accountHolder}`);
    }

    lines.push('');
    lines.push('상세 납부 현황');
    lines.push(opts.url);
    return lines.join('\n');
}
