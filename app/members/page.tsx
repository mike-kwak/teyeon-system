'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import PremiumSpinner from '@/components/PremiumSpinner';
import { withRetry } from '@/utils/withRetry';
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

const Header = styled('header', {
  marginBottom: '$8',
});

const Title = styled('h1', {
  fontSize: '32px',
  fontWeight: '$black',
  letterSpacing: '$tight',
  color: '$white',
  textTransform: 'uppercase',
  lineHeight: '0.9',
  fontStyle: 'italic',
});

const Subtitle = styled('p', {
  fontSize: '10px',
  fontWeight: '$black',
  color: '$gold',
  letterSpacing: '$mega',
  textTransform: 'uppercase',
  marginTop: '$2',
  opacity: 0.6,
});

const MemberGrid = styled('div', {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '$4',
  animation: `${fadeIn} 0.6s ease-out`,
});

const StyledMemberCard = styled('div', {
  background: 'linear-gradient(135deg, $gray850, $black)',
  borderGlow: 'rgba(255, 255, 255, 0.03)',
  borderRadius: '$2xl',
  padding: '$5',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '$glass',
  transition: 'all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1)',
  position: 'relative',
  overflow: 'hidden',

  '&:hover': {
    borderColor: 'rgba(212, 175, 55, 0.4)',
    transform: 'translateY(-4px)',
    boxShadow: '$goldGlow',
    '& .hover-icon': { opacity: 0.1 },
  },
});

const RoleBadge = styled('span', {
  fontSize: '8px',
  fontWeight: '$black',
  padding: '$1 $3',
  borderRadius: '$full',
  textTransform: 'uppercase',
  letterSpacing: '$wider',

  variants: {
    type: {
      premium: {
        background: '$gold',
        color: '$black',
        boxShadow: '$gold',
      },
      elite: {
        background: 'rgba(255, 255, 255, 0.08)',
        color: '$gold',
        border: '1px solid rgba(212, 175, 55, 0.3)',
      },
      standard: {
        background: 'rgba(255, 255, 255, 0.05)',
        color: 'rgba(255, 255, 255, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      },
    },
  },
});

const DetailItem = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$1',
  marginTop: '$4',
  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
  paddingTop: '$3',
});

const DetailLabel = styled('span', {
  fontSize: '7px',
  fontWeight: '$black',
  color: 'rgba(255, 255, 255, 0.2)',
  textTransform: 'uppercase',
  letterSpacing: '$mega',
});

const DetailValue = styled('span', {
  fontSize: '10px',
  fontWeight: '$black',
  color: 'rgba(255, 255, 255, 0.6)',
  letterSpacing: '$tight',
});

interface Member {
  id: string;
  nickname: string;
  role?: string;
  is_admin?: boolean;
  is_guest?: boolean;
  phone?: string;
  email?: string;
  mbti?: string;
  affiliation?: string;
  position?: string;
  achievements?: string;
  avatar_url?: string;
}

const EXE_PRIORITY: Record<string, number> = {
  '회장': 1, '부회장': 2, '총무': 3, '재무': 4, '경기': 5, '섭외': 6,
};

const MEMBER_PRIORITY: Record<string, number> = {
  '정회원': 10, '준회원': 20, '게스트': 30,
};

const getMemberPriority = (m: Member): number => {
  const role = (m.role || '').trim();
  const pos = (m.position || '').trim();
  if (EXE_PRIORITY[role]) return EXE_PRIORITY[role];
  if (EXE_PRIORITY[pos]) return EXE_PRIORITY[pos];
  if (m.is_admin) return 0;
  if (MEMBER_PRIORITY[role]) return MEMBER_PRIORITY[role];
  if (MEMBER_PRIORITY[pos]) return MEMBER_PRIORITY[pos];
  if (m.is_guest) return 30;
  return 99;
};

const FALLBACK_MEMBERS: Member[] = [
  { id: '1', nickname: '곽민섭', role: 'CEO, 재무', phone: '010-2696-0356', mbti: 'ESFJ', affiliation: '테연 클럽', achievements: '클럽 창립 멤버 / 매니저' },
  { id: '2', nickname: '가내현', role: '부회장', phone: '010-6680-7119', mbti: 'ESTJ', affiliation: '테연 클럽', achievements: '클럽 창립 멤버' },
  { id: '3', nickname: '강정호', role: '정회원', phone: '010-3456-7890', mbti: 'ENFP', achievements: '2024 신인왕' },
  { id: '4', nickname: '구봉준', role: '정회원', phone: '010-4567-8901', mbti: 'ENTJ', achievements: '경기 운영 지원' },
  { id: '5', nickname: '김민준', role: '정회원', phone: '010-5678-9012', mbti: 'INTP' },
  { id: '6', nickname: '김병식', role: '정회원', phone: '010-6789-0123', mbti: 'ISFP' },
  { id: '7', nickname: '김상준', role: '정회원', mbti: 'ESTJ' },
];

