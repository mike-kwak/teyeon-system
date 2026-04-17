'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Trash2, ArrowRight, ArrowLeft } from 'lucide-react';

/**
 * ArchivePage (v1.14.6): THE GRAND ARCHIVE MASTER
 * - Premium Podium (RankingTab 스타일 이식, 상금 제거)
 * - Fallback Icon System (1위:🏆, 2위:🥈, 3위:🥉)
 * - High-Density Table (4위~ 사진 제거, 왼쪽 밀착 배치)
 * - Section Spacing Synchronization
 */
export default function ArchivePage() {
  const { user, role } = useAuth();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING'>('RECORDS');
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const CEO_EMAIL = process.env.NEXT_PUBLIC_CEO_EMAIL || 'cws786@nate.com';
  const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',');
  const isAdmin = (userEmail && (userEmail === CEO_EMAIL || ADMIN_EMAILS.includes(userEmail))) || role === 'ADMIN' || role === 'CEO';
  
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  useEffect(() => {
    checkUser();
    fetchArchives();
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl) setSelectedSessionId(sessionFromUrl);
  }, [searchParams]);

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserEmail(user.email || null);
  }

  async function fetchArchives() {
    try {
      setLoading(true);
      const { data, error } = await supabase
          .from('teyeon_archive_v1')
          .select('*')
          .order('created_at', { ascending: false });

      if (error) throw error;
      
      const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
      const combinedData: any[] = [...failovers.map((f:any) => ({...f, isLocal: true})), ...(data || [])];
      
      combinedData.sort((a,b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

      const reconstructedMatches: any[] = [];
      const seenIds = new Set();

      combinedData.forEach(record => {
          if (seenIds.has(record.id)) return;
          seenIds.add(record.id);

          const raw = record.raw_data || {};
          const matchesArr = raw.snapshot_data || [];
          matchesArr.forEach((m: any) => {
              const pIds = m.player_ids || m.playerIds || [];
              const meta = raw.player_metadata || {};
              const resolvedNames = m.player_names || pIds.map((pid: string) => meta[pid]?.name || 'Unknown');
              const resolvedAvatars = m.player_avatars || pIds.map((pid: string) => meta[pid]?.avatar || '');

              reconstructedMatches.push({
                  ...m,
                  session_id: record.id,
                  session_title: raw.title,
                  match_date: raw.date,
                  created_at: record.created_at,
                  isLocal: !!record.isLocal,
                  player_names: resolvedNames,
                  player_ids: pIds,
                  player_avatars: resolvedAvatars
              });
          });
      });
      setArchives(reconstructedMatches);
    } catch (err: any) {
      console.error("Archive Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = archives.filter(m => {
    const mDate = new Date(m.match_date);
    return mDate.getFullYear() === selectedYear && (mDate.getMonth() + 1) === selectedMonth;
  });

  const sessions = useMemo(() => {
    const groups: Record<string, any> = {};
    filteredRecords.forEach(m => {
        const title = m.session_title || "Untitled";
        const dateKey = m.match_date || 'nodate';
        const groupKey = `${title}_${dateKey}`;
        if (!groups[groupKey]) {
            groups[groupKey] = { id: m.session_id, title, date: m.match_date, created_at: m.created_at, matches: [], matchCount: 0 };
        }
        groups[groupKey].matches.push(m);
        groups[groupKey].matchCount++;
    });
    return Object.values(groups).sort((a:any, b:any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-[#0a0a0c] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      {/* 럭셔리 라인 헤더 (v1.14.6 MASTER) */}
      <header className="px-8 pt-24 pb-2 flex flex-col gap-1 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          {selectedSessionId ? (
              <button 
                onClick={() => setSelectedSessionId(null)}
                className="flex items-center gap-2 text-[#C9B075] mb-2 hover:translate-x-[-4px] transition-transform italic"
              >
                  <ArrowLeft size={16} />
                  <span className="text-[13px] font-[1000] uppercase tracking-widest">뒤로가기</span>
              </button>
          ) : (
            <span className="text-[11px] font-[1000] text-[#C9B075] uppercase tracking-[0.4em] italic drop-shadow-lg">SYSTEM RECORDS</span>
          )}
          <h1 className="text-4xl sm:text-5xl font-[1000] tracking-tighter uppercase italic text-white leading-none drop-shadow-xl">Archive</h1>
          <div className="h-[2px] w-full bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent mt-3 shadow-[0_4px_15px_rgba(201,176,117,0.3)]"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mt-4 mb-10 flex gap-2.5">
            {(['RECORDS', 'RANKING'] as const).map(t => (
                <button 
                    key={t} onClick={() => setMainTab(t)}
                    className={`flex-1 py-4 rounded-2xl text-[11px] font-[1000] uppercase tracking-widest transition-all relative overflow-hidden group italic ${mainTab === t ? 'bg-zinc-100 text-black shadow-xl shadow-white/5' : 'bg-zinc-900/50 border border-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
                >
                    {t === 'RECORDS' ? '경기 기록' : '테연 랭킹'}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-4">
        {loading ? (
            <div className="py-24 text-center">
                <p className="text-[12px] font-[1000] text-zinc-600 tracking-[0.4em] uppercase italic">Decrypting Vault...</p>
            </div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {/* 1. 세션 상세 보기 (Level 2) */}
                {selectedSessionId && selectedSession ? (
                    <div className="animate-in slide-in-from-right duration-500">
                        {/* 럭셔리 세션 헤더 */}
                        <div className="flex flex-col gap-2 px-6 mb-12">
                            <span className="text-[12px] font-[1000] text-[#C9B075] uppercase tracking-[0.4em] italic opacity-70">{selectedSession.date}</span>
                            <h2 className="text-2xl font-[1000] text-white tracking-tighter uppercase italic break-all leading-tight">{selectedSession.title}</h2>
                        </div>

                        {/* PREMIUM PODIUM (RankingTab 스타일 이식) */}
                        <div className="space-y-10">
                            <div className="flex items-center gap-4 px-6">
                                <h3 className="text-xl font-[1000] text-white uppercase tracking-tighter italic">RANKING UPDATES</h3>
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-[#C9B075]/20 to-transparent"></div>
                            </div>
                            
                            {(() => {
                                const stats: Record<string, { name: string, wins: number, losses: number, diff: number, pf: number, pa: number, avatar: string, played: number }> = {};
                                selectedSession.matches.forEach((m: any) => {
                                    const pNames = m.player_names || [];
                                    const pAvatars = m.player_avatars || [];
                                    pNames.forEach((name: string, i: number) => {
                                        if (!stats[name]) stats[name] = { name, wins: 0, losses: 0, diff: 0, pf: 0, pa: 0, avatar: pAvatars[i] || '', played: 0 };
                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                        const win = i < 2 ? (s1 > s2) : (s2 > s1);
                                        stats[name].played++;
                                        if (win) stats[name].wins++; else stats[name].losses++;
                                        stats[name].pf += (i < 2 ? s1 : s2);
                                        stats[name].pa += (i < 2 ? s2 : s1);
                                        stats[name].diff = stats[name].pf - stats[name].pa;
                                    });
                                });
                                const sortedResults = Object.values(stats).sort((a,b) => (b.wins - a.wins) || (b.diff - a.diff));
                                const top3 = sortedResults.slice(0, 3);

                                return (
                                    <>
                                        {/* PREMIUM GLASS PODIUM (Image 2 스타일) */}
                                        <div className="flex items-end justify-center gap-2 w-full px-2 max-w-2xl mx-auto mb-12">
                                            {[1, 0, 2].map((idx) => {
                                                const p = top3[idx];
                                                if (!p) return <div key={idx} className="flex-1 h-2" />;
                                                const isFirst = idx === 0;
                                                const widthClass = isFirst ? 'w-[45%]' : 'w-[28%]';
                                                const rankEmoji = idx === 0 ? '🏆' : (idx === 1 ? '🥈' : '🥉');
                                                
                                                return (
                                                    <div key={p.name} className={`relative ${widthClass} flex flex-col justify-end`}>
                                                        <div className="bg-white/5 backdrop-blur-3xl rounded-[30px] border-t border-t-white/20 border-l border-l-white/10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.2)] flex flex-col items-center pt-8 pb-6 w-full relative">
                                                            <div className={`
                                                                flex items-center justify-center rounded-full bg-white/5 backdrop-blur-3xl border border-white/20 relative shadow-2xl mb-4 overflow-hidden
                                                                ${isFirst ? 'w-16 h-16 border-[#C9B075]/40' : 'w-12 h-12'}
                                                            `}>
                                                                {p.avatar ? (
                                                                    <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <span className={`${isFirst ? 'text-4xl' : 'text-2xl'} select-none text-white/20 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]`}>
                                                                        {rankEmoji}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="flex flex-col items-center gap-2 w-full px-2">
                                                                <div className={`font-black text-white text-center truncate w-full tracking-tighter italic ${isFirst ? 'text-lg' : 'text-[12px]'}`}>
                                                                    {p.name}
                                                                </div>
                                                                <div className="flex items-center gap-1.5 font-black tracking-widest uppercase text-[9px] italic opacity-80">
                                                                    <span className="text-white">{p.wins}승 {p.losses}패</span>
                                                                    <span className="opacity-20">/</span>
                                                                    <span className={p.diff > 0 ? 'text-[#00e5ff]' : 'text-white'}>
                                                                        {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* HIGH-DENSITY DATA TABLE (v1.14.6 MASTER - 사진 제거, 밀도 압축) */}
                                        <div className="bg-zinc-900/30 border border-white/5 rounded-[30px] overflow-hidden backdrop-blur-3xl shadow-2xl mx-1">
                                            <table className="w-full text-left border-collapse">
                                                <thead className="bg-black/40 border-b border-white/5 italic">
                                                    <tr className="text-[9px] font-black text-zinc-700 uppercase tracking-widest">
                                                        <th className="px-4 py-5 text-center w-8">#</th>
                                                        <th className="px-1 py-5">PLAYER</th>
                                                        <th className="px-1 py-5 text-right w-6">P</th>
                                                        <th className="px-1 py-5 text-right w-6 text-cyan-500/80">W</th>
                                                        <th className="px-1 py-5 text-right w-5">L</th>
                                                        <th className="px-1 py-5 text-right w-7">PF</th>
                                                        <th className="px-1 py-5 text-right w-7">PA</th>
                                                        <th className="px-5 py-5 text-right w-12 tracking-tighter">+/-</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/[0.02]">
                                                    {sortedResults.slice(3).map((p, idx) => (
                                                        <tr key={p.name} className="hover:bg-white/[0.01] transition-colors group italic font-black">
                                                            <td className="px-4 py-5 text-center text-[15px] text-zinc-800">{idx + 4}</td>
                                                            <td className="px-1 py-5">
                                                                <span className="text-[14px] text-zinc-400 uppercase tracking-tight">{p.name}</span>
                                                            </td>
                                                            <td className="px-1 py-5 text-right text-[10px] text-zinc-700">{p.played}</td>
                                                            <td className="px-1 py-5 text-right text-[14px] text-cyan-500/40">{p.wins}</td>
                                                            <td className="px-1 py-5 text-right text-[14px] text-zinc-900">{p.losses}</td>
                                                            <td className="px-1 py-5 text-right text-[10px] text-zinc-800">{p.pf}</td>
                                                            <td className="px-1 py-5 text-right text-[10px] text-zinc-800">{p.pa}</td>
                                                            <td className={`px-5 py-5 text-right text-[14px] tracking-tighter ${p.diff >= 0 ? 'text-[#C9B075]/60' : 'text-red-950/60'}`}>
                                                                {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        {/* COMPLETED MATCHES - 경기 결과 리스트 (섹션 간격 동기화) */}
                        <div className="space-y-6 mt-12 pb-40 px-2">
                            <div className="flex items-center gap-4 px-4">
                                <h3 className="text-xl font-[1000] text-white uppercase tracking-tighter italic">COMPLETED MATCHES</h3>
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-[#C9B075]/10 to-transparent"></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                {selectedSession.matches.map((m: any, idx: number) => {
                                    const n = m.player_names || ["?","?","?","?"];
                                    const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                    return (
                                        <div key={m.id || idx} className="rounded-[28px] flex flex-col overflow-hidden border border-white/5 bg-zinc-900/80 shadow-2xl relative group transition-all">
                                            {/* Header Bar - 중앙 정렬 & 무잘림 고정 */}
                                            <div className="px-4 py-2 bg-black/40 border-b border-white/[0.03] flex justify-center items-center italic">
                                                <span className="text-[8px] font-black text-zinc-600 tracking-[0.3em] uppercase">MATCH {(idx + 1).toString().padStart(2, '0')}</span>
                                            </div>
                                            <div className="px-4 py-6">
                                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-black">
                                                    <div className="flex flex-col gap-0.5 text-center">
                                                        <span className={`text-[11px] italic truncate ${s1 > s2 ? 'text-white' : 'text-zinc-800'}`}>{n[0]}</span>
                                                        <span className={`text-[11px] italic truncate ${s1 > s2 ? 'text-white' : 'text-zinc-800'}`}>{n[1]}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 px-0.5">
                                                        <span className={`text-2xl italic ${s1 > s2 ? 'text-[#C9B075]' : 'text-zinc-900'}`}>{s1}</span>
                                                        <span className="text-zinc-950 font-bold">:</span>
                                                        <span className={`text-2xl italic ${s2 > s1 ? 'text-[#C9B075]' : 'text-zinc-900'}`}>{s2}</span>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5 text-center">
                                                        <span className={`text-[11px] italic truncate ${s2 > s1 ? 'text-white' : 'text-zinc-800'}`}>{n[2]}</span>
                                                        <span className={`text-[11px] italic truncate ${s2 > s1 ? 'text-white' : 'text-zinc-800'}`}>{n[3]}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bg-black/20 py-2.5 text-center border-t border-white/[0.02]">
                                                <span className="text-[7px] font-black text-zinc-800 uppercase tracking-[0.2em] italic">Archive Record</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <button onClick={() => setSelectedSessionId(null)} className="w-full py-5 mt-8 mb-12 rounded-[24px] bg-zinc-900/40 border border-white/5 text-[11px] font-black uppercase tracking-[0.25em] italic text-zinc-800 active:scale-95 transition-all">Back to Root Records</button>
                    </div>
                ) : (
                    /* 2. 세션 리스트 화면 (Level 1) */
                    <div className="animate-in slide-in-from-bottom duration-500 space-y-6">
                        <section className="bg-zinc-900/60 border border-white/5 rounded-[35px] p-6 flex gap-4 shadow-2xl backdrop-blur-3xl">
                            <div className="flex-1 flex flex-col items-center gap-2 italic font-black">
                                <span className="text-[9px] text-zinc-600 uppercase tracking-[0.3em]">Temporal Year</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-900 rounded-xl px-4 py-3 text-[11px] text-white outline-none text-center font-black">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center gap-2 italic font-black">
                                <span className="text-[9px] text-zinc-600 uppercase tracking-[0.3em]">Temporal Month</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-900 rounded-xl px-4 py-3 text-[11px] text-white outline-none text-center font-black">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>

                        <div className="space-y-4">
                            {sessions.map((s, index) => (
                                <div 
                                    key={s.id} 
                                    onClick={() => setSelectedSessionId(s.id)}
                                    className="group bg-zinc-900/80 border border-white/5 rounded-[28px] p-5 relative overflow-hidden active:scale-[0.98] transition-all hover:border-[#C9B075]/20 shadow-2xl"
                                >
                                    <div className="flex justify-between items-center relative z-10">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-black text-zinc-700 uppercase tracking-[0.3em] italic mb-1.5">{s.date}</span>
                                            <h3 className="text-lg font-black text-white tracking-tighter uppercase italic group-hover:text-white transition-colors">{s.title}</h3>
                                            <div className="flex items-center gap-3 mt-2 text-[9px] font-black text-zinc-800 uppercase tracking-widest italic">
                                                <span>{s.matchCount} ENTRIES RECORDED</span>
                                                <span className="text-[#C9B075]/40">{index === 0 ? 'LATEST' : 'SYNCED'}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {isAdmin && (
                                                <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="p-2.5 rounded-xl bg-zinc-800/30 border border-white/5 text-zinc-800 hover:text-red-900 transition-all font-black italic">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                            <div className="w-10 h-10 rounded-full border border-white/5 flex items-center justify-center text-zinc-800 group-hover:text-[#C9B075]/60 transition-all">
                                                <ArrowRight size={18} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            /* 테연 랭킹 탭 (Ultimate 스타일) */
            <div className="py-40 text-center bg-zinc-900/5 rounded-[40px] border border-zinc-900/50 border-dashed">
                <p className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-900 italic">Global Registry Synchronizing</p>
                <div className="mt-8 px-8 py-3 bg-zinc-900/40 border border-white/5 rounded-2xl inline-block italic text-zinc-800 text-[9px] font-black tracking-widest uppercase animate-pulse">
                    Coming Soon to Ultimate Portal
                </div>
            </div>
        )}
      </section>
    </main>
  );

  async function deleteSession(sessionId: string, title: string) {
    if (!isAdmin) return;
    if (!confirm(`[${title}] 전체 대진 기록을 삭제하시겠습니까?`)) return;
    try {
        await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
        fetchArchives();
    } catch (err: any) { alert("삭제 실패: " + err.message); }
  }
}
