'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import PremiumSpinner from '@/components/PremiumSpinner';

interface Member {
  id: string;
  nickname: string;
  role?: string;
  is_admin?: boolean;
  is_guest?: boolean;
  phone?: string;
  email?: string; // Newly added
  mbti?: string;
  affiliation?: string;
  position?: string;
  achievements?: string;
  avatar_url?: string;
}

const EXE_PRIORITY: Record<string, number> = {
  '회장': 1,
  '부회장': 2,
  '총무': 3,
  '재무': 4,
  '경기': 5,
  '섭외': 6,
};

const MEMBER_PRIORITY: Record<string, number> = {
  '정회원': 10,
  '준회원': 20,
  '게스트': 30,
};

const FALLBACK_MEMBERS: Member[] = [
  { id: '1', nickname: '곽민섭', role: '회장', phone: '010-1234-5678', mbti: 'ENFJ', affiliation: '테연 클럽', achievements: '2025 테연 오픈 단체전 우승', position: 'CEO' },
  { id: '2', nickname: '가내현', role: '부회장', phone: '010-2345-6789', mbti: 'ISTJ', affiliation: '테연 클럽', achievements: '클럽 창립 멤버', position: 'CEO' },
  { id: '3', nickname: '강정호', role: '정회원', phone: '010-3456-7890', mbti: 'ENFP', achievements: '2024 신인왕' },
  { id: '4', nickname: '구봉준', role: '정회원', phone: '010-4567-8901', mbti: 'ENTJ', achievements: '경기 운영 지원' },
  { id: '5', nickname: '김민준', role: '정회원', phone: '010-5678-9012', mbti: 'INTP' },
  { id: '6', nickname: '김병식', role: '정회원', phone: '010-6789-0123', mbti: 'ISFP' },
  { id: '7', nickname: '김상준', role: '정회원', mbti: 'ESTJ' },
  { id: '8', nickname: '김영우', role: '준회원', mbti: 'INFJ' },
  { id: '9', nickname: '김영호', role: '준회원' },
  { id: '10', nickname: '김재형', role: '준회원' },
];

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