const MemberCard = React.memo(({ member }: { member: Member }) => {
  const { user } = useAuth();
  
  const roleLabels = useMemo(() => {
    const role = (member.role || '').trim();
    const pos = (member.position || '').trim();
    let primary = role || pos || '게스트';
    return { primary: primary || '게스트' };
  }, [member.role, member.position]);

  const badgeType = useMemo(() => {
    const r = roleLabels.primary.trim();
    if (r.includes('CEO') || r === '회장' || r === '부회장' || member.is_admin) return 'premium';
    if (EXE_PRIORITY[r] || r === '정회원') return 'elite';
    return 'standard';
  }, [roleLabels.primary, member.is_admin]);

  const finalAvatar = useMemo(() => {
    if (user?.email && member.email && user.email === member.email) {
      return user.user_metadata?.avatar_url || user.user_metadata?.picture || member.avatar_url;
    }
    return member.avatar_url;
  }, [user?.email, user?.user_metadata, member.email, member.avatar_url]);

  return (
    <StyledMemberCard>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: '16px', fontWeight: 900, marginBottom: '6px', color: '#fff', letterSpacing: '-0.02em' }}>{member.nickname}</h3>
          <RoleBadge type={badgeType}>{roleLabels.primary}</RoleBadge>
        </div>
        <ProfileAvatar 
          src={finalAvatar} 
          alt={member.nickname} 
          size={48}
          className="rounded-full border-2 border-[rgba(212,175,55,0.2)]"
          fallbackIcon="🎾"
        />
      </div>

      <DetailItem>
        <DetailLabel>Status Detail</DetailLabel>
        <DetailValue>{member.affiliation || 'Elite Member'}</DetailValue>
      </DetailItem>

      <div style={{ marginTop: '12px', minHeight: '14px' }}>
         {member.achievements && (
           <p style={{ fontSize: '9px', fontWeight: 800, color: '#D4AF37', fontStyle: 'italic', opacity: 0.8 }}>
             🏆 {member.achievements}
           </p>
         )}
      </div>
      <div className="hover-icon" style={{ position: 'absolute', right: '-10px', bottom: '-10px', fontSize: '64px', opacity: 0.02, pointerEvents: 'none', transition: 'opacity 0.4s' }}>🎾</div>
    </StyledMemberCard>
  );
});

MemberCard.displayName = 'MemberCard';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    try {
      setLoading(true);
      const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
      const { data, error } = await withRetry(() => supabase
        .from('members')
        .select('*')
        .eq('club_id', clubId));

      if (error) throw error;
      
      if (data && data.length > 0) {
        const sortedData = [...data].sort((a, b) => {
          const aP = getMemberPriority(a);
          const bP = getMemberPriority(b);
          if (aP !== bP) return aP - bP;
          return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
        });
        setMembers(sortedData);
      } else {
        setMembers(FALLBACK_MEMBERS);
      }
    } catch (err: any) {
      console.error('[Members] Fetch Error:', err);
      setMembers(FALLBACK_MEMBERS);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container>
      <Header>
        <Title>The <span style={{ color: '$goldGlint' }}>Elite</span></Title>
        <Subtitle>Club Member Directory 2026</Subtitle>
      </Header>

      {loading ? (
        <MemberGrid>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(0,0,0,0.5))', height: '140px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.02)' }} />
          ))}
        </MemberGrid>
      ) : (
        <MemberGrid>
          {members.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}
        </MemberGrid>
      )}

      {members.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '100px 0', opacity: 0.3 }}>
          <span style={{ fontSize: '64px', filter: 'drop-shadow(0 0 15px $goldGlint)' }}>🏜️</span>
          <p style={{ fontSize: '11px', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.4em', marginTop: '20px', fontFamily: 'var(--font-rajdhani)' }}>No Members Detected</p>
        </div>
      )}

      <footer style={{ marginTop: 'auto', padding: '60px 0', textAlign: 'center', opacity: 0.25 }}>
        <p style={{ fontSize: '11px', fontWeight: 950, letterSpacing: '0.5em', color: '$goldGlint', textTransform: 'uppercase' }}>TEYEON NETWORK PRO STABLE</p>
      </footer>
    </Container>
  );
}
