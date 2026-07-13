'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from './ProfileAvatar';
import { isWideShellPath, WIDE_SHELL_MAX } from '@/lib/navigation/shellPolicy';

export default function GlobalHeader() {
  const pathname = usePathname();
  const { user, role, isLoading } = useAuth();
  // Handbook wide shell — 헤더 바(배경/블러)는 width:100% 로 자동 확장되므로,
  // 내부 콘텐츠 행 폭만 셸 정책과 동기화한다(일반 화면은 기존 430px 유지).
  const wide = isWideShellPath(pathname || '');

  // [ROOT PURGE] Kill any lingering ghost code (v1.7+, Service Workers)
  React.useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
          console.log("💀 GHOST PURGED: Service Worker Unregistered");
        }
      });
    }
  }, []);

  // 게스트 공개 영역(/guest 신청 · /guest/pass Guest Pass) / TEYEON 공개 둘러보기(/club) 에서는 앱 내부 chrome 미노출.
  if (pathname === '/guest' || pathname?.startsWith('/guest/')) return null;
  if (pathname === '/club' || pathname?.startsWith('/club/')) return null;

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        width: '100%',
        height: 'calc(64px + env(safe-area-inset-top))',
        paddingTop: 'env(safe-area-inset-top)',
        backgroundColor: 'rgba(242,244,247,0.96)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        display: 'flex',
        alignItems: 'center',
        zIndex: 200,
        boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
        flexShrink: 0,
      }}
    >
      {wide && (
        // 좌우 패딩을 Handbook 페이지 정렬선(16/24/32 — 컨테이너=뷰포트, 셸 상한 1280)과 동기.
        //   인라인 padding 대신 클래스 기준으로 선언해 미디어쿼리 오버라이드가 !important 없이 동작.
        <style>{`
          .gh-row-wide { padding: 0 16px; }
          @media (min-width: 768px) { .gh-row-wide { padding: 0 24px; } }
          @media (min-width: 1024px) { .gh-row-wide { padding: 0 32px; } }
        `}</style>
      )}
      <div
        className={wide ? 'gh-row-wide' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          maxWidth: wide ? WIDE_SHELL_MAX : 430,
          margin: '0 auto',
          ...(wide ? {} : { padding: '0 16px' }),
        }}
      >
        {/* Left: Logo box + Brand */}
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            textDecoration: 'none',
            minWidth: 0,
          }}
        >
          <Image
            src="/logos/teyeon-logo-transparent.png"
            alt="TEYEON"
            width={44}
            height={44}
            priority
            style={{
              objectFit: 'contain',
              flexShrink: 0,
              filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.10))',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <span
              style={{
                fontFamily: 'var(--font-orbitron), var(--font-rajdhani), sans-serif',
                fontSize: 19,
                fontWeight: 800,
                color: '#0F172A',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              TEYEON
            </span>
            <span
              style={{
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: 10,
                fontWeight: 600,
                color: '#94A3B8',
                letterSpacing: '0.17em',
                textTransform: 'uppercase',
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              TENNIS CLUB · SINCE 2024
            </span>
          </div>
        </Link>

        {/* Right: Role badge + Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {user && !isLoading && (
            <>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  padding: '3px 9px',
                  borderRadius: 6,
                  backgroundColor:
                    role === 'CEO'
                      ? 'rgba(201,168,76,0.10)'
                      : 'rgba(13,148,136,0.08)',
                  color: role === 'CEO' ? '#B8891C' : '#0D9488',
                  border:
                    role === 'CEO'
                      ? '1px solid rgba(201,168,76,0.26)'
                      : '1px solid rgba(13,148,136,0.20)',
                  whiteSpace: 'nowrap',
                }}
              >
                {role === 'CEO' ? 'CEO' : (role || 'GUEST')}
              </span>
              <Link href="/profile">
                <ProfileAvatar
                  src={user.user_metadata?.avatar_url || user.user_metadata?.picture}
                  alt={user.user_metadata?.full_name}
                  size={34}
                  fallbackIcon={role === 'CEO' ? '👑' : '👤'}
                  className="rounded-full border border-slate-200 shadow-sm transition-all hover:scale-105 active:scale-95"
                />
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
