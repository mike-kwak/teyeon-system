'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(15px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const pulse = keyframes({
  '0%': { transform: 'scale(1)', opacity: 0.5 },
  '50%': { transform: 'scale(1.05)', opacity: 0.8 },
  '100%': { transform: 'scale(1)', opacity: 0.5 },
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

const AnalyzerSection = styled('div', {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$20 0',
});

const PulseCircle = styled('div', {
  width: '120px',
  height: '120px',
  borderRadius: '$full',
  border: '4px solid rgba(212, 175, 55, 0.1)',
  borderTop: '4px solid $gold',
  animation: `${pulse} 2s infinite ease-in-out`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '$10',
});

const HeroCard = styled('div', {
  background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.1), transparent)',
  border: '1px solid rgba(212, 175, 55, 0.2)',
  borderRadius: '$3xl',
  padding: '$8',
  textAlign: 'center',
  marginBottom: '$10',
  position: 'relative',
  overflow: 'hidden',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '2px',
    background: 'linear-gradient(90deg, transparent, $gold, transparent)',
  },
});

const PredictionCard = styled('div', {
  background: 'linear-gradient(135deg, $gray850, $black)',
  borderRadius: '$2xl',
  padding: '$6',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  boxShadow: '$glass',
  marginBottom: '$4',
  animation: `${fadeIn} 0.6s ease-out`,
  transition: 'all 0.4s ease',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.3)',
    transform: 'translateY(-2px)',
    boxShadow: '$goldGlow',
  },
});

const ProbabilityBar = styled('div', {
  height: '4px',
  width: '100%',
  background: 'rgba(255, 255, 255, 0.05)',
  borderRadius: '$full',
  overflow: 'hidden',
  margin: '$4 0',
});

export default function PredictionPage() {
  const [analyzing, setAnalyzing] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setAnalyzing(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  const predictions = [
    { name: '곽민섭', probability: 96, status: 'Elite Confirmed', reason: 'Recent 5 Match Win Streak' },
    { name: '가내현', probability: 82, status: 'High Probability', reason: 'Top-tier Point Differential' },
    { name: '강정호', probability: 68, status: 'Contender', reason: 'Stable Upper Bracket Performance' },
    { name: '김병식', probability: 45, status: 'Rising Star', reason: 'Recent Conditioning Recovery' },
  ];

  return (
    <Container>
      <header style={{ marginBottom: '40px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 900, color: '#fff', fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: '1' }}>
          AI <span style={{ color: '#D4AF37' }}>Oracle</span>
        </h1>
        <p style={{ fontSize: '10px', fontWeight: 900, color: '$gold', letterSpacing: '0.4em', textTransform: 'uppercase', marginTop: '8px', opacity: 0.6 }}>Predictive Neural Engine</p>
      </header>

      {analyzing ? (
        <AnalyzerSection>
          <PulseCircle>
             <span style={{ fontSize: '32px' }}>👁️‍🗨️</span>
          </PulseCircle>
          <h2 style={{ fontSize: '18px', fontWeight: 900, color: '#fff', fontStyle: 'italic', marginBottom: '8px' }}>Neural Processing...</h2>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: '1.6' }}>
            Analyzing member win rates and <br/>point differentials for the next circuit.
          </p>
        </AnalyzerSection>
      ) : (
        <section>
          <HeroCard>
            <p style={{ fontSize: '10px', fontWeight: 900, color: '#D4AF37', textTransform: 'uppercase', letterSpacing: '0.3em', marginBottom: '8px' }}>Upcoming Circuit</p>
            <h3 style={{ fontSize: '28px', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>Teyeon Open II</h3>
            <p style={{ fontSize: '9px', fontWeight: 800, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.4em', marginTop: '4px' }}>Estimated Seed Profile</p>
          </HeroCard>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {predictions.map((p, idx) => (
              <PredictionCard key={idx}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 900, color: 'rgba(255,255,255,0.1)', fontStyle: 'italic' }}>0{idx + 1}</span>
                    <h4 style={{ fontSize: '18px', fontWeight: 900, color: '#fff' }}>{p.name}</h4>
                  </div>
                  <span style={{ fontSize: '8px', fontWeight: 900, background: p.probability > 80 ? '#D4AF37' : 'rgba(255,255,255,0.05)', color: p.probability > 80 ? '#000' : 'rgba(255,255,255,0.4)', padding: '4px 10px', borderRadius: '100px', textTransform: 'uppercase' }}>
                    {p.status}
                  </span>
                </div>
                
                <ProbabilityBar>
                  <div style={{ height: '100%', background: '#D4AF37', width: `${p.probability}%`, boxShadow: '0 0 8px rgba(212,175,55,0.4)' }}></div>
                </ProbabilityBar>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.2)' }}>
                    <span style={{ color: '#D4AF37' }}>◈</span> {p.reason}
                  </p>
                  <span style={{ fontSize: '12px', fontWeight: 900, color: '#D4AF37' }}>{p.probability}%</span>
                </div>
              </PredictionCard>
            ))}
          </div>
        </section>
      )}

      <footer style={{ marginTop: 'auto', padding: '60px 0', textAlign: 'center', opacity: 0.15 }}>
        <p style={{ fontSize: '10px', fontWeight: 900, letterSpacing: '0.4em' }}>TEYEON AI CORE v1.4</p>
      </footer>
    </Container>
  );
}
