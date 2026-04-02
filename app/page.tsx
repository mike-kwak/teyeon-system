'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { styled, keyframes } from '@/stitches.config';
import ProfileAvatar from '@/components/ProfileAvatar';
import { Skeleton } from '@/components/Skeleton';

const scanline = keyframes({
  '0%': { transform: 'translateY(-100%)' },
  '100%': { transform: 'translateY(100%)' },
});

const pulse = keyframes({
  '0%, 100%': { opacity: 1, transform: 'scale(1)', filter: 'brightness(1)' },
  '50%': { opacity: 0.8, transform: 'scale(0.98)', filter: 'brightness(1.5)' },
});

const shimmer = keyframes({
  '0%': { backgroundPosition: '-200% 0' },
  '100%': { backgroundPosition: '200% 0' },
});

const Container = styled('main', {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100dvh',
  padding: '$6 $6 140px',
  maxWidth: '500px',
  margin: '0 auto',
  width: '100%',
  backgroundColor: '#000000',
  position: 'relative',
  overflowX: 'hidden',
  backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(212, 175, 55, 0.08), transparent 70%)',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '2px',
    background: 'linear-gradient(90deg, transparent, $goldGlint, transparent)',
    boxShadow: '0 0 25px $goldGlint',
    zIndex: 10,
    animation: `${scanline} 6s linear infinite`,
    opacity: 0.4,
  }
});

const TelemetryGrid = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '$4',
  marginBottom: '$10',
});

const StatBox = styled('div', {
  volumetricBox: '',
  padding: '$5 $2',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  borderRadius: '$xl',
  textAlign: 'center',
  border: '1px solid rgba(255, 215, 0, 0.1)',
  transition: 'all 0.3s ease',

  '&:hover': {
    borderColor: '$goldGlint',
    boxShadow: '0 0 20px rgba(255, 215, 0, 0.15)',
  },

  '& .label': {
    fontSize: '10px',
    fontFamily: '$sporty',
    fontWeight: 900,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.2em',
    marginBottom: '$2',
  },

  '& .value': {
    fontSize: '20px',
    fontFamily: '$display',
    fontWeight: 900,
    color: '$goldGlint',
    textShadow: '0 0 15px rgba(255, 215, 0, 0.4)',
  },
});

const ProfileHero = styled('section', {
  marginBottom: '$12',
  width: '100%',
});

const PilotCard = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  padding: '$8',
  borderRadius: '$2xl',
  background: 'linear-gradient(135deg, #121212 0%, #000000 100%)',
  border: '1px solid rgba(255, 215, 0, 0.3)',
  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05), 0 25px 50px rgba(0,0,0,0.9)',
  position: 'relative',
  overflow: 'hidden',
  transition: 'all 0.5s cubic-bezier(0.19, 1, 0.22, 1)',

  '&:hover': {
    borderColor: '$goldGlint',
    transform: 'translateY(-4px)',
    boxShadow: '0 0 40px rgba(255, 215, 0, 0.4)',
  },
});

const KakaoLoginButton = styled('button', {
   width: '100%',
   padding: '$8',
   borderRadius: '$2xl',
   background: 'rgba(0, 0, 0, 0.95)',
   color: '$goldGlint',
   fontSize: '18px',
   fontFamily: '$sporty',
   fontWeight: 900,
   letterSpacing: '0.15em',
   textTransform: 'uppercase',
   boxShadow: '0 15px 35px rgba(0, 0, 0, 0.8), inset 0 0 20px rgba(255, 215, 0, 0.05)',
   border: '1.5px solid $goldGlint',
   transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
   display: 'flex',
   alignItems: 'center',
   justifyContent: 'center',
   gap: '$4',
   position: 'relative',
   overflow: 'hidden',

   '&::before': {
     content: '""',
     position: 'absolute',
     top: 0,
     left: '-100%',
     width: '100%',
     height: '100%',
     background: 'linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.1), transparent)',
     animation: `${shimmer} 3s infinite linear`,
   },

   '&:hover': {
     transform: 'translateY(-4px) scale(1.02)',
     background: 'rgba(255, 215, 0, 0.05)',
     boxShadow: '0 20px 50px rgba(255, 215, 0, 0.3)',
   },
   '&:active': { transform: 'scale(0.98)' }
});

const BentoGrid = styled('section', {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '$5',
  width: '100%',
});

const MegaMenuItem = styled(Link, {
  gridColumn: 'span 2',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '$8',
  borderRadius: '$2xl',
  volumetricBox: '',
  background: 'linear-gradient(135deg, #151515 0%, #000000 100%)',
  border: '1px solid rgba(255, 215, 0, 0.2)',
  boxShadow: '0 15px 35px rgba(0,0,0,0.8)',
  transition: 'all 0.4s ease',

  '&:hover': {
    borderColor: '$goldGlint',
    transform: 'translateX(4px)',
    boxShadow: '0 0 30px rgba(255, 215, 0, 0.2)',
  }
});

