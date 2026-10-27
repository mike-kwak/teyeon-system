import type { Metadata } from 'next';

/**
 * /tournaments/results — TEYEON OPEN 역대 공식 결과 입구(공개된 최신 회차로 이동). 공유 미리보기 문구는 회차 결과 화면과 같다.
 */
export const metadata: Metadata = {
  title: 'TEYEON OPEN 공식 결과 · OFFICIAL RESULTS',
  description: 'TEYEON OPEN 공식 대회 결과 — 우승 · 준우승 · 공동 3위 입상팀과 예선 · 본선 대진 기록.',
  openGraph: {
    title: 'TEYEON OPEN 공식 결과',
    description: '우승 · 준우승 · 공동 3위 입상팀과 예선 · 본선 대진 공식 기록',
    type: 'website',
  },
};

export default function TournamentResultsIndexLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
