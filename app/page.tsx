'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';
// Note: We don't need a heavy external Skeleton library, basic tailwind animate-pulse blocks work flawlessly.

export default function Home() {
  const { user, role, signInWithKakao, signOut, isLoading, systemMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const menuItems = [
    { label: '클럽 공지', icon: '📢', path: '/notice', comingSoon: false },
    { label: '멤버 프로필', icon: '👤', path: '/members', comingSoon: false },
    { label: '스페셜 매치', icon: '🔥', path: '/tournament', comingSoon: true },
    { label: '대전 생성', icon: '⚙️', path: '/kdk', comingSoon: false },
    { label: '클럽 재무', icon: '💰', path: '/finance', comingSoon: true },
    { label: 'AI 시드 예측', icon: '🤖', path: '/prediction', comingSoon: true },
    { label: '관리자 설정', icon: '🛠️', path: '/admin', comingSoon: true },
  ];

  return (
    <main className="min-h-screen bg-[#141416] px-5 pt-10 pb-[180px] w-full flex flex-col items-center overflow-x-hidden relative">
      <div className="w-full max-w-[430px] mx-auto flex flex-col items-center gap-6">
        
        {/* Luxury Skeleton Loading State */}
        {isLoading && (
          <div className="w-full flex flex-col gap-6 animate-pulse mt-4">
            <div className="w-full h-[96px] bg-[#1B1B1B]/80 rounded-[24px] border border-white/5 shadow-xl"></div>
            <div className="grid grid-cols-2 gap-4 w-full">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-[150px] bg-[#1B1B1B]/80 rounded-[24px] border border-white/5 shadow-md"></div>
              ))}
              <div className="col-span-2 h-[120px] bg-[#1B1B1B]/80 rounded-[24px] border border-white/5 shadow-md"></div>
            </div>
          </div>
        )}

        {/* Unauthenticated State */}
        {!isLoading && !user && (
          <div className="w-full">
            <button 
              onClick={() => signInWithKakao()}
              className="w-full py-5 rounded-3xl bg-[#1B1B1B] text-[#E8E137] text-base font-black tracking-widest border border-[#E8E137]/60 shadow-[0_10px_30px_rgba(0,0,0,0.8),inset_0_0_20px_rgba(232,225,55,0.05)] transition-all hover:-translate-y-1 hover:bg-[#E8E137]/5 active:scale-[0.98] flex items-center justify-center gap-3 font-['Rajdhani',sans-serif]"
            >
              <span className="text-2xl">💬</span> 카카오 계정으로 접속
            </button>
          </div>
        )}

        {/* Authenticated State - Profile Card (Moved to top, Logo removed) */}
        {!isLoading && user && (
          <div className="w-full bg-[#1B1B1B] rounded-[24px] p-6 flex items-center justify-between shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => signOut()} className="text-[10px] text-gray-500 font-bold hover:text-white transition-colors">
                로그아웃
              </button>
            </div>
            <div className="flex items-center gap-5 w-full">
              <ProfileAvatar 
                src={user.user_metadata?.avatar_url} 
                alt={user.user_metadata?.nickname} 
                size={64}
                fallbackIcon="👤"
                className="border-2 border-[#E8E137] rounded-full shadow-[0_0_20px_rgba(232,225,55,0.25)]"
              />
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-[#E8E137] tracking-[0.2em] mb-1.5 font-['Rajdhani',sans-serif]">
                  {role === 'CEO' ? 'COMMANDER IN CHIEF' : 'CLUB MEMBER'}
                </span>
                <h2 className="text-[18px] font-black text-white mb-2 font-['Rajdhani',sans-serif]">
                  반갑습니다, <span className="text-[#E8E137] font-['Pretendard']">{user.user_metadata?.nickname || '회원'}</span>님!
                </h2>
                <span className="text-[11px] text-gray-400 font-medium tracking-tight">
                  매 순간이 <span className="font-bold text-[#E8E137]">CHAMPION SHOT</span>입니다 🎾
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Grid Menu */}
        <div className="grid grid-cols-2 gap-4 w-full">
          {menuItems.map((item, index) => {
            const isLastOdd = index === menuItems.length - 1 && menuItems.length % 2 !== 0;
            return (
              <Link 
                key={index} 
                href={item.path}
                className={`relative flex flex-col items-center justify-center bg-[#1B1B1B] rounded-[24px] gap-4 transition-all duration-300 hover:bg-[#222222] hover:-translate-y-1 active:scale-[0.98] shadow-[0_8px_20px_rgba(0,0,0,0.6)] group ${!user ? 'opacity-50 pointer-events-none grayscale' : ''} ${isLastOdd ? 'col-span-2 h-[120px] flex-row gap-8' : 'h-[150px]'}`}
              >
                {item.comingSoon && (
                  <span className={`absolute px-[8px] py-[3px] bg-[#2A2A20] text-[#E8E137] text-[8px] font-black rounded-lg tracking-wider shadow-sm ${isLastOdd ? 'top-1/2 -translate-y-1/2 right-6' : 'top-4 right-4'}`}>
                    COMING SOON
                  </span>
                )}
                <div className={`text-[46px] filter drop-shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-1 ${isLastOdd && item.comingSoon ? 'mr-0' : ''}`}>
                  {item.icon}
                </div>
                <span className={`font-bold text-gray-200 tracking-wider text-center px-2 ${isLastOdd ? 'text-[15px]' : 'text-[14px]'}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Footer Text */}
        <div className="mt-8 text-center flex flex-col gap-2 opacity-40">
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
