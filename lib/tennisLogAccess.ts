// TENNIS LOG 접근 판정 — 메인 카드와 /tennis-log 라우트가 공유하는 단일 소스.
//
// 기준: **실제 클럽 회원 자격(members.role)**.
//   · profiles.role(앱 보안 Role)이 아니라 클럽 회원 자격을 우선 기준으로 한다.
//   · 로그인 사용자 ↔ members 연결은 프로젝트 공통 resolver(resolveMemberDisplays)를
//     재사용한다(우선순위: members.id → members.auth_user_id → members.email).
//   · 회원 게스트/준회원 구분은 members.role 로 한다. (운영 members 테이블에
//     is_guest 컬럼은 존재하지 않으므로 사용하지 않는다 — memberDisplayResolver 주석 참조.)
//
// 판정:
//   · 미로그인                         → 'unauthenticated' (로그인 유도/리다이렉트)
//   · members 미연결(role 없음)        → 'locked' (확인된 클럽 회원이 아님 → 안전한 잠금 기본값)
//   · members.role ∈ {준회원, 게스트}   → 'locked'
//   · 그 외(정회원 + 운영진 직책)       → 'allowed'
//
// (역할명/값을 추측해 새로 만들지 않는다. members.role 의 실제 값:
//  회장·부회장·총무·재무·경기·섭외(운영진 직책)·정회원·준회원·게스트 — scripts/sync_members.js,
//  AuthContext 의 members 조회 기준으로 확인됨.)

export type TennisLogAccess = 'loading' | 'unauthenticated' | 'locked' | 'allowed';

// 잠금 대상 클럽 자격(정회원/운영진 외). 'GUEST' 는 일부 데이터의 영문 표기 호환.
const LOCKED_MEMBER_ROLES = new Set<string>(['준회원', '게스트', 'GUEST']);

/**
 * TENNIS LOG 접근 권한(순수 판정). 로딩은 호출측(useTennisLogAccess)에서 관리한다.
 * @param hasUser    로그인 여부
 * @param memberRole 연결된 members.role (없으면 null) — 보안 Role 아님, 클럽 자격
 */
export function resolveTennisLogAccess(
  hasUser: boolean,
  memberRole: string | null | undefined,
): Exclude<TennisLogAccess, 'loading'> {
  if (!hasUser) return 'unauthenticated';
  const r = (memberRole ?? '').trim();
  if (!r) return 'locked'; // 회원 미연결 → 안전한 잠금 기본값
  if (LOCKED_MEMBER_ROLES.has(r) || r.toUpperCase() === 'GUEST') return 'locked';
  return 'allowed';
}

// 잠금/안내 문구 — 카드 클릭 안내와 라우트 가드 화면이 동일 문구를 사용.
export const TENNIS_LOG_LOCKED_TITLE = 'TEYEON 회원 전용 기능';
export const TENNIS_LOG_LOCKED_BODY =
  'TENNIS LOG는 TEYEON 정회원 전용 기능입니다. 준회원·게스트는 이용할 수 없으며, 정회원으로 활동 중인 회원만 나만의 테니스 기록을 이용할 수 있습니다.';
