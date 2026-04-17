'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

/**
 * ResultsPage (Synced with Archive): The Teyeon Club Official Database
 * v1.3.1 (Stable): Global Archive/Results Synchronization
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
            // [CEO Req] Specific log for server table/cache issues
            console.warn(`Retry Sync: Server still not recognizing table [teyeon_archive_v1] (Status: ${response.status})`);
            throw new Error(`Server Sync Failed (${response.status})`);
        }

        // Success: Remove from local and refresh
        const freshFailovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        const filtered = freshFailovers.filter((f: any) => f.id !== id);
        localStorage.setItem('kdk_archive_failover', JSON.stringify(filtered));
        
        // Immediate UI Update: remove cloud icon visually
        setArchives(prev => prev.map(a => a.session_id === id ? { ...a, isLocal: false } : a));

        // Toast Feedback
        setSyncToastMsg("서버 동기화 완료");
        setShowSyncToast(true);
        setTimeout(() => setShowSyncToast(false), 3000);

        if (!isSilent) {
            // Celebration for manual sync!
            setShowConfetti(true);
            setShowArchiveSuccess(true);
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200]);
            
            setTimeout(() => {
                fetchArchives();
                setShowArchiveSuccess(false);
                setShowConfetti(false);
            }, 3500);
        } else {
            // Background sync just refreshes silently
            fetchArchives();
        }

    } catch (err: any) {
        if (!isSilent) alert("동기화 실패: " + err.message);
    } finally {
        setIsSyncing(null);
    }
  }

  // v11: Delete Local Record
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
                total_rounds: 1,
                snapshot_data: []
            };
            await supabase.from('teyeon_archive_v1').upsert([{ id: sess.id, raw_data: sessionSnapshot }]);

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
        const { error } = await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
        if (error) throw error;
        alert("성공적으로 삭제되었습니다.");
        fetchArchives();
    } catch (err: any) {
        alert("삭제 실패: " + err.message);
    }
  }

  // [v12.1] Edit Session Title
  async function editSessionTitle(sessionId: string, currentTitle: string) {
    if (!isAdmin) return;
    const newTitle = prompt("새로운 대회 제목을 입력하세요:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;

    try {
        setIsSyncing(sessionId);
        // 1. Fetch current raw_data
        const { data: record, error: fetchError } = await supabase
            .from('teyeon_archive_v1')
            .select('raw_data')
            .eq('id', sessionId)
            .single();
        
        if (fetchError) throw fetchError;
        
        // 2. Update title in raw_data
        const updatedRaw = { ...record.raw_data, title: newTitle };
        
        // 3. Update DB
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
    // [v1.3.0] Ultra-Strict Title Normalized Deduplication
    const groups: Record<string, any> = {};
    
    // 1. Sort base records by created_at DESC (Newest push first)
    const sortedRecords = [...filteredRecords].sort((a,b) => {
        const timeA = new Date(a.created_at || a.match_date || 0).getTime();
        const timeB = new Date(b.created_at || b.match_date || 0).getTime();
        return timeB - timeA;
    });

    sortedRecords.forEach(m => {
        // [v1.3.0] Normalize title by removing all local tags and trimming
        const rawTitle = m.session_title || m.title || "";
        const normalizedTitle = rawTitle
            .replace('(로컬 저장됨)', '')
            .replace('(Local)', '')
            .split(' (로컬 저장됨)')[0]
            .trim();
        
        const groupKey = normalizedTitle || m.session_id || 'untitled';

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
            // Already have this title. If this match belongs to the same title group but different ID, 
            // the sorting above (DESC) ensured we already have the LATEST meta in groups[groupKey].
            // We only add matches that are not already present (checking by round/court or unique match ID)
            const isMatchDuplicate = groups[groupKey].matches.some((ex: any) => 
                (ex.id === m.id) || (ex.round === m.round && ex.court === m.court)
            );
            if (!isMatchDuplicate) {
                groups[groupKey].matches.push(m);
                groups[groupKey].matchCount++;
            }
        }
    });

    // Final sorting: Strictly Latest Creation/Match Date first
    return Object.values(groups).sort((a:any, b:any) => {
        const timeA = new Date(a.created_at || a.date || 0).getTime();
        const timeB = new Date(b.created_at || b.date || 0).getTime();
        return timeB - timeA;
    });
  }, [filteredRecords]);

  const handleForceUpdate = () => {
    if (confirm('⚠️ 모든 캐시를 삭제하고 앱을 강제로 새로고침 할까요? (디자인 미반영 해결용)')) {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
        }
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload(true);
    }
  };

  return (
    <main className="flex flex-col min-h-screen bg-black text-white font-sans w-full relative overflow-y-auto pt-4 no-scrollbar">

      {/* [v1.2.5] High-Visibility Header with Update Triggers */}
      <header className="px-6 py-4 flex flex-col gap-1 items-start relative z-[100]">
          <div className="flex justify-between items-center w-full">
            <h1 
                onClick={() => {
                    if (confirm('🚨 앱을 최신 버전으로 강제로 업데이트할까요? (디자인 미반영 해결용)')) {
                        handleForceUpdate();
                    }
                }}
                className="text-4xl font-[1000] italic tracking-tighter uppercase text-white/90 cursor-pointer active:scale-95 transition-all"
            >
                경기 아카이브
            </h1>
            <div className="flex items-center gap-2">
                <div 
                    onClick={() => {
                        handleForceUpdate();
                    }}
                    className="bg-[#D4AF37] px-3 py-1 rounded-full text-[10px] font-black text-black animate-pulse cursor-pointer shadow-[0_0_15px_rgba(212,175,55,0.4)] active:scale-90"
                    title="클릭하여 강제 업데이트"
                >
                    CEO
                </div>
                <img src={user?.user_metadata?.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix'} alt="" className="w-8 h-8 rounded-full border border-white/20" />
            </div>
          </div>
          <div className="h-1 w-12 bg-[#D4AF37]"></div>
      </header>

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

      <section className="flex-1 px-6 pb-[300px]">
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
                                             let n = m.player_names || ["?","?","?","?"];
                                             // [v11 Fallback Logic] 박멸: Unknown 이름 자동 복구
                                             if (n.some((name:string) => !name || name === 'Unknown' || name === '?')) {
                                                const pIds = m.player_ids || m.playerIds || [];
                                                const meta = sessionDetail?.player_metadata || {};
                                                n = pIds.map((pid: string) => meta[pid]?.name || 'Unknown');
                                             }
                                             const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                             return (
                                                 <div key={m.id} className="bg-white/[0.03] border border-white/5 rounded-[30px] p-6 relative group hover:bg-white/[0.05] transition-all">
                                                     <span className="absolute top-4 left-6 text-[8px] font-black text-[#D4AF37]/40 uppercase tracking-widest">Court 0{m.court || idx + 1}</span>
                                                     <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6 pt-6">
                                                         <div className="text-center flex flex-col gap-2 items-center">
                                                            <span className={`text-sm font-black truncate w-24 ${s1 > s2 ? 'text-[#D4AF37] drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]' : 'text-white/40'}`}>{n[0]}</span>
                                                            <span className={`text-sm font-black truncate w-24 ${s1 > s2 ? 'text-[#D4AF37] drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]' : 'text-white/40'}`}>{n[1]}</span>
                                                         </div>
                                                         <div className="flex flex-col items-center gap-1">
                                                            <div className="bg-black/80 border border-white/10 px-6 py-3 rounded-2xl font-[1000] italic text-2xl tracking-tighter shadow-xl">{s1} : {s2}</div>
                                                            {m.isLocal && <span className="text-[7px] font-black text-[#D4AF37] uppercase animate-pulse">Offline Data</span>}
                                                         </div>
                                                         <div className="text-center flex flex-col gap-2 items-center">
                                                            <span className={`text-sm font-black truncate w-24 ${s2 > s1 ? 'text-[#D4AF37] drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]' : 'text-white/40'}`}>{n[2]}</span>
                                                            <span className={`text-sm font-black truncate w-24 ${s2 > s1 ? 'text-[#D4AF37] drop-shadow-[0_0_10px_rgba(212,175,55,0.4)]' : 'text-white/40'}`}>{n[3]}</span>
                                                         </div>
                                                     </div>
                                                 </div>
                                             );
                                         })}
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeDetailTab === 'RANKING' && (
                            <div className="bg-white/[0.03] border border-white/5 rounded-[24px] p-2">
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
                        {/* [v1.2.2] High-Contrast Header Filter Section */}
                        <section className="bg-white/5 border border-white/10 rounded-[32px] p-6 mb-8 flex gap-4 shadow-[0_20px_40px_rgba(0,0,0,0.5)]">
                            <div className="flex-1 space-y-2">
                                <span className="text-[10px] font-black text-[#C9B075] uppercase tracking-[0.2em] pl-1">Year</span>
                                <div className="relative">
                                    <select 
                                        value={selectedYear} 
                                        onChange={e=>setSelectedYear(Number(e.target.value))} 
                                        className="w-full bg-black/60 border border-white/20 rounded-2xl px-5 py-4 text-xs font-black text-white focus:border-[#D4AF37] outline-none appearance-none shadow-inner"
                                    >
                                        {[2026,2025,2024].map(y=><option key={y} value={y} className="bg-[#1C1C28] text-white">{y}년</option>)}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#C9B075]">▼</div>
                                </div>
                            </div>
                            <div className="flex-1 space-y-2">
                                <span className="text-[10px] font-black text-[#C9B075] uppercase tracking-[0.2em] pl-1">Month</span>
                                <div className="relative">
                                    <select 
                                        value={selectedMonth} 
                                        onChange={e=>setSelectedMonth(Number(e.target.value))} 
                                        className="w-full bg-black/60 border border-white/20 rounded-2xl px-5 py-4 text-xs font-black text-white focus:border-[#D4AF37] outline-none appearance-none shadow-inner"
                                    >
                                        {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m} className="bg-[#1C1C28] text-white">{m}월</option>)}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#C9B075]">▼</div>
                                </div>
                            </div>
                        </section>

                        {/* [v1.2.4] Emergency Access: Force Update Button (Moved to TOP for visibility) */}
                        <div className="px-1 mb-10">
                            <button 
                                onClick={() => {
                                    if (confirm('⚠️ 모든 캐시를 삭제하고 앱을 강제로 새로고침 할까요? (디자인 미반영 해결용)')) {
                                        if ('serviceWorker' in navigator) {
                                            navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
                                        }
                                        localStorage.clear();
                                        sessionStorage.clear();
                                        window.location.reload(true);
                                    }
                                }}
                                className="w-full px-6 py-6 bg-red-600 border-2 border-red-400 rounded-[28px] text-[12px] font-black text-white tracking-[0.2em] uppercase active:scale-95 transition-all shadow-[0_10px_30px_rgba(220,38,38,0.4)] animate-pulse"
                            >
                                🚨 클릭하여 최신 버전으로 강제 업데이트
                            </button>
                            <p className="mt-3 text-[9px] font-bold text-red-400/60 uppercase tracking-widest text-center">
                                수정한 내용이 보이지 않으면 이 버튼을 눌러주세요
                            </p>
                        </div>

                        <div className="space-y-6">
                            {sessions.length > 0 ? sessions.map((s, index) => (
                                <div key={s.id} onClick={() => setSelectedSessionId(s.id)} className="bg-[#12121A] border border-white/5 rounded-[24px] p-7 shadow-2xl relative overflow-hidden active:scale-95 transition-all cursor-pointer">
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-4">
                                            <span className="w-6 h-6 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center text-white/20 text-[9px] font-black italic shadow-inner">{index+1}</span>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] font-medium text-[#C9B075] tracking-widest leading-none uppercase">{s.date}</span>
                                                {s.matches[0]?.isLocal && (
                                                    <span className="text-[7px] font-black text-white/30 uppercase">Pending Cloud Sync</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            {isAdmin && !s.matches[0]?.isLocal && (
                                                <div className="flex items-center gap-4">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); editSessionTitle(s.id, s.title); }}
                                                        className="p-2 rounded-xl bg-white/5 border border-white/5 text-white/20 hover:text-[#C9B075] transition-all"
                                                        title="제목 수정"
                                                    >
                                                        <span className="text-sm">✏️</span>
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); deleteSession(s.id, s.title); }}
                                                        className="p-2 rounded-xl bg-white/5 border border-white/5 text-rose-500/40 hover:text-rose-500 transition-all"
                                                        title="대회 삭제"
                                                    >
                                                        <span className="text-sm">🗑️</span>
                                                    </button>
                                                </div>
                                            )}
                                            {s.matches[0]?.isLocal && (
                                                <div className="flex items-center gap-2">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); syncLocalRecord(s.id); }}
                                                        disabled={isSyncing === s.id}
                                                        className="w-9 h-9 rounded-xl bg-[#C9B075]/20 border border-[#C9B075]/30 flex items-center justify-center text-[#C9B075] hover:bg-[#C9B075] hover:text-black transition-all shadow-[0_0_15px_rgba(201,176,117,0.2)]"
                                                    >
                                                        {isSyncing === s.id ? (
                                                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                                                        ) : (
                                                            <span className="text-lg">☁️</span>
                                                        )}
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); deleteLocalRecord(s.id); }}
                                                        className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all"
                                                    >
                                                        <span className="text-lg">🗑️</span>
                                                    </button>
                                                </div>
                                            )}
                                            <span className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-white/20 transition-all border border-white/5 group-hover:bg-[#C9B075] group-hover:text-black">→</span>
                                        </div>
                                    </div>
                                    <h4 className="text-xl font-black text-white italic uppercase mb-4 tracking-tighter">{s.title}</h4>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black text-white/10 uppercase tracking-widest">{s.matchCount} Matches Verified</span>
                                        <div className="h-px flex-1 bg-white/5 mx-4" />
                                    </div>
                                    
                                    {/* Local Indicator Bar */}
                                    {s.matches[0]?.isLocal && (
                                        <div className="absolute top-0 left-0 w-1.5 h-full bg-[#D4AF37] shadow-[0_0_20px_rgba(212,175,55,0.4)] opacity-50" />
                                    )}
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

                <div className="bg-white/[0.03] border border-white/10 rounded-[24px] overflow-hidden shadow-2xl">
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

      {/* [v1.2.4] Footer Info */}
      <div className="p-8 opacity-20 flex flex-col items-center gap-2 border-t border-white/5 mt-10">
          <span className="text-[9px] font-black text-[#C9B075] uppercase tracking-[0.4em]">
              Teyeon Archive Build v1.2.4
          </span>
          {isAdmin && (
              <button onClick={seedDemoData} disabled={isSeeding} className="px-6 py-3 bg-[#C9B075]/10 border border-[#C9B075]/20 rounded-full text-[9px] font-black text-[#C9B075] tracking-[0.2em] uppercase active:scale-95 mt-4">
                  {isSeeding ? 'SEEDING...' : '🔧 SEED DATA'}
              </button>
          )}
      </div>
      
      {/* v11: Championship Celebration Overlay */}
      {showArchiveSuccess && (
        <div className="fixed inset-0 z-[5000] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-1000">
            <div className="absolute inset-0 pointer-events-none z-[5001] overflow-hidden">
                {[...Array(50)].map((_, i) => (
                    <div 
                        key={i} 
                        className="absolute top-[-20px] w-2 h-2 rounded-full" 
                        style={{ 
                            left: `${Math.random() * 100}%`, 
                            animation: `falling ${2 + Math.random() * 3}s linear infinite`,
                            background: i % 2 === 0 ? '#D4AF37' : '#E5C167',
                            opacity: Math.random(),
                            transform: `scale(${0.5 + Math.random()})`
                        }} 
                    />
                ))}
            </div>
            <style jsx>{`
                @keyframes falling {
                    0% { transform: translateY(-10vh) rotate(0deg); }
                    100% { transform: translateY(110vh) rotate(720deg); }
                }
            `}</style>
            
            <div className="relative z-[5002] flex flex-col items-center text-center px-12 space-y-8">
                <div className="w-48 h-48 rounded-full bg-[#D4AF37]/10 border-2 border-[#D4AF37]/50 flex items-center justify-center animate-bounce shadow-[0_0_100px_rgba(212,175,55,0.4)]">
                    <span className="text-9xl drop-shadow-2xl">🏆</span>
                </div>
                <div className="space-y-4">
                    <h2 className="text-6xl font-[1000] italic text-white uppercase tracking-tighter drop-shadow-[0_0_30px_rgba(212,175,55,0.6)] leading-tight">
                        Championship<br />Synchronized
                    </h2>
                    <p className="text-[#D4AF37] text-sm font-black uppercase tracking-[0.7em] animate-pulse">
                        구름 위 명예의 전당에 안착했습니다
                    </p>
                </div>
                <div className="flex gap-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="w-3 h-3 rounded-full bg-[#D4AF37] animate-ping" style={{ animationDelay: `${i * 0.2}s` }} />
                    ))}
                </div>
            </div>
        </div>
      )}
      {/* v12: Sync Success Toast */}
      {showSyncToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[6000] animate-in fade-in slide-in-from-bottom-4 duration-500 w-[90%] max-w-sm">
            <div className="bg-[#1C1C1E] border border-[#D4AF37]/40 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center justify-center gap-4 backdrop-blur-2xl">
                <div className="w-8 h-8 rounded-full bg-[#D4AF37]/20 flex items-center justify-center">
                    <span className="text-lg">☁️</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] font-black text-[#D4AF37] uppercase tracking-widest leading-none mb-1">Status: Online</span>
                    <span className="text-[11px] font-[1000] uppercase tracking-wider italic text-white/90">{syncToastMsg}</span>
                </div>
            </div>
        </div>
      )}

    </main>
  );
}
