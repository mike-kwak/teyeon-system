'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { styled, keyframes } from '@/stitches.config';
import ProfileAvatar from '@/components/ProfileAvatar';

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
  position: 'relative',
});

const Header = styled('header', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  marginBottom: '$8',
  width: '100%',
  padding: '$2 0',
});

const LogoWrapper = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
  position: 'relative',
});

const LogoIcon = styled('div', {
  position: 'relative',
  width: '56px',
  height: '56px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const LogoBall = styled('div', {
  position: 'absolute',
  width: '28px',
  height: '28px',
  backgroundColor: '#E8E137',
  borderRadius: '$full',
  border: '1.5px solid black',
  transform: 'translateX(10px) translateY(-10px)',
  zIndex: 10,
  boxShadow: '2px 2px 8px rgba(0,0,0,0.4)',
});

const LogoText = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  lineHeight: '0.9',
});

const BrandName = styled('h1', {
  color: '$white',
  fontSize: '38px',
  fontWeight: '$black',
  letterSpacing: '$tight',
  textShadow: '0 4px 10px rgba(0,0,0,0.5)',
});

const SubBrand = styled('div', {
  color: '$white',
  fontSize: '$xs',
  fontWeight: '$black',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  fontStyle: 'italic',
  opacity: 0.9,
  marginTop: '$2',
});

const ProfileCard = styled('section', {
  marginBottom: '$8',
  width: '100%',
});

const StyledProfileLink = styled(Link, {
  display: 'block',
  background: 'linear-gradient(135deg, $gray800, $black)',
  borderRadius: '$xl',
  padding: '$4 $6',
  border: '1px solid rgba(255,255,255,0.05)',
  position: 'relative',
  overflow: 'hidden',
  transition: 'all 0.3s ease',
  boxShadow: '$lg',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.3)',
    transform: 'translateY(-2px)',
  },
  
  '&:active': {
    transform: 'scale(0.98)',
  },
});

const MenuGrid = styled('section', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$4',
  width: '100%',
  animation: `${fadeIn} 0.7s ease-out`,
});

const MenuItem = styled(Link, {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '$5 $6',
  borderRadius: '$lg',
  background: '$gray900',
  border: '1px solid $gray800',
  transition: 'all 0.3s ease',
  position: 'relative',
  overflow: 'hidden',

  '&:hover': {
    background: '$gray800',
    borderColor: '$gold',
    boxShadow: '$gold',
    '& .icon-bg': {
      opacity: 0.2,
      transform: 'scale(1.2) rotate(10deg)',
    },
  },

  '&:active': {
    transform: 'scale(0.97)',
  },

  variants: {
    comingSoon: {
      true: {
        opacity: 0.5,
        cursor: 'not-allowed',
        '&:hover': {
          borderColor: '$gray800',
          boxShadow: 'none',
        },
      },
    },
    restricted: {
      true: {
        opacity: 0.3,
        cursor: 'not-allowed',
      },
    },
  },
});

const ItemContent = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$4',
  zIndex: 1,
});

const ItemIcon = styled('div', {
  fontSize: '24px',
  width: '44px',
  height: '44px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$md',
  background: 'rgba(212, 175, 55, 0.1)',
  color: '$gold',
});

const ItemLabel = styled('span', {
  fontSize: '$base',
  fontWeight: '$bold',
  letterSpacing: '$wide',
  color: '$white',
});

const Badge = styled('span', {
  fontSize: '9px',
  fontWeight: '$black',
  padding: '$1 $3',
  borderRadius: '$full',
  textTransform: 'uppercase',
  letterSpacing: '$wider',

  variants: {
    type: {
      new: { background: '$gold', color: '$black' },
      soon: { background: '$gray500', color: '$white' },
      live: { background: '$error', color: '$white', animation: 'pulse 2s infinite' },
    },
  },
});

