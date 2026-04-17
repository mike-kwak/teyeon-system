'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { styled, keyframes } from '@/stitches.config';
import ProfileAvatar from './ProfileAvatar';

const shimmer = keyframes({
  '0%': { backgroundPosition: '-100% 0' },
  '100%': { backgroundPosition: '100% 0' },
});

const HeaderContainer = styled('header', {
  position: 'sticky',
  top: 0,
  width: '100%',
  height: '72px',
  background: 'rgba(0, 0, 0, 0.85)',
  backdropFilter: 'blur(30px) saturate(200%)',
  borderBottom: '1px solid rgba(255, 215, 0, 0.15)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0',
  zIndex: '$sticky',
  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.8)',

  '@supports (padding-top: env(safe-area-inset-top))': {
    height: 'calc(72px + env(safe-area-inset-top))',
    paddingTop: 'env(safe-area-inset-top)',
  },
});

const LogoLink = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  textDecoration: 'none',
  transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',

  '&:hover': {
    transform: 'scale(1.05)',
    '& .logo-box': {
      boxShadow: '0 0 25px rgba(255, 215, 0, 0.5)',
      transform: 'rotate(-5deg) scale(1.1)',
    }
  },
});

const LogoBox = styled('div', {
  width: '36px',
  height: '36px',
  background: 'linear-gradient(135deg, #FFD700 0%, #D4AF37 100%)',
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '20px',
  boxShadow: '0 0 15px rgba(255, 215, 0, 0.3)',
  transition: 'all 0.4s ease',
  color: '#000',
  fontWeight: 950,
  fontFamily: '$display',
});

const LogoText = styled('span', {
  fontSize: '24px',
  fontFamily: '$sporty',
  fontWeight: 900,
  color: '$white',
  letterSpacing: '$tighter',
  textTransform: 'uppercase',
  fontStyle: 'italic',
  paddingRight: '8px', /* Prevents italic overhang from being clipped by background-clip: text */
  background: 'linear-gradient(90deg, #FFFFFF 0%, #D4AF37 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
});

const UserSection = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
});

const RoleBadge = styled('div', {
  padding: '4px 12px',
  borderRadius: '$full',
  fontSize: '11px',
  fontFamily: '$sporty',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
  background: 'rgba(0, 0, 0, 0.5)',
  border: '1px solid rgba(255, 215, 0, 0.3)',
  color: '$goldGlint',
  boxShadow: 'inset 0 0 10px rgba(255, 215, 0, 0.1)',
});

const StatusDot = styled('div', {
  width: '6px',
  height: '6px',
  borderRadius: '$full',
  background: '#4CAF50',
  boxShadow: '0 0 10px #4CAF50',
});

const LogoTextContainer = styled('span', {
  fontSize: '20px',
  fontFamily: '$sporty',
  fontWeight: 950,
  color: '$white',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  fontStyle: 'italic',
  display: 'flex',
  alignItems: 'baseline',
  gap: '4px',
  background: 'linear-gradient(90deg, #FFFFFF 0%, #D4AF37 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  dropShadow: '0 0 20px rgba(212, 175, 55, 0.4)',
});

const GlowBadge = styled('div', {
  padding: '6px 16px',
  borderRadius: '$full',
  fontSize: '10px',
  fontFamily: '$sporty',
  fontWeight: 950,
  textTransform: 'uppercase',
  letterSpacing: '0.2em',
  background: 'rgba(212, 175, 55, 0.1)',
  border: '1px solid rgba(212, 175, 55, 0.4)',
  color: '#D4AF37',
  boxShadow: '0 0 15px rgba(212, 175, 55, 0.2), inset 0 0 10px rgba(212, 175, 55, 0.1)',
  transition: 'all 0.3s ease',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',

  '&:hover': {
    background: 'rgba(212, 175, 55, 0.2)',
    boxShadow: '0 0 25px rgba(212, 175, 55, 0.5), inset 0 0 15px rgba(212, 175, 55, 0.2)',
    transform: 'translateY(-1px) scale(1.05)',
  },

  '&::after': {
    content: '""',
    position: 'absolute',
    top: '-50%',
    left: '-50%',
    width: '200%',
    height: '200%',
    background: 'linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent)',
    transform: 'rotate(45deg)',
    animation: `${shimmer} 3s infinite`,
  }
});

export default function GlobalHeader() {
  const { user, role, isLoading } = useAuth();

  // [ROOT PURGE] Kill any lingering ghost code (v1.7+, Service Workers)
  React.useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for(let registration of registrations) {
          registration.unregister();
          console.log("💀 GHOST PURGED: Service Worker Unregistered");
        }
      });
    }
  }, []);

  return (
    <HeaderContainer>
      <div className="flex items-center justify-between w-full px-8">
        <LogoLink href="/">
           <LogoTextContainer>
             TEYEON
             <span className="text-[8px] opacity-30 font-light lowercase tracking-normal bg-none WebkitTextFillColor-white">v7.0 (absolute)</span>
           </LogoTextContainer>
        </LogoLink>

        <UserSection>
          {user && !isLoading && (
            <div className="flex items-center gap-4">
              <GlowBadge>
                 {role === 'CEO' ? 'CEO' : (role || 'GUEST')}
              </GlowBadge>
              <Link href="/profile">
                <ProfileAvatar 
                  src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
                  alt={user.user_metadata?.full_name} 
                  size={36}
                  fallbackIcon={role === 'CEO' ? '👑' : '👤'}
                  className="border-2 border-[#D4AF37]/30 shadow-[0_0_20px_rgba(212,175,55,0.3)] rounded-full transition-all hover:scale-110 hover:border-[#D4AF37] active:scale-95"
                />
              </Link>
            </div>
          )}
        </UserSection>
      </div>
    </HeaderContainer>
  );
}
