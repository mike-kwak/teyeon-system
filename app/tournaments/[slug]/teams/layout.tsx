import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/teams — 공개 참가팀 현황.
 *
 * - 개인정보(연락처·입금자명·입금상태)는 서버가 반환하지 않지만, 참가자 실명이 나열되는 화면이다.
 *   공개 링크로는 열람 가능하되 검색엔진 색인은 막는다(Hub 만 index 허용).
 * - 접수 현황이 실시간으로 바뀌므로 캐시하지 않는다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    title: '참가팀 현황 · 2026 TEYEON OPEN',
    robots: {
        index: false,
        follow: false,
        nocache: true,
    },
};

export default function TournamentTeamsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
