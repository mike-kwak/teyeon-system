// KDK 세션 벌금·상금 현황 공개 공지 service.
//   - 생성 시점 스냅샷을 finance_kdk_settlement_notices 에 고정(불변).
//   - 같은 세션에서 여러 번 생성 가능(최초 안내 / 중간 / 최종).
//   - 공개 조회는 get_public_kdk_notice RPC(anon 허용) 만.
//   - 월회비 공개공지(finance_public_notices)와 완전히 분리.

import { supabase } from '../supabase';
import { formatWon } from './formatFinanceAmount';
import { generatePublicToken, formatSeoulDateTime } from './noticesService';
import { FINANCE_PAYMENT_ACCOUNT, type FinancePaymentAccountSnapshot } from './paymentAccount';
import type { KdkPenaltyRow } from './kdkSettlementService';
import type { KdkPrizeDerivation, KdkPrizePayout } from './kdkPrizeService';

const TBL = 'finance_kdk_settlement_notices';

export type KdkNoticeMemberStatus = 'paid' | 'partial' | 'pending';

export interface KdkNoticeMember {
    name: string;
    amount: number;
    status: KdkNoticeMemberStatus;
    paidAt: string | null;   // 'YYYY-MM-DD' | null
}

export interface KdkNoticePrize {
    overallWinnerName: string;
    overallWinnerIsGuest: boolean;
    recipientName: string | null;       // null = 상금 지급 대상 없음/미확정.
    recipientOverallRank: number | null;
    amount: number;
    status: 'paid' | 'unpaid';
    paidAt: string | null;              // ISO | null
}

export interface KdkNoticeStats {
    targetCount: number;
    paidCount: number;
    unpaidCount: number;
    totalPenalty: number;
    totalPaid: number;
    totalUnpaid: number;
}

export interface PublicKdkNoticeView {
    title: string;
    kdkDate: string | null;
    sessionTitle: string | null;
    referenceAt: string;      // ISO
    dueAt: string | null;     // ISO
    publicNote: string | null;
    rankingUrl: string | null;
    stats: KdkNoticeStats;
    members: KdkNoticeMember[];
    prize: KdkNoticePrize | null;
    /** 생성 시점 입금 계좌 스냅샷. 구버전 공지엔 없을 수 있어 optional. */
    paymentAccount?: FinancePaymentAccountSnapshot | null;
}

export interface KdkNoticeListRow {
    id: string;
    token: string;
    title: string;
    related_kdk_session_id: string;
    kdk_date: string | null;
    session_title: string | null;
    reference_at: string;
    due_at: string | null;
    target_count: number;
    paid_count: number;
    unpaid_count: number;
    total_unpaid: number;
    is_active: boolean;
    created_at: string;
    deactivated_at: string | null;
}

