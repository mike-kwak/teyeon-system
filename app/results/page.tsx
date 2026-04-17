'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Edit3, Trash2, ArrowRight } from 'lucide-react';

/**
 * ResultsPage (Synced v1.8.0): The Teyeon Club Official Database
 * v1.8.0: Card slimming, Admin Icons, Live Mirror UI, High Visibility
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
    <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      <header className="px-8 pt-24 pb-8 flex flex-col gap-3 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          <div className="flex justify-between items-end w-full">
            <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em]">클럽 레코드</span>
                <h1 className="text-4xl sm:text-5xl font-black tracking-tight uppercase text-white" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Results</h1>
            </div>
          </div>
          <div className="h-[1px] w-12 bg-zinc-800 mt-4"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mb-8 flex gap-2">
            {(['RECORDS', 'RANKING'] as const).map(t => (
                <button key={t} onClick={() => setMainTab(t)} className={`flex-1 py-4 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${mainTab === t ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}>
                    {t === 'RECORDS' ? '대회 결과' : '전체 순위'}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-6">
        {loading ? (
            <div className="py-20 text-center"><p className="text-[10px] font-bold text-zinc-600 tracking-widest uppercase">데이터 분석 중...</p></div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {selectedSessionId && selectedSession ? (
                    <div className="animate-in slide-in-from-right duration-500">
                        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 mb-8 relative overflow-hidden">
                            <div className="flex flex-col gap-1 mb-6">
                                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em]">{selectedSession.date}</span>
                                <h2 className="text-2xl font-black text-white leading-tight tracking-tight uppercase">{selectedSession.title}</h2>
                            </div>
                            <div className="bg-black/40 p-1 rounded-xl flex border border-zinc-800">
                                <button className="flex-1 py-3 text-[10px] bg-zinc-100 text-black font-bold uppercase tracking-widest rounded-lg">공식 아카이브 리포트</button>
                            </div>
                        </div>

                        <div className="space-y-12 animate-in fade-in duration-700">
                            {/* Flat Presidential Podium (Minimal Top 3) */}
                            <div className="relative pt-8 mb-8">
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
                                            {/* Minimal Podium Layout */}
                                            <div className="flex items-end justify-center gap-3 max-w-sm mx-auto mb-12 px-4">
                                                {[1, 0, 2].map((idx) => {
                                                    const p = top3[idx];
                                                    if (!p) return <div key={idx} className="flex-1" />;
                                                    const isFirst = idx === 0;
                                                    
                                                    return (
                                                        <div key={p.name} className={`flex flex-col items-center gap-3 ${isFirst ? 'flex-[1.2] z-10' : 'flex-1'}`}>
                                                            <div className={`relative px-4 py-8 rounded-2xl w-full flex flex-col items-center border transition-all ${isFirst ? 'bg-zinc-800 border-zinc-700' : 'bg-zinc-900 border-zinc-800'}`}>
                                                                <div className={`absolute -top-4 w-9 h-9 rounded-full flex items-center justify-center text-xs font-black border transition-colors ${isFirst ? 'bg-white text-black border-white' : 'bg-zinc-900 text-zinc-500 border-zinc-800'}`}>
                                                                    {idx === 0 ? '1' : (idx === 1 ? '2' : '3')}
                                                                </div>
                                                                <div className="flex flex-col items-center w-full min-w-0">
                                                                    <span className={`font-black tracking-tight uppercase truncate w-full text-center ${isFirst ? 'text-lg text-white' : 'text-xs text-zinc-400'}`}>{p.name}</span>
                                                                    <div className="flex items-center gap-1.5 mt-2">
                                                                        <span className="text-[9px] font-bold text-zinc-500">{p.wins}W {p.losses}L</span>
                                                                        <span className={`text-[9px] font-bold ${p.diff >= 0 ? 'text-zinc-300' : 'text-zinc-600'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {isFirst && <div className="text-[8px] font-black text-white uppercase tracking-[0.3em]">우승</div>}
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Minimal Rank Analysis (4th+) */}
                                            <div className="space-y-2">
                                                <div className="px-6 flex justify-between items-center text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                                                    <span>플레이어 성적</span>
                                                    <span>W / L / DIFF</span>
                                                </div>
                                                <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl overflow-hidden">
                                                    {others.map((p: any, idx: number) => (
                                                        <div key={p.name} className="flex items-center justify-between px-8 py-4 border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-all">
                                                            <div className="flex items-center gap-6">
                                                                <span className="text-sm font-black text-zinc-700 w-4">{idx + 4}</span>
                                                                <span className="text-sm font-bold text-zinc-300 uppercase">{p.name}</span>
                                                            </div>
                                                            <div className="flex flex-col items-end">
                                                                <span className="text-xs font-bold text-zinc-400">{p.wins}승 {p.losses}패</span>
                                                                <span className={`text-[9px] font-bold ${p.diff >= 0 ? 'text-zinc-500' : 'text-zinc-600'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</span>
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
                            <div className="space-y-6 animate-in fade-in duration-700">
                                <div className="flex items-center gap-3 px-2">
                                    <div className="h-[1px] w-6 bg-zinc-700"></div>
                                    <h3 className="text-xl font-black text-white uppercase tracking-tight" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>경기 결과</h3>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    {selectedSession.matches.map((m: any, idx: number) => {
                                        const n = m.player_names || ["?","?","?","?"];
                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                        
                                        return (
                                            <div key={m.id || idx} 
                                                 className="rounded-xl relative flex flex-col justify-between overflow-hidden shadow-sm transition-all border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 group">
                                                {/* Dashboard Header Bar */}
                                                <div className="flex items-center justify-between px-3 py-2 bg-black/20 border-b border-zinc-800/30 uppercase">
                                                    <span className="text-[7px] font-bold tracking-[0.2em] text-zinc-500">
                                                        R{m.round || 1} • {m.group_name || m.groupName || 'A'} • M{idx + 1}
                                                    </span>
                                                    {(isAdmin) && (
                                                        <div className="flex items-center gap-2 opacity-20 group-hover:opacity-100 transition-opacity">
                                                            <div className="w-1 h-1 rounded-full bg-zinc-600"></div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="px-3 py-4">
                                                    <div className="grid grid-cols-[1.5fr_1fr_1.5fr] items-center gap-1 min-h-[50px]">
                                                        {/* Team Left Block */}
                                                        <div className="flex flex-col items-center justify-center min-w-0">
                                                            <span className={`text-[10px] font-bold uppercase truncate w-full text-center tracking-tighter ${s1 > s2 ? 'text-white' : 'text-zinc-600'}`}>{n[0]}</span>
                                                            <span className={`text-[10px] font-bold uppercase truncate w-full text-center tracking-tighter ${s1 > s2 ? 'text-white' : 'text-zinc-600'}`}>{n[1]}</span>
                                                        </div>

                                                       {/* Dashboard Score Centerpiece */}
                                                       <div className="flex flex-col items-center justify-center shrink-0">
                                                            <div className="flex items-center gap-1">
                                                                <span className={`text-xl font-black leading-none ${s1 > s2 ? 'text-white' : 'text-zinc-700'}`}>{s1}</span>
                                                                <span className="text-xs font-black text-zinc-800">:</span>
                                                                <span className={`text-xl font-black leading-none ${s2 > s1 ? 'text-white' : 'text-zinc-700'}`}>{s2}</span>
                                                            </div>
                                                        </div>

                                                        {/* Team Right Block */}
                                                        <div className="flex flex-col items-center justify-center min-w-0">
                                                            <span className={`text-[10px] font-bold uppercase truncate w-full text-center tracking-tighter ${s2 > s1 ? 'text-white' : 'text-zinc-600'}`}>{n[2]}</span>
                                                            <span className={`text-[10px] font-bold uppercase truncate w-full text-center tracking-tighter ${s2 > s1 ? 'text-white' : 'text-zinc-600'}`}>{n[3]}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                     })}
                                </div>
                            </div>
                        </div>

                         <button onClick={() => setSelectedSessionId(null)} className="w-full py-5 mt-8 mb-8 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all text-zinc-400">목록으로 돌아가기</button>
                         
                         {/* Layout Spacing Buffer */}
                         <div className="h-96 w-full pointer-events-none"></div>
                      </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-8 flex gap-4 shadow-sm">
                            <div className="flex-1 flex flex-col items-center space-y-2">
                                <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Year</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-xs font-bold text-white outline-none text-center">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center space-y-2">
                                <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Month</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-xs font-bold text-white outline-none text-center">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>
                        <div className="space-y-4">
                            {sessions.map((s, index) => (
                                <div key={s.id} onClick={() => { setSelectedSessionId(s.id); }} className="group bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5 relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer hover:border-zinc-600">
                                    <div className="flex justify-between items-center relative z-10">
                                        <div className="flex items-center gap-4">
                                            <div className="w-9 h-9 bg-black rounded-xl border border-zinc-800 flex items-center justify-center text-zinc-400 text-xs font-black">{index + 1}</div>
                                            <div className="flex flex-col">
                                                <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-widest leading-none mb-1">{s.date}</span>
                                                <h3 className="text-base font-black text-white tracking-tight uppercase leading-tight group-hover:text-zinc-200 transition-colors">{s.title}</h3>
                                                <div className="flex items-center gap-3 mt-1.5 text-[8px] font-bold text-zinc-700 uppercase tracking-widest">
                                                    <span>{s.matchCount} Matches</span>
                                                    <span>•</span>
                                                    <span className="text-zinc-800">Official Report</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isAdmin && (
                                                <div className="flex gap-1 mr-2">
                                                    <button onClick={(e)=>{e.stopPropagation(); editSessionTitle(s.id, s.title);}} className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-white transition-all"><Edit3 className="w-3 h-3" /></button>
                                                    <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-red-500 transition-all"><Trash2 className="w-3 h-3" /></button>
                                                </div>
                                            )}
                                            <ArrowRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-300 transition-colors" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="py-20 text-center opacity-20 font-bold uppercase text-[10px] tracking-widest text-zinc-600">전체 순위 분석 가동 중</div>
        )}
      </section>
    </main>
  );
}
