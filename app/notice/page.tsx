'use client';

import React from 'react';
import Link from 'next/link';

export default function NoticePage() {
  const notices = [
    { id: 1, title: '📢 [필독] 2025년 3월 정기 모임 일정 안내', date: '2025.03.24', views: 124, pinned: true },
    { id: 2, title: '🎾 제1회 테연 클럽 자체 대회 규정 (KDK 방식)', date: '2025.03.22', views: 89, pinned: true },
    { id: 3, title: '🏸 신규 코트 예약 시스템 도입 안내', date: '2025.03.20', views: 56, pinned: false },
    { id: 4, title: '📸 지난 주말 정기 모임 사진 업데이트', date: '2025.03.18', views: 245, pinned: false },
    { id: 5, title: '👕 클럽 공식 유니폼 공동구매 신청 (마감임박)', date: '2025.03.15', views: 312, pinned: false },
  ];

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#1E1E2E] text-white font-sans max-w-md mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-black tracking-tight">공지사항</h1>
        <button className="bg-[#D4AF37]/10 text-[#D4AF37] w-10 h-10 rounded-full flex items-center justify-center border border-[#D4AF37]/20 active:scale-90">
          <span>🔍</span>
        </button>
      </header>

      {/* Notice List */}
      <div className="space-y-3">
        {notices.map((notice) => (
          <div 
            key={notice.id}
            className={`
              p-5 rounded-2xl border transition-all active:scale-[0.98]
              ${notice.pinned 
                ? 'bg-gradient-to-br from-[#1A253D] to-[#0A0E1A] border-[#D4AF37]/50' 
                : 'bg-white/5 border-white/5'}
            `}
          >
            <div className="flex items-start gap-3">
              {notice.pinned && <span className="text-lg mt-0.5">📌</span>}
              <div className="flex-1">
                <h3 className={`font-black text-[15px] leading-snug mb-3 ${notice.pinned ? 'text-[#D4AF37]' : 'text-white/90'}`}>
                  {notice.title}
                </h3>
                <div className="flex items-center gap-4 text-[10px] font-bold text-white/30 uppercase tracking-widest">
                  <span>{notice.date}</span>
                  <div className="w-1 h-1 bg-white/10 rounded-full"></div>
                  <span>Views {notice.views}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Write Button (Admin Placeholder) */}
      <button className="fixed bottom-8 right-8 w-14 h-14 bg-[#D4AF37] text-black rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-transform z-20">
        <span className="text-2xl font-black">+</span>
      </button>

      {/* Footer Info */}
      <footer className="mt-10 py-6 flex justify-center opacity-30">
        <p className="text-[10px] font-bold tracking-widest uppercase">Teyeon v2.0 • Notice Board</p>
      </footer>
    </main>
  );
}
