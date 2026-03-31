'use client';

import React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const PATH_MAP: Record<string, string> = {
  '/': '테연 클럽',
  '/notice': '클럽 공지사항',
  '/members': '클럽 멤버 명단',
  '/kdk': '대진 생성',
  '/archive': '경기 아카이브',
  '/finance': '클럽 재무 관리',
  '/admin': '마스터 관리자 설정',
  '/profile': '내 프로필 설정',
  '/ranking': '전체 랭킹 보드',
};

const GlobalHeader = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { role } = useAuth();

  // Hide on certain paths if needed, or simplify the title
  const getTitle = () => {
    if (pathname.startsWith('/notice/')) return '공지사항 상세';
    if (pathname.startsWith('/kdk/')) return '대진표 상세';
    return PATH_MAP[pathname] || '테연 테니스';
  };

  const isHome = pathname === '/';

  return (
    <header className="sticky top-0 z-[100] w-full bg-black/60 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between safe-top">
      <div className="flex items-center gap-4 min-w-0">
        {!isHome && (
          <button 
            onClick={() => router.back()} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 active:scale-90 transition-all text-[#D4AF37]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <h1 className="text-sm font-black tracking-tight text-white uppercase truncate italic">
          {getTitle()}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <div className={`px-3 py-1 rounded-full border text-[8px] font-black tracking-widest uppercase transition-all ${
          role === 'CEO' ? 'bg-[#DC2626]/10 border-[#DC2626]/30 text-[#DC2626]' :
          role === 'ADMIN' ? 'bg-[#2563EB]/10 border-[#2563EB]/30 text-[#2563EB]' :
          'bg-white/5 border-white/10 text-white/40'
        }`}>
          {role}
        </div>
      </div>
    </header>
  );
};

export default GlobalHeader;