// Separate, Memoized Member Card Component
const MemberCard = React.memo(({ member }: { member: Member }) => {
  const { user } = useAuth();
  
  const getRoleBadgeColor = (role: string) => {
    const r = role.trim();
    if (r === '회장' || r === '부회장' || r === 'CEO') return 'bg-[#DC2626] text-white shadow-[0_0_15px_rgba(220,38,38,0.3)] font-black'; 
    if (EXE_PRIORITY[r]) return 'bg-[#2563EB] text-white shadow-[0_0_15px_rgba(37,99,235,0.3)] font-black'; 
    if (r === '정회원' || r === 'MEMBER') return 'bg-[#1A8D4D] text-white/90 font-bold';
    if (r === '준회원') return 'bg-[#10B981] text-white/90 font-bold';
    return 'bg-white/5 text-white/30 border border-white/10 font-medium';
  };

  const roleLabels = useMemo(() => {
    const role = (member.role || '').trim();
    const pos = (member.position || '').trim();
    
    let primary = '';
    let secondary = '';

    const isRoleExe = EXE_PRIORITY[role] || role === 'CEO';
    const isPosExe = EXE_PRIORITY[pos] || pos === 'CEO';

    if (isRoleExe && isPosExe) {
      if (EXE_PRIORITY[role] < EXE_PRIORITY[pos] || !EXE_PRIORITY[pos]) {
        primary = role;
        secondary = (pos !== role) ? pos : '';
      } else {
        primary = pos;
        secondary = (role !== pos) ? role : '';
      }
    } else if (isRoleExe) {
      primary = role;
      secondary = (pos !== role) ? pos : '';
    } else if (isPosExe) {
      primary = pos;
      secondary = (role !== pos) ? role : '';
    } else {
      primary = role || pos || '게스트';
      if (primary === role && pos && pos !== role) {
        secondary = pos;
      } else if (primary === pos && role && role !== pos) {
        secondary = role;
      }
    }
    return { primary: primary || '게스트', secondary };
  }, [member.role, member.position]);

  // Real-time Photo Priority Logic
  const finalAvatar = useMemo(() => {
    if (user?.email && member.email && user.email === member.email) {
      return (
        user.user_metadata?.avatar_url || 
        user.user_metadata?.picture || 
        user.user_metadata?.profile_image_url ||
        user.user_metadata?.profile_image ||
        member.avatar_url
      );
    }
    return member.avatar_url;
  }, [user?.email, user?.user_metadata, member.email, member.avatar_url]);

  return (
    <div className="bg-gradient-to-br from-[#1A253D] to-[#0A0E1A] border border-white/5 rounded-[24px] p-4 flex flex-col shadow-2xl hover:border-[#D4AF37]/40 transition-all duration-300 group relative overflow-hidden">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-black tracking-tight group-hover:text-[#D4AF37] transition-colors mb-1 truncate">{member.nickname}</h3>
          <div className="flex flex-wrap gap-1">
            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${getRoleBadgeColor(roleLabels.primary)}`}>
              {roleLabels.primary}
            </span>
          </div>
        </div>
        <ProfileAvatar 
          src={finalAvatar} 
          alt={member.nickname} 
          size={44}
          className="rounded-full shrink-0 border-2 border-[#D4AF37]/20"
          fallbackIcon="🎾"
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[7px] text-white/20 font-black uppercase tracking-widest">Contact</span>
          <span className="text-[9px] font-bold text-white/50 truncate">{member.phone || '비공개'}</span>
        </div>
        <div className="flex flex-col gap-0.5 border-t border-white/5 pt-2">
          <span className="text-[7px] text-white/20 font-black uppercase tracking-widest">Affiliation</span>
          <span className="text-[9px] font-bold text-white/40 truncate">{member.affiliation || 'Teyeon Club'}</span>
        </div>
        {member.achievements && (
          <div className="mt-1">
            <p className="text-[8px] font-medium text-[#D4AF37]/60 italic line-clamp-1">
              🏆 {member.achievements}
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

MemberCard.displayName = 'MemberCard';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    console.log('[Members] Fetching members starting...');
    
    // Safety flag to prevent infinite loading
    let fetchCompleted = false;
    const safetyTimeout = setTimeout(() => {
      if (!fetchCompleted) {
        console.warn('[Members] Fetch safety timeout triggered.');
        setLoading(false);
        if (members.length === 0) setMembers(FALLBACK_MEMBERS);
      }
    }, 6000);

    try {
      setLoading(true);
      setErrorMsg(null);
      
      const clubId = process.env.NEXT_PUBLIC_CLUB_ID || "512d047d-a076-4080-97e5-6bb5a2c07819";

      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('club_id', clubId);

      fetchCompleted = true;
      clearTimeout(safetyTimeout);

      if (error) throw error;
      
      console.log('[Members] Data received:', data?.length || 0);

      if (data && data.length > 0) {
        const sortedData = [...data].sort((a, b) => {
          const aP = getMemberPriority(a);
          const bP = getMemberPriority(b);
          if (aP !== bP) return aP - bP;
          return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
        });
        setMembers(sortedData);
      } else {
        console.log('[Members] No data found, using fallback');
        setMembers(FALLBACK_MEMBERS);
      }
    } catch (err: any) {
      fetchCompleted = true;
      clearTimeout(safetyTimeout);
      console.error('[Members] Fetch Error:', err.message || err);
      setErrorMsg(err.message || String(err));
      if (!members.length) setMembers(FALLBACK_MEMBERS);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#000000] text-white font-sans w-full pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-10 w-full lg:max-w-none">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-2xl font-black tracking-tighter flex items-center gap-3">
          클럽 멤버 <span className="text-[#D4AF37] text-sm font-bold bg-[#D4AF37]/10 px-3 py-1 rounded-full">{members.length}명</span>
        </h1>
        <div className="w-10"></div>
      </header>

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl mb-6 text-red-200 text-xs font-bold w-full lg:max-w-none">
          ⚠️ 오류 발생: {errorMsg}
        </div>
      )}

      {loading ? (
        <PremiumSpinner message="멤버 명단 동기화 중..." />
      ) : (
        <div className="grid grid-cols-2 gap-3 overflow-y-auto">
          {members.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}
        </div>
      )}

      {members.length === 0 && !loading && (
        <div className="text-center py-20 opacity-30 flex flex-col items-center">
          <span className="text-5xl mb-6">🏜️</span>
          <p className="text-lg font-black tracking-tight">멤버가 존재하지 않습니다.</p>
        </div>
      )}

      {/* Footer Info */}
      <footer className="mt-16 py-8 border-t border-white/5 flex flex-col items-center opacity-20">
        <p className="text-[10px] font-black tracking-widest uppercase mb-2">Teyeon Club Management System</p>
        <p className="text-[8px] font-bold">PREMIUM CHAMPAGNE GOLD Ed. v2.1 • Optimized Performance</p>
      </footer>
    </main>
  );
}
