import type { Metadata } from 'next';
import { Montserrat, Noto_Sans_KR } from 'next/font/google';

/**
 * /tournaments/[slug]/signature/* — Signature Arena 운영 연결 화면(읽기 전용 전광판).
 *
 * ⚠ 운영 화면이다(운영 Arena 와 같은 운영 RPC · 같은 CEO/ADMIN 권한). 검색 색인에서 제외한다.
 *   상위 [slug] layout 은 공개 대회 Hub 라 index 를 허용하므로 여기서 noindex 로 덮는다.
 * ⚠ 글꼴은 Signature Demo(arena-design layout)와 같은 변수 이름을 쓴다 — Signature 컴포넌트가 이 변수를 읽는다.
 *   next/font 가 build 시 내려받아 자체 호스팅하므로 화면을 열 때 외부 글꼴 서버로 요청이 나가지 않는다.
 * ⚠ 기존 운영 Arena(/tournaments/[slug]/arena)와 디자인 Demo(/tournaments/arena-design/*)는 건드리지 않는다.
 */
const display = Montserrat({
  variable: '--font-ivory-display',
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
  display: 'swap',
});

const korean = Noto_Sans_KR({
  variable: '--font-ivory-kr',
  subsets: ['latin'],
  weight: ['500', '600', '700', '800', '900'],
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: 'Signature Arena',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function SignatureLiveLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${korean.variable}`}>{children}</div>;
}
