'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * ResultsPage (Synced v1.7.0): The Hall of Fame Edition
 * High-fidelity podium, Full leaderboard, and Complete Match History Grid
 */
export default function ResultsPage() {
  const { user, role } = useAuth();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING'>('RECORDS');
  const [activeDetailTab, setActiveDetailTab] = useState<'RANKING' | 'MATCHES'>('RANKING');
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
                    isLocal: !!record.isLocal,
                    player_names: resolvedNames,
                    player_ids: pIds
                });
            });
        });
        setArchives(reconstructedMatches);
    }
  }

  const filteredRecords = archives.filter(m => {
    const mDate = new Date(m.match_date);
    return mDate.getFullYear() === selectedYear && (mDate.getMonth() + 1) === selectedMonth;
  });

  const sessions = useMemo(() => {
    const groups: Record<string, any> = {};
    const sorted = [...filteredRecords].sort((a,b) => new Date(b.created_at || b.match_date || 0).getTime() - new Date(a.created_at || a.match_date || 0).getTime());

    sorted.forEach(m => {
        const rawTitle = m.session_title || "Untitled";
        const normalizedTitle = rawTitle.replace('(로컬 저장됨)', '').split(' (로컬 저장됨)')[0].trim();
        const groupKey = normalizedTitle; // v1.7.0 Group by Title strictly

        if (!groups[groupKey]) {
            groups[groupKey] = { id: m.session_id || groupKey, title: normalizedTitle, date: m.match_date, created_at: m.created_at, matches: [], matchCount: 0 };
            groups[groupKey].matches.push(m);
            groups[groupKey].matchCount = 1;
        } else {
            const isMatchDuplicate = groups[groupKey].matches.some((ex: any) => (ex.id === m.id) || (ex.round === m.round && ex.court === m.court));
            if (!isMatchDuplicate) {
                groups[groupKey].matches.push(m);
                groups[groupKey].matchCount++;
            }
        }
    });
    return Object.values(groups).sort((a:any,b:any) => new Date(b.created_at || b.date || 0).getTime() - new Date(a.created_at || a.date || 0).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  const globalLeaderboard = useMemo(() => {
    const stats: Record<string, any> = {};
    archives.forEach(m => {
        const pNames = m.player_names || [];
        const pIds = m.player_ids || [];
        pNames.forEach((name: string, i: number) => {
            const id = pIds[i] || name;
            if (!stats[id]) {
                const member = members.find(mem => mem.nickname === name || mem.id === id);
                stats[id] = { id, name, wins: 0, losses: 0, diff: 0, games: 0, avatar: member?.avatar_url || '' };
            }
            const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
            const win = i < 2 ? (s1 > s2) : (s2 > s1);
            if (win) stats[id].wins++; else if (s1 !== s2) stats[id].losses++;
            stats[id].diff += i < 2 ? (s1 - s2) : (s2 - s1);
            stats[id].games++;
        });
    });
    return Object.values(stats).sort((a:any, b:any) => (b.wins - a.wins) || (b.diff - a.diff));
  }, [archives, members]);

  return (
    <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-y-auto no-scrollbar pt-24 pb-72">
      <header className="px-8 py-6 flex flex-col gap-2 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700">
          <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.5em] opacity-40">System Archive</span>
              <h1 className="text-5xl font-[1000] italic tracking-tight uppercase bg-gradient-to-r from-white via-white to-[#D4AF37] bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Results</h1>
          </div>
          <div className="h-0.5 w-16 bg-gradient-to-r from-[#D4AF37] to-transparent mt-2"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mb-8 flex gap-2">
            {(['RECORDS', 'RANKING'] as const).map(t => (
                <button key={t} onClick={() => setMainTab(t)} className={`flex-1 py-4 rounded-3xl text-[10px] font-black uppercase tracking-widest border transition-all ${mainTab === t ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'bg-white/5 border-white/5 text-white/50'}`}>
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
                        <div className="bg-white/5 border border-white/10 rounded-[35px] p-8 mb-8 relative overflow-hidden shadow-2xl">
                            <div className="flex flex-col gap-1 mb-6">
                                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em]">{selectedSession.date}</span>
                                <h2 className="text-3xl font-[1000] text-white italic leading-tight tracking-tighter uppercase">{selectedSession.title}</h2>
                            </div>
                        </div>

                        <div className="space-y-12 pb-20">
                            {/* Hall of Fame Podium */}
                            {(() => {
                                const stats: Record<string, any> = {};
                                selectedSession.matches.forEach((m: any) => {
                                    m.player_names.forEach((name: string, i: number) => {
                                        if (!stats[name]) {
                                            const member = members.find(mem => mem.nickname === name);
                                            stats[name] = { name, wins: 0, losses: 0, diff: 0, games: 0, avatar: member?.avatar_url || '' };
                                        }
                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                        const win = i < 2 ? (s1 > s2) : (s2 > s1);
                                        if (win) stats[name].wins++; else if (s1 !== s2) stats[name].losses++;
                                        stats[name].diff += i < 2 ? (s1 - s2) : (s2 - s1);
                                        stats[name].games++;
                                    });
                                });
                                const rd = Object.values(stats).sort((a:any,b:any) => (b.wins - a.wins) || (b.diff - a.diff));
                                const top3 = rd.slice(0, 3);
                                const podium = [top3[1] || { name: '-', wins: 0, diff: 0, avatar: '' }, top3[0] || { name: '-', wins: 0, diff: 0, avatar: '' }, top3[2] || { name: '-', wins: 0, diff: 0, avatar: '' }];
                                return (
                                    <div className="relative mt-12 mb-20 flex justify-center items-end gap-2 h-[260px]">
                                        {podium.map((p, idx) => {
                                            const isFirst = idx === 1;
                                            const w = isFirst ? 'w-[145px]' : 'w-[110px]';
                                            return (
                                                <div key={idx} className={`flex flex-col items-center justify-end ${isFirst ? 'z-20 scale-110' : 'z-10 opacity-80'}`}>
                                                    <div className={`relative ${w} rounded-t-[50px] bg-gradient-to-b from-white/10 to-white/5 border-x border-t border-white/20 flex flex-col items-center pt-8 shadow-2xl`} style={{ height: isFirst ? '160px' : '110px' }}>
                                                        <div className={`absolute -top-12 ${isFirst ? 'w-24 h-24' : 'w-18 h-18'} rounded-full border-4 ${isFirst ? 'border-[#D4AF37] shadow-[0_0_30px_rgba(212,175,55,0.4)]' : 'border-white/20'} bg-black overflow-hidden flex items-center justify-center`}>
                                                            {p.avatar ? <img src={p.avatar} alt="avatar" className="w-full h-full object-cover" /> : <span className="text-2xl font-black italic text-white/20">{p.name[0]}</span>}
                                                        </div>
                                                        <span className={`mt-2 font-[1000] italic uppercase tracking-tighter ${isFirst ? 'text-xl text-white' : 'text-sm text-white/60'}`}>{p.name}</span>
                                                        <div className="flex items-center gap-1 mt-1 opacity-60 text-[10px] font-black"><span>{p.wins}W</span>-<span>{p.games-p.wins}L</span><span className={p.diff >= 0 ? 'text-[#4ADE80]' : 'text-red-500'}>{p.diff > 0 ? `+${p.diff}` : p.diff}</span></div>
                                                        {isFirst && <div className="mt-2 bg-[#D4AF37] text-black px-4 py-1 rounded-full text-[9px] font-[1000] italic flex flex-col items-center shadow-lg transform -rotate-1"><span>#1 CHAMP</span><span className="text-[7px] leading-none opacity-60">₩10,000 PRIZE</span></div>}
                                                    </div>
                                                    <div className={`${w} h-14 bg-white/5 border-x border-b border-white/20 rounded-b-3xl flex items-center justify-center font-[1000] italic ${isFirst ? 'text-[#D4AF37] text-5xl' : 'text-white/10 text-3xl'}`}>{idx === 0 ? '2' : idx === 1 ? '1' : '3'}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}

                            {/* Ranking Table (All Participants) */}
                            <div className="bg-white/[0.03] border border-white/10 rounded-[40px] overflow-hidden shadow-2xl">
                                <table className="w-full text-left">
                                    <thead className="bg-white/5 text-[8px] font-black text-white/30 uppercase tracking-widest border-b border-white/5"><tr><th className="px-8 py-5">Rank</th><th className="px-2 py-5">Player</th><th className="px-8 py-5 text-right">Diff</th></tr></thead>
                                    <tbody>
                                        {(() => {
                                            const s: Record<string, any> = {};
                                            selectedSession.matches.forEach((m: any) => {
                                                m.player_names.forEach((n: string, i: number) => {
                                                    if (!s[n]) s[n] = { n, w: 0, d: 0 };
                                                    const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                                    if (i < 2 ? (s1 > s2) : (s2 > s1)) s[n].w++;
                                                    s[n].d += i < 2 ? (s1 - s2) : (s2 - s1);
                                                });
                                            });
                                            return Object.values(s).sort((a:any,b:any) => (b.w-a.w) || (b.d-a.d)).map((p:any, i:number) => (
                                                <tr key={p.n} className={`border-t border-white/5 ${i < 3 ? 'bg-white/[0.02]' : 'opacity-40'}`}><td className={`px-8 py-5 font-[1000] italic text-lg ${i === 0 ? 'text-[#D4AF37]' : 'text-white/20'}`}>{i + 1}</td><td className="px-2 py-5 font-black text-xs uppercase tracking-tighter">{p.n}</td><td className={`px-8 py-5 text-right font-[1000] italic ${p.d >= 0 ? 'text-[#4ADE80]' : 'text-red-500'}`}>{p.d > 0 ? `+${p.d}` : p.d}</td></tr>
                                            ));
                                        })()}
                                    </tbody>
                                </table>
                            </div>

                            {/* Completed Matches History Grid */}
                            <div className="space-y-6 pt-12">
                                <div className="flex items-center gap-4 px-2">
                                    <div className="h-0.5 w-12 bg-[#D4AF37] rounded-full"></div>
                                    <h3 className="text-3xl font-[1000] italic text-white uppercase tracking-tighter" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Completed Matches</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    {selectedSession.matches.map((m: any, idx: number) => {
                                        const n = m.player_names || ["?","?","?","?"];
                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                        return (
                                            <div key={m.id} className="bg-white/[0.04] border border-white/10 rounded-[30px] p-5 flex flex-col gap-4 relative shadow-2xl overflow-hidden group hover:bg-white/10 transition-all text-white/10">
                                                <div className="flex justify-between items-center text-[8px] font-black opacity-30"><span className="uppercase tracking-widest">MATCH 0{idx+1}</span><span className="uppercase tracking-widest">RECORD V2</span></div>
                                                <div className="grid grid-cols-1 gap-3">
                                                    <div className="flex justify-between items-center"><div className="flex flex-col text-[10px] font-black uppercase leading-[1.1] italic"><span className={s1 > s2 ? 'text-white' : 'text-white/20'}>{n[0]}</span><span className={s1 > s2 ? 'text-white' : 'text-white/20'}>{n[1]}</span></div><span className={`text-2xl font-[1000] italic ${s1 > s2 ? 'text-[#D4AF37]' : 'text-white/10'}`}>{s1}</span></div>
                                                    <div className="h-px bg-white/10 w-full"></div>
                                                    <div className="flex justify-between items-center"><div className="flex flex-col text-[10px] font-black uppercase leading-[1.1] italic"><span className={s2 > s1 ? 'text-white' : 'text-white/20'}>{n[2]}</span><span className={s2 > s1 ? 'text-white' : 'text-white/20'}>{n[3]}</span></div><span className={`text-2xl font-[1000] italic ${s2 > s1 ? 'text-[#D4AF37]' : 'text-white/10'}`}>{s2}</span></div>
                                                </div>
                                            </div>
                                        );
                                     })}
                                </div>
                            </div>
                            
                            <button onClick={() => setSelectedSessionId(null)} className="w-full py-8 mt-8 rounded-[40px] bg-white/5 border border-white/10 text-[11px] font-black uppercase tracking-[0.4em] active:scale-95 transition-all mb-32 text-white/40">Return to Archive</button>
                        </div>
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
                                <div key={s.id} onClick={() => { setSelectedSessionId(s.id); setActiveDetailTab('RANKING'); }} className="group bg-white/[0.03] border border-white/10 rounded-[50px] p-10 shadow-2xl relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer hover:border-[#D4AF37]/30 min-h-[170px] flex flex-col justify-center">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#D4AF37]/5 rounded-full blur-3xl -mr-10 -mt-10"></div>
                                    <div className="flex justify-between items-start relative z-10 mb-4">
                                        <div className="flex flex-col gap-2 flex-1 pr-6">
                                            <div className="flex items-center gap-3">
                                                <span className="w-8 h-8 bg-black/40 rounded-xl border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] text-[11px] font-[1000]">{index + 1}</span>
                                                <span className="text-[10px] font-black text-[#EFDFB4] uppercase tracking-[0.2em]">{s.date}</span>
                                            </div>
                                            <h3 className="text-2xl font-[1000] text-white italic tracking-tighter uppercase leading-tight">{s.title}</h3>
                                        </div>
                                        <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-[#D4AF37] group-hover:scale-110 transition-transform shadow-lg border border-[#D4AF37]/20 flex-shrink-0 mt-1">→</div>
                                    </div>
                                    <div className="flex items-center gap-4 text-[9px] font-black text-white/20 tracking-[0.3em] uppercase relative z-10">
                                        <span className={s.matches[0]?.isLocal ? 'text-[#D4AF37] animate-pulse' : ''}>{s.matches[0]?.isLocal ? 'LOCAL CACHE' : 'CLOUD SYNCED'}</span>
                                        <span className="opacity-10">|</span>
                                        <span>{s.matchCount} Matches Preserved</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="animate-in fade-in duration-500">
                <div className="bg-white/[0.03] border border-white/10 rounded-[40px] overflow-hidden shadow-2xl">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 text-[8px] font-black text-white/30 uppercase tracking-widest border-b border-white/5"><tr><th className="px-8 py-5">Rank</th><th className="px-2 py-5">Player</th><th className="px-8 py-5 text-right">Diff</th></tr></thead>
                        <tbody>{globalLeaderboard.map((p, i) => (
                            <tr key={p.id} className={`border-t border-white/5 ${i < 3 ? 'bg-white/[0.02]' : 'opacity-40'}`}><td className={`px-8 py-5 font-[1000] italic text-lg ${i === 0 ? 'text-[#D4AF37]' : 'text-white/20'}`}>{i + 1}</td><td className="px-2 py-5 font-black text-xs uppercase tracking-tighter">{p.name}</td><td className={`px-8 py-5 text-right font-[1000] italic ${p.diff > 0 ? 'text-[#4ADE80]' : 'text-red-500'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</td></tr>
                        ))}</tbody>
                    </table>
                </div>
            </div>
        )}
      </section>
    </main>
  );
}
