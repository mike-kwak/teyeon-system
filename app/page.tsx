'use client';

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

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

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
    <main className="min-h-screen bg-[#141416] px-5 pt-10 pb-[180px] w-full flex flex-col items-center overflow-x-hidden relative">
      <div className="w-full max-w-[430px] mx-auto flex flex-col items-center gap-6">
        
        {/* Grid Menu */}
        <div className="grid grid-cols-2 gap-4 w-full mt-2 animate-in slide-in-from-bottom-4 duration-700">
          {menuItems.map((item, index) => {
            const isLastOdd = index === menuItems.length - 1 && menuItems.length % 2 !== 0;
            return (
              <Link 
                key={index} 
                href={item.path}
                className={`relative flex flex-col items-center justify-center bg-black/30 backdrop-blur-md rounded-[24px] gap-3 transition-all duration-300 hover:bg-black/50 hover:-translate-y-1 active:scale-[0.98] shadow-[0_4px_10px_rgba(232,225,55,0.15)] border border-white/5 group ${!user ? 'opacity-50 pointer-events-none grayscale' : ''} ${isLastOdd ? 'col-span-2 h-[120px] flex-row gap-8' : 'h-[150px]'}`}
              >
                {item.comingSoon && (
                  <span className={`absolute px-[10px] py-[4px] bg-red-600/20 text-red-500 text-[10px] font-[1000] rounded-full tracking-tighter shadow-[0_0_15px_rgba(239,68,68,0.3)] border border-red-500/40 animate-pulse ${isLastOdd ? 'top-1/2 -translate-y-1/2 right-8' : 'top-4 right-4'}`}>
                    COMING SOON
                  </span>
                )}
                <div className={`text-[#C9B075] drop-shadow-[0_2px_8px_rgba(201,176,117,0.3)] transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-1 ${isLastOdd && item.comingSoon ? 'mr-0' : ''}`}>
                  {item.icon}
                </div>
                <span className={`font-bold text-[#C9B075]/80 tracking-wide text-center px-2 ${isLastOdd ? 'text-[16px]' : 'text-[15px]'}`}>
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
