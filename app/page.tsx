'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { styled, keyframes } from '@/stitches.config';
import ProfileAvatar from '@/components/ProfileAvatar';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(15px)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const shimmer = keyframes({
  '0%': { backgroundPosition: '-200% 0' },
  '100%': { backgroundPosition: '200% 0' },
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
  position: 'relative',
  overflowX: 'hidden',
});

const Header = styled('header', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  marginBottom: '$10',
  width: '100%',
  padding: '$2 0',
});

const LogoWrapper = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$5',
  position: 'relative',
});

const LogoIcon = styled('div', {
  position: 'relative',
  width: '64px',
  height: '64px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const LogoBall = styled('div', {
  position: 'absolute',
  width: '32px',
  height: '32px',
  backgroundColor: '#E8E137',
  borderRadius: '$full',
  border: '2px solid black',
  transform: 'translateX(12px) translateY(-12px)',
  zIndex: 10,
  boxShadow: '4px 4px 12px rgba(0,0,0,0.5)',
});

const BrandName = styled('h1', {
  color: '$white',
  fontSize: '42px',
  fontWeight: '$black',
  letterSpacing: '$tight',
  textShadow: '0 8px 15px rgba(0,0,0,0.8)',
  lineHeight: '0.85',
});

const SubBrand = styled('div', {
  color: '$gold',
  fontSize: '11px',
  fontWeight: '$black',
  letterSpacing: '0.6em',
  textTransform: 'uppercase',
  fontStyle: 'italic',
  opacity: 0.9,
  marginTop: '$3',
  textAlign: 'center',
});

const ProfileSection = styled('section', {
  marginBottom: '$10',
  width: '100%',
});

const StyledProfileLink = styled(Link, {
  display: 'block',
  background: 'linear-gradient(135deg, $gray850, $black)',
  borderRadius: '$xl',
  padding: '$6',
  position: 'relative',
  overflow: 'hidden',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  borderGlow: 'rgba(212, 175, 55, 0.15)',
  boxShadow: '$glass',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.4)',
    transform: 'translateY(-4px) scale(1.02)',
    boxShadow: '$goldGlow',
  },
  
  '&:active': {
    transform: 'scale(0.98)',
  },
});

const KakaoButton = styled('button', {
  width: '100%',
  background: 'linear-gradient(135deg, $gray900, $black)',
  color: '$gold',
  borderRadius: '$xl',
  padding: '$6',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '$4',
  borderGlow: 'rgba(212, 175, 55, 0.3)',
  boxShadow: '$glass',
  transition: 'all 0.4s ease',
  position: 'relative',
  overflow: 'hidden',

  '&:hover': {
    background: 'linear-gradient(135deg, $gray800, $gray900)',
    borderColor: '$gold',
    boxShadow: '$goldGlow',
    transform: 'translateY(-2px)',
  },

  '&::after': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '-100%',
    width: '50%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.2), transparent)',
    animation: `${shimmer} 3s infinite`,
  }
});

const MenuGrid = styled('section', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$5',
  width: '100%',
  animation: `${fadeIn} 0.8s ease-out`,
});

const MenuItem = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '$6',
  borderRadius: '$xl',
  background: 'linear-gradient(135deg, $gray850, $gray950)',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  transition: 'all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1)',
  position: 'relative',
  overflow: 'hidden',
  boxShadow: '$glass',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.2), transparent)',
    opacity: 0,
    transition: 'opacity 0.4s',
  },

  '&:hover': {
    background: 'linear-gradient(135deg, $gray800, $gray900)',
    borderColor: 'rgba(212, 175, 55, 0.5)',
    boxShadow: '$goldGlow',
    transform: 'translateX(4px)',
    '&::before': { opacity: 1 },
    '& .icon-wrapper': {
      background: 'rgba(212, 175, 55, 0.2)',
      color: '$goldGlint',
      transform: 'scale(1.1) rotate(5deg)',
    },
  },

  '&:active': {
    transform: 'scale(0.97)',
  },

  variants: {
    comingSoon: {
      true: {
        opacity: 0.4,
        cursor: 'not-allowed',
        filter: 'grayscale(1)',
        '&:hover': {
          transform: 'none',
          borderColor: 'rgba(255,255,255,0.05)',
          boxShadow: 'none',
        },
      },
    },
  },
});

