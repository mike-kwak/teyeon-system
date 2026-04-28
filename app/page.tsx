'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
import { 
  Users, 
  Trophy, 
  Swords, 
  Megaphone, 
  Layout, 
  CircleDollarSign, 
  Cpu, 
  Settings,
  RotateCw
} from 'lucide-react';
// Note: We don't need a heavy external Skeleton library, basic tailwind animate-pulse blocks work flawlessly.

export default function Home() {
  const { user, role, signInWithKakao, signOut, isLoading, systemMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const CURRENT_VERSION = 'v4.6 Cloud Sync';

  useEffect(() => {
    setIsMounted(true);
    
    // PWA Cache Busting Logic (v4.2)
    const savedVersion = localStorage.getItem('teyeon_pwa_version');
    if (savedVersion && savedVersion !== CURRENT_VERSION) {
      console.log(`[PWA] Version Mismatch: ${savedVersion} -> ${CURRENT_VERSION}. Forcing hard sync.`);
      localStorage.setItem('teyeon_pwa_version', CURRENT_VERSION);
      window.location.reload();
    } else {
      localStorage.setItem('teyeon_pwa_version', CURRENT_VERSION);
    }

    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleHardSync = () => {
    if (confirm("앱의 최신 데이터와 UI를 동기화하기 위해 새로고침 하시겠습니까?")) {
      localStorage.clear(); // Clear all stale local data
      window.location.href = window.location.origin + '?v=' + Date.now(); // Cache bust URL
    }
  };

  const MenuCard = ({ label, icon, path, comingSoon, badge }: { label: string, icon: React.ReactNode, path: string, comingSoon?: boolean, badge?: string }) => (
    <Link 
      href={path}
      className={`relative flex flex-col items-center justify-center bg-[#1A1A1A]/90 backdrop-blur-md rounded-[24px] gap-3 transition-all duration-300 hover:bg-[#1A1A1A] hover:-translate-y-1 active:scale-[0.98] shadow-[0_8px_25px_rgba(0,0,0,0.6)] border border-white/5 group h-[160px] ${comingSoon ? 'opacity-80' : ''}`}
    >
      {comingSoon && (
        <span className="absolute px-[10px] py-[4px] bg-red-600/20 text-red-500 text-[10px] font-[1000] rounded-full tracking-tighter shadow-[0_0_15px_rgba(239,68,68,0.3)] border border-red-500/40 animate-pulse top-4 right-4">
          COMING SOON
        </span>
      )}
      {badge && !comingSoon && (
        <span className="absolute px-[10px] py-[4px] bg-[#C9B075]/20 text-[#C9B075] text-[10px] font-[1000] rounded-full tracking-[0.1em] border border-[#C9B075]/40 top-4 right-4">
          {badge}
        </span>
      )}
      <div className="text-[#C9B075] drop-shadow-[0_2px_8px_rgba(201,176,117,0.3)] transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-1">
        {icon}
      </div>
      <span className="font-bold text-[#C9B075]/80 tracking-wide text-center px-2 text-[16px]">
        {label}
      </span>
    </Link>
  );

  if (!isMounted) return null;

  return (
    <main 
      className="min-h-screen bg-[#121212] px-5 pt-0 w-full max-w-[480px] mx-auto flex flex-col items-center overflow-x-hidden relative"
      style={{ paddingBottom: '250px' }}
    >
      <div className="w-full max-w-[430px] mx-auto flex flex-col items-center">
        
        {/* Premium Status Header (v4.3 Visibility Lock) */}
        {!isLoading && user && (
          <div className="w-full flex items-center justify-between px-4 py-3 bg-[#1A1A1A]/60 backdrop-blur-xl rounded-2xl border border-white/10 mb-6 animate-in fade-in slide-in-from-top-2 duration-500">
            <div className="flex items-center gap-3">
              <ProfileAvatar 
                uid={user.id} 
                url={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
                size={40} 
              />
              <div className="flex flex-col">
                <span className="text-white font-black text-[14px] tracking-tight">
                  {user.user_metadata?.full_name || user.email?.split('@')[0]}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit mt-0.5 tracking-widest uppercase ${
                  role === 'CEO' ? 'bg-[#C9B075] text-black' : 
                  role === 'ADMIN' ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/60'
                }`}>
                  {role}
                </span>
              </div>
            </div>
            <button 
              onClick={() => signOut()}
              className="text-[10px] font-black text-white/40 hover:text-red-500 transition-colors uppercase tracking-widest"
            >
              Sign Out
            </button>
          </div>
        )}

        {/* Luxury Skeleton Loading State */}
        {isLoading && (
          <div className="w-full flex flex-col gap-6 animate-pulse">
            <div className="w-full h-[60px] bg-[#1A1A1A]/40 rounded-xl mb-2"></div>
            <div className="grid grid-cols-2 gap-6 w-full">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-[160px] bg-[#1A1A1A]/60 backdrop-blur-md rounded-[24px] border border-white/5 shadow-[0_4px_10px_rgba(232,225,55,0.05)]"></div>
              ))}
            </div>
          </div>
        )}

        {/* Unauthenticated State - Center Login */}
        {!isLoading && !user && (
          <div className="w-full flex flex-col items-center justify-center min-h-[40vh] px-6 py-12 mt-6 bg-gradient-to-b from-[#1A1A1A]/90 to-[#121212]/80 backdrop-blur-2xl rounded-[32px] border border-white/5 shadow-[0_20px_40px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1)] relative overflow-hidden">
            <div className="absolute top-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#E8E137]/40 to-transparent"></div>
            
            <p className="text-[16px] font-[900] text-gray-200 tracking-[0.2em] mb-12 text-center font-['Rajdhani',sans-serif] drop-shadow-md">
              TEYEON에 오신 것을 환영합니다
            </p>
            
            <button 
              onClick={() => signInWithKakao()}
              className="w-full max-w-[320px] py-5 rounded-full bg-gradient-to-r from-[#1A1A1A] to-[#121212] text-[#E8E137] text-[15px] font-[1000] tracking-widest border border-[#E8E137]/30 shadow-[0_8px_30px_rgba(0,0,0,0.8),inset_0_0_20px_rgba(232,225,55,0.05)] transition-all hover:-translate-y-1 hover:border-[#E8E137]/80 hover:shadow-[0_15px_40px_rgba(232,225,55,0.2)] active:scale-[0.98] flex items-center justify-center gap-4 font-['Rajdhani',sans-serif]"
            >
              <span className="text-2xl drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]">💬</span> 카카오 계정으로 접속
            </button>
            
            <span className="text-[10px] text-gray-500 font-bold tracking-widest mt-8 uppercase font-['Rajdhani',sans-serif]">
              Authorized Personnel Only
            </span>
          </div>
        )}

        {/* Refactored Reliable Grid Menu (v4.4 Device Parity Lock) */}
        {!isLoading && user && (
          <>
            <div className="grid grid-cols-2 gap-6 w-full mt-6 animate-in slide-in-from-bottom-4 duration-700">
              {/* Row 1 */}
              <MenuCard 
                label="클럽 공지" 
                icon={<Megaphone size={36} strokeWidth={1.5} />} 
                path="/notice" 
              />
              <MenuCard 
                label="멤버 프로필" 
                icon={<Users size={36} strokeWidth={1.5} />} 
                path="/members" 
              />
              
              {/* Row 2 - Critical Session Controls */}
              <MenuCard 
                label="스페셜 매치" 
                icon={<Layout size={36} strokeWidth={1.5} />} 
                path="/special" 
                badge="MANUAL"
              />
              <MenuCard 
                label="대전 생성" 
                icon={<Swords size={36} strokeWidth={1.5} />} 
                path="/kdk" 
                badge="KDK"
              />

              {/* Row 3 - Extended Features */}
              <MenuCard 
                label="클럽 재무" 
                icon={<CircleDollarSign size={36} strokeWidth={1.5} />} 
                path="/finance" 
                comingSoon 
              />
              <MenuCard 
                label="AI 시드 예측" 
                icon={<Cpu size={36} strokeWidth={1.5} />} 
                path="/prediction" 
                comingSoon 
              />
            </div>

            {/* Vertically Centered Admin Spacer */}
            <div className="h-8 w-full shrink-0" />

            {/* Standalone Admin Setting Button */}
            <div className="w-full animate-in fade-in duration-1000">
              <Link 
                href="/admin"
                className="relative flex flex-row items-center justify-center bg-[#1A1A1A]/90 backdrop-blur-md rounded-[24px] gap-4 transition-all duration-300 hover:bg-[#1A1A1A] hover:-translate-y-1 active:scale-[0.98] shadow-[0_8px_25px_rgba(0,0,0,0.6)] border border-white/5 group h-16 w-full"
              >
                <div className="text-[#C9B075]/60 transition-transform duration-300 group-hover:scale-110 group-hover:text-[#C9B075]">
                  <Settings size={28} />
                </div>
                <span className="font-bold text-[#C9B075]/80 tracking-[0.2em] text-center text-[16px] uppercase font-['Rajdhani',sans-serif]">
                  관리자 설정
                </span>
              </Link>
            </div>

            {/* Vertically Centered Admin Spacer */}
            <div className="h-8 w-full shrink-0" />
          </>
        )}

        {/* Footer Text */}
        <div className="mt-0 mb-12 text-center flex flex-col gap-2 opacity-40 animate-in fade-in duration-1000">
           <span className="text-[11px] font-black text-gray-400 tracking-[0.25em] uppercase font-['Rajdhani',sans-serif]">
             TEYEON CLUB MANAGEMENT
           </span>
           <div 
             onClick={handleHardSync}
             className="text-[10px] text-[#E8E137] font-bold tracking-widest font-['Rajdhani',sans-serif] cursor-pointer hover:underline flex items-center justify-center gap-1.5"
           >
             <RotateCw size={10} /> Premium Experience {CURRENT_VERSION}
           </div>
        </div>
      </div>

      {/* Toast Notification */}
      {(toast || systemMessage) && (
        <div className="fixed bottom-[115px] left-1/2 -translate-x-1/2 w-[92%] max-w-[420px] p-[16px] bg-[#E8E137] text-black font-black text-center rounded-xl z-[2000] shadow-[0_20px_50px_rgba(0,0,0,0.8)] font-['Rajdhani',sans-serif] tracking-wider text-[14px]">
          {toast || systemMessage}
        </div>
      )}
    </main>
  );
}
