'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { styled, keyframes } from '@/stitches.config';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import { supabase } from '@/lib/supabase';
import { calculateKdkArchiveStats, KdkArchiveRow, KdkArchiveStats } from '@/lib/kdkArchiveStats';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'scale(0.95) translateY(10px)' },
  to: { opacity: 1, transform: 'scale(1) translateY(0)' },
});

const Container = styled('main', {
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100dvh',
  padding: '$8 $5',
  maxWidth: '500px',
  margin: '0 auto',
  width: '100%',
  backgroundColor: '$bgCharcoal',
  paddingBottom: '250px',
});

const Header = styled('header', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '$10',
});

const ProfileHero = styled('section', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  marginBottom: '$12',
  animation: `${fadeIn} 0.6s cubic-bezier(0.165, 0.84, 0.44, 1)`,
  padding: '$8',
  background: 'linear-gradient(180deg, rgba(212, 175, 55, 0.05) 0%, transparent 100%)',
  borderRadius: '$2xl',
  borderGlow: 'rgba(212, 175, 55, 0.1)',
  boxShadow: '$glass',
});

const AvatarWrapper = styled('div', {
  position: 'relative',
  padding: '$1',
  background: 'linear-gradient(135deg, $gold, $goldGlint)',
  borderRadius: '$full',
  marginBottom: '$6',
  boxShadow: '$goldGlow',
});

const UserBadge = styled('div', {
  position: 'absolute',
  bottom: '-12px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '$gold',
  color: '$black',
  fontSize: '9px',
  fontWeight: '$black',
  padding: '$1.5 $5',
  borderRadius: '$full',
  textTransform: 'uppercase',
  letterSpacing: '$wider',
  boxShadow: '0 8px 16px rgba(0,0,0,0.5)',
  whiteSpace: 'nowrap',
});

const StatsGrid = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '$4',
  width: '100%',
  marginBottom: '$10',
});

const StatCard = styled('div', {
  background: 'linear-gradient(135deg, $cardCharcoal, $bgCharcoal)',
  padding: '$6 $2',
  borderRadius: '$xl',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  textAlign: 'center',
  transition: 'all 0.4s ease',
  boxShadow: '$glass',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.3)',
    transform: 'translateY(-4px)',
    boxShadow: '$goldGlow',
  },
});

const StatValue = styled('div', {
  fontSize: '22px',
  fontWeight: '$black',
  color: '$white',
  marginBottom: '$2',
  letterSpacing: '$tight',

  variants: {
    highlight: {
      true: { color: '$gold', textShadow: '0 0 10px rgba(212,175,55,0.3)' },
    },
  },
});

const StatLabel = styled('div', {
  fontSize: '8px',
  fontWeight: '$black',
  color: 'rgba(255,255,255,0.3)',
  textTransform: 'uppercase',
  letterSpacing: '$mega',
});

const FilterContainer = styled('div', {
  display: 'flex',
  padding: '$1',
  borderRadius: '$xl',
  marginBottom: '$8',
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  boxShadow: '$glass',
  width: '100%',
});

const FilterButton = styled('button', {
  flex: 1,
  padding: '$3',
  fontSize: '9px',
  fontWeight: '$black',
  borderRadius: '$lg',
  transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  color: 'rgba(255, 255, 255, 0.3)',
  textTransform: 'uppercase',
  letterSpacing: '$wider',

  variants: {
    active: {
      true: {
        background: '$gray700',
        color: '$gold',
        border: '1px solid rgba(212,175,55,0.2)',
        boxShadow: '$md',
      },
    },
  },
});

const SectionTitle = styled('h3', {
  fontSize: '10px',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  marginBottom: '$5',
  paddingLeft: '$2',
  opacity: 0.8,
});

const MatchRecord = styled('div', {
  background: 'linear-gradient(90deg, $cardCharcoal, $bgCharcoal)',
  padding: '$5 $7',
  borderRadius: '$xl',
  borderGlow: 'rgba(255, 255, 255, 0.02)',
  marginBottom: '$4',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  boxShadow: '$glass',
  transition: 'all 0.4s ease',

  '&:hover': {
    background: 'linear-gradient(90deg, $gray800, $bgCharcoal)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    transform: 'translateX(4px)',
  },
});

