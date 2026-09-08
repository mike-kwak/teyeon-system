// 현재 회원(active) / 탈회 회원 판정 — 단일 출처.
//
// 왜 members.role 인가:
//   운영 members 테이블에는 status / is_active / withdrawn / deleted 같은 분류 컬럼이 없다.
//   (supabase/secure_member_column_privileges.sql 의 2026-07-11 REST probe 실측 목록 참조.
//    실존: id, nickname, role, position, club_id, avatar_url, affiliation, mbti, bio,
//          achievements, auth_user_id, email, phone, "나이", member_number, "비고"
//    미존재: intro, is_admin, is_guest, created_at, updated_at, age)
//   또한 members 는 column-level GRANT 로 잠겨 있어(같은 파일) 신규 컬럼을 추가하면
//   `grant select (...)` 를 함께 고쳐야 하고, 누락 시 전 회원 조회가 permission denied 로 깨진다.
//   프로젝트 관례도 동일하다 — lib/finance/duesService.ts: "신규 분류 컬럼은 만들지 않는다".
//   따라서 탈회는 기존 members.role 에 '탈회' 값을 쓰는 방식으로 표현한다(스키마 무변경).
//
// 이 파일이 담당하는 것 / 담당하지 않는 것:
//   ✔ "지금 회원인가" — 현재 명단·참가 후보·현재 랭킹·공개 디렉토리
//   ✘ "과거에 회원이었나" — Archive / 상대전적 / 파트너전적 / FINAL snapshot / 참석·입상·재무 이력
//     과거 기록은 members.id(stable id)로 조회되며 탈회 후에도 그대로 유지된다.
//     ⚠️ 과거 기록 표시용 resolver(이름·아바타 매핑)에는 이 필터를 적용하지 말 것.
//        적용하면 과거 화면에서 이름이 사라지거나 상대전적이 "식별 불가"로 집계된다.
//
// ⚠️ 특정 회원 이름을 이 파일이나 화면에 하드코딩하지 않는다. 탈회는 데이터(role)로만 표현된다.

/** members.role 에 저장되는 탈회 상태 값. */
export const WITHDRAWN_ROLE = '탈회';

/** 클럽 직책(members.role)은 'CEO, 재무' 처럼 쉼표 다중값이 저장될 수 있다. */
export function splitMemberRoles(role: string | null | undefined): string[] {
    return (role ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

/** 탈회 회원인가. 다중 역할 중 하나라도 '탈회'면 탈회로 본다. */
export function isWithdrawnMember(role: string | null | undefined): boolean {
    return splitMemberRoles(role).includes(WITHDRAWN_ROLE);
}

/**
 * 현재 회원인가(= 탈회가 아닌가).
 *   role 이 null/빈 값이어도 active 로 본다 — 데이터 미입력 회원을 명단에서 떨어뜨리지 않기 위함.
 *   (게스트/준회원 등 다른 구분은 이 함수의 책임이 아니다. 월회비 대상 판정은
 *    lib/finance/duesService.isMonthlyFeeTargetMember 가 별도로 담당한다.)
 */
export function isActiveMember(role: string | null | undefined): boolean {
    return !isWithdrawnMember(role);
}

/** members row 배열에서 탈회 회원을 제거한다. 현재 명단·참가 후보 조회 직후에 사용. */
export function filterActiveMembers<T extends { role?: string | null }>(rows: readonly T[]): T[] {
    return (rows ?? []).filter((row) => isActiveMember(row?.role));
}

/**
 * PostgREST `.not('role', 'in', ...)` 에 넣을 값.
 *   행을 받지 않는 count 전용 쿼리(head:true)처럼 클라이언트 필터가 불가능한 경우에만 쓴다.
 *   그 외에는 filterActiveMembers 를 쓸 것 — 쉼표 다중 역할까지 처리한다.
 *   NULL 처리는 기존 `.neq(...)` 와 동일하게 제외된다(동작 변경 없음).
 */
export function excludedRolesPostgrestList(extraRoles: readonly string[] = []): string {
    return `("${[WITHDRAWN_ROLE, ...extraRoles].join('","')}")`;
}
