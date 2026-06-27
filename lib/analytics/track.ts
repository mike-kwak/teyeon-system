'use client';

// Analytics 이벤트 기록 코어.
//   방식: 보호 RPC track_analytics_event 사용(직접 insert 아님). auth_user_id 는 서버(auth.uid())가 설정.
//   비차단·비동기. 실패는 UI 에 노출하지 않음. 테이블/RPC 부재 시 세션 단위로 조용히 비활성화.
//   feature flag: NEXT_PUBLIC_ANALYTICS_ENABLED === 'false' 이면 네트워크 호출조차 하지 않음.

import { supabase } from '@/lib/supabase';
import { normalizePath, sanitizeRawPath } from './paths';
import { getAnonymousId, getSessionId, resolveUserType } from './identity';

export const ALLOWED_EVENTS = new Set<string>([
    'page_view',
    'attendance_submit',
    'guest_pass_view',
    'kdk_view',
    'live_court_view',
    'archive_view',
]);

const DEDUP_WINDOW_MS = 2000; // 같은 세션+이벤트+슬러그 2초 이내 중복만 차단
const lastKeyAt = new Map<string, number>();
let sessionDisabled = false; // 테이블/RPC 부재 등으로 이번 브라우저 세션 동안 비활성화

export interface TrackContext {
    hasUser: boolean;
    userId: string | null;
    role: string | null;
}

function isEnabled(): boolean {
    if (sessionDisabled) return false;
    // 미설정(undefined)이면 기본 ON — 단, RPC 부재 시 graceful 비활성화로 앱 영향 없음.
    return process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== 'false';
}

/** 분석 이벤트 기록(비차단). 절대 throw 하지 않는다. */
export async function trackEvent(
    eventName: string,
    ctx: TrackContext,
    opts: { path?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
    try {
        if (typeof window === 'undefined' || !isEnabled()) return;
        if (!ALLOWED_EVENTS.has(eventName)) return;

        const rawPath = opts.path ?? window.location.pathname;
        const np = normalizePath(rawPath);
        if (np.excluded) return; // /admin, /api, /auth, 전광판 등 제외

        const sessionId = getSessionId();
        if (!sessionId) return;

        const userType = resolveUserType(ctx.hasUser, ctx.role);
        // 로그인 사용자 page_view 에는 anonymous_id 를 동봉하지 않는다(신원 강결합 회피). RPC 도 동일하게 처리.
        const anonymousId = ctx.hasUser ? null : getAnonymousId();

        // 중복 방지: 같은 세션+이벤트+슬러그 2초 윈도우.
        const key = `${sessionId}:${eventName}:${np.slug}`;
        const now = Date.now();
        const prev = lastKeyAt.get(key);
        if (prev && now - prev < DEDUP_WINDOW_MS) return;
        lastKeyAt.set(key, now);

        const { error } = await supabase.rpc('track_analytics_event', {
            p_event_name: eventName,
            p_path: sanitizeRawPath(rawPath).slice(0, 512), // 토큰/UUID 제거 후 저장
            p_normalized_path: np.slug,
            p_anonymous_id: anonymousId,
            p_user_type: userType,
            p_session_id: sessionId,
            p_metadata: opts.metadata ?? {},
        });

        if (error) {
            // 함수/테이블 부재 → 이번 세션 비활성화(반복 실패/콘솔 노이즈 방지).
            const msg = (error.message || '').toLowerCase();
            const code = (error as { code?: string }).code;
            if (
                code === 'PGRST202' || code === '42883' || code === '42P01' ||
                msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not find')
            ) {
                sessionDisabled = true;
            }
            if (process.env.NODE_ENV !== 'production') {
                // 개발 환경에서만 최소 디버그.
                console.debug('[analytics] skipped:', error.message);
            }
        }
    } catch (e) {
        if (process.env.NODE_ENV !== 'production') console.debug('[analytics] error:', e);
        // 절대 사용자 UX 에 영향 주지 않음.
    }
}
