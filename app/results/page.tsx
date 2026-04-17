'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * ResultsPage (v1.14.5): THE ULTIMATE ARCHIVE RECAP
 * - 타이틀을 'Archive Recap'으로 변경 (Result 탭 부재 컨셉 반영)
 * - 경기 카드 음영 강화 (bg-zinc-900/80)
 * - MATCH 라벨 정중앙 배치 & 무잘림 고정
 */
export default function ResultsPage() {
  const router = useRouter();
  const { role } = useAuth();
  const [archives, setArchives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResults();
  }, []);

  async function fetchResults() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('teyeon_archive_v1')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      
      const failovers = JSON.parse(localStorage.getItem('kdk_archive_failover') || '[]');
      const combined = [...failovers.map((f:any) => ({...f, isLocal: true})), ...(data || [])];
      
      combined.sort((a,b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      
      const flatMatches: any[] = [];
      const seenIds = new Set();

      combined.forEach(record => {
        if (seenIds.has(record.id)) return;
        seenIds.add(record.id);

        const raw = record.raw_data || {};
        const matchesArr = raw.snapshot_data || [];
        matchesArr.forEach((m: any, idx: number) => {
          flatMatches.push({
            ...m,
            session_title: raw.title,
            match_date: raw.date,
            isLocal: !!record.isLocal,
            displayIdx: idx + 1
          });
        });
      });

      setArchives(flatMatches);
    } catch (err) {
      console.error("Fetch Results Error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col min-h-screen bg-[#0a0a0c] text-white font-sans w-full relative overflow-y-auto no-scrollbar pb-32">
      {/* LUXURY HEADER (v1.14.5 ULTIMATE) */}
      <header className="px-8 pt-24 pb-2 flex flex-col gap-1 items-start relative z-[100] animate-in fade-in slide-in-from-top duration-700 mt-12">
          <button 
            onClick={() => router.back()}
            className="flex items-center gap-2 text-[#C9B075] mb-2 hover:translate-x-[-4px] transition-transform italic"
          >
              <ArrowLeft size={16} />
              <span className="text-[13px] font-[1000] uppercase tracking-widest">뒤로가기</span>
          </button>
          <span className="text-[11px] font-[1000] text-[#C9B075] uppercase tracking-[0.4em] italic drop-shadow-lg">Teyeon Club Archive Recap</span>
          <h1 className="text-4xl sm:text-5xl font-[1000] tracking-tighter uppercase italic text-white leading-none drop-shadow-xl">Archive Recap</h1>
          <div className="h-[2px] w-full bg-gradient-to-r from-[#C9B075] via-[#C9B075]/40 to-transparent mt-3 shadow-[0_4px_15px_rgba(201,176,117,0.3)]"></div>
      </header>

      <section className="flex-1 px-6 pb-48">
        {loading ? (
            <div className="py-24 text-center">
                <p className="text-[12px] font-[1000] text-zinc-600 tracking-[0.4em] uppercase italic">Decrypting Logs...</p>
            </div>
        ) : archives.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom duration-700">
            {archives.map((m, idx) => {
              const n = m.player_names || ["?","?","?","?"];
              const s1 = Number(m.score1 || 0), s2 = Number(m.score2 || 0);
              return (
                <div key={m.id || idx} className="rounded-[28px] flex flex-col overflow-hidden border border-white/5 bg-zinc-900/80 shadow-2xl relative group transition-all">
                  {/* 중앙 정렬 & 음영 강화 MATCH 라벨 */}
                  <div className="px-4 py-2 bg-black/40 border-b border-white/[0.03] flex justify-center items-center italic">
                    <span className="text-[8px] font-[1000] text-zinc-600 tracking-[0.3em] uppercase">{m.session_title.slice(0, 8)} REGISTRY</span>
                  </div>
                  <div className="px-4 py-6">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 font-[1000]">
                        <div className="flex flex-col gap-0.5 text-center">
                            <span className={`text-[11px] italic truncate ${s1 > s2 ? 'text-white' : 'text-zinc-800'}`}>{n[0]}</span>
                            <span className={`text-[11px] italic truncate ${s1 > s2 ? 'text-white' : 'text-zinc-800'}`}>{n[1]}</span>
                        </div>
                        <div className="flex items-center gap-1 px-1">
                            <span className={`text-2xl font-[1000] italic ${s1 > s2 ? 'text-[#C9B075]' : 'text-zinc-900'}`}>{s1}</span>
                            <span className="text-zinc-950 font-bold">:</span>
                            <span className={`text-2xl font-[1000] italic ${s2 > s1 ? 'text-[#C9B075]' : 'text-zinc-900'}`}>{s2}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 text-center">
                            <span className={`text-[11px] italic truncate ${s2 > s1 ? 'text-white' : 'text-zinc-800'}`}>{n[2]}</span>
                            <span className={`text-[11px] italic truncate ${s2 > s1 ? 'text-white' : 'text-zinc-800'}`}>{n[3]}</span>
                        </div>
                    </div>
                  </div>
                  <div className="bg-black/20 py-2.5 text-center border-t border-white/[0.02]">
                    <span className="text-[7px] font-[1000] text-zinc-800 uppercase tracking-[0.2em] italic">Archive Record</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-48 text-center bg-zinc-900/10 rounded-[50px] border border-zinc-900">
            <p className="text-[12px] font-[1000] uppercase tracking-[0.4em] text-zinc-900 italic">No Entries Found</p>
          </div>
        )}
      </section>
    </main>
  );
}
