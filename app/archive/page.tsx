'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Trash2, ArrowRight, ArrowLeft, Users, Trophy } from 'lucide-react';

/**
 * ArchivePage (v1.15.1): ABSOLUTE PRECISION & MUTED ELEGANCE
 * - Reverted excessive rounding to rounded-xl (12px) to prevent clipping as requested
 * - Unified Official Name: "테연" (TEYEON)
 * - Muted Gold UI: Champagne matte gold tones from user's edit
 * - Safety Padding: Increased horizontal and vertical inner padding to secure all data
 */
export default function ArchivePage() {
  const { user, role } = useAuth();
  const searchParams = useSearchParams();
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<'RECORDS' | 'RANKING'>('RECORDS');
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
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
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    const sessionFromUrl = searchParams.get('session');
    if (sessionFromUrl) setSelectedSessionId(sessionFromUrl);
  }, [searchParams]);

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserEmail(user.email || null);
  }

  async function fetchArchives() {
    try {
      setLoading(true);
      const { data, error } = await supabase
          .from('teyeon_archive_v1')
          .select('*')
          .order('created_at', { ascending: false });

      if (error) throw error;
      
      const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
      const combinedData: any[] = [...failovers.map((f:any) => ({...f, isLocal: true})), ...(data || [])];
      
      combinedData.sort((a,b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

      const reconstructedMatches: any[] = [];
      const seenIds = new Set();

      combinedData.forEach(record => {
          if (seenIds.has(record.id)) return;
          seenIds.add(record.id);

          const raw = record.raw_data || {};
          const matchesArr = raw.snapshot_data || [];
          matchesArr.forEach((m: any) => {
              const pIds = m.player_ids || m.playerIds || [];
              const meta = raw.player_metadata || {};
              const resolvedNames = m.player_names || pIds.map((pid: string) => meta[pid]?.name || 'Unknown');
              const resolvedAvatars = m.player_avatars || pIds.map((pid: string) => meta[pid]?.avatar || '');

              reconstructedMatches.push({
                  ...m,
                  session_id: record.id,
                  session_title: raw.title,
                  match_date: raw.date,
                  created_at: record.created_at,
                  isLocal: !!record.isLocal,
                  player_names: resolvedNames,
                  player_ids: pIds,
                  player_avatars: resolvedAvatars
              });
          });
      });
      setArchives(reconstructedMatches);
    } catch (err: any) {
      console.error("Archive Fetch Error:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = archives.filter(m => {
    const mDate = new Date(m.match_date);
    return mDate.getFullYear() === selectedYear && (mDate.getMonth() + 1) === selectedMonth;
  });

  const sessions = useMemo(() => {
    const groups: Record<string, any> = {};
    filteredRecords.forEach(m => {
        const title = m.session_title || "Untitled";
        const dateKey = m.match_date || 'nodate';
        const groupKey = `${title}_${dateKey}`;
        if (!groups[groupKey]) {
            groups[groupKey] = { 
                id: m.session_id, 
                title, 
                date: m.match_date, 
                created_at: m.created_at, 
                matches: [], 
                matchCount: 0,
                playerSet: new Set()
            };
        }
        groups[groupKey].matches.push(m);
        groups[groupKey].matchCount++;
        (m.player_names || []).forEach((n:string) => groups[groupKey].playerSet.add(n));
    });

    return Object.values(groups)
      .map(s => ({ ...s, participantCount: s.playerSet.size }))
      .sort((a:any, b:any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [filteredRecords]);

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  return (
    <main className="flex flex-col min-h-screen bg-[#0a0a0c] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      {/* 럭셔리 라인 헤더 */}
      <header className="px-8 pt-24 pb-2 flex flex-col gap-1 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          {selectedSessionId ? (
              <button 
                onClick={() => setSelectedSessionId(null)}
                className="flex items-center gap-2 text-[#C9B075] mb-2 hover:translate-x-[-4px] transition-transform italic font-black"
              >
                  <ArrowLeft size={16} />
                  <span className="text-[13px] uppercase tracking-widest">뒤로가기</span>
              </button>
          ) : (
            <span className="text-[11px] font-black text-[#C9B075] uppercase tracking-[0.4em] italic drop-shadow-lg">SYSTEM RECORDS</span>
          )}
          <h1 className="text-4xl sm:text-5xl font-[1000] tracking-tighter uppercase italic text-white leading-none drop-shadow-xl">Archive</h1>
          <div className="h-[2px] w-full bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent mt-3 shadow-[0_4px_15px_rgba(201,176,117,0.3)]"></div>
      </header>

      {/* 상시 노출 내비게이션 (차분한 디자인) */}
      <nav className="px-6 mt-8 mb-4 flex gap-2.5 relative z-[90]">
          {(['RECORDS', 'RANKING'] as const).map(t => (
              <button 
                  key={t} onClick={() => {
                    setMainTab(t);
                    if (t === 'RECORDS') setSelectedSessionId(null);
                  }}
                  className={`flex-1 py-4 rounded-[20px] text-[11px] font-black uppercase tracking-widest transition-all relative overflow-hidden group italic
                  ${mainTab === t 
                    ? 'bg-[#C9B075]/10 text-[#C9B075] border border-[#C9B075]/40 shadow-[0_0_20px_rgba(201,176,117,0.1)]' 
                    : 'bg-zinc-900/50 border border-white/5 text-zinc-600 hover:text-zinc-300'}`}
              >
                  {t === 'RECORDS' ? '경기 기록' : '테연 랭킹'}
              </button>
          ))}
      </nav>

      <section className="flex-1 px-6 sm:px-8 mt-4"> {/* 전체 서곡 여백 증설 (잘림 방지) */}
        {loading ? (
            <div className="py-24 text-center">
                <p className="text-[12px] font-black text-zinc-600 tracking-[0.4em] uppercase italic">Decrypting Vault...</p>
            </div>
        ) : mainTab === 'RECORDS' ? (
            <>
                {/* 1. 세션 상세 보기 */}
                {selectedSessionId && selectedSession ? (
                    <div className="animate-in slide-in-from-right duration-500">
                        {/* 럭셔리 세션 헤더 */}
                        <div className="flex flex-col gap-2 px-2 mb-8">
                            <span className="text-[12px] font-black text-[#C9B075] uppercase tracking-[0.4em] italic opacity-70">{selectedSession.date}</span>
                            <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic break-all leading-tight">{selectedSession.title}</h2>
                        </div>

                        {/* 시그니처 섹션 헤더: RANKING UPDATES */}
                        <div className="flex flex-col gap-1 px-4 mb-20 mt-10 relative">
                            <span className="absolute -top-6 left-4 text-[8px] font-bold text-[#C9B075]/30 tracking-widest uppercase">System Active v1.16.0</span>
                            <h3 className="text-3xl font-[1000] text-white uppercase tracking-tighter italic leading-none drop-shadow-xl">RANKING UPDATES</h3>
                            <div className="h-[2px] w-48 bg-gradient-to-r from-[#00e5ff] via-[#C9B075] to-transparent shadow-[0_4px_15px_rgba(0,229,255,0.2)] mt-1"></div>
                        </div>

                        {(() => {
                            const stats: Record<string, { name: string, wins: number, losses: number, diff: number, pf: number, pa: number, avatar: string, played: number }> = {};
                            selectedSession.matches.forEach((m: any) => {
                                const pNames = m.player_names || [];
                                const pAvatars = m.player_avatars || [];
                                pNames.forEach((name: string, k: number) => {
                                    if (!stats[name]) stats[name] = { name, wins: 0, losses: 0, diff: 0, pf: 0, pa: 0, avatar: pAvatars[k] || '', played: 0 };
                                    const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                    const win = k < 2 ? (s1 > s2) : (s2 > s1);
                                    stats[name].played++;
                                    if (win) stats[name].wins++; else stats[name].losses++;
                                    stats[name].pf += (k < 2 ? s1 : s2);
                                    stats[name].pa += (k < 2 ? s2 : s1);
                                    stats[name].diff = stats[name].pf - stats[name].pa;
                                });
                            });
                            const sortedResults = Object.values(stats).sort((a,b) => (b.wins - a.wins) || (b.diff - a.diff));
                            const top3 = sortedResults.slice(0, 3);

                            return (
                                <>
                                    {/* CHAMPION PODIUM (Decisive Padding Over Margin) */}
                                    <div className="flex items-end justify-center gap-2.5 w-full px-1 max-w-2xl mx-auto pt-[250px] pb-10 mt-0">
                                        {[1, 0, 2].map((idx) => {
                                            const p = top3[idx];
                                            if (!p) return <div key={idx} className="flex-1" />;
                                            const isFirst = idx === 0;
                                            
                                            // Placeholders for missing photos
                                            const rankThemes = [
                                                { icon: '🏆', color: 'from-[#FFD700] to-[#B8860B]', shadow: 'shadow-[0_0_20px_rgba(255,215,0,0.3)]' },
                                                { icon: '🥈', color: 'from-[#C0C0C0] to-[#707070]', shadow: 'shadow-[0_0_15px_rgba(192,192,192,0.2)]' },
                                                { icon: '🥉', color: 'from-[#CD7F32] to-[#8B4513]', shadow: 'shadow-[0_0_15px_rgba(205,127,50,0.2)]' }
                                            ];
                                            const theme = rankThemes[idx];

                                            return (
                                                <div 
                                                    key={p.name} 
                                                    className={`relative flex flex-col items-center p-3 pb-8 rounded-[36px] border border-white/5 backdrop-blur-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)] transition-all duration-300 ${isFirst ? 'w-[42%] bg-zinc-900 border-white/10 scale-110 z-10' : 'w-[30%] bg-zinc-900/40 opacity-80'}`}
                                                >
                                                    <div className="w-full flex flex-col items-center mt-3">
                                                        {/* Avatar / Honor Placeholder */}
                                                        <div className={`rounded-full border-2 border-white/10 overflow-hidden mb-3 shadow-2xl ${isFirst ? 'w-20 h-20 border-[#C9B075]/40' : 'w-16 h-16'}`}>
                                                            {p.avatar ? (
                                                                <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className={`w-full h-full bg-gradient-to-br ${theme.color} flex items-center justify-center`}>
                                                                    <span className="text-3xl drop-shadow-md">{theme.icon}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        
                                                        {/* Player Name */}
                                                        <h4 className={`font-[1000] text-center text-white italic uppercase tracking-tighter mb-1.5 ${isFirst ? 'text-xl' : 'text-sm'}`}>
                                                            {p.name}
                                                        </h4>

                                                        {/* Stats (Single Line, Impact-Size) */}
                                                        <div className="flex items-center justify-center gap-2 font-[1000] text-[12px] italic tracking-tighter uppercase whitespace-nowrap">
                                                            <span className="text-zinc-100">{p.wins}승 {p.losses}패</span>
                                                            <span className="opacity-20 text-zinc-800">|</span>
                                                            <span className={`drop-shadow-sm ${p.diff > 0 ? 'text-[#00e5ff]' : p.diff < 0 ? 'text-red-500' : 'text-zinc-600'}`}>
                                                                {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* 4등 이하 프리미엄 랭킹 리스트 (v1.15.6 좌측 밀착형 교정) */}
                                    <div className="h-10 w-full" aria-hidden="true" />
                                    <div className="flex flex-col gap-2.5 px-1 w-full max-w-5xl mx-auto">
                                        {/* TABLE HEADER (Left-Weighted Layout) */}
                                        <div className="grid grid-cols-[60px_2.5fr_45px_45px_75px_1fr] gap-2 py-2 italic font-black text-[9px] text-zinc-700 tracking-[0.3em] uppercase">
                                            <span className="text-center">#</span>
                                            <span className="pl-14">Player</span>
                                            <span className="text-center text-cyan-500/60">W</span>
                                            <span className="text-center text-zinc-700">L</span>
                                            <span className="text-right pr-2 text-[#C9B075]/60">+/-</span>
                                            <span></span> {/* Right Spacer only */}
                                        </div>

                                        {/* RANKING ROWS */}
                                        {sortedResults.slice(3).map((p, idx) => (
                                            <div key={p.name} className="group relative bg-zinc-900/30 hover:bg-zinc-800/60 border border-white/5 rounded-2xl grid grid-cols-[60px_2.5fr_45px_45px_75px_1fr] gap-2 items-center py-4 transition-all duration-300 active:scale-[0.98]">
                                                {/* Rank */}
                                                <div className="flex justify-center items-center">
                                                    <span className="text-lg font-[1000] italic text-zinc-800 group-hover:text-zinc-600">{(idx + 4).toString().padStart(2, '0')}</span>
                                                </div>

                                                {/* Player Info (Expanded to prevent wrapping) */}
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-full bg-black border border-white/5 flex items-center justify-center overflow-hidden shadow-2xl shrink-0 ml-1">
                                                        {p.avatar ? (
                                                            <img src={p.avatar} alt={p.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                                        ) : (
                                                            <span className="text-[10px] font-black text-zinc-800">{p.name[0]}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-[15px] font-black text-white italic uppercase tracking-tighter truncate group-hover:text-[#C9B075] transition-colors whitespace-nowrap">{p.name}</span>
                                                        <span className="text-[8px] font-black text-zinc-700 uppercase tracking-widest italic whitespace-nowrap">{p.played} MATCHES</span>
                                                    </div>
                                                </div>

                                                {/* Stats (Grouped on the right) */}
                                                <div className="flex justify-center">
                                                    <span className="text-xl font-[1000] italic text-cyan-500/80 drop-shadow-sm">{p.wins}</span>
                                                </div>
                                                <div className="flex justify-center">
                                                    <span className="text-xl font-[1000] italic text-zinc-700">{p.losses}</span>
                                                </div>
                                                <div className="flex justify-end pr-2">
                                                    <span className={`text-xl font-[1000] italic tracking-tighter ${p.diff > 0 ? 'text-[#C9B070]' : p.diff < 0 ? 'text-red-500' : 'text-zinc-600'}`}>
                                                        {p.diff > 0 ? `+${p.diff}` : p.diff}
                                                    </span>
                                                </div>
                                                <span></span> {/* Right Spacer */}

                                                {/* Side Decoration */}
                                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-8 bg-zinc-900 border-r border-zinc-800 rounded-r-full group-hover:bg-[#C9B075]/40 transition-all"></div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            );
                        })()}

                        <div className="h-6 w-full" aria-hidden="true" />

                        {/* 시그니처 섹션 헤더: COMPLETED MATCHES */}
                        <div className="flex flex-col gap-1 px-4 mb-4 mt-16">
                            <h3 className="text-3xl font-[1000] text-white uppercase tracking-tighter italic leading-none drop-shadow-xl">COMPLETED MATCHES</h3>
                            <div className="h-[2px] w-64 bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent shadow-[0_4px_15px_rgba(201,176,117,0.3)] mt-1"></div>
                        </div>
                        <div className="space-y-6 pb-40 px-1">
                            <div className="grid grid-cols-2 gap-4">
                                {selectedSession.matches.map((m: any, idx: number) => {
                                    const n = m.player_names || ["?","?","?","?"];
                                    const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
                                    return (
                                        <div key={m.id || idx} className="rounded-[28px] flex flex-col overflow-hidden border border-white/5 bg-zinc-900/80 shadow-2xl relative group transition-all">
                                            {/* Header Bar */}
                                            <div className="px-4 py-1.5 bg-black/40 border-b border-white/[0.03] flex justify-center items-center italic">
                                                <span className="text-[7px] font-black text-zinc-700 tracking-[0.3em] uppercase">MATCH {(idx + 1).toString().padStart(2, '0')}</span>
                                            </div>
                                            <div className="px-3 py-5">
                                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-black">
                                                    <div className="flex flex-col gap-1 text-center">
                                                        <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[0]}</span>
                                                        <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[1]}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 px-0.5">
                                                        <span className={`text-2xl italic ${s1 > s2 ? 'text-[#C9B075]' : 'text-zinc-200'}`}>{s1}</span>
                                                        <span className="text-zinc-900 font-bold opacity-30">:</span>
                                                        <span className={`text-2xl italic ${s2 > s1 ? 'text-[#C9B075]' : 'text-zinc-200'}`}>{s2}</span>
                                                    </div>
                                                    <div className="flex flex-col gap-1 text-center">
                                                        <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[2]}</span>
                                                        <span className="text-sm italic truncate text-zinc-100 uppercase tracking-tighter">{n[3]}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="bg-black/10 py-1.5 text-center border-t border-white/[0.01]">
                                                <span className="text-[6px] font-black text-zinc-800 uppercase tracking-[0.2em] italic">Archive</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <button onClick={() => setSelectedSessionId(null)} className="w-full py-5 mt-8 mb-12 rounded-[24px] bg-zinc-900/40 border border-white/5 text-[11px] font-black uppercase tracking-[0.25em] italic text-zinc-800 active:scale-95 transition-all">Back to Root Records</button>
                    </div>
                ) : (
                    /* 2. 세션 리스트 화면 (ELITE SESSION CARD - v1.15.1 담백한 개편) */
                    <div className="animate-in slide-in-from-bottom duration-500 space-y-6">
                        {/* 차분한 필터 섹션 */}
                        <section className="bg-zinc-900/40 border border-white/5 rounded-[32px] p-6 flex gap-4 shadow-xl backdrop-blur-3xl mb-8">
                            <div className="flex-1 flex flex-col items-center gap-2 italic font-black">
                                <span className="text-[9px] text-zinc-700 uppercase tracking-[0.4em] mb-1">TEMPORAL YEAR</span>
                                <select value={selectedYear} onChange={e=>setSelectedYear(Number(e.target.value))} className="w-full bg-black/40 border border-white/5 rounded-2xl px-4 py-3 text-[11px] text-white outline-none text-center font-black focus:border-[#C9B075]/30 transition-all appearance-none cursor-pointer">
                                    {[2026,2025,2024].map(y=><option key={y} value={y}>{y}</option>)}
                                </select>
                            </div>
                            <div className="flex-1 flex flex-col items-center gap-2 italic font-black">
                                <span className="text-[9px] text-zinc-700 uppercase tracking-[0.4em] mb-1">TEMPORAL MONTH</span>
                                <select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="w-full bg-black/40 border border-white/5 rounded-2xl px-4 py-3 text-[11px] text-white outline-none text-center font-black focus:border-[#C9B075]/30 transition-all appearance-none cursor-pointer">
                                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m=><option key={m} value={m}>{m}월</option>)}
                                </select>
                            </div>
                        </section>

                        <div className="space-y-6 pb-20"> {/* 카드 간 간격 정밀 조정 */}
                            {sessions.map((s, index) => (
                                <div 
                                    key={s.id} 
                                    onClick={() => setSelectedSessionId(s.id)}
                                    /* 'rounded-xl'(12px)로 높이를 낮추고 pt-10으로 충분한 상단 여백 확보하여 잘림 방지 */
                                    className="group relative backdrop-blur-3xl bg-zinc-900/40 border border-white/5 rounded-xl p-7 pt-10 overflow-hidden active:scale-[0.98] transition-all hover:border-[#C9B075]/30 shadow-2xl"
                                >
                                    {/* 차분한 샴페인 데이트 텍스트 (잘림 방지 ml-1) */}
                                    <div className="flex justify-between items-start mb-4 ml-1">
                                        <div className="px-1 border-l-2 border-[#C9B075]/40 pl-3">
                                            <span className="text-[10px] font-black text-[#C9B075] uppercase tracking-widest italic">{s.date}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mr-1">
                                            {index === 0 && (
                                                <span className="text-[9px] font-black text-[#C9B075] uppercase tracking-widest italic opacity-60">LATEST SYSTEM RECORD</span>
                                            )}
                                            {isAdmin && (
                                                <button onClick={(e)=>{e.stopPropagation(); deleteSession(s.id, s.title);}} className="p-2 rounded-xl bg-black/20 border border-white/5 text-zinc-700 hover:text-red-900 transition-all">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* 정갈한 타이틀 (px 확보로 잘림 방지) */}
                                    <div className="mb-10 px-2 mt-2">
                                        <h3 className="text-3xl font-[1000] text-zinc-100 tracking-tighter uppercase italic leading-none group-hover:text-white transition-colors break-all drop-shadow-lg">
                                            {s.title}
                                        </h3>
                                    </div>

                                    {/* 담백한 럭셔리 스탯 라인 */}
                                    <div className="flex items-center justify-between pt-5 border-t border-white/[0.03] px-1 focus:outline-none">
                                        <div className="flex items-center gap-6">
                                            <div className="flex items-center gap-2">
                                                <Users size={14} className="text-zinc-600" />
                                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest italic">
                                                    Players: <span className="text-zinc-100 ml-1">{s.participantCount}</span>
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Trophy size={14} className="text-zinc-600" />
                                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest italic">
                                                    Matches: <span className="text-zinc-100 ml-1">{s.matchCount}</span>
                                                </span>
                                            </div>
                                        </div>
                                        <div className="w-11 h-11 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center text-zinc-600 group-hover:border-[#C9B075]/50 group-hover:text-[#C9B075] transition-all">
                                            <ArrowRight size={20} />
                                        </div>
                                    </div>

                                    {/* 배경 데코레이션 (차분하게) */}
                                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-[#C9B075] opacity-[0.01] blur-[80px] pointer-events-none group-hover:opacity-[0.03] transition-opacity"></div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        ) : (
            <div className="py-24 text-center bg-zinc-900/40 rounded-[40px] border border-white/5 border-dashed mx-4">
                <p className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-700 italic">Global Registry Synchronizing</p>
                <div className="mt-8 px-8 py-3 bg-black/60 border border-white/5 rounded-2xl inline-block italic text-zinc-500 text-[9px] font-black tracking-widest uppercase animate-pulse">
                    테연 랭킹 업데이트 중...
                </div>
            </div>
        )}
      </section>
    </main>
  );

  async function deleteSession(sessionId: string, title: string) {
    if (!isAdmin) return;
    if (!confirm(`[${title}] 전체 대진 기록을 삭제하시겠습니까?`)) return;
    try {
        await supabase.from('teyeon_archive_v1').delete().eq('id', sessionId);
        fetchArchives();
    } catch (err: any) { alert("삭제 실패: " + err.message); }
  }
}
