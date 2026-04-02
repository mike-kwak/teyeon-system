'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import { withRetry } from '@/utils/withRetry';
import { useRouter } from 'next/navigation';

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

  const getBadgeStyle = () => {
    if (badgeType === 'premium') return 'bg-[#D4AF37] text-black shadow-[0_0_10px_rgba(212,175,55,0.8)]';
    if (badgeType === 'elite') return 'bg-white/10 text-[#D4AF37] border border-[#D4AF37]/30';
    return 'bg-white/5 text-white/40 border border-white/10';
  };

  return (
    <div className="relative overflow-hidden p-5 rounded-2xl flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(212,175,55,0.4)] group bg-gradient-to-br from-[#222222] to-black border border-white/5 hover:border-[#D4AF37]/40 z-10 isolate">
      <div className="flex justify-between items-start mb-3 z-20">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-black mb-1.5 text-white tracking-tight drop-shadow-md">{member.nickname}</h3>
          <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-wider ${getBadgeStyle()}`}>
            {roleLabels.primary}
          </span>
        </div>
        <ProfileAvatar 
          src={finalAvatar} 
          alt={member.nickname} 
          size={48}
          className="rounded-full border-2 border-[#D4AF37]/20 shadow-md bg-black"
          fallbackIcon="🎾"
        />
      </div>

      <div className="flex flex-col gap-1 mt-4 border-t border-white/5 pt-3 z-20">
        <span className="text-[7px] font-black text-white/20 uppercase tracking-[0.1em]">Status Detail</span>
        <span className="text-[10px] font-black text-white/60 tracking-tight">{member.affiliation || 'Elite Member'}</span>
      </div>

      <div className="mt-3 min-h-[14px] z-20">
         {member.achievements && (
           <p className="text-[9px] font-black text-[#D4AF37] italic opacity-80 drop-shadow-md">
             🏆 {member.achievements}
           </p>
         )}
      </div>
      
      {/* Background Graphic */}
      <div className="absolute -right-2 -bottom-2 text-[64px] opacity-[0.02] pointer-events-none transition-opacity duration-300 group-hover:opacity-10 z-0 select-none">
        🎾
      </div>
    </div>
  );
});

MemberCard.displayName = 'MemberCard';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check hydration matches by doing fetch safely via client
    fetchMembers();
  }, []);

  async function fetchMembers() {
    try {
      setLoading(true);
      const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";
      
      // Use withRetry utility which was boosted to 15s to handle flaky connections
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
      // Hard fallback on 3x fail timeout
      setMembers(FALLBACK_MEMBERS);
    } finally {
      setLoading(false);
      // Ensure router navigations are synced
      router.refresh();
    }
  }

  return (
    <main className="flex flex-col min-h-[100dvh] px-5 py-8 max-w-[500px] mx-auto w-full bg-black pb-[110px] overflow-hidden">
      <header className="mb-8 pl-1">
        <h1 className="text-[32px] font-black tracking-tight text-white uppercase leading-[0.9] italic font-['Rajdhani',sans-serif]">
          TEYEON <span className="text-[#D4AF37] drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]">MEMBERS</span>
        </h1>
        <p className="text-[10px] font-black text-[#D4AF37] tracking-widest uppercase mt-2 opacity-60 font-['Rajdhani',sans-serif]">
          Club Member Directory 2026
        </p>
      </header>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 animate-in fade-in duration-500">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse bg-gradient-to-br from-white/5 to-black/50 h-[140px] rounded-[24px] border border-white-[0.02] shadow-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-bottom-4 fade-in duration-500">
          {members.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}
        </div>
      )}

      {members.length === 0 && !loading && (
        <div className="text-center py-[100px] opacity-30">
          <span className="text-[64px] drop-shadow-[0_0_15px_rgba(212,175,55,1)]">🏜️</span>
          <p className="text-[11px] font-[950] uppercase tracking-[0.4em] mt-5 font-['Rajdhani',sans-serif]">
            No Members Detected
          </p>
        </div>
      )}

      <footer className="mt-auto py-[60px] text-center opacity-25">
        <p className="text-[11px] font-[950] tracking-[0.5em] text-[#D4AF37] uppercase font-['Rajdhani',sans-serif]">
          TEYEON NETWORK PRO STABLE
        </p>
      </footer>
    </main>
  );
}
