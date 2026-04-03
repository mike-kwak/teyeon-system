'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Match, Player, calculateRankings, calculateSettlements, Settlement } from '@/lib/kdk';
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
  paddingBottom: '250px',
});

const BalanceSection = styled('section', {
  textAlign: 'center',
  padding: '$10 0',
  marginBottom: '$10',
});

const BalanceLabel = styled('div', {
  fontSize: '11px',
  fontWeight: '$black',
  color: 'rgba(255, 255, 255, 0.3)',
  textTransform: 'uppercase',
  letterSpacing: '$mega',
  marginBottom: '$4',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$2',
});

const BalanceAmount = styled('div', {
  fontSize: '48px',
  fontWeight: '$black',
  letterSpacing: '$tight',
  color: '$white',
  lineHeight: '1',
  marginBottom: '$8',
});

const ButtonGroup = styled('div', {
  display: 'flex',
  gap: '$3',
});

const ActionButton = styled('button', {
  flex: 1,
  padding: '$4',
  borderRadius: '$2xl',
  fontSize: '13px',
  fontWeight: '$black',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',

  variants: {
    primary: {
      true: {
        background: '$gold',
        color: '$black',
        boxShadow: '$goldGlow',
        '&:hover': { transform: 'translateY(-2px) scale(1.02)' },
      },
      false: {
        background: 'rgba(255, 255, 255, 0.03)',
        color: 'rgba(255, 255, 255, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        '&:hover': { background: 'rgba(255, 255, 255, 0.05)', color: '$white' },
      },
    },
  },
});

const StatsCard = styled('section', {
  background: 'linear-gradient(135deg, $gray850, $black)',
  borderRadius: '$3xl',
  padding: '$7',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  boxShadow: '$glass',
  marginBottom: '$10',
});

const ProgressBar = styled('div', {
  height: '8px',
  width: '100%',
  background: 'rgba(255, 255, 255, 0.03)',
  borderRadius: '$full',
  overflow: 'hidden',
  display: 'flex',
  margin: '$6 0 $4',
});

const TransactionItem = styled('div', {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '$4 0',
  borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
  animation: `${fadeIn} 0.5s ease-out`,
  transition: 'all 0.3s ease',

  '&:hover': {
    paddingLeft: '$2',
    '& .title': { color: '$gold' },
  },
});

export default function FinancePage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balance] = useState({
    total: 825000,
    income: 1450000,
    expense: 625000
  });

  useEffect(() => {
    const savedMatches = localStorage.getItem('teyeon_matches');
    const savedPlayers = localStorage.getItem('teyeon_players');
    if (savedMatches && savedPlayers) {
      const matches: Match[] = JSON.parse(savedMatches);
      const players: Player[] = JSON.parse(savedPlayers);
      const rankings = calculateRankings(matches, players);
      const result = calculateSettlements(rankings);
      setSettlements(result);
    } else {
      setSettlements([
        { name: '곽민섭', amount: 30000, type: 'reward', note: '🏆 Season Champion' },
        { name: '가내현', amount: 15000, type: 'reward', note: '🥈 Runner Up' },
        { name: 'Guest 1', amount: -10000, type: 'penalty', note: '⚠️ Trial Penalty' },
      ]);
    }
  }, []);

  return (
    <Container>
      <header style={{ marginBottom: '40px' }}>
         <h1 style={{ fontSize: '32px', fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: '1', textAlign: 'center' }}>
           Financial <span style={{ color: '#D4AF37' }}>Elite</span>
         </h1>
      </header>

      <BalanceSection>
        <BalanceLabel>
          CURRENT LIQUIDITY <span style={{ width: '4px', height: '4px', background: '#D4AF37', borderRadius: '100px' }}></span>
        </BalanceLabel>
        <BalanceAmount>
          ₩{balance.total.toLocaleString()}
        </BalanceAmount>
        <ButtonGroup>
          <ActionButton primary={true}>Deposit Fund</ActionButton>
          <ActionButton primary={false}>Elite Transfer</ActionButton>
        </ButtonGroup>
      </BalanceSection>

      <StatsCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '10px', fontWeight: 900, color: 'rgba(255, 255, 255, 0.2)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Analytics</span>
          <span style={{ fontSize: '18px', fontWeight: 900, color: '#fff' }}>Income is <span style={{ color: '#D4AF37' }}>+42%</span> Higher</span>
        </div>
        <ProgressBar>
          <div style={{ height: '100%', background: '#D4AF37', width: '70%', boxShadow: '0 0 10px rgba(212, 175, 55, 0.3)' }}></div>
          <div style={{ height: '100%', background: 'rgba(255, 255, 255, 0.1)', width: '30%' }}></div>
        </ProgressBar>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.3)' }}>
          <span>Income 1.45M</span>
          <span>Expense 0.62M</span>
        </div>
      </StatsCard>

      <section>
        <h3 style={{ fontSize: '13px', fontWeight: 900, color: '#fff', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>History</h3>
        <div>
          {[
            { date: '03.24', title: 'Court Reservation (Elite Grass)', amount: -45000, type: 'out' },
            { date: '03.24', title: 'Monthly Membership (Gold Class)', amount: 150000, type: 'in' },
            { date: '03.22', title: 'Premium Ball Procurement', amount: -82000, type: 'out' },
            { date: '03.20', title: 'Corporate Sponsorship (Teyeon)', amount: 500000, type: 'in' },
          ].map((item, idx) => (
            <TransactionItem key={idx}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <span style={{ fontSize: '10px', fontWeight: 900, color: 'rgba(255, 255, 255, 0.1)' }}>{item.date}</span>
                <div>
                  <p className="title" style={{ fontSize: '14px', fontWeight: 900, color: '#fff', transition: 'color 0.3s' }}>{item.title}</p>
                  <p style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(255, 255, 255, 0.2)', textTransform: 'uppercase' }}>Elite Banking</p>
                </div>
              </div>
              <span style={{ fontSize: '16px', fontWeight: 900, color: item.type === 'in' ? '#D4AF37' : '#fff', opacity: item.type === 'in' ? 1 : 0.4 }}>
                {item.amount > 0 ? `+${item.amount.toLocaleString()}` : item.amount.toLocaleString()}
              </span>
            </TransactionItem>
          ))}
        </div>
      </section>

      <button style={{ 
        width: '100%', 
        marginTop: '32px',
        background: 'rgba(255, 255, 255, 0.02)', 
        border: '1px dashed rgba(255, 255, 255, 0.1)', 
        color: 'rgba(255, 255, 255, 0.3)', 
        padding: '20px', 
        borderRadius: '24px',
        fontSize: '11px',
        fontWeight: 900,
        textTransform: 'uppercase',
        letterSpacing: '0.2em'
      }}>
        Add Manual Transaction
      </button>

      <footer style={{ marginTop: 'auto', padding: '60px 0', textAlign: 'center', opacity: 0.15 }}>
        <p style={{ fontSize: '10px', fontWeight: 900, letterSpacing: '0.4em' }}>TEYEON FINANCIAL CORE</p>
      </footer>
    </Container>
  );
}
