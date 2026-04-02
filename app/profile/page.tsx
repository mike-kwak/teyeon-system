'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'scale(0.95) translateY(10px)' },
  to: { opacity: 1, transform: 'scale(1) translateY(0)' },
});

const Container = styled('main', {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100dvh',
  padding: '$8 $5',
  maxWidth: '500px',
  margin: '0 auto',
  width: '100%',
  backgroundColor: '$black',
  paddingBottom: '110px',
});

const Header = styled('header', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '$10',
});

const ProfileHero = styled('section', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  marginBottom: '$12',
  animation: `${fadeIn} 0.6s cubic-bezier(0.165, 0.84, 0.44, 1)`,
  padding: '$8',
  background: 'linear-gradient(180deg, rgba(212, 175, 55, 0.05) 0%, transparent 100%)',
  borderRadius: '$2xl',
  borderGlow: 'rgba(212, 175, 55, 0.1)',
  boxShadow: '$glass',
});

const AvatarWrapper = styled('div', {
  position: 'relative',
  padding: '$1',
  background: 'linear-gradient(135deg, $gold, $goldGlint)',
  borderRadius: '$full',
  marginBottom: '$6',
  boxShadow: '$goldGlow',
});

const UserBadge = styled('div', {
  position: 'absolute',
  bottom: '-12px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '$gold',
  color: '$black',
  fontSize: '9px',
  fontWeight: '$black',
  padding: '$1.5 $5',
  borderRadius: '$full',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  boxShadow: '0 8px 16px rgba(0,0,0,0.5)',
  whiteSpace: 'nowrap',
});

const StatsGrid = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '$4',
  width: '100%',
  marginBottom: '$10',
});

const StatCard = styled('div', {
  background: 'linear-gradient(135deg, $gray850, $gray950)',
  padding: '$6 $2',
  borderRadius: '$xl',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  textAlign: 'center',
  transition: 'all 0.4s ease',
  boxShadow: '$glass',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.3)',
    transform: 'translateY(-4px)',
    boxShadow: '$goldGlow',
  },
});

const StatValue = styled('div', {
  fontSize: '22px',
  fontWeight: '$black',
  color: '$white',
  marginBottom: '$2',
  letterSpacing: '$tight',

  variants: {
    highlight: {
      true: { color: '$gold', textShadow: '0 0 10px rgba(212,175,55,0.3)' },
    },
  },
});

const StatLabel = styled('div', {
  fontSize: '8px',
  fontWeight: '$black',
  color: 'rgba(255,255,255,0.3)',
  textTransform: 'uppercase',
  letterSpacing: '$mega',
});

const FilterContainer = styled('div', {
  display: 'flex',
  padding: '$1',
  borderRadius: '$xl',
  marginBottom: '$8',
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  boxShadow: '$glass',
  width: '100%',
});

const FilterButton = styled('button', {
  flex: 1,
  padding: '$3',
  fontSize: '9px',
  fontWeight: '$black',
  borderRadius: '$lg',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  color: 'rgba(255, 255, 255, 0.3)',
  textTransform: 'uppercase',
  letterSpacing: '$wider',

  variants: {
    active: {
      true: {
        background: '$gray700',
        color: '$gold',
        border: '1px solid rgba(212,175,55,0.2)',
        boxShadow: '$md',
      },
    },
  },
});

const SectionTitle = styled('h3', {
  fontSize: '10px',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  marginBottom: '$5',
  paddingLeft: '$2',
  opacity: 0.8,
});

const MatchRecord = styled('div', {
  background: 'linear-gradient(90deg, $gray850, $black)',
  padding: '$5 $7',
  borderRadius: '$xl',
  borderGlow: 'rgba(255, 255, 255, 0.02)',
  marginBottom: '$4',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  boxShadow: '$glass',
  transition: 'all 0.4s ease',

  '&:hover': {
    background: 'linear-gradient(90deg, $gray800, $black)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    transform: 'translateX(4px)',
  },
});

