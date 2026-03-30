'use client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import Link from 'next/link';

interface Notice {
  id: string;
  title: string;
  is_pinned: boolean;
  view_count: number;
  created_at: string;
  comment_count?: number; 
}

export default function NoticeListPage() {
  const { role } = useAuth();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchNotices = useCallback(async () => {
    console.log('[Notice] Starting fetch...');
    setIsFetching(true);
    setFetchError(null);

    // Safety Timeout: Force stop loading after 8 seconds
    const timeout = setTimeout(() => {
      if (isFetching) {
        console.warn('[Notice] Fetch timed out');
        setIsFetching(false);
        setFetchError('Request timed out. Please check your connection.');
      }
    }, 8000);

    try {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      clearTimeout(timeout);
      
      if (error) {
        console.error('[Notice] Supabase error:', error);
        throw error;
      }
      
      console.log('[Notice] Data received:', data?.length || 0);
      setNotices(data || []);
      setIsFetching(false);

    } catch (err: any) {
      console.error('[Notice] Fetch error catch:', err);
      setFetchError(err?.message || String(err));
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

  const isStaff = role === 'CEO' || role === 'ADMIN';

  useEffect(() => {
    console.log("NOTICE_STABILITY_v3.9_ACTIVE");
  }, []);

  return (
    <main className="min-h-screen bg-[#000000] text-white font-sans w-full pb-24 relative">
      {/* Diagnostic Marker (v3.9) */}
      <div className="absolute top-2 right-4 text-[8px] font-black text-[#D4AF37]/20 uppercase tracking-widest z-[60]">v3.9 Stability</div>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-lg border-b border-white/5 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/')} className="text-[#D4AF37] text-2xl hover:bg-white/5 w-10 h-10 flex items-center justify-center rounded-full transition-all">←</button>
          <h1 className="text-xl font-black tracking-tight uppercase">클럽 공지사항</h1>
        </div>
        {isStaff && (
          <button 
            onClick={() => router.push('/notice/create')}
            className="bg-[#D4AF37] text-black text-[10px] font-bold px-3 py-1.5 rounded-full shadow-[0_4px_15px_rgba(212,175,55,0.3)] active:scale-90 transition-all uppercase tracking-widest"
          >
            NEW
          </button>
        )}
      </header>

      {/* Notice List */}
      <div className="px-5 mt-6 space-y-3">
        {fetchError && (
          <div className="bg-red-500/10 border border-red-500/30 p-5 rounded-[28px] text-[11px] text-red-500 font-bold mb-4">
            ⚠️ DB Sync Error: {fetchError}
            <button onClick={() => fetchNotices()} className="block mt-1 underline opacity-60">Try Again</button>
          </div>
        )}
        
        {isFetching ? (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-3 border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-[10px] text-white/20 uppercase tracking-widest font-black animate-pulse">Syncing Announcements...</p>
          </div>
        ) : notices.length > 0 ? (
          notices.map((notice) => (
            <Link 
              key={notice.id} 
              href={`/notice/${notice.id}`}
              className={`
                block p-5 rounded-[28px] border transition-all active:scale-95 group relative overflow-hidden
                ${notice.is_pinned 
                  ? 'bg-gradient-to-br from-[#D4AF37]/10 to-[#1A1A1A] border-[#D4AF37]/30 shadow-lg' 
                  : 'bg-white/[0.03] border-white/5 hover:border-white/20'}
              `}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2.5">
                  <span className={`text-lg pt-0.5 ${notice.is_pinned ? 'grayscale-0' : 'opacity-30'}`}>
                    {notice.is_pinned ? '📌' : '📢'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-[15px] font-black tracking-tight leading-snug group-hover:text-[#D4AF37] transition-colors truncate">
                      {notice.title}
                    </h2>
                    <div className="flex items-center gap-3 mt-1.5 opacity-30">
                      <span className="text-[10px] font-bold">
                        {format(new Date(notice.created_at), 'yyyy. MM. dd', { locale: ko })}
                      </span>
                      <span className="text-[10px]">👁️ {notice.view_count}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))
        ) : (
          <div className="py-20 text-center space-y-4 bg-white/5 rounded-[40px] border border-white/5 mx-2">
            <p className="text-sm font-bold text-white/20 uppercase tracking-widest italic">등록된 공지가 없습니다.</p>
            {isStaff && (
                <button onClick={() => router.push('/notice/create')} className="text-[11px] text-[#D4AF37] font-black underline underline-offset-4">첫 공지 작성하러 가기</button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
