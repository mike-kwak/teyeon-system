'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Medal, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { shouldShowBottomNav } from '@/lib/navigation/bottomNavPolicy';
import { isWideShellPath, WIDE_SHELL_MAX } from '@/lib/navigation/shellPolicy';

const TennisRacket = ({ size = 24, color = 'currentColor', strokeWidth = 1.5 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="15" cy="9" r="6" />
    <path d="M10.5 13.5L3 21" />
    <path d="M12 6l6 6M9 9l6 6" />
  </svg>
);

const navItems = [
  { path: '/', label: 'MAIN', icon: (props: any) => <Home {...props} /> },
  { path: '/kdk?entry=live', label: 'LIVE COURT', icon: (props: any) => <TennisRacket {...props} /> },
  { path: '/archive', label: 'ARCHIVE', icon: (props: any) => <Medal {...props} /> },
  { path: '/profile', label: 'PROFILE', icon: (props: any) => <User {...props} /> },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setSystemMessage } = useAuth();

  // 표시 여부는 RootShell 과 공유하는 단일 정책(lib/navigation/bottomNavPolicy)을 따른다.
  //   숨김 대상: /guest/pass*, /club(+하위), /finance/public*, /kdk/display, TENNIS LOG·공지 작성/수정 폼.
  if (!shouldShowBottomNav(pathname || '')) return null;

  // Handbook wide shell — 바(배경/보더)만 셸 폭과 동기 확장. 아이콘 행은 아래 내부 430px
  //   컨테이너가 중앙 유지하므로 1280px 에 과도하게 벌어지지 않는다. 표시/숨김 정책 무변경.
  const wide = isWideShellPath(pathname || '');

  const handleLiveCourtClick = (e: React.MouseEvent) => {
    if (!user) {
      e.preventDefault();
      setSystemMessage('로그인이 필요한 메뉴입니다. 카카오 계정으로 로그인해 주세요.');
      setTimeout(() => setSystemMessage(null), 3000);
      return;
    }
    e.preventDefault();
    // 성능/UX: 다른 화면에서 LIVE COURT 진입 시 전체 문서 리로드(=앱 재시작 체감) 대신 소프트 내비.
    //   이미 /kdk 안이면 entry=live 재적용(마운트 1회 파싱)을 위해 기존 하드 내비 유지.
    if (pathname?.startsWith('/kdk')) {
      window.location.href = '/kdk?entry=live';
    } else {
      router.push('/kdk?entry=live');
    }
  };

  const handleGuestClick = (e: React.MouseEvent, itemLabel: string) => {
    if (itemLabel === 'LIVE COURT') {
      handleLiveCourtClick(e);
      return;
    }
    if (!user && itemLabel !== 'MAIN') {
      e.preventDefault();
      setSystemMessage('로그인이 필요한 메뉴입니다. 카카오 계정으로 로그인해 주세요.');
      setTimeout(() => setSystemMessage(null), 3000);
    }
  };

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 500,
        height: 'var(--bottom-nav-area)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        width: '100%',
        maxWidth: wide ? WIDE_SHELL_MAX : 450,
        backgroundColor: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderTop: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 -2px 16px rgba(0,0,0,0.06)',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          margin: '0 auto',
          padding: '0 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '100%',
        }}
      >
        {navItems.map((item) => {
          const itemBasePath = item.path.split('?')[0];
          const isActive =
            pathname === itemBasePath ||
            (itemBasePath !== '/' && pathname?.startsWith(itemBasePath));
          const isDisabled = !user && item.label !== 'MAIN';

          return (
            <Link
              key={item.path}
              href={item.path}
              onClick={(e) => handleGuestClick(e, item.label)}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                height: '100%',
                textDecoration: 'none',
                transition: 'all 0.2s',
                transform: isActive ? 'scale(1.04)' : undefined,
                opacity: isDisabled ? 0.25 : 1,
              }}
            >
              <div
                style={{
                  marginBottom: 3,
                  color: isActive ? '#0D9488' : '#94A3B8',
                  transition: 'color 0.2s',
                }}
              >
                <item.icon
                  size={26}
                  strokeWidth={isActive ? 2.2 : 1.6}
                />
              </div>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: isActive ? 800 : 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: isActive ? '#0D9488' : '#94A3B8',
                  transition: 'color 0.2s',
                  fontFamily: 'var(--font-rajdhani), sans-serif',
                }}
              >
                {item.label}
              </span>
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: -1,
                    width: 20,
                    height: 2.5,
                    borderRadius: 99,
                    backgroundColor: '#0D9488',
                    boxShadow: '0 0 6px rgba(13,148,136,0.40)',
                  }}
                  className="animate-in fade-in zoom-in duration-300"
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
