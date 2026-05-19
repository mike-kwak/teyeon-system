import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  LayoutGrid,
  Share2,
  Sparkles,
  Trophy,
} from 'lucide-react';

const previewFeatures = [
  {
    title: '대회 모드',
    description: '토너먼트와 이벤트성 경기를 운영하는 특별 매치 모드입니다.',
    icon: Trophy,
  },
  {
    title: '월례회 모드',
    description: '클럽 정기 모임에서 쓰기 좋은 특별 경기 운영 흐름을 준비합니다.',
    icon: CalendarDays,
  },
  {
    title: '직접 대진 구성',
    description: '운영자가 팀과 경기 순서를 직접 구성할 수 있게 연결합니다.',
    icon: LayoutGrid,
  },
  {
    title: '결과 기록/공유',
    description: '특별 경기 결과를 저장하고 공유하는 기록 기능을 제공합니다.',
    icon: ClipboardCheck,
  },
];

export default function SpecialMatchComingSoonPage() {
  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col overflow-hidden bg-[#12110f] px-5 pt-6 text-white"
      style={{ paddingBottom: 'calc(220px + env(safe-area-inset-bottom))' }}
    >
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[280px] w-[280px] -translate-x-1/2 rounded-full bg-[#D8BE78]/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-140px] right-[-80px] h-[260px] w-[260px] rounded-full bg-[#D8BE78]/8 blur-3xl" />

      <header className="relative z-10 flex items-center justify-between">
        <Link
          href="/"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition active:scale-95"
          aria-label="메인으로 돌아가기"
        >
          <ArrowLeft size={20} />
        </Link>
        <span className="rounded-full border border-[#D8BE78]/35 bg-[#D8BE78]/12 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#E8D18D]">
          Coming Soon
        </span>
      </header>

      <section className="relative z-10 mt-9 rounded-[32px] border border-[#D8BE78]/18 bg-[#242323]/95 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#D8BE78]/25 bg-[#D8BE78]/12 text-[#E8D18D]">
            <Sparkles size={28} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#D8BE78]/65">
              TEYEON SPECIAL MATCH
            </p>
            <h1 className="mt-2 text-[34px] font-black leading-none tracking-[-0.04em] text-[#F6E8BE]">
              스페셜 매치
            </h1>
          </div>
        </div>

        <p className="mt-6 text-[14px] font-bold leading-relaxed text-white/70">
          이벤트성 경기, 월례회, 특별 대진을 운영하기 위한 기능입니다.
        </p>
        <p className="mt-3 rounded-2xl border border-[#D8BE78]/14 bg-black/20 px-4 py-3 text-[12px] font-bold leading-relaxed text-[#E8D18D]/75">
          현재는 KDK 수동 운영을 우선 안정화 중이며, 스페셜 매치는 다음 단계에서 제공됩니다.
        </p>
      </section>

      <section className="relative z-10 mt-5 grid gap-3">
        {previewFeatures.map((feature) => {
          const Icon = feature.icon;

          return (
            <article
              key={feature.title}
              className="flex min-w-0 items-start gap-4 rounded-[26px] border border-white/10 bg-[#242323]/88 p-4 shadow-[0_12px_34px_rgba(0,0,0,0.32)]"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#D8BE78]/20 bg-[#D8BE78]/10 text-[#D8BE78]">
                <Icon size={23} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-black text-[#F1E7C4]">{feature.title}</h2>
                <p className="mt-1 text-[12px] font-bold leading-relaxed text-white/55">
                  {feature.description}
                </p>
              </div>
            </article>
          );
        })}
      </section>

      <section className="relative z-10 mt-6 grid gap-3">
        <Link
          href="/kdk"
          className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-[#D8BE78]/45 bg-[#D8BE78] px-4 text-[13px] font-black uppercase tracking-[0.16em] text-black shadow-[0_16px_36px_rgba(216,190,120,0.22)] transition active:scale-[0.98]"
        >
          <Trophy size={18} />
          KDK로 이동
        </Link>
        <Link
          href="/"
          className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[13px] font-black uppercase tracking-[0.16em] text-white/75 transition active:scale-[0.98]"
        >
          <Share2 size={18} />
          메인으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
