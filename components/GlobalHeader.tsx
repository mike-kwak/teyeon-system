'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from './ProfileAvatar';

export default function GlobalHeader() {
  const { user, role, isLoading } = useAuth();

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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          maxWidth: 430,
          margin: '0 auto',
          padding: '0 16px',
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
            width={42}
            height={42}
            priority
            style={{
              objectFit: 'contain',
              flexShrink: 0,
              filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.12))',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span
              style={{
                fontFamily: 'var(--font-orbitron), var(--font-rajdhani), sans-serif',
                fontSize: 17,
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
                fontSize: 7.5,
                fontWeight: 600,
                color: '#94A3B8',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              TENNIS CLUB · SINCE 2025
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
