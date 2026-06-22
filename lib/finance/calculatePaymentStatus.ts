// 납부 대상(receivable) + 납부 기록(payments) → 표시용 합성 helper.
// 금액 합계는 항상 payments 기준 — receivable 에 amount_paid 컬럼을 두지 않는다.

import type {
    FinanceDuesPayment,
    FinanceDuesReceivable,
    MemberYearSummary,
    MonthlyDuesOverview,
    PaymentDerivedStatus,
    ReceivableWithPayments,
} from '@/types/finance';

/**
 * 한 receivable + 그에 연결된 payments → 화면용 객체.
 *   - receivable.status 가 exempt/not_target 이면 그것이 derivedStatus 최우선.
 *   - 그 외엔 amount_paid vs amount_due 비교로 paid / partial / pending 결정.
 *   - remaining = max(amount_due - amount_paid, 0). exempt/not_target 은 0.
 *   - is_voided=true 인 payment 는 합계/이력에서 제외.
 */
export function summarizeReceivable(
    receivable: FinanceDuesReceivable,
    payments: FinanceDuesPayment[],
): ReceivableWithPayments {
    const linked = payments.filter((p) => p.receivable_id === receivable.id && p.is_voided !== true);
    const amountPaid = linked.reduce((acc, p) => acc + (p.amount || 0), 0);
    const due = Math.max(0, receivable.amount_due);

    let derivedStatus: PaymentDerivedStatus;
    let remaining: number;
    if (receivable.status === 'exempt') {
        derivedStatus = 'exempt';
        remaining = 0;
    } else if (receivable.status === 'not_target') {
        derivedStatus = 'not_target';
        remaining = 0;
    } else if (amountPaid <= 0) {
        derivedStatus = 'pending';
        remaining = due;
    } else if (amountPaid < due) {
        derivedStatus = 'partial';
        remaining = Math.max(0, due - amountPaid);
    } else {
        derivedStatus = 'paid';
        remaining = 0;
    }

    // 최근 납부일 — paid_at 내림차순.
    let latestPaidAt: string | null = null;
    for (const p of linked) {
        if (!p.paid_at) continue;
        if (!latestPaidAt || p.paid_at > latestPaidAt) latestPaidAt = p.paid_at;
    }

    return {
        receivable,
        amount_paid: amountPaid,
        payments: linked,
        derivedStatus,
        remaining,
        latestPaidAt,
    };
}

/**
 * 한 회원의 한 연도 요약. receivable 목록과 payment 목록을 받아 집계.
 */
export function summarizeMemberYear(
    memberId: string,
    year: number,
    receivables: FinanceDuesReceivable[],
    payments: FinanceDuesPayment[],
): MemberYearSummary {
    const myReceivables = receivables.filter(
        (r) => r.member_id === memberId && (r.target_year ?? year) === year,
    );
    const myPayments = payments.filter((p) => p.member_id === memberId && p.is_voided !== true);
    const summaries = myReceivables.map((r) => summarizeReceivable(r, myPayments));

    let totalDue = 0;
    let totalPaid = 0;
    let totalRemaining = 0;
    let paidCount = 0;
    let partialCount = 0;
    let pendingCount = 0;
    let exemptCount = 0;
    for (const s of summaries) {
        const r = s.receivable;
        const isExemptOrNot = r.status === 'exempt' || r.status === 'not_target';
        if (!isExemptOrNot) {
            totalDue += r.amount_due;
            totalRemaining += s.remaining;
        }
        totalPaid += s.amount_paid;
        if (s.derivedStatus === 'paid') paidCount++;
        else if (s.derivedStatus === 'partial') partialCount++;
        else if (s.derivedStatus === 'pending') pendingCount++;
        else if (s.derivedStatus === 'exempt') exemptCount++;
    }

    return {
        member_id: memberId,
        year,
        totalDue,
        totalPaid,
        totalRemaining,
        receivableCount: summaries.length,
        paidCount,
        partialCount,
        pendingCount,
        exemptCount,
    };
}

/**
 * 한 월의 전체 회원 집계.
 *   - 대상 회원 = 해당 (year, month) 에 receivable 이 있는 회원
 *     (exempt / not_target 도 포함 — 그 카운트는 따로 표시)
 *   - 납부율 = paidCount / (targetCount - exemptCount - notTargetCount) * 100
 *     (분모가 0 이면 0%)
 */
export function summarizeMonthlyDues(
    year: number,
    month: number,
    receivables: FinanceDuesReceivable[],
    payments: FinanceDuesPayment[],
): MonthlyDuesOverview {
    const monthReceivables = receivables.filter(
        (r) => r.target_year === year && r.target_month === month,
    );

    let paidCount = 0, partialCount = 0, pendingCount = 0, exemptCount = 0, notTargetCount = 0;
    let totalDue = 0, totalPaid = 0, totalRemaining = 0;

    for (const r of monthReceivables) {
        const s = summarizeReceivable(r, payments);
        switch (s.derivedStatus) {
            case 'paid':       paidCount++; break;
            case 'partial':    partialCount++; break;
            case 'pending':    pendingCount++; break;
            case 'exempt':     exemptCount++; break;
            case 'not_target': notTargetCount++; break;
        }
        if (s.derivedStatus !== 'exempt' && s.derivedStatus !== 'not_target') {
            totalDue += r.amount_due;
            totalRemaining += s.remaining;
        }
        totalPaid += s.amount_paid;
    }

    const effectiveTarget = paidCount + partialCount + pendingCount;
    const paidRate = effectiveTarget > 0
        ? Math.round((paidCount / effectiveTarget) * 100)
        : 0;

    return {
        year, month,
        targetCount: monthReceivables.length,
        paidCount, partialCount, pendingCount, exemptCount, notTargetCount,
        totalDue, totalPaid, totalRemaining,
        paidRate,
    };
}
