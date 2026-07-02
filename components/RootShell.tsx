'use client';

// 앱 전역 shell 분기점.
//   - /admin/**  → 전체 폭 Admin shell(전역 GlobalHeader/BottomNav/450px 제약 없음).
//                  실제 Admin chrome(Sidebar/Header/BottomNav)은 app/admin/layout.tsx 가 제공.
//   - 그 외       → 기존 일반 앱 shell(450px 모바일 컨테이너 + GlobalHeader + BottomNav).
// GlobalHeader / BottomNav 각각에 pathname 조건을 흩뿌리는 대신 단일 분기점으로 통합.

import { usePathname } from 'next/navigation';
import { styled } from '@/stitches.config';
import SplashScreen from '@/components/SplashScreen';
import LoadingOverlay from '@/components/LoadingOverlay';
import GlobalHeader from '@/components/GlobalHeader';
import BottomNav from '@/components/BottomNav';
import { shouldShowBottomNav } from '@/lib/navigation/bottomNavPolicy';

const GlobalMain = styled('main', {
  // 앱 전역 유일한 세로 스크롤러.
  //   RootShell(뷰포트 높이 고정) 안에서 남은 높이만 차지하고, 내부에서만 스크롤한다.
  //   html/body/RootShell 은 스크롤하지 않으므로 iOS 중첩 스크롤 체인(2단계 스크롤)이 발생하지 않는다.
  flex: '1 1 auto',
  minHeight: 0, // flex 자식이 콘텐츠로 부풀지 않고 줄어들 수 있어야 스크롤 컨테이너가 된다.
  height: 'auto',
  backgroundColor: '#F2F4F7',
  position: 'relative',
  overflowY: 'auto',
  overflowX: 'clip', // clip 은 overflowY 를 강제 auto 로 코어싱하지 않음(우발적 X축 스크롤러 방지).
  WebkitOverflowScrolling: 'touch',
  overscrollBehaviorY: 'contain',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingBottom: 'var(--page-bottom-safe)',
});

export default function RootShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname === '/admin' || pathname?.startsWith('/admin/');

  if (isAdmin) {
    // Admin 전체 폭 shell — 전역 chrome 없음. Admin layout 이 자체 Sidebar/Header/BottomNav 제공.
    //   단일 스크롤러 전환으로 html/body 가 스크롤하지 않으므로, Admin shell 은 자체 스크롤 컨테이너로 분리한다
    //   (AdminSidebar/AdminBottomNav 는 position:fixed, AdminHeader 는 sticky → 이 컨테이너 기준으로 동작).
    return (
      <div
        style={{
          width: '100%',
          height: '100dvh',
          backgroundColor: '#EEF2F7',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </div>
    );
  }

  // BottomNav 표시 여부(RootShell·BottomNav 공통 정책). 숨김 화면은 하단 예약 영역을 safe-area 만으로 축소.
  const showNav = shouldShowBottomNav(pathname || '');

  const shellStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '450px',
    height: '100dvh', // 뷰포트 높이에 고정(min-height 아님) — RootShell 자체는 스크롤하지 않는다.
    backgroundColor: '#F2F4F7',
    position: 'relative',
    boxShadow: '0 0 60px rgba(0,0,0,0.30), 0 0 20px rgba(0,0,0,0.15)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden', // overflow-x 단독(→ overflow-y:auto 코어싱) 방지: 명시적 hidden.
    margin: '0 auto',
    // 하단 예약 영역을 셸 스코프에서 확정한다.
    //   주의: --page-bottom-safe 는 :root 에서 선언되면 그 안의 var(--active-bottom-nav-area)가
    //   :root 스코프(=72px)로 '치환·고정'된 뒤 하위로 상속되므로, 셸에서 --active-bottom-nav-area 만
    //   바꿔서는 반영되지 않는다. 따라서 --page-bottom-safe 자체를 셸에서 root-level 원시 토큰
    //   (--bottom-nav-area / --safe-bottom / --page-end-gap)만으로 재선언해 nav 유무를 확실히 반영한다.
    //   --active-bottom-nav-area 는 진단/의미 표기용으로 함께 유지.
    ['--active-bottom-nav-area' as string]: showNav ? 'var(--bottom-nav-area)' : 'var(--safe-bottom)',
    ['--page-bottom-safe' as string]: showNav
      ? 'calc(var(--bottom-nav-area) + var(--page-end-gap))'
      : 'calc(var(--safe-bottom) + var(--page-end-gap))',
  } as React.CSSProperties;

  return (
    <div style={shellStyle}>
      <SplashScreen />
      <LoadingOverlay />
      <GlobalHeader />
      <GlobalMain id="main-container">{children}</GlobalMain>
      <BottomNav />
    </div>
  );
}
