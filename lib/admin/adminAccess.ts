// Admin Console 접근 판정 — 단일 출처(middleware / admin layout / sidebar / settings 가 공유).
//   판정 기준은 반드시 profiles.role(앱 보안 Role). members.role(클럽 직책)은 사용하지 않는다.
//
//   FULL_ADMIN      : CEO / ADMIN            → Admin 전체 접근 + 설정 조회·수정 + Guide 사용
//   SETTINGS_VIEW   : + OPERATOR / FINANCE_MANAGER → /admin/settings 읽기 전용 + /admin/guide-recording 사용
//   SETTINGS_EDIT   : CEO / ADMIN 만          → 설정 변경
//   그 밖의 /admin/** : FULL_ADMIN 만(기존 정책 유지)

import type { UserRole } from '@/context/AuthContext';

export const FULL_ADMIN_ROLES: UserRole[] = ['CEO', 'ADMIN'];
export const OPERATOR_ROLES: UserRole[] = ['OPERATOR']; // 추후 운영진 보안 Role 확장은 이 배열만 수정
/** 설정 조회 + Guide 사용 허용 역할(= FULL_ADMIN + OPERATOR + FINANCE_MANAGER). */
export const SETTINGS_VIEW_ROLES: UserRole[] = ['CEO', 'ADMIN', 'OPERATOR', 'FINANCE_MANAGER'];

const norm = (role?: string | null): string => (role || '').trim().toUpperCase();
const inList = (role: string | null | undefined, list: UserRole[]): boolean =>
    list.includes(norm(role) as UserRole);

export type AdminAccessLevel = 'FULL_ADMIN' | 'OPERATOR_READONLY' | 'NONE';

export const isFullAdminRole = (role?: string | null): boolean => inList(role, FULL_ADMIN_ROLES);
export const isOperatorRole = (role?: string | null): boolean => inList(role, OPERATOR_ROLES);

/** /admin/settings 조회 가능: CEO / ADMIN / OPERATOR / FINANCE_MANAGER. */
export const canViewAdminSettings = (role?: string | null): boolean => inList(role, SETTINGS_VIEW_ROLES);

/**
 * /admin/ranking(Ranking Manager) 접근 가능: CEO  OR  ranking_managers 등재자.
 *   ⚠️ ADMIN 은 자동 포함하지 않는다(요구사항). 추가 대상은 ranking_managers 에 명시 등록.
 *   isRankingManager 는 서버(middleware)/클라(AuthContext)가 can_manage_ranking()/ranking_managers 로 판정해 주입.
 *   role='CEO' 는 can_manage_ranking() 에도 포함되지만, 조회 실패 시에도 CEO 는 통과하도록 role 로 이중 보장.
 */
export const canAccessRankingAdmin = (
  role?: string | null,
  isRankingManager?: boolean,
): boolean => norm(role) === 'CEO' || isRankingManager === true;
/** 설정 변경 가능: CEO / ADMIN 만. */
export const canEditAdminSettings = (role?: string | null): boolean => inList(role, FULL_ADMIN_ROLES);
/** /admin/guide-recording 사용 가능: CEO / ADMIN / OPERATOR / FINANCE_MANAGER. */
export const canUseGuideRecording = (role?: string | null): boolean => inList(role, SETTINGS_VIEW_ROLES);

/** 현재 사용자의 Admin 접근 레벨(메뉴 필터/안내용). */
export function getAdminAccessLevel(role?: string | null): AdminAccessLevel {
    if (isFullAdminRole(role)) return 'FULL_ADMIN';
    if (canViewAdminSettings(role)) return 'OPERATOR_READONLY';
    return 'NONE';
}

/**
 * route 별 접근 허용 판정.
 *   /admin/settings, /admin/guide-recording → SETTINGS_VIEW 허용
 *   그 밖의 /admin/**                        → FULL_ADMIN 만(기존 정책)
 *   /admin 외 경로                           → 이 함수의 대상 아님(true 반환하지 않음 — 호출부에서 /admin 만 전달)
 */
export function canAccessAdminRoute(
    pathname: string | null | undefined,
    role?: string | null,
    opts?: { isRankingManager?: boolean },
): boolean {
    const p = pathname || '';
    if (p === '/admin/settings' || p.startsWith('/admin/settings/')) return canViewAdminSettings(role);
    if (p === '/admin/guide-recording' || p.startsWith('/admin/guide-recording/')) return canUseGuideRecording(role);
    // Ranking Manager 전용 — CEO OR ranking_managers. FULL_ADMIN(ADMIN) 자동 통과 없음.
    if (p === '/admin/ranking' || p.startsWith('/admin/ranking/')) return canAccessRankingAdmin(role, opts?.isRankingManager);
    return isFullAdminRole(role);
}
