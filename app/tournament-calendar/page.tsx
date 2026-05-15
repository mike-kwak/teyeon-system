'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  X,
  UsersRound,
} from 'lucide-react';
import {
  formatTournamentDate,
  getTournamentDday,
  parseTournamentDate,
  TournamentEvent,
  TournamentPair,
  tournamentEvents,
} from '@/lib/tournamentCalendarData';
import {
  deleteTournamentEvent,
  fetchTournamentEvents,
  saveTournamentEvent,
  TournamentEventInput,
} from '@/lib/tournamentCalendarService';
import { useAuth } from '@/context/AuthContext';
import ProfileAvatar from '@/components/ProfileAvatar';

const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

const organizerStyle: Record<TournamentEvent['organizer'], { badge: string; chip: string; pill: string; accent: string }> = {
  KATO: {
    badge: 'KATO',
    chip: 'border-amber-300 bg-amber-50 text-amber-700',
    pill: 'border-amber-200 bg-amber-50/80 text-amber-800',
    accent: 'bg-amber-400',
  },
  KATA: {
    badge: 'KATA',
    chip: 'border-sky-300 bg-sky-50 text-sky-700',
    pill: 'border-sky-200 bg-sky-50/80 text-sky-800',
    accent: 'bg-sky-400',
  },
  KTA: {
    badge: 'KTA',
    chip: 'border-rose-300 bg-rose-50 text-rose-700',
    pill: 'border-rose-200 bg-rose-50/80 text-rose-800',
    accent: 'bg-rose-400',
  },
  지역대회: {
    badge: 'LOCAL',
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    pill: 'border-emerald-200 bg-emerald-50/80 text-emerald-800',
    accent: 'bg-emerald-400',
  },
  비랭킹: {
    badge: 'NON-RANK',
    chip: 'border-slate-300 bg-slate-100 text-slate-600',
    pill: 'border-slate-200 bg-slate-50 text-slate-700',
    accent: 'bg-slate-400',
  },
};

const statusStyle: Record<TournamentEvent['status'], string> = {
  접수예정: 'border-amber-200 bg-amber-50 text-amber-700',
  접수중: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  접수종료: 'border-slate-200 bg-slate-100 text-slate-500',
  대회진행중: 'border-rose-200 bg-rose-50 text-rose-700',
  대회종료: 'border-slate-200 bg-slate-50 text-slate-400',
  대회취소: 'border-rose-200 bg-rose-50 text-rose-700',
};

const resultStyle = {
  우승: 'border-amber-300 bg-amber-50 text-amber-800',
  준우승: 'border-slate-300 bg-slate-100 text-slate-700',
  Finalist: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  취소: 'border-rose-200 bg-rose-50 text-rose-700',
  X: 'border-rose-200 bg-rose-50 text-rose-700',
  default: 'border-slate-200 bg-white text-slate-600',
};

const organizerOptions: TournamentEvent['organizer'][] = ['KATO', 'KATA', 'KTA', '지역대회', '비랭킹'];
const divisionOptions: TournamentEvent['division'][] = ['신인부', '오픈부', '단체전', '기타'];
const gradeOptions = ['', 'MA', 'A', '1', '2', '3', '비랭킹'];
const statusOptions: TournamentEvent['status'][] = ['접수예정', '접수중', '접수종료', '대회진행중', '대회종료', '대회취소'];
const resultOptions: Array<TournamentPair['result'] | ''> = ['', '예정', '64', '32', '16', '8', 'Finalist', '준우승', '우승', '취소', 'X'];

function canManageTournamentCalendar(role?: string | null) {
  return role === 'CEO' || role === 'ADMIN' || role === 'TOURNAMENT_MANAGER' || role === 'CALENDAR_MANAGER';
}

function pairLabel(pair: TournamentPair) {
  return `${pair.player1} / ${pair.player2}`;
}

function hasResult(pair: TournamentPair) {
  return Boolean(pair.result && pair.result !== '예정');
}

function resultBadgeClass(result?: TournamentPair['result']) {
  if (!result || result === '예정') return 'border-slate-200 bg-slate-50 text-slate-500';
  return resultStyle[result as keyof typeof resultStyle] || resultStyle.default;
}

function monthDayLabel(date: string) {
  const parsed = parseTournamentDate(date);
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function monthLabel(date: Date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function pickInitialEvent(events: TournamentEvent[]) {
  const today = new Date();
  const todayTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const upcoming = events
    .filter((event) => parseTournamentDate(event.date).getTime() >= todayTime)
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] || events[0] || null;
}

function toEditorInput(event?: TournamentEvent | null): TournamentEventInput {
  return {
    id: event?.id,
    title: event?.title || '',
    date: event?.date || dateKey(new Date()),
    venue: event?.venue || '',
    organizer: event?.organizer || 'KATO',
    division: event?.division || '신인부',
    grade: event?.grade || '',
    registrationStart: event?.registrationStart || '',
    status: event?.status || '접수예정',
    memo: event?.memo || '',
    pairs: event?.pairs?.length
      ? event.pairs.map((pair) => ({
          id: pair.id,
          player1: pair.player1,
          player2: pair.player2,
          result: pair.result,
        }))
      : [{ player1: '', player2: '', result: undefined }],
    partnerRequests: event?.partnerRequests?.length
      ? event.partnerRequests.map((request) => ({
          id: request.id,
          name: request.name,
          memo: request.memo || '',
        }))
      : (event?.lookingForPartners || []).map((name) => ({ name, memo: '' })),
  };
}

function buildCalendarCells(currentMonth: Date) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const cells: Array<{ date: Date; inMonth: boolean }> = [];

  for (let index = firstDay.getDay(); index > 0; index -= 1) {
    cells.push({ date: new Date(year, month, 1 - index), inMonth: false });
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    cells.push({ date: new Date(year, month, day), inMonth: true });
  }

  while (cells.length % 7 !== 0 || cells.length < 35) {
    const nextIndex = cells.length - firstDay.getDay() + 1;
    cells.push({ date: new Date(year, month, nextIndex), inMonth: false });
  }

  return cells;
}

