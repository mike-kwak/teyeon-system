'use client';

// 전역 Analytics Provider / page_view Tracker.
//   - 모든 페이지(공개·로그인) 진입 시 page_view 자동 기록. /admin·/api·/auth·전광판은 track 코어에서 제외.
//   - auth 로딩 완료 후에만 기록(user_type 정확성 확보 + 로딩 중 중복 방지).
//   - useAnalytics().track(event, metadata) 로 주요 행동 이벤트 기록 가능.
//   - 기록 실패는 앱에 영향 없음(track 코어가 비차단·무예외).

import React from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { trackEvent, type TrackContext } from '@/lib/analytics/track';

interface AnalyticsContextValue {
    track: (event: string, metadata?: Record<string, unknown>) => void;
}

const AnalyticsContext = React.createContext<AnalyticsContextValue>({ track: () => {} });
export const useAnalytics = () => React.useContext(AnalyticsContext);

export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user, role, isLoading } = useAuth();

    // 최신 식별 컨텍스트를 ref 로 유지(이벤트 핸들러가 stale 값 잡지 않도록).
    const ctxRef = React.useRef<TrackContext>({ hasUser: false, userId: null, role: null });
    ctxRef.current = { hasUser: Boolean(user), userId: user?.id ?? null, role };

    // page_view — pathname 변경 시. auth 로딩 완료 후에만(잘못된 user_type/중복 방지).
    React.useEffect(() => {
        if (isLoading || !pathname) return;
        void trackEvent('page_view', ctxRef.current, { path: pathname });
        // Strict Mode 이중 실행은 track 코어의 2초 dedupe 로 차단됨.
    }, [pathname, isLoading]);

    const track = React.useCallback((event: string, metadata?: Record<string, unknown>) => {
        void trackEvent(event, ctxRef.current, { metadata });
    }, []);

    return <AnalyticsContext.Provider value={{ track }}>{children}</AnalyticsContext.Provider>;
}
