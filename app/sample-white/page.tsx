'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useState, useEffect } from 'react';

import ProfileAvatar from '@/components/ProfileAvatar';

export default function WhiteSample() {
  const { user, role, appConfig, signInWithKakao, signOut, isLoading, hasPermission, getRestrictionMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const menuItems = [
    { id: "notice", icon: "📢", label: "클럽 공지", path: "/notice", feature: 'notice' },
    { id: "profile", icon: "👤", label: "멤버 프로필", path: "/members", feature: 'profiles' },
    { id: "tournament", icon: "🔥", label: "스페셜 매치", path: "/tournament", feature: 'kdk', isComingSoon: true },
    { id: "kdk", icon: "⚙️", label: "대진 생성", path: "/kdk", feature: 'kdk' },
    { id: "live_court", icon: "🎾", label: "라이브 코트", path: "/kdk", feature: 'scores' },
    { id: "archive", icon: "📂", label: "경기 아카이브", path: "/archive", feature: 'scores' },
    { id: "finance", icon: "💰", label: "클럽 재무", path: "/finance", feature: 'finance', isComingSoon: true },
    { id: "ai_seed", icon: "🤖", label: "AI 시드 예측", path: "/prediction", feature: 'tournament', isComingSoon: true },
    { id: "admin", icon: "🛠️", label: "관리자 설정", path: "/admin", feature: 'admin_settings' },
  ];

  const displayItems = menuItems;

  const handleMenuClick = (e: React.MouseEvent, item: any) => {
    if (item.isComingSoon) {
      e.preventDefault();
      setToast("준비 중인 기능입니다. 테연만의 특별한 화이트 감성으로 찾아뵙겠습니다! 🎾");
      return false;
    }
    const access = hasPermission(item.feature as any);
    if (access === 'HIDE') {
      e.preventDefault();
      const msg = getRestrictionMessage(item.feature);
      setToast(msg);
      return false;
    }
    return true;
  };

  return (
    <main className="flex flex-col h-screen max-h-screen px-4 bg-[#FFFFFF] text-[#333333] font-sans max-w-md mx-auto w-full overflow-hidden transition-colors duration-500">
      <div className="flex-grow-[0.8] min-h-[20px]" />

      {/* Top Section: Logo with Enhanced Contrast */}
      <header className="flex flex-col items-center mb-6 w-full py-2">
        <div className="relative group w-full flex flex-col items-center">
          <div className="relative flex items-center gap-4 group">
            <div className="relative w-14 h-14 flex items-center justify-center">
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[6px] -translate-y-[8px] opacity-100 shadow-md"></div>
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[12px] translate-y-[0px] opacity-100 shadow-md"></div>
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[18px] translate-y-[8px] opacity-100 shadow-md"></div>
                <div className="absolute w-7 h-7 bg-[#E8E137] rounded-full border-[1.5px] border-black translate-x-[10px] -translate-y-[10px] shadow-[2px_2px_8px_rgba(0,0,0,0.2)] z-10 flex items-center justify-center overflow-hidden">
                    <div className="absolute w-full h-[1px] bg-black/20 rotate-[15deg] translate-y-[4px]"></div>
                    <div className="absolute w-full h-[1px] bg-black/20 rotate-[15deg] -translate-y-[4px]"></div>
                </div>
            </div>
            <div className="flex flex-col items-center leading-none relative">
                <div className="flex items-center gap-2 mb-[4px]">
                    <span className="text-[10px] font-black text-[#0F172A]/40 tracking-[0.25em] uppercase">SINCE</span>
                    <span className="text-[#D4AF37] text-[11px] font-black tracking-widest italic">2025</span>
                </div>
                {/* Logo Title - DEEP CHARCOAL for White Theme */}
                <h1 className="text-[#0F172A] text-[38px] font-[1000] tracking-[-0.04em] leading-[0.9] drop-shadow-sm pr-1">TEYEON</h1>
                <div className="flex items-center justify-center w-full mt-1.5 px-0.5 ml-1">
                    <span className="text-[#0F172A]/70 text-[11px] font-black tracking-[0.55em] uppercase italic">TENNIS</span>
                </div>
            </div>
          </div>
        </div>
      </header>

      {/* Profile Card - SOFT GRAY for White Theme */}
      <section className="mb-8">
        {!user ? (
          <button 
            onClick={() => signInWithKakao()}
            className="w-full bg-[#FEE500] text-[#3c1e1e] font-black py-4 rounded-[24px] flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-all"
          >
            <span className="text-xl">💬</span>
            카카오로 시작하기
          </button>
        ) : (
          <div className="relative group">
            <Link href="/members" className="block">
              <section className="bg-[#F8FAFC] rounded-[24px] py-4 px-6 border border-[#E2E8F0] relative overflow-hidden active:scale-[0.98] transition-all shadow-md">
                <div className="flex items-center gap-5 relative z-10">
                  <ProfileAvatar 
                    src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
                    alt={user.user_metadata?.full_name || "Profile"} 
                    size={48}
                    className="rounded-full shadow-md border-2 border-[#D4AF37]/20"
                    fallbackIcon={role === 'CEO' ? '👑' : role === 'ADMIN' ? '👨‍💼' : '👤'}
                  />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#B45309] text-[8px] font-black tracking-widest uppercase bg-[#FEF3C7] px-2 py-0.5 rounded border border-[#FDE68A]">
                        {role === 'CEO' ? 'Premium CEO' : role === 'ADMIN' ? 'Admin Staff' : 'Club Member'}
                      </span>
                      <span className="w-1 h-1 bg-[#22C55E] rounded-full animate-pulse"></span>
                    </div>
                    <h2 className="text-lg font-bold tracking-tight text-[#0F172A]">
                      반갑습니다, <span className="text-[#B45309]">{user.user_metadata?.nickname || user.user_metadata?.full_name || user.email?.split('@')[0]}</span>님!
                    </h2>
                    <p className="text-[#64748B] text-[10px] font-medium tracking-wide mt-0.5 whitespace-nowrap italic">Every moment is a <span className="text-[#10B981] font-black uppercase">Champion Shot</span></p>
                  </div>
                </div>
              </section>
            </Link>
            <div className="absolute top-2 right-2 flex items-center gap-1.5 z-20">
              <button onClick={() => window.location.reload()} className="text-[12px] opacity-40 hover:opacity-100 transition-opacity">🔄</button>
              <button onClick={() => signOut()} className="text-[10px] text-[#64748B] hover:text-[#0F172A] font-bold px-2 py-1">Logout</button>
            </div>
          </div>
        )}
      </section>

      {/* Action Tower Grid - LIGHT THEME OPTIMIZED */}
      <section className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-x-8 gap-y-14 relative w-full px-1 animate-in fade-in duration-700">
        {displayItems.map((item) => {
          const access = hasPermission(item.feature as any);
          const isComingSoon = (item as any).isComingSoon;
          const isRestricted = access === 'HIDE';
          
          return (
            <Link 
                key={item.id} 
                href={item.path || '/'} 
                onClick={(e) => handleMenuClick(e, item)}
                className="block w-full h-full"
            >
              <div 
                className={`
                  aspect-square rounded-[32px] flex flex-col items-center justify-center gap-1 transition-all duration-300 border relative overflow-hidden group
                  ${isComingSoon 
                    ? 'bg-[#F1F5F9] border-[#E2E8F0] opacity-50 grayscale' 
                    : isRestricted 
                      ? 'bg-[#F1F5F9] border-[#E2E8F0] opacity-30 grayscale' 
                      : 'bg-[#F8FAFC] border-[#E2E8F0] shadow-sm hover:border-[#D4AF37] hover:shadow-md hover:scale-105 active:scale-95'}
                `}
              >
                {isComingSoon && (
                  <div className="absolute top-3 right-3 z-20">
                    <span className="bg-[#D4AF37] text-white text-[6px] font-black px-1.5 py-0.5 rounded-full tracking-tighter">SOON</span>
                  </div>
                )}
                <div className="text-[44px] relative z-10 transition-transform group-hover:scale-110 mb-1">
                  {item.icon}
                  {(isRestricted && !isComingSoon) && (
                    <div className="absolute -bottom-1 -right-1 text-[10px] bg-white rounded-full w-4 h-4 flex items-center justify-center border border-[#CBD5E1] shadow-sm">🔒</div>
                  )}
                </div>
                <span className={`text-[11px] font-black tracking-tighter uppercase z-10 text-center px-1 ${isComingSoon ? 'text-[#94A3B8]' : isRestricted ? 'text-[#CBD5E1]' : 'text-[#334155]'}`}>
                  {item.label}
                </span>
                
                {!(isComingSoon || isRestricted) && (
                  <div className="absolute inset-0 bg-[#D4AF37]/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                )}
              </div>
            </Link>
          );
        })}

        {/* Loading/Toast UI for Light Mode */}
        {isLoading && (
            <div className="col-span-3 py-10 text-center opacity-30 text-[10px] font-bold tracking-[0.4em] uppercase text-[#0F172A] animate-pulse">
                Synchronizing Essence...
            </div>
        )}

        {toast && (
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-[85vw] max-w-sm bg-[#FFFFFF] text-[#0F172A] px-6 py-4 rounded-[28px] font-black shadow-2xl animate-in zoom-in-95 duration-300 border-2 border-[#D4AF37] text-center flex items-center justify-center gap-3">
             <span className="text-xl">⚠️</span>
             <span className="leading-tight text-xs tracking-tight">{toast}</span>
          </div>
        )}
      </section>

      <div className="flex-grow-[1.4] min-h-[30px]" />

      <footer className="py-6 flex flex-col items-center opacity-40 pb-10">
        <p className="text-[10px] font-bold tracking-[0.3em] uppercase mb-1 text-[#334155]">Teyeon Club Management</p>
        <p className="text-[9px] font-black tracking-widest text-[#B45309]">Premium White Aesthetic Sample</p>
      </footer>
    </main>
  );
}