const Toast = styled('div', {
  position: 'fixed',
  bottom: '100px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: '$toast',
  width: '85vw',
  maxWidth: '400px',
  background: 'linear-gradient(to right, $error, #FF6347)',
  color: '$white',
  padding: '$4 $6',
  borderRadius: '$full',
  fontWeight: '$black',
  fontSize: '$sm',
  textAlign: 'center',
  boxShadow: '0 10px 30px rgba(255, 69, 0, 0.3)',
  border: '2px solid rgba(255,255,255,0.2)',
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
            <div style={{ position: 'absolute', width: '42px', height: '7px', background: '#E33529', borderRadius: '100px', transform: 'rotate(-45deg) translate(-6px, -8px)' }} />
            <div style={{ position: 'absolute', width: '42px', height: '7px', background: '#E33529', borderRadius: '100px', transform: 'rotate(-45deg) translate(-12px, 0px)' }} />
            <LogoBall />
          </LogoIcon>
          <LogoText>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', fontWeight: 900, letterSpacing: '0.2em' }}>SINCE</span>
              <span style={{ fontSize: '10px', fontWeight: 900, color: '#D4AF37' }}>2025</span>
            </div>
            <BrandName>TEYEON</BrandName>
            <SubBrand>Tennis Club</SubBrand>
          </LogoText>
        </LogoWrapper>
      </Header>

      <ProfileCard>
        {!user ? (
          <MenuItem as="button" onClick={() => signInWithKakao()} style={{ width: '100%', background: '#FEE500', color: '#3c1e1e', border: 'none' }}>
            <ItemContent>
              <ItemIcon style={{ background: 'rgba(0,0,0,0.05)', color: '#3c1e1e' }}>💬</ItemIcon>
              <ItemLabel style={{ color: '#3c1e1e' }}>카카오로 3초 로그인</ItemLabel>
            </ItemContent>
          </MenuItem>
        ) : (
          <StyledProfileLink href="/profile">
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <ProfileAvatar 
                src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
                alt={user.user_metadata?.full_name || "Profile"} 
                size={56}
                fallbackIcon={role === 'CEO' ? '👑' : '👤'}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <Badge type="new">{role === 'CEO' ? 'Premium CEO' : 'Member'}</Badge>
                  <div style={{ width: '6px', height: '6px', background: '#4CAF50', borderRadius: '50%' }} />
                </div>
                <h2 style={{ fontSize: '18px', fontWeight: 900 }}>{user.user_metadata?.nickname || user.user_metadata?.full_name}</h2>
                <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>Welcome to the Elite Circle 🎾</p>
              </div>
            </div>
          </StyledProfileLink>
        )}
      </ProfileCard>

      <MenuGrid>
        <div style={{ padding: '0 8px', marginBottom: '-8px' }}>
          <span style={{ fontSize: '10px', fontWeight: 900, color: '$gold', letterSpacing: '0.3em', textTransform: 'uppercase' }}>Main Features</span>
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
              restricted={isRestricted}
            >
              <ItemContent>
                <ItemIcon>{item.icon}</ItemIcon>
                <ItemLabel>{item.label}</ItemLabel>
              </ItemContent>
              {item.badge && (
                <Badge type={item.badge === 'LIVE' ? 'live' : 'new'}>{item.badge}</Badge>
              )}
              {item.isComingSoon && <Badge type="soon">Soon</Badge>}
              <div className="icon-bg" style={{ position: 'absolute', right: '-10px', bottom: '-10px', fontSize: '60px', opacity: 0.05, filter: 'grayscale(1)', pointerEvents: 'none', transition: 'all 0.5s ease' }}>{item.icon}</div>
            </MenuItem>
          );
        })}
      </MenuGrid>

      {toast && <Toast>{toast}</Toast>}

      <footer style={{ marginTop: 'auto', padding: '40px 0', textAlign: 'center', opacity: 0.2 }}>
        <p style={{ fontSize: '10px', fontWeight: 900, letterSpacing: '0.2em' }}>TEYEON CLUB MANAGEMENT</p>
        <p style={{ fontSize: '8px', marginTop: '4px' }}>PREMIUM EXPERIENCE v4.0 STITCHES ED.</p>
      </footer>
    </Container>
  );
}