const StyledGreetingCard = styled('div', {
  background: 'linear-gradient(135deg, $cardCharcoal, $bgCharcoal)',
  border: '1px solid rgba(255, 255, 255, 0.05)',
  borderRadius: '$2xl',
  padding: '$8',
  paddingLeft: '$10',
  display: 'flex',
  alignItems: 'center',
  boxShadow: '$glass',
  position: 'relative',
  overflow: 'hidden',
  marginBottom: '$8',
  animation: `${fadeIn} 0.8s cubic-bezier(0.165, 0.84, 0.44, 1)`,

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '1px',
    background: 'linear-gradient(90deg, transparent, $gold, transparent)',
    opacity: 0.3,
  }
});

const GreetingContent = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
});

const GreetingBadge = styled('span', {
  fontSize: '9px',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  marginBottom: '$1',
  fontFamily: 'var(--font-rajdhani)',
});

const GreetingTitle = styled('h2', {
  fontSize: '20px',
  fontWeight: '$black',
  color: '$white',
  marginBottom: '$1',
  fontFamily: 'var(--font-rajdhani)',
});

const GreetingSubtitle = styled('p', {
  fontSize: '11px',
  color: 'rgba(255, 255, 255, 0.4)',
  fontStyle: 'italic',
  fontFamily: 'var(--font-rajdhani)',
    '& strong': {
    color: '$gold',
    opacity: 0.8,
  }
});

type LinkedMember = {
  id: string;
  nickname: string;
  email?: string | null;
};

const formatSignedNumber = (value: number) => {
  if (value > 0) return `+${value}`;
  return String(value);
};

const formatAverage = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
};