const StandardMenuItem = styled(Link, {
  display: 'flex',
  flexDirection: 'column',
  padding: '$6',
  borderRadius: '$xl',
  volumetricBox: '',
  background: 'linear-gradient(135deg, #151515 0%, #000000 100%)',
  border: '1px solid rgba(255, 215, 0, 0.15)',
  transition: 'all 0.3s ease',
  gap: '$4',

  '&:hover': {
    transform: 'translateY(-4px)',
    borderColor: '$goldGlint',
    boxShadow: '0 0 25px rgba(255, 215, 0, 0.2)',
  }
});

const ProgressTrack = styled('div', {
  width: '100%',
  height: '10px',
  background: '#000',
  borderRadius: '$full',
  boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.9)',
  overflow: 'hidden',
  marginTop: '$4',
  border: '1px solid rgba(255,255,255,0.03)',
});

const ProgressBar = styled('div', {
  height: '100%',
  background: 'linear-gradient(90deg, #D4AF37, #FFD700)',
  boxShadow: '0 0 15px #FFD700',
  borderRadius: '$full',
  transition: 'width 1.5s cubic-bezier(0.16, 1, 0.3, 1)',
});

const Badge = styled('div', {
  padding: '3px 10px',
  background: '$goldGlint',
  color: '$black',
  fontSize: '10px',
  fontWeight: 900,
  borderRadius: '6px',
  fontFamily: '$sporty',
  letterSpacing: '0.1em',
  boxShadow: '0 0 15px rgba(255, 215, 0, 0.5)',
});

