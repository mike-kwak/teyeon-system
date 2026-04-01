'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';
import { supabase } from '@/lib/supabase';
import { Match, Player, calculateRankings, PlayerStats } from '@/lib/kdk';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(10px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const glow = keyframes({
  '0%': { boxShadow: '0 0 5px $gold' },
  '50%': { boxShadow: '0 0 20px $gold' },
  '100%': { boxShadow: '0 0 5px $gold' },
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
  marginBottom: '$6',
});

const Title = styled('h1', {
  fontSize: '$xl',
  fontWeight: '$black',
  letterSpacing: '$tight',
  textTransform: 'uppercase',
  fontStyle: 'italic',
  color: '$white',
});

const TabContainer = styled('div', {
  display: 'flex',
  background: '$gray900',
  padding: '$1',
  borderRadius: '$lg',
  marginBottom: '$8',
  border: '1px solid $gray800',
});

const TabButton = styled('button', {
  flex: 1,
  padding: '$3',
  fontSize: '$sm',
  fontWeight: '$black',
  borderRadius: '$md',
  transition: 'all 0.3s ease',
  color: '$gray400',

  variants: {
    active: {
      true: {
        background: '$gold',
        color: '$black',
        boxShadow: '$gold',
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
  background: 'linear-gradient(135deg, $gray800, $black)',
  borderRadius: '$xl',
  padding: '$6',
  border: '1px solid rgba(255,255,255,0.05)',
  marginBottom: '$4',
  position: 'relative',
  overflow: 'hidden',
  boxShadow: 'inset 0 0 20px rgba(255,255,255,0.02), $lg',
  animation: `${fadeIn} 0.5s ease-out`,

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.3), transparent)',
  },

  variants: {
    highlight: {
      gold: {
        borderColor: '$gold',
        animation: `${glow} 2s infinite ease-in-out`,
      },
    },
  },
});

const MatchInfo = styled('div', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '$4',
});

const CourtBadge = styled('span', {
  fontSize: '$xs',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  background: 'rgba(212,175,55,0.1)',
  padding: '$1 $3',
  borderRadius: '$full',
});

const LiveStatus = styled('span', {
  fontSize: '9px',
  fontWeight: '$black',
  color: '$error',
  display: 'flex',
  alignItems: 'center',
  gap: '$1',
  textTransform: 'uppercase',

  '&::before': {
    content: '""',
    width: '6px',
    height: '6px',
    background: '$error',
    borderRadius: '50%',
    boxShadow: '0 0 10px $error',
  },
});

const TeamName = styled('p', {
  fontSize: '$lg',
  fontWeight: '$black',
  textAlign: 'center',
  color: '$white',
  margin: '$2 0',
});

const VS = styled('div', {
  fontSize: '$xs',
  fontWeight: '$black',
  fontStyle: 'italic',
  color: '$gray500',
  letterSpacing: '$mega',
  margin: '$2 0',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',

  '&::before, &::after': {
    content: '""',
    flex: 1,
    height: '1px',
    background: 'rgba(255,255,255,0.05)',
  },
});

const RankingItem = styled('div', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '$4',
  background: '$gray900',
  borderRadius: '$lg',
  border: '1px solid $gray800',
  marginBottom: '$3',
  transition: 'all 0.3s ease',

  '&:hover': {
    borderColor: '$gold',
    background: '$gray800',
  },

  variants: {
    top: {
      1: { borderColor: '$gold', background: 'rgba(212,175,55,0.05)' },
      2: { borderColor: 'rgba(255,255,255,0.2)' },
      3: { borderColor: 'rgba(255,255,255,0.1)' },
    },
  },
});

