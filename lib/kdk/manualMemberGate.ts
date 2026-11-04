// KDK 수동 대진 — 회원 목록 조회 상태 게이트.
//
// 왜 필요한가:
//   이름 매칭은 allMembers(회원 목록)에서 후보를 찾고, 후보가 없으면 GUEST 로 둔다.
//   회원 목록 조회가 실패하거나(네트워크·세션 만료·권한) 0명이면 모든 이름이 GUEST 가 되어,
//   그대로 저장하면 실제 회원 기록이 게스트로 남는다(Ranking·Archive·Finance 오염).
//   → 회원 목록을 "정상 조회 + 1명 이상" 확인한 뒤에만 매칭 결과를 보여 주고 저장을 허용한다.
//   매칭 규칙(normalizeManualName · stable member id) 자체는 바꾸지 않는다.

export type ManualMemberPoolState = {
    isLoading: boolean;
    isError: boolean;
    memberCount: number; // 조회된 현재 회원 수(게스트 제외)
};

export type ManualMemberGate =
    | { ready: true }
    | { ready: false; kind: 'LOADING' | 'ERROR' | 'EMPTY'; title: string; detail: string };

/** 수동 대진 이름 매칭·저장 진행 가능 여부. ready 가 아니면 GUEST 자동 지정·저장 금지. */
export function getManualMemberGate(state: ManualMemberPoolState, errorDetail?: string | null): ManualMemberGate {
    if (state.isLoading) {
        return { ready: false, kind: 'LOADING', title: '회원 목록을 불러오는 중입니다', detail: '잠시 후 이름 매칭이 표시됩니다.' };
    }
    if (state.isError) {
        return {
            ready: false,
            kind: 'ERROR',
            title: '회원 목록을 불러오지 못했습니다',
            detail: errorDetail || '일시적인 오류일 수 있습니다. 다시 시도해 주세요.',
        };
    }
    if (state.memberCount <= 0) {
        return {
            ready: false,
            kind: 'EMPTY',
            title: '회원 목록이 비어 있습니다',
            detail: '로그인 계정이 클럽 회원과 연결되어 있는지 확인한 뒤 다시 시도해 주세요. 이 상태로는 모든 이름이 게스트가 되므로 저장할 수 없습니다.',
        };
    }
    return { ready: true };
}

/** Supabase/네트워크 오류 → 운영진이 이해할 수 있는 한 줄 + 원본 코드. */
export function describeMembersLoadError(err: unknown): string {
    const e = (err ?? {}) as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
    const code = e.code != null ? String(e.code) : '';
    const status = typeof e.status === 'number' ? e.status : null;
    const message = e.message != null ? String(e.message) : String(err ?? '');
    const tag = [code, status != null ? `HTTP ${status}` : ''].filter(Boolean).join(' · ');
    const suffix = tag ? ` (${tag})` : '';

    if (code === 'PGRST301' || code === 'PGRST303' || /jwt/i.test(message) || (status === 401 && !code)) {
        return `로그인 세션이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.${suffix}`;
    }
    if (code === '42501' || /permission denied/i.test(message)) {
        return `회원 목록 조회 권한이 없습니다. 로그인 상태를 확인하고, 계속되면 관리자에게 알려 주세요.${suffix}`;
    }
    if (/failed to fetch|network|load failed|fetch failed|timeout/i.test(message) || e.name === 'TypeError') {
        return `네트워크 연결을 확인한 뒤 다시 시도해 주세요.${suffix}`;
    }
    return `${message || '알 수 없는 오류'}${suffix}`;
}
