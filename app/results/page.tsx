'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function ResultsPage() {
  const [matches, setMatches] = useState<any[]>([]);
  const [sessionTitle, setSessionTitle] = useState("");
  const [attendeeConfigs, setAttendeeConfigs] = useState<any>({});
  const [activeTab, setActiveTab] = useState<'matches' | 'ranking'>('matches');
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    fetchActiveSession();
    const interval = setInterval(fetchActiveSession, 10000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, []);

  async function fetchActiveSession() {
    try {
        const { data: sessions } = await supabase
            .from('kdk_sessions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1);

        if (sessions && sessions[0]) {
            const s = sessions[0];
            setSessionId(s.id);
            setSessionTitle(s.title);
            setAttendeeConfigs(s.attendee_configs || {});
            setMatches(s.matches || []);
        }
    } catch (err) {
        console.error("Fetch Error:", err);
    } finally {
        setLoading(false);
    }
  }

  const formatName = (pid: string) => {
    const config = attendeeConfigs[pid];
    if (!config) return pid.startsWith('g-') ? 'GUEST' : '???';
    return `${config.nickname || config.name}${config.is_guest ? ' (G)' : ''}`;
  };

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#14141F] text-white font-sans max-w-md mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-black tracking-tight">실시간 대진표 확인</h1>
        <div className="w-10"></div>
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

      {/* Navigation Tabs */}
      <div className="flex bg-white/5 p-1 rounded-2xl mb-8 border border-white/5">
        <button 
          onClick={() => setActiveTab('matches')}
          className={`flex-1 py-3 text-[12px] font-black rounded-xl transition-all ${activeTab === 'matches' ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-white/40'}`}
        >
          현재 대진 현황
        </button>
        <button 
          onClick={() => setActiveTab('ranking')}
          className={`flex-1 py-3 text-[12px] font-black rounded-xl transition-all ${activeTab === 'ranking' ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-white/40'}`}
        >
          실시간 랭킹
        </button>
      </div>

      {activeTab === 'matches' ? (
        <section className="space-y-4 animate-in fade-in duration-300 pb-20">
          {loading ? (
            <div className="py-20 text-center text-[#D4AF37] font-black italic animate-pulse">CONNECTING TO COURT...</div>
          ) : matches.length === 0 ? (
            <div className="text-center py-20 opacity-30">
              <span className="text-4xl mb-4 block">🏟️</span>
              <p className="text-sm font-bold">진행 중인 대진이 없습니다.<br/>운영진의 승인을 기다려주세요.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="text-center mb-2">
                 <span className="text-[10px] font-black text-[#D4AF37]/60 uppercase tracking-[0.3em]">{sessionTitle}</span>
              </div>
              
              {/* Active Matches First */}
              {matches.filter(m => m.status === 'playing').length > 0 ? (
                <div className="space-y-3">
                   <h2 className="text-[9px] font-black text-[#2563EB] tracking-widest pl-2 uppercase">Now Playing</h2>
                   {matches.filter(m => m.status === 'playing').map((m, idx) => (
                      <div key={m.id} className="bg-gradient-to-br from-[#1A253D] to-[#2563EB]/20 border border-[#2563EB]/30 rounded-[32px] p-6 shadow-xl relative overflow-hidden">
                         <div className="flex justify-between items-center mb-4">
                            <span className="text-[9px] font-extrabold text-[#D4AF37] tracking-widest">COURT {idx+1}</span>
                            <span className="text-[8px] font-black bg-[#2563EB] text-white px-2 py-0.5 rounded tracking-widest">LIVE</span>
                         </div>
                         <div className="flex items-center justify-between">
                            <div className="flex-1 text-center font-black text-xs text-white/90">{formatName(m.playerIds[0])}<br/>{formatName(m.playerIds[1])}</div>
                            <div className="px-4 text-white/20 font-black italic">VS</div>
                            <div className="flex-1 text-center font-black text-xs text-white/90">{formatName(m.playerIds[2])}<br/>{formatName(m.playerIds[3])}</div>
                         </div>
                      </div>
                   ))}
                </div>
              ) : (
                <div className="bg-white/[0.02] border border-dashed border-white/5 rounded-3xl p-10 text-center opacity-20">
                   <span className="text-xs font-black uppercase tracking-widest">Waiting for Next Deploy</span>
                </div>
              )}

              {/* Waiting Summary */}
              {matches.filter(m => m.status === 'waiting').length > 0 && (
                <div className="bg-white/5 border border-white/5 rounded-3xl p-6">
                   <h2 className="text-[9px] font-black text-white/30 tracking-widest mb-4 uppercase">Upcoming Sessions</h2>
                   <div className="grid grid-cols-1 gap-2">
                      {matches.filter(m => m.status === 'waiting').slice(0, 5).map((m, idx) => (
                        <div key={m.id} className="flex items-center justify-between text-[11px] font-bold text-white/50 border-b border-white/5 pb-2">
                           <span className="text-[8px] opacity-30">#{idx+1}</span>
                           <span>{formatName(m.playerIds[0])}/{formatName(m.playerIds[1])} vs {formatName(m.playerIds[2])}/{formatName(m.playerIds[3])}</span>
                        </div>
                      ))}
                   </div>
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="animate-in slide-in-from-right duration-300 h-[65vh] overflow-hidden rounded-3xl border border-white/5 shadow-2xl">
           {sessionId ? (
             <iframe 
                src={`/kdk/ranking?session=${sessionId}&embed=true`}
                className="w-full h-full border-none"
             />
           ) : (
             <div className="flex items-center justify-center h-full opacity-20">No Active Leaderboard</div>
           )}
        </section>
      )}

      {/* Footer Button */}
      {activeTab === 'ranking' && sessionId && (
        <Link href={`/kdk/ranking?session=${sessionId}`} className="block w-full text-center py-5 bg-[#D4AF37] text-black font-black text-[13px] uppercase tracking-[0.2em] rounded-[24px] shadow-lg active:scale-95 transition-all mt-4">
          전체 실시간 순위 보기 →
        </Link>
      )}

      {/* Footer */}
      <footer className="mt-10 py-6 opacity-30 flex justify-center">
        <p className="text-[10px] font-bold tracking-[0.3em] uppercase">Teyeon v2.0 • Pro Statistics</p>
      </footer>
    </main>
  );
}
