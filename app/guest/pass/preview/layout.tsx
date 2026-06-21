import type { Metadata } from 'next';

/**
 * /guest/pass/preview — QA 전용 페이지.
 * 운영진 / 디자이너만 직접 URL 로 접근하는 도구이므로 검색엔진 인덱싱 금지.
 *
 * Page 본체는 'use client' 라 metadata 를 직접 export 할 수 없어 server layout 으로 분리.
 */

export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
        googleBot: {
            index: false,
            follow: false,
        },
    },
};

export default function GuestPassPreviewLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
