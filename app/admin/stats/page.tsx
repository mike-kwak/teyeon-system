'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import ProfileAvatar from '@/components/ProfileAvatar';

interface LogEntry {
  id: string;
  user_email: string;
  path: string;
  action: string;
  metadata: any;
  created_at: string;
}

export default function AdminStatsPage() {
  const { role, hasPermission, isLoading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, uniqueUsers: 0 });
  const [isFetching, setIsFetching] = useState(true);

  useEffect(() => {
    if (!isLoading && !hasPermission('stats')) {
      router.replace('/');
    }
  }, [isLoading, role, router, hasPermission]);

  useEffect(() => {
    const fetchLogs = async () => {
      setIsFetching(true);
      const { data, error } = await supabase
        .from('app_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setLogs(data);
        setStats({
          total: data.length, // Simplified for now
          uniqueUsers: new Set(data.map(l => l.user_email)).size
        });
      }
      setIsFetching(false);
    };

    if (role === 'CEO') {
      fetchLogs();
    }
  }, [role]);

  if (isLoading || isFetching) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#000000] text-white p-6 font-sans w-full">
      <header className="mb-8">
        <button onClick={() => router.back()} className="text-[#D4AF37] mb-4 flex items-center gap-2 text-sm font-bold">
          ← 뒤로가기
        </button>
        <h1 className="text-3xl font-[1000] tracking-tight">방문 히스토리</h1>
        <p className="text-white/40 text-xs mt-1">테연 클럽의 실시간 활동 기록입니다</p>
      </header>

      {/* Stats Summary Card */}
      <section className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-gradient-to-br from-[#1A253D] to-[#14141F] p-4 rounded-2xl border border-white/5">
          <p className="text-white/40 text-[10px] uppercase font-black tracking-widest mb-1">Total Hits</p>
          <p className="text-2xl font-black text-[#D4AF37]">{stats.total}</p>
        </div>
        <div className="bg-gradient-to-br from-[#1A253D] to-[#14141F] p-4 rounded-2xl border border-white/5">
          <p className="text-white/40 text-[10px] uppercase font-black tracking-widest mb-1">Unique Users</p>
          <p className="text-2xl font-black text-[#A3E635]">{stats.uniqueUsers}</p>
        </div>
      </section>

      {/* Log Feed */}
      <section className="space-y-3">
        {logs.map((log) => (
          <div key={log.id} className="bg-white/5 border border-white/5 p-4 rounded-[20px] flex items-center gap-4 hover:border-[#D4AF37]/20 transition-all">
            <div className="w-10 h-10 shrink-0 bg-white/5 rounded-full flex items-center justify-center text-lg">
                {log.action === 'menu_click' ? '🖱️' : '🚀'}
            </div>
            <div className="flex-1 min-w-0">
               <div className="flex justify-between items-start mb-0.5">
                  <p className="text-xs font-black text-[#D4AF37] truncate max-w-[120px]">{log.user_email.split('@')[0]}</p>
                  <p className="text-[9px] text-white/20 font-medium">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
               </div>
               <p className="text-[13px] font-bold text-white/90 truncate">{log.metadata?.label || log.path}</p>
               <p className="text-[10px] text-white/30 truncate">{log.path}</p>
            </div>
          </div>
        ))}

        {logs.length === 0 && (
          <div className="py-20 text-center opacity-20">
            <p className="text-4xl mb-4">📭</p>
            <p className="text-sm font-bold">기록된 활동이 없습니다</p>
          </div>
        )}
      </section>
      
      <footer className="mt-12 opacity-20 text-center">
        <p className="text-[9px] font-black tracking-widest uppercase">Security Audit Log System v1.0</p>
      </footer>
    </main>
  );
}