export default function ProfilePage() {
  const { user, role, signOut, isLoading } = useAuth();
  const [linkedMember, setLinkedMember] = useState<LinkedMember | null>(null);
  const [kdkStats, setKdkStats] = useState<KdkArchiveStats | null>(null);
  const [kdkLoading, setKdkLoading] = useState(false);
  const [kdkError, setKdkError] = useState('');
  const [memberLookupDone, setMemberLookupDone] = useState(false);

  useEffect(() => {
    if (!user?.email) return;

    let cancelled = false;

    const loadOfficialKdkStats = async () => {
      setKdkLoading(true);
      setKdkError('');
      setMemberLookupDone(false);

      try {
        const { data: members, error: memberError } = await supabase
          .from('members')
          .select('id, nickname, email')
          .eq('email', user.email)
          .limit(1);

        if (memberError) throw memberError;

        const member = members?.[0] as LinkedMember | undefined;
        if (!member) {
          if (!cancelled) {
            setLinkedMember(null);
            setKdkStats(null);
            setMemberLookupDone(true);
          }
          return;
        }

        const { data: archives, error: archiveError } = await supabase
          .from('teyeon_archive_v1')
          .select('id, created_at, raw_data, is_official, archive_type')
          .eq('archive_type', 'kdk')
          .eq('is_official', true)
          .order('created_at', { ascending: false });

        if (archiveError) throw archiveError;

        const stats = calculateKdkArchiveStats((archives || []) as KdkArchiveRow[], {
          id: member.id,
          name: member.nickname,
        });

        if (!cancelled) {
          setLinkedMember(member);
          setKdkStats(stats);
          setMemberLookupDone(true);
        }
      } catch (err: any) {
        if (!cancelled) {
          setKdkError(err?.message || '공식 KDK 기록을 불러오지 못했습니다.');
          setLinkedMember(null);
          setKdkStats(null);
          setMemberLookupDone(true);
        }
      } finally {
        if (!cancelled) setKdkLoading(false);
      }
    };

    loadOfficialKdkStats();

    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  if (isLoading) {
    return (
      <Container>
        <Header>
          <div className="animate-pulse w-8 h-8 rounded-full bg-white/5"></div>
          <div className="animate-pulse w-32 h-4 rounded bg-white/5"></div>
          <div className="animate-pulse w-12 h-4 rounded bg-white/5"></div>
        </Header>
        <div className="animate-pulse w-full h-[140px] bg-white/5 rounded-[24px] mb-8"></div>
        <div className="animate-pulse w-32 h-4 rounded bg-white/5 mb-5"></div>
        <div className="animate-pulse w-full h-[40px] bg-white/5 rounded-[12px] mb-8"></div>
        <div className="grid grid-cols-3 gap-4 mb-10 w-full">
           <div className="animate-pulse h-[100px] bg-white/5 rounded-[12px]"></div>
           <div className="animate-pulse h-[100px] bg-white/5 rounded-[12px]"></div>
           <div className="animate-pulse h-[100px] bg-white/5 rounded-[12px]"></div>
        </div>
      </Container>
    );
  }

  if (!user) {
    return (
      <Container>
        <div style={{ marginTop: '100px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px' }}>
          <p style={{ textAlign: 'center', opacity: 0.5, fontFamily: 'var(--font-rajdhani)', letterSpacing: '0.1em' }}>PLEASE LOGIN FROM MAIN DASHBOARD TO INITIALIZE PILOT TELEMETRY.</p>
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <div style={{ width: '40px' }} /> {/* Spacer to keep title centered if needed, or just remove if we want it flex-start */}
        <p style={{ fontWeight: 950, color: '$goldGlint', fontSize: '11px', letterSpacing: '0.4em', fontFamily: 'var(--font-rajdhani)', textAlign: 'center', flex: 1 }}>PILOT ANALYTICS</p>
        <button onClick={() => signOut()} style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 950, letterSpacing: '0.15em', fontFamily: 'var(--font-rajdhani)', width: '60px' }}>LOGOUT</button>
      </Header>

      <StyledGreetingCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', width: '100%' }}>
            <ProfileAvatar 
              src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
              alt="Profile" 
              size={64} 
              className="border-2 border-gold shadow-[0_0_20px_rgba(212,175,55,0.2)] rounded-full"
              fallbackIcon={role === 'CEO' ? '👑' : '👤'}
            />
          <GreetingContent>
            <GreetingBadge>{role === 'CEO' ? 'COMMANDER IN CHIEF' : 'ELITE CIRCUIT PILOT'}</GreetingBadge>
            <GreetingTitle>
              반갑습니다, <span style={{ color: '#D4AF37' }}>{user.user_metadata?.nickname || user.user_metadata?.full_name}</span>님!
            </GreetingTitle>
            <GreetingSubtitle>
              매 순간이 <strong>CHAMPION SHOT</strong>입니다 🎾
            </GreetingSubtitle>
          </GreetingContent>
        </div>
      </StyledGreetingCard>

      <SectionTitle style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>Official KDK Records</SectionTitle>

      <div style={{ marginBottom: '24px', padding: '16px 18px', borderRadius: '18px', border: '1px solid rgba(212,175,55,0.16)', background: 'rgba(212,175,55,0.05)', color: 'rgba(255,255,255,0.55)', fontSize: '11px', fontWeight: 800, lineHeight: 1.6, fontFamily: 'var(--font-rajdhani)' }}>
        공식 Archive로 확정된 KDK만 프로필 기록에 반영됩니다.
      </div>

      {kdkLoading ? (
        <div className="animate-pulse w-full h-[150px] bg-white/5 rounded-[24px] mb-8" />
      ) : kdkError ? (
        <MatchRecord>
          <div>
            <p style={{ fontSize: '16px', fontWeight: 950, color: '#fff', fontFamily: 'var(--font-rajdhani)' }}>기록을 불러오지 못했습니다</p>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '6px', fontFamily: 'var(--font-rajdhani)' }}>{kdkError}</p>
          </div>
        </MatchRecord>
      ) : memberLookupDone && !linkedMember ? (
        <MatchRecord>
          <div>
            <p style={{ fontSize: '16px', fontWeight: 950, color: '#fff', fontFamily: 'var(--font-rajdhani)' }}>멤버 연결이 필요합니다</p>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '6px', fontFamily: 'var(--font-rajdhani)' }}>카카오 계정과 멤버 프로필이 연결되면 공식 KDK 기록이 표시됩니다.</p>
          </div>
        </MatchRecord>
      ) : kdkStats && kdkStats.totalSessions > 0 ? (
        <>
          <StatsGrid>
            <StatCard>
              <StatValue highlight style={{ fontFamily: 'var(--font-orbitron)' }}>{kdkStats.totalSessions}</StatValue>
              <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>Sessions</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue style={{ fontFamily: 'var(--font-orbitron)' }}>{kdkStats.totalWins}/{kdkStats.totalLosses}</StatValue>
              <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>W / L</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue style={{ fontFamily: 'var(--font-orbitron)', color: kdkStats.totalDiff > 0 ? '#D4AF37' : kdkStats.totalDiff < 0 ? '#ef4444' : '#fff' }}>{formatSignedNumber(kdkStats.totalDiff)}</StatValue>
              <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>Total Diff</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue style={{ fontFamily: 'var(--font-orbitron)' }}>{formatAverage(kdkStats.averageDiff)}</StatValue>
              <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>Avg Diff</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue style={{ fontFamily: 'var(--font-orbitron)' }}>{kdkStats.firstPlaceCount}</StatValue>
              <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>1st</StatLabel>
            </StatCard>
            <StatCard>
              <StatValue style={{ fontFamily: 'var(--font-orbitron)' }}>{kdkStats.top3Count}</StatValue>
              <StatLabel style={{ fontFamily: 'var(--font-rajdhani)' }}>Top 3</StatLabel>
            </StatCard>
          </StatsGrid>

          <div style={{ marginBottom: '28px', padding: '18px 22px', borderRadius: '20px', background: 'linear-gradient(135deg, rgba(212,175,55,0.12), rgba(255,255,255,0.03))', border: '1px solid rgba(212,175,55,0.14)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 16px 30px rgba(0,0,0,0.35)' }}>
            <div>
              <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.35)', fontWeight: 950, letterSpacing: '0.22em', textTransform: 'uppercase', fontFamily: 'var(--font-rajdhani)' }}>Latest Rank</p>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', marginTop: '4px', fontWeight: 800, fontFamily: 'var(--font-rajdhani)' }}>{linkedMember?.nickname} 공식 KDK 기준</p>
            </div>
            <p style={{ fontSize: '34px', fontWeight: 950, color: '#D4AF37', fontFamily: 'var(--font-orbitron)' }}>{kdkStats.latestRank ? `${kdkStats.latestRank}위` : '-'}</p>
          </div>

          <SectionTitle style={{ fontFamily: 'var(--font-rajdhani)', fontSize: '11px' }}>Recent Official KDK</SectionTitle>
          <section>
            {kdkStats.recentSessions.map(session => (
              <Link key={session.archiveId} href={`/archive?session=${session.archiveId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <MatchRecord>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '10px', fontWeight: 950, color: '#D4AF37', marginBottom: '4px', fontFamily: 'var(--font-rajdhani)', letterSpacing: '0.12em' }}>{session.date || '날짜 없음'}</p>
                    <p style={{ fontSize: '16px', fontWeight: 950, color: '#fff', letterSpacing: '-0.02em', fontFamily: 'var(--font-rajdhani)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>{session.title}</p>
                    <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', letterSpacing: '0.14em', marginTop: '5px', fontFamily: 'var(--font-rajdhani)' }}>
                      {session.groupName ? `${session.groupName}조 · ` : ''}{session.totalPlayers} players
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: '18px', fontWeight: 950, color: session.rank && session.rank <= 3 ? '#D4AF37' : '#fff', fontFamily: 'var(--font-orbitron)' }}>{session.rank ? `${session.rank}위` : '-'}</p>
                    <p style={{ fontSize: '11px', fontWeight: 950, opacity: 0.45, fontFamily: 'var(--font-rajdhani)', whiteSpace: 'nowrap' }}>
                      {session.ranked ? `${session.wins}승 ${session.losses}패 · ${formatSignedNumber(session.diff || 0)}` : '참가 확인'}
                    </p>
                  </div>
                </MatchRecord>
              </Link>
            ))}
          </section>
        </>
      ) : (
        <MatchRecord>
          <div>
            <p style={{ fontSize: '16px', fontWeight: 950, color: '#fff', fontFamily: 'var(--font-rajdhani)' }}>아직 공식 KDK 기록이 없습니다</p>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '6px', fontFamily: 'var(--font-rajdhani)' }}>Archive에서 공식 기록으로 확정된 세션만 이곳에 누적됩니다.</p>
          </div>
        </MatchRecord>
      )}

    </Container>
  );
}
