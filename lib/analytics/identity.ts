'use client';

// Analytics 익명 식별자 / 세션 식별자 / 사용자 유형 판정.
//   원칙: IP·fingerprint·개인정보 사용 금지. UUID v4 만 사용(브라우저 단위, 삭제 가능).
//   SSR 안전(window 가드). 실패는 조용히 null 반환(앱 영향 없음).

const ANON_KEY = 'teyeon-anonymous-id';
const SESSION_ID_KEY = 'teyeon-analytics-session-id';
const SESSION_TS_KEY = 'teyeon-analytics-session-last';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분 비활성 → 새 세션
const ANON_MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1년

export type AnalyticsUserType = 'MEMBER' | 'GUEST' | 'PUBLIC' | 'UNKNOWN' | 'INTERNAL';

function uuidv4(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* fall through */ }
    // fallback (crypto.randomUUID 미지원/비-보안 컨텍스트)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/** 비로그인 사용자 브라우저 단위 익명 ID. cookie(1차) + localStorage(fallback) 동기 유지. 없으면 생성. */
export function getAnonymousId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        let id: string | null = null;
        try { id = window.localStorage.getItem(ANON_KEY); } catch { /* ignore */ }
        if (!id) {
            // cookie 에서 복구 시도
            const m = document.cookie.match(new RegExp('(?:^|; )' + ANON_KEY + '=([^;]+)'));
            id = m ? decodeURIComponent(m[1]) : null;
        }
        if (!id) id = uuidv4();
        try { window.localStorage.setItem(ANON_KEY, id); } catch { /* ignore */ }
        try { document.cookie = `${ANON_KEY}=${encodeURIComponent(id)}; path=/; max-age=${ANON_MAX_AGE_SEC}; samesite=lax`; } catch { /* ignore */ }
        return id;
    } catch {
        return null;
    }
}

/** 세션 ID. 마지막 활동 후 30분 초과 시 새 세션 발급. 매 호출 시 last_activity 갱신. */
export function getSessionId(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const now = Date.now();
        let sid: string | null = null;
        let last = 0;
        try {
            sid = window.localStorage.getItem(SESSION_ID_KEY);
            last = Number(window.localStorage.getItem(SESSION_TS_KEY) || 0);
        } catch { /* ignore */ }
        if (!sid || !last || now - last > SESSION_TIMEOUT_MS) {
            sid = uuidv4();
            try { window.localStorage.setItem(SESSION_ID_KEY, sid); } catch { /* ignore */ }
        }
        try { window.localStorage.setItem(SESSION_TS_KEY, String(now)); } catch { /* ignore */ }
        return sid;
    } catch {
        return null;
    }
}

/** 사용자 유형 판정. CEO/ADMIN/OPERATOR/FINANCE_MANAGER 는 INTERNAL(운영진, 일반 방문 통계 제외용). */
export function resolveUserType(hasUser: boolean, role: string | null): AnalyticsUserType {
    if (!hasUser) return 'PUBLIC';
    switch ((role || '').toUpperCase()) {
        case 'CEO':
        case 'ADMIN':
        case 'OPERATOR':
        case 'FINANCE_MANAGER':
            return 'INTERNAL';
        case 'GUEST':
            return 'GUEST';
        case 'MEMBER':
            return 'MEMBER';
        default:
            return 'UNKNOWN';
    }
}
