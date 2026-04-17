'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Edit3, Trash2, ArrowRight } from 'lucide-react';

/**
 * ArchivePage (v1.8.0): The Pure History + Live Mirror
 * v1.8.0: Card slimming, Admin Icons, Live Mirror UI, High Visibility
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
  const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
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
    fetchArchives().then(() => {
        // v12: Auto-sync on refresh
        autoSyncLocalRecords();
    });
    fetchMembers();
    runLocalMigration();
  }, [selectedYear, selectedMonth]);

  // v11: Migration for Unknown names in local failsafe
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
                // If names missing or contain Unknown/?, fix them
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
            console.log("🛠️ v11: Local Data Identity Migration Complete");
        }
    } catch (e) {
        console.error("Migration failed", e);
    }
  }

  // Handle Deep Linking from Live Dashboard
  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl) {
        setTimeout(() => {
            setSelectedSessionId(sessionFromUrl);
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
            .from('teyeon_archive_v1')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        // v8: Merge with LocalStorage Failover Data
        processCombinedData(data || []);

    } catch (err: any) {
        console.error("Archive Fetch Error (Server):", err);
        // v9: Even if server fails (404/400), try to show local data
        processCombinedData([]);
    } finally {
        setLoading(false);
    }

    function processCombinedData(data: any[]) {
        // v8: Merge with LocalStorage Failover Data (v10: Prioritize local at the top)
        const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        const combinedData: any[] = [];
        
        // v10: Add locals first to push them to the top
        failovers.forEach((f: any) => {
            combinedData.push({ ...f, isLocal: true });
        });

        // v10: Add server data, avoiding duplicates (Strictly prioritize newest by created_at)
        (data || []).forEach((d: any) => {
            const existing = combinedData.find(f => f.id === d.id);
            if (!existing) {
                combinedData.push(d);
            } else {
                // If ID matches, replace ONLY if server data is newer or has more raw_data
                const existingTime = new Date(existing.created_at || 0).getTime();
                const newTime = new Date(d.created_at || 0).getTime();
                if (newTime > existingTime) {
                    const idx = combinedData.indexOf(existing);
                    combinedData[idx] = d;
                }
            }
        });

        // v13: Pre-sort combined data by created_at DESC before any reconstruction
        combinedData.sort((a,b) => {
            const tA = new Date(a.created_at || 0).getTime();
            const tB = new Date(b.created_at || 0).getTime();
            return tB - tA;
        });

        // v7: Reconstruction of flat match array
        const reconstructedMatches: any[] = [];
        combinedData.forEach(record => {
            const raw = record.raw_data || {};
            const matchesArr = raw.snapshot_data || [];
            if (matchesArr.length === 0) return; // Skip empty records

            const isLocal = !!record.failover || !!record.isLocal;
            
            matchesArr.forEach((m: any) => {
                const pIds = m.player_ids || m.playerIds || [];
                const meta = raw.player_metadata || {};
                
                // v11: Identity Resolution
                const resolvedNames = (m.player_names && m.player_names.length === 4 && !m.player_names.includes('Unknown'))
                    ? m.player_names
                    : pIds.map((pid: string) => meta[pid]?.name || 'Unknown');

                reconstructedMatches.push({
                    ...m,
                    session_id: record.id,
                    session_title: `${raw.title}${isLocal ? ' (로컬 저장됨)' : ''}`,
                    match_date: raw.date,
                    created_at: record.created_at, // Preserve session created_at for sorting
                    isLocal,
                    player_names: resolvedNames,
                    player_ids: pIds
                });
            });
        });

        setArchives(reconstructedMatches);
    }
  }

  // v12: Auto-sync background task
  async function autoSyncLocalRecords() {
    const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
    if (failovers.length === 0) return;
    
    console.log(`☁️ Trace: Found ${failovers.length} local records. Attempting background sync...`);
    for (const f of failovers) {
        await syncLocalRecord(f.id, true);
    }
  }

  // v11: Sync Local Record to Cloud (v12: Added isSilent & Toast)
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

        if (!response.ok) {
            console.warn(`Retry Sync: Server still not recognizing table [teyeon_archive_v1] (Status: ${response.status})`);
            throw new Error(`Server Sync Failed (${response.status})`);
        }

        const freshFailovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        const filtered = freshFailovers.filter((f: any) => f.id !== id);
        localStorage.setItem('kdk_archive_failover', JSON.stringify(filtered));
        
        setArchives(prev => prev.map(a => a.session_id === id ? { ...a, isLocal: false } : a));

        setSyncToastMsg("서버 동기화 완료");
        setShowSyncToast(true);
        setTimeout(() => setShowSyncToast(false), 3000);

        if (!isSilent) {
            setShowConfetti(true);
            setShowArchiveSuccess(true);
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200]);
            
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
    if (!confirm("⚠️ 이 로컬 기록을 완전히 삭제하시겠습니까? (서버에 업로드되지 않은 데이터입니다)")) return;
    const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
    const filtered = failovers.filter((f: any) => f.id !== id);
    localStorage.setItem('kdk_archive_failover', JSON.stringify(filtered));
    fetchArchives();
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
                total_rounds: 1,
                snapshot_data: []
            };
            await supabase.from('teyeon_archive_v1').upsert([{ id: sess.id, raw_data: sessionSnapshot }]);

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
        
        alert("✅ 데모 데이터 생성 완료!");
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
        const { error } = await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
        if (error) throw error;
        alert("성공적으로 삭제되었습니다.");
        fetchArchives();
    } catch (err: any) {
        alert("삭제 실패: " + err.message);
    }
  }

  async function editSessionTitle(sessionId: string, currentTitle: string) {
    if (!isAdmin) return;
    const newTitle = prompt("새로운 대회 제목을 입력하세요:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;

    try {
        setIsSyncing(sessionId);
        const { data: record, error: fetchError } = await supabase
            .from('teyeon_archive_v1')
            .select('raw_data')
            .eq('id', sessionId)
            .single();
        
        if (fetchError) throw fetchError;
        
        const updatedRaw = { ...record.raw_data, title: newTitle };
        
        const { error: updateError } = await supabase
            .from('teyeon_archive_v1')
            .update({ raw_data: updatedRaw })
            .eq('id', sessionId);
            
        if (updateError) throw updateError;
        
        alert("제목이 성공적으로 수정되었습니다.");
        fetchArchives();
    } catch (err: any) {
        alert("수정 실패: " + err.message);
    } finally {
        setIsSyncing(null);
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
        const pIds = m.player_ids || [];
        
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
        // Unique key based on normalized title AND date to aggregate duplicates correctly
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

  const handleForceUpdate = () => {
    if (confirm('⚠️ 모든 캐시를 삭제하고 앱을 강제로 새로고침 할까요?')) {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
        }
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload(true);
    }
  };

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-[#0a0a0c] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      <header className="px-8 pt-24 pb-8 flex flex-col gap-3 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          <div className="flex justify-between items-end w-full">
            <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black text-[#4ADE80] uppercase tracking-[0.5em] opacity-80">System Records</span>
                <h1 className="text-5xl sm:text-6xl font-black tracking-tighter uppercase bg-gradient-to-b from-white to-white/20 bg-clip-text text-transparent" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Archive</h1>
            </div>
            
            <div className="flex flex-col items-end gap-3">
                <div onClick={handleForceUpdate} className="group relative flex items-center justify-center cursor-pointer active:scale-95 transition-all">
                    <div className="absolute inset-0 bg-[#4ADE80]/10 rounded-2xl blur-xl group-hover:bg-[#4ADE80]/20 transition-all"></div>
                    <div className="relative bg-zinc-900/80 border border-zinc-800 px-5 py-2.5 rounded-2xl text-[10px] font-black text-[#4ADE80] tracking-widest uppercase flex items-center gap-2 backdrop-blur-xl hover:border-[#4ADE80]/40 transition-all">
                        <div className="w-1.5 h-1.5 bg-[#4ADE80] rounded-full animate-pulse shadow-[0_0_8px_#4ADE80]"></div>
                        Sync
                    </div>
                </div>
            </div>
          </div>
          <div className="h-1 w-16 bg-gradient-to-r from-[#4ADE80] to-transparent rounded-full mt-6 shadow-[0_0_15px_#4ADE80/20]"></div>
      </header>

      {!selectedSessionId && (
        <nav className="px-6 mb-10 flex gap-2.5">
            {(['RECORDS', 'RANKING', 'HOF'] as const).map(t => (
                <button 
                    key={t} onClick={() => setMainTab(t)}
                    className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all relative overflow-hidden group ${mainTab === t ? 'bg-zinc-100 text-black shadow-xl shadow-white/5' : 'bg-zinc-900/50 border border-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
                >
                    {t === 'RECORDS' ? '대회 결과' : t === 'RANKING' ? '전체 순위' : '명예의 전당'}
                    {mainTab === t && <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent"></div>}
                </button>
            ))}
        </nav>
      )}

      <section className="flex-1 px-6 pb-[300px]">
        {loading ? (
            <div className="py-24 text-center">
                <div className="relative w-12 h-12 mx-auto mb-6">
                    <div className="absolute inset-0 border-2 border-[#4ADE80]/20 rounded-full"></div>
                    <div className="absolute inset-0 border-2 border-[#4ADE80] border-t-transparent rounded-full animate-spin"></div>
                </div>
                <p className="text-[11px] font-black text-zinc-600 tracking-[0.3em] uppercase">Encrypting Vault...</p>
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
                            {/* Premium Glow Podium (Modern Dark) */}
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
                                                    <span>Player Rank Analytics</span>
                                                    <span>Score / Diff</span>
                                                </div>
                                                <div className="bg-zinc-900/30 border border-white/5 rounded-[45px] overflow-hidden backdrop-blur-xl">
                                                    {others.map((p: any, idx: number) => (
                                                        <div key={p.name} className="flex items-center justify-between px-10 py-6 border-b border-white/[0.03] hover:bg-white/[0.04] transition-all group">
                                                            <div className="flex items-center gap-8">
                                                                <span className="text-xl font-black text-zinc-800 group-hover:text-[#4ADE80]/30 transition-colors w-8">{idx + 4}</span>
                                                                <span className="text-lg font-black text-zinc-300 uppercase tracking-tight">{p.name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-6">
                                                                <div className="flex flex-col items-end">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]"></div>
                                                                        <span className="text-base font-black text-white">{p.wins} <span className="text-[10px] text-zinc-600">Wins</span></span>
                                                                    </div>
                                                                    <span className={`text-[11px] font-black mt-1 ${p.diff >= 0 ? 'text-zinc-500' : 'text-zinc-700'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff} NET</span>
                                                                </div>
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
                                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter" style={{ fontFamily: 'var(--font-orbitron), sans-serif' }}>Match History</h3>
                                    </div>
                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{selectedSession.matches.length} Matches Total</span>
                                </div>
                                <div className="grid grid-cols-2 gap-5">
                                    {selectedSession.matches.map((m: any, idx: number) => {
                                        const n = m.player_names || ["?","?","?","?"];
                                        const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                        const isGroupB = (m.group_name || m.groupName) === 'B';
                                        
                                        return (
                                            <div key={m.id || idx} 
                                                 className="rounded-[30px] relative flex flex-col justify-between overflow-hidden shadow-2xl transition-all border border-white/5 bg-zinc-900/40 hover:border-white/20 active:scale-95 group">
                                                {/* Dashboard Header Bar */}
                                                <div className="flex items-center justify-between px-4 py-3 bg-black/20 border-b border-white/5 uppercase">
                                                    <div className="flex items-center gap-2">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${isGroupB ? 'bg-cyan-500 shadow-[0_0_8px_cyan]' : 'bg-[#D4AF37] shadow-[0_0_8px_#D4AF37]'}`}></div>
                                                        <span className="text-[8px] font-black tracking-[0.2em] text-zinc-400">
                                                            R{m.round} • G{m.group_name || m.groupName || 'A'}
                                                        </span>
                                                    </div>
                                                    {(isAdmin) && (
                                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button onClick={(e) => { e.stopPropagation(); editSessionTitle(m.id, ''); }} className="text-zinc-600 hover:text-white"><svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.232 5.232l3.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
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
                                                            <div className="mt-2 px-2 py-0.5 bg-black/40 rounded-full border border-white/5">
                                                                <span className="text-[6px] font-black text-zinc-600 uppercase tracking-widest leading-none">Result</span>
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
                         <button onClick={() => setSelectedSessionId(null)} className="w-full py-6 mt-12 mb-12 rounded-[28px] bg-zinc-900 border border-white/10 text-[12px] font-black uppercase tracking-[0.3em] hover:bg-zinc-800 transition-all text-white/50 active:scale-95">Back to Records Root</button>
                         
                         {/* Layout Spacing Buffer */}
                         <div className="h-96 w-full pointer-events-none"></div>
                     </div>
                ) : (
                    <div className="animate-in slide-in-from-bottom duration-500">
                        <section className="bg-zinc-900/60 border border-white/5 rounded-[40px] p-8 mb-10 flex gap-5 shadow-2xl backdrop-blur-3xl">
                            <div className="flex-1 flex flex-col items-center space-y-3">
                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Temporal Year</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-800 rounded-2xl px-6 py-4 text-xs font-black text-white outline-none text-center focus:border-[#4ADE80]/40 transition-colors">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center space-y-3">
                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Temporal Month</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/60 border border-zinc-800 rounded-2xl px-6 py-4 text-xs font-black text-white outline-none text-center focus:border-[#4ADE80]/40 transition-colors">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>

                        <div className="space-y-4">
                            {sessions.length > 0 ? sessions.map((s, index) => (
                                <div key={s.id} onClick={() => { setSelectedSessionId(s.id); }} className="group bg-zinc-900/40 border border-white/5 rounded-[32px] p-6 relative overflow-hidden active:scale-[0.98] transition-all cursor-pointer hover:border-[#4ADE80]/30 hover:bg-zinc-900/60 shadow-2xl">
                                    <div className="flex justify-between items-center relative z-10">
                                        <div className="flex items-center gap-5">
                                            <div className="w-11 h-11 bg-black rounded-2xl border border-white/10 flex items-center justify-center text-zinc-500 text-[13px] font-black group-hover:text-[#4ADE80] group-hover:border-[#4ADE80]/30 transition-all">{index + 1}</div>
                                            <div className="flex flex-col">
                                                <span className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] leading-none mb-2">{s.date}</span>
                                                <h3 className="text-lg font-black text-white tracking-tighter uppercase leading-tight group-hover:text-white transition-colors">{s.title}</h3>
                                                <div className="flex items-center gap-3 mt-2 text-[9px] font-black text-zinc-700 uppercase tracking-widest group-hover:text-zinc-500">
                                                    <span>{s.matchCount} Matches Found</span>
                                                    <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                                                    <span className={s.matches[0]?.isLocal ? 'text-[#D4AF37]' : 'text-zinc-600'}>{s.matches[0]?.isLocal ? 'Offline Cache' : 'Vault Synced'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {isAdmin && (
                                                <div className="flex gap-1.5 mr-2">
                                                    <button onClick={(e)=>{e.stopPropagation(); editSessionTitle(s.id, s.title);}} className="p-3 rounded-2xl bg-zinc-800/80 border border-white/5 text-zinc-600 hover:text-[#4ADE80] transition-all"><Edit3 className="w-3.5 h-3.5" /></button>
                                                    <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="p-3 rounded-2xl bg-zinc-800/80 border border-white/5 text-zinc-600 hover:text-red-500 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                                                </div>
                                            )}
                                            <div className="w-10 h-10 rounded-full border border-white/5 flex items-center justify-center text-zinc-700 group-hover:text-[#4ADE80] group-hover:border-[#4ADE80]/20 transition-all">
                                                <ArrowRight className="w-5 h-5" />
                                            </div>
                                        </div>
                                    </div>
                                    {/* Subtle gradient glow */}
                                    <div className="absolute top-0 right-0 w-48 h-48 bg-[#4ADE80]/5 blur-[70px] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                </div>
                            )) : (
                                <div className="py-24 text-center bg-zinc-900/20 rounded-[40px] border border-dashed border-zinc-800">
                                    <p className="text-[11px] font-black text-zinc-700 uppercase tracking-[0.4em]">Historical Data Not Found</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </>
        ) : mainTab === 'RANKING' ? (
            <div className="animate-in fade-in duration-500">
                <div className="flex gap-3 p-1.5 bg-zinc-900/60 border border-white/5 rounded-[25px] mb-10">
                    {(['WEEK', 'MONTH', 'YEAR', 'ALL'] as const).map(f => (
                        <button key={f} onClick={()=>setRankingFilter(f)} className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${rankingFilter === f ? 'bg-white text-black shadow-2xl' : 'text-zinc-600'}`}>{f}</button>
                    ))}
                </div>
                <div className="bg-zinc-900/40 border border-white/5 rounded-[45px] overflow-hidden backdrop-blur-xl shadow-2xl">
                    <table className="w-full text-left">
                        <thead className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5">
                            <tr className="border-b border-white/5">
                                <th className="px-10 py-8 font-black uppercase">Rank</th>
                                <th className="px-4 py-8 font-black uppercase">Player</th>
                                <th className="px-4 py-8 text-center font-black uppercase">Wins</th>
                                <th className="px-8 py-8 text-right font-black uppercase">Diff</th>
                            </tr>
                        </thead>
                        <tbody>{globalLeaderboard.map((p, i) => (
                            <tr key={p.id} className="border-t border-white/[0.03] hover:bg-white/[0.02] transition-all group">
                                <td className={`px-10 py-8 font-black text-2xl ${i < 3 ? 'text-[#D4AF37]' : 'text-zinc-800'}`}>{i + 1}</td>
                                <td className="px-4 py-8">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-black rounded-2xl border border-white/10 flex items-center justify-center font-black text-xs text-zinc-500 group-hover:border-[#4ADE80]/30 group-hover:text-[#4ADE80] transition-all">{p.name[0]}</div>
                                        <div className="flex flex-col">
                                            <span className="text-base font-black uppercase text-zinc-200">{p.name}</span>
                                            <span className="text-[9px] text-[#4ADE80] uppercase font-black tracking-widest opacity-60 leading-none mt-1">{Math.round(p.winRate)}% Win Rate</span>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-8 text-center font-black text-white text-xl">{p.wins}</td>
                                <td className={`px-8 py-8 text-right font-black text-base ${p.diff > 0 ? 'text-[#4ADE80]' : 'text-red-900 opacity-40'}`}>{p.diff > 0 ? `+${p.diff}` : p.diff}</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </div>
        ) : (
            <div className="py-48 text-center bg-zinc-900/10 rounded-[50px] border border-zinc-900">
                <p className="text-[12px] font-black uppercase tracking-[0.6em] text-zinc-800">Hall of Fame Offline</p>
            </div>
        )}
      </section>

      {mainTab === 'RANKING' && myRank && (
        <div className="fixed bottom-0 left-0 right-0 p-8 z-[60] bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/80 to-transparent pointer-events-none">
            <div className="max-w-md mx-auto pointer-events-auto bg-white text-black rounded-[35px] p-6 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] flex items-center justify-between">
                <div className="flex items-center gap-5">
                    <div className="text-3xl font-black italic tracking-tighter shadow-sm">#{myRank.rank}</div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">My Current Status</span>
                        <span className="font-black uppercase text-base tracking-tight leading-none">{myRank.name}</span>
                    </div>
                </div>
                <div className="flex flex-col items-end">
                    <div className="text-2xl font-black text-black">{myRank.wins}</div>
                    <span className="text-[9px] font-black uppercase text-zinc-500">Official Points</span>
                </div>
            </div>
        </div>
      )}

      {showArchiveSuccess && (
        <div className="fixed inset-0 z-[5000] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center animate-in fade-in zoom-in duration-700">
            <div className="relative mb-12">
                <div className="absolute inset-0 bg-[#4ADE80] blur-[120px] opacity-20"></div>
                <div className="relative w-32 h-32 bg-[#4ADE80] text-black rounded-[40px] flex items-center justify-center rotate-12 shadow-[0_20px_40px_-15px_#4ADE80]">
                    <span className="text-6xl font-black -rotate-12">✓</span>
                </div>
            </div>
            <h2 className="text-4xl font-black text-white uppercase tracking-tight text-center">Synced<br />Successfully</h2>
            <p className="mt-4 text-[11px] font-black text-[#4ADE80] uppercase tracking-[0.4em]">Vault is now Current</p>
        </div>
      )}

      {showSyncToast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[6000] bg-zinc-900/90 border border-[#4ADE80]/30 text-white px-10 py-5 rounded-[25px] shadow-2xl flex items-center gap-5 animate-in slide-in-from-bottom-10 backdrop-blur-xl">
            <div className="w-2 h-2 bg-[#4ADE80] rounded-full animate-pulse shadow-[0_0_10px_#4ADE80]"></div>
            <span className="text-white font-black uppercase tracking-widest text-[10px]">{syncToastMsg}</span>
        </div>
      )}
    </main>
  );
}