export default function ProfilePage() {
  const { user, role, signOut, isLoading } = useAuth();
  const [filter, setFilter] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');

  const stats = useMemo(() => {
    const base = {
      weekly: { wins: 4, losses: 1, winRate: '80%' },
      monthly: { wins: 18, losses: 4, winRate: '82%' },
      yearly: { wins: 142, losses: 41, winRate: '78%' },
    };
    return base[filter];
  }, [filter]);

  if (isLoading) {
    return (
      <Container>
        <Header>
          <div className="animate-pulse w-8 h-8 rounded-full bg-white/5"></div>
          <div className="animate-pulse w-32 h-4 rounded bg-white/5"></div>
          <div className="animate-pulse w-12 h-4 rounded bg-white/5"></div>
        </Header>
        <div className="animate-pulse w-full h-[240px] bg-white/5 rounded-[24px] mb-[48px]"></div>
        <div className="animate-pulse w-32 h-4 rounded bg-white/5 mb-5"></div>
        <div className="animate-pulse w-full h-[40px] bg-white/5 rounded-[12px] mb-8"></div>
        <div className="grid grid-cols-3 gap-4 mb-10 w-full">
           <div className="animate-pulse h-[100px] bg-white/5 rounded-[12px]"></div>
           <div className="animate-pulse h-[100px] bg-white/5 rounded-[12px]"></div>
           <div className="animate-pulse h-[100px] bg-white/5 rounded-[12px]"></div>
        </div>
      </Container>
    );
  }

  if (!user) {
    return (
      <Container>
        <p style={{ textAlign: 'center', opacity: 0.5, marginTop: '100px', fontFamily: 'var(--font-rajdhani)' }}>Please login to initialize pilot telemetry.</p>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Link href="/" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '28px', padding: '8px' }}>←</Link>
        <p style={{ fontWeight: 950, color: '$goldGlint', fontSize: '11px', letterSpacing: '0.4em', fontFamily: 'var(--font-rajdhani)' }}>PILOT ANALYTICS</p>
        <button onClick={() => signOut()} style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 950, letterSpacing: '0.15em', fontFamily: 'var(--font-rajdhani)' }}>LOGOUT</button>
      </Header>

      <ProfileHero>
        <AvatarWrapper>
            <ProfileAvatar 
              src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
              alt="Profile" 
              size={124} 
              className="rounded-full border-4 border-black"
              fallbackIcon={role === 'CEO' ? '👑' : '👤'}
            />
          <UserBadge style={{ fontFamily: 'var(--font-rajdhani)' }}>{role === 'CEO' ? 'COMMANDER IN CHIEF' : 'ELITE CIRCUIT PILOT'}</UserBadge>
        </AvatarWrapper>
        <h2 style={{ fontSize: '34px', fontWeight: 950, color: '$white', letterSpacing: '-0.02em', fontFamily: 'var(--font-orbitron)' }}>{user.user_metadata?.nickname || user.user_metadata?.full_name}</h2>
        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: '8px', fontStyle: 'italic', letterSpacing: '0.1em', fontFamily: 'var(--font-rajdhani)' }}>Precision. Power. Prestige.</p>
      </ProfileHero>

      <SectionTitle style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>Performance Baseline</SectionTitle>
      
      <FilterContainer>
        <FilterButton active={filter === 'weekly'} onClick={() => setFilter('weekly')} style={{ fontFamily: 'var(--font-rajdhani)' }}>WEEKLY</FilterButton>
        <FilterButton active={filter === 'monthly'} onClick={() => setFilter('monthly')} style={{ fontFamily: 'var(--font-rajdhani)' }}>MONTHLY</FilterButton>
        <FilterButton active={filter === 'yearly'} onClick={() => setFilter('yearly')} style={{ fontFamily: 'var(--font-rajdhani)' }}>YEARLY</FilterButton>
      </FilterContainer>

      <StatsGrid>
        <StatCard>
          <StatValue highlight style={{ fontFamily: 'var(--font-orbitron)' }}>{stats.winRate}</StatValue>
          <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>Win Rate</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue style={{ fontFamily: 'var(--font-orbitron)' }}>{stats.wins}</StatValue>
          <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>Wins</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue style={{ fontFamily: 'var(--font-orbitron)' }}>{stats.losses}</StatValue>
          <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>Losses</StatLabel>
        </StatCard>
      </StatsGrid>

      <SectionTitle style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>Recent Telemetry Data</SectionTitle>
      <section>
        {[
          { date: 'SEP 14', opponent: 'Alex Rivera', result: 'W', score: '6-4' },
          { date: 'SEP 12', opponent: 'David Chen', result: 'L', score: '4-6' },
          { date: 'SEP 08', opponent: 'Jannik Sinner', result: 'W', score: '2-0' },
        ].map((m, idx) => (
          <MatchRecord key={idx}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <div style={{ textAlign: 'center', minWidth: '45px' }}>
                <p style={{ fontSize: '10px', fontWeight: 950, color: 'rgba(255,255,255,0.25)', marginBottom: '4px', fontFamily: 'var(--font-rajdhani)' }}>{m.date.split(' ')[0]}</p>
                <p style={{ fontSize: '18px', fontWeight: 950, color: '$white', fontFamily: 'var(--font-orbitron)' }}>{m.date.split(' ')[1]}</p>
              </div>
              <div>
                <p style={{ fontSize: '17px', fontWeight: 950, letterSpacing: '-0.01em', fontFamily: 'var(--font-rajdhani)' }}>vs. {m.opponent}</p>
                <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: '4px', fontFamily: 'var(--font-rajdhani)' }}>Championship Series</p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '20px', fontWeight: 950, color: m.result === 'W' ? '$goldGlint' : '$error', fontFamily: 'var(--font-orbitron)' }}>{m.result}</p>
              <p style={{ fontSize: '12px', fontWeight: 950, opacity: 0.4, fontFamily: 'var(--font-orbitron)' }}>{m.score}</p>
            </div>
          </MatchRecord>
        ))}
      </section>

      <div style={{ marginTop: '60px', background: 'linear-gradient(135deg, $gold, $goldGlint)', color: '$black', padding: '32px', borderRadius: '24px', textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.8), 0 0 30px rgba(212, 175, 55, 0.4)' }}>
        <p style={{ fontSize: '16px', fontWeight: 950, letterSpacing: '0.2em', fontFamily: 'var(--font-rajdhani)' }}>UPGRADE TO PRO ELITE</p>
        <p style={{ fontSize: '11px', opacity: 0.9, marginTop: '8px', fontWeight: 800, fontFamily: 'var(--font-rajdhani)' }}>Unlock Advanced AI Predictive Analytics</p>
      </div>

    </Container>
  );
}
