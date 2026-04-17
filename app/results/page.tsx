'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * ResultsPage (Synced v1.4.0): The Teyeon Club Official Database
 * v1.4.0 (Premium): Sophisticated Refresh & Layout Fix
 */
export default function ResultsPage() {
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
  const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [showSyncToast, setShowSyncToast] = useState(false);
  const [syncToastMsg, setSyncToastMsg] = useState("서버 동기화 완료");

  const CEO_EMAIL = process.env.NEXT_PUBLIC_CEO_EMAIL || 'cws786@nate.com';
  const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',');
  const isAdmin = userEmail && (userEmail === CEO_EMAIL || ADMIN_EMAILS.includes(userEmail));
  
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  useEffect(() => {
    checkUser();
    fetchArchives().then(() => {
        autoSyncLocalRecords();
    });
    fetchMembers();
    runLocalMigration();
  }, [selectedYear, selectedMonth]);

  function runLocalMigration() {
    try {
        const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        let changed = false;
        
        const migrated = failovers.map((f: any) => {
            const raw = f.raw_data || {};
            const meta = raw.player_metadata || {};
            const snap = raw.snapshot_data || [];
            
            let itemChanged = false;
            const fixedSnap = snap.map((m: any) => {
                const pIds = m.player_ids || m.playerIds || [];
                if (!m.player_names || m.player_names.some((n:string) => !n || n === 'Unknown' || n === '?')) {
                    const fixedNames = pIds.map((id: string) => meta[id]?.name || 'Unknown');
                    itemChanged = true;
                    return { ...m, player_names: fixedNames };
                }
                return m;
            });
            
            if (itemChanged) {
                changed = true;
                return { ...f, raw_data: { ...raw, snapshot_data: fixedSnap } };
            }
            return f;
        });
        
        if (changed) {
            localStorage.setItem('kdk_archive_failover', JSON.stringify(migrated));
            console.log("🛠️ Results: Local Data Identity Migration Complete");
        }
    } catch (e) {
        console.error("Migration failed", e);
    }
  }

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
    } catch (err: any) {
        console.error("Archive Fetch Error:", err);
        processCombinedData([]);
    } finally {
        setLoading(false);
    }

    function processCombinedData(data: any[]) {
        const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        const combinedData: any[] = [];
        failovers.forEach((f: any) => { combinedData.push({ ...f, isLocal: true }); });
        (data || []).forEach((d: any) => {
            const existing = combinedData.find(f => f.id === d.id);
            if (!existing) combinedData.push(d);
        });

        combinedData.sort((a,b) => {
            const tA = new Date(a.created_at || 0).getTime();
            const tB = new Date(b.created_at || 0).getTime();
            return tB - tA;
        });

        const reconstructedMatches: any[] = [];
        combinedData.forEach(record => {
            const raw = record.raw_data || {};
            const matchesArr = raw.snapshot_data || [];
            if (matchesArr.length === 0) return;
            const isLocal = !!record.failover || !!record.isLocal;
            
            matchesArr.forEach((m: any) => {
                const pIds = m.player_ids || m.playerIds || [];
                const meta = raw.player_metadata || {};
                const resolvedNames = (m.player_names && m.player_names.length === 4 && !m.player_names.includes('Unknown'))
                    ? m.player_names
                    : pIds.map((pid: string) => meta[pid]?.name || 'Unknown');

                reconstructedMatches.push({
                    ...m,
                    session_id: record.id,
                    session_title: `${raw.title}${isLocal ? ' (로컬 저장됨)' : ''}`,
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
        if (!record) throw new Error("Record not found locally");

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const endpoint = `${supabaseUrl}/rest/v1/teyeon_archive_v1`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({ id: record.id, raw_data: record.raw_data })
        });

        if (!response.ok) throw new Error(`Server Sync Failed (${response.status})`);

        const freshFailovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        localStorage.setItem('kdk_archive_failover', JSON.stringify(freshFailovers.filter((f: any) => f.id !== id)));
        setArchives(prev => prev.map(a => a.session_id === id ? { ...a, isLocal: false } : a));

        setSyncToastMsg("서버 동기화 완료");
        setShowSyncToast(true);
        setTimeout(() => setShowSyncToast(false), 3000);

        if (!isSilent) {
            setShowConfetti(true);
            setShowArchiveSuccess(true);
            setTimeout(() => {
                fetchArchives();
                setShowArchiveSuccess(false);
                setShowConfetti(false);
            }, 3500);
        } else {
            fetchArchives();
        }
    } catch (err: any) {
        if (!isSilent) alert("동기화 실패: " + err.message);
    } finally {
        setIsSyncing(null);
    }
  }

  function deleteLocalRecord(id: string) {
    if (!confirm("⚠️ 기록 삭제?")) return;
    const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
    localStorage.setItem('kdk_archive_failover', JSON.stringify(failovers.filter((f: any) => f.id !== id)));
    fetchArchives();
  }

  async function seedDemoData() {
    if (isSeeding) return;
    setIsSeeding(true);
    try {
        alert("데모 데이터 생성 중...");
        fetchArchives();
    } catch (err: any) {
        alert("실패");
    } finally {
        setIsSeeding(false);
    }
  }

  async function deleteSession(sessionId: string, title: string) {
    if (!isAdmin) return;
    if (!confirm(`[${title}] 삭제?`)) return;
    try {
        const { error } = await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
        if (error) throw error;
        fetchArchives();
    } catch (err: any) {
        alert("삭제 실패");
    }
  }

  async function editSessionTitle(sessionId: string, currentTitle: string) {
    if (!isAdmin) return;
    const newTitle = prompt("새 제목:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;
    try {
        setIsSyncing(sessionId);
        const { data: record, error } = await supabase.from('teyeon_archive_v1').select('raw_data').eq('id', sessionId).single();
        if (error) throw error;
        await supabase.from('teyeon_archive_v1').update({ raw_data: { ...record.raw_data, title: newTitle } }).eq('id', sessionId);
        fetchArchives();
    } catch (err: any) {
        alert("수정 실패");
    } finally {
        setIsSyncing(null);
    }
  }

  const globalLeaderboard = useMemo(() => {
    if (!archives.length) return [];
    const now = new Date();
    const filteredMatches = archives.filter(m => {
        const mDate = new Date(m.match_date);
        if (rankingFilter === 'WEEK') {
            const lastWeek = new Date(); lastWeek.setDate(now.getDate() - 7);
            return mDate >= lastWeek;
        }
        if (rankingFilter === 'MONTH') return mDate.getMonth() === now.getMonth() && mDate.getFullYear() === now.getFullYear();
        if (rankingFilter === 'YEAR') return mDate.getFullYear() === now.getFullYear();
        return true;
    });

    const stats: Record<string, { id: string, name: string, wins: number, losses: number, diff: number, games: number, avatar: string }> = {};
    filteredMatches.forEach(m => {
        const pNames = m.player_names || [];
        const pIds = m.player_ids || [];
        pNames.forEach((name: string, i: number) => {
            const id = pIds[i] || name;
            if (!stats[id]) {
                const member = members.find(mem => mem.nickname === name || mem.id === id);
                stats[id] = { id, name, wins: 0, losses: 0, diff: 0, games: 0, avatar: member?.avatar_url || '' };
            }
            const win = i < 2 ? (Number(m.score1) > Number(m.score2)) : (Number(m.score2) > Number(m.score1));
            stats[id].games++;
            if (win) stats[id].wins++; else if (Number(m.score1) !== Number(m.score2)) stats[id].losses++;
            stats[id].diff += i < 2 ? (Number(m.score1) - Number(m.score2)) : (Number(m.score2) - Number(m.score1));
        });
    });

    return Object.values(stats).map(p => ({ ...p, winRate: p.games > 0 ? (p.wins / p.games) * 100 : 0 }))
                 .sort((a, b) => (b.wins - a.wins) || (b.winRate - a.winRate) || (b.diff - a.diff));
  }, [archives, members, rankingFilter]);

  const myRank = useMemo(() => {
    if (!userEmail) return null;
    const member = members.find(m => m.email === userEmail);
    if (!member) return null;
    const index = globalLeaderboard.findIndex(p => p.name === member.nickname || p.id === member.id);
    if (index === -1) return null;
    return { rank: index + 1, ...globalLeaderboard[index] };
  }, [globalLeaderboard, userEmail, members]);

  const filteredRecords = archives.filter(m => {
    const mDate = new Date(m.match_date);
    return mDate.getFullYear() === selectedYear && (mDate.getMonth() + 1) === selectedMonth;
  });

  const sessions = useMemo(() => {
    const groups: Record<string, any> = {};
    const sortedRecords = [...filteredRecords].sort((a,b) => {
        const tA = new Date(a.created_at || 0).getTime();
        const tB = new Date(b.created_at || 0).getTime();
        return tB - tA;
    });

    sortedRecords.forEach(m => {
        const title = (m.session_title || m.title || "").replace('(로컬 저장됨)', '').replace('(Local)', '').trim();
        const key = title || m.session_id || 'untitled';
        if (!groups[key]) {
            groups[key] = { id: m.session_id || key, title, date: m.match_date, matches: [], matchCount: 0 };
            groups[key].matches.push(m);
            groups[key].matchCount = 1;
        } else {
            if (!groups[key].matches.some((ex: any) => ex.id === m.id || (ex.round === m.round && ex.court === m.court))) {
                groups[key].matches.push(m);
                groups[key].matchCount++;
            }
        }
    });

    return Object.values(groups).sort((a:any, b:any) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredRecords]);

  const handleForceUpdate = () => {
    if (confirm('⚠️ 새로고침?')) {
        if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
        localStorage.clear(); window.location.reload(true);
    }
  };

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-y-auto no-scrollbar pt-24 pb-32">
      <header className="px-8 py-6 flex flex-col gap-2 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700">
          <div className="flex justify-between items-end w-full">
            <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.5em] opacity-40">System Archive</span>
                <h1 className="text-5xl font-[1000] italic tracking-tight uppercase bg-gradient-to-r from-white via-white to-[#D4AF37] bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Archive</h1>
            </div>
            <div onClick={handleForceUpdate} className="group relative flex items-center justify-center cursor-pointer">
                <div className="absolute inset-0 bg-[#D4AF37]/20 rounded-full blur-md animate-pulse"></div>
                <div className="relative bg-black/40 border border-[#D4AF37]/30 px-4 py-2 rounded-full text-[9px] font-black text-[#D4AF37] uppercase backdrop-blur-md">Sync</div>
            </div>
          </div>
          <div className="h-0.5 w-16 bg-gradient-to-r from-[#D4AF37] to-transparent mt-2"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mb-8 flex gap-2">
            {(['RECORDS', 'RANKING', 'HOF'] as const).map(t => (
                <button key={t} onClick={() => setMainTab(t)} className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border ${mainTab === t ? 'bg-[#D4AF37] border-[#D4AF37] text-black' : 'bg-white/5 border-white/5 text-white/40'}`}>
                    {t === 'RANKING' ? '전체 랭킹' : t === 'HOF' ? '명예전당' : '대회 기록'}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-6 pb-[300px]">
        {loading ? (
            <div className="py-20 text-center animate-pulse text-[#D4AF37] font-black uppercase text-[10px]">Vault Loading...</div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {selectedSessionId && selectedSession ? (
                    <div className="animate-in slide-in-from-right duration-500">
                        <div className="bg-white/5 border border-white/10 rounded-[35px] p-8 mb-8">
                            <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-[0.4em] mb-2 block">{selectedSession.date}</span>
                            <h2 className="text-2xl font-[1000] text-white italic tracking-tighter uppercase mb-6">{selectedSession.title}</h2>
                            <div className="bg-black/60 p-1 rounded-2xl flex border border-white/5">
                                {(['MATCHES', 'RANKING'] as const).map(t => (
                                    <button key={t} onClick={() => setActiveDetailTab(t as any)} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl ${activeDetailTab === t ? 'bg-[#D4AF37] text-black' : 'text-white/30'}`}>{t}</button>
                                ))}
                            </div>
                        </div>

                        {activeDetailTab === 'MATCHES' && (
                            <div className="space-y-6">
                                {selectedSession.matches.map((m: any, idx: number) => (
                                    <div key={m.id} className="bg-white/[0.03] border border-white/5 rounded-[30px] p-6">
                                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
                                            <div className="text-center font-black text-xs uppercase text-white/40">{m.player_names?.[0]}<br/>{m.player_names?.[1]}</div>
                                            <div className="bg-black/80 px-6 py-3 rounded-2xl font-[1000] italic text-2xl">{m.score1} : {m.score2}</div>
                                            <div className="text-center font-black text-xs uppercase text-white/40">{m.player_names?.[2]}<br/>{m.player_names?.[3]}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <button onClick={() => setSelectedSessionId(null)} className="w-full py-6 mt-8 rounded-[28px] bg-white/5 text-[10px] font-black uppercase">Back to List</button>
                    </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-white/5 border border-white/10 rounded-[32px] p-6 mb-8 flex gap-4">
                            <div className="flex-1">
                                <span className="text-[10px] font-black text-[#D4AF37] uppercase block mb-2">Year</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/60 border border-white/20 rounded-2xl p-4 text-xs font-black text-white">{[2026,2025].map(y=><option key={y} value={y}>{y}</option>)}</select>
                            </div>
                            <div className="flex-1">
                                <span className="text-[10px] font-black text-[#D4AF37] uppercase block mb-2">Month</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/60 border border-white/20 rounded-2xl p-4 text-xs font-black text-white">{[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}</select>
                            </div>
                        </section>

                        <div className="space-y-6">
                            {sessions.map((s, index) => (
                                <div key={s.id} onClick={() => setSelectedSessionId(s.id)} className="group bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[32px] p-8 relative overflow-hidden active:scale-95 transition-all">
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex flex-col gap-2">
                                            <span className="text-[11px] font-black text-[#D4AF37] uppercase">{s.date}</span>
                                            <h3 className="text-3xl font-[1000] text-white italic tracking-tighter uppercase">{s.title}</h3>
                                        </div>
                                        <div className="text-[#D4AF37]">→</div>
                                    </div>
                                    <div className="text-[9px] font-black text-white/30 uppercase tracking-widest">{s.matchCount} Matches Organized</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="py-40 text-center opacity-20 font-black uppercase text-xs">Ranking / HOF Section</div>
        )}
      </section>

      {showArchiveSuccess && (
        <div className="fixed inset-0 z-[5000] bg-black/95 flex flex-col items-center justify-center animate-in fade-in duration-700">
            <span className="text-9xl mb-10 animate-bounce">🏆</span>
            <h2 className="text-3xl font-[1000] italic text-white uppercase text-center">Sync Success</h2>
        </div>
      )}
    </main>
  );
}
