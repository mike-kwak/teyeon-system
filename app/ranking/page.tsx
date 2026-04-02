'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Match, Player, calculateRankings, PlayerStats } from '@/lib/kdk';
import { styled, keyframes } from '@/stitches.config';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(15px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
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

const Subtitle = styled('p', {
  fontSize: '10px',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  marginTop: '$2',
  opacity: 0.6,
  textAlign: 'center',
});

const TabRow = styled('div', {
  display: 'flex',
  background: 'rgba(255, 255, 255, 0.03)',
  padding: '$1',
  borderRadius: '$2xl',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  marginBottom: '$10',
});

const TabItem = styled('button', {
  flex: 1,
  padding: '$3',
  fontSize: '11px',
  fontWeight: '$black',
  borderRadius: '$xl',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  textTransform: 'uppercase',
  letterSpacing: '$wider',

  variants: {
    active: {
      true: {
        background: '$gold',
        color: '$black',
        boxShadow: '$goldGlow',
        transform: 'scale(1.05)',
      },
      false: {
        color: 'rgba(255, 255, 255, 0.3)',
        '&:hover': { color: '$white' },
      },
    },
  },
});

const PodiumContainer = styled('div', {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-end',
  gap: '$3',
  height: '200px',
  marginBottom: '$12',
  padding: '0 $2',
});

const PodiumCard = styled('div', {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: '$4',
  borderRadius: '$2xl',
  position: 'relative',
  overflow: 'hidden',
  transition: 'all 0.6s cubic-bezier(0.165, 0.84, 0.44, 1)',

  variants: {
    rank: {
      1: {
        height: '100%',
        background: 'linear-gradient(180deg, rgba(212, 175, 55, 0.3), transparent)',
        border: '2px solid $gold',
        boxShadow: '$goldGlow',
        '& .rank-label': { color: '$gold', fontSize: '18px' },
      },
      2: {
        height: '85%',
        background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        '& .rank-label': { color: '#E5E4E2', fontSize: '14px' },
      },
      3: {
        height: '75%',
        background: 'linear-gradient(180deg, rgba(205, 127, 50, 0.1), transparent)',
        border: '1px solid rgba(205, 127, 50, 0.2)',
        '& .rank-label': { color: '#CD7F32', fontSize: '14px' },
      },
    },
  },
});

const RankCard = styled('div', {
  background: 'linear-gradient(135deg, $gray850, $black)',
  borderRadius: '$2xl',
  padding: '$5',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '$4',
  animation: `${fadeIn} 0.6s ease-out`,
  boxShadow: '$glass',
  transition: 'all 0.4s ease',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.3)',
    transform: 'translateX(4px)',
    boxShadow: '$goldGlow',
  },
});

const ProfileInfo = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
});

const RankCircle = styled('div', {
  width: '42px',
  height: '42px',
  borderRadius: '$full',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '16px',
  fontWeight: '$black',
  fontStyle: 'italic',

  variants: {
    top: {
      true: { background: '$gold', color: '$black', boxShadow: '$goldGlow' },
      false: { background: 'rgba(255, 255, 255, 0.05)', color: 'rgba(255, 255, 255, 0.3)', border: '1px solid rgba(255, 255, 255, 0.1)' },
    },
  },
});

