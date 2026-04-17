'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * ResultsPage (Synced v1.6.0): The Teyeon Club Official Database
 * v1.6.0 (The Ultimate Podium): Podium UI, Match Grid & Fixed Bottom Nav Optimization
 */
export default function ResultsPage() {
  const { user, role } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING' | 'HOF'>('RECORDS');
  const [activeDetailTab, setActiveDetailTab] = useState<'RANKING' | 'MATCHES' | 'PERSONAL'>('RANKING');
  const [rankingFilter, setRankingFilter] = useState<'WEEK' | 'MONTH' | 'YEAR' | 'ALL'>('MONTH');
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showSyncToast, setShowSyncToast] = useState(false);
  const [syncToastMsg, setSyncToastMsg] = useState("서버 동기화 완료");

  const CEO_EMAIL = process.env.NEXT_PUBLIC_CEO_EMAIL || 'cws786@nate.com';
  const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',');
  const isAdmin = (userEmail && (userEmail === CEO_EMAIL || ADMIN_EMAILS.includes(userEmail))) || role === 'ADMIN' || role === 'CEO';
  
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  useEffect(() => {
    checkUser();
    fetchArchives().then(() => autoSyncLocalRecords());
    fetchMembers();
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl) {
        setTimeout(() => {
            setSelectedSessionId(sessionFromUrl);
            setActiveDetailTab('RANKING');
        }, 500);
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

  async function autoSyncLocalRecords() {
    const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
    if (failovers.length === 0) return;
    for (const f of failovers) { await syncLocalRecord(f.id, true); }
  }

  async function syncLocalRecord(id: string, isSilent: boolean = false) {
    if (isSyncing === id) return;
    setIsSyncing(id);
    try {
        const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        const record = failovers.find((f: any) => f.id === id);
        if (!record) return;

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const response = await fetch(`${supabaseUrl}/rest/v1/teyeon_archive_v1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({ id: record.id, raw_data: record.raw_data })
        });

        if (!response.ok) throw new Error("Sync Failed");

        localStorage.setItem('kdk_archive_failover', JSON.stringify(failovers.filter((f: any) => f.id !== id)));
        fetchArchives();
    } catch (err: any) { console.error(err); } finally { setIsSyncing(null); }
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
    [...filteredRecords].forEach(m => {
        const key = m.session_id || 'untitled';
        if (!groups[key]) {
            groups[key] = { id: key, title: m.session_title, date: m.match_date, matches: [], matchCount: 0 };
        }
        if (!groups[key].matches.some((ex: any) => ex.id === m.id)) {
            groups[key].matches.push(m);
            groups[key].matchCount++;
        }
    });
    return Object.values(groups).sort((a:any, b:any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-y-auto no-scrollbar pt-24 pb-48">
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
                                {(['RANKING', 'MATCHES', 'PERSONAL'] as const).map(t => (
                                    <button key={t} onClick={() => setActiveDetailTab(t)} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeDetailTab === t ? 'bg-[#D4AF37] text-black' : 'text-white/30'}`}>{t}</button>
                                ))}
                            </div>
                        </div>

                        {activeDetailTab === 'RANKING' && (
                            <div className="space-y-12 animate-in fade-in duration-700">
                                {/* The Ultimate Podium (v1.6.0) */}
                                {(() => {
                                    const stats: Record<string, { name: string, wins: number, losses: number, diff: number, games: number }> = {};
                                    selectedSession.matches.forEach((m: any) => {
                                        const pNames = m.player_names || [];
                                        pNames.forEach((name: string, i: number) => {
                                            if (!stats[name]) stats[name] = { name, wins: 0, losses: 0, diff: 0, games: 0 };
                                            const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                            const win = i < 2 ? (s1 > s2) : (s2 > s1);
                                            if (win) stats[name].wins++; else if (s1 !== s2) stats[name].losses++;
                                            stats[name].diff += i < 2 ? (s1 - s2) : (s2 - s1);
                                            stats[name].games++;
                                        });
                                    });
                                    const rankingData = Object.values(stats).sort((a,b) => (b.wins - a.wins) || (b.diff - a.diff));
                                    const top3 = rankingData.slice(0, 3);
                                    const podium = [top3[1] || { name: '-', wins: 0, diff: 0 }, top3[0] || { name: '-', wins: 0, diff: 0 }, top3[2] || { name: '-', wins: 0, diff: 0 }];

                                    return (
                                        <div className="relative mt-8 mb-12 flex justify-center items-end gap-2 h-[220px]">
                                            {podium.map((p, idx) => {
                                                const isFirst = idx === 1;
                                                const w = isFirst ? 'w-[140px]' : 'w-[110px]';
                                                return (
                                                    <div key={idx} className={`flex flex-col items-center justify-end ${isFirst ? 'z-20' : 'z-10'}`}>
                                                        <div className={`relative ${w} rounded-t-[40px] bg-gradient-to-b from-white/10 to-white/5 border-x border-t border-white/10 flex flex-col items-center pt-6 shadow-2xl`} style={{ height: isFirst ? '140px' : '100px' }}>
                                                            <div className={`absolute -top-10 ${isFirst ? 'w-20 h-20' : 'w-16 h-16'} rounded-full border-2 ${isFirst ? 'border-[#D4AF37] shadow-[0_0_20px_#D4AF37]' : 'border-white/20'} bg-black overflow-hidden flex items-center justify-center`}>
                                                                <span className="text-xl font-black italic">{p.name[0]}</span>
                                                            </div>
                                                            <span className={`mt-2 font-[1000] italic uppercase tracking-tighter ${isFirst ? 'text-lg text-white' : 'text-sm text-white/60'}`}>{p.name}</span>
                                                            <div className="flex items-center gap-1 mt-1 opacity-50"><span className="text-[10px] font-black">{p.wins}W</span><span className={`text-[10px] font-black ${p.diff >= 0 ? 'text-[#4ADE80]' : 'text-red-500'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</span></div>
                                                        </div>
                                                        <div className={`${w} h-12 bg-white/5 border-x border-b border-white/10 flex items-center justify-center font-[1000] text-2xl italic ${isFirst ? 'text-[#D4AF37] text-4xl' : 'text-white/20'}`}>{idx === 0 ? '2' : idx === 1 ? '1' : '3'}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}

                                {/* Completed Matches Grid (v1.6.0) */}
                                <div className="space-y-6">
                                    <div className="flex items-center gap-4 px-2">
                                        <div className="h-0.5 w-8 bg-[#D4AF37]"></div>
                                        <h3 className="text-2xl font-[1000] italic text-white uppercase tracking-tighter">Completed Matches</h3>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        {selectedSession.matches.map((m: any, idx: number) => {
                                            const n = m.player_names || ["?","?","?","?"];
                                            const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                            return (
                                                <div key={m.id} className="bg-white/[0.03] border border-white/5 rounded-[24px] p-4 flex flex-col gap-3 relative overflow-hidden group hover:bg-white/5 transition-all shadow-xl">
                                                    <div className="flex justify-between items-center opacity-20"><span className="text-[7px] font-black uppercase tracking-widest">Match 0{idx+1}</span></div>
                                                    <div className="grid grid-cols-1 gap-2">
                                                        <div className="flex justify-between items-center"><div className="flex flex-col text-[10px] font-black uppercase italic leading-tight"><span className={s1 > s2 ? 'text-white' : 'text-white/30'}>{n[0]}</span><span className={s1 > s2 ? 'text-white' : 'text-white/30'}>{n[1]}</span></div><span className={`text-xl font-[1000] italic ${s1 > s2 ? 'text-[#D4AF37]' : 'text-white/20'}`}>{s1}</span></div>
                                                        <div className="h-px bg-white/5"></div>
                                                        <div className="flex justify-between items-center"><div className="flex flex-col text-[10px] font-black uppercase italic leading-tight"><span className={s2 > s1 ? 'text-white' : 'text-white/30'}>{n[2]}</span><span className={s2 > s1 ? 'text-white' : 'text-white/30'}>{n[3]}</span></div><span className={`text-xl font-[1000] italic ${s2 > s1 ? 'text-[#D4AF37]' : 'text-white/20'}`}>{s2}</span></div>
                                                    </div>
                                                </div>
                                            );
                                         })}
                                    </div>
                                </div>
                                
                                <button onClick={() => setSelectedSessionId(null)} className="w-full py-6 mt-8 rounded-[28px] bg-white/5 text-[10px] font-black uppercase active:scale-95 transition-all mb-32">Back to List</button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-white/5 border border-white/10 rounded-[40px] p-8 mb-8 flex gap-4 shadow-2xl">
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
                                <div key={s.id} onClick={() => { setSelectedSessionId(s.id); setActiveDetailTab('RANKING'); }} className="group bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[50px] p-8 shadow-2xl relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer hover:border-[#D4AF37]/30">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-3 mb-1"><span className="w-8 h-8 bg-black/40 rounded-xl border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] text-[11px] font-[1000]">{index + 1}</span><span className="text-[10px] font-black text-[#EFDFB4] uppercase tracking-[0.2em]">{s.date}</span></div>
                                            <h3 className="text-xl font-[1000] text-white italic tracking-tighter uppercase leading-none">{s.title}</h3>
                                        </div>
                                        <div className="w-10 h-10 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-[#D4AF37]">→</div>
                                    </div>
                                    <div className="flex items-center gap-4 text-[9px] font-black text-white/20 tracking-[0.3em] uppercase"><span>{s.matchCount} Matches Preserved</span></div>
                                    {isAdmin && (
                                        <div className="mt-6 pt-6 border-t border-white/5 flex gap-2">
                                            <button onClick={(e)=>{e.stopPropagation(); editSessionTitle(s.id, s.title);}} className="text-[10px] font-black text-white/20 hover:text-[#D4AF37]">EDIT</button>
                                            <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="text-[10px] font-black text-white/20 hover:text-red-500">DELETE</button>
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
