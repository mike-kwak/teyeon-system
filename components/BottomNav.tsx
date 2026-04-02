'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { styled, keyframes } from '@/stitches.config';

const glow = keyframes({
  '0%': { boxShadow: '0 0 10px rgba(255, 215, 0, 0.2)' },
  '50%': { boxShadow: '0 0 35px rgba(255, 215, 0, 0.6)' },
  '100%': { boxShadow: '0 0 10px rgba(255, 215, 0, 0.2)' },
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
  height: '96px',
  background: 'rgba(0, 0, 0, 0.95)',
  backdropFilter: 'blur(30px) saturate(200%)',
  borderTop: '1px solid rgba(255, 215, 0, 0.15)',
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  padding: '0 $4 28px',
  zIndex: '$sticky',
  boxShadow: '0 -15px 50px rgba(0, 0, 0, 0.9)',
  animation: `${slideUp} 0.8s cubic-bezier(0.16, 1, 0.3, 1)`,

  '@supports (padding-bottom: env(safe-area-inset-bottom))': {
    height: 'calc(96px + env(safe-area-inset-bottom))',
    paddingBottom: 'calc(28px + env(safe-area-inset-bottom))',
  },
});

const NavLink = styled(Link, {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '2px',
  textDecoration: 'none',
  transition: 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  position: 'relative',
  padding: '$2',
  minWidth: '76px',

  variants: {
    active: {
      true: {
        '& .icon-wrapper': {
          color: '$goldGlint',
          transform: 'translateY(-8px) scale(1.2)',
          background: 'rgba(255, 215, 0, 0.12)',
          filter: 'drop-shadow(0 0 8px rgba(255, 215, 0, 0.5))',
        },
        '& .nav-label': {
          color: '$goldGlint',
          opacity: 1,
          transform: 'translateY(-2px)',
          fontWeight: 900,
          textShadow: '0 0 10px rgba(255, 215, 0, 0.3)',
        },
      },
      false: {
        '&:active': {
          transform: 'scale(0.85)',
        },
      },
    },
  },
});

const IconWrapper = styled('div', {
  fontSize: '32px',
  color: 'rgba(255, 255, 255, 0.2)',
  transition: 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  size: '60px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '20px',
  position: 'relative',
  zIndex: 2,
});

const NavLabel = styled('span', {
  fontSize: '10px',
  fontFamily: '$sporty',
  fontWeight: 800,
  letterSpacing: '0.15em',
  color: 'rgba(255, 255, 255, 0.25)',
  textTransform: 'uppercase',
  transition: 'all 0.4s ease',
  zIndex: 2,
});

const Indicator = styled('div', {
  position: 'absolute',
  top: '-1px',
  width: '36px',
  height: '4px',
  background: '$goldGlint',
  borderRadius: '$full',
  boxShadow: '0 0 15px #FFD700, 0 0 5px #FFD700',
  zIndex: 3,
});

const Aura = styled('div', {
  position: 'absolute',
  width: '84px',
  height: '84px',
  background: 'radial-gradient(circle, rgba(255, 215, 0, 0.12) 0%, transparent 75%)',
  borderRadius: '$full',
  zIndex: 1,
  animation: `${glow} 2.5s infinite ease-in-out`,
});

const navItems = [
  { path: '/', label: 'DASHBOARD', icon: '🏎️' },
  { path: '/tournament', label: 'CIRCUIT', icon: '🏁' },
  { path: '/results', label: 'TELEMETRY', icon: '📊' },
  { path: '/profile', label: 'PILOT', icon: '🆔' },
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
