'use client';

import React from 'react';
import Link from 'next/link';

export default function Home() {
  const isAdmin = true; // Simulated Admin role

  const menuItems = [
    // Row 1
    { id: "notice", icon: "📢", label: "클럽 공지", path: "/notice" },
    { id: "profile", icon: "👤", label: "멤버 프로필", path: "/members" },
    { id: "special", icon: "🔥", label: "스페셜 매치", path: "/tournament" },
    
    // Row 2
    { id: "kdk", icon: "⚙️", label: "대진 생성", path: "/kdk" },
    { id: "live_court", icon: "🎾", label: "라이브 코트", path: "/ranking" },
    { id: "archive", icon: "📂", label: "경기 아카이브", path: "/results" },
    
    // Row 3
    { id: "finance", icon: "💰", label: "클럽 재무", path: "/finance" },
    { id: "prediction", icon: "🤖", label: "AI 시드 예측", path: "/prediction" },
    { id: "admin", icon: "🛠️", label: "관리자 설정", path: "/admin", adminOnly: true },
  ];

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#000000] text-white font-sans max-w-md mx-auto pb-10">
      {/* Top Section: Logo */}
      <header className="flex flex-col items-center mt-2 mb-4 w-full pt-2 pb-2">
        <div className="relative group w-full flex flex-col items-center">
          <div className="relative flex items-center gap-4 group">
            {/* Logo Icon Layer (Lines & Ball) */}
            <div className="relative w-14 h-14 flex items-center justify-center">
                {/* Diagonal Red Lines */}
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[6px] -translate-y-[8px] opacity-100 shadow-sm"></div>
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[12px] translate-y-[0px] opacity-100 shadow-sm"></div>
                <div className="absolute w-[42px] h-[7px] bg-[#E33529] rounded-full rotate-[-45deg] -translate-x-[18px] translate-y-[8px] opacity-100 shadow-sm"></div>
                {/* Tennis Ball */}
                <div className="absolute w-7 h-7 bg-[#E8E137] rounded-full border-[1.5px] border-black translate-x-[10px] -translate-y-[10px] shadow-[2px_2px_8px_rgba(0,0,0,0.4)] z-10 flex items-center justify-center overflow-hidden">
                    <div className="absolute w-full h-[1px] bg-black/20 rotate-[15deg] translate-y-[4px]"></div>
                    <div className="absolute w-full h-[1px] bg-black/20 rotate-[15deg] -translate-y-[4px]"></div>
                </div>
            </div>

            {/* Typography Stack Layer */}
            <div className="flex flex-col items-center leading-none relative">
                {/* Row 1: Since 2025 */}
                <div className="flex items-center gap-2 mb-[4px]">
                    <span className="text-[10px] font-black text-white/90 tracking-[0.25em] uppercase">SINCE</span>
                    <span className="text-[#D4AF37] text-[11px] font-black tracking-widest italic">2025</span>
                </div>
                {/* Row 2: TEYEON */}
                <h1 className="text-white text-[38px] font-[1000] tracking-[-0.04em] leading-[0.9] drop-shadow-lg pr-1">
                    TEYEON
                </h1>
                {/* Row 3: TENNIS */}
                <div className="flex items-center justify-center w-full mt-1.5 px-0.5 ml-1">
                    <span className="text-white text-[11px] font-black tracking-[0.55em] uppercase opacity-90 italic">TENNIS</span>
                </div>
            </div>
            
            {/* Ambient Brand Glow */}
            <div className="absolute -inset-10 bg-[#D4AF37]/5 rounded-full blur-[50px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
          </div>
        </div>
      </header>

      {/* Profile Card */}
      <Link href="/profile" className="block mb-6">
        <section className="bg-gradient-to-br from-[#1A253D] to-[#14141F] rounded-[24px] py-4 px-6 border border-white/10 relative overflow-hidden active:scale-[0.98] transition-all shadow-xl group">
          <div className="flex items-center gap-5 relative z-10">
            <div className="w-12 h-12 bg-white/5 rounded-xl border border-white/10 flex items-center justify-center text-2xl group-hover:rotate-12 transition-transform">
              👤
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[#D4AF37] text-[8px] font-black tracking-widest uppercase bg-[#D4AF37]/10 px-2 py-0.5 rounded border border-[#D4AF37]/20">Premium CEO</span>
                <span className="w-1 h-1 bg-[#FF4500] rounded-full animate-pulse"></span>
              </div>
              <h2 className="text-lg font-bold tracking-tight text-white/90">윤정수 <span className="text-white/30 font-normal text-sm">님, 반갑습니다!</span></h2>
              <p className="text-white/40 text-[10px] font-medium tracking-wide mt-0.5">매 순간이 <span className="text-[#A3E635] font-black italic">CHAMPION SHOT</span> 입니다 🎾</p>
            </div>
          </div>
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#D4AF37]/5 rounded-bl-[80px] -mr-8 -mt-8 group-hover:scale-110 transition-transform"></div>
          <div className="absolute -bottom-4 -left-4 w-12 h-12 bg-[#FF4500]/5 blur-xl"></div>
        </section>
      </Link>

      {/* Action Tower Grid */}
      <section className="grid grid-cols-3 gap-3">
        {menuItems.map((item) => {
          const isRestricted = item.adminOnly && !isAdmin;
          
          const content = (
            <div 
              className={`
                aspect-square rounded-[32px] flex flex-col items-center justify-center gap-3 transition-all duration-500 border relative overflow-hidden group
                ${isRestricted 
                  ? 'bg-white/5 border-transparent opacity-20 grayscale cursor-not-allowed' 
                  : 'bg-gradient-to-br from-[#1A253D] to-[#14141F] border-white/5 hover:border-[#D4AF37]/40 hover:scale-105 hover:shadow-2xl hover:shadow-[#D4AF37]/10 active:scale-95'}
              `}
            >
              <div className="text-3xl relative z-10">
                {item.icon}
                {isRestricted && (
                  <div className="absolute -top-1 -right-1 text-[10px]">🔒</div>
                )}
              </div>
              <span className={`text-[11px] font-black tracking-tight z-10 ${isRestricted ? 'text-white/40' : 'text-white'}`}>
                {item.label}
              </span>
              
              {!isRestricted && (
                <div className="absolute inset-0 bg-gradient-to-t from-[#D4AF37]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              )}
            </div>
          );

          if (isRestricted) return <div key={item.id}>{content}</div>;

          return (
            <Link key={item.id} href={item.path || '/'} className="block w-full h-full">
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
