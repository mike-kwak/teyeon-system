'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import RankingTab from '@/components/RankingTab';
import PremiumSpinner from '@/components/PremiumSpinner';
import { DataStateView } from '@/components/DataStateView';

export default function ArchivePage() {
    const [sessions, setSessions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSession, setSelectedSession] = useState<any | null>(null);
    const [yearFilter, setYearFilter] = useState('2026');
    const [monthFilter, setMonthFilter] = useState((new Date().getMonth() + 1).toString());

    useEffect(() => {
        fetchSessions();
    }, []);

    const fetchSessions = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('sessions_archive')
                .select('*')
                .order('date', { ascending: false });
            
            if (error) throw error;
            setSessions(data || []);
        } catch (err) {
            console.error("Fetch Archive Error:", err);
        } finally {
            setLoading(false);
        }
    };

    const filteredSessions = sessions.filter(s => {
        const [y, m] = s.date.split('-');
        return y === yearFilter && parseInt(m).toString() === monthFilter;
    });

    if (selectedSession) {
        return (
            <div className="min-h-screen bg-black text-white pb-32">
                <header className="px-6 py-6 flex items-center gap-4 border-b border-white/10">
                    <button 
                        onClick={() => setSelectedSession(null)}
                        className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-colors"
                    >
                        ←
                    </button>
                    <h1 className="text-xl font-black italic tracking-tighter uppercase">Archive Report</h1>
                </header>
                
                <RankingTab 
                    players={selectedSession.ranking_data || []}
                    sessionTitle={selectedSession.title}
                    isArchive={true}
                    matchSnapshot={selectedSession.match_snapshot || []}
                    onShareMatch={() => alert("Report shared!")}
                    onShareResult={() => alert("Champions shared!")}
                />
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-black text-white font-sans p-6 pb-32">
            <header className="mb-10 flex flex-col items-center text-center">
                <span className="text-[10px] font-black bg-gradient-to-r from-[#C9B075] via-[#E5D29B] to-[#C9B075] bg-clip-text text-transparent tracking-[0.5em] uppercase mb-4">
                    Teyeon Records
                </span>
                <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase">
                    Archive Portal
                </h1>
                <div className="mt-4 h-1 w-24 bg-gradient-to-r from-transparent via-[#C9B075] to-transparent opacity-40" />
            </header>

            {/* Filter Section */}
            <section className="mb-10 space-y-4">
                <div className="flex gap-3 overflow-x-auto no-scrollbar py-2">
                    {['2025', '2026', '2027'].map(year => (
                        <button
                            key={year}
                            onClick={() => setYearFilter(year)}
                            className={`px-6 py-2 rounded-full text-[11px] font-black tracking-widest transition-all ${year === yearFilter ? 'bg-[#C9B075] text-black shadow-lg shadow-[#C9B075]/20' : 'bg-white/5 text-white/30 border border-white/10'}`}
                        >
                            {year}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
                    {Array.from({ length: 12 }, (_, i) => (i + 1).toString()).map(month => (
                        <button
                            key={month}
                            onClick={() => setMonthFilter(month)}
                            className={`min-w-[50px] h-10 rounded-xl text-[11px] font-black flex items-center justify-center transition-all ${month === monthFilter ? 'bg-white/10 text-[#C9B075] border border-[#C9B075]/30' : 'bg-white/5 text-white/20 border border-white/5'}`}
                        >
                            {month}월
                        </button>
                    ))}
                </div>
            </section>

            {/* Session List */}
            <div className="space-y-4">
                {loading ? (
                    <div className="py-20 flex flex-col items-center opacity-30">
                        <PremiumSpinner />
                        <span className="mt-4 text-[10px] font-black tracking-[0.3em] uppercase">Recalling History...</span>
                    </div>
                ) : filteredSessions.length === 0 ? (
                    <div className="py-20 flex flex-col items-center text-center opacity-20">
                        <span className="text-4xl mb-4">🏺</span>
                        <h3 className="text-lg font-black uppercase tracking-widest">No Records Found</h3>
                        <p className="text-[10px] font-medium uppercase mt-2">이 기간에 기록된 토너먼트 세션이 없습니다.</p>
                    </div>
                ) : (
                    filteredSessions.map((session) => (
                        <div 
                            key={session.id}
                            onClick={() => setSelectedSession(session)}
                            className="relative group cursor-pointer overflow-hidden rounded-[30px] bg-white/[0.03] border border-white/5 p-6 transition-all hover:bg-white/[0.08] active:scale-[0.98] shadow-2xl"
                        >
                            <div className="absolute top-0 right-0 p-4">
                                <span className="text-[8px] font-black text-[#C9B075] uppercase tracking-widest opacity-40">Verified Match</span>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-black text-white/30 tracking-[0.2em] uppercase">{session.date}</span>
                                <h3 className="text-xl font-black italic text-white uppercase tracking-tighter group-hover:text-[#C9B075] transition-colors">
                                    {session.title}
                                </h3>
                                <div className="mt-4 flex items-center gap-4 text-white/40">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Matches:</span>
                                        <span className="text-[11px] font-bold text-white/60">{session.total_matches || 0}</span>
                                    </div>
                                    <div className="w-px h-2 bg-white/10" />
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Ranked:</span>
                                        <span className="text-[11px] font-bold text-white/60">{session.ranking_data?.length || 0} 명</span>
                                    </div>
                                </div>
                            </div>
                            <div className="absolute bottom-0 right-0 p-6 translate-x-4 translate-y-4 opacity-0 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
                                <div className="w-10 h-10 rounded-full bg-[#C9B075] flex items-center justify-center text-black font-black text-xl shadow-lg">
                                    →
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <footer className="mt-20 py-10 flex flex-col items-center opacity-20 text-center border-t border-white/5">
                <p className="text-[8px] font-black text-[#C9B075] tracking-[0.5em] uppercase">Teyeon Historical Archives • Stable Build 2026</p>
            </footer>
        </main>
    );
}
