'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';
import { supabase } from '@/lib/supabase';
import { Match, Player, calculateRankings, PlayerStats } from '@/lib/kdk';
import { DataStateView } from '@/components/DataStateView';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(15px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const glow = keyframes({
  '0%': { boxShadow: '0 0 10px rgba(212, 175, 55, 0.2)' },
  '50%': { boxShadow: '0 0 30px rgba(212, 175, 55, 0.5)' },
  '100%': { boxShadow: '0 0 10px rgba(212, 175, 55, 0.2)' },
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
  paddingBottom: '250px',
});

const Header = styled('header', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '$8',
});

const Title = styled('h1', {
  fontSize: '$2xl',
  fontWeight: '$black',
  letterSpacing: '$tight',
  textTransform: 'uppercase',
  fontStyle: 'italic',
  color: '$white',
});

const TabContainer = styled('div', {
  display: 'flex',
  padding: '$1',
  borderRadius: '$xl',
  marginBottom: '$10',
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  boxShadow: '$glass',
});

const TabButton = styled('button', {
  flex: 1,
  padding: '$4',
  fontSize: '$xs',
  fontWeight: '$black',
  borderRadius: '$lg',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  color: 'rgba(255, 255, 255, 0.3)',
  textTransform: 'uppercase',
  letterSpacing: '$wider',

  variants: {
    active: {
      true: {
        background: '$gold',
        color: '$black',
        boxShadow: '$goldGlow',
        transform: 'scale(1.02)',
      },
      false: {
        '&:hover': {
          color: '$white',
          background: 'rgba(255,255,255,0.05)',
        },
      },
    },
  },
});

const Card = styled('div', {
  background: 'linear-gradient(135deg, $gray850, $black)',
  borderRadius: '$xl',
  padding: '$6',
  borderGlow: 'rgba(212, 175, 55, 0.15)',
  marginBottom: '$6',
  position: 'relative',
  overflow: 'hidden',
  boxShadow: '$glass',
  animation: `${fadeIn} 0.6s ease-out`,

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '2px',
    background: 'linear-gradient(90deg, transparent, $gold, transparent)',
    opacity: 0.3,
  },

  variants: {
    highlight: {
      gold: {
        borderColor: '$gold',
        animation: `${glow} 3s infinite ease-in-out`,
      },
    },
  },
});

const MatchInfo = styled('div', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '$6',
});

const CourtBadge = styled('span', {
  fontSize: '9px',
  fontWeight: '$black',
  color: '$black',
  letterSpacing: '$wider',
  textTransform: 'uppercase',
  background: '$gold',
  padding: '$1 $4',
  borderRadius: '$full',
  boxShadow: '$gold',
});

const LiveStatus = styled('span', {
  fontSize: '9px',
  fontWeight: '$black',
  color: '$error',
  display: 'flex',
  alignItems: 'center',
  gap: '$1.5',
  textTransform: 'uppercase',
  letterSpacing: '$wider',

  '&::before': {
    content: '""',
    width: '8px',
    height: '8px',
    background: '$error',
    borderRadius: '50%',
    boxShadow: '0 0 12px $error',
    animation: 'pulse 1.5s infinite',
  },
});

const TeamName = styled('p', {
  fontSize: '20px',
  fontWeight: '$black',
  textAlign: 'center',
  color: '$white',
  margin: '$3 0',
  letterSpacing: '$tight',
});

const VS = styled('div', {
  fontSize: '11px',
  fontWeight: '$black',
  fontStyle: 'italic',
  color: 'rgba(212, 175, 55, 0.4)',
  letterSpacing: '$mega',
  margin: '$4 0',
  display: 'flex',
  alignItems: 'center',
  gap: '$5',

  '&::before, &::after': {
    content: '""',
    flex: 1,
    height: '1px',
    background: 'rgba(212, 175, 55, 0.1)',
  },
});

const RankingItem = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '$5 $6',
  background: 'linear-gradient(90deg, $gray850, $black)',
  borderRadius: '$xl',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  marginBottom: '$4',
  transition: 'all 0.4s ease',
  boxShadow: '$glass',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.4)',
    background: 'linear-gradient(90deg, $gray800, $black)',
    transform: 'translateX(4px)',
    boxShadow: '$goldGlow',
  },

  variants: {
    top: {
      1: { borderGlow: '$gold', background: 'rgba(212, 175, 55, 0.05)' },
      2: { borderGlow: 'rgba(255, 255, 255, 0.2)' },
      3: { borderGlow: 'rgba(205, 127, 50, 0.3)' },
    },
  },
});

const RankNumber = styled('div', {
  width: '42px',
  height: '42px',
  borderRadius: '$full',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '$lg',
  fontWeight: '$black',
  background: 'rgba(255, 255, 255, 0.05)',
  color: '$gray400',

  variants: {
    top: {
      1: { background: '$gold', color: '$black', boxShadow: '$goldGlow', fontSize: '24px' },
      2: { background: '#E5E4E2', color: '$black' },
      3: { background: '#CD7F32', color: '$black' },
    },
  },
});

