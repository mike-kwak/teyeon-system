'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Layout,
  Settings,
  Swords,
  Trophy,
  UserRoundSearch,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getMonthlyFeaturedEvents,
  getTournamentDday,
  getUpcomingRegistrationEvents,
} from '@/lib/tournamentCalendarData';

export default function Home() {
  const { user, signInWithKakao, isLoading, systemMessage } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const CURRENT_VERSION = 'v5.0 Guest Fix';
  const featuredEvents = getMonthlyFeaturedEvents(new Date(), 3);
  const upcomingRegistrationEvents = getUpcomingRegistrationEvents(new Date(), 2);

  useEffect(() => {
    setIsMounted(true);

    const savedVersion = localStorage.getItem('teyeon_pwa_version');
    if (savedVersion && savedVersion !== CURRENT_VERSION) {
      console.log(`[PWA] Version Mismatch: ${savedVersion} -> ${CURRENT_VERSION}. Forcing hard sync.`);
      localStorage.setItem('teyeon_pwa_version', CURRENT_VERSION);
      window.location.reload();
    } else {
      localStorage.setItem('teyeon_pwa_version', CURRENT_VERSION);
    }

    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const MenuCard = ({
    label,
    description,
    icon,
    path,
    comingSoon,
    badge,
  }: {
    label: string;
    description?: string;
    icon: React.ReactNode;
    path: string;
    comingSoon?: boolean;
    badge?: string;
  }) => (
    <Link
      href={path}
      className={`relative flex h-[160px] flex-col items-center justify-center gap-3 rounded-[24px] border border-[#D8BE78]/12 bg-[#242323]/95 px-3 shadow-[0_10px_28px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:bg-[#2B2926] active:scale-[0.98] group ${comingSoon ? 'opacity-85' : ''}`}
    >
      {comingSoon && (
        <span className="absolute right-4 top-4 rounded-full border border-[#FF8A8A]/35 bg-[#3A2424] px-[10px] py-[4px] text-[9px] font-[1000] tracking-[0.08em] text-[#FF8A8A] shadow-[0_0_14px_rgba(239,68,68,0.18)]">
          COMING SOON
        </span>
      )}
      {badge && !comingSoon && (
        <span className="absolute right-4 top-4 rounded-full border border-[#D8BE78]/40 bg-[#D8BE78]/16 px-[10px] py-[4px] text-[9px] font-[1000] tracking-[0.12em] text-[#E1C982] shadow-[0_0_12px_rgba(216,190,120,0.12)]">
          {badge}
        </span>
      )}
      <div className="text-[#D8BE78] drop-shadow-[0_2px_10px_rgba(216,190,120,0.24)] transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110">
        {icon}
      </div>
      <span className="px-2 text-center text-[16px] font-bold tracking-wide text-[#F1E7C4]">
        {label}
      </span>
      {description && (
        <span className="line-clamp-2 text-center text-[10px] font-bold leading-snug text-[#B8B0A0]/65">
          {description}
        </span>
      )}
    </Link>
  );

  if (!isMounted) return null;

  return (
    <main
      className="relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col items-center overflow-x-hidden bg-[#181816] px-5 pt-0"
      style={{ paddingBottom: '250px' }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col items-center">
        {isLoading && (
          <div className="flex w-full animate-pulse flex-col gap-6">
            <div className="mb-2 h-[60px] w-full rounded-xl border border-[#D8BE78]/10 bg-[#242323]/60" />
            <div className="grid w-full grid-cols-2 gap-6">
              {[...Array(6)].map((_, index) => (
                <div
                  key={index}
                  className="h-[160px] rounded-[24px] border border-[#D8BE78]/10 bg-[#242323]/70 shadow-[0_4px_12px_rgba(216,190,120,0.06)] backdrop-blur-md"
                />
              ))}
            </div>
          </div>
        )}

        {!isLoading && !user && (
          <div className="relative mt-6 flex min-h-[40vh] w-full flex-col items-center justify-center overflow-hidden rounded-[32px] border border-[#D8BE78]/12 bg-gradient-to-b from-[#242323]/95 to-[#191917]/90 px-6 py-12 shadow-[0_20px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
            <div className="absolute top-0 h-[1px] w-full bg-gradient-to-r from-transparent via-[#D8BE78]/45 to-transparent" />
            <p className="mb-12 text-center font-['Rajdhani',sans-serif] text-[16px] font-[900] tracking-[0.2em] text-[#F1E7C4] drop-shadow-md">
              TEYEON에 오신 것을 환영합니다
            </p>
            <button
              onClick={() => signInWithKakao()}
              className="flex w-full max-w-[320px] items-center justify-center gap-4 rounded-full border border-[#D8BE78]/35 bg-gradient-to-r from-[#25231F] to-[#1B1A18] py-5 font-['Rajdhani',sans-serif] text-[15px] font-[1000] tracking-widest text-[#E1C982] shadow-[0_8px_30px_rgba(0,0,0,0.55),inset_0_0_20px_rgba(216,190,120,0.06)] transition-all hover:-translate-y-1 hover:border-[#D8BE78]/75 hover:shadow-[0_15px_40px_rgba(216,190,120,0.18)] active:scale-[0.98]"
            >
              카카오 계정으로 접속
            </button>
            <span className="mt-8 font-['Rajdhani',sans-serif] text-[10px] font-bold uppercase tracking-widest text-[#A8A39A]">
              Authorized Personnel Only
            </span>
          </div>
        )}

        {!isLoading && user && (
          <>
            <div className="mt-6 grid w-full animate-in grid-cols-2 gap-6 duration-700 slide-in-from-bottom-4">
              <MenuCard
                label="대회 캘린더"
                description="월별 대회 일정과 참가/파트너 현황을 확인합니다."
                icon={<CalendarDays size={36} strokeWidth={1.5} />}
                path="/tournament-calendar"
                badge="CALENDAR"
              />
              <MenuCard
                label="멤버 프로필"
                icon={<Users size={36} strokeWidth={1.5} />}
                path="/members"
              />
              <MenuCard
                label="스페셜 매치"
                icon={<Layout size={36} strokeWidth={1.5} />}
                path="/special"
                badge="MANUAL"
              />
              <MenuCard
                label="대진 생성"
                icon={<Swords size={36} strokeWidth={1.5} />}
                path="/kdk"
                badge="KDK"
              />
              <MenuCard
                label="클럽 재무"
                icon={<CircleDollarSign size={36} strokeWidth={1.5} />}
                path="/finance"
                comingSoon
              />
              <MenuCard
                label="관리자 설정"
                description="멤버, 권한, 운영 기준을 관리합니다."
                icon={<Settings size={36} strokeWidth={1.5} />}
                path="/admin"
                badge="ADMIN"
              />
            </div>

            <section className="mt-8 w-full overflow-hidden rounded-[28px] border border-[#D8BE78]/18 bg-[#242323]/92 shadow-[0_18px_42px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-center justify-between gap-3 border-b border-[#D8BE78]/12 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-[1000] uppercase tracking-[0.28em] text-[#D8BE78]/65">
                    TEYEON MINI BOARD
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[9px] font-[1000] uppercase tracking-[0.16em] text-emerald-200">
                  BOARD
                </span>
              </div>

              <div className="divide-y divide-white/8">
                <MiniBoardLine
                  label="UP NEXT"
                  icon={<Trophy size={14} />}
                  href="/tournament-calendar"
                  value={
                    featuredEvents[0]
                      ? `${featuredEvents[0].date.slice(5).replace('-', '/')} ${featuredEvents[0].title}`
                      : '이번 달 등록된 주요 대회 없음'
                  }
                  meta={
                    featuredEvents[0]
                      ? `${featuredEvents[0].organizer} · ${featuredEvents[0].division}${featuredEvents[0].grade ? ` · ${featuredEvents[0].grade}` : ''}`
                      : 'CALENDAR'
                  }
                />
                <MiniBoardLine
                  label="ALERT"
                  icon={<Clock size={14} />}
                  href="/tournament-calendar"
                  value={
                    upcomingRegistrationEvents.length > 0
                      ? `접수 임박 ${upcomingRegistrationEvents.length}건`
                      : '접수 임박 일정 없음'
                  }
                  meta={
                    upcomingRegistrationEvents[0]
                      ? `${getTournamentDday(upcomingRegistrationEvents[0].registrationStart)} · ${upcomingRegistrationEvents[0].title}`
                      : 'TOURNAMENT'
                  }
                />
                <MiniBoardLine
                  label="KDK"
                  icon={<ClipboardList size={14} />}
                  href="/archive"
                  value="최근 KDK 결과는 Archive에서 확인"
                  meta="다음 KDK 준비 중"
                />
              </div>
            </section>

            <div className="h-8 w-full shrink-0" />

            <div className="h-8 w-full shrink-0" />
          </>
        )}

        <div className="h-12 w-full shrink-0" />
      </div>

      {(toast || systemMessage) && (
        <div className="fixed bottom-[115px] left-1/2 z-[2000] w-[92%] max-w-[420px] -translate-x-1/2 rounded-xl bg-[#D8BE78] p-[16px] text-center font-['Rajdhani',sans-serif] text-[14px] font-black tracking-wider text-black shadow-[0_20px_50px_rgba(0,0,0,0.65)]">
          {toast || systemMessage}
        </div>
      )}
    </main>
  );
}

function MiniBoardLine({
  label,
  icon,
  value,
  meta,
  href,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  meta: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="grid min-w-0 grid-cols-[68px_minmax(0,1fr)_auto] items-center gap-2 px-4 py-3 transition hover:bg-white/[0.035] active:scale-[0.99]"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-[1000] uppercase tracking-[0.12em] text-[#D8BE78]">
        {icon}
        {label}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-[1000] text-[#F1E7C4]">{value}</p>
        <p className="mt-0.5 truncate text-[10px] font-bold text-white/42">{meta}</p>
      </div>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#D8BE78]/70 shadow-[0_0_12px_rgba(216,190,120,0.45)]" />
    </Link>
  );
}
