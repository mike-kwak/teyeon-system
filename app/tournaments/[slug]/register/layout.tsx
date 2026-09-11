import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/register — 참가신청 폼.
 *
 * - 개인정보를 입력받는 과정 페이지이므로 검색 색인을 차단한다(Hub 는 index 허용, 여기서 덮어쓴다).
 * - 마감 상태가 즉시 반영되어야 하므로 캐시하지 않는다.
 * - page 는 'use client' 라 Route Segment Config 를 여기(server layout)에서 설정한다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    title: '참가 신청 · 2026 TEYEON OPEN',
    robots: {
        index: false,
        follow: false,
        nocache: true,
    },
};

export default function TournamentRegisterLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