const ItemContent = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$5',
  zIndex: 1,
});

const IconWrapper = styled('div', {
  fontSize: '28px',
  width: '52px',
  height: '52px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$lg',
  background: 'rgba(212, 175, 55, 0.1)',
  color: '$gold',
  transition: 'all 0.4s ease',
  boxShadow: 'inset 0 0 10px rgba(212, 175, 55, 0.1)',
});

const ItemLabel = styled('span', {
  fontSize: '$lg',
  fontWeight: '$black',
  letterSpacing: '$wide',
  color: '$white',
  textTransform: 'uppercase',
  fontStyle: 'italic',
});

const Badge = styled('span', {
  fontSize: '9px',
  fontWeight: '$black',
  padding: '$1 $4',
  borderRadius: '$full',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  boxShadow: '0 4px 10px rgba(0,0,0,0.3)',

  variants: {
    type: {
      new: { background: '$gold', color: '$black' },
      soon: { background: '$gray700', color: '$gray400' },
      live: { background: '$error', color: '$white', animation: 'pulse 1.5s infinite' },
    },
  },
});

const Toast = styled('div', {
  position: 'fixed',
  bottom: '110px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: '$toast',
  width: '90vw',
  maxWidth: '420px',
  background: 'rgba(20, 20, 20, 0.95)',
  backdropFilter: 'blur(20px)',
  color: '$white',
  padding: '$5 $8',
  borderRadius: '$xl',
  fontWeight: '$black',
  fontSize: '$sm',
  textAlign: 'center',
  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(212,175,55,0.2)',
  borderTop: '2px solid $gold',
});

