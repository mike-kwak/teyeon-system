'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Edit3, Trash2, ArrowRight } from 'lucide-react';

/**
 * ArchivePage (v1.14.0): THE LUXURY SIGNATURE
 * 확정된 'Luxury Dark' 디자인 시스템 (이탤릭, 골드 라인, 벌금 제거) 반영
 */
export default function ArchivePage() {
  const { user, role } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING'>('RECORDS');
  const [rankingFilter, setRankingFilter] = useState<'WEEK' | 'MONTH' | 'YEAR' | 'ALL'>('MONTH');
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);
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
    fetchMembers();
  }, [selectedYear, selectedMonth]);

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserEmail(user.email || null);
  }

  async function fetchMembers() {
    const { data } = await supabase.from('members').select('id, nickname, avatar_url, email');
    if (data) setMembers(data);
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
          const isLocal = !!record.isLocal;
          
          matchesArr.forEach((m: any) => {
              const pIds = m.player_ids || m.playerIds || [];
              const meta = raw.player_metadata || {};
              const resolvedNames = m.player_names || pIds.map((pid: string) => meta[pid]?.name || 'Unknown');

              reconstructedMatches.push({
                  ...m,
                  session_id: record.id,
                  session_title: raw.title,
                  match_date: raw.date,
                  created_at: record.created_at,
                  isLocal,
                  player_names: resolvedNames,
                  player_ids: pIds
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

  async function deleteSession(sessionId: string, title: string) {
    if (!isAdmin) return;
    if (!confirm(`[${title}] 전체 대진 기록을 삭제하시겠습니까?`)) return;

    try {
        await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
        fetchArchives();
    } catch (err: any) {
        alert("삭제 실패: " + err.message);
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
                matchCount: 0
            };
        }
        groups[groupKey].matches.push(m);
        groups[groupKey].matchCount++;
    });

    return Object.values(groups).sort((a:any, b:any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-[#0a0a0c] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      {/* LUXURY HEADER (v1.14.0) */}
      <header className="px-8 pt-24 pb-4 flex flex-col gap-1 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          <span className="text-[12px] font-[1000] text-[#C9B075] uppercase tracking-[0.4em] italic drop-shadow-lg">Teyeon Club Archive</span>
          <h1 className="text-5xl sm:text-6xl font-[1000] tracking-tighter uppercase italic text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]">System Archive</h1>
          <div className="h-[2px] w-full bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent mt-2 shadow-[0_4px_15px_rgba(201,176,117,0.3)]"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mb-10 flex gap-2.5">
            {(['RECORDS', 'RANKING'] as const).map(t => (
                <button 
                    key={t} onClick={() => setMainTab(t)}
                    className={`flex-1 py-4 rounded-2xl text-[11px] font-[1000] uppercase tracking-widest transition-all relative overflow-hidden group italic ${mainTab === t ? 'bg-zinc-100 text-black shadow-xl shadow-white/5' : 'bg-zinc-900/50 border border-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
                >
                    {t === 'RECORDS' ? '대회 결과' : '전체 순위'}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-6">
        {loading ? (
            <div className="py-24 text-center">
                <p className="text-[12px] font-[1000] text-zinc-600 tracking-[0.4em] uppercase italic">Decrypting Vault...</p>
            </div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {selectedSessionId && selectedSession ? (
                    <div className="animate-in slide-in-from-right duration-500">
                        {/* DETAIL HERO CARD */}
                        <div className="bg-zinc-900/60 border border-white/5 rounded-[40px] p-8 mb-10 relative overflow-hidden backdrop-blur-3xl shadow-2xl">
                            <div className="flex flex-col gap-2 mb-6">
                                <span className="text-[12px] font-[1000] text-[#C9B075] uppercase tracking-[0.4em] italic">{selectedSession.date}</span>
                                <h2 className="text-3xl font-[1000] text-white leading-tight tracking-tighter uppercase italic">{selectedSession.title}</h2>
                                <div className="h-[1px] w-24 bg-gradient-to-r from-[#C9B075] to-transparent"></div>
                            </div>
                            <div className="bg-black/40 p-1.5 rounded-[22px] flex border border-white/5">
                                <button className="flex-1 py-3.5 text-[11px] bg-zinc-100 text-black font-[1000] uppercase tracking-widest rounded-[18px] italic transition-all active:scale-95">Official Summary View</button>
                            </div>
                        </div>

                        {/* RANKING UPDATES (v1.14.0) */}
                        <div className="mb-16">
                            <div className="flex items-center gap-4 px-4 mb-10">
                                <h3 className="text-2xl font-[1000] text-white uppercase tracking-tighter italic">RANKING UPDATES</h3>
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-[#C9B075]/40 to-transparent"></div>
                            </div>
                            {/* Simplified Luxury Podium can be here if needed, or just rankings */}
                            <div className="space-y-4">
                                {(() => {
                                    const stats: Record<string, { name: string, wins: number, losses: number, diff: number }> = {};
                                    selectedSession.matches.forEach((m: any) => {
                                        const pNames = m.player_names || [];
                                        pNames.forEach((name: string, i: number) => {
                                            if (!stats[name]) stats[name] = { name, wins: 0, losses: 0, diff: 0 };
                                            const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                            const win = i < 2 ? (s1 > s2) : (s2 > s1);
                                            if (win) stats[name].wins++; else stats[name].losses++;
                                            stats[name].diff += (i < 2 ? (s1 - s2) : (s2 - s1));
                                        });
                                    });
                                    return Object.values(stats).sort((a,b) => (b.wins - a.wins) || (b.diff - a.diff)).map((p, idx) => (
                                        <div key={p.name} className="flex items-center justify-between px-8 py-5 bg-zinc-900/40 border border-white/5 rounded-[28px] group">
                                            <div className="flex items-center gap-6">
                                                <span className={`text-lg font-[1000] italic ${idx < 3 ? 'text-[#C9B075]' : 'text-zinc-700'}`}>{idx + 1}</span>
                                                <span className="text-base font-[1000] text-white uppercase tracking-tight italic">{p.name}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-sm font-[1000] text-[#C9B075] italic">{p.wins}W {p.losses}L</span>
                                                <span className="text-[10px] text-zinc-600 font-[1000] italic">{p.diff > 0 ? `+${p.diff}` : p.diff} NET</span>
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        </div>

                        {/* COURTS DASHBOARD (v1.14.0) */}
                        <div className="space-y-8 pb-40">
                            <div className="flex items-center gap-4 px-4">
                                <h3 className="text-2xl font-[1000] text-white uppercase tracking-tighter italic">COURTS DASHBOARD</h3>
                                <div className="h-[1px] flex-1 bg-gradient-to-r from-[#C9B075]/40 to-transparent"></div>
                            </div>
                            <div className="grid grid-cols-2 gap-5 text-center">
                                {selectedSession.matches.map((m: any, idx: number) => {
                                    const n = m.player_names || ["?","?","?","?"];
                                    const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                    return (
                                        <div key={m.id || idx} className="rounded-[30px] flex flex-col overflow-hidden border border-white/5 bg-zinc-900/40 shadow-2xl relative group">
                                            <div className="px-4 py-2 bg-black/20 border-b border-white/5 flex justify-between items-center italic">
                                                <span className="text-[9px] font-[1000] text-zinc-500 tracking-widest">MATCH {(idx + 1).toString().padStart(2, '0')}</span>
                                                <div className="w-1.5 h-1.5 rounded-full bg-[#C9B075]/40"></div>
                                            </div>
                                            <div className="px-4 py-6">
                                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                                    <div className="flex flex-col gap-1">
                                                        <span className={`text-[12px] font-[1000] italic truncate ${s1 > s2 ? 'text-white' : 'text-zinc-600'}`}>{n[0]}</span>
                                                        <span className={`text-[12px] font-[1000] italic truncate ${s1 > s2 ? 'text-white' : 'text-zinc-600'}`}>{n[1]}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 px-2">
                                                        <span className={`text-4xl font-[1000] italic ${s1 > s2 ? 'text-[#C9B075]' : 'text-zinc-800'}`}>{s1}</span>
                                                        <span className="text-zinc-900 font-bold">:</span>
                                                        <span className={`text-4xl font-[1000] italic ${s2 > s1 ? 'text-[#C9B075]' : 'text-zinc-800'}`}>{s2}</span>
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <span className={`text-[12px] font-[1000] italic truncate ${s2 > s1 ? 'text-white' : 'text-zinc-600'}`}>{n[2]}</span>
                                                        <span className={`text-[12px] font-[1000] italic truncate ${s2 > s1 ? 'text-white' : 'text-zinc-600'}`}>{n[3]}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bg-black/20 py-2">
                                                <span className="text-[8px] font-[1000] text-zinc-700 uppercase tracking-widest italic">Final Outcome</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <button onClick={() => setSelectedSessionId(null)} className="w-full py-6 mt-12 mb-12 rounded-[28px] bg-zinc-900 border border-white/10 text-[12px] font-[1000] uppercase tracking-[0.3em] italic text-zinc-600 active:scale-95 transition-all">Back to System Records</button>
                    </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-zinc-900/60 border border-white/5 rounded-[40px] p-8 mb-10 flex gap-5 shadow-2xl backdrop-blur-3xl">
                            <div className="flex-1 flex flex-col items-center space-y-3 font-[1000] italic">
                                <span className="text-[10px] text-zinc-500 uppercase tracking-[0.3em]">Temporal Year</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-800 rounded-2xl px-6 py-4 text-xs text-white outline-none text-center">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center space-y-3 font-[1000] italic">
                                <span className="text-[10px] text-zinc-500 uppercase tracking-[0.3em]">Temporal Month</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-800 rounded-2xl px-6 py-4 text-xs text-white outline-none text-center">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>
                        <div className="space-y-4">
                            {sessions.map((s, index) => (
                                <div key={s.id} onClick={() => { setSelectedSessionId(s.id); }} className="group bg-zinc-900/40 border border-white/5 rounded-[32px] p-6 relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer hover:border-[#C9B075]/30">
                                    <div className="flex justify-between items-center relative z-10">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-[1000] text-zinc-600 uppercase tracking-[0.3em] italic leading-none mb-2">{s.date}</span>
                                            <h3 className="text-xl font-[1000] text-white tracking-tighter uppercase italic leading-tight group-hover:text-white transition-colors">{s.title}</h3>
                                            <div className="flex items-center gap-3 mt-2 text-[9px] font-[1000] text-zinc-700 uppercase tracking-widest italic">
                                                <span>{s.matchCount} ENTRIES RECORDED</span>
                                                <span>•</span>
                                                <span>SYNCED</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {isAdmin && (
                                                <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="p-3 rounded-2xl bg-zinc-800/50 border border-white/5 text-zinc-600 hover:text-red-500 transition-all"><Trash2 className="w-4 h-4" /></button>
                                            )}
                                            <div className="w-10 h-10 rounded-full border border-white/5 flex items-center justify-center text-zinc-700 group-hover:text-[#C9B075] transition-all"><ArrowRight className="w-5 h-5" /></div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="py-24 text-center">
                <p className="text-[11px] font-[1000] uppercase tracking-[0.6em] text-zinc-800 italic">Global Registry Status: Online</p>
            </div>
        )}
      </section>
    </main>
  );
}
