import type { Metadata } from 'next';
import { Montserrat, Noto_Sans_KR } from 'next/font/google';

/**
 * /tournaments/arena-design — Arena TV 새 디자인(Autumn Ivory) 실험 화면(가명 · 가상 데이터).
 * 공식 대회 화면이 아니므로 검색 인덱싱에서 제외한다.
 *
 * ⚠ 글꼴은 이 경로에만 붙인다(앱 공통 layout 을 바꾸지 않는다).
 *   next/font 가 build 시 내려받아 자체 호스팅하므로, 화면을 열 때 외부 글꼴 서버로 요청이 나가지 않는다.
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
  title: 'Arena TV DESIGN',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function ArenaDesignLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${korean.variable}`}>{children}</div>;
}
