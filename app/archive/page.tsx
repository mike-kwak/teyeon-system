'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * ArchivePage: The Teyeon Club Official Database
 * v1.1.0-beta.5: Triple-Tab Overhaul (Records, Global Ranking, Hall of Fame)
 */
export default function ArchivePage() {
  const { user, role } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [sessionDetail, setSessionDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING' | 'HOF'>('RECORDS');
  const [activeDetailTab, setActiveDetailTab] = useState<'MATCHES' | 'RANKING' | 'PERSONAL'>('MATCHES');
  const [rankingFilter, setRankingFilter] = useState<'WEEK' | 'MONTH' | 'YEAR' | 'ALL'>('MONTH');
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);

  const CEO_EMAIL = process.env.NEXT_PUBLIC_CEO_EMAIL || 'cws786@nate.com';
  const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',');
  const isAdmin = userEmail && (userEmail === CEO_EMAIL || ADMIN_EMAILS.includes(userEmail));
  
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  useEffect(() => {
    checkUser();
    fetchArchives();
    fetchMembers();
  }, [selectedYear, selectedMonth]);

  // Handle Deep Linking from Live Dashboard
  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl) {
        setTimeout(() => {
            selectSession(sessionFromUrl);
            setActiveDetailTab('RANKING'); // Auto-focus on Ranking for one-stop deep links
        }, 500); // Give a little buffer for archives to load
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
            .from('matches_archive')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        setArchives(data || []);
    } catch (err: any) {
        console.error("Archive Fetch Error:", err);
    } finally {
        setLoading(false);
    }
  }

  async function selectSession(id: string) {
    if (window.navigator?.vibrate) window.navigator.vibrate(50);
    setSelectedSessionId(id);
    setActiveDetailTab('MATCHES');
    try {
        const { data } = await supabase.from('sessions_archive').select('*').eq('id', id).single();
        setSessionDetail(data || null);
    } catch {
        setSessionDetail(null);
    }
  }

  async function seedDemoData() {
    if (isSeeding) return;
    setIsSeeding(true);
    try {
        const names = ['황희찬', '손흥민', '이강인', '김민재', '조규성', '황인범', '설영우', '이재성', '조현우', '정우영'];
        const dummySessions = [
            { id: 'DEMO-1', title: '테연 v2 오픈 기념 정기전', date: '2026-03-01' },
            { id: 'DEMO-2', title: '3월 둘째주 목요 야간 테니스', date: '2026-03-12' },
            { id: 'DEMO-3', title: '테연 vs 고대 클럽 교류전', date: '2026-03-15' },
            { id: 'DEMO-4', title: 'CEO배 스페셜 하이레벨 토너먼트', date: '2026-03-22' },
            { id: 'DEMO-5', title: '3월 피날레 정기 대진표', date: '2026-03-28' },
        ];

        const matchRecords = [];
        for (const sess of dummySessions) {
            // Snapshot Session Metadata
            const sessionSnapshot = {
                id: sess.id,
                title: sess.title,
                date: sess.date,
                ranking_data: [
                    { id: 'p1', name: '손흥민', wins: 3, losses: 0, diff: 18, avatar: '' },
                    { id: 'p2', name: '김민재', wins: 2, losses: 1, diff: 5, avatar: '' },
                    { id: 'p3', name: '황희찬', wins: 1, losses: 2, diff: -2, avatar: '' },
                    { id: 'p4', name: '이강인', wins: 0, losses: 3, diff: -21, avatar: '' }
                ],
                player_metadata: {},
                total_matches: 4,
                total_rounds: 1
            };
            await supabase.from('sessions_archive').upsert([sessionSnapshot]);

            // Matches
            for (let r = 1; r <= 4; r++) {
                const p = [...names].sort(() => 0.5 - Math.random());
                matchRecords.push({
                    id: `arch-demo-${sess.id}-${r}`,
                    session_id: sess.id,
                    session_title: sess.title,
                    match_date: sess.date,
                    player_names: [p[0], p[1], p[2], p[3]],
                    player_ids: ['d1','d2','d3','d4'],
                    score1: Math.floor(Math.random() * 7),
                    score2: Math.floor(Math.random() * 7),
                    round: 1,
                    court: r,
                    created_at: new Date(sess.date).toISOString()
                });
            }
        }

        const { error } = await supabase.from('matches_archive').upsert(matchRecords);
        if (error) throw error;
        
        alert("✅ 데모 데이터 생성 완료! (공식 3-탭 아카이브 포함)");
        fetchArchives();
    } catch (err: any) {
        alert("시딩 실패: " + err.message);
    } finally {
        setIsSeeding(false);
    }
  }

  async function deleteSession(sessionId: string, title: string) {
    if (!isAdmin) return;
    if (!confirm(`[${title}] 전체 대진 기록을 삭제하시겠습니까?`)) return;

    try {
        await supabase.from('matches_archive').delete().eq('session_id', sessionId);
        await supabase.from('sessions_archive').delete().eq('id', sessionId);
        alert("성공적으로 삭제되었습니다.");
        fetchArchives();
    } catch (err: any) {
        alert("삭제 실패: " + err.message);
    }
  }

  async function deleteMatch(id: string) {
    if (!isAdmin) return;
    if (!confirm("이 경기를 삭제하시겠습니까?")) return;

    try {
        const { error } = await supabase.from('matches_archive').delete().eq('id', id);
        if (error) throw error;
        fetchArchives();
    } catch (err: any) {
        alert("삭제 실패: " + err.message);
    }
  }

  // --- Overall Ranking Logic ---
  const globalLeaderboard = useMemo(() => {
    if (!archives.length) return [];

    const now = new Date();
    const filteredMatches = archives.filter(m => {
        const mDate = new Date(m.match_date);
        if (rankingFilter === 'WEEK') {
            const lastWeek = new Date();
            lastWeek.setDate(now.getDate() - 7);
            return mDate >= lastWeek;
        }
        if (rankingFilter === 'MONTH') return mDate.getMonth() === now.getMonth() && mDate.getFullYear() === now.getFullYear();
        if (rankingFilter === 'YEAR') return mDate.getFullYear() === now.getFullYear();
        return true; // ALL
    });

    const stats: Record<string, { id: string, name: string, wins: number, losses: number, diff: number, games: number, avatar: string }> = {};

    filteredMatches.forEach(m => {
        const pNames = m.player_names || [];
        const pIds = m.player_ids || []; // Fallback to names if IDs missing
        
        pNames.forEach((name: string, i: number) => {
            const id = pIds[i] || name;
            if (!stats[id]) {
                const member = members.find(mem => mem.nickname === name || mem.id === id);
                stats[id] = { id, name, wins: 0, losses: 0, diff: 0, games: 0, avatar: member?.avatar_url || '' };
            }
            
            const isTeam1 = i < 2;
            const s1 = Number(m.score1 || 0);
            const s2 = Number(m.score2 || 0);
            const win = isTeam1 ? (s1 > s2) : (s2 > s1);
            const d = isTeam1 ? (s1 - s2) : (s2 - s1);

            stats[id].games++;
            if (win) stats[id].wins++;
            else if (s1 !== s2) stats[id].losses++;
            stats[id].diff += d;
        });
    });

    return Object.values(stats).map(p => ({
        ...p,
        winRate: p.games > 0 ? (p.wins / p.games) * 100 : 0
    })).sort((a, b) => 
        (b.wins - a.wins) || 
        (b.winRate - a.winRate) || 
        (b.diff - a.diff)
    );
  }, [archives, members, rankingFilter]);

  const myRank = useMemo(() => {
    if (!userEmail) return null;
    const member = members.find(m => m.email === userEmail);
    if (!member) return null;
    const index = globalLeaderboard.findIndex(p => p.name === member.nickname || p.id === member.id);
    if (index === -1) return null;
    return { rank: index + 1, ...globalLeaderboard[index] };
  }, [globalLeaderboard, userEmail, members]);

  // --- Tournament Records Grouping ---
  const filteredRecords = archives.filter(m => {
    const mDate = new Date(m.match_date);
    return mDate.getFullYear() === selectedYear && (mDate.getMonth() + 1) === selectedMonth;
  });

  const sessions = useMemo(() => {
    const groups: Record<string, any> = {};
    filteredRecords.forEach(m => {
        const sid = m.session_id || 'legacy';
        if (!groups[sid]) {
            groups[sid] = {
                id: sid,
                title: m.session_title || 'Untitled',
                date: m.match_date,
                matches: [],
                matchCount: 0
            };
        }
        groups[sid].matchCount++;
        groups[sid].matches.push(m);
    });
    return Object.values(groups).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-x-hidden pt-4">

      {/* Flagship Tab Navigation */}
      {!selectedSessionId && (
        <nav className="px-6 mb-8 flex gap-2">
            {(['RECORDS', 'RANKING', 'HOF'] as const).map(t => (
                <button 
                    key={t} 
                    onClick={() => setMainTab(t)}
                    className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border ${mainTab === t ? 'bg-[#D4AF37] border-[#D4AF37] text-black shadow-lg shadow-[#D4AF37]/20' : 'bg-white/5 border-white/5 text-white/40'}`}
                >
                    {t === 'RECORDS' ? '대회 기록' : t === 'RANKING' ? '전체 랭킹' : '명예의 전당'}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-6 pb-32">
        {loading ? (
            <div className="py-20 text-center animate-pulse"><div className="w-8 h-8 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div><p className="text-[10px] font-black text-[#D4AF37] tracking-widest uppercase">Initializing Vault...</p></div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {selectedSessionId && selectedSession ? (
                    /* Deep Recap Level 3 */
                    <div className="animate-in slide-in-from-right duration-500">
                        <div className="bg-white/5 border border-white/10 rounded-[35px] p-8 mb-8 relative overflow-hidden">
                            <div className="flex flex-col gap-1 mb-6">
                                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em]">{selectedSession.date}</span>
                                <div className="flex items-center justify-between gap-2">
                                  <h2 className="text-2xl font-[1000] text-white italic leading-tight tracking-tighter uppercase">{selectedSession.title}</h2>
                                  {(role === 'ADMIN' || role === 'CEO') && (
                                    <button 
                                      onClick={() => {
                                        if (confirm('⚠️ 이 세션과 모든 경기 기록을 정말 삭제하시겠습니까?')) {
                                          supabase.from('matches').delete().eq('session_id', selectedSessionId).then(() => {
                                            setSelectedSessionId(null);
                                            window.location.reload();
                                          });
                                        }
                                      }}
                                      className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] font-black uppercase tracking-widest active:scale-90 transition-transform"
                                    >
                                      Delete Session
                                    </button>
                                  )}
                                </div>
                            </div>
                            <div className="bg-black/60 p-1 rounded-2xl flex border border-white/5">
                                {(['MATCHES', 'RANKING', 'PERSONAL'] as const).map(t => (
                                    <button key={t} onClick={() => setActiveDetailTab(t)} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${activeDetailTab === t ? 'bg-[#D4AF37] text-black' : 'text-white/30'}`}>{t}</button>
                                ))}
                            </div>
                        </div>

                        {activeDetailTab === 'MATCHES' && (
                            <div className="space-y-8">
                                {Array.from(new Set(selectedSession.matches.map((m:any) => m.round || 1))).sort((a:any,b:any)=>a-b).map((round:any) => (
                                    <div key={round} className="space-y-4">
                                        <h3 className="text-[10px] font-black text-white/20 tracking-[0.4em] uppercase text-center flex items-center gap-4"><span className="h-px flex-1 bg-white/5"></span>Round 0{round}<span className="h-px flex-1 bg-white/5"></span></h3>
                                        {selectedSession.matches.filter((m:any) => (m.round||1) === round).map((m:any, idx:number) => {
                                            const n = m.player_names || ["?","?","?","?"];
                                            const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                            return (
                                                <div key={m.id} className="bg-white/[0.03] border border-white/5 rounded-[30px] p-5 relative">
                                                    <span className="absolute top-4 left-6 text-[7px] font-black text-white/10 uppercase tracking-widest">Court {m.court || idx + 1}</span>
                                                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 pt-4">
                                                        <div className="text-center flex flex-col gap-1 items-center"><span className={`text-xs font-black truncate w-20 ${s1 > s2 ? 'text-[#D4AF37]' : 'opacity-30'}`}>{n[0]}</span><span className={`text-xs font-black truncate w-20 ${s1 > s2 ? 'text-[#D4AF37]' : 'opacity-30'}`}>{n[1]}</span></div>
                                                        <div className="bg-black/80 border border-white/10 px-5 py-2 rounded-2xl font-black italic text-lg">{s1} : {s2}</div>
                                                        <div className="text-center flex flex-col gap-1 items-center"><span className={`text-xs font-black truncate w-20 ${s2 > s1 ? 'text-[#D4AF37]' : 'opacity-30'}`}>{n[2]}</span><span className={`text-xs font-black truncate w-20 ${s2 > s1 ? 'text-[#D4AF37]' : 'opacity-30'}`}>{n[3]}</span></div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeDetailTab === 'RANKING' && (
                            <div className="bg-white/[0.03] border border-white/5 rounded-[40px] p-2">
                                {(() => {
                                    const rankingData = sessionDetail?.ranking_data?.length 
                                        ? sessionDetail.ranking_data 
                                        : (() => {
                                            // Dynamic Calculation Fallback
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
                                            return Object.values(stats).sort((a,b) => (b.wins - a.wins) || (b.diff - a.diff)).map((p, i) => ({ id: p.name, ...p }));
                                        })();

                                    if (!rankingData || rankingData.length === 0) {
                                        return <p className="py-20 text-center text-white/20 font-black uppercase text-[10px] tracking-widest">No Ranking Data</p>;
                                    }

                                    return (
                                        <table className="w-full text-left">
                                            <thead className="text-[9px] font-black text-white/20 uppercase tracking-widest"><tr><th className="px-6 py-6 font-black">Rank</th><th className="px-2 py-6">Player</th><th className="px-2 py-6 text-center">W/L</th><th className="px-4 py-6 text-right">Diff</th></tr></thead>
                                            <tbody>{rankingData.map((p:any, idx:number) => (
                                                <tr key={p.id} className={`border-t border-white/5 ${idx === 0 ? 'bg-[#D4AF37]/5' : ''}`}>
                                                    <td className="px-6 py-5 flex items-center gap-2"><span className={`text-xl font-black italic ${idx === 0 ? 'text-[#D4AF37]' : 'text-white/40'}`}>{idx + 1}</span>{idx < 3 && <span className="text-xs">{idx === 0 ? '👑' : idx === 1 ? '🥈' : '🥉'}</span>}</td>
                                                    <td className="px-2 py-5 font-black text-xs">{p.name}</td>
                                                    <td className="px-2 py-5 text-center text-[10px] font-black opacity-30">{p.wins}승 {p.losses}패</td>
                                                    <td className={`px-4 py-5 text-right font-black italic ${p.diff > 0 ? 'text-[#4ADE80]' : 'text-red-500'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</td>
                                                </tr>
                                            ))}</tbody>
                                        </table>
                                    );
                                })()}
                            </div>
                        )}

                        {activeDetailTab === 'PERSONAL' && (
                             <div className="space-y-4">
                                {(() => {
                                    const pSet = new Set<string>();
                                    selectedSession.matches.forEach((m:any) => m.player_names?.forEach((n:string)=>pSet.add(n)));
                                    return Array.from(pSet).sort().map(name => {
                                        const pMatches = selectedSession.matches.filter((m:any) => m.player_names?.includes(name));
                                        let w=0, l=0, d=0; const friends: string[] = [];
                                        pMatches.forEach((m:any) => {
                                            const ns = m.player_names || []; const i = ns.indexOf(name);
                                            const s1 = Number(m.score1||0), s2 = Number(m.score2||0);
                                            const win = i < 2 ? (s1 > s2) : (s2 > s1);
                                            if (win) w++; else if (s1 !== s2) l++; 
                                            d += i < 2 ? (s1-s2) : (s2-s1);
                                            const pI = i < 2 ? (i===0?1:0) : (i===2?3:2); if (ns[pI]) friends.push(ns[pI]);
                                        });
                                        return (
                                            <div key={name} className="bg-white/5 border border-white/10 rounded-[30px] p-6">
                                                <div className="flex items-center gap-4 mb-4"><div className="w-10 h-10 bg-[#D4AF37]/10 rounded-2xl flex items-center justify-center font-black text-[#D4AF37]">{name[0]}</div><span className="font-black italic">{name}</span></div>
                                                <div className="grid grid-cols-3 gap-2">{[{l:'W/L',v:`${w}승 ${l}패`},{l:'Diff',v:d>0?`+${d}`:d},{l:'Rate',v:`${Math.round((w/(w+l||1))*100)}%`}].map(x=>(<div key={x.l} className="bg-black/40 p-3 rounded-2xl text-center"><div className="text-[7px] font-black text-white/20 uppercase mb-1">{x.l}</div><div className="text-[11px] font-black">{x.v}</div></div>))}</div>
                                            </div>
                                        );
                                    });
                                })()}
                             </div>
                        )}
                    </div>
                ) : (
                    /* Session List Level 2 */
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-white/[0.03] border border-white/5 rounded-[40px] p-6 mb-8 flex gap-4">
                            <div className="flex-1 space-y-1"><span className="text-[8px] font-black text-white/20 uppercase tracking-widest pl-1">Year</span><select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-[#1C1C28] border border-white/10 rounded-2xl px-4 py-3 text-[11px] font-black text-white focus:border-[#D4AF37] outline-none">{[2026,2025,2024].map(y=><option key={y} value={y}>{y}년</option>)}</select></div>
                            <div className="flex-1 space-y-1"><span className="text-[8px] font-black text-white/20 uppercase tracking-widest pl-1">Month</span><select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-[#1C1C28] border border-white/10 rounded-2xl px-4 py-3 text-[11px] font-black text-white focus:border-[#D4AF37] outline-none">{[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}</select></div>
                        </section>
                        <div className="space-y-4">
                            {sessions.length > 0 ? sessions.map((s, index) => (
                                <div key={s.id} onClick={() => selectSession(s.id)} className="bg-[#12121A] border border-white/5 rounded-[40px] p-7 shadow-2xl relative overflow-hidden active:scale-95 transition-all cursor-pointer">
                                    <div className="flex justify-between items-center mb-6">
                                        <div className="flex items-center gap-3"><span className="w-8 h-8 bg-[#D4AF37]/10 rounded-xl border border-[#D4AF37]/20 flex items-center justify-center text-[#D4AF37] text-[10px] font-black italic">{index+1}</span><span className="text-[10px] font-black text-[#D4AF37] tracking-widest">{s.date}</span></div>
                                        <span className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-white/20 transition-all border border-white/5 group-hover:bg-[#D4AF37] group-hover:text-black">→</span>
                                    </div>
                                    <h4 className="text-lg font-black text-white italic uppercase mb-2">{s.title}</h4>
                                    <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">{s.matchCount} Matches Verified</span>
                                </div>
                            )) : <div className="py-20 text-center opacity-30 italic font-black uppercase text-[10px] tracking-widest">No entries for this period</div>}
                        </div>
                    </div>
                )}
            </>
        ) : mainTab === 'RANKING' ? (
            /* Global Ranking Tab */
            <div className="animate-in fade-in duration-500">
                <header className="mb-8 space-y-4">
                    <div className="flex gap-2 p-1 bg-white/5 rounded-[20px] border border-white/5">
                        {(['WEEK', 'MONTH', 'YEAR', 'ALL'] as const).map(f => (
                            <button key={f} onClick={()=>setRankingFilter(f)} className={`flex-1 py-3 rounded-2xl text-[9px] font-[1000] transition-all ${rankingFilter === f ? 'bg-white/10 text-white shadow-xl' : 'text-white/20 hover:text-white/40'}`}>
                                {f === 'WEEK' ? '주간' : f === 'MONTH' ? '월간' : f === 'YEAR' ? '연간' : '전체'}
                            </button>
                        ))}
                    </div>
                    <p className="text-[9px] font-black text-[#D4AF37] text-center uppercase tracking-[0.3em] italic">⭐ Ranking Order: Points {'>'} Rate {'>'} Diff</p>
                </header>

                <div className="bg-white/[0.03] border border-white/10 rounded-[45px] overflow-hidden shadow-2xl">
                    <table className="w-full text-left">
                        <thead className="text-[8px] font-black text-white/20 uppercase tracking-widest">
                            <tr className="border-b border-white/5"><th className="px-6 py-6">Rank</th><th className="px-2 py-6">Player</th><th className="px-2 py-6 text-center">Score</th><th className="px-4 py-6 text-right">Diff</th></tr>
                        </thead>
                        <tbody>
                            {globalLeaderboard.map((p, i) => {
                                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
                                return (
                                    <tr key={p.id} className={`border-t border-white/5 transition-all ${i === 0 ? 'bg-[#D4AF37]/5' : ''}`}>
                                        <td className="px-6 py-6"><div className="flex items-center gap-2"><span className={`text-xl font-[1000] italic ${i < 3 ? 'text-[#D4AF37]' : 'text-white/20'}`}>{i + 1}</span><span className="text-sm">{medal}</span></div></td>
                                        <td className="px-2 py-6">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-center overflow-hidden">
                                                    {p.avatar ? <img src={p.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] font-black opacity-20 uppercase">{p.name[0]}</span>}
                                                </div>
                                                <div className="flex flex-col"><span className="text-xs font-black tracking-tighter">{p.name}</span><span className="text-[7px] font-black text-white/20">{Math.round(p.winRate)}% Win Rate</span></div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-6 text-center"><div className="text-sm font-black text-[#D4AF37]">{p.wins}</div><div className="text-[7px] font-black opacity-20 uppercase">Points</div></td>
                                        <td className={`px-4 py-6 text-right font-black italic tracking-tighter text-xs ${p.diff > 0 ? 'text-[#4ADE80]' : p.diff < 0 ? 'text-red-500' : 'text-white/20'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {!globalLeaderboard.length && <div className="py-24 text-center opacity-30 font-black italic uppercase text-[10px] tracking-widest">No data available for this filter</div>}
                </div>
            </div>
        ) : (
            /* Hall of Fame Tab */
            <div className="animate-in zoom-in-95 duration-500 py-20 flex flex-col items-center text-center">
                <div className="w-32 h-32 bg-white/5 rounded-full border border-white/10 flex items-center justify-center mb-10 relative">
                    <span className="text-6xl grayscale opacity-30">🏛️</span>
                    <div className="absolute -top-2 -right-2 bg-gradient-to-r from-red-500 to-orange-500 text-[8px] font-black px-4 py-2 rounded-full shadow-lg animate-bounce">COMING SOON</div>
                </div>
                <h3 className="text-2xl font-[1000] italic tracking-tighter uppercase mb-4 text-[#D4AF37]">The Hall of Fame</h3>
                <p className="max-w-[240px] text-xs font-bold text-white/40 leading-relaxed uppercase tracking-widest italic">
                    "테연 클럽의 역사가 기록되는 중입니다..."
                </p>
                <div className="mt-12 h-px w-20 bg-gradient-to-r from-transparent via-[#D4AF37]/30 to-transparent"></div>
            </div>
        )}
      </section>

      {/* Sticky Footer: My Rank (Only for Ranking Tab) */}
      {mainTab === 'RANKING' && myRank && (
        <div className="fixed bottom-0 left-0 right-0 p-6 z-[60] bg-gradient-to-t from-black via-black/95 to-transparent pointer-events-none">
            <div className="max-w-md mx-auto pointer-events-auto">
                <div className="bg-[#D4AF37] text-black rounded-[28px] p-5 shadow-[0_20px_60px_rgba(212,175,55,0.4)] flex items-center justify-between border border-white/20 scale-100 active:scale-95 transition-all">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-black/10 rounded-2xl flex items-center justify-center font-[1000] italic text-2xl">#{myRank.rank}</div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-60">My Current Position</span>
                            <span className="text-lg font-[1000] italic tracking-tighter uppercase">{myRank.name} <span className="text-[10px] font-black opacity-30">• {rankingFilter}</span></span>
                        </div>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[8px] font-black uppercase opacity-60">Total Wins</span>
                        <span className="text-2xl font-[1000] italic leading-none">{myRank.wins} <span className="text-xs uppercase font-black opacity-40">Pts</span></span>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Admin Tools: Hidden in Ranking tab to keep aesthetic */}
      {isAdmin && mainTab === 'RECORDS' && (
        <div className="p-8 opacity-20 hover:opacity-100 transition-opacity flex flex-col items-center">
            <button onClick={seedDemoData} disabled={isSeeding} className="px-6 py-3 bg-[#D4AF37]/10 border border-[#D4AF37]/20 rounded-full text-[9px] font-black text-[#D4AF37] tracking-[0.3em] uppercase active:scale-95">{isSeeding ? 'SEEDING...' : '🔧 ADMIN: SEED DEMO DATA'}</button>
        </div>
      )}
    </main>
  );
}
