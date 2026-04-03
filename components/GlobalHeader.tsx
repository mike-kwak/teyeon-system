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
  left: 0,
  right: 0,
  height: '72px',
  background: 'rgba(0, 0, 0, 0.85)',
  backdropFilter: 'blur(30px) saturate(200%)',
  borderBottom: '1px solid rgba(255, 215, 0, 0.15)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 $6',
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

export default function GlobalHeader() {
  const { user, role, isLoading } = useAuth();

  return (
    <HeaderContainer>
      <LogoLink href="/">
        <span 
          className="text-[18px] font-[1000] text-[#C9B075] tracking-[0.2em] uppercase transition-all duration-300 drop-shadow-[0_4px_6px_rgba(201,176,117,0.3)] hover:text-[#EFDFB4] hover:drop-shadow-[0_0_12px_rgba(239,223,180,0.4)]"
          style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}
        >
          TEYEON
        </span>
      </LogoLink>

      <UserSection>
        {user && !isLoading && (
          <div className="flex items-center gap-3">
            <RoleBadge className="bg-[#2A2A2A] text-[#C9B075] border-[#C9B075]/20 text-[10px] px-3 py-1 rounded-full font-black tracking-widest uppercase shadow-inner">
               {role === 'CEO' ? 'CEO' : (role || 'GUEST')}
            </RoleBadge>
            <Link href="/profile">
              <ProfileAvatar 
                src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
                alt={user.user_metadata?.full_name} 
                size={32}
                fallbackIcon={role === 'CEO' ? '👑' : '👤'}
                className="border border-[#C9B075]/30 shadow-[0_0_15px_rgba(201,176,117,0.2)] rounded-full transition-all hover:scale-110 active:scale-90"
              />
            </Link>
          </div>
        )}
      </UserSection>
    </HeaderContainer>
  );
}
