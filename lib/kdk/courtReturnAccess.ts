// KDK 코트 복귀(투입 취소) — 임원 직책 판정의 앱 측 단일 소스.
//
//   서버 기준: supabase/closing_sprint/B1_kdk_court_return_officers.sql 의 kdk_can_return_court(p_club_id)
//     = can_manage_kdk()(CEO · ADMIN · KDK 관리자, 기존 그대로)
//       OR (members.role 토큰 ∈ 아래 6개 · 같은 클럽 · 탈회 아님 · profiles.role ≠ GUEST)
//   앱은 이 파일로 "서버 판정 RPC 를 호출할 필요가 있는가"만 정한다(직책 없는 회원은 호출하지 않음 → 불필요한 요청 0).
//   버튼 노출 · 실제 복귀 허용은 항상 서버 RPC 결과가 기준이다(이 판정만으로 권한을 주지 않는다).

/** 코트 복귀 권한이 있는 클럽 임원 직책(members.role 토큰). SQL 목록과 반드시 같게 유지한다. */
export const KDK_COURT_RETURN_POSITIONS: readonly string[] = ['회장', '부회장', '총무', '재무', '경기', '섭외'];

const POSITION_SET = new Set(KDK_COURT_RETURN_POSITIONS);

/** members.role 쉼표 다중값 → trim 된 토큰 목록('CEO, 재무' → ['CEO', '재무']). SQL string_to_array + btrim 과 같다. */
export function splitMemberRoleTokens(role: string | null | undefined): string[] {
    return String(role ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

export type LinkedMemberRow = { role?: string | null; club_id?: string | null };

/**
 * 로그인 사용자에 연결된(members.auth_user_id = uid) 행들로 임원 직책 경로 해당 여부를 판정.
 *   - 같은 클럽(club_id 일치) 행에 6개 직책 토큰이 하나라도 있어야 한다.
 *   - 연결된 행 어디에든 '탈회' 토큰이 있으면 false(SQL kdk_actor_withdrawn 과 같음).
 *   - GUEST 앱 역할은 호출측에서 먼저 제외한다.
 */
export function isCourtReturnOfficer(rows: readonly LinkedMemberRow[] | null | undefined, clubId: string): boolean {
    const list = rows ?? [];
    const club = String(clubId ?? '').trim();
    if (!club || list.length === 0) return false;
    if (list.some((r) => splitMemberRoleTokens(r.role).includes('탈회'))) return false;
    return list.some((r) => String(r.club_id ?? '').trim() === club && splitMemberRoleTokens(r.role).some((t) => POSITION_SET.has(t)));
}

/** PostgREST "함수 없음"(운영 SQL 미적용) 응답인가 — PGRST202 / 404. */
export function isMissingRpcError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { code?: unknown; status?: unknown; message?: unknown };
    if (e.code === 'PGRST202' || e.code === '42883' || e.status === 404) return true;
    return typeof e.message === 'string' && /could not find the function/i.test(e.message);
}

// 함수 없음(404)을 확인하면 "같은 페이지 생명주기 · 같은 계정" 동안만 다시 호출하지 않는다.
//   - 메모리에만 기억(영구 저장 · sessionStorage 사용 안 함): SQL 적용 후 새로고침 · 새 탭 · 재로그인이면 즉시 다시 조회한다.
//   - 계정이 바뀌면(로그아웃 → 다른 계정 로그인) 기억이 무효 — uid 단위로 기억한다.
//   - SPA 안에서 /kdk 를 다시 열거나 권한 effect 가 재실행돼도 같은 계정이면 404 를 반복하지 않는다.
let missingForUid: string | null = null;

export function isCourtReturnRpcKnownMissing(uid: string | null | undefined): boolean {
    return !!uid && missingForUid === uid;
}

export function markCourtReturnRpcMissing(uid: string | null | undefined): void {
    missingForUid = uid || null;
}

/** 시험용 — 기억 초기화(= 새로고침). */
export function __resetCourtReturnRpcMemo(): void { missingForUid = null; }
