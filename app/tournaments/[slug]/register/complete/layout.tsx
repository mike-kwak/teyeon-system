import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/register/complete — 참가신청 완료(접수증) 화면.
 *
 * - 접수번호·선수 이름이 표시되는 화면이므로 검색 색인/캐시를 모두 차단한다.
 * - 접수증 자체는 서버에 저장하지 않고 신청 직후 탭 세션(sessionStorage)에서만 읽는다.
 *   직접 URL 로 들어오면 아무 정보도 표시하지 않고 안내만 보여준다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    title: '참가신청 접수 완료 · 2026 TEYEON OPEN',
    robots: {
        index: false,
        follow: false,
        nocache: true,
    },
};

export default function TournamentRegisterCompleteLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