export default function LivePage() {
  const [activeTab, setActiveTab] = useState<'matches' | 'ranking'>('matches');
  const [matches, setMatches] = useState<any[]>([]);
  const [rankings, setRankings] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      const { data: liveMatches, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .eq('status', 'playing')
        .order('court', { ascending: true });
      
      if (matchError) throw matchError;

      setMatches(liveMatches || []);
      setError(false);

      const savedMatches = localStorage.getItem('teyeon_matches');
      const savedPlayers = localStorage.getItem('teyeon_players');
      
      if (savedMatches && savedPlayers) {
        const m: Match[] = JSON.parse(savedMatches);
        const p: Player[] = JSON.parse(savedPlayers);
        setRankings(calculateRankings(m, p));
      } else {
        setRankings([
          { name: '곽민섭', wins: 55, losses: 12, ptsDiff: 142, matches: 67, rank: 1, isGuest: false },
          { name: '가내현', wins: 42, losses: 18, ptsDiff: 120, matches: 60, rank: 2, isGuest: false },
          { name: '강정호', wins: 38, losses: 22, ptsDiff: 98, matches: 60, rank: 3, isGuest: false },
          { name: '김병식', wins: 35, losses: 25, ptsDiff: 85, matches: 60, rank: 4, isGuest: false },
          { name: '구봉준', wins: 30, losses: 30, ptsDiff: 70, matches: 60, rank: 5, isGuest: false },
        ]);
      }
    } catch (err) {
      console.error("Fetch Error:", err);
      // Only set error if we have no data at all
      if (matches.length === 0 && rankings.length === 0) {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container>
      <Header>
        <Title style={{ fontFamily: 'var(--font-orbitron)', fontSize: '28px', fontWeight: 950 }}>Live <span style={{ color: '$goldGlint' }}>Circuit</span></Title>
        <LiveStatus />
      </Header>

      <TabContainer>
        <TabButton active={activeTab === 'matches'} onClick={() => setActiveTab('matches')} style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '12px' }}>대진표</TabButton>
        <TabButton active={activeTab === 'ranking'} onClick={() => setActiveTab('ranking')} style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '12px' }}>실시간 랭킹</TabButton>
      </TabContainer>

      <DataStateView 
        isLoading={loading && matches.length === 0} 
        isError={error}
        onRetry={fetchData}
        loadingComponent={
          <SkeletonGroup>
            <Skeleton size="xl" />
            <Skeleton size="lg" />
            <Skeleton size="lg" />
            <Skeleton size="lg" />
          </SkeletonGroup>
        }
      >
        {activeTab === 'matches' ? (
          <section>
            {matches.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.3 }}>
                <div style={{ fontSize: '64px', marginBottom: '24px', filter: 'drop-shadow(0 0 10px $goldGlint)' }}>🏟️</div>
                <p style={{ fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.4em', fontSize: '12px', fontFamily: 'var(--font-rajdhani)' }}>Waiting for Next Session</p>
              </div>
            ) : (
              matches.map((m, idx) => (
                <Card key={idx}>
                  <MatchInfo>
                    <CourtBadge style={{ fontFamily: 'var(--font-orbitron)' }}>COURT {(m.court || idx + 1).toString().padStart(2, '0')}</CourtBadge>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                       <span style={{ fontSize: '10px', fontWeight: 950, color: '$goldGlint', letterSpacing: '0.15em', fontFamily: 'var(--font-rajdhani)' }}>LIVE DATA STREAM</span>
                       <div style={{ width: '10px', height: '10px', background: '$error', borderRadius: '50%', boxShadow: '0 0 15px $error' }} />
                    </div>
                  </MatchInfo>
                  <div style={{ padding: '16px 0' }}>
                    <TeamName style={{ fontFamily: 'var(--font-rajdhani)', fontWeight: 950, fontSize: '22px' }}>{m.player_names?.slice(0, 2).join(' / ') || 'Elite Squad Alpha'}</TeamName>
                    <VS style={{ fontFamily: 'var(--font-orbitron)', letterSpacing: '0.3em', color: '$goldGlint' }}>VS</VS>
                    <TeamName style={{ fontFamily: 'var(--font-rajdhani)', fontWeight: 950, fontSize: '22px' }}>{m.player_names?.slice(2, 4).join(' / ') || 'Premium Squad Beta'}</TeamName>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '24px', display: 'flex', justifyContent: 'center' }}>
                    <button style={{ color: '$gold', fontSize: '11px', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.4em', fontFamily: 'var(--font-rajdhani)' }}>Detailed Analytics View</button>
                  </div>
                </Card>
              ))
            )}
          </section>
        ) : (
          <section>
            <div style={{ padding: '0 12px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 950, color: '$goldGlint', letterSpacing: '0.5em', textTransform: 'uppercase', fontFamily: 'var(--font-rajdhani)' }}>Elite Standings</span>
            </div>
            {rankings.map((s, idx) => (
              <RankingItem key={idx} top={s.rank as any}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                  <RankNumber top={s.rank as any} style={{ fontFamily: 'var(--font-orbitron)' }}>{s.rank === 1 ? '👑' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank}</RankNumber>
                  <div>
                    <p style={{ fontSize: '18px', fontWeight: 950, color: '$white', letterSpacing: '-0.02em', fontFamily: 'var(--font-rajdhani)' }}>{s.name}</p>
                    <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 800, marginTop: '2px', fontFamily: 'var(--font-rajdhani)' }}>{s.wins}W - {s.losses}L • DIFF {s.ptsDiff > 0 ? `+${s.ptsDiff}` : s.ptsDiff}</p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '19px', fontWeight: 950, color: '$goldGlint', fontFamily: 'var(--font-orbitron)' }}>{s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0}%</p>
                  <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.15em', fontFamily: 'var(--font-rajdhani)' }}>Efficiency</p>
                </div>
              </RankingItem>
            ))}
          </section>
        )}
      </DataStateView>

      <footer style={{ marginTop: 'auto', padding: '60px 0', textAlign: 'center', opacity: 0.25 }}>
        <p style={{ fontSize: '11px', fontWeight: 950, letterSpacing: '0.5em', color: '$goldGlint', textTransform: 'uppercase' }}>TEYEON MATCH ENGINE PRO STABLE</p>
      </footer>
    </Container>
  );
}
