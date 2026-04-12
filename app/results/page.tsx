'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import RankingTab from '@/components/RankingTab';
import PremiumSpinner from '@/components/PremiumSpinner';

export default function ArchivePage() {
    const { role } = useAuth();
    const isAdmin = role === 'CEO';
    
    const [segment, setSegment] = useState<'RECORD' | 'TOTAL' | 'HALL'>('RECORD');
    const [year, setYear] = useState('2026');
    const [month, setMonth] = useState((new Date().getMonth() + 1).toString());
    const [sessions, setSessions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState<string | null>(null);
    const [showArchiveSuccess, setShowArchiveSuccess] = useState(false);
    const [selectedSession, setSelectedSession] = useState<any | null>(null);

    useEffect(() => {
        if (segment === 'RECORD') {
            fetchSessions();
            runLocalMigration();
        }
    }, [year, month, segment]);

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
                console.log("🛠️ v11 [Results]: Local Migration Complete");
            }
        } catch (e) {
            console.error("Migration failed", e);
        }
    }

    const fetchSessions = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('teyeon_archive_v1')
                .select('*')
            if (error) throw error;
            
            processSessions(data || []);

        } catch (e) {
            console.error('Fetch Archive Error (Server):', e);
            // v9: Failover to local data on server error
            processSessions([]);
        } finally {
            setLoading(false);
        }

        function processSessions(serverData: any[]) {
            // v8: Merge with LocalStorage Failover Data (v10: Prioritize local at the top)
            const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
            const combinedData: any[] = [];
            
            // v10: Locals first
            failovers.forEach((f: any) => {
                combinedData.push({ ...f, isLocal: true });
            });

            // v10: Add servers, avoid duplicates
            serverData.forEach((d: any) => {
                if (!combinedData.find(f => f.id === d.id)) {
                    combinedData.push(d);
                }
            });

            // v7: Flatten for UI compatibility
            const flattened = combinedData.map(item => {
                const raw = item.raw_data || {};
                const isLocal = !!item.isLocal || !!item.failover;
                return {
                    id: item.id,
                    ...raw,
                    title: `${raw.title}${isLocal ? ' (로컬)' : ''}`,
                    isLocal
                };
            });

            // Native filter by year/month from the 'date' string
            const filtered = (flattened || []).filter(s => {
                if (!s.date || typeof s.date !== 'string') return false;
                const parts = s.date.split('-');
                if (parts.length < 2) return false;
                const [y, m] = parts;
                return y === year && parseInt(m).toString() === month;
            });
            setSessions(filtered);
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('정말 이 아카이브 기록을 영구 삭제하시겠습니까?')) return;
        try {
            const { error } = await supabase.from('teyeon_archive_v1').delete().eq('id', id);
            if (error) throw error;
            alert('삭제되었습니다.');
            fetchSessions();
        } catch(err) {
            console.error(err);
            alert('삭제 실패');
        }
    };

    const handleEdit = async (id: string, currentTitle: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const newTitle = prompt('새로운 대회 이름을 입력하세요:', currentTitle);
        if (!newTitle || newTitle === currentTitle) return;
        try {
            const session = sessions.find(s => s.id === id);
            if (!session) return;
            
            const updatedRawData = { ...session, title: newTitle };
            delete updatedRawData.id; // Ensure ID isn't duplicated in JSONB if not desired

            const { error } = await supabase
                .from('teyeon_archive_v1')
                .update({ raw_data: updatedRawData })
                .eq('id', id);

            if (error) throw error;
            fetchSessions();
        } catch(err) {
            console.error(err);
            alert('수정 실패');
        }
    };

    // v11: Sync Local Record to Cloud
    const syncLocalRecord = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (isSyncing) return;
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

            if (!response.ok) throw new Error("Server Sync Failed");

            const filtered = failovers.filter((f: any) => f.id !== id);
            localStorage.setItem('kdk_archive_failover', JSON.stringify(filtered));
            
            setShowArchiveSuccess(true);
            if (window.navigator?.vibrate) window.navigator.vibrate([200, 100, 200]);
            
            setTimeout(() => {
                fetchSessions();
                setShowArchiveSuccess(false);
            }, 3500);

        } catch (err: any) {
            alert("동기화 실패: " + err.message);
        } finally {
            setIsSyncing(null);
        }
    };

    // v11: Delete Local Record
    const deleteLocalRecord = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("⚠️ 이 로컬 기록을 완전히 삭제하시겠습니까? (서버에 업로드되지 않은 데이터입니다)")) return;
        const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
        const filtered = failovers.filter((f: any) => f.id !== id);
        localStorage.setItem('kdk_archive_failover', JSON.stringify(filtered));
        fetchSessions();
    };

    if (selectedSession) {
        return (
            <div className="min-h-screen bg-[#14161a] text-white pb-32">
                <header className="px-6 py-6 flex items-center justify-between border-b border-white/10 sticky top-0 bg-[#14161a]/80 backdrop-blur-xl z-[100]">
                    <button 
                        onClick={() => setSelectedSession(null)}
                        className="flex items-center gap-2 text-white/40 hover:text-white transition-colors"
                    >
                        <span className="text-xl">←</span>
                        <span className="text-[10px] font-black uppercase tracking-widest">Back</span>
                    </button>
                    <div className="text-center flex flex-col items-center">
                        <span className="text-[9px] font-black text-[#C9B075] uppercase tracking-[0.4em] mb-1">Session Data</span>
                        <h2 className="text-lg font-black italic text-white tracking-tighter uppercase">{selectedSession.title}</h2>
                    </div>
                    <div className="w-10" />
                </header>
                
                <RankingTab 
                    players={selectedSession.ranking_data || []}
                    sessionTitle={selectedSession.title}
                    isArchive={true}
                    snapshot_data={selectedSession.snapshot_data || []}
                    onShareMatch={() => alert("Report shared!")}
                    onShareResult={() => alert("Champions shared!")}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col px-6 pt-4 pb-32 space-y-8 min-h-screen bg-[#14161a]">
            {/* Header */}
            <header className="flex items-center justify-between mb-2">
                <h1 className="text-2xl font-black italic tracking-tighter text-white uppercase">경기 아카이브</h1>
                {isAdmin && <span className="px-3 py-1 bg-red-600 rounded-lg text-[10px] font-black text-white italic">CEO</span>}
            </header>

            {/* Segments */}
            <div className="flex bg-white/5 rounded-3xl p-1.5 border border-white/10 shadow-2xl shrink-0">
                {[
                    { id: 'RECORD', label: '대회 기록' },
                    { id: 'TOTAL', label: '전체 랭킹' },
                    { id: 'HALL', label: '명예의 전당' }
                ].map((s) => (
                    <button
                        key={s.id}
                        onClick={() => setSegment(s.id as any)}
                        className={`flex-1 py-4 text-[11px] font-black rounded-2xl transition-all tracking-widest ${segment === s.id ? 'bg-[#C9B075] text-black shadow-xl' : 'text-white/40'}`}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            {segment === 'RECORD' && (
                <>
                    {/* Filters */}
                    <div className="grid grid-cols-2 gap-4 shrink-0 bg-white/[0.03] border border-white/5 rounded-[24px] p-6 mb-12">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] ml-2">Year</label>
                            <select 
                                value={year}
                                onChange={(e) => setYear(e.target.value)}
                                className="w-full bg-[#1C1C28] border border-white/10 rounded-2xl px-6 py-4 text-sm font-black text-white outline-none focus:border-[#C9B075]/50 appearance-none text-center"
                            >
                                <option value="2027" className="bg-[#1C1C28] text-white">2027년</option>
                                <option value="2026" className="bg-[#1C1C28] text-white">2026년</option>
                                <option value="2025" className="bg-[#1C1C28] text-white">2025년</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] ml-2">Month</label>
                            <select 
                                value={month}
                                onChange={(e) => setMonth(e.target.value)}
                                className="w-full bg-[#1C1C28] border border-white/10 rounded-2xl px-6 py-4 text-sm font-black text-white outline-none focus:border-[#C9B075]/50 appearance-none text-center"
                            >
                                {Array.from({ length: 12 }, (_, i) => (
                                    <option key={i + 1} value={(i + 1).toString()} className="bg-[#1C1C28] text-white">{i + 1}월</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* List */}
                    <div className="space-y-6 flex-1">
                        {loading ? (
                            <div className="py-20 flex justify-center"><PremiumSpinner /></div>
                        ) : sessions.length === 0 ? (
                            <div className="py-20 text-center text-white/20 font-black uppercase tracking-widest border border-dashed border-white/10 rounded-[24px]">기록된 세션이 없습니다</div>
                        ) : (
                            sessions.map((s, idx) => (
                                <div 
                                    key={s.id}
                                    onClick={() => setSelectedSession(s)}
                                    className="bg-white/5 border border-white/10 rounded-[24px] p-8 space-y-8 relative overflow-hidden group cursor-pointer hover:bg-white/10 transition-all shadow-2xl active:scale-95"
                                >
                                    <div className="flex items-center justify-between relative z-10 mb-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-[#C9B075]/20 border border-[#C9B075]/40 flex items-center justify-center italic font-black text-[#C9B075]">{(sessions.length - idx).toString()}</div>
                                            <div className="flex flex-col">
                                                <span className="text-xs font-black text-[#C9B075] tracking-widest uppercase leading-none">{s.date}</span>
                                                {s.isLocal && <span className="text-[7px] font-black text-white/30 uppercase mt-1">Pending Sync</span>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {s.isLocal ? (
                                                <div className="flex items-center gap-2 mr-2">
                                                    <button 
                                                        onClick={(e) => syncLocalRecord(s.id, e)}
                                                        disabled={isSyncing === s.id}
                                                        className="w-10 h-10 rounded-2xl bg-[#C9B075]/20 border border-[#C9B075]/30 flex items-center justify-center text-[#C9B075] hover:bg-[#C9B075] hover:text-black transition-all"
                                                    >
                                                        {isSyncing === s.id ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : '☁️'}
                                                    </button>
                                                    <button 
                                                        onClick={(e) => deleteLocalRecord(s.id, e)}
                                                        className="w-10 h-10 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all"
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            ) : (
                                                isAdmin && (
                                                    <div className="flex items-center gap-2 mr-2">
                                                        <button onClick={(e) => handleEdit(s.id, s.title, e)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 hover:bg-white/20 hover:text-white transition-colors">✏️</button>
                                                        <button onClick={(e) => handleDelete(s.id, e)} className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-500/50 hover:bg-red-500/20 text-xs hover:text-red-500 transition-colors">🗑️</button>
                                                    </div>
                                                )
                                            )}
                                            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/20 group-hover:text-[#C9B075] transition-colors">→</div>
                                        </div>
                                    </div>
                                    
                                    {/* Local Indicator Bar */}
                                    {s.isLocal && <div className="absolute top-0 left-0 w-1 h-full bg-[#C9B075] opacity-50 shadow-[0_0_15px_rgba(201,176,117,0.5)]" />}
                                    
                                    <div className="relative z-10">
                                        <h3 className="text-2xl font-black italic text-white tracking-tighter uppercase mb-2">{s.title || s.id}</h3>
                                        <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">{s.total_matches} MATCHES VERIFIED • {s.ranking_data?.length || 0} RANKED</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}

            {(segment === 'TOTAL' || segment === 'HALL') && (
                <div className="py-32 flex flex-col items-center justify-center opacity-30 text-center flex-1">
                    <span className="text-4xl mb-4">🚧</span>
                    <p className="text-[10px] font-black uppercase tracking-widest">Coming Soon</p>
                </div>
            )}

            {/* v11: Celebration Overlay */}
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
                                    background: i % 2 === 0 ? '#C9B075' : '#E5C167',
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
                        <div className="w-48 h-48 rounded-full bg-[#C9B075]/10 border-2 border-[#C9B075]/50 flex items-center justify-center animate-bounce shadow-[0_0_100px_rgba(201,176,117,0.4)]">
                            <span className="text-9xl drop-shadow-2xl">🏆</span>
                        </div>
                        <div className="space-y-4">
                            <h2 className="text-6xl font-[1000] italic text-white uppercase tracking-tighter drop-shadow-[0_0_30px_rgba(201,176,117,0.6)] leading-tight">
                                Championship<br />Synchronized
                            </h2>
                            <p className="text-[#C9B075] text-sm font-black uppercase tracking-[0.7em] animate-pulse">
                                구름 위 명예의 전당에 안착했습니다
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
