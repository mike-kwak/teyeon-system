// TEYEON 재무 — 회원 공지용 미납 현황 공개 링크 service.
//   생성 시점 스냅샷을 finance_public_notices 에 고정 저장(불변).
//   공개 조회는 get_public_finance_notice RPC(anon 허용) 만 사용.

import { supabase } from '../supabase';
import { summarizeReceivable } from './calculatePaymentStatus';
import { isMonthlyFeeTargetMember, type FinanceMember } from './duesService';
import { isMemberOnLeaveAtMonth } from './leavesService';
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
export function buildNoticeSnapshot(opts: {
    members: FinanceMember[];
    receivables: FinanceDuesReceivable[];
    payments: FinanceDuesPayment[];
    leaves: FinanceMemberLeave[];
    year: number;
    month: number;
}): { members: NoticeSnapshotMember[]; excluded: NoticeExcludedMember[]; stats: NoticeStats } {
    const { members, receivables, payments, leaves, year, month } = opts;

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
            target.push({
                displayName: nameById[r.member_id] || '회원',
                itemTitle: r.title || `${year}년 ${month}월 회비`,
                amountDue: Math.max(0, r.amount_due),
                amountPaid: s.amount_paid,
                remainingAmount: s.remaining,
                status: st, // 'paid' | 'partial' | 'pending'
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
            // 공개 필드 최소화: 실명 + 항목 + 금액 + 상태 + 사유 + 집계만. (member_id/연락처/메모 없음)
            snapshot_data: { stats: input.stats, members: input.members, excluded: input.excluded },
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

/** 카카오톡 단체방 안내문(기준일 포함). */
export function buildKakaoNoticeText(opts: { referenceDate: string; url: string }): string {
    const ref = formatReferenceDot(opts.referenceDate);
    return [
        '[TEYEON 회비 납부 현황]',
        '',
        `${ref} 기준 회비 납부 현황을 안내드립니다.`,
        '',
        '아래 링크에서 본인의 납부 완료 여부와 남은 금액을 확인해 주세요.',
        '',
        opts.url,
    ].join('\n');
}
