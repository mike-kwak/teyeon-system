'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Edit3, Trash2, ArrowRight } from 'lucide-react';

/**
 * ResultsPage (Synced v1.13.0): The Modern Executive Edition
 * v1.13.0: Modern Dark UI, 3D Elevation Cards, Mint/Gold Badge System
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
    <main className="flex flex-col min-h-screen bg-[#0a0a0c] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      <header className="px-8 pt-24 pb-8 flex flex-col gap-3 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          <div className="flex justify-between items-end w-full">
            <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black text-[#4ADE80] uppercase tracking-[0.5em] opacity-80">Season Records</span>
                <h1 className="text-5xl sm:text-6xl font-black tracking-tighter uppercase bg-gradient-to-b from-white to-white/20 bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Results</h1>
            </div>
          </div>
          <div className="h-1 w-16 bg-gradient-to-r from-[#4ADE80] to-transparent rounded-full mt-6 shadow-[0_0_15px_#4ADE80/20]"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mb-10 flex gap-2.5">
            {(['RECORDS', 'RANKING'] as const).map(t => (
                <button 
                    key={t} onClick={() => setMainTab(t)}
                    className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all relative overflow-hidden group ${mainTab === t ? 'bg-zinc-100 text-black shadow-xl shadow-white/5' : 'bg-zinc-900/50 border border-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
                >
                    {t === 'RECORDS' ? '대회 결과' : '전체 순위'}
                    {mainTab === t && <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent"></div>}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-6">
        {loading ? (
            <div className="py-24 text-center">
                <div className="relative w-12 h-12 mx-auto mb-6">
                    <div className="absolute inset-0 border-2 border-[#4ADE80]/20 rounded-full"></div>
                    <div className="absolute inset-0 border-2 border-[#4ADE80] border-t-transparent rounded-full animate-spin"></div>
                </div>
                <p className="text-[11px] font-black text-zinc-600 tracking-[0.3em] uppercase">Analyzing Vault...</p>
            </div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {selectedSessionId && selectedSession ? (
                    <div className="animate-in slide-in-from-right duration-500">
                        <div className="bg-zinc-900/60 border border-white/5 rounded-[40px] p-8 mb-10 relative overflow-hidden backdrop-blur-3xl shadow-2xl">
                            <div className="flex flex-col gap-1 mb-8">
                                <span className="text-[11px] font-black text-[#D4AF37] uppercase tracking-[0.4em] mb-2">{selectedSession.date}</span>
                                <h2 className="text-3xl font-black text-white leading-tight tracking-tighter uppercase">{selectedSession.title}</h2>
                            </div>
                            <div className="bg-black/40 p-1.5 rounded-[22px] flex border border-white/5">
                                <button className="flex-1 py-3.5 text-[11px] bg-[#4ADE80] text-black font-black uppercase tracking-widest rounded-[18px] shadow-lg shadow-[#4ADE80]/20 transition-all active:scale-95">Official Recap Mode</button>
                            </div>
                            <div className="absolute top-0 right-0 w-64 h-64 bg-[#4ADE80]/5 blur-[80px] -z-10 pointer-events-none"></div>
                        </div>

                        <div className="space-y-16 animate-in fade-in duration-700">
                            {/* Modern Dark Podium */}
                            <div className="relative pt-10 mb-10">
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
                                    const top3 = rankingData.slice(0, 3);
                                    const others = rankingData.slice(3);

                                    return (
                                        <>
                                            {/* Modern Podium Layout */}
                                            <div className="flex items-end justify-center gap-3.5 max-w-md mx-auto mb-20 px-4">
                                                {[1, 0, 2].map((idx) => {
                                                    const p = top3[idx];
                                                    if (!p) return <div key={idx} className="flex-1" />;
                                                    const isFirst = idx === 0;
                                                    
                                                    return (
                                                        <div key={p.name} className={`flex flex-col items-center gap-5 ${isFirst ? 'flex-[1.4] z-10' : 'flex-1 opacity-90'}`}>
                                                            <div className={`relative px-5 py-10 rounded-[35px] w-full flex flex-col items-center border shadow-2xl transition-all ${isFirst ? 'bg-zinc-900 border-[#D4AF37]/40 ring-1 ring-[#D4AF37]/10 scale-110' : 'bg-zinc-900/80 border-white/5'}`} style={{ backdropFilter: 'blur(40px)' }}>
                                                                <div className={`absolute -top-7 w-12 h-12 rounded-[18px] flex items-center justify-center text-sm font-black border-2 rotate-12 transition-all ${isFirst ? 'bg-[#D4AF37] border-white/40 text-black shadow-[0_0_20px_#D4AF37/40]' : 'bg-zinc-800 border-white/10 text-zinc-400 rotate-0'}`}>
                                                                    {idx === 0 ? '1' : (idx === 1 ? '2' : '3')}
                                                                </div>
                                                                <div className="flex flex-col items-center w-full min-w-0">
                                                                    <span className={`font-black tracking-tighter uppercase truncate w-full text-center ${isFirst ? 'text-2xl text-white' : 'text-sm text-white/50'}`}>{p.name}</span>
                                                                    <div className={`mt-4 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isFirst ? 'bg-[#4ADE80]/10 text-[#4ADE80]' : 'bg-white/5 text-zinc-600'}`}>
                                                                        {p.wins}W {p.losses}L
                                                                    </div>
                                                                    <div className={`mt-2 font-black text-xs ${p.diff >= 0 ? 'text-zinc-300' : 'text-zinc-600'}`}>
                                                                        {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {isFirst && <div className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em] animate-pulse">Champion</div>}
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Modern Analytics List (4th+) */}
                                            <div className="space-y-4">
                                                <div className="px-8 flex justify-between items-center text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">
                                                    <span>Performance Analysis</span>
                                                    <span>Score / NET</span>
                                                </div>
                                                <div className="bg-zinc-900/30 border border-white/5 rounded-[45px] overflow-hidden backdrop-blur-xl">
                                                    {others.map((p: any, idx: number) => (
                                                        <div key={p.name} className="flex items-center justify-between px-10 py-6 border-b border-white/[0.03] hover:bg-white/[0.04] transition-all group">
                                                            <div className="flex items-center gap-8">
                                                                <span className="text-xl font-black text-zinc-800 group-hover:text-[#4ADE80]/30 transition-colors w-8">{idx + 4}</span>
                                                                <span className="text-lg font-black text-zinc-300 uppercase tracking-tight">{p.name}</span>
                                                            </div>
                                                            <div className="flex flex-col items-end gap-1">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]"></div>
                                                                    <span className="text-base font-black text-white">{p.wins} Wins</span>
                                                                </div>
                                                                <span className={`text-[11px] font-black ${p.diff >= 0 ? 'text-zinc-500' : 'text-zinc-700'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff} Differential</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>

                            {/* Dashboard Match History Container */}
                            <div className="space-y-8 animate-in fade-in duration-700">
                                <div className="flex items-center justify-between px-4">
                                    <div className="flex items-center gap-4">
                                        <div className="h-6 w-1.5 bg-[#4ADE80] rounded-full"></div>
                                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>경기 결과</h3>
                                    </div>
                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{selectedSession.matches.length} Total</span>
                                </div>
                                <div className="grid grid-cols-2 gap-5">
                                    {selectedSession.matches.map((m: any, idx: number) => {
                                        const n = m.player_names || ["?","?","?","?"];
                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                        
                                        return (
                                            <div key={m.id || idx} 
                                                 className="rounded-[30px] relative flex flex-col justify-between overflow-hidden shadow-2xl transition-all border border-white/5 bg-zinc-900/40 hover:border-white/20 active:scale-95 group">
                                                {/* Dashboard Header Bar */}
                                                <div className="flex items-center justify-between px-4 py-3 bg-black/20 border-b border-white/5 uppercase">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-700"></div>
                                                        <span className="text-[8px] font-black tracking-[0.2em] text-zinc-500">
                                                            R{m.round || 1} • G{m.group_name || m.groupName || 'A'}
                                                        </span>
                                                    </div>
                                                    {(isAdmin) && (
                                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <div className="w-1 h-1 rounded-full bg-zinc-600"></div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="px-4 py-6">
                                                    <div className="grid grid-cols-[1.5fr_1fr_1.5fr] items-center gap-2 min-h-[60px]">
                                                        {/* Team Left Block */}
                                                        <div className="flex flex-col items-center justify-center min-w-0 bg-black/20 py-3 rounded-2xl border border-white/[0.02]">
                                                            <span className={`text-[11px] font-black uppercase truncate w-full text-center tracking-tighter ${s1 > s2 ? 'text-white' : 'text-zinc-700'}`}>{n[0]}</span>
                                                            <span className={`text-[11px] font-black uppercase truncate w-full text-center tracking-tighter ${s1 > s2 ? 'text-white' : 'text-zinc-700'}`}>{n[1]}</span>
                                                        </div>

                                                       {/* Dashboard Score Centerpiece */}
                                                       <div className="flex flex-col items-center justify-center shrink-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-2xl font-black leading-none ${s1 > s2 ? 'text-[#4ADE80] drop-shadow-[0_0_10px_#4ADE80/40]' : 'text-zinc-800'}`}>{s1}</span>
                                                                <span className="text-xs font-black text-zinc-900">:</span>
                                                                <span className={`text-2xl font-black leading-none ${s2 > s1 ? 'text-[#4ADE80] drop-shadow-[0_0_10px_#4ADE80/40]' : 'text-zinc-800'}`}>{s2}</span>
                                                            </div>
                                                        </div>

                                                        {/* Team Right Block */}
                                                        <div className="flex flex-col items-center justify-center min-w-0 bg-black/20 py-3 rounded-2xl border border-white/[0.02]">
                                                            <span className={`text-[11px] font-black uppercase truncate w-full text-center tracking-tighter ${s2 > s1 ? 'text-white' : 'text-zinc-700'}`}>{n[2]}</span>
                                                            <span className={`text-[11px] font-black uppercase truncate w-full text-center tracking-tighter ${s2 > s1 ? 'text-white' : 'text-zinc-700'}`}>{n[3]}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                     })}
                                </div>
                            </div>
                        </div>

                         <button onClick={() => setSelectedSessionId(null)} className="w-full py-6 mt-12 mb-12 rounded-[28px] bg-zinc-900 border border-white/10 text-[12px] font-black uppercase tracking-[0.3em] hover:bg-zinc-800 transition-all text-white/50 active:scale-95">Back to Records List</button>
                         
                         {/* Layout Spacing Buffer */}
                         <div className="h-96 w-full pointer-events-none"></div>
                      </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-zinc-900/60 border border-white/5 rounded-[40px] p-8 mb-10 flex gap-5 shadow-2xl backdrop-blur-3xl">
                            <div className="flex-1 flex flex-col items-center space-y-3">
                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Year</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-800 rounded-2xl px-6 py-4 text-xs font-black text-white outline-none text-center">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center space-y-3">
                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Month</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-800 rounded-2xl px-6 py-4 text-xs font-black text-white outline-none text-center">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>
                        <div className="space-y-4">
                            {sessions.map((s, index) => (
                                <div key={s.id} onClick={() => { setSelectedSessionId(s.id); }} className="group bg-zinc-900/40 border border-white/5 rounded-[32px] p-6 relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer hover:border-[#4ADE80]/30 shadow-2xl">
                                    <div className="flex justify-between items-center relative z-10">
                                        <div className="flex items-center gap-5">
                                            <div className="w-11 h-11 bg-black rounded-2xl border border-white/10 flex items-center justify-center text-zinc-500 text-[13px] font-black group-hover:text-[#4ADE80] transition-all">{index + 1}</div>
                                            <div className="flex flex-col">
                                                <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] leading-none mb-2">{s.date}</span>
                                                <h3 className="text-lg font-black text-white tracking-tighter uppercase leading-tight group-hover:text-white transition-colors">{s.title}</h3>
                                                <div className="flex items-center gap-3 mt-2 text-[9px] font-black text-zinc-700 uppercase tracking-widest">
                                                    <span>{index === 0 ? 'Latest Results Available' : `${s.matchCount} Matches Analyzed`}</span>
                                                    <span>•</span>
                                                    <span className="text-zinc-800 tracking-[0.4em]">Report Synced</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {isAdmin && (
                                                <div className="flex gap-1.5 mr-2">
                                                    <button onClick={(e)=>{e.stopPropagation(); editSessionTitle(s.id, s.title);}} className="p-3 rounded-2xl bg-zinc-800/80 border border-white/5 text-zinc-600 hover:text-white transition-all"><Edit3 className="w-3.5 h-3.5" /></button>
                                                    <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="p-3 rounded-2xl bg-zinc-800/80 border border-white/5 text-zinc-600 hover:text-red-500 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                                                </div>
                                            )}
                                            <div className="w-10 h-10 rounded-full border border-white/5 flex items-center justify-center text-zinc-700 group-hover:text-[#4ADE80] group-hover:border-[#4ADE80]/20 transition-all">
                                                <ArrowRight className="w-5 h-5" />
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
            <div className="py-48 text-center bg-zinc-900/10 rounded-[50px] border border-zinc-900">
                <p className="text-[12px] font-black uppercase tracking-[0.6em] text-zinc-800 tracking-[0.4em]">Ranking Vault Active</p>
            </div>
        )}
      </section>
    </main>
  );
}
