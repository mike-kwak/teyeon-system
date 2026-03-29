'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

import { useSearchParams, useRouter } from 'next/navigation';

interface Member {
  id: string;
  nickname: string;
  role?: string;
  position?: string;
  birthdate?: string;
  is_guest?: boolean;
  matches_played: number;
  wins: number;
  losses: number;
  score_diff: number;
  group?: 'A' | 'B';
}

type SortCriteria = 'wins' | 'score_diff' | 'age';

export default function RankingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  
  const [members, setMembers] = useState<Member[]>([]);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'TOTAL' | 'A' | 'B'>('TOTAL');
  const [sortOrder, setSortOrder] = useState<SortCriteria[]>(['wins', 'score_diff', 'age']);
  const [showSettings, setShowSettings] = useState(false);

  const BANK_INFO = "카카오뱅크 3333-01-1234567 (총무 전용원)";
  const GUEST_FEE = 5000;

  useEffect(() => {
    fetchRankings();
    
    // Auto-refresh for Live Mode
    let interval: NodeJS.Timeout;
    if (sessionId) {
        interval = setInterval(fetchRankings, 5000);
    }
    return () => clearInterval(interval);
  }, [sessionId]);

  async function fetchRankings() {
    try {
      setLoading(true);
      
      if (sessionId) {
          // Compute from Session
          const { data: session } = await supabase.from('kdk_sessions').select('*').eq('id', sessionId).single();
          if (session) {
              setSessionTitle(session.title);
              const { data: allMembers } = await supabase.from('members').select('*');
              const memberMap: Record<string, Member> = {};
              
              const mList = (session.matches || []).filter((m: any) => m.status === 'complete' || m.status === 'done');
              
              if (mList.length === 0) {
                  setMembers([]);
                  setLoading(false);
                  return;
              }

               mList.forEach((m: any) => {
                  const diff = (m.score1 || 0) - (m.score2 || 0);
                  m.playerIds.forEach((pid: string, idx: number) => {
                      if (!memberMap[pid]) {
                          const base = allMembers?.find(am => am.id === pid) || { nickname: pid.startsWith('g-') ? 'Guest' : pid };
                          const config = session.attendee_configs?.[pid];
                          memberMap[pid] = { 
                              id: pid, 
                              nickname: base.nickname || pid, 
                              birthdate: base.birthdate,
                              matches_played: 0, wins: 0, losses: 0, score_diff: 0,
                              group: config?.group || 'A'
                          };
                      }
                      const won = idx < 2 ? diff > 0 : diff < 0;
                      memberMap[pid].matches_played++;
                      memberMap[pid].wins += won ? 1 : 0;
                      memberMap[pid].losses += won ? 0 : 1;
                      memberMap[pid].score_diff += (idx < 2 ? diff : -diff);
                  });
              });
              setMembers(Object.values(memberMap));
              return;
          }
      }

      // Default Global Rankings
      const { data, error } = await supabase.from('members').select('*');
      if (error) throw error;
      if (data) setMembers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("계좌번호가 복사되었습니다!");
  };

  const toggleSortPriority = (criteria: SortCriteria) => {
    setSortOrder(prev => {
        const remaining = prev.filter(c => c !== criteria);
        return [criteria, ...remaining];
    });
  };

  const integratedSortedMembers = useMemo(() => {
    let active = [...members].filter(m => (m.matches_played || 0) > 0);
    return active.sort((a, b) => {
      for (const criteria of sortOrder) {
        if (criteria === 'wins') {
          if ((b.wins || 0) !== (a.wins || 0)) return (b.wins || 0) - (a.wins || 0);
        }
        if (criteria === 'score_diff') {
          if ((b.score_diff || 0) !== (a.score_diff || 0)) return (b.score_diff || 0) - (a.score_diff || 0);
        }
        if (criteria === 'age') {
          if (a.birthdate !== b.birthdate) return (b.birthdate || '').localeCompare(a.birthdate || '');
        }
      }
      return a.nickname.localeCompare(b.nickname, 'ko');
    });
  }, [members, sortOrder]);

  const displaySortedMembers = useMemo(() => {
    let filtered = [...integratedSortedMembers];
    if (activeTab === 'A') filtered = filtered.filter(m => m.group === 'A');
    if (activeTab === 'B') filtered = filtered.filter(m => m.group === 'B');
    return filtered;
  }, [integratedSortedMembers, activeTab]);

  const getFinancials = (m: Member) => {
    if (m.is_guest || m.nickname.includes('(G)') || m.id.startsWith('g-')) {
        return { label: 'GUEST FEE', amount: `-${GUEST_FEE.toLocaleString()}`, color: 'text-white/40' };
    }
    
    // Find index in integrated list for consistent penalty application
    const globalIndex = integratedSortedMembers.findIndex(sm => sm.id === m.id);
    const total = integratedSortedMembers.length;

    if (globalIndex === 0) return { label: 'WINNER', amount: '+10,000', color: 'text-[#D4AF37]' };
    
    const bottom25 = Math.floor(total * 0.75);
    const bottom50 = Math.floor(total * 0.5);

    if (globalIndex >= bottom25) return { label: 'PENALTY (L2)', amount: '-5,000', color: 'text-red-500' };
    if (globalIndex >= bottom50) return { label: 'PENALTY (L1)', amount: '-3,000', color: 'text-orange-500' };
    
    return { label: '-', amount: '0', color: 'text-white/10' };
  };

  const mvp = integratedSortedMembers[0];

  return (
    <main className="flex flex-col min-h-screen bg-[#0A0A0F] text-white font-sans max-w-screen-xl mx-auto pb-20">
      <header className="sticky top-0 z-30 bg-[#14141F]/80 backdrop-blur-xl p-6 flex items-center justify-between border-b border-white/5">
        <button onClick={() => router.back()} className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-95">
          <span className="text-xl">←</span>
        </button>
        <div className="flex flex-col items-center">
            <div className="flex items-center gap-2">
                <h1 className="text-xl font-black italic tracking-tighter">LEADERBOARD</h1>
                {sessionId && <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>}
            </div>
            {sessionTitle && <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-widest">{sessionTitle}</span>}
        </div>
        <button onClick={() => setShowSettings(true)} className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full border border-white/10 active:scale-95">
           <span className="text-lg">⚙️</span>
        </button>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="w-12 h-12 border-2 border-white/5 border-t-[#D4AF37] rounded-full animate-spin"></div>
        </div>
      ) : integratedSortedMembers.length > 0 ? (
        <>
          {sessionTitle && (
            <div className="mx-6 mt-4 p-4 bg-[#D4AF37]/10 border border-[#D4AF37]/30 rounded-[20px] flex items-center justify-center gap-3 animate-bounce">
                <span className="text-xl">🎊</span>
                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.2em]">{sessionTitle} 정산 완료!</span>
            </div>
          )}
          <section className="p-6 text-center">
             <div className="relative group overflow-hidden bg-gradient-to-br from-[#D4AF37] to-[#8B7500] rounded-[40px] p-8 flex flex-col items-center shadow-[0_20px_60px_rgba(212,175,55,0.3)]">
                <div className="absolute top-0 right-0 p-6 opacity-10 text-8xl italic font-black">MVP</div>
                <span className="text-[10px] font-black text-black/50 tracking-[0.4em] uppercase mb-4">Supreme Champion</span>
                <div className="w-24 h-24 bg-black/10 rounded-full flex items-center justify-center text-5xl mb-4 border border-black/5">👑</div>
                <h2 className="text-4xl font-black text-black tracking-tight mb-2">{mvp.nickname}{mvp.is_guest ? ' (G)' : ''}</h2>
                <div className="flex gap-8 items-center bg-black/5 px-8 py-3 rounded-2xl mt-2 border border-black/5">
                    <div className="flex flex-col items-center">
                        <span className="text-[8px] font-black text-black/40 uppercase">Record</span>
                        <span className="text-xl font-black text-black">{mvp.wins}W {mvp.losses}L</span>
                    </div>
                    <div className="w-px h-8 bg-black/10"></div>
                    <div className="flex flex-col items-center">
                        <span className="text-[8px] font-black text-black/40 uppercase">Diff</span>
                        <span className="text-xl font-black text-black">+{mvp.score_diff}</span>
                    </div>
                </div>
             </div>
          </section>

          <div className="px-6 flex gap-2 mb-6">
               {['TOTAL', 'A', 'B'].map((tab) => (
                   <button 
                    key={tab} 
                    onClick={() => setActiveTab(tab as any)}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black tracking-widest transition-all ${activeTab === tab ? 'bg-white text-black shadow-lg scale-[1.05]' : 'bg-white/5 border border-white/5 text-white/30'}`}
                   >
                    {tab} GROUP
                   </button>
               ))}
          </div>

          <section className="px-6 space-y-3 pb-10">
             {displaySortedMembers.map((m, idx) => {
                 const finance = getFinancials(m);
                 return (
                    <div key={m.id} className={`group flex items-center justify-between p-5 rounded-[28px] border transition-all ${idx === 0 ? 'bg-white/5 border-[#D4AF37]/50 shadow-lg scale-[1.02]' : 'bg-white/[0.02] border-white/5'}`}>
                        <div className="flex items-center gap-5">
                            <span className={`text-sm font-black italic ${idx < 3 ? 'text-[#D4AF37]' : 'text-white/10'}`}>
                                {idx + 1 < 10 ? `0${idx + 1}` : idx + 1}
                            </span>
                            <div className="flex flex-col">
                                <span className="text-base font-black tracking-tight">{m.nickname}{m.is_guest ? ' (G)' : ''}</span>
                                <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">{m.wins}Wins • {m.score_diff > 0 ? '+' : ''}{m.score_diff} Diff</span>
                            </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className={`text-base font-black ${finance.color}`}>{finance.amount}</span>
                            <span className="text-[8px] font-black tracking-tighter opacity-20 uppercase">{finance.label}</span>
                        </div>
                    </div>
                 );
             })}
          </section>

          <div className="m-6 p-8 bg-gradient-to-br from-[#1E1E2E] to-[#14141F] border border-white/5 rounded-[40px] flex flex-col items-center gap-6 shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-[#D4AF37] opacity-20"></div>
                <div className="flex flex-col items-center gap-2">
                    <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase">Club Treasury</span>
                    <p className="text-xs font-bold text-white/70 italic">{BANK_INFO}</p>
                </div>
                <button 
                    onClick={() => copyToClipboard(BANK_INFO)}
                    className="flex items-center gap-3 bg-white/5 border border-white/10 px-8 py-4 rounded-2xl active:scale-95 transition-all text-xs font-black uppercase tracking-widest hover:bg-white/10"
                >
                    <span>📋 계좌번호 복사하기</span>
                </button>
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center opacity-10 py-40 text-center px-10">
            <span className="text-8xl mb-4">⏳</span>
            <p className="text-lg font-black italic uppercase tracking-widest leading-tight">No Finished Matches<br/>in this session yet</p>
            <p className="text-[10px] font-bold mt-2 text-white/40">Results will appear as soon as the first score is recorded.</p>
        </div>
      )}

      {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <div className="absolute inset-0 bg-black/95 backdrop-blur-2xl" onClick={() => setShowSettings(false)}></div>
              <div className="relative bg-[#1A1A2E] border border-white/10 rounded-[40px] p-10 w-full max-w-sm flex flex-col gap-8 shadow-2xl">
                  <header className="flex flex-col items-center gap-2 text-white">
                    <span className="text-[10px] font-black text-[#D4AF37] tracking-[0.3em] uppercase">Ranking Logic</span>
                    <h3 className="text-xl font-black italic">RANKING PRIORITY</h3>
                    <p className="text-[9px] text-white/30 text-center">Click a criteria to set it as 1st priority</p>
                  </header>

                  <div className="flex flex-col gap-3">
                      {sortOrder.map((s, i) => (
                          <button 
                            key={s} 
                            onClick={() => toggleSortPriority(s)}
                            className={`flex items-center justify-between p-5 rounded-2xl border transition-all ${i === 0 ? 'bg-[#D4AF37] border-[#D4AF37] text-black font-black' : 'bg-white/5 border-white/10 text-white/40'}`}
                          >
                              <span className="text-xs font-black uppercase tracking-widest">{i + 1}. {s === 'wins' ? '승수' : s === 'score_diff' ? '득실차' : '연소자 (Age)'}</span>
                              {i === 0 && <span className="text-[10px] font-black">TOP</span>}
                          </button>
                      ))}
                  </div>

                  <button onClick={() => setShowSettings(false)} className="w-full py-5 bg-white/5 border border-white/10 text-white font-black rounded-[28px] active:scale-95">
                      닫기
                  </button>
              </div>
          </div>
      )}
    </main>
  );
}
