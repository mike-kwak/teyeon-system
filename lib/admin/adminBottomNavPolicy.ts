// Admin BottomNav 표시 정책 — 단일 소스(순수 함수).
//
//   AdminBottomNav 는 모바일에서 화면 아래를 덮는 fixed 바다. 대회 당일 관제(Control Center)는
//   진행 중 경기의 [점수 입력] · [경기 시작] 버튼이 화면 아래쪽에 자주 오기 때문에, 스와이프가 멈춘 위치에 따라
//   버튼이 바 밑에 깔려 누를 수 없었다(qa-4f3-supp P2). 그래서 이 화면에서만 바를 숨긴다.
//   이동은 상단 AdminHeader 의 ☰(전체 메뉴)로 그대로 할 수 있다.
//
//   ⚠ 정확한 pathname 일치로만 숨긴다. 접두사 · 패턴 매칭 금지 — 다른 관리자 화면은 바를 그대로 둔다.
//   ⚠ 공식 대회가 늘면 그 대회의 관제 경로를 여기에 추가한다(대회 정보가 없는 slug 는 '대회를 찾을 수 없습니다'
//     안내만 나오므로 바를 숨길 이유가 없다).
//   ⚠ 일반 앱의 BottomNav 정책(lib/navigation/bottomNavPolicy.ts)과는 별개다 — /admin/** 은 Admin shell 이 맡는다.

import { TEYEON_OPEN_2026_SLUG } from '@/lib/tournaments/officialInfo';

/** BottomNav 를 숨기는 관리자 경로(정확히 일치). */
export const ADMIN_BOTTOM_NAV_HIDDEN_PATHS: ReadonlySet<string> = new Set([
  `/admin/tournaments/${TEYEON_OPEN_2026_SLUG}/control`,
]);

/** 이 관리자 경로에서 모바일 BottomNav 를 보이는가. */
export function shouldShowAdminBottomNav(pathname: string | null | undefined): boolean {
  return !ADMIN_BOTTOM_NAV_HIDDEN_PATHS.has(pathname || '');
}
