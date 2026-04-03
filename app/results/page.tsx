'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';
import { supabase } from '@/lib/supabase';

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

const Header = styled('header', {
  display: 'flex',
  flexDirection: 'column',
  marginBottom: '$10',
});

const Title = styled('h1', {
  fontSize: '32px',
  fontWeight: '$black',
  letterSpacing: '$tight',
  color: '$white',
  textTransform: 'uppercase',
  lineHeight: '0.9',
  marginBottom: '$2',
  fontStyle: 'italic',
});

const Subtitle = styled('p', {
  fontSize: '10px',
  fontWeight: '$black',
  color: 'rgba(212, 175, 55, 0.4)',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
});

const FilterStack = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$5',
  marginBottom: '$10',
});

const SearchInput = styled('div', {
  background: 'linear-gradient(135deg, $gray900, $black)',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  borderRadius: '$xl',
  padding: '$5 $6',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
  color: 'rgba(255, 255, 255, 0.3)',
  fontSize: '$sm',
  boxShadow: '$glass',
});

const TabRow = styled('div', {
  display: 'flex',
  gap: '$3',
  overflowX: 'auto',
  pb: '$4',
  '&::-webkit-scrollbar': { display: 'none' },
});

const TabItem = styled('button', {
  whiteSpace: 'nowrap',
  padding: '$2 $6',
  borderRadius: '$full',
  fontSize: '9px',
  fontWeight: '$black',
  letterSpacing: '$wider',
  textTransform: 'uppercase',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  background: 'rgba(255, 255, 255, 0.03)',
  color: 'rgba(255, 255, 255, 0.3)',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',

  variants: {
    active: {
      true: {
        background: '$gold',
        color: '$black',
        borderColor: '$gold',
        boxShadow: '$goldGlow',
        transform: 'scale(1.05)',
      },
    },
  },
});

const MonthDivider = styled('div', {
  fontSize: '11px',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  margin: '$8 0 $4 $2',
  display: 'flex',
  alignItems: 'center',
  gap: '$5',
  opacity: 0.8,

  '&::after': {
    content: '""',
    flex: 1,
    height: '1px',
    background: 'linear-gradient(90deg, rgba(212, 175, 55, 0.2), transparent)',
  },
});

const MatchCard = styled('div', {
  background: 'linear-gradient(135deg, $gray850, $black)',
  borderRadius: '$xl',
  padding: '$6',
  borderGlow: 'rgba(255, 255, 255, 0.02)',
  marginBottom: '$5',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  animation: `${fadeIn} 0.6s cubic-bezier(0.165, 0.84, 0.44, 1)`,
  position: 'relative',
  boxShadow: '$glass',
  transition: 'all 0.4s ease',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.3)',
    background: 'linear-gradient(135deg, $gray800, $black)',
    transform: 'translateX(4px)',
    boxShadow: '$goldGlow',
  },
});

const DateBox = styled('div', {
  textAlign: 'center',
  minWidth: '50px',
  borderRight: '1px solid rgba(255, 255, 255, 0.05)',
  paddingRight: '$4',
});

const Day = styled('p', {
  fontSize: '24px',
  fontWeight: '$black',
  lineHeight: '1',
  color: '$white',
});

const Month = styled('p', {
  fontSize: '9px',
  fontWeight: '$black',
  color: '$gold',
  textTransform: 'uppercase',
  marginTop: '$1',
});

const MatchDetails = styled('div', {
  flex: 1,
  padding: '0 $6',
});

const Players = styled('p', {
  fontSize: '16px',
  fontWeight: '$black',
  color: '$white',
  marginBottom: '$1',
  letterSpacing: '$tight',
});

const TournamentName = styled('p', {
  fontSize: '9px',
  fontWeight: '$bold',
  color: 'rgba(255, 255, 255, 0.3)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
});

const ScoreBox = styled('div', {
  textAlign: 'right',
});

const Score = styled('p', {
  fontSize: '22px',
  fontWeight: '$black',
  color: '$white',
  letterSpacing: '$tight',

  variants: {
    won: {
      true: { color: '$gold', textShadow: '0 0 10px rgba(212, 175, 55, 0.3)' },
    },
  },
});

