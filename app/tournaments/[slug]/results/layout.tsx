import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/results — TEYEON OPEN 공식 결과 아카이브(회차별, 읽기 전용).
 *   공개 승인된 확정 기록만 보여 준다. 기록은 확정 뒤 바뀌지 않으므로 화면 캐시 정책은 다른 공개 화면과 같게 둔다.
 *   공유(카카오톡 등) 미리보기에 공식 결과 제목이 보이도록 title · description · Open Graph 를 둔다(회차 공통 문구).
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

export default function TournamentResultsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
