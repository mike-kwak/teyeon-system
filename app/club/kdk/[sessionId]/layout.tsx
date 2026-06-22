import type { Metadata } from 'next';

/**
 * /club/kdk/[sessionId] — 개별 KDK 세션 상세는 검색 인덱싱 제외.
 * 운영 안정화 전까지 noindex/nofollow. 공식 기록 정책 정비 후 완화 검토.
 */
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function ClubKdkSessionLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
