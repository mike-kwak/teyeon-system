import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/live — 공식 LIVE 화면(Hub 의 LIVE 탭).
 *
 * - 영상(YouTube 기본 · Cloudflare 백업) · 지금 중계 경기 · YouTube 실시간 채팅.
 * - 공개 스위치(NEXT_PUBLIC_PUBLIC_LIVE_ENABLED=1)가 꺼져 있으면 페이지는 '공개 전' 안내만 한다.
 * - LIVE 상태가 즉시 반영되어야 하므로 캐시하지 않는다. 검색 색인은 막는다(Hub 만 index 허용).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    title: 'LIVE · 2026 TEYEON OPEN',
    robots: {
        index: false,
        follow: false,
        nocache: true,
    },
};

export default function TournamentLiveLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
