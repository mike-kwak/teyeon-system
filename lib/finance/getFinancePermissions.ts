import type { UserRole } from '@/context/AuthContext';
import type { FinancePermissions } from '@/types/finance';

/**
 * Finance UI gating 단일 규칙.
 *   canManage  : CEO / ADMIN / FINANCE_MANAGER  → 전체 회원 조회 + 등록 + 수정
 *   isSelfOnly : 일반 회원                       → 본인 데이터만 조회
 * RLS 가 1차 방어선 (DB), 이 helper 는 UI 분기용 2차 방어선.
 */
export function getFinancePermissions(role: UserRole | null | undefined): FinancePermissions {
    const canManage =
        role === 'CEO' || role === 'ADMIN' || role === 'FINANCE_MANAGER';
    return {
        canManage,
        isSelfOnly: !canManage,
    };
}

/** 관리 권한 boolean 만 필요할 때 짧게 호출. */
export function canManageFinance(role: UserRole | null | undefined): boolean {
    return role === 'CEO' || role === 'ADMIN' || role === 'FINANCE_MANAGER';
}
