// Finance 도메인 공통 타입 — 수동 회비·납부 관리.
// 1차 범위: 거래내역 자동 분류 / CSV 업로드 / 통장 잔액은 다루지 않음.

export type FinanceReceivableType =
    | 'monthly_fee'
    | 'annual_fee'
    | 'guest_fee'
    | 'penalty'
    | 'event_fee'
    | 'other';

export const RECEIVABLE_TYPE_LABEL: Record<FinanceReceivableType, string> = {
    monthly_fee: '월회비',
    annual_fee:  '연회비',
    guest_fee:   '게스트비',
    penalty:     '벌금',
    event_fee:   '행사비',
    other:       '기타',
};

/** 납부 상태 (관리자 결정 + 계산 혼합). */
export type FinanceReceivableStatus =
    | 'pending'       // 미납 (기본)
    | 'partial'       // 일부 납부 — 계산값과 별개로 명시 가능
    | 'paid'          // 납부 완료
    | 'exempt'        // 면제
    | 'not_target'    // 비대상
    | 'prepaid'       // 선납
    | 'needs_review'; // 확인 필요

export const RECEIVABLE_STATUS_LABEL: Record<FinanceReceivableStatus, string> = {
    pending:       '미납',
    partial:       '일부 납부',
    paid:          '납부 완료',
    exempt:        '면제',
    not_target:    '비대상',
    prepaid:       '선납',
    needs_review:  '확인 필요',
};

/** 화면 통계용 — receivable.status 와 별개로 결제 합계 기반 자동 계산값. */
export type PaymentDerivedStatus =
    | 'paid'        // amount_paid >= amount_due (and > 0)
    | 'partial'     // 0 < amount_paid < amount_due
    | 'pending'     // amount_paid == 0
    | 'exempt'      // status='exempt' 우선
    | 'not_target'; // status='not_target' 우선

// ── DB row 형태 ───────────────────────────────────────────────────────────

export interface FinanceFeeRule {
    id: string;
    year: number;
    month: number;                // 1~12
    title: string | null;
    default_amount: number;
    due_date: string | null;      // 'YYYY-MM-DD'
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface FinanceDuesReceivable {
    id: string;
    member_id: string;
    receivable_type: FinanceReceivableType;
    title: string | null;
    target_year: number | null;
    target_month: number | null;  // 1~12 or null (연회비 등)
    amount_due: number;
    due_date: string | null;
    status: FinanceReceivableStatus;
    exemption_reason: string | null;
    /** 회원 공개 메모. 일반 회원의 본인 응답에도 포함됨. */
    memo: string | null;
    /** 운영진 전용 메모. RLS + RPC 양쪽에서 회원 응답 제외. 회원 자료엔 undefined. */
    admin_memo?: string | null;
    /** KDK 공식 기록에서 자동 생성된 벌금일 때 출처 세션 id(teyeon_archive_v1.id). 수동 등록은 null. */
    related_kdk_session_id?: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface FinanceDuesPayment {
    id: string;
    member_id: string;
    receivable_id: string | null;
    payment_type: FinanceReceivableType;
    amount: number;
    paid_at: string;             // 'YYYY-MM-DD'
    /** 회원 공개 메모. */
    memo: string | null;
    /** 운영진 전용 메모. 회원 응답 제외. */
    admin_memo?: string | null;
    /** soft-cancel — 합계 계산에서 제외. */
    is_voided?: boolean;
    voided_at?: string | null;
    voided_by?: string | null;
    void_reason?: string | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}

/** 회원 휴회 구간. 월회비 일괄 생성 제외 + 납부 현황 표시. */
export interface FinanceMemberLeave {
    id: string;
    member_id: string;
    start_date: string;          // 'YYYY-MM-DD'
    end_date: string | null;     // null = 무기한
    reason: string | null;
    created_by?: string | null;
    created_at?: string;
    updated_at?: string;
}

// ── 파생 / 화면 표시용 ────────────────────────────────────────────────────

export interface ReceivableWithPayments {
    receivable: FinanceDuesReceivable;
    /** 이 receivable 에 직접 연결된 payments 합계. */
    amount_paid: number;
    payments: FinanceDuesPayment[];
    /** 표시용 파생 상태 (manual status 와 합성). */
    derivedStatus: PaymentDerivedStatus;
    /** max(amount_due - amount_paid, 0). exempt/not_target 은 0. */
    remaining: number;
    /** 최근 납부일. 없으면 null. */
    latestPaidAt: string | null;
}

/** 한 회원의 한 연도 요약. */
export interface MemberYearSummary {
    member_id: string;
    year: number;
    totalDue: number;
    totalPaid: number;
    totalRemaining: number;
    receivableCount: number;
    paidCount: number;
    partialCount: number;
    pendingCount: number;
    exemptCount: number;
}

/** 관리자 홈 / 납부 현황의 월별 집계. */
export interface MonthlyDuesOverview {
    year: number;
    month: number;
    targetCount: number;       // 대상 회원 수
    paidCount: number;
    partialCount: number;
    pendingCount: number;
    exemptCount: number;
    notTargetCount: number;
    totalDue: number;
    totalPaid: number;
    totalRemaining: number;
    /** 0~100. exempt/not_target 제외 기준. */
    paidRate: number;
}

/** 권한 — UI gating + 가드. */
export interface FinancePermissions {
    canManage: boolean;     // CEO / ADMIN / FINANCE_MANAGER
    isSelfOnly: boolean;    // 일반 회원
}
