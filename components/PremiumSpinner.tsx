'use client';

import React from 'react';
import Image from 'next/image';

const LOGO_SRC = '/logos/teyeon-logo-transparent.png';

const LOGO_STYLE: React.CSSProperties = {
  objectFit: 'contain',
  width: 'clamp(112px, 28vw, 128px)',
  height: 'clamp(112px, 28vw, 128px)',
  filter: 'drop-shadow(0 2px 8px rgba(60,70,120,0.10))',
};

interface PremiumSpinnerProps {
  message?: string;
  isWhiteTheme?: boolean;
}

const PremiumSpinner: React.FC<PremiumSpinnerProps> = ({ message = 'TEYEON 준비 중...' }) => {
  return (
    <>
      <style>{`@keyframes ps-spin { to { transform: rotate(360deg) } }`}</style>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 5000,
          backgroundColor: '#F2F4F7',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '14px',
        }}
      >
        <Image
          src={LOGO_SRC}
          alt="TEYEON"
          width={128}
          height={128}
          priority
          style={LOGO_STYLE}
        />
        <span
          style={{
            fontFamily: 'var(--font-rajdhani), sans-serif',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'rgba(55,65,95,0.45)',
          }}
        >
          {message}
        </span>
        <div
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            border: '1.5px solid rgba(55,65,95,0.12)',
            borderTopColor: 'rgba(55,65,95,0.42)',
            animation: 'ps-spin 0.75s linear infinite',
          }}
        />
      </div>
    </>
  );
};

export default PremiumSpinner;
