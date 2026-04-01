'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'scale(0.95)' },
  to: { opacity: 1, transform: 'scale(1)' },
});

const Container = styled('main', {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100dvh',
  padding: '$6 $4',
  maxWidth: '500px',
  margin: '0 auto',
  width: '100%',
  backgroundColor: '$black',
  paddingBottom: '100px',
});

const Header = styled('header', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '$8',
});

const ProfileHero = styled('section', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  marginBottom: '$10',
  animation: `${fadeIn} 0.6s ease-out`,
});

const AvatarWrapper = styled('div', {
  position: 'relative',
  padding: '$2',
  background: 'linear-gradient(135deg, $gold, transparent)',
  borderRadius: '$full',
  marginBottom: '$4',
  boxShadow: '0 0 30px rgba(212, 175, 55, 0.2)',
});

const UserBadge = styled('div', {
  position: 'absolute',
  bottom: '-10px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '$gold',
  color: '$black',
  fontSize: '9px',
  fontWeight: '$black',
  padding: '$1 $4',
  borderRadius: '$full',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
});

const StatsGrid = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '$4',
  width: '100%',
  marginBottom: '$8',
});

const StatCard = styled('div', {
  background: '$gray900',
  padding: '$5 $2',
  borderRadius: '$lg',
  border: '1px solid $gray800',
  textAlign: 'center',
  transition: 'all 0.3s ease',

  '&:hover': {
    borderColor: 'rgba(212,175,55,0.2)',
    transform: 'translateY(-2px)',
  },
});

const StatValue = styled('div', {
  fontSize: '$xl',
  fontWeight: '$black',
  color: '$white',
  marginBottom: '$1',

  variants: {
    highlight: {
      true: { color: '$gold' },
    },
  },
});

const StatLabel = styled('div', {
  fontSize: '9px',
  fontWeight: '$black',
  color: 'rgba(255,255,255,0.3)',
  textTransform: 'uppercase',
  letterSpacing: '$widest',
});

const FilterContainer = styled('div', {
  display: 'flex',
  background: '$gray900',
  padding: '$1',
  borderRadius: '$lg',
  marginBottom: '$6',
  border: '1px solid $gray800',
  width: '100%',
});

const FilterButton = styled('button', {
  flex: 1,
  padding: '$2',
  fontSize: '10px',
  fontWeight: '$black',
  borderRadius: '$md',
  transition: 'all 0.3s ease',
  color: '$gray500',

  variants: {
    active: {
      true: {
        background: '$gray700',
        color: '$white',
        border: '1px solid rgba(255,255,255,0.1)',
      },
    },
  },
});

const SectionTitle = styled('h3', {
  fontSize: '$xs',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$widest',
  textTransform: 'uppercase',
  marginBottom: '$4',
  paddingLeft: '$2',
  opacity: 0.8,
});

const MatchRecord = styled('div', {
  background: 'linear-gradient(90deg, $gray900, $black)',
  padding: '$4 $6',
  borderRadius: '$lg',
  border: '1px solid rgba(255,255,255,0.03)',
  marginBottom: '$3',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',

  '&:hover': {
    background: '$gray800',
  },
});

export default function ProfilePage() {
  const { user, role, signOut } = useAuth();
  const [filter, setFilter] = useState<'weekly' | 'monthly' | 'yearly'>('monthly');

  // Simulated Stats (In a real app, this would be computed from Match data)
  const stats = useMemo(() => {
    const base = {
      weekly: { wins: 4, losses: 1, winRate: '80%' },
      monthly: { wins: 18, losses: 4, winRate: '82%' },
      yearly: { wins: 142, losses: 41, winRate: '78%' },
    };
    return base[filter];
  }, [filter]);

  if (!user) {
    return (
      <Container>
        <p>Please login to view your profile.</p>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Link href="/" style={{ color: 'rgba(255,255,255,0.2)', fontSize: '24px' }}>←</Link>
        <p style={{ fontWeight: 900, color: '$gold', fontSize: '10px', letterSpacing: '0.3em' }}>PREMIUM PROFILE</p>
        <button onClick={() => signOut()} style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px', fontWeight: 900 }}>LOGOUT</button>
      </Header>

      <ProfileHero>
        <AvatarWrapper>
            <ProfileAvatar 
              src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
              alt="Profile" 
              size={100} 
              className="rounded-full border-4 border-black"
              fallbackIcon={role === 'CEO' ? '👑' : '👤'}
            />
          <UserBadge>{role === 'CEO' ? 'GOLD ELITE' : 'CLUB MEMBER'}</UserBadge>
        </AvatarWrapper>
        <h2 style={{ fontSize: '24px', fontWeight: 900, color: '$white' }}>{user.user_metadata?.nickname || user.user_metadata?.full_name}</h2>
        <p style={{ fontSize: '$sm', color: 'rgba(255,255,255,0.4)', marginTop: '$1' }}>Elite Amateur • SEOUL, KR</p>
      </ProfileHero>

      <SectionTitle>Record Analytics</SectionTitle>
      
      <FilterContainer>
        <FilterButton active={filter === 'weekly'} onClick={() => setFilter('weekly')}>WEEKLY</FilterButton>
        <FilterButton active={filter === 'monthly'} onClick={() => setFilter('monthly')}>MONTHLY</FilterButton>
        <FilterButton active={filter === 'yearly'} onClick={() => setFilter('yearly')}>YEARLY</FilterButton>
      </FilterContainer>

      <StatsGrid>
        <StatCard>
          <StatValue highlight>{stats.winRate}</StatValue>
          <StatLabel>Win Rate</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{stats.wins}</StatValue>
          <StatLabel>Wins</StatLabel>
        </StatCard>
        <StatCard>
          <StatValue>{stats.losses}</StatValue>
          <StatLabel>Losses</StatLabel>
        </StatCard>
      </StatsGrid>

      <SectionTitle>Recent Activity</SectionTitle>
      <section>
        {[
          { date: 'SEP 14', opponent: 'Alex Rivera', result: 'W', score: '6-4' },
          { date: 'SEP 12', opponent: 'David Chen', result: 'L', score: '4-6' },
          { date: 'SEP 08', opponent: 'Jannik Sinner', result: 'W', score: '2-0' },
        ].map((m, idx) => (
          <MatchRecord key={idx}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '8px', fontWeight: 900, color: 'rgba(255,255,255,0.2)' }}>{m.date.split(' ')[0]}</p>
                <p style={{ fontSize: '14px', fontWeight: 900 }}>{m.date.split(' ')[1]}</p>
              </div>
              <div>
                <p style={{ fontSize: '$sm', fontWeight: '$black' }}>vs. {m.opponent}</p>
                <p style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Championship Match</p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '$sm', fontWeight: '$black', color: m.result === 'W' ? '$gold' : '$error' }}>{m.result}</p>
              <p style={{ fontSize: '10px', fontWeight: 900, opacity: 0.5 }}>{m.score}</p>
            </div>
          </MatchRecord>
        ))}
      </section>

      <div style={{ marginTop: '40px', background: '$gold', color: '$black', padding: '$6', borderRadius: '$xl', textAlign: 'center' }}>
        <p style={{ fontSize: '12px', fontWeight: '$black', letterSpacing: '0.1em' }}>UPGRADE TO PRO MEMBERSHIP</p>
        <p style={{ fontSize: '8px', opacity: 0.7, marginTop: '$1' }}>Access advanced AI insights and video replays</p>
      </div>

    </Container>
  );
}
