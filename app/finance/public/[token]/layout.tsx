import { type ReactNode } from 'react';
import type { Metadata } from 'next';

// 공개 재무 공지 보안:
//   - 검색엔진 색인/추적 차단(robots noindex/nofollow/nocache).
//   - 캐시 금지 + 매 요청 동적 렌더 → 공지 비활성화가 즉시 반영(is_active 는 RPC 가 매 조회 확인).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
        nocache: true,
    },
};

export default function PublicFinanceNoticeLayout({ children }: { children: ReactNode }) {
    return children;
}
