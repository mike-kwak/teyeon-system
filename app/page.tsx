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
  Flame, 
  CircleDollarSign, 
  Cpu, 
  Settings 
} from 'lucide-react';
// Note: We don't need a heavy external Skeleton library, basic tailwind animate-pulse blocks work flawlessly.

export default function Home() {
  const { user, role, signInWithKakao, signOut, isLoading, systemMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  if (!isMounted) return null;

  const menuItems = [
    { label: '클럽 공지', icon: <Megaphone size={36} strokeWidth={1.5} />, path: '/notice', comingSoon: false },
    { label: '멤버 프로필', icon: <Users size={36} strokeWidth={1.5} />, path: '/members', comingSoon: false },
    { label: '스페셜 매치', icon: <Flame size={36} strokeWidth={1.5} />, path: '/tournament', comingSoon: true },
    { label: '대전 생성', icon: <Swords size={36} strokeWidth={1.5} />, path: '/kdk', comingSoon: false },
    { label: '클럽 재무', icon: <CircleDollarSign size={36} strokeWidth={1.5} />, path: '/finance', comingSoon: true },
    { label: 'AI 시드 예측', icon: <Cpu size={36} strokeWidth={1.5} />, path: '/prediction', comingSoon: true },
    { label: '관리자 설정', icon: <Settings size={36} strokeWidth={1.5} />, path: '/admin', comingSoon: false },
  ];

  return (
    <main className="min-h-screen bg-[#121212] px-5 pt-0 pb-[250px] w-full flex flex-col items-center overflow-x-hidden relative">
      <div className="w-full max-w-[430px] mx-auto flex flex-col items-center">
        
        {/* Perfect Balance Spacer (24px Header-to-Grid) */}
        <div className="h-[24px] w-full shrink-0" />

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

        {/* Authenticated State - Grid Menu (Moved up as requested) */}
        {!isLoading && user && (
          <>
            <div className="grid grid-cols-2 gap-6 w-full mt-6 animate-in slide-in-from-bottom-4 duration-700">
              {menuItems.slice(0, 6).map((item, index) => (
                <Link 
                  key={index} 
                  href={item.path}
                  className="relative flex flex-col items-center justify-center bg-[#1A1A1A]/90 backdrop-blur-md rounded-[24px] gap-3 transition-all duration-300 hover:bg-[#1A1A1A] hover:-translate-y-1 active:scale-[0.98] shadow-[0_8px_25px_rgba(0,0,0,0.6)] border border-white/5 group h-[160px]"
                >
                  {item.comingSoon && (
                    <span className="absolute px-[10px] py-[4px] bg-red-600/20 text-red-500 text-[10px] font-[1000] rounded-full tracking-tighter shadow-[0_0_15px_rgba(239,68,68,0.3)] border border-red-500/40 animate-pulse top-4 right-4">
                      COMING SOON
                    </span>
                  )}
                  <div className="text-[#C9B075] drop-shadow-[0_2px_8px_rgba(201,176,117,0.3)] transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-1">
                    {item.icon}
                  </div>
                  <span className="font-bold text-[#C9B075]/80 tracking-wide text-center px-2 text-[16px]">
                    {item.label}
                  </span>
                </Link>
              ))}
            </div>

            {/* Vertically Centered Admin Spacer (Row 3 to Admin) */}
            <div className="h-8 w-full shrink-0" />

            {/* Standalone Admin Setting Button (v5.9 Spacer Balanced) */}
            <div className="w-full animate-in fade-in duration-1000">
              <Link 
                href={menuItems[6].path}
                className="relative flex flex-row items-center justify-center bg-[#1A1A1A]/90 backdrop-blur-md rounded-[24px] gap-4 transition-all duration-300 hover:bg-[#1A1A1A] hover:-translate-y-1 active:scale-[0.98] shadow-[0_8px_25px_rgba(0,0,0,0.6)] border border-white/5 group h-20 w-full"
              >
                <div className="text-[#C9B075]/60 transition-transform duration-300 group-hover:scale-110 group-hover:text-[#C9B075]">
                  {React.isValidElement(menuItems[6].icon) && React.cloneElement(menuItems[6].icon as React.ReactElement<any>, { size: 28 })}
                </div>
                <span className="font-bold text-[#C9B075]/80 tracking-[0.2em] text-center text-[16px] uppercase font-['Rajdhani',sans-serif]">
                  {menuItems[6].label}
                </span>
              </Link>
            </div>
            {/* Vertically Centered Admin Spacer (Admin to Footer) */}
            <div className="h-8 w-full shrink-0" />
          </>
        )}

        {/* Footer Text */}
        <div className="mt-4 mb-10 text-center flex flex-col gap-2 opacity-40 animate-in fade-in duration-1000">
           <span className="text-[11px] font-black text-gray-400 tracking-[0.25em] uppercase font-['Rajdhani',sans-serif]">
             TEYEON CLUB MANAGEMENT
           </span>
           <span className="text-[10px] text-[#E8E137] font-bold tracking-widest font-['Rajdhani',sans-serif]">
             Premium Experience v3.9 Stability Ed.
           </span>
        </div>
      </div>

      {/* Toast Notification */}
      {(toast || systemMessage) && (
        <div className="fixed bottom-[130px] left-1/2 -translate-x-1/2 w-[90vw] max-w-[380px] p-[16px] bg-[#E8E137] text-black font-black text-center rounded-xl z-[2000] shadow-[0_20px_50px_rgba(0,0,0,0.8)] font-['Rajdhani',sans-serif] tracking-wider text-[14px]">
          {toast || systemMessage}
        </div>
      )}
    </main>
  );
}
