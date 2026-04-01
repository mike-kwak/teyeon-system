'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';
import { supabase } from '@/lib/supabase';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(10px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
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
  flexDirection: 'column',
  marginBottom: '$8',
});

const Title = styled('h1', {
  fontSize: '$2xl',
  fontWeight: '$black',
  letterSpacing: '$tight',
  color: '$white',
  textTransform: 'uppercase',
  lineHeight: '1',
  marginBottom: '$1',
});

const Subtitle = styled('p', {
  fontSize: '9px',
  fontWeight: '$black',
  color: 'rgba(255,255,255,0.3)',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
});

const FilterStack = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$3',
  marginBottom: '$8',
});

const SearchInput = styled('div', {
  background: '$gray900',
  border: '1px solid $gray800',
  borderRadius: '$md',
  padding: '$3 $4',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  color: 'rgba(255,255,255,0.4)',
  fontSize: '$sm',
});

const TabRow = styled('div', {
  display: 'flex',
  gap: '$2',
  overflowX: 'auto',
  pb: '$2',
  '&::-webkit-scrollbar': { display: 'none' },
});

const TabItem = styled('button', {
  whiteSpace: 'nowrap',
  padding: '$1 $4',
  borderRadius: '$full',
  fontSize: '9px',
  fontWeight: '$black',
  letterSpacing: '$wide',
  textTransform: 'uppercase',
  border: '1px solid $gray800',
  background: '$gray900',
  color: '$gray500',

  variants: {
    active: {
      true: {
        background: '$gold',
        color: '$black',
        borderColor: '$gold',
      },
    },
  },
});

const MonthDivider = styled('div', {
  fontSize: '10px',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  margin: '$6 0 $4 $2',
  display: 'flex',
  alignItems: 'center',
  gap: '$4',

  '&::after': {
    content: '""',
    flex: 1,
    height: '1px',
    background: 'rgba(212,175,55,0.1)',
  },
});

const MatchCard = styled('div', {
  background: 'linear-gradient(135deg, $gray900, $black)',
  borderRadius: '$lg',
  padding: '$5',
  border: '1px solid rgba(255,255,255,0.03)',
  marginBottom: '$4',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  animation: `${fadeIn} 0.5s ease-out`,
  position: 'relative',

  '&:hover': {
    borderColor: 'rgba(255,255,255,0.1)',
    background: '$gray800',
  },
});

const DateBox = styled('div', {
  textAlign: 'center',
  minWidth: '40px',
});

const Day = styled('p', {
  fontSize: '$xl',
  fontWeight: '$black',
  lineHeight: '1',
  color: '$white',
});

const Month = styled('p', {
  fontSize: '8px',
  fontWeight: '$black',
  color: 'rgba(255,255,255,0.3)',
  textTransform: 'uppercase',
});

const MatchDetails = styled('div', {
  flex: 1,
  padding: '0 $6',
});

const Players = styled('p', {
  fontSize: '$base',
  fontWeight: '$black',
  color: '$white',
  marginBottom: '$1',
});

const TournamentName = styled('p', {
  fontSize: '9px',
  fontWeight: '$bold',
  color: 'rgba(255,255,255,0.3)',
  textTransform: 'uppercase',
});

const ScoreBox = styled('div', {
  textAlign: 'right',
});

const Score = styled('p', {
  fontSize: '$xl',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$wide',
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
    <Container>
      <Header>
        <Title>Match Archive</Title>
        <Subtitle>Surface: Hard Court | Season: 2026</Subtitle>
      </Header>

      <FilterStack>
        <SearchInput>
          <span>🔍</span>
          <span>Search by player or tournament...</span>
        </SearchInput>
        <TabRow>
          <TabItem active>All Matches</TabItem>
          <TabItem>Grand Slams</TabItem>
          <TabItem>ATP 1000</TabItem>
          <TabItem>Club Open</TabItem>
        </TabRow>
      </FilterStack>

      <section>
        <MonthDivider>April 2026</MonthDivider>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', opacity: 0.3 }}>
            <p style={{ fontWeight: 900 }}>Loading History...</p>
          </div>
        ) : matches.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', opacity: 0.2 }}>
            <div style={{ fontSize: '40px', marginBottom: '$4' }}>📂</div>
            <p style={{ fontWeight: 900 }}>No archived matches yet.</p>
          </div>
        ) : (
          matches.map((m, idx) => {
            const date = new Date(m.match_date || Date.now());
            const day = date.getDate().toString().padStart(2, '0');
            const month = date.toLocaleString('en-US', { month: 'short' });
            
            return (
              <MatchCard key={idx}>
                <DateBox>
                  <Day>{day}</Day>
                  <Month>{month}</Month>
                </DateBox>
                <MatchDetails>
                  <Players>{m.player_names?.join(' / ') || 'Tournament Match'}</Players>
                  <TournamentName>{m.session_title || 'TEYEON OPEN'}</TournamentName>
                </MatchDetails>
                <ScoreBox>
                  <Score>{m.score1} {m.score2}</Score>
                  <div style={{ display: 'flex', gap: '2px', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <div style={{ width: '4px', height: '4px', background: '$gold', borderRadius: '1px' }} />
                    <div style={{ width: '4px', height: '4px', background: '$gold', borderRadius: '1px' }} />
                    <div style={{ width: '4px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '1px' }} />
                  </div>
                </ScoreBox>
              </MatchCard>
            );
          })
        )}

        {/* Fallback mock data if no matches found in DB yet */}
        {!loading && matches.length === 0 && (
          <>
            <MonthDivider>March 2026</MonthDivider>
            <MatchCard>
              <DateBox>
                <Day>28</Day>
                <Month>Mar</Month>
              </DateBox>
              <MatchDetails>
                <Players>Kvak M.S / Marcus V.</Players>
                <TournamentName>Teyeon Spring Cup</TournamentName>
              </MatchDetails>
              <ScoreBox>
                <Score>6 3</Score>
              </ScoreBox>
            </MatchCard>
            <MatchCard>
              <DateBox>
                <Day>15</Day>
                <Month>Mar</Month>
              </DateBox>
              <MatchDetails>
                <Players>Carlos A. / Alex R.</Players>
                <TournamentName>Club Ranking Match</TournamentName>
              </MatchDetails>
              <ScoreBox>
                <Score>4 6</Score>
              </ScoreBox>
            </MatchCard>
          </>
        )}
      </section>

      <footer style={{ marginTop: 'auto', padding: '40px 0', textAlign: 'center', opacity: 0.1 }}>
        <p style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.3em' }}>TEYEON HISTORY ENGINE</p>
      </footer>
    </Container>
  );
}