const RankNumber = styled('div', {
  width: '36px',
  height: '36px',
  borderRadius: '$full',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '$lg',
  fontWeight: '$black',
  background: 'rgba(255,255,255,0.05)',
  color: '$gray400',

  variants: {
    top: {
      1: { background: '$gold', color: '$black', boxShadow: '$gold' },
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

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      // 1. Matches from Supabase
      const { data: liveMatches } = await supabase
        .from('matches')
        .select('*')
        .eq('status', 'playing')
        .order('court', { ascending: true });
      
      setMatches(liveMatches || []);

      // 2. Rankings from LocalStorage (Fallback as seen in existing RankingPage)
      const savedMatches = localStorage.getItem('teyeon_matches');
      const savedPlayers = localStorage.getItem('teyeon_players');
      
      if (savedMatches && savedPlayers) {
        const m: Match[] = JSON.parse(savedMatches);
        const p: Player[] = JSON.parse(savedPlayers);
        setRankings(calculateRankings(m, p));
      } else {
        // Mock data for demo
        setRankings([
          { name: '곽민섭', wins: 55, losses: 12, ptsDiff: 142, matches: 67, rank: 1, isGuest: false },
          { name: 'Marcus Vance', wins: 42, losses: 18, ptsDiff: 120, matches: 60, rank: 2, isGuest: false },
          { name: 'Carlos Alcaraz', wins: 38, losses: 22, ptsDiff: 98, matches: 60, rank: 3, isGuest: false },
          { name: 'Alex Rivera', wins: 35, losses: 25, ptsDiff: 85, matches: 60, rank: 4, isGuest: false },
          { name: 'Jannik Sinner', wins: 30, losses: 30, ptsDiff: 70, matches: 60, rank: 5, isGuest: false },
        ]);
      }
    } catch (err) {
      console.error("Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container>
      <Header>
        <Title>Live <span style={{ color: '#D4AF37' }}>Court</span></Title>
        <LiveStatus />
      </Header>

      <TabContainer>
        <TabButton active={activeTab === 'matches'} onClick={() => setActiveTab('matches')}>대진표</TabButton>
        <TabButton active={activeTab === 'ranking'} onClick={() => setActiveTab('ranking')}>실시간 랭킹</TabButton>
      </TabContainer>

      {activeTab === 'matches' ? (
        <section>
          {matches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', opacity: 0.3 }}>
              <div style={{ fontSize: '48px', marginBottom: '$4' }}>🏟️</div>
              <p style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em' }}>No Active Matches</p>
            </div>
          ) : (
            matches.map((m, idx) => (
              <Card key={idx}>
                <MatchInfo>
                  <CourtBadge>Court {(m.court || idx + 1).toString().padStart(2, '0')}</CourtBadge>
                  <div style={{ display: 'flex', gap: '$2' }}>
                     <span style={{ fontSize: '10px', fontWeight: 900, color: '$gold' }}>Live Update</span>
                     <div style={{ width: '6px', height: '6px', background: '$error', borderRadius: '50%', animation: 'pulse 1s infinite' }} />
                  </div>
                </MatchInfo>
                <div style={{ padding: '$4 0' }}>
                  <TeamName>{m.player_names?.slice(0, 2).join(' / ') || 'Team Alpha'}</TeamName>
                  <VS>SCORE 0 - 0</VS>
                  <TeamName>{m.player_names?.slice(2, 4).join(' / ') || 'Team Beta'}</TeamName>
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '$4', display: 'flex', justifyContent: 'center' }}>
                  <button style={{ color: '$gold', fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em' }}>View Match Insights</button>
                </div>
              </Card>
            ))
          )}
        </section>
      ) : (
        <section>
          <div style={{ padding: '0 8px', marginBottom: '$4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', fontWeight: 900, color: '$gold', letterSpacing: '0.3em', textTransform: 'uppercase' }}>Top Performers</span>
            <span style={{ fontSize: '9px', fontWeight: 900, color: 'rgba(255,255,255,0.3)' }}>Real-time Sync</span>
          </div>
          {rankings.map((s, idx) => (
            <RankingItem key={idx} top={s.rank as any}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <RankNumber top={s.rank as any}>{s.rank === 1 ? '👑' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank}</RankNumber>
                <div>
                  <p style={{ fontSize: '$base', fontWeight: '$black', color: '$white' }}>{s.name}</p>
                  <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: '$bold' }}>{s.wins}W - {s.losses}L • Diff {s.ptsDiff > 0 ? `+${s.ptsDiff}` : s.ptsDiff}</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '$sm', fontWeight: '$black', color: '$gold' }}>{s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0}%</p>
                <p style={{ fontSize: '8px', color: 'rgba(255,255,255,0.3)', fontWeight: '$black', textTransform: 'uppercase' }}>Win Rate</p>
              </div>
            </RankingItem>
          ))}
        </section>
      )}

      <footer style={{ marginTop: '40px', textAlign: 'center', opacity: 0.1 }}>
        <p style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.3em' }}>TEYEON MATCH ENGINE</p>
      </footer>
    </Container>
  );
}
