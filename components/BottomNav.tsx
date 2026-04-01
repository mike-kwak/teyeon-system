'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { styled, keyframes } from '@/stitches.config';

const glow = keyframes({
  '0%': { boxShadow: '0 0 5px rgba(212, 175, 55, 0.2)' },
  '50%': { boxShadow: '0 0 20px rgba(212, 175, 55, 0.6)' },
  '100%': { boxShadow: '0 0 5px rgba(212, 175, 55, 0.2)' },
});

const NavContainer = styled('nav', {
  position: 'fixed',
  bottom: 0,
  left: '50%',
  transform: 'translateX(-50%)',
  width: '100%',
  maxWidth: '500px',
  height: '80px',
  backgroundColor: 'rgba(10, 10, 10, 0.8)',
  backdropFilter: 'blur(10px)',
  borderTop: '1px solid rgba(212, 175, 55, 0.2)',
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  paddingBottom: 'env(safe-area-inset-bottom)',
  zIndex: '$sticky',
  boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.5)',
});

const NavLink = styled(Link, {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$1',
  color: '$gray400',
  transition: 'all 0.3s ease',
  width: '25%',
  height: '100%',
  position: 'relative',

  '&:active': {
    transform: 'scale(0.9)',
    '& .icon-wrapper': {
      animation: `${glow} 0.5s ease-in-out`,
    },
  },

  variants: {
    active: {
      true: {
        color: '$gold',
        '& .icon-wrapper': {
          color: '$gold',
          filter: 'drop-shadow(0 0 8px rgba(212, 175, 55, 0.5))',
        },
        '& .label': {
          fontWeight: '$black',
          opacity: 1,
        },
      },
    },
  },
});

const IconWrapper = styled('div', {
  fontSize: '24px',
  transition: 'all 0.3s ease',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$full',
  padding: '$1',
});

const Label = styled('span', {
  fontSize: '$xs',
  fontWeight: '$bold',
  textTransform: 'uppercase',
  tracking: '$widest',
  opacity: 0.6,
  transition: 'all 0.3s ease',
});

const Indicator = styled('div', {
  position: 'absolute',
  top: 0,
  width: '40%',
  height: '3px',
  background: 'linear-gradient(90deg, transparent, $gold, transparent)',
  boxShadow: '0 0 10px $gold',
  borderRadius: '$full',
});

const navItems = [
  { label: 'HOME', path: '/', icon: '🏠' },
  { label: 'LIVE', path: '/tournament', icon: '🎾' },
  { label: 'ARCHIVE', path: '/results', icon: '📂' },
  { label: 'PROFILE', path: '/profile', icon: '👤' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <NavContainer>
      {navItems.map((item) => {
        const isActive = pathname === item.path;
        return (
          <NavLink key={item.path} href={item.path} active={isActive}>
            {isActive && <Indicator />}
            <IconWrapper className="icon-wrapper">
              {item.icon}
            </IconWrapper>
            <Label className="label">{item.label}</Label>
          </NavLink>
        );
      })}
    </NavContainer>
  );
}