// ── 스냅샷 빌드 ──────────────────────────────────────────────────────────────
/** 벌금 대상 행(amount>0) → 공개 멤버 스냅샷. 미등록/연결필요는 '미납'으로 표기. 0원 제외. */
export function buildKdkNoticeMembers(rows: KdkPenaltyRow[]): KdkNoticeMember[] {
    return rows
        .filter((r) => r.amount > 0)
        .map((r) => {
            const status: KdkNoticeMemberStatus =
                r.status === 'paid' ? 'paid' : r.status === 'partial' ? 'partial' : 'pending';
            return {
                name: r.memberName || r.playerName,
                amount: r.amount,
                status,
                paidAt: r.status === 'paid' || r.status === 'partial' ? r.paidAt : null,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function buildKdkNoticeStats(members: KdkNoticeMember[]): KdkNoticeStats {
    // 공개 집계 단순화: 완납(paid)만 납부 완료로 보고, 그 외(partial/pending)는 미납으로 집계.
    // 벌금은 고정 소액이라 부분납이 드물며, 개별 partial 금액은 표의 개별 행에서 확인 가능.
    let paidCount = 0, unpaidCount = 0, totalPenalty = 0, totalPaid = 0;
    for (const m of members) {
        totalPenalty += m.amount;
        if (m.status === 'paid') { paidCount += 1; totalPaid += m.amount; }
        else { unpaidCount += 1; }
    }
    return {
        targetCount: members.length,
        paidCount, unpaidCount,
        totalPenalty, totalPaid,
        totalUnpaid: totalPenalty - totalPaid,
    };
}

/** 상금 스냅샷 — 실제 1위(overallWinner)와 지급 대상(recipient)을 분리해 고정. */
export function buildKdkNoticePrize(
    derivation: KdkPrizeDerivation,
    payout: KdkPrizePayout | null,
): KdkNoticePrize | null {
    if (!derivation.hasRanking || !derivation.overallWinner) return null;
    const recipientName = payout
        ? payout.recipient_name
        : (derivation.recipient.status === 'eligible' ? derivation.recipient.name : null);
    const recipientOverallRank = payout ? payout.recipient_overall_rank : derivation.recipient.overallRank;
    return {
        overallWinnerName: derivation.overallWinner.name,
        overallWinnerIsGuest: derivation.overallWinner.isGuest,
        recipientName,
        recipientOverallRank,
        amount: payout ? payout.amount : derivation.defaultAmount,
        status: payout ? payout.status : 'unpaid',
        paidAt: payout?.paid_at ?? null,
    };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
export interface CreateKdkNoticeInput {
    sessionId: string;
    kdkDate: string | null;
    sessionTitle: string | null;
    title: string;
    referenceAt: string;        // ISO
    dueAt: string | null;       // ISO
    publicNote: string | null;
    rankingUrl: string | null;
    members: KdkNoticeMember[];
    stats: KdkNoticeStats;
    prize: KdkNoticePrize | null;
    /** 미지정 시 현재 공용 계좌(FINANCE_PAYMENT_ACCOUNT)를 포함. null 로 명시하면 제외. */
    paymentAccount?: FinancePaymentAccountSnapshot | null;
}

export async function createKdkNotice(input: CreateKdkNoticeInput): Promise<{ token: string; id: string }> {
    const token = generatePublicToken();
    let createdBy: string | null = null;
    try {
        const { data: u } = await supabase.auth.getUser();
        createdBy = u?.user?.id ?? null;
    } catch { /* noop */ }

    const { data, error } = await supabase
        .from(TBL)
        .insert({
            token,
            related_kdk_session_id: input.sessionId,
            archive_id: input.sessionId,
            kdk_date: input.kdkDate,
            session_title: input.sessionTitle,
            title: input.title.trim() || 'TEYEON KDK 벌금 납부 현황',
            reference_at: input.referenceAt,
            due_at: input.dueAt,
            public_note: input.publicNote && input.publicNote.trim() ? input.publicNote.trim() : null,
            ranking_url: input.rankingUrl,
            target_count: input.stats.targetCount,
            paid_count: input.stats.paidCount,
            unpaid_count: input.stats.unpaidCount,
            total_penalty: input.stats.totalPenalty,
            total_paid: input.stats.totalPaid,
            total_unpaid: input.stats.totalUnpaid,
            snapshot_data: {
                members: input.members,
                prize: input.prize,
                paymentAccount: input.paymentAccount === undefined ? FINANCE_PAYMENT_ACCOUNT : input.paymentAccount,
            },
            is_active: true,
            created_by: createdBy,
        })
        .select('id, token')
        .single();
    if (error) throw new Error(error?.message || '공지 생성에 실패했습니다.');
    return { token: (data as any).token, id: (data as any).id };
}

export async function listKdkNotices(sessionId: string): Promise<KdkNoticeListRow[]> {
    const { data, error } = await supabase
        .from(TBL)
        .select('id, token, title, related_kdk_session_id, kdk_date, session_title, reference_at, due_at, target_count, paid_count, unpaid_count, total_unpaid, is_active, created_at, deactivated_at')
        .eq('related_kdk_session_id', sessionId)
        .order('created_at', { ascending: false });
    if (error) {
        console.warn('[Finance/kdkNotice/list]', error?.message ?? error);
        return [];
    }
    return (data || []) as KdkNoticeListRow[];
}

export async function deactivateKdkNotice(id: string): Promise<void> {
    let by: string | null = null;
    try { const { data: u } = await supabase.auth.getUser(); by = u?.user?.id ?? null; } catch { /* noop */ }
    const { error } = await supabase
        .from(TBL)
        .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivated_by: by })
        .eq('id', id);
    if (error) throw new Error(error?.message || '공지 비활성화에 실패했습니다.');
}

export async function deleteKdkNotice(id: string): Promise<void> {
    const { error } = await supabase.from(TBL).delete().eq('id', id);
    if (error) throw new Error(error?.message || '공지 삭제에 실패했습니다.');
}

export async function fetchPublicKdkNotice(token: string): Promise<PublicKdkNoticeView | null> {
    const { data, error } = await supabase.rpc('get_public_kdk_notice', { p_token: token });
    if (error) {
        console.warn('[Finance/kdkNotice/public]', error?.message ?? error);
        return null;
    }
    if (!data) return null;
    return data as PublicKdkNoticeView;
}

// ── 공유 ─────────────────────────────────────────────────────────────────────
export function publicKdkNoticeUrl(token: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/finance/public/kdk/${token}`;
}

/** 'YYYY-MM-DD' → '2026.06.25'. */
function dateDot(dateStr: string | null): string {
    if (!dateStr) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : dateStr;
}

/** 카카오톡 안내문 — 실제 1위 / 상금 지급 대상 / 벌금 납부 안내. */
export function buildKdkKakaoText(opts: {
    kdkDate: string | null;
    referenceAt: string;        // ISO
    dueAt: string | null;       // ISO
    prize: KdkNoticePrize | null;
    paymentAccount?: FinancePaymentAccountSnapshot | null;
    url: string;
}): string {
    const lines: string[] = [
        '[TEYEON KDK 결과 및 정산 안내]',
        '',
        `${dateDot(opts.kdkDate)} KDK 결과와 벌금 납부 현황을 안내드립니다.`,
        '',
        opts.dueAt ? `납부 마감: ${formatSeoulDateTime(opts.dueAt)}` : '',
        `기준 시각: ${formatSeoulDateTime(opts.referenceAt)}`,
    ].filter(Boolean);

    // KDK 1등 상금(클럽 지급)과 혼동되지 않게 반드시 '벌금 입금 계좌'로 표기.
    if (opts.paymentAccount) {
        lines.push('');
        lines.push('벌금 입금 계좌');
        lines.push(`${opts.paymentAccount.bankName} ${opts.paymentAccount.accountNumberDisplay}`);
        lines.push(`예금주 ${opts.paymentAccount.accountHolder}`);
    }

    if (opts.prize) {
        lines.push('');
        lines.push(`최종 1위: ${opts.prize.overallWinnerName}${opts.prize.overallWinnerIsGuest ? '(게스트)' : ''}`);
        if (opts.prize.recipientName) {
            const rankPart = opts.prize.recipientOverallRank ? `(전체 ${opts.prize.recipientOverallRank}위)` : '';
            lines.push(`KDK 상금 지급 대상: ${opts.prize.recipientName}${rankPart}`);
            lines.push(`상금: ${formatWon(opts.prize.amount)}`);
            lines.push(`지급 상태: ${opts.prize.status === 'paid' ? '지급 완료' : '미지급'}`);
        } else {
            lines.push('KDK 상금 지급 대상: 없음');
        }
    }

    lines.push('');
    lines.push('아래 링크에서 전체 순위와 벌금 납부 상태를 확인해 주세요.');
    lines.push('');
    lines.push(opts.url);
    lines.push('');
    lines.push('미납자는 마감 시간까지 입금 부탁드립니다.');
    return lines.join('\n');
}
