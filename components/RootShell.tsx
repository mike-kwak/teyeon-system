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

const GlobalMain = styled('main', {
  flex: 1,
  backgroundColor: '#F2F4F7',
  minHeight: '100dvh',
  position: 'relative',
  overflowX: 'hidden',
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
    return (
      <div
        style={{
          width: '100%',
          minHeight: '100dvh',
          backgroundColor: '#EEF2F7',
          overflowX: 'hidden',
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '450px',
        minHeight: '100dvh',
        backgroundColor: '#F2F4F7',
        position: 'relative',
        boxShadow: '0 0 60px rgba(0,0,0,0.30), 0 0 20px rgba(0,0,0,0.15)',
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        margin: '0 auto',
      }}
    >
      <SplashScreen />
      <LoadingOverlay />
      <GlobalHeader />
      <GlobalMain id="main-container">{children}</GlobalMain>
      <BottomNav />
    </div>
  );
}
