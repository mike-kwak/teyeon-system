'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * ResultsPage (Synced v1.7.0): The Teyeon Club Official Database
 * v1.7.0 (The Pure History): Deduplication, Anti-Clipping & Full History View (Photo 3 & 4)
 */
export default function ResultsPage() {
  const { user, role } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING' | 'HOF'>('RECORDS');
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

  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl) {
        setTimeout(() => setSelectedSessionId(sessionFromUrl), 500);
    }
  }, [searchParams]);

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
        processCombinedData(data || []);
    } catch (err: any) { processCombinedData([]); } finally { setLoading(false); }

    function processCombinedData(data: any[]) {
        const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        const combinedData: any[] = [];
        failovers.forEach((f: any) => { combinedData.push({ ...f, isLocal: true }); });
        (data || []).forEach((d: any) => {
            if (!combinedData.find(f => f.id === d.id)) combinedData.push(d);
        });

        combinedData.sort((a,b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

        const reconstructedMatches: any[] = [];
        combinedData.forEach(record => {
            const raw = record.raw_data || {};
            const matchesArr = raw.snapshot_data || [];
            if (matchesArr.length === 0) return;
            const isLocal = !!record.isLocal;
            
            matchesArr.forEach((m: any) => {
                const pIds = m.player_ids || m.playerIds || [];
                const meta = raw.player_metadata || {};
                const resolvedNames = (m.player_names && m.player_names.length === 4 && !m.player_names.includes('Unknown'))
                    ? m.player_names
                    : pIds.map((pid: string) => meta[pid]?.name || 'Unknown');

                reconstructedMatches.push({
                    ...m,
                    session_id: record.id,
                    session_title: raw.title || 'Untitled',
                    match_date: raw.date,
                    created_at: record.created_at,
                    isLocal,
                    player_names: resolvedNames,
                    player_ids: pIds
                });
            });
        });
        setArchives(reconstructedMatches);
    }
  }

  async function deleteSession(sessionId: string, title: string) {
    if (!isAdmin) return;
    if (!confirm(`[${title}] 삭제하시겠습니까?`)) return;
    try {
        await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
        fetchArchives();
    } catch (err: any) { alert("삭제 실패"); }
  }

  async function editSessionTitle(sessionId: string, currentTitle: string) {
    if (!isAdmin) return;
    const newTitle = prompt("새 제목:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;
    try {
        const { data: record } = await supabase.from('teyeon_archive_v1').select('raw_data').eq('id', sessionId).single();
        await supabase.from('teyeon_archive_v1').update({ raw_data: { ...record.raw_data, title: newTitle } }).eq('id', sessionId);
        fetchArchives();
    } catch (err: any) { alert("수정 실패"); }
  }

  const filteredRecords = archives.filter(m => {
    const mDate = new Date(m.match_date);
    return mDate.getFullYear() === selectedYear && (mDate.getMonth() + 1) === selectedMonth;
  });

  const sessions = useMemo(() => {
    const groups: Record<string, any> = {};
    const sortedRecords = [...filteredRecords].sort((a,b) => {
        const timeA = new Date(a.created_at || a.match_date || 0).getTime();
        const timeB = new Date(b.created_at || b.match_date || 0).getTime();
        return timeB - timeA;
    });

    sortedRecords.forEach(m => {
        const rawTitle = m.session_title || m.title || "";
        const normalizedTitle = rawTitle.replace('(로컬 저장됨)', '').replace('(Local)', '').split(' (로컬 저장됨)')[0].trim();
        const dateKey = m.match_date || 'nodate';
        const groupKey = `${normalizedTitle}_${dateKey}`;

        if (!groups[groupKey]) {
            groups[groupKey] = {
                id: m.session_id || groupKey,
                title: normalizedTitle,
                date: m.match_date,
                created_at: m.created_at,
                matches: [],
                matchCount: 0
            };
            groups[groupKey].matches.push(m);
            groups[groupKey].matchCount = 1;
        } else {
            const isMatchDuplicate = groups[groupKey].matches.some((ex: any) => 
                (ex.id === m.id) || (ex.round === m.round && ex.court === m.court && ex.player_names?.join(',') === m.player_names?.join(','))
            );
            if (!isMatchDuplicate) {
                groups[groupKey].matches.push(m);
                groups[groupKey].matchCount++;
            }
        }
    });

    return Object.values(groups).sort((a:any, b:any) => {
        const timeA = new Date(a.created_at || a.date || 0).getTime();
        const timeB = new Date(b.created_at || b.date || 0).getTime();
        return timeB - timeA;
    });
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-y-auto no-scrollbar pt-24 pb-56">
      <header className="px-8 py-6 flex flex-col gap-2 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700">
          <div className="flex justify-between items-end w-full">
            <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.5em] opacity-40">System Archive</span>
                <h1 className="text-5xl font-[1000] italic tracking-tight uppercase bg-gradient-to-r from-white via-white to-[#D4AF37] bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Results</h1>
            </div>
          </div>
          <div className="h-0.5 w-16 bg-gradient-to-r from-[#D4AF37] to-transparent mt-2"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mb-8 flex gap-2">
            {(['RECORDS', 'RANKING'] as const).map(t => (
                <button key={t} onClick={() => setMainTab(t)} className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all ${mainTab === t ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'bg-white/5 border-white/5 text-white/50 hover:text-white/70'}`}>
                    {t === 'RECORDS' ? '대회 결과' : '전체 랭킹'}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-6">
        {loading ? (
            <div className="py-20 text-center animate-pulse text-[#D4AF37] font-black uppercase text-[10px]">Vault Loading...</div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {selectedSessionId && selectedSession ? (
                    <div className="animate-in slide-in-from-right duration-500">
                        <div className="bg-white/5 border border-white/10 rounded-[35px] p-8 mb-8 relative overflow-hidden">
                            <div className="flex flex-col gap-1 mb-6">
                                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em]">{selectedSession.date}</span>
                                <h2 className="text-2xl font-[1000] text-white italic leading-tight tracking-tighter uppercase">{selectedSession.title}</h2>
                            </div>
                            <div className="bg-black/60 p-1 rounded-2xl flex border border-white/5">
                                <button className="flex-1 py-3 text-[10px] bg-[#D4AF37] text-black font-black uppercase tracking-widest rounded-xl">Official Archive Recap</button>
                            </div>
                        </div>

                        <div className="space-y-12 animate-in fade-in duration-700">
                            {/* Full Standings Table (Photo 3 Style - All participants) */}
                            <div className="bg-white/[0.03] border border-white/10 rounded-[28px] overflow-hidden shadow-2xl">
                                <div className="px-6 py-5 border-b border-white/5 bg-white/5 flex justify-between items-center">
                                    <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.3em]">Tour Standings Analytics</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-[11px] font-black uppercase">
                                        <thead className="text-[8px] text-white/20 tracking-widest border-b border-white/5">
                                            <tr>
                                                <th className="px-6 py-5">#</th>
                                                <th className="px-2 py-5">Player</th>
                                                <th className="px-2 py-5 text-center">W / L</th>
                                                <th className="px-2 py-5 text-center">PF / PA</th>
                                                <th className="px-4 py-5 text-right">+/-</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(() => {
                                                const stats: Record<string, { name: string, wins: number, losses: number, diff: number, games: number, pf: number, pa: number }> = {};
                                                selectedSession.matches.forEach((m: any) => {
                                                    const pNames = m.player_names || [];
                                                    pNames.forEach((name: string, i: number) => {
                                                        if (!stats[name]) stats[name] = { name, wins: 0, losses: 0, diff: 0, games: 0, pf: 0, pa: 0 };
                                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                                        const win = i < 2 ? (s1 > s2) : (s2 > s1);
                                                        if (win) stats[name].wins++; else if (s1 !== s2) stats[name].losses++;
                                                        const scored = i < 2 ? s1 : s2;
                                                        const against = i < 2 ? s2 : s1;
                                                        stats[name].diff += (scored - against);
                                                        stats[name].pf += scored;
                                                        stats[name].pa += against;
                                                        stats[name].games++;
                                                    });
                                                });
                                                const rankingData = Object.values(stats).sort((a,b) => (b.wins - a.wins) || (b.diff - a.diff));
                                                return rankingData.map((p:any, idx:number) => (
                                                    <tr key={p.name} className={`border-t border-white/5 ${idx < 3 ? 'bg-white/[0.03]' : 'opacity-40'}`}>
                                                        <td className={`px-6 py-5 font-black italic ${idx === 0 ? 'text-[#D4AF37] text-xl' : 'text-sm'}`}>{idx + 1}</td>
                                                        <td className="px-2 py-5 text-white">{p.name}</td>
                                                        <td className="px-2 py-5 text-center text-white/40">{p.wins}승 {p.losses}패</td>
                                                        <td className="px-2 py-5 text-center text-[9px] text-white/20">{p.pf} / {p.pa}</td>
                                                        <td className={`px-4 py-5 text-right font-black italic ${p.diff >= 0 ? 'text-[#4ADE80]' : 'text-red-500'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</td>
                                                    </tr>
                                                ));
                                            })()}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Full Match History (Photo 4 Style - All matches) */}
                            <div className="space-y-6">
                                <div className="flex items-center gap-4 px-2">
                                    <div className="h-[2px] w-8 bg-[#D4AF37]"></div>
                                    <h3 className="text-2xl font-[1000] italic text-white uppercase tracking-tighter" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Completed Matches</h3>
                                </div>
                                <div className="grid grid-cols-1 gap-4">
                                    {selectedSession.matches.map((m: any, idx: number) => {
                                        const n = m.player_names || ["?","?","?","?"];
                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                        return (
                                            <div key={m.id || idx} className="bg-white/[0.02] border border-white/5 rounded-[28px] p-6 flex items-center justify-between relative overflow-hidden group hover:bg-white/5 transition-all">
                                                <div className="flex flex-col gap-3 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded text-[8px] font-black text-white/30 uppercase tracking-widest italic">R{m.round || 1} • C{m.court || 1}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="flex flex-col flex-1 gap-1">
                                                            <span className={`text-[11px] font-black italic uppercase ${s1 > s2 ? 'text-white' : 'text-white/20'}`}>{n[0]}</span>
                                                            <span className={`text-[11px] font-black italic uppercase ${s1 > s2 ? 'text-white' : 'text-white/20'}`}>{n[1]}</span>
                                                        </div>
                                                        <div className="flex items-center gap-4 px-2">
                                                            <span className={`text-4xl font-[1000] italic ${s1 > s2 ? 'text-[#D4AF37]' : 'text-white/10'}`}>{s1}</span>
                                                            <span className="text-sm font-black text-white/5">:</span>
                                                            <span className={`text-4xl font-[1000] italic ${s2 > s1 ? 'text-[#D4AF37]' : 'text-white/10'}`}>{s2}</span>
                                                        </div>
                                                        <div className="flex flex-col flex-1 items-end gap-1">
                                                            <span className={`text-[11px] font-black italic uppercase ${s2 > s1 ? 'text-white' : 'text-white/20'}`}>{n[2]}</span>
                                                            <span className={`text-[11px] font-black italic uppercase ${s2 > s1 ? 'text-white' : 'text-white/20'}`}>{n[3]}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                     })}
                                </div>
                            </div>
                        </div>

                        <button onClick={() => setSelectedSessionId(null)} className="w-full py-6 mt-8 rounded-[28px] bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] transition-all mb-32">Back to List</button>
                    </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-white/5 border border-white/10 rounded-[35px] p-8 mb-8 flex gap-4 shadow-2xl">
                            <div className="flex-1 flex flex-col items-center space-y-2">
                                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-widest">Year</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/60 border border-white/20 rounded-2xl px-5 py-4 text-xs font-black text-white outline-none text-center">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center space-y-2">
                                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-widest">Month</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/60 border border-white/20 rounded-2xl px-5 py-4 text-xs font-black text-white outline-none text-center">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>
                        <div className="space-y-6">
                            {sessions.map((s, index) => (
                                <div key={s.id} onClick={() => { setSelectedSessionId(s.id); }} className="group bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[35px] p-8 shadow-2xl relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer hover:border-[#D4AF37]/30">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-3 mb-1"><span className="w-8 h-8 bg-black/40 rounded-xl border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] text-[11px] font-[1000]">{index + 1}</span><span className="text-[10px] font-black text-[#EFDFB4] uppercase tracking-[0.2em]">{s.date}</span></div>
                                            <h3 className="text-lg font-[1000] text-white italic tracking-tighter uppercase leading-none">{s.title}</h3>
                                        </div>
                                        <div className="w-10 h-10 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-[#D4AF37]">→</div>
                                    </div>
                                    <div className="flex items-center gap-4 text-[9px] font-black text-white/20 tracking-[0.3em] uppercase"><span>{s.matchCount} Matches Preserved</span></div>
                                    {isAdmin && (
                                        <div className="mt-6 pt-6 border-t border-white/5 flex gap-2">
                                            <button onClick={(e)=>{e.stopPropagation(); editSessionTitle(s.id, s.title);}} className="text-[9px] font-black text-white/20 hover:text-[#D4AF37]">EDIT</button>
                                            <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="text-[9px] font-black text-white/20 hover:text-red-500">DELETE</button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="py-20 text-center opacity-20 font-black uppercase text-xs">Ranking Algorithm V4.0 Active</div>
        )}
      </section>
    </main>
  );
}
