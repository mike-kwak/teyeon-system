'use client';

import { styled, keyframes } from '@/stitches.config';

const shimmer = keyframes({
  '0%': { backgroundPosition: '-200% 0' },
  '100%': { backgroundPosition: '200% 0' },
});

export const Skeleton = styled('div', {
  display: 'inline-block',
  height: '1.2em',
  width: '100%',
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  borderRadius: '$md',
  
  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.1), transparent)',
    animation: `${shimmer} 2s infinite linear`,
  },

  variants: {
    variant: {
      rect: { borderRadius: '$xl' },
      circle: { borderRadius: '50%' },
      text: { 
        height: '14px', 
        marginBottom: '8px',
        '&:last-child': { width: '80%', marginBottom: 0 }
      },
    },
    size: {
      sm: { height: '12px' },
      md: { height: '24px' },
      lg: { height: '48px' },
      xl: { height: '84px' },
    }
  },
  defaultVariants: {
    variant: 'rect',
    size: 'md',
  }
});

export const SkeletonGroup = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: '$4',
    width: '100%',
});
