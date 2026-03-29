'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Match, Player, calculateRankings, calculateSettlements, Settlement } from '@/lib/kdk';

export default function FinancePage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balance] = useState({
    total: 450000,
    income: 1200000,
    expense: 750000
  });

  useEffect(() => {
    const savedMatches = localStorage.getItem('teyeon_matches');
    const savedPlayers = localStorage.getItem('teyeon_players');
    if (savedMatches && savedPlayers) {
      const matches: Match[] = JSON.parse(savedMatches);
      const players: Player[] = JSON.parse(savedPlayers);
      const rankings = calculateRankings(matches, players);
      const result = calculateSettlements(rankings);
      setSettlements(result);
    } else {
      // Dummy Settlements for Demo
      setSettlements([
        { name: '곽민섭', amount: 10000, type: 'reward', note: '👑 우승 상금' },
        { name: '홍길동', amount: 0, type: 'none', note: '-' },
        { name: '김철수', amount: 0, type: 'none', note: '-' },
        { name: 'Guest 1', amount: -5000, type: 'penalty', note: '❗ 하위 벌금' },
      ]);
    }
  }, []);

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#1E1E2E] text-white font-sans max-w-screen-xl mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-10">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-black tracking-tight">클럽 정산</h1>
        <button className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
          <span className="text-lg">⚙️</span>
        </button>
      </header>

      {/* Total Balance (Toss Style) */}
      <section className="mb-12 px-2 text-center">
        <div className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em] mb-4 flex items-center justify-center gap-2">
           현재 총 잔액 <span className="inline-block w-1 h-1 bg-[#D4AF37] rounded-full"></span>
        </div>
        <div className="text-[44px] font-black leading-tight tracking-tighter mb-6">
          {balance.total.toLocaleString()}<span className="text-2xl ml-1 text-white/60">원</span>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 bg-[#D4AF37] text-black font-black py-4 rounded-[20px] active:scale-95 transition-all text-sm">
            회비 납부하기
          </button>
          <button className="flex-1 bg-white/5 border border-white/10 text-white font-black py-4 rounded-[20px] active:scale-95 transition-all text-sm">
            송금하기
          </button>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="mb-10 bg-white/5 border border-white/5 rounded-[32px] p-6">
        <div className="flex justify-between items-end mb-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">이번 달 현황</span>
            <span className="text-lg font-black">수입이 <span className="text-[#D4AF37]">32%</span> 더 많아요</span>
          </div>
        </div>
        <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden flex">
          <div className="h-full bg-[#D4AF37]" style={{ width: '65%' }}></div>
          <div className="h-full bg-[#FF3D71]" style={{ width: '35%' }}></div>
        </div>
        <div className="flex justify-between mt-3 text-[10px] font-black uppercase tracking-tighter">
          <div className="flex items-center gap-1.5 text-white/40">
            <div className="w-2 h-2 rounded-full bg-[#D4AF37]"></div> 수입 1.2M
          </div>
          <div className="flex items-center gap-1.5 text-white/40">
             지출 0.75M <div className="w-2 h-2 rounded-full bg-[#FF3D71]"></div>
          </div>
        </div>
      </section>

      {/* Transaction List */}
      <section>
        <div className="flex items-center justify-between mb-6 px-1">
          <h3 className="text-sm font-black tracking-tight">최근 거래 내역</h3>
          <button className="text-[10px] font-black text-white/30 uppercase tracking-widest">전체보기</button>
        </div>
        
        <div className="space-y-6">
          {[
            { date: '03.24', title: '테니스장 대관(시립코트)', amount: -45000, type: 'out' },
            { date: '03.24', title: '3월 정기 회비(섭이 외 14명)', amount: 150000, type: 'in' },
            { date: '03.22', title: '볼 구매(윌슨 챔피언십)', amount: -82000, type: 'out' },
            { date: '03.20', title: '제1회 대회 스폰서 지원', amount: 200000, type: 'in' },
          ].map((item, idx) => (
            <div key={idx} className="flex justify-between items-center group active:scale-[0.98] transition-all">
              <div className="flex items-center gap-4">
                <div className="text-[11px] font-black text-white/20">{item.date}</div>
                <div>
                  <div className="text-[14px] font-black group-hover:text-[#D4AF37] transition-colors">{item.title}</div>
                  <div className="text-[10px] font-bold text-white/30 uppercase">카카오뱅크</div>
                </div>
              </div>
              <div className={`text-[15px] font-black ${item.type === 'in' ? 'text-[#D4AF37]' : 'text-[#FF3D71]'}`}>
                {item.amount > 0 ? `+${item.amount.toLocaleString()}` : item.amount.toLocaleString()}원
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Action */}
      <button className="w-full bg-white/5 border border-white/10 text-white/60 font-black py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all text-sm uppercase tracking-widest">
        <span>➕</span> 수동 정산 기록 추가
      </button>

      {/* Footer Info */}
      <footer className="mt-auto py-6 flex justify-center opacity-30">
        <p className="text-[10px] font-bold tracking-widest uppercase">Teyeon v2.0 • Financial Clarity</p>
      </footer>
    </main>
  );
}