export default function ArchivePage() {
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchArchive();
  }, []);

  async function fetchArchive() {
    try {
      const { data, error } = await supabase
        .from('matches_archive')
        .select('*')
        .order('match_date', { ascending: false });
      
      if (error) throw error;
      setMatches(data || []);
    } catch (err) {
      console.error("Archive Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container style={{ paddingBottom: '250px' }}>
      <Header>
        <Title style={{ fontFamily: 'var(--font-orbitron)', fontSize: '28px', fontWeight: 950 }}>The <span style={{ color: '$goldGlint' }}>Archive</span></Title>
        <Subtitle>Surface: Elite Grass | Legacy 2026</Subtitle>
      </Header>

      <FilterStack>
        <SearchInput style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '14px' }}>
          <span style={{ fontSize: '18px' }}>🔍</span>
          <span style={{ opacity: 0.5 }}>Search championship records...</span>
        </SearchInput>
        <TabRow>
          <TabItem active style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>All Matches</TabItem>
          <TabItem style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>Championships</TabItem>
          <TabItem style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>Executive Series</TabItem>
          <TabItem style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>Open Trials</TabItem>
        </TabRow>
      </FilterStack>

      <section>
        <MonthDivider style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '12px' }}>Current Session: April 2026</MonthDivider>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.5 }}>
            <p style={{ fontWeight: 950, letterSpacing: '0.5em', fontSize: '12px', fontFamily: 'var(--font-rajdhani)' }}>SYNCHRONIZING RECORDS...</p>
          </div>
        ) : matches.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.3 }}>
            <div style={{ fontSize: '64px', marginBottom: '24px', filter: 'drop-shadow(0 0 10px $goldGlint)' }}>🏺</div>
            <p style={{ fontWeight: 950, letterSpacing: '0.4em', fontSize: '12px', fontFamily: 'var(--font-rajdhani)' }}>NO ARCHIVED MATCHES DETECTED</p>
          </div>
        ) : (
          matches.map((m, idx) => {
            const date = new Date(m.match_date || Date.now());
            const day = date.getDate().toString().padStart(2, '0');
            const month = date.toLocaleString('en-US', { month: 'short' });
            
            return (
              <MatchCard key={idx}>
                <DateBox>
                  <Day style={{ fontFamily: 'var(--font-orbitron)' }}>{day}</Day>
                  <Month style={{ fontFamily: 'var(--font-rajdhani)' }}>{month}</Month>
                </DateBox>
                <MatchDetails>
                  <Players style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '18px', fontWeight: 950 }}>{m.player_names?.join(' / ') || 'Tournament Match'}</Players>
                  <TournamentName>{m.session_title || 'TEYEON OPEN ELITE'}</TournamentName>
                </MatchDetails>
                <ScoreBox>
                  <Score won={true} style={{ fontFamily: 'var(--font-orbitron)' }}>{m.score1} {m.score2}</Score>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <div style={{ width: '4px', height: '4px', background: '$goldGlint', borderRadius: '100px' }} />
                    <div style={{ width: '4px', height: '4px', background: '$goldGlint', borderRadius: '100px' }} />
                    <div style={{ width: '4px', height: '4px', background: 'rgba(255,255,255,0.15)', borderRadius: '100px' }} />
                  </div>
                </ScoreBox>
              </MatchCard>
            );
          })
        )}

        {!loading && matches.length === 0 && (
          <>
            <MonthDivider style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '12px' }}>Legacy: March 2026</MonthDivider>
            <MatchCard>
              <DateBox>
                <Day style={{ fontFamily: 'var(--font-orbitron)' }}>28</Day>
                <Month style={{ fontFamily: 'var(--font-rajdhani)' }}>Mar</Month>
              </DateBox>
              <MatchDetails>
                <Players style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '18px', fontWeight: 950 }}>Kwak M.S / Marcus V.</Players>
                <TournamentName>Teyeon Spring Championship</TournamentName>
              </MatchDetails>
              <ScoreBox>
                <Score won={true} style={{ fontFamily: 'var(--font-orbitron)' }}>6 3</Score>
              </ScoreBox>
            </MatchCard>
            <MatchCard>
              <DateBox>
                <Day style={{ fontFamily: 'var(--font-orbitron)' }}>15</Day>
                <Month style={{ fontFamily: 'var(--font-rajdhani)' }}>Mar</Month>
              </DateBox>
              <MatchDetails>
                <Players style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '18px', fontWeight: 950 }}>Carlos A. / Alex R.</Players>
                <TournamentName>Club Ranking Invitational</TournamentName>
              </MatchDetails>
              <ScoreBox>
                <Score style={{ fontFamily: 'var(--font-orbitron)' }}>4 6</Score>
              </ScoreBox>
            </MatchCard>
          </>
        )}
      </section>

      <footer style={{ marginTop: 'auto', padding: '60px 0', textAlign: 'center', opacity: 0.25 }}>
        <p style={{ fontSize: '11px', fontWeight: 950, letterSpacing: '0.5em', color: '$goldGlint', textTransform: 'uppercase' }}>TEYEON HISTORY ANALYTICS STABLE</p>
      </footer>
    </Container>
  );
}
