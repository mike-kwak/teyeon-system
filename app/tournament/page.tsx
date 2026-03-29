'use client';

import React from 'react';
import Link from 'next/link';

export default function TournamentPage() {
  const modes = [
    {
      id: 'open',
      title: '테연 오픈 (개인)',
      description: '클럽 최고의 상위 랭커를 가리는 정통 개인전 방식',
      icon: '🏆',
      color: 'from-[#FF3D71] to-[#FF9B44]',
      shadow: 'shadow-[0_10px_30px_rgba(255,61,113,0.3)]'
    },
    {
      id: 'dynamic',
      title: '다이나믹 릴레이',
      description: '쉬는 시간 없이 계속되는 박진감 넘치는 로테이션',
      icon: '⚡',
      color: 'from-[#39FF14] to-[#00D1FF]',
      shadow: 'shadow-[0_10px_30px_rgba(57,255,20,0.3)]'
    },
    {
      id: 'team',
      title: '팀 대항 배틀',
      description: 'A팀 vs B팀, 클럽의 자존심을 건 단체전',
      icon: '⚔️',
      color: 'from-[#7000FF] to-[#D100FF]',
      shadow: 'shadow-[0_10px_30px_rgba(112,0,255,0.3)]'
    }
  ];

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#1E1E2E] text-white font-sans max-w-screen-xl mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-10">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
          대회 모드 <span className="text-[#D4AF37] text-[10px] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded border border-[#D4AF37]/20 font-black">PREMIUM</span>
        </h1>
        <div className="w-10"></div>
      </header>

      {/* Intro */}
      <section className="mb-10 px-2">
        <h2 className="text-2xl font-black mb-2 italic tracking-tight">Select Tournament</h2>
        <p className="text-sm font-bold text-white/30">클럽의 격조에 어울리는 대회 방식을 선택하세요.</p>
      </section>

      {/* Mode Cards */}
      <section className="space-y-6">
        {modes.map((mode) => (
          <button 
            key={mode.id}
            className={`
              w-full bg-[#1A253D] border border-white/5 rounded-[32px] p-8 text-left relative overflow-hidden group
              hover:border-[#D4AF37]/30 active:scale-[0.97] transition-all
            `}
          >
            {/* Background Decor */}
            <div className="absolute -bottom-4 -right-4 text-9xl opacity-5 group-hover:scale-110 transition-transform duration-500 text-white">
              {mode.icon}
            </div>
            
            <span className="text-4xl mb-4 block">{mode.icon}</span>
            <div className="relative z-10">
              <h3 className="text-xl font-black mb-1 group-hover:text-[#D4AF37] transition-colors">{mode.title}</h3>
              <p className="text-xs font-bold text-white/40 leading-snug max-w-[80%]">
                {mode.description}
              </p>
            </div>
            
            <div className="absolute top-6 right-6 w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-[#D4AF37]/50 transition-colors">
              <span className="text-lg group-hover:text-[#D4AF37]">→</span>
            </div>
          </button>
        ))}
      </section>

      {/* Footer */}
      <footer className="mt-12 py-6 border-t border-white/5 opacity-30 flex flex-col items-center">
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase mb-1">Teyeon Championship Framework</p>
        <p className="text-[9px] font-bold tracking-widest text-[#D4AF37]">The Art of Tennis Competition</p>
      </footer>
    </main>
  );
}
