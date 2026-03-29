'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function LiveCourtPage() {
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLiveMatches();
    const interval = setInterval(fetchLiveMatches, 5000); // 5s auto-refresh for live
    return () => clearInterval(interval);
  }, []);

  async function fetchLiveMatches() {
    try {
        const { data: liveMatches, error } = await supabase
            .from('matches')
            .select('*')
            .eq('status', 'playing')
            .order('court', { ascending: true });

        if (error) throw error;
        setMatches(liveMatches || []);
    } catch (err) {
        console.error("Live Fetch Error:", err);
    } finally {
        setLoading(false);
    }
  }

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#000000] text-white font-sans max-w-screen-xl mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-[1000] italic tracking-tighter uppercase">
            LIVE <span className="text-[#D4AF37]">COURT</span>
        </h1>
        <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse border-2 border-red-500/20"></div>
      </header>

      {/* Match Rules */}
      <section className="bg-[#D4AF37]/5 border border-[#D4AF37]/20 rounded-2xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[#D4AF37] text-sm italic font-black">📋 경기 안내</span>
        </div>
        <ul className="text-[11px] font-bold text-white/50 space-y-1 list-disc list-inside">
          <li>운영진이 입력하는 <span className="text-[#D4AF37]">실시간 스코어</span>가 표시됩니다.</li>
          <li>듀스 발생 시 <span className="text-[#D4AF37]">노애드(No-Ad)</span> 포인트를 적용합니다.</li>
          <li>자신의 코트 번호와 입실 시간을 확인해 주세요.</li>
        </ul>
      </section>

      {/* Match Results */}
      <section className="space-y-4 animate-in fade-in duration-300 pb-20">
        {loading ? (
          <div className="py-20 text-center text-[#D4AF37] font-black italic animate-pulse tracking-widest">
            CONNECTING TO LIVE COURT...
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-24 opacity-30 flex flex-col items-center">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-6">
                <span className="text-3xl">🏟️</span>
            </div>
            <p className="text-sm font-bold uppercase tracking-widest text-white/60">
                진행 중인 경기가 없습니다.<br/>
                <span className="text-[10px] opacity-40">NEXT MATCH COMING SOON</span>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between px-2">
                <h2 className="text-[10px] font-black text-[#D4AF37] tracking-[0.4em] uppercase">Active Matches</h2>
                <span className="text-[9px] font-black bg-[#D4AF37]/10 text-[#D4AF37] px-2 py-1 rounded border border-[#D4AF37]/20">
                    {matches.length} ON COURT
                </span>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
                {matches.map((m, idx) => {
                  const pNames = m.player_names || m.playerNames || []; // Fallback handling
                  // If player_names is not in DB, it might be in players JSON or similar
                  // For now, assume player_names exists or use a fallback
                  const t1 = pNames.slice(0, 2).join(' / ') || 'PLAYER 1 / 2';
                  const t2 = pNames.slice(2, 4).join(' / ') || 'PLAYER 3 / 4';

                  return (
                    <div key={m.id} className="bg-gradient-to-br from-[#1A253D] to-[#14141F] border border-white/10 rounded-[32px] p-8 shadow-2xl relative overflow-hidden group">
                        <div className="flex justify-between items-center mb-6">
                            <div className="px-3 py-1 bg-white/5 rounded-full border border-white/10">
                                <span className="text-[10px] font-[1000] text-[#D4AF37] italic tracking-widest">COURT {m.court || idx + 1}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                                <span className="text-[9px] font-black text-red-500 tracking-widest uppercase">Live Now</span>
                            </div>
                        </div>
                        
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-full text-center">
                                <p className="text-lg font-black text-white/90 tracking-tight leading-tight">{t1}</p>
                            </div>
                            
                            <div className="flex items-center gap-4 w-full">
                                <div className="h-px flex-1 bg-white/5"></div>
                                <span className="text-[10px] font-black italic text-white/20 tracking-[0.3em]">VS</span>
                                <div className="h-px flex-1 bg-white/5"></div>
                            </div>
                            
                            <div className="w-full text-center">
                                <p className="text-lg font-black text-white/90 tracking-tight leading-tight">{t2}</p>
                            </div>
                        </div>

                        {/* Visual Court Decoration */}
                        <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-[#D4AF37]/5 rounded-full blur-2xl group-hover:bg-[#D4AF37]/10 transition-all"></div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </section>

      {/* Footer Info */}
      <footer className="mt-auto py-8 border-t border-white/5 flex flex-col items-center opacity-20">
        <p className="text-[10px] font-black tracking-[0.3em] uppercase mb-1">Teyeon Club Management</p>
        <p className="text-[8px] font-bold tracking-widest text-[#D4AF37]">REAL-TIME COURT FEED</p>
      </footer>
    </main>
  );
}
