'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Trash2, ArrowRight, ArrowLeft, Users, Trophy } from 'lucide-react';

/**
 * ArchivePage (v1.15.1): ABSOLUTE PRECISION & MUTED ELEGANCE
 * - Reverted excessive rounding to rounded-xl (12px) to prevent clipping as requested
 * - Unified Official Name: "테연" (TEYEON)
 * - Muted Gold UI: Champagne matte gold tones from user's edit
 * - Safety Padding: Increased horizontal and vertical inner padding to secure all data
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

  // v1.18.0: Hard Reset Logic to break stubborn PWA Cache
  useEffect(() => {
    const VERSION = "1.20.2";
    const savedVersion = localStorage.getItem("TEYEON_ARCHIVE_VER_V2");
    if (savedVersion !== VERSION) {
        localStorage.setItem("TEYEON_ARCHIVE_VER_V2", VERSION);
        window.location.reload();
    }
  }, []);

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
            groups[groupKey] = { 
                id: m.session_id, 
                title, 
                date: m.match_date, 
                created_at: m.created_at, 
                matches: [], 
                matchCount: 0,
                playerSet: new Set()
            };
        }
        groups[groupKey].matches.push(m);
        groups[groupKey].matchCount++;
        (m.player_names || []).forEach((n:string) => groups[groupKey].playerSet.add(n));
    });

    return Object.values(groups)
      .map(s => ({ ...s, participantCount: s.playerSet.size }))
      .sort((a:any, b:any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-[#0a0a0c] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      {/* 럭셔리 라인 헤더 */}
      <header className="px-8 pt-24 pb-2 flex flex-col gap-1 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          {selectedSessionId ? (
              <button 
                onClick={() => setSelectedSessionId(null)}
                className="flex items-center gap-2 text-[#C9B075] mb-2 hover:translate-x-[-4px] transition-transform italic font-black"
              >
                  <ArrowLeft size={16} />
                  <span className="text-[13px] uppercase tracking-widest">뒤로가기</span>
              </button>
          ) : (
            <span className="text-[11px] font-black text-[#C9B075] uppercase tracking-[0.4em] italic drop-shadow-lg">SYSTEM RECORDS</span>
          )}
          <h1 className="text-4xl sm:text-5xl font-[1000] tracking-tighter uppercase italic text-white leading-none drop-shadow-xl">Archive</h1>
          <div className="h-[2px] w-full bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent mt-3 shadow-[0_4px_15px_rgba(201,176,117,0.3)]"></div>
      </header>

      {/* 상시 노출 내비게이션 (차분한 디자인) */}
      <nav className="px-6 mt-8 mb-4 flex gap-2.5 relative z-[90]">
          {(['RECORDS', 'RANKING'] as const).map(t => (
                   <button 
                       key={t} onClick={() => {
                         setMainTab(t);
                         if (t === 'RECORDS') setSelectedSessionId(null);
                       }}
                       className={`flex-1 py-4 rounded-[20px] text-[14px] font-black uppercase tracking-widest transition-all relative overflow-hidden group italic
                       ${mainTab === t 
                         ? 'bg-[#C9B075]/10 text-[#C9B075] border border-[#C9B075]/40 shadow-[0_0_20px_rgba(201,176,117,0.1)]' 
                         : 'bg-zinc-900/50 border border-white/5 text-zinc-600 hover:text-zinc-300'}`}
                   >
                       {t === 'RECORDS' ? '경기 기록' : '테연 랭킹'}
                   </button>
               ))}
           </nav>
     
           <section className="flex-1 px-6 sm:px-8 mt-4">
             {loading ? (
                 <div className="py-24 text-center">
                     <p className="text-[12px] font-black text-zinc-600 tracking-[0.4em] uppercase italic">Decrypting Vault...</p>
                 </div>
             ) : mainTab === 'RECORDS' ? (
                 <>
                     {selectedSessionId && selectedSession ? (
                         <div className="animate-in slide-in-from-right duration-500 flex flex-col gap-2">
                             <div className="flex flex-col gap-1 px-2 mt-4">
                                 <span className="text-[12px] font-black text-[#C9B075] uppercase tracking-[0.4em] italic opacity-70">{selectedSession.date}</span>
                                 <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic break-all leading-tight">{selectedSession.title}</h2>
                             </div>
     
                             <div className="flex flex-col gap-1 px-4 relative mt-4">
                                 <h3 className="text-3xl font-[1000] text-white uppercase tracking-tighter italic leading-none drop-shadow-xl">RANKING UPDATES</h3>
                                 <div className="h-[2px] w-48 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent shadow-[0_4px_15px_rgba(201,176,117,0.3)] mt-1"></div>
                             </div>
     
                             {(() => {
                                 const stats: Record<string, { name: string, wins: number, losses: number, diff: number, pf: number, pa: number, avatar: string, played: number }> = {};
                                 selectedSession.matches.forEach((m: any) => {
                                     const pNames = m.player_names || [];
                                     const pAvatars = m.player_avatars || [];
                                     pNames.forEach((name: string, k: number) => {
                                         if (!stats[name]) stats[name] = { name, wins: 0, losses: 0, diff: 0, pf: 0, pa: 0, avatar: pAvatars[k] || '', played: 0 };
                                         const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                         const win = k < 2 ? (s1 > s2) : (s2 > s1);
                                         stats[name].played++;
                                         if (win) stats[name].wins++; else stats[name].losses++;
                                         stats[name].pf += (k < 2 ? s1 : s2);
                                         stats[name].pa += (k < 2 ? s2 : s1);
                                         stats[name].diff = stats[name].pf - stats[name].pa;
                                     });
                                 });
                                 const sortedResults = Object.values(stats).sort((a,b) => (b.wins - a.wins) || (b.diff - a.diff));
                                 const top3 = sortedResults.slice(0, 3);
                                 const others = sortedResults.slice(3);
     
                                 return (
                                     <>
                                     {/* THE FINAL SNAP (v1.20.1) - PRECISION ADHESION */}
                                     <div className="w-full max-w-2xl mx-auto h-auto pb-8 flex items-center justify-center px-1">
                                         <div className="flex items-end justify-center gap-2.5 w-full">
                                             {[1, 0, 2].map((idx) => {
                                                 const p = top3[idx];
                                                 if (!p) return <div key={idx} className="flex-1" />;
                                                 const isFirst = idx === 0;
                                                 const rankThemes = [{ icon: '🏆', color: 'from-[#FFD700] to-[#B8860B]' }, { icon: '🥈', color: 'from-[#C0C0C0] to-[#707070]' }, { icon: '🥉', color: 'from-[#CD7F32] to-[#8B4513]' }];
                                                 const theme = rankThemes[idx];
                                                 return (
                                                     <div key={p.name} className={`relative flex flex-col items-center p-3 pb-10 rounded-[36px] border border-white/5 bg-zinc-900 shadow-2xl transition-all duration-300 ${isFirst ? 'w-[46%] z-10 border-[#C9B075]/30 bg-zinc-800/50' : 'w-[27%] bg-zinc-900/40 opacity-80'}`}>
                                                         <div className="w-full flex flex-col items-center mt-3">
                                                             <div className={`rounded-full border-2 border-white/10 overflow-hidden mb-3 ${isFirst ? 'w-24 h-24 border-[#C9B075]/40' : 'w-16 h-16'}`}>
                                                                 {p.avatar ? <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" /> : <div className={`w-full h-full bg-gradient-to-br ${theme.color} flex items-center justify-center`}><span className="text-3xl">{theme.icon}</span></div>}
                                                             </div>
                                                             <h4 className={`font-[1000] text-center text-white italic uppercase tracking-tighter mb-1.5 ${isFirst ? 'text-2xl pt-2' : 'text-sm'}`}>{p.name}</h4>
                                                             <div className="flex items-center gap-2 font-[1000] text-[11px] italic tracking-tighter text-zinc-400 capitalize whitespace-nowrap">
                                                                 <span>{p.wins}W {p.losses}L</span>
                                                                 <span className={p.diff > 0 ? 'text-[#00e5ff]' : 'text-red-500'}>{p.diff > 0 ? `+${p.diff}` : p.diff}</span>
                                                             </div>
                                                         </div>
                                                     </div>
                                                 );
                                             })}
                                         </div>
                                     {/* COMPACT BUFFER ZONE */}
                                     <div className="h-4 w-full" aria-hidden="true" />
     
                                     <div className="grid grid-cols-[45px_45px_1fr_45px_45px_60px_0.5fr] px-6 text-[10px] font-black text-zinc-600 uppercase italic tracking-widest mb-2 border-b border-white/5 pb-2">
                                            <span className="text-center">#</span><span className="text-center">PROF</span><span className="text-center">PLAYER</span><span className="text-center text-cyan-500/60">W</span><span className="text-center text-zinc-700/60">L</span><span className="text-center text-[#C9B075]/60">+/-</span><span></span>
                                        </div>
                                        {others.map((p, i) => (
                                            <div key={p.name} className="grid grid-cols-[45px_45px_1fr_45px_45px_60px_0.5fr] items-center px-6 py-4 rounded-2xl bg-zinc-900/30 border border-white/5 mb-2 hover:bg-zinc-800/40 transition-all group relative overflow-hidden">
                                                <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-zinc-700 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all"></div>
                                                <span className="text-sm font-[1000] text-zinc-600 italic tracking-tighter text-center">{String(i + 4).padStart(2, '0')}</span>
                                                <div className="flex justify-center">
                                                    <div className="w-8 h-8 rounded-full border border-white/10 overflow-hidden bg-zinc-800 flex items-center justify-center">
                                                        {p.avatar ? <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-[10px] font-black text-zinc-600 uppercase">{p.name[0]}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col pl-4">
                                                    <span className="text-sm font-black text-white italic uppercase tracking-tighter break-all">{p.name}</span>
                                                    <span className="text-[9px] font-black text-zinc-600 uppercase italic tracking-widest">{p.played} MATCHES</span>
                                                </div>
                                                <span className="text-sm font-black text-[#00e5ff] text-center italic">{p.wins}</span>
                                                <span className="text-sm font-black text-zinc-700 text-center italic">{p.losses}</span>
                                                <div className="flex flex-col items-center">
                                                    <span className={`text-base font-[1000] italic tracking-tighter ${p.diff > 0 ? 'text-[#C9B075]' : p.diff < 0 ? 'text-red-500' : 'text-zinc-600'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</span>
                                                </div>
                                                <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-all">
                                                    <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            );
                        })()}

                        <div className="h-6 w-full" aria-hidden="true" />
                        <div className="flex flex-col gap-1 px-4 mb-4 mt-16">
                            <h3 className="text-3xl font-[1000] text-white uppercase tracking-tighter italic leading-none drop-shadow-xl">COMPLETED MATCHES</h3>
                            <div className="h-[2px] w-64 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent shadow-[0_4px_15px_rgba(201,176,117,0.3)] mt-1"></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pb-40 px-1">
                            {selectedSession.matches.map((m: any, idx: number) => {
                                const n = m.player_names || ["?","?","?","?"];
                                const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                return (
                                    <div key={m.id || idx} className="rounded-[28px] flex flex-col overflow-hidden border border-white/5 bg-zinc-900/80 shadow-2xl relative group transition-all">
                                        <div className="px-4 py-1.5 bg-black/40 border-b border-white/[0.03] flex justify-center items-center italic">
                                            <span className="text-[7px] font-black text-[#C9B075] tracking-[0.3em] uppercase">MATCH {(idx + 1).toString().padStart(2, '0')}</span>
                                        </div>
                                        <div className="px-3 py-5">
                                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-black">
                                                <div className="flex flex-col gap-1 text-center font-black">
                                                    <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[0]}</span>
                                                    <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[1]}</span>
                                                </div>
                                                <div className="flex items-center gap-1 px-0.5">
                                                    <span className={`text-2xl italic ${s1 > s2 ? 'text-[#C9B075]' : 'text-zinc-200'}`}>{s1}</span>
                                                    <span className="text-zinc-900 font-bold opacity-30">:</span>
                                                    <span className={`text-2xl italic ${s2 > s1 ? 'text-[#C9B075]' : 'text-zinc-200'}`}>{s2}</span>
                                                </div>
                                                <div className="flex flex-col gap-1 text-center font-black">
                                                    <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[2]}</span>
                                                    <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[3]}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <button onClick={() => setSelectedSessionId(null)} className="w-full py-5 mt-8 mb-12 rounded-[24px] bg-zinc-900/40 border border-white/5 text-[11px] font-black uppercase tracking-[0.25em] italic text-zinc-800 active:scale-95 transition-all">Back to Root Records</button>
                    </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500 space-y-6">
                        <section className="bg-zinc-900/40 border border-white/5 rounded-[32px] p-6 flex gap-4 shadow-xl backdrop-blur-3xl mb-8">
                            <div className="flex-1 flex flex-col items-center gap-2 italic font-black">
                                <span className="text-[9px] text-zinc-700 uppercase tracking-[0.4em] mb-1">TEMPORAL YEAR</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/40 border border-white/5 rounded-2xl px-4 py-3 text-[11px] text-white outline-none text-center font-black focus:border-[#C9B075]/30 appearance-none cursor-pointer">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center gap-2 italic font-black">
                                <span className="text-[9px] text-zinc-700 uppercase tracking-[0.4em] mb-1">TEMPORAL MONTH</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/40 border border-white/5 rounded-2xl px-4 py-3 text-[11px] text-white outline-none text-center font-black focus:border-[#C9B075]/30 appearance-none cursor-pointer">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>
                        <div className="space-y-6 pb-20">
                            {sessions.map((s, index) => (
                                <div key={s.id} onClick={() => setSelectedSessionId(s.id)} className="group relative backdrop-blur-3xl bg-zinc-900/40 border border-white/5 rounded-xl p-7 pt-10 overflow-hidden active:scale-[0.98] transition-all hover:border-[#C9B075]/30 shadow-2xl">
                                    <div className="flex justify-between items-start mb-4 ml-1">
                                        <div className="px-1 border-l-2 border-[#C9B075]/40 pl-3"><span className="text-[10px] font-black text-[#C9B075] uppercase tracking-widest italic">{s.date}</span></div>
                                        <div className="flex items-center gap-2 mr-1">
                                            {index === 0 && <span className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest italic opacity-60">LATEST SYSTEM RECORD</span>}
                                            {isAdmin && <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="p-2 rounded-xl bg-black/20 border border-white/5 text-zinc-700 hover:text-red-900 transition-all"><Trash2 size={14} /></button>}
                                        </div>
                                    </div>
                                    <div className="mb-10 px-2 mt-2"><h3 className="text-3xl font-[1000] text-zinc-100 tracking-tighter uppercase italic leading-none group-hover:text-white transition-colors break-all drop-shadow-lg">{s.title}</h3></div>
                                    <div className="flex items-center justify-between pt-5 border-t border-white/[0.03] px-1">
                                        <div className="flex items-center gap-6">
                                            <div className="flex items-center gap-2"><Users size={14} className="text-zinc-600" /><span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest italic">Players: <span className="text-zinc-100 ml-1">{s.participantCount}</span></span></div>
                                            <div className="flex items-center gap-2"><Trophy size={14} className="text-zinc-600" /><span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest italic">Matches: <span className="text-zinc-100 ml-1">{s.matchCount}</span></span></div>
                                        </div>
                                        <div className="w-11 h-11 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center text-zinc-600 group-hover:border-[#C9B075]/50 group-hover:text-[#C9B075] transition-all"><ArrowRight size={20} /></div>
                                    </div>
                                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#C9B075] opacity-[0.01] blur-[80px] pointer-events-none group-hover:opacity-[0.03] transition-opacity"></div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="py-24 text-center bg-zinc-900/40 rounded-[40px] border border-white/5 border-dashed mx-4">
                <p className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-700 italic">Global Registry Synchronizing</p>
                <div className="mt-8 px-8 py-3 bg-black/60 border border-white/5 rounded-2xl inline-block italic text-zinc-500 text-[9px] font-black tracking-widest uppercase animate-pulse">테연 랭킹 업데이트 중...</div>
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