function EventPill({ event, onClick }: { event: TournamentEvent; onClick: () => void }) {
  const style = organizerStyle[event.organizer];
  const dday = getTournamentDday(event.registrationStart);
  const isCanceled = event.status === '대회취소';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full overflow-hidden rounded-xl border ${isCanceled ? 'border-rose-200 bg-rose-50/80 text-rose-800' : style.pill} text-left shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.02] transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]`}
    >
      <span className={`w-1.5 shrink-0 self-stretch ${isCanceled ? 'bg-rose-400' : style.accent}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 overflow-visible">
          <span className="inline-flex min-w-fit shrink-0 whitespace-nowrap overflow-visible text-[9px] font-[1000] uppercase tracking-[0.08em]">{style.badge}</span>
          <span className="min-w-0 truncate text-[12px] font-[1000] leading-tight text-slate-950 xl:text-[13px]">{event.title}</span>
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[10px] font-bold text-slate-600">
          <span className="truncate">
            {event.division}
            {event.grade ? ` · ${event.grade}` : ''}
          </span>
          {isCanceled && <span className="shrink-0 text-rose-700">대회취소</span>}
          {dday && <span className="shrink-0 text-amber-700">{dday}</span>}
        </div>
      </div>
    </button>
  );
}

export default function TournamentCalendarPage() {
  const { user, role, isLoading } = useAuth();
  const isAdmin = canManageTournamentCalendar(role);
  const [events, setEvents] = useState<TournamentEvent[]>(tournamentEvents);
  const [dataSource, setDataSource] = useState<'db' | 'demo'>('demo');
  const [dataMessage, setDataMessage] = useState('');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<TournamentEvent | null>(() => pickInitialEvent(tournamentEvents));
  const [openInfoSections, setOpenInfoSections] = useState({
    summary: true,
    upcoming: false,
    pairStatus: false,
    results: false,
    partnerRequests: false,
  });
  const [isMonthlySheetOpen, setIsMonthlySheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TournamentEvent | null>(null);
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);

  const loadEvents = async () => {
    try {
      const dbEvents = await fetchTournamentEvents();
      if (dbEvents.length > 0) {
        setEvents(dbEvents);
        setDataSource('db');
        setDataMessage('');
        return dbEvents;
      } else {
        setEvents(tournamentEvents);
        setDataSource('demo');
        setDataMessage('DB에 등록된 대회가 없어 더미 데이터를 표시 중입니다.');
        return tournamentEvents;
      }
    } catch (error) {
      console.warn('[Tournament Calendar] DB fetch failed. Using demo data.', error);
      setEvents(tournamentEvents);
      setDataSource('demo');
      setDataMessage('DB 연결 전까지 더미 데이터를 표시 중입니다.');
      return tournamentEvents;
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    setSelectedEvent((prev) => {
      if (prev) {
        const updated = events.find((event) => event.id === prev.id);
        if (updated) return updated;
      }
      return pickInitialEvent(events);
    });
  }, [events]);

  const cells = useMemo(() => buildCalendarCells(currentMonth), [currentMonth]);
  const eventsByDate = useMemo(() => {
    return events.reduce<Record<string, TournamentEvent[]>>((acc, event) => {
      acc[event.date] = [...(acc[event.date] || []), event].sort((a, b) => a.title.localeCompare(b.title));
      return acc;
    }, {});
  }, [events]);

  const monthEvents = useMemo(() => {
    return events
      .filter((event) => {
        const date = parseTournamentDate(event.date);
        return date.getFullYear() === currentMonth.getFullYear() && date.getMonth() === currentMonth.getMonth();
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [currentMonth, events]);

  const monthEventsByDate = useMemo(() => {
    return monthEvents.reduce<Array<{ date: string; events: TournamentEvent[] }>>((acc, event) => {
      const existing = acc.find((item) => item.date === event.date);
      if (existing) {
        existing.events.push(event);
      } else {
        acc.push({ date: event.date, events: [event] });
      }
      return acc;
    }, []);
  }, [monthEvents]);

  const monthSummary = useMemo(() => {
    const organizerCounts = monthEvents.reduce<Partial<Record<TournamentEvent['organizer'], number>>>((acc, event) => {
      acc[event.organizer] = (acc[event.organizer] || 0) + 1;
      return acc;
    }, {});
    const openCount = monthEvents.filter((event) => event.status === '접수중').length;
    const partnerCount = monthEvents.reduce((sum, event) => sum + event.lookingForPartners.length, 0);

    return {
      organizerCounts,
      openCount,
      partnerCount,
      total: monthEvents.length,
    };
  }, [monthEvents]);

  const upcomingRegistrations = useMemo(() => {
    const now = new Date();
    return events
      .filter((event) => event.registrationStart)
      .map((event) => ({ event, dday: getTournamentDday(event.registrationStart, now) }))
      .filter(({ dday }) => dday && !dday.startsWith('D+'))
      .sort((a, b) => (a.event.registrationStart || '').localeCompare(b.event.registrationStart || ''))
      .slice(0, 4);
  }, [events]);

  const monthlyPairStatus = useMemo(() => {
    return monthEvents
      .filter((event) => event.pairs.some((pair) => !hasResult(pair)))
      .map((event) => ({
        event,
        plannedPairs: event.pairs.filter((pair) => !hasResult(pair)),
      }));
  }, [monthEvents]);

  const monthlyPartnerRequests = useMemo(() => {
    return monthEvents
      .filter((event) => event.lookingForPartners.length > 0)
      .map((event) => ({
        event,
        lookingForPartners: event.lookingForPartners,
      }));
  }, [monthEvents]);

  const monthlyResultPairs = useMemo(() => {
    return monthEvents
      .flatMap((event) =>
        event.pairs
          .filter(hasResult)
          .map((pair) => ({
            event,
            pair,
          }))
      )
      .slice(0, 8);
  }, [monthEvents]);

  const moveMonth = (offset: number) => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  };

  const toggleInfoSection = (section: keyof typeof openInfoSections) => {
    setOpenInfoSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const shareSelectedEvent = async () => {
    if (!selectedEvent) return;
    const text = [
      `[TEYEON 대회 캘린더] ${selectedEvent.title}`,
      `일자: ${formatTournamentDate(selectedEvent.date)}`,
      `장소: ${selectedEvent.venue}`,
      `주관: ${selectedEvent.organizer}`,
      `부서: ${selectedEvent.division}${selectedEvent.grade ? ` / ${selectedEvent.grade}` : ''}`,
      `접수: ${selectedEvent.registrationStart ? formatTournamentDate(selectedEvent.registrationStart) : '미정'} (${selectedEvent.status})`,
      `참가 예정: ${selectedEvent.pairs.length}팀`,
      ...(selectedEvent.lookingForPartners.length > 0 ? [`파트너 구함: ${selectedEvent.lookingForPartners.length}명`] : []),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      alert('대회 정보가 복사되었습니다. 카카오톡 채팅방에 붙여넣기 해주세요.');
    } catch {
      alert(text);
    }
  };

  const openCreateEditor = () => {
    setEditingEvent(null);
    setIsEditorOpen(true);
  };

  const openEditEditor = () => {
    if (!selectedEvent) return;
    setEditingEvent(selectedEvent);
    setIsEditorOpen(true);
  };

  const handleSaveEvent = async (input: TournamentEventInput) => {
    if (!isAdmin) return;
    if (!input.title.trim()) {
      alert('대회명을 입력해 주세요.');
      return;
    }
    if (!input.date) {
      alert('대회일을 입력해 주세요.');
      return;
    }

    setIsSavingEvent(true);
    try {
      const savedId = await saveTournamentEvent(input, user?.id);
      const nextEvents = await loadEvents();
      setSelectedEvent(nextEvents.find((event) => event.id === savedId) || pickInitialEvent(nextEvents));
      setIsEditorOpen(false);
      setEditingEvent(null);
      alert('대회 일정이 저장되었습니다.');
    } catch (error) {
      console.error('[Tournament Calendar] Save failed', error);
      alert('대회 저장에 실패했습니다. Supabase schema 적용 여부를 확인해 주세요.');
    } finally {
      setIsSavingEvent(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!isAdmin) return;
    const ok = window.confirm('정말 이 대회를 삭제할까요? 실제 대회 취소는 삭제 대신 상태를 대회취소로 변경하는 것을 권장합니다.');
    if (!ok) return;

    setIsDeletingEvent(true);
    try {
      await deleteTournamentEvent(eventId);
      const nextEvents = await loadEvents();
      setSelectedEvent(pickInitialEvent(nextEvents));
      setIsEditorOpen(false);
      setEditingEvent(null);
      alert('대회가 삭제되었습니다.');
    } catch (error) {
      console.error('[Tournament Calendar] Delete failed', error);
      alert('대회 삭제에 실패했습니다.');
    } finally {
      setIsDeletingEvent(false);
    }
  };

  return (
    <main className="fixed bottom-0 left-1/2 top-0 z-[120] w-screen -translate-x-1/2 overflow-y-auto !bg-[#f5f6f8] text-slate-900 lg:z-[9999] lg:flex lg:justify-center">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-3 px-3 py-3 pb-[calc(210px+env(safe-area-inset-bottom))] sm:px-6 lg:mx-0 lg:gap-4 lg:px-6 lg:py-4 lg:pb-8 xl:px-8">
        <header className="rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.08)] lg:rounded-3xl lg:p-5">
          <div className="mb-4 hidden items-center justify-between border-b border-slate-100 pb-3 lg:flex">
            <Link href="/" className="flex items-center gap-3">
              <div>
                <p className="text-[24px] font-[1000] italic leading-none tracking-[-0.06em] text-slate-950">TEYEON</p>
                <p className="mt-1 text-[10px] font-[1000] uppercase tracking-[0.22em] text-amber-700">Tournament Calendar</p>
              </div>
            </Link>

            {user && !isLoading && (
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-[1000] uppercase tracking-[0.16em] text-amber-700">
                  {role === 'CEO' ? 'CEO' : (role || 'GUEST')}
                </span>
                <Link href="/profile" className="shrink-0">
                  <ProfileAvatar
                    src={user.user_metadata?.avatar_url || user.user_metadata?.picture}
                    alt={user.user_metadata?.full_name}
                    size={36}
                    fallbackIcon={role === 'CEO' ? 'T' : 'U'}
                    className="rounded-full border-2 border-amber-200 shadow-sm"
                  />
                </Link>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Link
                href="/"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:bg-slate-100 active:scale-95 lg:h-10 lg:w-10"
                aria-label="홈으로"
              >
                <ArrowLeft size={18} />
              </Link>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[9px] font-[1000] uppercase tracking-[0.18em] text-amber-700 lg:hidden">
                    TEYEON
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:hidden">Tournament Calendar</span>
                </div>
                <h1 className="mt-1 text-[24px] font-[1000] tracking-[-0.05em] text-slate-950 sm:text-[34px] lg:mt-2 lg:text-[38px]">
                  대회 캘린더
                </h1>
                <p className="mt-1 hidden max-w-3xl text-[13px] font-semibold leading-relaxed text-slate-500 sm:block">
                  월별 대회 일정과 출전 페어, 성적 현황을 한 화면에서 확인합니다.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end lg:gap-2">
              <div className="flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 lg:h-10 lg:gap-2 lg:px-3">
                <CalendarDays size={15} className="text-amber-600" />
                <span className="text-[12px] font-[1000] text-slate-900 lg:text-[13px]">{monthLabel(currentMonth)}</span>
              </div>
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 lg:h-10 lg:w-10"
                aria-label="이전 달"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => setCurrentMonth(new Date())}
                className="h-9 rounded-full border border-amber-300 bg-amber-50 px-3 text-[10px] font-[1000] uppercase tracking-[0.1em] text-amber-700 shadow-sm transition hover:bg-amber-100 active:scale-95 lg:h-10 lg:px-4 lg:text-[11px]"
              >
                이번 달
              </button>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 lg:h-10 lg:w-10"
                aria-label="다음 달"
              >
                <ChevronRight size={18} />
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={openCreateEditor}
                  className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-3 text-[10px] font-[1000] uppercase tracking-[0.1em] text-slate-950 shadow-sm transition hover:border-amber-400 hover:bg-amber-100 active:scale-95 lg:h-10 lg:gap-2 lg:px-4 lg:text-[11px]"
                  style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a' }}
                >
                  <Plus size={14} className="shrink-0" style={{ color: '#b45309', stroke: '#b45309' }} />
                  <span className="inline-block text-slate-950" style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a' }}>
                    <span className="sm:hidden">등록</span>
                    <span className="hidden sm:inline">+ 대회 등록</span>
                  </span>
                </button>
              )}
              <div className="ml-auto flex w-[116px] rounded-full border border-slate-200 bg-slate-50 p-0.5 lg:hidden">
                {(['list', 'calendar'] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`h-7 flex-1 rounded-full text-[10px] font-[1000] transition ${
                      viewMode === mode
                        ? 'bg-slate-950 text-white shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    {mode === 'list' ? '리스트' : '월간'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 hidden flex-wrap items-center gap-2 border-t border-slate-100 pt-3 lg:flex">
            <span className="mr-1 text-[10px] font-[1000] uppercase tracking-[0.18em] text-slate-400">Organizer</span>
            {Object.entries(organizerStyle).map(([key, style]) => (
              <span key={key} className={`rounded-full border px-2.5 py-1 text-[9px] font-[1000] uppercase tracking-[0.1em] ${style.chip}`}>
                {style.badge}
              </span>
            ))}
            <span className="ml-auto rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-[1000] uppercase tracking-[0.12em] text-slate-500">
              {dataSource === 'db' ? 'DB LIVE' : 'DEMO FALLBACK'}
            </span>
          </div>
          {dataMessage && (
            <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
              {dataMessage}
            </p>
          )}
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className={`${viewMode === 'list' ? 'block' : 'hidden'} min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:hidden`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-[1000] uppercase tracking-[0.18em] text-amber-600">Monthly List</p>
                <h2 className="mt-0.5 text-[20px] font-[1000] tracking-[-0.04em] text-slate-950">{monthLabel(currentMonth)}</h2>
              </div>
              <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[9px] font-[1000] text-amber-700">
                {monthEvents.length} events
              </span>
            </div>

            {monthEventsByDate.length > 0 ? (
              <div className="space-y-2.5">
                {monthEventsByDate.map(({ date, events }) => (
                  <div key={date} className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[12px] font-[1000] text-slate-900">{formatTournamentDate(date)}</p>
                      <span className="text-[10px] font-bold text-slate-400">{events.length}개 대회</span>
                    </div>
                    <div className="space-y-1.5">
                      {events.map((event) => (
                        <EventPill key={event.id} event={event} onClick={() => setSelectedEvent(event)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center text-[13px] font-bold text-slate-400">
                이번 달 등록된 대회가 없습니다.
              </div>
            )}
          </div>

          <div className={`${viewMode === 'calendar' ? 'block' : 'hidden'} min-w-0 overflow-x-auto rounded-3xl lg:block lg:overflow-visible`}>
            <div className="min-w-[900px] rounded-3xl border border-slate-300 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.08)] lg:min-w-0 xl:p-4">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <p className="text-[10px] font-[1000] uppercase tracking-[0.18em] text-amber-700">Monthly Board</p>
                <h2 className="mt-0.5 text-[18px] font-[1000] tracking-[-0.04em] text-slate-950">{monthLabel(currentMonth)} 일정</h2>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-[1000] text-slate-500">
                {monthEvents.length} events
              </span>
            </div>
            <div className="grid grid-cols-7 gap-2 border-b border-slate-200 pb-3 text-center text-[11px] font-[1000] uppercase tracking-[0.16em] xl:gap-3">
              {weekDays.map((day, index) => (
                <div
                  key={day}
                  className={`rounded-xl border border-slate-300 bg-slate-100/80 py-2 ${
                    index === 0 ? 'text-rose-500' : index === 6 ? 'text-sky-500' : 'text-slate-600'
                  }`}
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-7 gap-2 xl:gap-3">
              {cells.map(({ date, inMonth }) => {
                const key = dateKey(date);
                const dayEvents = eventsByDate[key] || [];
                const visibleEvents = dayEvents.slice(0, 3);
                const hiddenCount = Math.max(0, dayEvents.length - visibleEvents.length);
                const isToday = key === dateKey(new Date());
                const isSelectedDate = selectedEvent?.date === key;
                const dayOfWeek = date.getDay();

                return (
                  <div
                    key={key}
                    className={`min-h-[126px] rounded-2xl border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition xl:min-h-[138px] ${
                      inMonth ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50/80 opacity-60'
                    } ${isToday ? 'ring-2 ring-amber-300' : ''} ${isSelectedDate ? 'border-amber-300 bg-amber-50/55' : ''}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-1">
                      <span
                        className={`text-[14px] font-[1000] ${
                          isToday
                            ? 'text-amber-700'
                            : dayOfWeek === 0
                              ? 'text-rose-500'
                              : dayOfWeek === 6
                                ? 'text-sky-500'
                                : inMonth
                                  ? 'text-slate-800'
                                  : 'text-slate-300'
                        }`}
                      >
                        {date.getDate()}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-[1000] text-amber-700">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {visibleEvents.map((event) => (
                        <EventPill key={event.id} event={event} onClick={() => setSelectedEvent(event)} />
                      ))}
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedEvent(dayEvents[3])}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[10px] font-[1000] text-slate-500 transition hover:bg-slate-100"
                        >
                          +{hiddenCount} 더보기
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </div>

          <aside className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:space-y-4 lg:self-start">
            <div className="rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.08)] lg:rounded-3xl lg:p-5">
              {selectedEvent ? (
                <div className="flex flex-col gap-3 lg:gap-5">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2 lg:mb-3 lg:gap-2 lg:pb-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-[1000] uppercase tracking-[0.12em] lg:px-3 lg:py-1 lg:text-[10px] ${organizerStyle[selectedEvent.organizer].chip}`}>
                        {selectedEvent.organizer}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-[1000] lg:px-3 lg:py-1 lg:text-[10px] ${statusStyle[selectedEvent.status]}`}>
                        {selectedEvent.status}
                      </span>
                    </div>
                    <h2 className="text-[21px] font-[1000] leading-tight tracking-[-0.04em] text-slate-950 lg:text-[26px]">
                      {selectedEvent.title}
                    </h2>
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-500 lg:mt-2 lg:gap-2 lg:text-[12px]">
                      <MapPin size={13} className="shrink-0 lg:size-[14px]" />
                      {selectedEvent.venue}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 lg:gap-3">
                    <InfoBox label="일자" value={formatTournamentDate(selectedEvent.date)} />
                    <InfoBox label="부서" value={`${selectedEvent.division}${selectedEvent.grade ? ` / ${selectedEvent.grade}` : ''}`} />
                    <InfoBox label="접수 시작" value={selectedEvent.registrationStart ? `${formatTournamentDate(selectedEvent.registrationStart)} · ${getTournamentDday(selectedEvent.registrationStart)}` : '미정'} />
                    <InfoBox
                      label="현황"
                      value={`${selectedEvent.pairs.length}팀${selectedEvent.lookingForPartners.length > 0 ? ` · 파트너 ${selectedEvent.lookingForPartners.length}명` : ''}`}
                    />
                  </div>

                  <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:block">
                    <p className="mb-2 text-[10px] font-[1000] uppercase tracking-[0.18em] text-amber-700">Memo</p>
                    <p className="text-[12px] font-bold leading-relaxed text-slate-600">{selectedEvent.memo || '등록된 메모가 없습니다.'}</p>
                  </div>

                  <div className="hidden lg:block">
                    <ListBlock
                      title="출전 페어"
                      icon={<UsersRound size={14} />}
                      items={selectedEvent.pairs.map((pair) => `${pairLabel(pair)} · ${hasResult(pair) ? pair.result : '참가 예정'}`)}
                      empty="아직 출전 페어가 없습니다."
                    />
                  </div>
                  {selectedEvent.lookingForPartners.length > 0 && (
                    <div className="hidden lg:block">
                      <ListBlock title="파트너 구함" icon={<Search size={14} />} items={selectedEvent.lookingForPartners} empty="현재 파트너 희망자가 없습니다." compact />
                    </div>
                  )}

                  <div className="space-y-2 lg:hidden">
                    <details className="rounded-2xl border border-slate-200 bg-slate-50">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[12px] font-[1000] text-slate-900">
                        <span className="flex items-center gap-2">
                          <UsersRound size={13} className="text-amber-700" />
                          출전 페어
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] text-slate-500">
                          {selectedEvent.pairs.length}팀
                        </span>
                      </summary>
                      <div className="space-y-1.5 border-t border-slate-200 px-3 py-2">
                        {selectedEvent.pairs.length > 0 ? (
                          selectedEvent.pairs.map((pair) => (
                            <p key={`${pair.player1}-${pair.player2}-${pair.result || 'planned'}`} className="rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600">
                              {pairLabel(pair)} · {hasResult(pair) ? pair.result : '참가 예정'}
                            </p>
                          ))
                        ) : (
                          <p className="text-[11px] font-bold text-slate-400">아직 출전 페어가 없습니다.</p>
                        )}
                      </div>
                    </details>
                    {selectedEvent.lookingForPartners.length > 0 && (
                      <details className="rounded-2xl border border-slate-200 bg-slate-50">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[12px] font-[1000] text-slate-900">
                          <span className="flex items-center gap-2">
                            <Search size={13} className="text-amber-700" />
                            파트너 구함
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] text-slate-500">
                            {selectedEvent.lookingForPartners.length}명
                          </span>
                        </summary>
                        <div className="flex flex-wrap gap-1.5 border-t border-slate-200 px-3 py-2">
                          {selectedEvent.lookingForPartners.map((name) => (
                            <span key={name} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600">
                              {name}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={shareSelectedEvent}
                      className="flex h-10 items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 text-[11px] font-[1000] uppercase tracking-[0.12em] text-amber-800 shadow-sm transition hover:bg-amber-100 active:scale-[0.98] lg:h-12 lg:text-[12px] lg:tracking-[0.14em]"
                    >
                      <MessageCircle size={16} />
                      카톡 공유
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={openEditEditor}
                        className="flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 text-[11px] font-[1000] uppercase tracking-[0.12em] text-slate-950 shadow-sm transition hover:bg-slate-100 active:scale-[0.98] lg:h-12 lg:text-[12px] lg:tracking-[0.14em]"
                        style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a' }}
                      >
                        <Edit3 size={15} className="shrink-0" style={{ color: '#475569', stroke: '#475569' }} />
                        <span className="inline-block text-slate-950" style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a' }}>
                          수정
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-16 text-center text-[13px] font-bold text-slate-400">대회를 선택해 주세요.</div>
              )}
            </div>

            <SideInfoCard title="이번 달 요약" open={openInfoSections.summary} onToggle={() => toggleInfoSection('summary')}>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[30px] font-[1000] leading-none text-slate-950">{monthSummary.total}</p>
                  <p className="mt-1.5 text-[12px] font-bold text-slate-500">총 대회 수</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 text-[12px] font-[1000] text-slate-600">
                  <span>접수중 {monthSummary.openCount}개</span>
                  {monthSummary.partnerCount > 0 && (
                    <span className="text-[10px] font-bold text-slate-400">파트너 구함 {monthSummary.partnerCount}명</span>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(organizerStyle).map(([organizer, style]) => {
                  const count = monthSummary.organizerCounts[organizer as TournamentEvent['organizer']] || 0;
                  if (!count) return null;
                  return (
                    <span key={organizer} className={`rounded-full border px-2.5 py-1 text-[10px] font-[1000] ${style.chip}`}>
                      {style.badge} {count}
                    </span>
                  );
                })}
              </div>
            </SideInfoCard>

            <SideInfoCard title="이번 달 출전 결과" open={openInfoSections.results} onToggle={() => toggleInfoSection('results')}>
                {monthlyResultPairs.length > 0 ? (
                  <div className="space-y-2">
                    {monthlyResultPairs.map(({ event, pair }) => (
                      <button
                        type="button"
                        key={`${event.id}-${pair.player1}-${pair.player2}-${pair.result}`}
                        onClick={() => setSelectedEvent(event)}
                        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white hover:shadow-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-[1000] text-slate-950">{pairLabel(pair)}</p>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">{event.title}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-[1000] text-amber-700">
                          {pair.result}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] font-bold text-slate-400">아직 입력된 출전 결과가 없습니다.</p>
                )}
            </SideInfoCard>

            <SideInfoCard title="이번 달 출전 예정" open={openInfoSections.pairStatus} onToggle={() => toggleInfoSection('pairStatus')}>
                {monthlyPairStatus.length > 0 ? (
                  <div className="space-y-3">
                    {monthlyPairStatus.slice(0, 5).map(({ event, plannedPairs }) => (
                      <button
                        type="button"
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white hover:shadow-sm"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-[12px] font-[1000] text-slate-950">{event.title}</p>
                          <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-[1000] text-slate-500">
                            예정 {plannedPairs.length}팀
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-[11px] font-bold leading-relaxed text-slate-600">
                          {plannedPairs.length > 0 ? plannedPairs.map(pairLabel).join(', ') : '참가 예정 없음'}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] font-bold text-slate-400">이번 달 출전 예정 페어가 없습니다.</p>
                )}
            </SideInfoCard>

            <SideInfoCard title="접수 임박" open={openInfoSections.upcoming} onToggle={() => toggleInfoSection('upcoming')}>
              {upcomingRegistrations.length > 0 ? (
                <div className="space-y-2">
                  {upcomingRegistrations.map(({ event, dday }) => (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white hover:shadow-sm"
                    >
                      <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-[1000] text-amber-700">
                        {dday}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-[1000] text-slate-950">{event.title}</p>
                        <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">{formatTournamentDate(event.registrationStart || event.date)} · {event.status}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] font-bold text-slate-400">접수 예정 대회가 없습니다.</p>
              )}
            </SideInfoCard>

            {monthSummary.partnerCount > 0 && (
              <SideInfoCard title="파트너 구함" open={openInfoSections.partnerRequests} onToggle={() => toggleInfoSection('partnerRequests')}>
                <div className="space-y-2">
                  {monthlyPartnerRequests.slice(0, 5).map(({ event, lookingForPartners }) => (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:bg-white hover:shadow-sm"
                    >
                      <p className="truncate text-[12px] font-[1000] text-slate-950">{event.title}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] font-bold text-slate-500">{lookingForPartners.join(', ')}</p>
                    </button>
                  ))}
                </div>
              </SideInfoCard>
            )}

          </aside>
        </section>

        <section className="rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.08)] lg:rounded-3xl lg:p-5">
          <button
            type="button"
            onClick={() => setIsMonthlySheetOpen((prev) => !prev)}
            className="flex min-h-12 w-full flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-left ring-1 ring-slate-200 transition hover:bg-white"
          >
            <div>
              <p className="text-[10px] font-[1000] uppercase tracking-[0.18em] text-amber-700">Monthly Sheet</p>
              <h2 className="mt-0.5 text-[18px] font-[1000] tracking-[-0.04em] text-slate-950 lg:text-[20px]">월간 출전 현황표</h2>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-[1000] text-slate-600">
              {isMonthlySheetOpen ? '현황표 접기' : '현황표 보기'} · {monthEvents.length}개 대회
              <ChevronDown size={16} className={`transition-transform ${isMonthlySheetOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {isMonthlySheetOpen && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="hidden overflow-hidden rounded-2xl border border-slate-300 lg:block">
                <div className="grid grid-cols-[72px_1.15fr_70px_88px_88px_2fr_0.78fr_1.55fr] bg-slate-100 text-[11px] font-[1000] text-slate-700">
                  {['일자', '대회명', '등급', '주관', '부서', '출전 페어', '파트너 구함', '성적'].map((header) => (
                    <div key={header} className="border-r border-slate-300 px-3 py-2 last:border-r-0">
                      {header}
                    </div>
                  ))}
                </div>
                {monthEvents.map((event, index) => {
                  const resultPairs = event.pairs.filter(hasResult);
                  const plannedPairs = event.pairs.filter((pair) => !hasResult(pair));
                  return (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className={`grid w-full grid-cols-[72px_1.15fr_70px_88px_88px_2fr_0.78fr_1.55fr] text-left text-[12px] font-bold text-slate-700 transition hover:bg-amber-50/60 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'}`}
                    >
                      <div className="border-r border-t border-slate-200 px-3 py-2 text-slate-500">{monthDayLabel(event.date)}</div>
                      <div className="min-w-0 border-r border-t border-slate-200 px-3 py-2">
                        <p className="truncate font-[1000] text-slate-950">{event.title}</p>
                      </div>
                      <div className="border-r border-t border-slate-200 px-3 py-2 text-center">{event.grade || '-'}</div>
                      <div className="border-r border-t border-slate-200 px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-[1000] ${organizerStyle[event.organizer].chip}`}>
                          {organizerStyle[event.organizer].badge}
                        </span>
                      </div>
                      <div className="border-r border-t border-slate-200 px-3 py-2">{event.division}</div>
                      <div className="min-w-0 border-r border-t border-slate-200 px-3 py-2">
                        <p className="line-clamp-2 leading-relaxed">
                          {plannedPairs.length > 0 ? plannedPairs.map(pairLabel).join(', ') : '참가 예정 없음'}
                        </p>
                      </div>
                      <div className="min-w-0 border-r border-t border-slate-200 px-3 py-2">
                        <p className="line-clamp-2 leading-relaxed">{event.lookingForPartners.join(', ') || '-'}</p>
                      </div>
                      <div className="border-t border-slate-200 px-3 py-2">
                        {resultPairs.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {resultPairs.map((pair) => (
                              <span key={`${pair.player1}-${pair.player2}-${pair.result}`} className={`rounded-full border px-2 py-0.5 text-[10px] font-[1000] ${resultBadgeClass(pair.result)}`}>
                                {pairLabel(pair)} {pair.result}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400">결과 없음</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3 lg:hidden">
                {monthEvents.map((event) => {
                  const resultPairs = event.pairs.filter(hasResult);
                  const plannedPairs = event.pairs.filter((pair) => !hasResult(pair));
                  return (
                    <button
                      type="button"
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50 p-3 text-left shadow-sm"
                    >
                      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-[1000] text-amber-700">{monthDayLabel(event.date)}</p>
                          <p className="truncate text-[14px] font-[1000] text-slate-950">{event.title}</p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-[1000] ${organizerStyle[event.organizer].chip}`}>
                          {organizerStyle[event.organizer].badge}
                        </span>
                      </div>
                      <div className="space-y-1.5 text-[12px] font-bold text-slate-600">
                        <p><span className="text-slate-400">출전</span> {plannedPairs.map(pairLabel).join(', ') || '참가 예정 없음'}</p>
                        {event.lookingForPartners.length > 0 && (
                          <p className="text-[11px]"><span className="text-slate-400">파트너</span> {event.lookingForPartners.join(', ')}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-slate-400">성적</span>
                          {resultPairs.length > 0 ? resultPairs.map((pair) => (
                            <span key={`${pair.player1}-${pair.player2}-${pair.result}`} className={`rounded-full border px-2 py-0.5 text-[10px] font-[1000] ${resultBadgeClass(pair.result)}`}>
                              {pairLabel(pair)} {pair.result}
                            </span>
                          )) : <span>결과 없음</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        {isEditorOpen && (
          <TournamentEventEditorModal
            event={editingEvent}
            isSaving={isSavingEvent || isDeletingEvent}
            onClose={() => {
              if (isSavingEvent || isDeletingEvent) return;
              setIsEditorOpen(false);
              setEditingEvent(null);
            }}
            onSave={handleSaveEvent}
            onDelete={handleDeleteEvent}
          />
        )}
      </div>
    </main>
  );
}

function TournamentEventEditorModal({
  event,
  isSaving,
  onClose,
  onSave,
  onDelete,
}: {
  event: TournamentEvent | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: TournamentEventInput) => void;
  onDelete: (eventId: string) => void;
}) {
  const [form, setForm] = useState<TournamentEventInput>(() => toEditorInput(event));

  const updateField = <K extends keyof TournamentEventInput>(key: K, value: TournamentEventInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updatePair = (index: number, patch: Partial<TournamentPair>) => {
    setForm((prev) => ({
      ...prev,
      pairs: prev.pairs.map((pair, pairIndex) => (pairIndex === index ? { ...pair, ...patch } : pair)),
    }));
  };

  const updatePartnerRequest = (index: number, patch: { name?: string; memo?: string }) => {
    setForm((prev) => ({
      ...prev,
      partnerRequests: prev.partnerRequests.map((request, requestIndex) =>
        requestIndex === index ? { ...request, ...patch } : request
      ),
    }));
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:items-center">
      <div className="max-h-[calc(100dvh-28px)] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-300 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-[1000] uppercase tracking-[0.2em] text-amber-700">Tournament Editor</p>
            <h2 className="truncate text-[20px] font-[1000] tracking-[-0.04em] text-slate-950">
              {event ? '대회 수정' : '대회 등록'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1 block text-[10px] font-[1000] uppercase tracking-[0.16em] text-slate-500">대회명</span>
              <input
                value={form.title}
                onChange={(e) => updateField('title', e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-[14px] font-bold text-slate-900 outline-none focus:border-amber-400"
                placeholder="예: 보령 머드배"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-[1000] uppercase tracking-[0.16em] text-slate-500">대회일</span>
              <input
                type="date"
                value={form.date}
                onChange={(e) => updateField('date', e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-[13px] font-bold text-slate-900 outline-none focus:border-amber-400"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-[1000] uppercase tracking-[0.16em] text-slate-500">접수 시작일</span>
              <input
                type="date"
                value={form.registrationStart || ''}
                onChange={(e) => updateField('registrationStart', e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-[13px] font-bold text-slate-900 outline-none focus:border-amber-400"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-[10px] font-[1000] uppercase tracking-[0.16em] text-slate-500">장소</span>
              <input
                value={form.venue}
                onChange={(e) => updateField('venue', e.target.value)}
                className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-[14px] font-bold text-slate-900 outline-none focus:border-amber-400"
                placeholder="예: 보령종합테니스장"
              />
            </label>
            <SelectField label="주관" value={form.organizer} options={organizerOptions} onChange={(value) => updateField('organizer', value as TournamentEvent['organizer'])} />
            <SelectField label="부서" value={form.division} options={divisionOptions} onChange={(value) => updateField('division', value as TournamentEvent['division'])} />
            <SelectField label="등급" value={form.grade || ''} options={gradeOptions} onChange={(value) => updateField('grade', value)} />
            <SelectField label="상태" value={form.status} options={statusOptions} onChange={(value) => updateField('status', value as TournamentEvent['status'])} />
            <label className="sm:col-span-2">
              <span className="mb-1 block text-[10px] font-[1000] uppercase tracking-[0.16em] text-slate-500">메모</span>
              <textarea
                value={form.memo || ''}
                onChange={(e) => updateField('memo', e.target.value)}
                className="min-h-[86px] w-full rounded-2xl border border-slate-300 bg-white px-3 py-3 text-[13px] font-bold leading-relaxed text-slate-900 outline-none focus:border-amber-400"
                placeholder="운영 메모, 이동/접수 주의사항"
              />
            </label>
          </div>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-[1000] uppercase tracking-[0.18em] text-amber-700">Pairs</p>
                <h3 className="text-[16px] font-[1000] text-slate-950">출전 페어</h3>
              </div>
              <button
                type="button"
                onClick={() => updateField('pairs', [...form.pairs, { player1: '', player2: '', result: undefined }])}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-[1000] text-slate-700"
              >
                + 페어
              </button>
            </div>
            <div className="space-y-2">
              {form.pairs.map((pair, index) => (
                <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 sm:grid-cols-[1fr_1fr_120px_36px]">
                  <input
                    value={pair.player1}
                    onChange={(e) => updatePair(index, { player1: e.target.value })}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-[13px] font-bold outline-none focus:border-amber-400"
                    placeholder="선수1"
                  />
                  <input
                    value={pair.player2}
                    onChange={(e) => updatePair(index, { player2: e.target.value })}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-[13px] font-bold outline-none focus:border-amber-400"
                    placeholder="선수2"
                  />
                  <select
                    value={pair.result || ''}
                    onChange={(e) => updatePair(index, { result: (e.target.value || undefined) as TournamentPair['result'] })}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-[12px] font-bold outline-none focus:border-amber-400"
                  >
                    {resultOptions.map((option) => (
                      <option key={option || 'none'} value={option}>{option || '성적 없음'}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => updateField('pairs', form.pairs.filter((_, pairIndex) => pairIndex !== index))}
                    className="flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600"
                    aria-label="페어 삭제"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-[1000] uppercase tracking-[0.18em] text-amber-700">Partner Requests</p>
                <h3 className="text-[16px] font-[1000] text-slate-950">파트너 구함</h3>
              </div>
              <button
                type="button"
                onClick={() => updateField('partnerRequests', [...form.partnerRequests, { name: '', memo: '' }])}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-[1000] text-slate-700"
              >
                + 요청
              </button>
            </div>
            <div className="space-y-2">
              {form.partnerRequests.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-[12px] font-bold text-slate-400">
                  파트너 구함 목록이 없습니다.
                </p>
              )}
              {form.partnerRequests.map((request, index) => (
                <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 sm:grid-cols-[150px_1fr_36px]">
                  <input
                    value={request.name}
                    onChange={(e) => updatePartnerRequest(index, { name: e.target.value })}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-[13px] font-bold outline-none focus:border-amber-400"
                    placeholder="이름"
                  />
                  <input
                    value={request.memo || ''}
                    onChange={(e) => updatePartnerRequest(index, { memo: e.target.value })}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-[13px] font-bold outline-none focus:border-amber-400"
                    placeholder="메모"
                  />
                  <button
                    type="button"
                    onClick={() => updateField('partnerRequests', form.partnerRequests.filter((_, requestIndex) => requestIndex !== index))}
                    className="flex h-10 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600"
                    aria-label="파트너 요청 삭제"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {event && (
            <section className="rounded-3xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[10px] font-[1000] uppercase tracking-[0.18em] text-rose-700">Delete</p>
                  <p className="mt-1 text-[12px] font-bold leading-relaxed text-rose-700">
                    잘못 등록한 대회나 중복 데이터만 삭제하세요. 실제 취소 대회는 상태를 대회취소로 변경해 기록으로 남기는 것을 권장합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(event.id)}
                  disabled={isSaving}
                  className="h-11 shrink-0 rounded-2xl border border-rose-300 bg-white px-4 text-[11px] font-[1000] text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                  style={{ color: '#be123c', WebkitTextFillColor: '#be123c' }}
                >
                  <span style={{ color: '#be123c', WebkitTextFillColor: '#be123c' }}>대회 삭제</span>
                </button>
              </div>
            </section>
          )}

          <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur sm:-mx-6 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="h-12 flex-1 rounded-2xl border border-slate-300 bg-white text-[12px] font-[1000] text-slate-600"
              style={{ color: '#475569', WebkitTextFillColor: '#475569' }}
            >
              <span style={{ color: '#475569', WebkitTextFillColor: '#475569' }}>취소</span>
            </button>
            <button
              type="button"
              onClick={() => onSave(form)}
              disabled={isSaving}
              className="h-12 flex-[1.5] rounded-2xl border border-amber-300 bg-amber-50 text-[12px] font-[1000] text-slate-950 shadow-sm transition hover:bg-amber-100 disabled:opacity-50"
              style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a' }}
            >
              <span style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a' }}>
                {isSaving ? '저장 중...' : '저장 확인'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-[10px] font-[1000] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-[13px] font-bold text-slate-900 outline-none focus:border-amber-400"
      >
        {options.map((option) => (
          <option key={option || 'none'} value={option}>
            {option || '미지정'}
          </option>
        ))}
      </select>
    </label>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2.5 lg:rounded-2xl lg:p-3">
      <p className="text-[8px] font-[1000] uppercase tracking-[0.14em] text-slate-400 lg:text-[9px] lg:tracking-[0.16em]">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-[1000] text-slate-900 lg:mt-1 lg:text-[12px]">{value}</p>
    </div>
  );
}

function SideInfoCard({
  title,
  children,
  open = true,
  onToggle,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] lg:rounded-3xl lg:p-4">
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-left ring-1 ring-slate-200 transition hover:bg-white lg:min-h-10 ${open ? 'mb-2 border-b border-slate-200 pb-2 ring-slate-300 lg:mb-3 lg:pb-3' : ''}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 lg:h-2.5 lg:w-2.5" />
          <span className="truncate text-[13px] font-[1000] tracking-[-0.02em] text-slate-950 lg:text-[15px]">{title}</span>
        </span>
        {onToggle && (
          <ChevronDown size={16} className={`shrink-0 text-slate-500 transition-transform lg:size-[17px] ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {open && children}
    </section>
  );
}

function ListBlock({ title, icon, items, empty, compact = false }: { title: string; icon: React.ReactNode; items: string[]; empty: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white ${compact ? 'p-3' : 'p-4'}`}>
      <div className={`${compact ? 'mb-2 text-[9px] text-slate-500' : 'mb-3 text-[10px] text-amber-700'} flex items-center gap-2 font-[1000] uppercase tracking-[0.16em]`}>
        {icon}
        {title}
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span key={item} className={`rounded-full border border-slate-200 bg-slate-50 font-bold text-slate-600 ${compact ? 'px-2.5 py-0.5 text-[10px]' : 'px-3 py-1 text-[11px]'}`}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[12px] font-bold text-slate-400">{empty}</p>
      )}
    </div>
  );
}
