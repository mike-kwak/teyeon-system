'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export default function AdminPage() {
  const { user, role, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && role !== 'CEO') {
      router.replace('/');
    }
  }, [role, isLoading, router]);

  if (isLoading || role !== 'CEO') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#000000]">
        <div className="w-10 h-10 border-4 border-[#D4AF37] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#000000] text-white font-sans max-w-md mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="text-2xl opacity-50 hover:opacity-100 transition-opacity">
          ←
        </Link>
        <h1 className="text-xl font-black tracking-tight text-[#D4AF37]">ADMIN SETTINGS</h1>
        <div className="w-6"></div>
      </header>

      {/* CEO Badge */}
      <section className="bg-gradient-to-br from-[#1A253D] to-[#14141F] rounded-[24px] py-6 px-4 border border-[#D4AF37]/30 text-center mb-8 relative overflow-hidden shadow-[0_0_30px_rgba(212,175,55,0.1)]">
        <div className="text-4xl mb-3 relative z-10">👑</div>
        <h2 className="text-xl font-bold text-white mb-1 relative z-10">CEO 전용 관리 패널</h2>
        <p className="text-white/40 text-[10px] font-medium tracking-widest uppercase relative z-10">Ultimate Authority Mode</p>
        <div className="absolute inset-0 bg-gradient-to-t from-[#D4AF37]/5 to-transparent pointer-events-none"></div>
      </section>

      {/* Admin Menu Placeholder */}
      <section className="space-y-4">
        <div className="bg-white/5 p-5 rounded-[24px] border border-white/5 opacity-50">
          <p className="text-sm font-bold text-white/60 mb-1">회원 등급 권한 수동 조정</p>
          <p className="text-[10px] text-white/30">준비 중인 기능입니다...</p>
        </div>
        <div className="bg-white/5 p-5 rounded-[24px] border border-white/5 opacity-50">
          <p className="text-sm font-bold text-white/60 mb-1">클럽 재무 보고서 마스터 설정</p>
          <p className="text-[10px] text-white/30">준비 중인 기능입니다...</p>
        </div>
        <div className="bg-white/5 p-5 rounded-[24px] border border-white/5 opacity-50">
          <p className="text-sm font-bold text-white/60 mb-1">시스템 공지 마케팅 설정</p>
          <p className="text-[10px] text-white/30">준비 중인 기능입니다...</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto py-10 flex flex-col items-center opacity-20">
         <p className="text-[9px] font-black tracking-[0.3em] uppercase">Auth Verified by Supabase</p>
      </footer>
    </main>
  );
}
