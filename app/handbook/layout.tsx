// TEYEON Digital Handbook — 라우트 로컬 layout.
//   · Noto Serif KR(포인트 워드 전용)을 이 라우트에서만 로드(전역 폰트 스택 무변경).
//   · 배경 토큰과 keep-all 은 페이지에서 처리. 앱 공통 shell(GlobalHeader/BottomNav)은 그대로 유지.

import { Noto_Serif_KR } from 'next/font/google';

const hbSerif = Noto_Serif_KR({
  weight: ['700'],
  subsets: ['latin'],
  variable: '--font-hb-serif',
  display: 'swap',
  preload: false, // 한글 서브셋 대형 — 포인트 워드 전용이라 지연 로드 허용
});

export const metadata = { title: 'TEYEON Handbook' };

export default function HandbookLayout({ children }: { children: React.ReactNode }) {
  // width 100% 필수: GlobalMain(flex column, alignItems:center)의 아이템이라 기본 fit-content 인데,
  // 자식 페이지 루트가 @container(inline-size containment)라 고유 폭 기여가 없어 0px 로 붕괴한다.
  return <div className={hbSerif.variable} style={{ width: '100%' }}>{children}</div>;
}
