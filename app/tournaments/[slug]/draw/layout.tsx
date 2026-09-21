import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/draw — 공개 예선 DRAW(조편성 · 조별 순위 · 경기 결과).
 *
 * - 운영진이 DRAW 를 공개했을 때만 데이터가 보인다(서버 공개 RPC 가 판정).
 * - 참가자 실명이 나열되는 화면이므로 검색엔진 색인은 막는다(TEAMS 와 같은 정책).
 * - 경기 결과가 계속 바뀌므로 캐시하지 않는다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'DRAW · 2026 TEYEON OPEN',
  robots: { index: false, follow: false, nocache: true },
};

export default function TournamentDrawLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
