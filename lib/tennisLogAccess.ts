// TENNIS LOG 접근 판정 — 메인 카드와 /tennis-log 라우트가 공유하는 단일 소스.
//
// 기준: **실제 클럽 회원 자격(members.role)**.
//   · profiles.role(앱 보안 Role)이 아니라 클럽 회원 자격을 우선 기준으로 한다.
//   · 로그인 사용자 ↔ members 연결은 프로젝트 공통 resolver(resolveMemberDisplays)를
//     재사용한다(우선순위: members.id → members.auth_user_id → members.email).
//   · 회원 게스트/준회원 구분은 members.role 로 한다. (운영 members 테이블에
//     is_guest 컬럼은 존재하지 않으므로 사용하지 않는다 — memberDisplayResolver 주석 참조.)
//
// 판정(화이트리스트 — 허용 역할만 명시):
//   · 미로그인                          → 'unauthenticated' (로그인 유도/리다이렉트)
//   · members.role ∈ 허용 목록           → 'allowed'
//   · 그 외 전부 → 'locked'
//       (게스트·빈 값·알 수 없는 신규 역할·members 미연결·조회 실패 포함)
//
// 허용 역할(SQL can_access_tennis_log() 와 동일 기준):
//   정회원 · 준회원 · 회장 · 부회장 · 총무 · 재무 · 경기 · 섭외 · CEO
//   (members.role 실제 값 — scripts/sync_members.js / AuthContext members 조회 기준으로 확인됨.
//    운영 데이터상 CEO 클럽 역할은 members.role 에 존재하므로 본인 TENNIS LOG 사용을 허용한다.
//    단, ADMIN 은 시스템 보안 권한이지 클럽 회원 자격이 아니므로 단독으로는 허용하지 않는다.)
//   차단 목록(blocklist) 방식이 아니라, 위 9개만 허용하는 whitelist 로 처리한다.
//   잠금 대상: ADMIN 단독 · 게스트 · 빈 값 · 알 수 없는 역할 · members 미연결.
//   다중 역할: members.role 에 'CEO, 재무' 처럼 쉼표로 여러 역할이 저장될 수 있어,
//             쉼표로 분리·trim 후 하나라도 허용 역할이면 통과한다('게스트, CEO' → allowed).

export type TennisLogAccess = 'loading' | 'unauthenticated' | 'locked' | 'allowed';

// 허용 클럽 자격(이 목록에 정확히 포함되는 members.role 만 접근 가능).
const ALLOWED_MEMBER_ROLES = new Set<string>([
  '정회원',
  '준회원',
  '회장',
  '부회장',
  '총무',
  '재무',
  '경기',
  '섭외',
  'CEO',
]);

/**
 * TENNIS LOG 접근 권한(순수 판정, 화이트리스트). 로딩은 호출측(useTennisLogAccess)에서 관리한다.
 * @param hasUser    로그인 여부
 * @param memberRole 연결된 members.role (없으면 null) — 보안 Role 아님, 클럽 자격
 */
export function resolveTennisLogAccess(
  hasUser: boolean,
  memberRole: string | null | undefined,
): Exclude<TennisLogAccess, 'loading'> {
  if (!hasUser) return 'unauthenticated';
  // members.role 은 'CEO, 재무' 처럼 쉼표로 다중 역할이 저장될 수 있다.
  // 쉼표로 분리 → 각 역할 trim → 빈 값 제거 후, 하나라도 허용 역할이면 통과.
  // (단일 역할도 동일하게 동작: '정회원' → ['정회원'] → 통과.)
  const roles = (memberRole ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return roles.some((value) => ALLOWED_MEMBER_ROLES.has(value)) ? 'allowed' : 'locked';
}

// 잠금/안내 문구 — 카드 클릭 안내와 라우트 가드 화면이 동일 문구를 사용.
export const TENNIS_LOG_LOCKED_TITLE = 'TEYEON 회원 전용 기능';
export const TENNIS_LOG_LOCKED_BODY =
  'TENNIS LOG는 TEYEON 회원 전용 기능입니다. 게스트 계정은 이용할 수 없으며, 클럽 회원만 나만의 테니스 기록을 이용할 수 있습니다.';
