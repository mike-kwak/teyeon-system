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

            <section className="mt-8 w-full rounded-[28px] border border-[#D8BE78]/14 bg-[#242323]/92 p-5 shadow-[0_18px_42px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-[1000] uppercase tracking-[0.3em] text-[#D8BE78]/65">
                    TEYEON MINI BOARD
                  </p>
                  <h2 className="mt-1 text-[18px] font-[1000] tracking-[-0.03em] text-[#F1E7C4]">
                    이번 달 운영 메모
                  </h2>
                </div>
                <Link
                  href="/tournament-calendar"
                  className="shrink-0 rounded-full border border-[#D8BE78]/28 bg-[#D8BE78]/10 px-3 py-1.5 text-[10px] font-[1000] uppercase tracking-[0.12em] text-[#E1C982] active:scale-95"
                >
                  전체 보기
                </Link>
              </div>

              <div className="space-y-3">
                <div className="rounded-[20px] border border-white/8 bg-black/18 p-3">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-[1000] uppercase tracking-[0.16em] text-[#D8BE78]">
                    <Trophy size={14} />
                    이번 달 주요 대회
                  </div>
                  <div className="space-y-2">
                    {featuredEvents.map((event) => (
                      <Link
                        key={event.id}
                        href="/tournament-calendar"
                        className="flex min-w-0 items-center justify-between gap-3 rounded-[14px] bg-white/[0.035] px-3 py-2 active:scale-[0.99]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-[1000] text-[#F1E7C4]">{event.title}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-white/40">
                            {event.organizer} · {event.division}{event.grade ? ` · ${event.grade}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-[#D8BE78]/12 px-2 py-1 text-[10px] font-[1000] text-[#E1C982]">
                          {event.date.slice(5).replace('-', '.')}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[18px] border border-white/8 bg-black/16 p-3">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-[1000] uppercase tracking-[0.14em] text-white/45">
                      <Clock size={13} />
                      접수 임박
                    </div>
                    <div className="space-y-1.5">
                      {upcomingRegistrationEvents.map((event) => (
                        <p key={event.id} className="truncate text-[11px] font-bold text-white/70">
                          {getTournamentDday(event.registrationStart)} · {event.title}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-white/8 bg-black/16 p-3">
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-[1000] uppercase tracking-[0.14em] text-white/45">
                      <ClipboardList size={13} />
                      운영 메모
                    </div>
                    <p className="text-[11px] font-bold leading-snug text-white/65">
                      진행 중 KDK는 LIVE COURT에서 확인
                    </p>
                    <p className="mt-1 text-[11px] font-bold leading-snug text-[#D8BE78]/75">
                      최근 KDK 1등 기록은 Archive 연동 예정
                    </p>
                  </div>
                </div>

                <div className="rounded-[18px] border border-[#D8BE78]/14 bg-[#D8BE78]/7 p-3">
                  <div className="flex items-center gap-2 text-[10px] font-[1000] uppercase tracking-[0.14em] text-[#D8BE78]">
                    <UserRoundSearch size={13} />
                    파트너 구함
                  </div>
                  <p className="mt-2 truncate text-[12px] font-bold text-[#F1E7C4]/82">
                    {featuredEvents.flatMap((event) => event.lookingForPartners).slice(0, 4).join(', ') || '현재 파트너 희망자 없음'}
                  </p>
                </div>
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
