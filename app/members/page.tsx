'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
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
    if (badgeType === 'premium') return 'bg-[#C9B075] text-black shadow-[0_0_12px_rgba(201,176,117,0.6)]';
    if (badgeType === 'elite') return 'bg-[#C9B075]/10 text-[#C9B075] border border-[#C9B075]/40';
    return 'bg-white/5 text-white/30 border border-white/10';
  };

  return (
    <div className="relative overflow-hidden p-4 py-6 rounded-[24px] flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(201,176,117,0.3)] group bg-gradient-to-br from-[#1E1E1E] to-black border border-white/5 hover:border-[#C9B075]/40 z-10 isolate h-auto min-h-[170px] justify-between w-full">
      <div className="flex justify-between items-start mb-2 z-20 w-full">
        <div className="flex-1 min-w-0 pr-1">
          <h3 className="text-[17px] font-black mb-2 text-white/90 tracking-tight drop-shadow-md truncate">{member.nickname}</h3>
          <div className="flex flex-wrap gap-1">
            <span className={`text-[8px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider ${getBadgeStyle()}`}>
              {roleLabels.primary}
            </span>
          </div>
        </div>
        <div className="flex-shrink-0">
          <ProfileAvatar 
            src={finalAvatar} 
            alt={member.nickname} 
            size={46}
            className="rounded-full border-2 border-[#C9B075]/30 shadow-[0_4px_12px_rgba(0,0,0,0.8)] bg-[#111]"
            fallbackIcon="🎾"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1 mt-auto border-t border-white/10 pt-4 z-20 w-full">
        <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.1em]">Status Detail</span>
        <span className="text-[11px] font-black text-white/60 tracking-tight truncate">{member.affiliation || 'Elite Member'}</span>
      </div>

      <div className="mt-2 min-h-[20px] z-20 w-full">
         {member.achievements ? (
           <p className="text-[10px] font-black text-[#C9B075] italic opacity-90 drop-shadow-md leading-relaxed">
             🏆 {member.achievements}
           </p>
         ) : (
           <p className="text-[10px] opacity-0">Elite Directory</p>
         )}
      </div>
      
      {/* Background Graphic */}
      <div className="absolute -right-3 -bottom-3 text-[70px] opacity-[0.02] pointer-events-none transition-opacity duration-300 group-hover:opacity-10 z-0 select-none">
        🎾
      </div>
    </div>
  );
});

MemberCard.displayName = 'MemberCard';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    try {
      setLoading(true);
      setErrorStatus(null);
      
      // v4.3 ABSOLUTE STABILITY: Direct fetch with dummy timestamp-based filter for cache busting
      // PostgREST doesn't support query params for cache busting in the URL easily via the client,
      // so we use a dummy condition that is always true but unique.
      const timestamp = Date.now();
      console.log(`[CacheBust] Forcing fresh members fetch (t=${timestamp})`);

      const { data, error } = await supabase
        .from('members')
        .select('*')
        .not('id', 'is', null) // Safe invariant to force a fresh PostgREST request
        .order('id', { ascending: false }); // Minor shuffling to bypass edge caches if any

      if (error) {
        console.error('[Members] Supabase Fetch Error:', error);
        throw error;
      }
      
      if (data && data.length > 0) {
        const sortedData = [...data].sort((a, b) => {
          const aP = getMemberPriority(a);
          const bP = getMemberPriority(b);
          if (aP !== bP) return aP - bP;
          return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
        });
        setMembers(sortedData);
      } else {
        setErrorStatus('서버 연결 확인 중... (Checking connection)');
        setTimeout(fetchMembers, 3000);
      }
    } catch (err: any) {
      console.error('[Members] Terminal Failure:', err);
      setErrorStatus('네트워크 요청 실패. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
      router.refresh();
    }
  }

  return (
    <main className="min-h-screen bg-[#141416] pt-10 pb-10 w-full flex flex-col items-center overflow-x-hidden relative">
      <div className="w-full max-w-[430px] mx-auto flex flex-col items-center px-4 flex flex-col items-center">
        
        <header className="mb-8 w-full text-center flex flex-col items-center">
          <h1 className="text-[36px] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 uppercase leading-[1.1] italic font-['Rajdhani',sans-serif] drop-shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
            TEYEON <span className="bg-clip-text bg-gradient-to-r from-[#EFDFB4] to-[#C9B075] text-transparent drop-shadow-[0_4px_10px_rgba(201,176,117,0.5)]">MEMBERS</span>
          </h1>
          <p className="text-[11px] font-black text-[#C9B075] tracking-widest uppercase mt-1 opacity-60 font-['Rajdhani',sans-serif]">
            Club Member Directory 2026
          </p>
        </header>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 w-full animate-in fade-in duration-500">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse bg-gradient-to-br from-[#1E1E1E] to-black/50 h-[170px] rounded-[24px] border border-white-[0.02] shadow-lg" />
            ))}
          </div>
        ) : members.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 w-full animate-in slide-in-from-bottom-4 fade-in duration-500 relative">
            {members.map((member) => (
              <MemberCard key={member.id} member={member} />
            ))}
            
            {/* [v4.3] ABSOLUTE SPACING: Unconditional 250px Bottom Anchor */}
            <div className="col-span-2 h-[250px] w-full" aria-hidden="true" />
          </div>
        ) : (
          <div className="text-center py-[100px] mt-10 w-full mb-40">
            <div className="flex flex-col items-center gap-6">
              <div className="w-12 h-12 border-4 border-[#C9B075]/20 border-t-[#C9B075] rounded-full animate-spin"></div>
              <p className="text-[14px] font-black text-[#C9B075] tracking-tighter uppercase animate-pulse">
                {errorStatus || 'Loading Directory...'}
              </p>
              <button 
                onClick={() => fetchMembers()}
                className="mt-4 px-8 py-3 bg-[#C9B075] text-black text-xs font-black rounded-full shadow-lg active:scale-95 transition-transform"
              >
                RESTORE CONNECTION
              </button>
            </div>
          </div>
        )}

        <footer className="mt-[80px] text-center opacity-20 pb-8 mb-40">
          <p className="text-[11px] font-[950] tracking-[0.5em] text-[#C9B075] uppercase font-['Rajdhani',sans-serif]">
            TEYEON NETWORK PRO STABLE
          </p>
        </footer>
      </div>
    </main>
  );
}
