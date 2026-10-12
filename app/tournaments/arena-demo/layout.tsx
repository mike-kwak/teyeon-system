import type { Metadata } from 'next';

/**
 * /tournaments/arena-demo — Arena TV 디자인 점검용 Demo(가명 · 가상 데이터).
 * 공식 대회 화면이 아니므로 검색 인덱싱에서 제외한다.
 */
export const metadata: Metadata = {
    title: 'Arena TV DEMO',
    robots: {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
    },
};

export default function ArenaDemoLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
