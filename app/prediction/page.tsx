'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function PredictionPage() {
  const [analyzing, setAnalyzing] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setAnalyzing(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const predictions = [
    { name: '곽민섭', probability: 92, status: '확정적', reason: '최근 5경기 전승' },
    { name: '홍길동', probability: 78, status: '유력', reason: '득실차 압도적 1위' },
    { name: '김철수', probability: 65, status: '가능성 높음', reason: '상위권 꾸준한 성적' },
    { name: '이영희', probability: 42, status: '경합 중', reason: '최근 컨디션 회복세' },
  ];

  return (
    <main className="flex flex-col min-h-screen p-6 bg-[#1E1E2E] text-white font-sans max-w-screen-xl mx-auto pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <Link href="/" className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10 active:scale-90 transition-transform">
          <span className="text-xl">←</span>
        </Link>
        <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
          AI 시드 예측 <span className="text-[10px] bg-[#D4AF37] text-black px-1.5 py-0.5 rounded font-black">BETA</span>
        </h1>
        <div className="w-10"></div>
      </header>

      {analyzing ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20">
          <div className="w-20 h-20 border-4 border-white/5 border-t-[#D4AF37] rounded-full animate-spin mb-6"></div>
          <h2 className="text-xl font-black mb-2 italic">AI 실시간 분석 중...</h2>
          <p className="text-white/30 text-sm font-bold text-center px-10">
            멤버들의 최근 승률과 득실차 데이터를<br/>바탕으로 다음 대회 시드를 예측합니다.
          </p>
        </div>
      ) : (
        <section className="animate-in fade-in duration-700">
          <div className="bg-gradient-to-br from-[#D4AF37]/10 to-transparent border border-[#D4AF37]/20 rounded-3xl p-6 mb-8 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent"></div>
            <h3 className="text-sm font-bold text-[#D4AF37] mb-2 uppercase tracking-widest">Next Tournament</h3>
            <div className="text-3xl font-black mb-1">제2회 테연 오픈</div>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.3em]">Estimated Seeds</p>
          </div>

          <div className="space-y-4">
            {predictions.map((p, idx) => (
              <div key={idx} className="bg-white/5 border border-white/10 rounded-2xl p-5 relative">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-white/20">0{idx + 1}</span>
                    <h4 className="text-lg font-black">{p.name}</h4>
                  </div>
                  <span className={`text-[10px] font-black px-2 py-1 rounded-full uppercase
                    ${p.probability > 80 ? 'bg-[#D4AF37] text-black' : 'bg-white/10 text-[#D4AF37]'}
                  `}>
                    {p.status}
                  </span>
                </div>
                
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-[11px] font-bold">
                    <span className="text-white/30">시드 배정 확률</span>
                    <span className="text-[#D4AF37]">{p.probability}%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#D4AF37] transition-all duration-1000"
                      style={{ width: `${p.probability}%` }}
                    ></div>
                  </div>
                </div>

                <p className="text-[11px] font-bold text-white/30 flex items-center gap-2">
                  <span className="w-1 h-1 bg-[#D4AF37] rounded-full"></span>
                  {p.reason}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-[10px] font-bold text-white/20 uppercase tracking-widest leading-relaxed">
            * 이 데이터는 통계에 기반한 예측일 뿐이며,<br/>실제 대회 시드권과는 다를 수 있습니다.
          </p>
        </section>
      )}

      {/* Footer Info */}
      <footer className="mt-10 py-6 flex justify-center opacity-30">
        <p className="text-[10px] font-bold tracking-widest uppercase">Teyeon v2.0 • AI Engine v1.0</p>
      </footer>
    </main>
  );
}
