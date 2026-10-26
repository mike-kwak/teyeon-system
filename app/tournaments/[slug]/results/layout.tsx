import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/results — TEYEON OPEN 공식 결과 아카이브(회차별, 읽기 전용).
 *   공개 승인된 확정 기록만 보여 준다. 기록은 확정 뒤 바뀌지 않으므로 화면 캐시 정책은 다른 공개 화면과 같게 둔다.
 */
export const metadata: Metadata = {
  title: 'OFFICIAL RESULTS · TEYEON OPEN',
};

export default function TournamentResultsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
