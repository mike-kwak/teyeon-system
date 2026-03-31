'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useState, useEffect } from 'react';

import ProfileAvatar from '@/components/ProfileAvatar';

export default function Home() {
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

  // CEO MANDATE: Fixed 3x3 Grid Order
  const displayItems = menuItems;

  const handleMenuClick = (e: React.MouseEvent, item: any) => {
    // Priority 1: Coming Soon Logic
    if (item.isComingSoon) {
      e.preventDefault();
      setToast("준비 중인 기능입니다. 곧 테연 클럽만의 특별한 기능을 만나보실 수 있습니다! 🎾");
      return false;
    }

    const access = hasPermission(item.feature as any);
    
    import('@/lib/logging').then(({ logAction }) => {
      logAction(item.path, 'menu_click', { label: item.label, access });
    });

    if (access === 'HIDE') {
      e.preventDefault(); // Block navigation
      const msg = getRestrictionMessage(item.feature);
      setToast(msg);
      return false;
    }
    return true;
  };

  return (
    <main className="flex flex-col min-h-[100dvh] px-4 bg-gradient-to-b from-[#0A0A14] via-[#020205] to-[#000000] text-white font-sans max-w-md mx-auto w-full relative">
      {/* Universal Spacer - TOP (Balance) */}
      <div className="h-8" />

      {/* Top Section: Logo */}
      <header className="flex flex-col items-center mb-6 w-full py-2">
        <div className="relative group w-full flex flex-col items-center">
          <div className="relative flex items-center gap-4 group">
            <div className="relative w-14 h-14 flex items-center justify-center">
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[6px] -translate-y-[8px] opacity-100 shadow-sm"></div>
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[12px] translate-y-[0px] opacity-100 shadow-sm"></div>
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[18px] translate-y-[8px] opacity-100 shadow-sm"></div>
                <div className="absolute w-7 h-7 bg-[#E8E137] rounded-full border-[1.5px] border-black translate-x-[10px] -translate-y-[10px] shadow-[2px_2px_8px_rgba(0,0,0,0.4)] z-10 flex items-center justify-center overflow-hidden">
                    <div className="absolute w-full h-[1px] bg-black/20 rotate-[15deg] translate-y-[4px]"></div>
                    <div className="absolute w-full h-[1px] bg-black/20 rotate-[15deg] -translate-y-[4px]"></div>
                </div>
            </div>
            <div className="flex flex-col items-center leading-none relative">
                <div className="flex items-center gap-2 mb-[4px]">
                    <span className="text-[10px] font-black text-white/90 tracking-[0.25em] uppercase">SINCE</span>
                    <span className="text-[#D4AF37] text-[11px] font-black tracking-widest italic">2025</span>
                </div>
                <h1 className="text-white text-[38px] font-[1000] tracking-[-0.04em] leading-[0.9] drop-shadow-lg pr-1">TEYEON</h1>
                <div className="flex items-center justify-center w-full mt-1.5 px-0.5 ml-1">
                    <span className="text-white text-[11px] font-black tracking-[0.55em] uppercase opacity-90 italic">TENNIS</span>
                </div>
            </div>
          </div>
        </div>
      </header>

      {/* Profile Card - COMPACT MARGIN TO MENU (v2.9 Restored) */}
      <section className="mb-8">
        {!user ? (
          <button 
            onClick={() => signInWithKakao()}
            className="w-full bg-[#FEE500] text-[#3c1e1e] font-black py-4 rounded-[24px] flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all"
          >
            <span className="text-xl">💬</span>
            카카오로 3초만에 로그인
          </button>
        ) : (
          <div className="relative group">
            <Link href="/members" className="block">
              <section className="bg-gradient-to-br from-[#1A253D] to-[#14141F] rounded-[24px] py-4 px-6 border border-white/10 relative overflow-hidden active:scale-[0.98] transition-all shadow-xl">
                <div className="flex items-center gap-5 relative z-10">
                  <ProfileAvatar 
                    src={user.user_metadata?.avatar_url || user.user_metadata?.picture} 
                    alt={user.user_metadata?.full_name || "Profile"} 
                    size={48}
                    className="rounded-full shadow-[0_0_15px_rgba(212,175,55,0.2)]"
                    fallbackIcon={role === 'CEO' ? '👑' : role === 'ADMIN' ? '👨‍💼' : '👤'}
                  />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#D4AF37] text-[8px] font-black tracking-widest uppercase bg-[#D4AF37]/10 px-2 py-0.5 rounded border border-[#D4AF37]/20">
                        {role === 'CEO' ? 'Premium CEO' : role === 'ADMIN' ? 'Admin Staff' : 'Club Member'}
                      </span>
                      <span className="w-1 h-1 bg-[#4CAF50] rounded-full animate-pulse"></span>
                    </div>
                    <h2 className="text-lg font-bold tracking-tight text-white/90">
                      반갑습니다, <span className="text-[#D4AF37]">{user.user_metadata?.nickname || user.user_metadata?.full_name || user.email?.split('@')[0]}</span>님!
                    </h2>
                    <p className="text-white/40 text-[10px] font-medium tracking-wide mt-0.5 whitespace-nowrap">매 순간이 <span className="text-[#A3E635] font-black italic uppercase">Champion Shot</span> 입니다 🎾</p>
                  </div>
                </div>
              </section>
            </Link>
            <div className="absolute top-2 right-2 flex items-center gap-1.5 z-20">
              <button 
                onClick={() => window.location.reload()} 
                className="text-[10px] text-white/20 hover:text-[#D4AF37] p-1.5 transition-colors"
                title="앱 새로고침"
              >
                🔄
              </button>
              <button 
                onClick={() => signOut()} 
                className="text-[10px] text-white/20 hover:text-white/60 px-2 py-1 rounded-full"
              >
                로그아웃
              </button>
            </div>
          </div>
        )}
      </section>


      {/* Action Tower Grid - MAX IMPACT (Enlarged Icons & Spaced Gaps) */}
      <section className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-x-8 gap-y-14 sm:gap-x-12 sm:gap-y-16 relative w-full px-1 animate-in fade-in slide-in-from-bottom-5 duration-700">
        {displayItems.map((item) => {
          const access = hasPermission(item.feature as any);
          const isComingSoon = (item as any).isComingSoon;
          const isRestricted = access === 'HIDE';
          const isReadOnly = access === 'READ';
          
          return (
            <Link 
                key={item.id} 
                href={item.path || '/'} 
                onClick={(e) => handleMenuClick(e, item)}
                className="block w-full h-full"
            >
              <div 
                className={`
                  aspect-square rounded-[32px] flex flex-col items-center justify-center gap-1 transition-all duration-500 border relative overflow-hidden group
                  ${isComingSoon 
                    ? 'bg-black/20 border-white/10 opacity-70 grayscale-[0.3] cursor-not-allowed' 
                    : isRestricted 
                      ? 'bg-black/40 border-white/5 opacity-40 grayscale-[0.8] cursor-not-allowed' 
                      : isReadOnly
                        ? 'bg-white/5 border-white/10 opacity-90'
                        : 'bg-gradient-to-br from-[#1A253D] to-[#14141F] border-white/10 shadow-[0_8px_25px_rgba(0,0,0,0.5)] shadow-inner group-hover:border-[#D4AF37]/50 hover:scale-105 hover:shadow-[#D4AF37]/10 active:scale-95'}
                `}
              >
                {isComingSoon && (
                  <div className="absolute top-3 right-3 z-20">
                    <span className="bg-[#D4AF37] text-black text-[6px] font-[1000] px-1.5 py-0.5 rounded-full tracking-tighter shadow-lg animate-bounce">COMING SOON</span>
                  </div>
                )}
                <div className="text-[44px] relative z-10 transition-transform group-hover:scale-110 mb-2">
                  {item.icon}
                  {(isRestricted && !isComingSoon) && (
                    <div className="absolute -bottom-1 -right-1 text-[10px] bg-black/80 rounded-full w-4 h-4 flex items-center justify-center border border-[#D4AF37]/50 shadow-lg">🔒</div>
                  )}
                </div>
                <span className={`text-[12px] font-black tracking-tighter uppercase z-10 text-center px-1 ${isComingSoon ? 'text-white/70' : isRestricted ? 'text-white/30' : 'text-white'}`}>
                  {item.label}
                </span>
                
                {!(isComingSoon || isRestricted) && (
                  <div className="absolute inset-0 bg-gradient-to-t from-[#D4AF37]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                )}
              </div>
            </Link>
          );
        })}

        {/* Status Messages */}
        {isLoading && (
            <div className="col-span-3 py-10 text-center opacity-20 animate-pulse text-[10px] font-bold tracking-widest uppercase italic">
                Syncing Master Permissions...
            </div>
        )}

        {/* Toast Notification - Premium Floating UI */}
        {toast && (
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-[85vw] max-w-sm bg-gradient-to-r from-[#FF4500] to-[#FF6347] text-white px-6 py-4 rounded-[28px] font-black shadow-[0_20px_50px_rgba(255,69,0,0.4)] animate-in zoom-in-95 fade-in slide-in-from-bottom-5 duration-300 border-2 border-white/30 text-center flex items-center justify-center gap-3">
             <span className="text-xl">🚨</span>
             <span className="leading-tight text-xs tracking-tight">{toast}</span>
          </div>
        )}
      </section>

      <footer className="py-12 flex flex-col items-center opacity-30">
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1">Teyeon Club Management</p>
        <p className="text-[9px] font-bold tracking-widest text-[#D4AF37]">Premium Experience v3.9 Stability Ed.</p>
      </footer>
    </main>
  );
}
