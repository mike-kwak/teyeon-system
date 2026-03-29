'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Match, Player, calculateRankings, PlayerStats } from '@/lib/kdk';

export default function RankingPage() {
  const [stats, setStats] = useState<PlayerStats[]>([]);

  useEffect(() => {
    const savedMatches = localStorage.getItem('teyeon_matches');
    const savedPlayers = localStorage.getItem('teyeon_players');
    if (savedMatches && savedPlayers) {
      const matches: Match[] = JSON.parse(savedMatches);
      const players: Player[] = JSON.parse(savedPlayers);
      const rankings = calculateRankings(matches, players);
      setStats(rankings);
    } else {
      // Fallback Dummy Data for UI Demo
      setStats([
        { name: '곽민섭', wins: 5, losses: 1, ptsDiff: 12, matches: 6, rank: 1, isGuest: false },
        { name: '홍길동', wins: 4, losses: 2, ptsDiff: 8, matches: 6, rank: 2, isGuest: false },
        { name: '김철수', wins: 4, losses: 2, ptsDiff: 5, matches: 6, rank: 3, isGuest: false },
        { name: '박지성', wins: 3, losses: 3, ptsDiff: 2, matches: 6, rank: 4, isGuest: false },
        { name: '손흥민', wins: 2, losses: 4, ptsDiff: -3, matches: 6, rank: 5, isGuest: false },
        { name: 'Guest 1', wins: 1, losses: 5, ptsDiff: -15, matches: 6, rank: 6, isGuest: true },
      ]);
    }
  }, []);

  const getRankBadge = (rank: number) => {
    if (rank === 1) return '👑';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return rank;
  };

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#1E1E2E] text-white font-sans max-w-screen-xl mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
          실시간 랭킹 <span className="text-[#D4AF37]">●</span>
        </h1>
        <div className="w-10"></div>
      </header>

      {/* Period Tabs */}
      <div className="flex bg-white/5 p-1 rounded-2xl mb-8 border border-white/5">
        {['주간', '월간', '연간', '전체'].map((tab) => (
          <button
            key={tab}
            className={`
              flex-1 py-2 text-[11px] font-black rounded-xl transition-all
              ${tab === '전체' ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-white/40 hover:text-white'}
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Top 3 Podium Cards */}
      <div className="flex justify-center items-end gap-2 mb-10 h-48">
        {/* 2nd Place */}
        {stats[1] && (
          <div className="flex-1 bg-gradient-to-t from-[#B4B4B4]/20 to-[#E5E4E2]/40 border border-[#E5E4E2]/30 rounded-t-2xl p-3 flex flex-col items-center justify-end h-[85%] relative overflow-hidden">
            <div className="absolute top-2 text-2xl">🥈</div>
            <div className="text-[12px] font-black mb-1 truncate w-full text-center">{stats[1].name}</div>
            <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[10px] font-black">2ND</div>
          </div>
        )}
        
        {/* 1st Place */}
        {stats[0] && (
          <div className="flex-1 bg-gradient-to-t from-[#FF8C00]/30 to-[#FFD700]/50 border-2 border-[#FFD700] rounded-t-3xl p-3 flex flex-col items-center justify-end h-full relative overflow-hidden shadow-[0_10px_30px_rgba(255,215,0,0.2)]">
            <div className="absolute top-2 text-4xl animate-bounce">👑</div>
            <div className="text-[14px] font-black mb-2 truncate w-full text-center">{stats[0].name}</div>
            <div className="w-10 h-10 rounded-full bg-[#FFD700] text-black flex items-center justify-center text-[12px] font-black shadow-[0_0_15px_rgba(255,215,0,0.5)]">1ST</div>
          </div>
        )}

        {/* 3rd Place */}
        {stats[2] && (
          <div className="flex-1 bg-gradient-to-t from-[#8B4513]/20 to-[#CD7F32]/40 border border-[#CD7F32]/30 rounded-t-2xl p-3 flex flex-col items-center justify-end h-[75%] relative overflow-hidden">
            <div className="absolute top-2 text-2xl">🥉</div>
            <div className="text-[12px] font-black mb-1 truncate w-full text-center">{stats[2].name}</div>
            <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[10px] font-black">3RD</div>
          </div>
        )}
      </div>

      {/* Leaderboard List */}
      <section className="space-y-3">
        {stats.map((s) => (
          <div 
            key={s.name}
            className={`
              flex items-center justify-between p-4 rounded-2xl border transition-all
              ${s.rank === 1 ? 'bg-gradient-to-r from-[#FFD700]/20 to-transparent border-[#FFD700]' : 
                s.rank === 2 ? 'bg-gradient-to-r from-[#E5E4E2]/20 to-transparent border-[#E5E4E2]/40' :
                s.rank === 3 ? 'bg-gradient-to-r from-[#CD7F32]/20 to-transparent border-[#CD7F32]/40' :
                'bg-white/5 border-white/5'}
            `}
          >
            <div className="flex items-center gap-4">
              <div className={`
                w-10 h-10 rounded-full flex items-center justify-center font-black text-lg
                ${s.rank <= 3 ? 'bg-white/10' : 'bg-white/5 text-white/40 border border-white/10'}
              `}>
                {getRankBadge(s.rank)}
              </div>
              <div>
                <div className="font-black text-base flex items-center gap-2">
                  {s.name}
                  {s.isGuest && <span className="text-[9px] px-1.5 py-0.5 bg-black/20 rounded-md font-bold uppercase tracking-tighter opacity-70">Guest</span>}
                </div>
                <div className={`text-[10px] font-bold ${s.rank <= 3 ? 'opacity-80' : 'text-white/40'}`}>
                  {s.wins}승 {s.losses}패 • 득실차 {s.ptsDiff > 0 ? `+${s.ptsDiff}` : s.ptsDiff}
                </div>
              </div>
            </div>
            
            <div className="text-right flex items-center gap-4">
              <div className="h-8 w-px bg-white/5 mx-2"></div>
              <div>
                <div className="text-[9px] font-black opacity-30 uppercase tracking-widest leading-none mb-1">Win Rate</div>
                <div className="text-sm font-black text-[#D4AF37]">
                  {s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0}%
                </div>
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Footer Info */}
      <footer className="mt-auto py-10 flex justify-center opacity-30">
        <p className="text-[10px] font-bold tracking-widest uppercase">Teyeon v2.0 • Real-time Leaderboard</p>
      </footer>
    </main>
  );
}