export default function Home() {
  const { user, role, signInWithKakao, signOut, isLoading, hasPermission, getRestrictionMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const menuItems = [
    { id: "notice", icon: "📢", label: "Club Notice", path: "/notice", feature: 'notice' },
    { id: "tournament", icon: "🏆", label: "Special Match", path: "/tournament", feature: 'kdk', badge: 'NEW' },
    { id: "kdk", icon: "⚡", label: "Match Generator", path: "/kdk", feature: 'kdk' },
    { id: "live_court", icon: "🎾", label: "Live Court", path: "/tournament", feature: 'scores', badge: 'LIVE' },
    { id: "archive", icon: "📂", label: "Match Archive", path: "/results", feature: 'scores' },
    { id: "profile", icon: "👤", label: "Member Profile", path: "/members", feature: 'profiles' },
    { id: "finance", icon: "💰", label: "Finance", path: "/finance", feature: 'finance', isComingSoon: true },
    { id: "ai_seed", icon: "🤖", label: "AI Prediction", path: "/prediction", feature: 'tournament', isComingSoon: true },
    { id: "admin", icon: "⚙️", label: "Settings", path: "/admin", feature: 'admin_settings' },
  ];

  const handleMenuClick = (e: React.MouseEvent, item: any) => {
    if (item.isComingSoon) {
      e.preventDefault();
      setToast("This feature is coming soon! Stay tuned. 🎾");
      return false;
    }

    const access = hasPermission(item.feature as any);
    if (access === 'HIDE') {
      e.preventDefault();
      setToast(getRestrictionMessage(item.feature));
      return false;
    }
    return true;
  };

  return (
    <Container>
      <Header>
        <LogoWrapper>
          <LogoIcon>
            <div style={{ position: 'absolute', width: '48px', height: '8px', background: '#E33529', borderRadius: '100px', transform: 'rotate(-45deg) translate(-8px, -10px)' }} />
            <div style={{ position: 'absolute', width: '48px', height: '8px', background: '#E33529', borderRadius: '100px', transform: 'rotate(-45deg) translate(-15px, 0px)' }} />
            <LogoBall />
          </LogoIcon>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '6px', justifyContent: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.5)' }}>EST.</span>
              <span style={{ fontSize: '11px', fontWeight: 900, color: '#D4AF37' }}>2025</span>
            </div>
            <BrandName>TEYEON</BrandName>
            <SubBrand>Elite Circuit</SubBrand>
          </div>
        </LogoWrapper>
      </Header>

      <ProfileSection>
        {!user ? (
          <KakaoButton onClick={() => signInWithKakao()}>
            <span style={{ fontSize: '24px' }}>💬</span>
            <span style={{ fontWeight: 900, letterSpacing: '0.1em' }}>KAKAOTALK LOGIN ELITE</span>
          </KakaoButton>
        ) : (
          <StyledProfileLink href="/profile">
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <ProfileAvatar 
                src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
                alt={user.user_metadata?.full_name || "Profile"} 
                size={64}
                className="rounded-full shadow-[0_0_25px_rgba(212,175,55,0.3)] border-2 border-gold"
                fallbackIcon={role === 'CEO' ? '👑' : '👤'}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <Badge type="new">{role === 'CEO' ? 'Premium CEO' : 'Gold Member'}</Badge>
                  <div style={{ width: '8px', height: '8px', background: '#4CAF50', borderRadius: '50%', boxShadow: '0 0 10px #4CAF50' }} />
                </div>
                <h2 style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '-0.02em' }}>{user.user_metadata?.nickname || user.user_metadata?.full_name || "MEMBER"}</h2>
                <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '4px', fontStyle: 'italic' }}>Precision. Power. Prestige. 🎾</p>
              </div>
            </div>
            <div style={{ position: 'absolute', right: '20px', bottom: '20px', fontSize: '24px', opacity: 0.2 }}>→</div>
          </StyledProfileLink>
        )}
      </ProfileSection>

      <MenuGrid>
        <div style={{ padding: '0 12px', marginBottom: '-10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 900, color: '#D4AF37', letterSpacing: '0.4em', textTransform: 'uppercase', opacity: 0.6 }}>Executive Suite</span>
        </div>
        {menuItems.map((item) => {
          const access = hasPermission(item.feature as any);
          const isRestricted = access === 'HIDE';
          return (
            <MenuItem 
              key={item.id} 
              href={item.path} 
              onClick={(e) => handleMenuClick(e, item)}
              comingSoon={item.isComingSoon}
            >
              <ItemContent>
                <IconWrapper className="icon-wrapper">{item.icon}</IconWrapper>
                <ItemLabel>{item.label}</ItemLabel>
              </ItemContent>
              {item.badge && (
                <Badge type={item.badge === 'LIVE' ? 'live' : 'new'}>{item.badge}</Badge>
              )}
              {item.isComingSoon && <Badge type="soon">Soon</Badge>}
              
              <div style={{ position: 'absolute', right: '-20px', bottom: '-20px', fontSize: '72px', opacity: 0.03, transform: 'rotate(-15deg)', pointerEvents: 'none' }}>{item.icon}</div>
            </MenuItem>
          );
        })}
      </MenuGrid>

      {toast && <Toast>{toast}</Toast>}

      <footer style={{ marginTop: 'auto', padding: '60px 0', textAlign: 'center', opacity: 0.2 }}>
        <div style={{ height: '1px', width: '60px', background: 'rgba(212,175,55,0.3)', margin: '0 auto 20px' }} />
        <p style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.4em', color: '$gold' }}>TEYEON CLUB SYSTEM</p>
        <p style={{ fontSize: '9px', marginTop: '6px', letterSpacing: '0.2em' }}>V4.1 FINAL STABLE • DESIGNED BY ANTIGRAVITY</p>
      </footer>
    </Container>
  );
}