export default function Home() {
  const { user, role, signInWithKakao, isLoading } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  return (
    <Container>
      <TelemetryGrid>
        <StatBox>
          <span className="label">SYS STATUS</span>
          <span className="value" style={{ color: '#4CAF50' }}>ACTIVE</span>
        </StatBox>
        <StatBox>
          <span className="label">RPM GAUGE</span>
          <span className="value">9,482</span>
        </StatBox>
        <StatBox>
          <span className="label">PILOTS</span>
          <span className="value">168</span>
        </StatBox>
      </TelemetryGrid>

      <ProfileHero>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', padding: '32px', background: 'rgba(255, 215, 0, 0.03)', borderRadius: '32px', border: '1px solid rgba(255, 215, 0, 0.1)' }}>
            <Skeleton variant="circle" size="xl" style={{ width: '84px', height: '84px' }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
               <Skeleton variant="text" style={{ width: '40%' }} />
               <Skeleton variant="text" style={{ width: '70%', height: '34px' }} />
               <div style={{ display: 'flex', gap: '8px' }}>
                  <Skeleton variant="rect" size="sm" style={{ width: '60px' }} />
                  <Skeleton variant="rect" size="sm" style={{ width: '60px' }} />
               </div>
            </div>
          </div>
        ) : !user ? (
          <KakaoLoginButton 
            onClick={() => signInWithKakao()}
            className="kakao-login-button"
          >
            <span>💬</span> KAKAOTALK LOGIN ELITE
          </KakaoLoginButton>
        ) : (
          <PilotCard href="/profile">
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <ProfileAvatar 
                src={user.user_metadata?.avatar_url} 
                alt={user.user_metadata?.nickname} 
                size={84}
                fallbackIcon={role === 'CEO' ? '👑' : '👤'}
                className="border-2 border-goldGlint shadow-[0_0_25px_rgba(255,215,0,0.4)] rounded-2xl"
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 950, color: '#FFD700', letterSpacing: '0.3em', fontFamily: 'var(--font-rajdhani)' }}>{role === 'CEO' ? 'COMMANDER IN CHIEF' : 'ELITE CIRCUIT PILOT'}</span>
                <h2 style={{ fontSize: '34px', fontWeight: 950, color: '#FFF', fontFamily: 'var(--font-orbitron)', letterSpacing: '-0.02em' }}>{user.user_metadata?.nickname || "MEMBER"}</h2>
                <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                   <div style={{ padding: '3px 8px', background: 'rgba(255,215,0,0.1)', border: '1px solid #D4AF37', borderRadius: '5px', fontSize: '10px', fontWeight: 950, color: '#D4AF37', fontFamily: 'var(--font-rajdhani)' }}>LVL 42</div>
                   <div style={{ padding: '3px 8px', background: 'rgba(255,215,0,0.1)', border: '1px solid #D4AF37', borderRadius: '5px', fontSize: '10px', fontWeight: 950, color: '#D4AF37', fontFamily: 'var(--font-rajdhani)' }}>VIP PRESTIGE</div>
                </div>
              </div>
            </div>
          </PilotCard>
        )}
      </ProfileHero>

      <BentoGrid>
        <MegaMenuItem href="/notice">
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ fontSize: '36px', filter: 'drop-shadow(0 0 10px $goldGlint)' }}>📢</div>
              <div>
                <h3 style={{ fontSize: '19px', fontWeight: 950, color: '#FFF', letterSpacing: '0.05em' }}>CLUB NOTICE</h3>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', letterSpacing: '0.05em' }}>Access core mission intelligence.</p>
              </div>
            </div>
            <span style={{ fontSize: '28px', opacity: 0.4, color: '#D4AF37' }}>→</span>
        </MegaMenuItem>

        <StandardMenuItem href="/tournament">
          <div style={{ fontSize: '28px', marginBottom: '$2' }}>🏆</div>
          <h4 style={{ fontSize: '15px', fontWeight: 950, color: '#FFF', letterSpacing: '0.05em' }}>SPECIAL MATCH</h4>
          <Badge style={{ width: 'fit-content', marginTop: 'auto' }}>LIVE</Badge>
        </StandardMenuItem>

        <StandardMenuItem href="/kdk">
          <div style={{ fontSize: '28px', marginBottom: '$2' }}>⚡</div>
          <h4 style={{ fontSize: '15px', fontWeight: 950, color: '#FFF', letterSpacing: '0.05em' }}>MATCH GENERATOR</h4>
          <Badge style={{ width: 'fit-content', marginTop: 'auto' }}>TURBO</Badge>
        </StandardMenuItem>

        <MegaMenuItem href="/finance" style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #000000 100%)' }}>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '$2' }}>
                 <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    <span style={{ fontSize: '28px' }}>💰</span>
                    <h3 style={{ fontSize: '17px', fontWeight: 950, color: '#FFF' }}>FINANCE OVERVIEW</h3>
                 </div>
                 <span style={{ fontSize: '22px', fontFamily: 'var(--font-orbitron)', color: '#FFD700', fontWeight: 950 }}>₩1.2M</span>
              </div>
              <ProgressTrack><ProgressBar style={{ width: '75%' }} /></ProgressTrack>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '$4', fontSize: '10px', fontWeight: 950, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>
                 <span>INCOME TRACKING</span>
                 <span>75% CAPACITY</span>
              </div>
            </div>
        </MegaMenuItem>

        <MegaMenuItem href="/prediction" style={{ borderStyle: 'dashed' }}>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '$2' }}>
                 <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    <span style={{ fontSize: '28px', animation: `${pulse} 2s infinite ease-in-out` }}>🤖</span>
                    <h3 style={{ fontSize: '17px', fontWeight: 950, color: '#FFF' }}>NEURAL AI PREDICTION</h3>
                 </div>
                 <span style={{ fontSize: '20px', fontFamily: 'var(--font-orbitron)', color: '#FFD700', fontWeight: 950 }}>92% ACC</span>
              </div>
              <ProgressTrack><ProgressBar style={{ width: '92%', background: 'linear-gradient(90deg, #D4AF37, #FFD700)', boxShadow: '0 0 20px #FFD700' }} /></ProgressTrack>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '$4', fontSize: '10px', fontWeight: 950, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>
                 <span>DEEP LEARNING SEEDING</span>
                 <span>CERTAINTY INDEX</span>
              </div>
            </div>
        </MegaMenuItem>

        <StandardMenuItem href="/results">
          <div style={{ fontSize: '28px', marginBottom: '$2' }}>📊</div>
          <h4 style={{ fontSize: '15px', fontWeight: 950, color: '#FFF', letterSpacing: '0.05em' }}>TELEMETRY DATA</h4>
        </StandardMenuItem>

        <StandardMenuItem href="/admin">
          <div style={{ fontSize: '28px', marginBottom: '$2' }}>⚙️</div>
          <h4 style={{ fontSize: '14px', fontWeight: 950, color: '#FFF' }}>CORE SYSTEM</h4>
        </StandardMenuItem>
      </BentoGrid>

      {toast && (
        <div style={{ 
          position: 'fixed', 
          bottom: '130px', 
          left: '50%', 
          transform: 'translateX(-50%)', 
          width: '90vw', 
          padding: '18px', 
          background: 'rgba(255, 215, 0, 0.95)', 
          color: '#000', 
          fontWeight: 950, 
          textAlign: 'center', 
          borderRadius: '14px', 
          zIndex: 2000, 
          boxShadow: '0 25px 60px rgba(0,0,0,0.8)', 
          fontFamily: 'var(--font-rajdhani)', 
          letterSpacing: '0.05em',
          fontSize: '15px'
        }}>
          {toast}
        </div>
      )}

      <footer style={{ marginTop: '100px', textAlign: 'center', opacity: 0.25 }}>
        <p style={{ fontSize: '11px', fontWeight: 950, letterSpacing: '0.5em', color: '$gold', textTransform: 'uppercase' }}>TEYEON CORE V4.2 STABLE RELEASE</p>
        <p style={{ fontSize: '9px', marginTop: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em' }}>EXECUTIVE CIRCUIT ENGINE • POWERED BY ANTIGRAVITY</p>
      </footer>
    </Container>
  );
}
