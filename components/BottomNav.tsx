'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { styled, keyframes } from '@/stitches.config';

const glow = keyframes({
  '0%': { boxShadow: '0 0 10px rgba(212, 175, 55, 0.2)' },
  '50%': { boxShadow: '0 0 30px rgba(212, 175, 55, 0.5)' },
  '100%': { boxShadow: '0 0 10px rgba(212, 175, 55, 0.2)' },
});

const slideUp = keyframes({
  from: { transform: 'translateY(100%)' },
  to: { transform: 'translateY(0)' },
});

const NavContainer = styled('nav', {
  position: 'fixed',
  bottom: 0,
  left: 0,
  right: 0,
  height: '92px',
  background: 'rgba(5, 5, 5, 0.85)',
  backdropFilter: 'blur(24px) saturate(180%)',
  borderTop: '1px solid rgba(212, 175, 55, 0.1)',
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  padding: '0 $4 24px',
  zIndex: '$sticky',
  boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.8)',
  animation: `${slideUp} 0.6s cubic-bezier(0.23, 1, 0.32, 1)`,

  /* iOS Safe Area Support */
  '@supports (padding-bottom: env(safe-area-inset-bottom))': {
    height: 'calc(92px + env(safe-area-inset-bottom))',
    paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
  },
});

const NavLink = styled(Link, {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '$1',
  textDecoration: 'none',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  position: 'relative',
  padding: '$2',
  borderRadius: '$lg',
  minWidth: '72px',

  variants: {
    active: {
      true: {
        '& .icon-wrapper': {
          color: '$goldGlint',
          transform: 'translateY(-6px) scale(1.15)',
          background: 'rgba(212, 175, 55, 0.15)',
          boxShadow: '$goldGlow',
        },
        '& .nav-label': {
          color: '$gold',
          opacity: 1,
          transform: 'translateY(-2px)',
          fontWeight: '$black',
        },
      },
      false: {
        '&:active': {
          transform: 'scale(0.9)',
        },
      },
    },
  },
});

const IconWrapper = styled('div', {
  fontSize: '30px', /* Increased from 24px */
  color: 'rgba(255, 255, 255, 0.25)',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  size: '56px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$xl',
  position: 'relative',
  zIndex: 2,
});

const NavLabel = styled('span', {
  fontSize: '9px',
  fontWeight: '$black',
  letterSpacing: '$wider',
  color: 'rgba(255, 255, 255, 0.2)',
  textTransform: 'uppercase',
  transition: 'all 0.4s ease',
  zIndex: 2,
});

const Indicator = styled('div', {
  position: 'absolute',
  top: '-1px',
  width: '32px',
  height: '3px',
  background: '$gold',
  borderRadius: '$full',
  boxShadow: '$goldGlow',
  zIndex: 3,
});

const Aura = styled('div', {
  position: 'absolute',
  width: '80px',
  height: '80px',
  background: 'radial-gradient(circle, rgba(212, 175, 55, 0.15) 0%, transparent 70%)',
  borderRadius: '$full',
  zIndex: 1,
  animation: `${glow} 3s infinite`,
});

const navItems = [
  { path: '/', label: 'HOME', icon: '🏠' },
  { path: '/tournament', label: 'LIVE', icon: '🎾' },
  { path: '/results', label: 'ARCHIVE', icon: '📂' },
  { path: '/profile', label: 'PROFILE', icon: '👤' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <NavContainer>
      {navItems.map((item) => {
        const isActive = pathname === item.path;
        return (
          <NavLink key={item.path} href={item.path} active={isActive}>
            {isActive && (
              <>
                <Indicator />
                <Aura />
              </>
            )}
            <IconWrapper className="icon-wrapper">
              {item.icon}
            </IconWrapper>
            <NavLabel className="nav-label">{item.label}</NavLabel>
          </NavLink>
        );
      })}
    </NavContainer>
  );
}
