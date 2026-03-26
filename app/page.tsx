'use client';

import React from 'react';
import Link from 'next/link';

export default function Home() {
  const menuItems = [
    { id: "members", icon: "👥", label: "멤버 명단", locked: false, comingSoon: false },
    { id: "kdk", icon: "⚙️", label: "대진 생성", locked: false, comingSoon: false },
    { id: "results", icon: "📋", label: "대진표 확인", locked: false, comingSoon: false },
    { id: "ranking", icon: "🏆", label: "실시간 랭킹", locked: false, comingSoon: false },
    { id: "finance", icon: "💰", label: "클럽 정산", locked: false, comingSoon: false },
    { id: "notice", icon: "📢", label: "공지사항", locked: false, comingSoon: false },
    { id: "tournament", icon: "🏆", label: "대회 모드", locked: false, comingSoon: false },
    { id: "prediction", icon: "🤖", label: "시드 예측", locked: false, comingSoon: false },
    { id: "community", icon: "💬", label: "커뮤니티", locked: false, comingSoon: true },
  ];

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#1E1E2E] text-white font-sans max-w-md mx-auto pb-10">
      {/* Top Section: Logo */}
      <header className="flex flex-col items-center mt-8 mb-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center border border-white/10 shadow-xl">
            <span className="text-2xl">🎾</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-4xl font-black tracking-tighter leading-none">TEYEON</h1>
            <span className="text-xs font-black text-[#D4AF37] tracking-[0.4em] mt-1 ml-1 uppercase">Tennis Club</span>
          </div>
        </div>
        <div className="bg-[#D4AF37]/5 border border-[#D4AF37]/20 px-4 py-1 rounded-full mt-4">
          <span className="text-[#D4AF37] text-[10px] font-black tracking-widest">EST. 2025</span>
        </div>
      </header>

      {/* Profile Card */}
      <Link href="/profile" className="block mb-6">
        <section className="bg-gradient-to-br from-[#1A253D] to-[#1E1E2E] rounded-[24px] py-4 px-6 border border-white/10 relative overflow-hidden active:scale-[0.98] transition-all shadow-xl">
          <div className="flex items-center gap-5 relative z-10">
            <div className="w-12 h-12 bg-white/5 rounded-xl border border-white/10 flex items-center justify-center text-2xl">
              👤
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[#D4AF37] text-[8px] font-black tracking-widest uppercase bg-[#D4AF37]/10 px-2 py-0.5 rounded border border-[#D4AF37]/20">Premium CEO</span>
              </div>
              <h2 className="text-lg font-bold tracking-tight text-white/90">윤정수 <span className="text-white/30 font-normal text-sm">님, 반갑습니다!</span></h2>
              <p className="text-white/40 text-[10px] font-medium tracking-wide mt-0.5">오늘도 즐거운 테니스 되세요 🎾</p>
            </div>
          </div>
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#D4AF37]/5 rounded-bl-[80px] -mr-8 -mt-8"></div>
        </section>
      </Link>

      {/* Action Tower Grid */}
      <section className="grid grid-cols-3 gap-3">
        {menuItems.map((item) => {
          const content = (
            <div 
              className={`
                aspect-square rounded-[32px] flex flex-col items-center justify-center gap-3 transition-all duration-300 border
                ${item.comingSoon 
                  ? 'bg-white/5 border-transparent opacity-30 grayscale cursor-not-allowed' 
                  : 'bg-[#1A253D] border-white/5 hover:border-[#D4AF37]/30 active:scale-90'}
              `}
            >
              <div className="text-3xl relative">
                {item.icon}
                {item.comingSoon && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-white/40 rounded-full"></div>
                )}
              </div>
              <span className={`text-[12px] font-black tracking-tighter ${item.comingSoon ? 'text-white/40' : 'text-white/90'}`}>
                {item.label}
              </span>
            </div>
          );

          if (item.comingSoon) return <div key={item.id}>{content}</div>;

          let path = '/';
          if (item.id === 'members') path = '/members';
          if (item.id === 'kdk') path = '/kdk';
          if (item.id === 'results') path = '/results';
          if (item.id === 'ranking') path = '/ranking';
          if (item.id === 'finance') path = '/finance';
          if (item.id === 'notice') path = '/notice';
          if (item.id === 'tournament') path = '/tournament';
          if (item.id === 'prediction') path = '/prediction';

          return (
            <Link key={item.id} href={path} className="block w-full h-full">
              {content}
            </Link>
          );
        })}
      </section>

      {/* Footer Info */}
      <footer className="mt-16 py-6 border-t border-white/5 flex flex-col items-center opacity-30">
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1">Teyeon Club Management System</p>
        <p className="text-[9px] font-bold tracking-widest text-[#D4AF37]">Premium Experience v2.0</p>
      </footer>
    </main>
  );
}
