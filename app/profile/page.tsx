'use client';

import React from 'react';
import Link from 'next/link';

export default function ProfilePage() {
  const userInfo = {
    name: '곽민섭',
    nickname: '섭이',
    role: 'CEO',
    birthdate: '1990-01-01',
    account: '카카오뱅크 3333-01-2345678',
    stats: {
      wins: 45,
      losses: 12,
      winRate: '79%'
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('📋 계좌번호가 복사되었습니다!');
  };

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#1E1E2E] text-white font-sans max-w-md mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-black tracking-tight">멤버 정보</h1>
        <div className="w-10"></div>
      </header>

      {/* Profile Card */}
      <section className="bg-gradient-to-br from-[#1A253D] to-[#0A0E1A] border border-[#D4AF37]/30 rounded-[32px] p-8 mb-8 flex flex-col items-center shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4">
          <span className="bg-[#D4AF37] text-black text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">
            {userInfo.role}
          </span>
        </div>

        <div className="w-24 h-24 rounded-full border-2 border-[#D4AF37] p-1 mb-4">
          <div className="w-full h-full rounded-full bg-gradient-to-br from-[#1a253d] to-[#D4AF37] flex items-center justify-center text-3xl font-black">
            섭
          </div>
        </div>

        <h2 className="text-2xl font-black mb-1">{userInfo.name}</h2>
        <p className="text-[#D4AF37] font-bold text-sm mb-6 opacity-80">@{userInfo.nickname}</p>

        <div className="grid grid-cols-3 gap-8 w-full border-t border-white/5 pt-6">
          <div className="text-center">
            <div className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Wins</div>
            <div className="text-lg font-black">{userInfo.stats.wins}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Losses</div>
            <div className="text-lg font-black">{userInfo.stats.losses}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Rate</div>
            <div className="text-lg font-black text-[#D4AF37]">{userInfo.stats.winRate}</div>
          </div>
        </div>
      </section>

      {/* Info Sections */}
      <div className="space-y-4 mb-10">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-3">개인 정보</h3>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-bold text-white/60">생년월일</span>
            <span className="text-sm font-black">{userInfo.birthdate}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-white/60">멤버 등급</span>
            <span className="text-sm font-black text-[#D4AF37] italic">VVIP CEO</span>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[10px] font-black text-white/30 uppercase tracking-widest">계좌 정보</h3>
            <button 
              onClick={() => copyToClipboard(userInfo.account)}
              className="text-[10px] font-black text-[#D4AF37] uppercase bg-[#D4AF37]/10 px-2 py-1 rounded-md"
            >
              Copy
            </button>
          </div>
          <p className="text-sm font-black mb-6">{userInfo.account}</p>
          
          <div className="grid grid-cols-1 gap-3">
            <button className="w-full bg-[#FAE100] text-[#3C1E1E] font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-lg">
              <span className="text-xl">💛</span> 카카오페이 송금하기
            </button>
            <button 
              onClick={() => copyToClipboard(userInfo.account)}
              className="w-full bg-white/5 border border-white/10 text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 active:scale-95 transition-transform"
            >
              <span>🔗</span> 계좌번호 복사하기
            </button>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="mt-auto py-6 flex justify-center opacity-30">
        <p className="text-[10px] font-bold tracking-widest uppercase">Teyeon v2.0 • Member Security</p>
      </footer>
    </main>
  );
}