export default function RankingPage() {
  const [stats, setStats] = useState<PlayerStats[]>([]);

  useEffect(() => {
    const savedMatches = localStorage.getItem('teyeon_matches');
    const savedPlayers = localStorage.getItem('teyeon_players');
    if (savedMatches && savedPlayers) {
      const matches: Match[] = JSON.parse(savedMatches);
      const players: Player[] = JSON.parse(savedPlayers);
      const rankings = calculateRankings(matches, players);
      setStats(rankings);
    } else {
      setStats([
        { name: '곽민섭', wins: 5, losses: 1, ptsDiff: 12, matches: 6, rank: 1, isGuest: false },
        { name: '가내현', wins: 4, losses: 2, ptsDiff: 8, matches: 6, rank: 2, isGuest: false },
        { name: '강정호', wins: 3, losses: 3, ptsDiff: 5, matches: 6, rank: 3, isGuest: false },
        { name: '김병식', wins: 2, losses: 4, ptsDiff: -2, matches: 6, rank: 4, isGuest: false },
      ]);
    }
  }, []);

  const getRankBadge = (rank: number) => {
    if (rank === 1) return '🏆';
    if (rank === 2) return '❷';
    if (rank === 3) return '❸';
    return rank;
  };

  return (
    <Container>
      <header style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{ fontSize: '36px', fontWeight: 950, color: '$white', fontFamily: 'var(--font-orbitron)', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: '1' }}>Elite <span style={{ color: '$goldGlint' }}>Ranking</span></h1>
        <Subtitle>The Championship Circuit • Live Stats</Subtitle>
      </header>

      <TabRow>
        <TabItem active={false}>Weekly</TabItem>
        <TabItem active={false}>Monthly</TabItem>
        <TabItem active={true}>All Time</TabItem>
      </TabRow>

      <PodiumContainer>
        {stats[1] && (
          <PodiumCard rank={2}>
            <span className="rank-label" style={{ fontWeight: 950, marginBottom: '4px', fontFamily: 'var(--font-orbitron)' }}>❷</span>
            <span style={{ fontSize: '11px', fontWeight: 950, color: '$white', textAlign: 'center', fontFamily: 'var(--font-rajdhani)' }}>{stats[1].name}</span>
          </PodiumCard>
        )}
        {stats[0] && (
          <PodiumCard rank={1}>
            <span style={{ position: 'absolute', top: '10px', fontSize: '32px' }}>👑</span>
            <span className="rank-label" style={{ fontWeight: 950, marginBottom: '8px', fontFamily: 'var(--font-orbitron)' }}>❶</span>
            <span style={{ fontSize: '14px', fontWeight: 950, color: '$white', textAlign: 'center', fontFamily: 'var(--font-rajdhani)' }}>{stats[0].name}</span>
          </PodiumCard>
        )}
        {stats[2] && (
          <PodiumCard rank={3}>
            <span className="rank-label" style={{ fontWeight: 950, marginBottom: '4px', fontFamily: 'var(--font-orbitron)' }}>❸</span>
            <span style={{ fontSize: '11px', fontWeight: 950, color: '$white', textAlign: 'center', fontFamily: 'var(--font-rajdhani)' }}>{stats[2].name}</span>
          </PodiumCard>
        )}
      </PodiumContainer>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {stats.map((s) => (
          <RankCard key={s.name}>
            <ProfileInfo>
              <RankCircle top={s.rank <= 1}>{getRankBadge(s.rank)}</RankCircle>
              <div>
                <p style={{ fontWeight: 950, fontSize: '18px', color: '$white', fontFamily: 'var(--font-rajdhani)' }}>{s.name}</p>
                <p style={{ fontSize: '11px', fontWeight: 800, color: '$gold', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-rajdhani)' }}>
                  {s.wins}W {s.losses}L • Diff {s.ptsDiff > 0 ? `+${s.ptsDiff}` : s.ptsDiff}
                </p>
              </div>
            </ProfileInfo>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '9px', fontWeight: 950, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', fontFamily: 'var(--font-rajdhani)' }}>Win Rate</p>
              <p style={{ fontSize: '20px', fontWeight: 950, color: s.rank <= 1 ? '$goldGlint' : '$white', fontFamily: 'var(--font-orbitron)' }}>
                {s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0}%
              </p>
            </div>
          </RankCard>
        ))}
      </section>

      <footer style={{ marginTop: 'auto', padding: '60px 0', textAlign: 'center', opacity: 0.2 }}>
        <p style={{ fontSize: '11px', fontWeight: 950, letterSpacing: '0.5em', color: '$goldGlint' }}>TEYEON CHAMPIONSHIP DATA</p>
      </footer>
    </Container>
  );
}
