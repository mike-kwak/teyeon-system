'use client';

import React from 'react';
import { styled, keyframes } from '@/stitches.config';
import { Skeleton, SkeletonGroup } from './Skeleton';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(10px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const Container = styled('div', {
  width: '100%',
  animation: `${fadeIn} 0.5s ease-out`,
});

const ErrorBox = styled('div', {
  padding: '$8',
  borderRadius: '$2xl',
  background: 'rgba(255, 69, 58, 0.03)',
  border: '1px solid rgba(255, 69, 58, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: '$5',
  width: '100%',
});

const WarningEmoji = styled('span', {
  fontSize: '42px',
  filter: 'grayscale(0.5) opacity(0.8)',
});

const ErrorTitle = styled('h3', {
  fontSize: '16px',
  fontWeight: 900,
  fontFamily: '$sporty',
  color: '#FF453A',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
});

const TryAgainButton = styled('button', {
  padding: '$4 $8',
  borderRadius: '$xl',
  background: 'rgba(255, 255, 255, 0.05)',
  color: '#fff',
  fontSize: '11px',
  fontWeight: 900,
  fontFamily: '$rajdhani',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  transition: 'all 0.3s ease',
  
  '&:hover': {
    background: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    transform: 'translateY(-2px)',
  },
  '&:active': { transform: 'scale(0.98)' }
});

const EmptyState = styled('div', {
  padding: '$10',
  textAlign: 'center',
  opacity: 0.3,
  fontFamily: '$rajdhani',
  fontWeight: 900,
  fontSize: '12px',
  letterSpacing: '0.3em',
  textTransform: 'uppercase',
});

interface DataStateViewProps {
  isLoading: boolean;
  isError: boolean;
  isEmpty?: boolean;
  onRetry?: () => void;
  loadingComponent?: React.ReactNode;
  children: React.ReactNode;
}

export const DataStateView: React.FC<DataStateViewProps> = ({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  loadingComponent,
  children,
}) => {
  if (isLoading) {
    return loadingComponent || (
      <SkeletonGroup style={{ padding: '24px 0' }}>
        <Skeleton variant="rect" size="xl" />
        <Skeleton variant="text" />
        <Skeleton variant="text" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
             <Skeleton variant="rect" size="lg" />
             <Skeleton variant="rect" size="lg" />
        </div>
      </SkeletonGroup>
    );
  }

  if (isError) {
    return (
      <ErrorBox>
        <WarningEmoji>📡</WarningEmoji>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
             <ErrorTitle>LINK INTERRUPTED</ErrorTitle>
             <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: 800 }}>Signal lost in tracking sector.</p>
        </div>
        {onRetry && <TryAgainButton onClick={onRetry}>RE-ESTABLISH CONNECTION</TryAgainButton>}
      </ErrorBox>
    );
  }

  if (isEmpty) {
    return <EmptyState>— NO TRACK DATA FOUND —</EmptyState>;
  }

  return <Container>{children}</Container>;
};
