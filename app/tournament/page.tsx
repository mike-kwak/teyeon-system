'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Trophy, Calendar, Settings, Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function TournamentPage() {
  const { role } = useAuth();
  const isAdmin = role === 'CEO' || role === 'ADMIN';

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a0b] via-[#121214] to-[#0a0a0b] text-white font-sans w-full relative pb-40 overflow-x-hidden">
      
      {/* Header Section */}
      <header className="px-6 pt-8 pb-4 flex flex-col gap-6 sticky top-0 bg-[#0a0a0b]/80 backdrop-blur-xl z-[100] border-b border-white/5">
        <div className="flex items-center justify-between">
          <Link 
            href="/"
            className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-all text-white/60 hover:text-white"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2 px-4 py-1.5 bg-[#C9B075]/10 rounded-full border border-[#C9B075]/20 shadow-[0_0_15px_rgba(201,176,117,0.1)]">
            <span className="w-2 h-2 rounded-full bg-[#C9B075] animate-pulse" />
            <span className="text-[10px] font-black text-[#C9B075] tracking-[0.2em] uppercase">Selection Hub</span>
          </div>
        </div>

        <div className="flex flex-col gap-1 px-2">
          <h1 className="text-4xl font-black italic text-white tracking-tighter uppercase leading-none">SPECIAL MATCHES</h1>
          <p className="text-[12px] font-bold text-white/30 tracking-widest uppercase mt-1">Select your optimized tournament protocol</p>
        </div>
      </header>

      {/* Mode Selection Grid */}
      <div className="px-6 pt-10 space-y-8 max-w-lg mx-auto w-full">
        
        {/* 1. Manual Mode (ACTIVE) */}
        <Link href={isAdmin ? "/tournament/manual" : "#"} className={`block group ${!isAdmin ? 'cursor-not-allowed' : ''}`}>
          <div className={`relative min-h-[180px] h-auto rounded-[28px] p-8 flex flex-col justify-between overflow-hidden transition-all ${isAdmin ? 'bg-[#1A1C20] border-2 border-[#C9B075]/40 shadow-[0_20px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(201,176,117,0.05)] active:scale-95' : 'bg-white/[0.02] border border-white/5 opacity-60'}`}>
            {!isAdmin && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center">
                    <div className="flex items-center gap-2 px-4 py-2 bg-black/60 rounded-full border border-white/10">
                        <Lock size={14} className="text-[#C9B075]" />
                        <span className="text-[10px] font-black text-white/60 uppercase tracking-widest">Administrator Only</span>
                    </div>
                </div>
            )}

            <div className="absolute inset-0 bg-gradient-to-br from-[#C9B075]/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="flex items-start justify-between relative z-10 gap-4">
              <div className="flex flex-col gap-2 flex-1 pt-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 text-[9px] font-black rounded-full uppercase tracking-tighter ${isAdmin ? 'bg-[#C9B075] text-black shadow-[0_0_15px_rgba(201,176,117,0.3)]' : 'bg-white/10 text-white/40'}`}>
                    {isAdmin ? 'Lab Active' : 'Restricted'}
                  </span>
                </div>
                <h2 className={`text-[28px] font-black italic tracking-tight uppercase transition-colors leading-none my-1 ${isAdmin ? 'text-white group-hover:text-[#C9B075]' : 'text-white/40'}`}>Manual Mode</h2>
                <p className={`text-[12px] font-bold leading-snug ${isAdmin ? 'text-[#C9B075]/80' : 'text-white/20'}`}>수동 매칭 및 직접 점수 입력</p>
              </div>
              <div className={`w-14 h-14 shrink-0 rounded-[20px] flex items-center justify-center border transition-transform mt-1 ${isAdmin ? 'bg-[#C9B075]/20 border-[#C9B075]/30 group-hover:scale-110 shadow-[inset_0_0_20px_rgba(201,176,117,0.1)]' : 'bg-white/5 border-white/10'}`}>
                <Settings size={28} className={isAdmin ? 'text-[#C9B075]' : 'text-white/20'} />
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-5 relative z-10">
              <p className={`text-[11px] font-medium leading-relaxed max-w-[240px] ${isAdmin ? 'text-white/40' : 'text-white/10'}`}>
                사용자가 직접 대진표를 짜고<br />점수를 입력하는 자율 제어 시스템입니다.
              </p>

              <div className={`flex justify-end items-center font-black text-[13px] tracking-widest uppercase gap-3 transition-transform ${isAdmin ? 'text-[#C9B075] group-hover:translate-x-2' : 'text-white/10'}`}>
                {isAdmin ? 'PROTOCOL START' : 'LOCKED'} <ArrowLeft size={16} className="rotate-180" />
              </div>
            </div>
          </div>
        </Link>

        {/* 2. Monthly Match (COMING SOON) */}
        <div className="relative min-h-[180px] h-auto rounded-[28px] p-8 flex flex-col justify-between overflow-hidden bg-white/[0.03] border border-white/5 opacity-50 grayscale">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px] z-20 flex flex-col items-center justify-center gap-2 px-10 text-center">
            <span className="px-6 py-2 bg-[#C9B075]/20 border border-[#C9B075]/40 rounded-full text-[#C9B075] font-black text-[12px] tracking-[0.4em] uppercase italic shadow-[0_0_20px_rgba(201,176,117,0.2)]">Coming Soon</span>
            <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-2">Expected Alpha Q2 2026</p>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2 flex-1 pt-1">
              <h2 className="text-[28px] font-black italic text-white/40 tracking-tight uppercase leading-none">Monthly Match</h2>
              <p className="text-[12px] font-bold text-white/20 leading-snug">테연 월례회 전용 자동 시스템</p>
            </div>
            <div className="w-14 h-14 shrink-0 bg-white/5 rounded-[20px] flex items-center justify-center border border-white/10 opacity-30 mt-1">
              <Calendar size={28} className="text-white" />
            </div>
          </div>

          <p className="text-[11px] font-medium text-white/10 leading-relaxed max-w-[240px] mt-8">
            테연 정기 월례회 전용<br />자동 대진 및 정산 시스템입니다.
          </p>
        </div>

        {/* 3. Tournament Mode (COMING SOON) */}
        <div className="relative min-h-[180px] h-auto rounded-[28px] p-8 flex flex-col justify-between overflow-hidden bg-white/[0.03] border border-white/5 opacity-50 grayscale">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px] z-20 flex flex-col items-center justify-center gap-2 px-10 text-center">
            <span className="px-6 py-2 bg-[#C9B075]/20 border border-[#C9B075]/40 rounded-full text-[#C9B075] font-black text-[12px] tracking-[0.4em] uppercase italic shadow-[0_0_20px_rgba(201,176,117,0.2)]">Coming Soon</span>
            <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-2">Under Development</p>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2 flex-1 pt-1">
              <h2 className="text-[28px] font-black italic text-white/40 tracking-tight uppercase leading-none">Tournament</h2>
              <p className="text-[12px] font-bold text-white/20 leading-snug">강력한 자동 토너먼트 빌더</p>
            </div>
            <div className="w-14 h-14 shrink-0 bg-white/5 rounded-[20px] flex items-center justify-center border border-white/10 opacity-30 mt-1">
              <Trophy size={28} className="text-white" />
            </div>
          </div>

          <p className="text-[11px] font-medium text-white/10 leading-relaxed max-w-[240px] mt-8">
            대진표 자동 생성부터<br />최종 우승자 선출까지 한 번에 관리합니다.
          </p>
        </div>

      </div>

      {/* Decorative Background Elements */}
      <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-[#C9B075]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
      <div className="fixed bottom-0 left-0 w-[400px] h-[400px] bg-[#C9B075]/3 rounded-full blur-[100px] -z-10 pointer-events-none" />

    </main>
  );
}
