'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  MapPin,
  MessageCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import TournamentCSVUploadModal from '@/components/TournamentCSVUploadModal';
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
import {
  ClubSchedule,
  CLUB_TYPE_STYLE,
  CLUB_DOT_COLOR,
  demoClubSchedules,
  formatTimeRangeAmPm,
  formatCourtLabel,
} from '@/lib/clubScheduleData';
import {
  fetchClubSchedules,
  saveClubSchedule as saveClubScheduleToDb,
  deleteClubSchedule as deleteClubScheduleFromDb,
  ClubScheduleInput,
} from '@/lib/clubScheduleService';
import ClubScheduleEditorModal from '@/components/ClubScheduleEditorModal';
import { useAuth } from '@/context/AuthContext';

// ─── TEYEON Calendar 구조 ─────────────────────────────────────────────────────
// Tournament Schedule (대외 대회 일정) + Club Schedule (정모/번개 등) 통합 뷰.
// Tournament: tournament_events / tournament_pairs / tournament_partner_requests 테이블
// Club:       club_schedules 테이블 (supabase/add_club_schedules.sql 적용 필요)
// TODO: 정모 참석 체크 (참석/불참/미정), KDK 세션→정모 연결, Archive·Finance 연동 예정
// TODO: CALENDAR_MANAGER 역할 도입 시 canEditClubSchedule 조건에 추가
// ─────────────────────────────────────────────────────────────────────────────

// ─── Style maps (inline — Cool Light theme) ───────────────────────────────────

const ORG_STYLE: Record<TournamentEvent['organizer'], { badge: string; bg: string; color: string; border: string }> = {
  KATO:   { badge: 'KATO',     bg: 'rgba(245,158,11,0.09)',  color: '#92400E', border: 'rgba(245,158,11,0.28)' },
  KATA:   { badge: 'KATA',     bg: 'rgba(14,165,233,0.09)',  color: '#0C4A6E', border: 'rgba(14,165,233,0.28)' },
  KTA:    { badge: 'KTA',      bg: 'rgba(239,68,68,0.09)',   color: '#991B1B', border: 'rgba(239,68,68,0.26)'  },
  지역대회: { badge: 'LOCAL',  bg: 'rgba(16,185,129,0.09)',  color: '#065F46', border: 'rgba(16,185,129,0.24)' },
  비랭킹:  { badge: 'NON-RNK', bg: 'rgba(100,116,139,0.09)', color: '#334155', border: 'rgba(100,116,139,0.22)' },
};

const STATUS_STYLE: Record<TournamentEvent['status'], { bg: string; color: string; border: string }> = {
  접수예정:   { bg: 'rgba(245,158,11,0.08)',  color: '#92400E', border: 'rgba(245,158,11,0.22)' },
  접수중:    { bg: 'rgba(13,148,136,0.09)',   color: '#134E4A', border: 'rgba(13,148,136,0.22)' },
  접수종료:  { bg: 'rgba(100,116,139,0.08)',  color: '#475569', border: 'rgba(100,116,139,0.18)' },
  대회진행중: { bg: 'rgba(239,68,68,0.08)',   color: '#991B1B', border: 'rgba(239,68,68,0.20)'  },
  // 종료된 대회는 채도 높은 빨간 배지로 강조 — 운영자가 한눈에 끝난 일정을 인지하도록.
  대회종료:  { bg: 'rgba(220,38,38,0.10)',    color: '#B91C1C', border: 'rgba(220,38,38,0.32)' },
  대회취소:  { bg: 'rgba(239,68,68,0.08)',    color: '#991B1B', border: 'rgba(239,68,68,0.20)'  },
};

const RESULT_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  우승:     { bg: 'rgba(245,158,11,0.10)',  color: '#92400E', border: 'rgba(245,158,11,0.26)'  },
  준우승:   { bg: 'rgba(100,116,139,0.10)', color: '#334155', border: 'rgba(100,116,139,0.22)' },
  Finalist: { bg: 'rgba(16,185,129,0.09)',  color: '#065F46', border: 'rgba(16,185,129,0.22)'  },
  취소:     { bg: 'rgba(239,68,68,0.08)',   color: '#991B1B', border: 'rgba(239,68,68,0.20)'   },
  X:        { bg: 'rgba(239,68,68,0.08)',   color: '#991B1B', border: 'rgba(239,68,68,0.20)'   },
  default:  { bg: 'rgba(100,116,139,0.07)', color: '#475569', border: 'rgba(100,116,139,0.16)' },
};

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const organizerOptions: TournamentEvent['organizer'][] = ['KATO', 'KATA', 'KTA', '지역대회', '비랭킹'];
const divisionOptions: TournamentEvent['division'][] = ['신인부', '오픈부', '단체전'];
const gradeOptions = ['', 'MA', 'A', '1', '2', '3', '비랭킹'];
const statusOptions: TournamentEvent['status'][] = ['접수예정', '접수중', '접수종료', '대회진행중', '대회종료', '대회취소'];
const resultOptions: Array<TournamentPair['result'] | ''> = ['', '예정', '64', '32', '16', '8', 'Finalist', '준우승', '우승', '취소', 'X'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function canManageTournamentCalendar(role?: string | null) {
  return role === 'CEO' || role === 'ADMIN' || role === 'TOURNAMENT_MANAGER' || role === 'CALENDAR_MANAGER';
}

function pairLabel(pair: TournamentPair) {
  return `${pair.player1} / ${pair.player2}`;
}

function hasResult(pair: TournamentPair) {
  return Boolean(pair.result && pair.result !== '예정');
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
      ? event.pairs.map((pair) => ({ id: pair.id, player1: pair.player1, player2: pair.player2, result: pair.result }))
      : [{ player1: '', player2: '', result: undefined }],
    partnerRequests: event?.partnerRequests?.length
      ? event.partnerRequests.map((req) => ({ id: req.id, name: req.name, memo: req.memo || '' }))
      : (event?.lookingForPartners || []).map((name) => ({ name, memo: '' })),
  };
}

function formatDayLabel(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${m}월 ${d}일 (${WEEK_DAYS[date.getDay()]})`;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TournamentCalendarPage() {
  const { user, role } = useAuth();
  const isAdmin = canManageTournamentCalendar(role);
  // TODO: CALENDAR_MANAGER 역할 도입 시 이 조건에 추가 — profiles.role 컬럼 값 'CALENDAR_MANAGER' 확인 필요
  const canEditEvent = role === 'CEO' || role === 'ADMIN';
  // CSV 업로드: MVP에서 CEO/ADMIN 전용 (TODO: CALENDAR_MANAGER 확장 시 추가)
  const canUploadCSV = role === 'CEO' || role === 'ADMIN';
  // Club Schedule 등록/수정: CEO/ADMIN 전용 (TODO: CALENDAR_MANAGER 확장 시 추가)
  const canEditClubSchedule = role === 'CEO' || role === 'ADMIN';

  // 첫 진입 잔상 방지: events / clubSchedules 는 빈 배열로 시작.
  // demo 시드를 초기값으로 주면 fetch 전에 demo 카드가 잠깐 보였다 사라지는 잔상이 발생.
  // fetch 실패 시에만 demo 로 폴백 (loadEvents / loadClubSchedules 안에서 처리).
  const [events, setEvents] = useState<TournamentEvent[]>([]);
  const [dataSource, setDataSource] = useState<'db' | 'demo' | 'loading'>('loading');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => dateKey(new Date()));

  // ── 일정 종류 필터 ──
  // 'all': 대회 + TEYEON 모두 표시. 'tournament': 대회만. 'club': TEYEON만.
  // 첫 진입은 TEYEON 일정 기준 — 운영 화면은 정모 중심이라 기본 필터를 'club'로 둠.
  // 사용자가 '전체' / '대회 일정' 으로 바꾸면 그 선택을 유지.
  type CalendarFilter = 'all' | 'tournament' | 'club';
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('club');
  const showTournament = calendarFilter === 'all' || calendarFilter === 'tournament';
  const showClub = calendarFilter === 'all' || calendarFilter === 'club';

  // 월간 요약 접이식 — TEYEON 일정은 기본 펼침, 대회 일정은 기본 접힘.
  const [monthlyTournamentOpen, setMonthlyTournamentOpen] = useState(false);
  const [monthlyClubOpen, setMonthlyClubOpen] = useState(true);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set());
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TournamentEvent | null>(null);
  const [isCSVUploadOpen, setIsCSVUploadOpen] = useState(false);
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);

  // ── Club Schedule state ──
  // 빈 배열로 시작 (잔상 방지). fetch 실패 시 loadClubSchedules 안에서 demo 폴백.
  const [clubSchedules, setClubSchedules] = useState<ClubSchedule[]>([]);
  const [isClubEditorOpen, setIsClubEditorOpen] = useState(false);
  const [editingClubSchedule, setEditingClubSchedule] = useState<ClubSchedule | null>(null);
  const [isSavingClub, setIsSavingClub] = useState(false);

  // ── Data loading ──
  const loadEvents = async () => {
    try {
      const dbEvents = await fetchTournamentEvents();
      if (dbEvents.length > 0) {
        setEvents(dbEvents);
        setDataSource('db');
        return dbEvents;
      }
      setEvents(tournamentEvents);
      setDataSource('demo');
      return tournamentEvents;
    } catch {
      setEvents(tournamentEvents);
      setDataSource('demo');
      return tournamentEvents;
    }
  };

  const loadClubSchedules = async () => {
    try {
      const data = await fetchClubSchedules();
      setClubSchedules(data.length > 0 ? data : demoClubSchedules);
    } catch {
      // club_schedules 테이블 미적용 시 demo 데이터 유지
      setClubSchedules(demoClubSchedules);
    }
  };

  useEffect(() => { loadEvents(); loadClubSchedules(); }, []);

  // ── Derived sets for calendar dots ──
  const eventDateSet = useMemo(() => {
    const s = new Set<string>();
    events.forEach((e) => s.add(e.date));
    return s;
  }, [events]);

  const regStartDateSet = useMemo(() => {
    const s = new Set<string>();
    events.forEach((e) => { if (e.registrationStart) s.add(e.registrationStart); });
    return s;
  }, [events]);

  // ── Club schedule date set ──
  const clubScheduleDateSet = useMemo(() => {
    const s = new Set<string>();
    clubSchedules.forEach((cs) => s.add(cs.schedule_date));
    return s;
  }, [clubSchedules]);

  // ── Club schedules for selected date ──
  const selectedDateClubSchedules = useMemo(
    () => clubSchedules.filter((cs) => cs.schedule_date === selectedDate),
    [clubSchedules, selectedDate]
  );

  // ── Events for the selected date (경기일 OR 접수시작일 기준) ──
  const selectedDateEvents = useMemo(() => {
    return events.filter((e) => e.date === selectedDate || e.registrationStart === selectedDate);
  }, [events, selectedDate]);

  // ── Events for the displayed month (monthly list) ──
  // 정렬 규칙 (운영 우선):
  //   1) 예정/진행중 일정이 위, 종료된 일정이 아래
  //   2) 예정 그룹은 가장 가까운 일정이 위 (date ASC)
  //   3) 종료 그룹은 가장 최근에 끝난 일정이 위 (date DESC)
  const monthEvents = useMemo(() => {
    const today = dateKey(new Date());
    return events
      .filter((e) => {
        const d = parseTournamentDate(e.date);
        return d.getFullYear() === currentMonth.getFullYear() && d.getMonth() === currentMonth.getMonth();
      })
      .sort((a, b) => {
        const aPast = (a.date || '') < today;
        const bPast = (b.date || '') < today;
        if (aPast !== bPast) return aPast ? 1 : -1;
        // 같은 그룹: 예정은 ASC, 종료는 DESC
        return aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
      });
  }, [events, currentMonth]);

  // ── Club schedules for the displayed month ──
  const monthClubSchedules = useMemo(() => {
    const today = dateKey(new Date());
    return clubSchedules
      .filter((cs) => {
        const [y, m] = cs.schedule_date.split('-').map(Number);
        return y === currentMonth.getFullYear() && (m - 1) === currentMonth.getMonth();
      })
      .sort((a, b) => {
        const aPast = a.schedule_date < today;
        const bPast = b.schedule_date < today;
        if (aPast !== bPast) return aPast ? 1 : -1;
        const ak = a.schedule_date + (a.start_time || '');
        const bk = b.schedule_date + (b.start_time || '');
        return aPast ? bk.localeCompare(ak) : ak.localeCompare(bk);
      });
  }, [clubSchedules, currentMonth]);

  const cells = useMemo(() => buildCalendarCells(currentMonth), [currentMonth]);

  const todayKey = useMemo(() => dateKey(new Date()), []);

  // ── Handlers ──
  const moveMonth = (offset: number) => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  };

  const selectDate = (key: string, cellDate: Date) => {
    setSelectedDate(key);
    setExpandedCardId(null);
    const cy = cellDate.getFullYear();
    const cm = cellDate.getMonth();
    if (cy !== currentMonth.getFullYear() || cm !== currentMonth.getMonth()) {
      setCurrentMonth(new Date(cy, cm, 1));
    }
  };

  const toggleNotify = (eventId: string) => {
    setNotifiedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  };

  const shareEvent = async (event: TournamentEvent) => {
    const text = [
      `[TEYEON 대회 캘린더] ${event.title}`,
      `일자: ${formatTournamentDate(event.date)}`,
      `장소: ${event.venue}`,
      `주관: ${event.organizer}`,
      `부서: ${event.division}${event.grade ? ` / ${event.grade}` : ''}`,
      `접수: ${event.registrationStart ? formatTournamentDate(event.registrationStart) : '미정'} (${event.status})`,
      `참가 예정: ${event.pairs.length}팀`,
      ...(event.lookingForPartners.length > 0 ? [`파트너 구함: ${event.lookingForPartners.length}명`] : []),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert('대회 정보가 복사되었습니다. 카카오톡 채팅방에 붙여넣기 해주세요.');
    } catch {
      alert(text);
    }
  };

  const openCreateEditor = () => { setEditingEvent(null); setIsEditorOpen(true); };
  const openEditEditor = (event: TournamentEvent) => { setEditingEvent(event); setIsEditorOpen(true); };

  const handleSaveEvent = async (input: TournamentEventInput) => {
    if (!isAdmin) return;
    if (!input.title.trim()) { alert('대회명을 입력해 주세요.'); return; }
    if (!input.date) { alert('대회일을 입력해 주세요.'); return; }
    setIsSavingEvent(true);
    try {
      await saveTournamentEvent(input, user?.id);
      await loadEvents();
      setIsEditorOpen(false);
      setEditingEvent(null);
      const [y, m] = input.date.split('-').map(Number);
      setSelectedDate(input.date);
      setCurrentMonth(new Date(y, m - 1, 1));
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
    const ok = window.confirm('정말 이 대회를 삭제할까요? 실제 취소는 상태를 대회취소로 변경하는 것을 권장합니다.');
    if (!ok) return;
    setIsDeletingEvent(true);
    try {
      await deleteTournamentEvent(eventId);
      await loadEvents();
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

  const handleSaveClubSchedule = async (input: ClubScheduleInput) => {
    if (!canEditClubSchedule) return;
    if (!input.title.trim()) { alert('일정명을 입력해 주세요.'); return; }
    if (!input.schedule_date) { alert('날짜를 입력해 주세요.'); return; }
    setIsSavingClub(true);
    try {
      await saveClubScheduleToDb(input, user?.id);
      await loadClubSchedules();
      setIsClubEditorOpen(false);
      setEditingClubSchedule(null);
      const [y, m] = input.schedule_date.split('-').map(Number);
      setSelectedDate(input.schedule_date);
      setCurrentMonth(new Date(y, m - 1, 1));
      alert('클럽 일정이 저장되었습니다.');
    } catch (error: any) {
      // Supabase error는 객체 그대로 console에 넣으면 일부 환경에서 collapsed.
      // code/message/details/hint를 한 줄로 평탄화해서 즉시 보이게 한다.
      const code    = error?.code    ?? '(no code)';
      const message = error?.message ?? '(no message)';
      const details = error?.details ?? '(no details)';
      const hint    = error?.hint    ?? '(no hint)';
      console.error(
        `[Club Schedule] Save failed — code=${code} | message=${message} | details=${details} | hint=${hint}`
      );
      console.error('[Club Schedule] Save failed (raw)', error);
      alert(
        '저장에 실패했습니다. 콘솔 로그의 code/message/hint를 확인해 주세요.\n' +
        'DB에 새 컬럼이 없다면 아래 SQL을 적용해야 합니다:\n' +
        ' - supabase/add_club_schedule_court_mode.sql\n' +
        ' - supabase/add_club_schedule_attendance_settings.sql'
      );
    } finally {
      setIsSavingClub(false);
    }
  };

  const handleDeleteClubSchedule = async (id: string) => {
    if (!canEditClubSchedule) return;
    const ok = window.confirm('이 클럽 일정을 삭제할까요?');
    if (!ok) return;
    setIsSavingClub(true);
    try {
      await deleteClubScheduleFromDb(id);
      await loadClubSchedules();
      setIsClubEditorOpen(false);
      setEditingClubSchedule(null);
      alert('클럽 일정이 삭제되었습니다.');
    } catch (error) {
      console.error('[Club Schedule] Delete failed', error);
      alert('클럽 일정 삭제에 실패했습니다.');
    } finally {
      setIsSavingClub(false);
    }
  };

  const monthLabel = `${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월`;

  return (
    <main
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        top: 'calc(72px + env(safe-area-inset-top))',
        zIndex: 120,
        width: '100vw',
        transform: 'translateX(-50%)',
        overflowY: 'auto',
        overflowX: 'hidden',
        backgroundColor: '#F2F4F7',
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
      }}
    >
      <div
        style={{
          maxWidth: 430,
          margin: '0 auto',
          padding: '12px 14px calc(96px + env(safe-area-inset-bottom))',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxSizing: 'border-box',
          width: '100%',
        }}
      >
        {/* ── Header card ── */}
        <div
          style={{
            borderRadius: 16,
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)',
            borderTop: '2px solid #0D9488',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            padding: '9px 13px 8px',
          }}
        >
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Link
              href="/"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                minWidth: 32,
                borderRadius: '50%',
                backgroundColor: '#F1F5F9',
                border: '1px solid rgba(0,0,0,0.07)',
                color: '#475569',
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              <ChevronLeft size={17} />
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: '#0F172A',
                  margin: 0,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                TEYEON Calendar
              </h1>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: '#94A3B8',
                  margin: '1px 0 0',
                  lineHeight: 1,
                }}
              >
                대회 일정 · 클럽 일정
              </p>
            </div>
          </div>

          {/* Action buttons row — flex-wrap so they flow on narrow screens */}
          {(canUploadCSV || isAdmin || canEditClubSchedule) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {/* CSV 업로드: CEO / ADMIN 전용 */}
              {canUploadCSV && (
                <button
                  type="button"
                  onClick={() => setIsCSVUploadOpen(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 99,
                    backgroundColor: 'rgba(13,148,136,0.07)',
                    border: '1px solid rgba(13,148,136,0.18)',
                    color: '#0D9488',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Upload size={11} />
                  가져오기
                </button>
              )}
              {/* 대회 직접 등록: 캘린더 관리자 이상 */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={openCreateEditor}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 99,
                    backgroundColor: 'rgba(13,148,136,0.09)',
                    border: '1px solid rgba(13,148,136,0.22)',
                    color: '#0D9488',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Plus size={11} />
                  대회+
                </button>
              )}
              {/* 클럽 일정 등록: CEO / ADMIN 전용 */}
              {canEditClubSchedule && (
                <button
                  type="button"
                  onClick={() => { setEditingClubSchedule(null); setIsClubEditorOpen(true); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 99,
                    backgroundColor: 'rgba(99,102,241,0.09)',
                    border: '1px solid rgba(99,102,241,0.22)',
                    color: '#4338CA',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Plus size={11} />
                  클럽+
                </button>
              )}
            </div>
          )}

          {/* Legend */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 7,
              paddingTop: 6,
              borderTop: '1px solid rgba(0,0,0,0.05)',
              flexWrap: 'nowrap',
              overflowX: 'auto',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: '#64748B', flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#0D9488', display: 'inline-block', flexShrink: 0 }} />
              접수 시작
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: '#64748B', flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#C9A84C', display: 'inline-block', flexShrink: 0 }} />
              경기일
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: '#64748B', flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: CLUB_DOT_COLOR, display: 'inline-block', flexShrink: 0 }} />
              클럽 일정
            </span>
          </div>
        </div>

        {/* ── Calendar card ── */}
        <div
          style={{
            borderRadius: 16,
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
            padding: '13px 10px 10px',
          }}
        >
          {/* Month navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '1px solid rgba(0,0,0,0.08)',
                backgroundColor: '#F8FAFC',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#64748B', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <ChevronLeft size={16} />
            </button>

            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
                {monthLabel}
              </p>
              <button
                type="button"
                onClick={() => { setCurrentMonth(new Date()); setSelectedDate(todayKey); setExpandedCardId(null); }}
                style={{
                  marginTop: 3, padding: '1px 8px', borderRadius: 99,
                  backgroundColor: 'rgba(13,148,136,0.08)',
                  border: '1px solid rgba(13,148,136,0.18)',
                  fontSize: 9, fontWeight: 700, color: '#0D9488',
                  cursor: 'pointer', letterSpacing: '0.06em',
                }}
              >
                오늘
              </button>
            </div>

            <button
              type="button"
              onClick={() => moveMonth(1)}
              style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '1px solid rgba(0,0,0,0.08)',
                backgroundColor: '#F8FAFC',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#64748B', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 3 }}>
            {WEEK_DAYS.map((day, i) => (
              <div
                key={day}
                style={{
                  textAlign: 'center',
                  fontSize: 10,
                  fontWeight: 700,
                  color: i === 0 ? '#EF4444' : i === 6 ? '#3B82F6' : '#94A3B8',
                  padding: '3px 0',
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Date grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px 0' }}>
            {cells.map(({ date, inMonth }) => {
              const key = dateKey(date);
              const isToday = key === todayKey;
              const isSelected = key === selectedDate;
              const hasEv = showTournament && eventDateSet.has(key);
              const hasReg = showTournament && regStartDateSet.has(key);
              const hasClub = showClub && clubScheduleDateSet.has(key);
              const dow = date.getDay();

              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => selectDate(key, date)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '5px 1px',
                    borderRadius: 9,
                    cursor: 'pointer',
                    border: isToday && !isSelected ? '1.5px solid #0D9488' : '1.5px solid transparent',
                    backgroundColor: isSelected ? '#0D9488' : 'transparent',
                    opacity: inMonth ? 1 : 0.28,
                    outline: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isSelected || isToday ? 800 : 500,
                      lineHeight: 1,
                      color: isSelected
                        ? '#FFFFFF'
                        : isToday
                        ? '#0D9488'
                        : dow === 0
                        ? '#EF4444'
                        : dow === 6
                        ? '#3B82F6'
                        : '#1E293B',
                    }}
                  >
                    {date.getDate()}
                  </span>
                  {/* Dots: teal=접수시작, gold=경기일, indigo=클럽일정 */}
                  <div style={{ display: 'flex', gap: 2, marginTop: 3, minHeight: 5, alignItems: 'center' }}>
                    {hasReg && (
                      <span
                        style={{
                          width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                          backgroundColor: isSelected ? 'rgba(255,255,255,0.80)' : '#0D9488',
                        }}
                      />
                    )}
                    {hasEv && (
                      <span
                        style={{
                          width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                          backgroundColor: isSelected ? 'rgba(255,255,255,0.80)' : '#C9A84C',
                        }}
                      />
                    )}
                    {hasClub && (
                      <span
                        style={{
                          width: 4, height: 4, borderRadius: '50%', flexShrink: 0,
                          backgroundColor: isSelected ? 'rgba(255,255,255,0.80)' : CLUB_DOT_COLOR,
                        }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── 일정 종류 필터 (전체 / 대회 / TEYEON) ── */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 10,
            backgroundColor: '#F1F5F9',
            border: '1px solid rgba(15,23,42,0.06)',
          }}
        >
          {([
            { v: 'all',        label: '전체',         accent: '#0F172A' },
            { v: 'club',       label: 'TEYEON 일정',  accent: '#3B82F6' },
            { v: 'tournament', label: '대회 일정',     accent: '#0D9488' },
          ] as const).map((opt) => {
            const active = calendarFilter === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setCalendarFilter(opt.v)}
                style={{
                  flex: 1, height: 34,
                  paddingLeft: 4, paddingRight: 4,
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: active ? '#FFFFFF' : 'transparent',
                  boxShadow: active ? '0 1px 3px rgba(15,23,42,0.10)' : 'none',
                  color: active ? opt.accent : '#64748B',
                  fontSize: 11, fontWeight: 800,
                  letterSpacing: '-0.01em',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  whiteSpace: 'nowrap',
                  transition: 'background-color 0.15s, color 0.15s',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* ── Selected date label ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#334155', margin: 0 }}>
            {formatDayLabel(selectedDate)}
          </p>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
            {((showTournament ? selectedDateEvents.length : 0) + (showClub ? selectedDateClubSchedules.length : 0)) > 0
              ? [
                  showTournament && selectedDateEvents.length > 0 ? `대회 ${selectedDateEvents.length}` : '',
                  showClub && selectedDateClubSchedules.length > 0 ? `TEYEON ${selectedDateClubSchedules.length}` : '',
                ].filter(Boolean).join(' · ')
              : '일정 없음'}
          </span>
        </div>

        {/* ── Tournament event cards ── */}
        {showTournament && selectedDateEvents.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedDateEvents.map((event) => {
              const org = ORG_STYLE[event.organizer];
              // 경기일이 오늘보다 과거면 자동 '대회 종료'로 표시. status 원본 값은 변경하지 않음.
              const isPastEvent = !!event.date && event.date < todayKey;
              const displayStatus = isPastEvent ? '대회종료' : event.status;
              const st = STATUS_STYLE[displayStatus];
              const isExpanded = expandedCardId === event.id;
              const isNotified = notifiedIds.has(event.id);
              const isEventDate = event.date === selectedDate;
              const isRegDate = event.registrationStart === selectedDate;

              // 경기일 D-day badge — D+ (지난 날짜)는 숨김
              const rawEventDday = isEventDate ? getTournamentDday(event.date) : null;
              const eventBadgeLabel: string | null = (() => {
                if (!rawEventDday || rawEventDday.startsWith('D+')) return null;
                if (rawEventDday === 'D-DAY') return '오늘 경기';
                return `경기 ${rawEventDday}`;
              })();

              // 접수 시작 badge — 선택 날짜가 접수시작일이면 항상 표시
              const rawRegDday = isRegDate ? getTournamentDday(event.registrationStart) : null;
              const regBadgeLabel: string | null = (() => {
                if (!isRegDate) return null;
                if (!rawRegDday || rawRegDday.startsWith('D+')) return '접수 시작';
                if (rawRegDday === 'D-DAY') return '접수 시작 · 오늘';
                return `접수 시작 · ${rawRegDday}`;
              })();

              return (
                <div
                  key={event.id}
                  style={{
                    borderRadius: 14,
                    backgroundColor: isPastEvent ? '#FBFCFD' : '#FFFFFF',
                    border: isPastEvent ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(0,0,0,0.06)',
                    boxShadow: isPastEvent ? 'none' : '0 1px 5px rgba(0,0,0,0.05)',
                    overflow: 'hidden',
                    width: '100%',
                    boxSizing: 'border-box',
                    opacity: isPastEvent ? 0.85 : 1,
                  }}
                >
                  {/* Card body */}
                  <div style={{ padding: '12px 14px' }}>
                    {/* Chips row */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: '0.10em',
                          textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5,
                          backgroundColor: org.bg, color: org.color,
                          border: `1px solid ${org.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {org.badge}
                      </span>
                      {event.division && (
                        <span
                          style={{
                            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                            backgroundColor: 'rgba(100,116,139,0.07)',
                            color: '#475569',
                            border: '1px solid rgba(100,116,139,0.15)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {event.division}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                          backgroundColor: st.bg, color: st.color,
                          border: `1px solid ${st.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {displayStatus}
                      </span>
                      {isPastEvent && (
                        <span
                          style={{
                            fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                            backgroundColor: 'rgba(100,116,139,0.10)', color: '#475569',
                            border: '1px solid rgba(100,116,139,0.22)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          완료
                        </span>
                      )}
                      {eventBadgeLabel && (
                        <span
                          style={{
                            fontSize: 9, fontWeight: 800, letterSpacing: '0.05em',
                            padding: '2px 7px', borderRadius: 5,
                            backgroundColor: 'rgba(201,168,76,0.10)', color: '#92400E',
                            border: '1px solid rgba(201,168,76,0.26)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {eventBadgeLabel}
                        </span>
                      )}
                      {regBadgeLabel && (
                        <span
                          style={{
                            fontSize: 9, fontWeight: 800, letterSpacing: '0.05em',
                            padding: '2px 7px', borderRadius: 5,
                            backgroundColor: 'rgba(13,148,136,0.09)', color: '#0D9488',
                            border: '1px solid rgba(13,148,136,0.22)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {regBadgeLabel}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <p
                      style={{
                        fontSize: 16, fontWeight: 800, color: '#0F172A',
                        letterSpacing: '-0.02em', lineHeight: 1.25,
                        margin: '0 0 8px',
                        wordBreak: 'keep-all',
                        overflowWrap: 'break-word',
                      }}
                    >
                      {event.title}
                    </p>

                    {/* Dates */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>
                        <span style={{ color: '#94A3B8', marginRight: 3 }}>경기</span>
                        {formatTournamentDate(event.date)}
                      </span>
                      {event.registrationStart && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>
                          <span style={{ color: '#94A3B8', marginRight: 3 }}>접수</span>
                          {formatTournamentDate(event.registrationStart)}
                        </span>
                      )}
                    </div>

                    {/* Venue */}
                    {event.venue && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 6 }}>
                        <MapPin size={11} style={{ color: '#94A3B8', flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                          {event.venue}
                        </span>
                      </div>
                    )}

                    {/* Collapsed summary */}
                    {!isExpanded && (
                      <p style={{ fontSize: 11, fontWeight: 500, color: '#94A3B8', margin: 0 }}>
                        출전 {event.pairs.length}팀
                        {event.lookingForPartners.length > 0 && ` · 파트너 구함 ${event.lookingForPartners.length}명`}
                      </p>
                    )}

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                        {/* Division + Grade */}
                        {(event.division || event.grade) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
                            {event.division && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#94A3B8', marginRight: 3 }}>부서</span>
                                {event.division}
                              </span>
                            )}
                            {event.grade && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', whiteSpace: 'nowrap' }}>
                                <span style={{ color: '#94A3B8', marginRight: 3 }}>등급</span>
                                {event.grade}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Pairs */}
                        {event.pairs.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', marginBottom: 6, margin: '0 0 6px' }}>
                              출전 페어
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {event.pairs.map((pair) => {
                                const rs = hasResult(pair) ? (RESULT_STYLE[pair.result!] || RESULT_STYLE.default) : null;
                                return (
                                  <div
                                    key={`${pair.player1}-${pair.player2}-${pair.result}`}
                                    style={{
                                      display: 'flex', alignItems: 'center',
                                      justifyContent: 'space-between', gap: 8,
                                      backgroundColor: '#F8FAFC', borderRadius: 8,
                                      padding: '5px 9px',
                                    }}
                                  >
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {pairLabel(pair)}
                                    </span>
                                    {rs ? (
                                      <span
                                        style={{
                                          fontSize: 9, fontWeight: 800,
                                          padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                                          backgroundColor: rs.bg, color: rs.color, border: `1px solid ${rs.border}`,
                                        }}
                                      >
                                        {pair.result}
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: 9, fontWeight: 600, color: '#CBD5E1', flexShrink: 0 }}>예정</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Partner requests */}
                        {event.lookingForPartners.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                              파트너 구함
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                              {event.lookingForPartners.map((name) => (
                                <span
                                  key={name}
                                  style={{
                                    fontSize: 11, fontWeight: 600,
                                    padding: '3px 9px', borderRadius: 99,
                                    backgroundColor: '#F1F5F9',
                                    border: '1px solid rgba(0,0,0,0.07)',
                                    color: '#475569',
                                  }}
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Memo */}
                        {event.memo && (
                          <div
                            style={{
                              padding: '8px 10px', borderRadius: 8,
                              backgroundColor: '#F8FAFC',
                              border: '1px solid rgba(0,0,0,0.05)',
                            }}
                          >
                            <p style={{ fontSize: 11, fontWeight: 500, color: '#64748B', lineHeight: 1.65, margin: 0, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                              {event.memo}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card action footer */}
                  <div
                    style={{
                      display: 'flex',
                      borderTop: '1px solid rgba(0,0,0,0.05)',
                      backgroundColor: '#FAFAFA',
                    }}
                  >
                    {/* 상세 보기 */}
                    <button
                      type="button"
                      onClick={() => setExpandedCardId(isExpanded ? null : event.id)}
                      style={{
                        flex: 1, height: 38, fontSize: 11, fontWeight: 700,
                        color: isExpanded ? '#0D9488' : '#64748B',
                        cursor: 'pointer', border: 'none',
                        backgroundColor: 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        whiteSpace: 'nowrap',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <ChevronDown
                        size={13}
                        style={{ transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }}
                      />
                      {isExpanded ? '접기' : '상세 보기'}
                    </button>

                    <div style={{ width: 1, backgroundColor: 'rgba(0,0,0,0.05)', alignSelf: 'stretch' }} />

                    {/* 알림 받기 */}
                    <button
                      type="button"
                      onClick={() => toggleNotify(event.id)}
                      style={{
                        flex: 1, height: 38, fontSize: 11, fontWeight: 700,
                        color: isNotified ? '#0D9488' : '#64748B',
                        cursor: 'pointer', border: 'none',
                        backgroundColor: 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        whiteSpace: 'nowrap',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <Bell
                        size={12}
                        style={{ flexShrink: 0, fill: isNotified ? '#0D9488' : 'none', color: isNotified ? '#0D9488' : '#64748B' }}
                      />
                      {isNotified ? '알림 ON' : '알림'}
                    </button>

                    <div style={{ width: 1, backgroundColor: 'rgba(0,0,0,0.05)', alignSelf: 'stretch' }} />

                    {/* 카톡 공유 */}
                    <button
                      type="button"
                      onClick={() => shareEvent(event)}
                      style={{
                        flex: 1, height: 38, fontSize: 11, fontWeight: 700,
                        color: '#64748B', cursor: 'pointer',
                        border: 'none', backgroundColor: 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        whiteSpace: 'nowrap',
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      <MessageCircle size={12} style={{ flexShrink: 0 }} />
                      공유
                    </button>

                    {/* 수정 아이콘: CEO / ADMIN 전용 */}
                    {canEditEvent && (
                      <>
                        <div style={{ width: 1, backgroundColor: 'rgba(0,0,0,0.05)', alignSelf: 'stretch' }} />
                        <button
                          type="button"
                          onClick={() => openEditEditor(event)}
                          style={{
                            width: 42, height: 38,
                            color: '#94A3B8', cursor: 'pointer',
                            border: 'none', backgroundColor: 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <Edit3 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Club schedule cards ── */}
        {showClub && selectedDateClubSchedules.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selectedDateClubSchedules.map((cs) => {
              const typeStyle = CLUB_TYPE_STYLE[cs.schedule_type];
              const timeRange = formatTimeRangeAmPm(cs.start_time, cs.end_time);
              const courtLabel = formatCourtLabel(cs.court_mode, cs.court_count);
              // 지난 일정: 취소선 X. 채도/명도 낮춤 + '완료' badge.
              const isPast = cs.schedule_date < todayKey;
              return (
                <div
                  key={cs.id}
                  style={{
                    borderRadius: 14,
                    backgroundColor: isPast ? '#FBFCFD' : '#FFFFFF',
                    border: isPast ? '1px solid rgba(99,102,241,0.06)' : '1px solid rgba(99,102,241,0.12)',
                    borderLeft: isPast ? '3px solid rgba(99,102,241,0.45)' : '3px solid #6366F1',
                    boxShadow: isPast ? 'none' : '0 1px 5px rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                    opacity: isPast ? 0.85 : 1,
                  }}
                >
                  <div style={{ padding: '12px 14px' }}>
                    {/* Type chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                          backgroundColor: typeStyle.bg, color: typeStyle.color,
                          border: `1px solid ${typeStyle.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {typeStyle.badge}
                      </span>
                      {isPast && (
                        <span
                          style={{
                            fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                            backgroundColor: 'rgba(100,116,139,0.10)', color: '#475569',
                            border: '1px solid rgba(100,116,139,0.22)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          완료
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <p
                      style={{
                        fontSize: 16, fontWeight: 800,
                        color: isPast ? '#475569' : '#0F172A',
                        letterSpacing: '-0.02em', lineHeight: 1.25,
                        margin: '0 0 8px',
                        wordBreak: 'keep-all',
                        overflowWrap: 'break-word',
                      }}
                    >
                      {cs.title}
                    </p>

                    {/* Time + court */}
                    {(timeRange || courtLabel) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
                        {timeRange && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: isPast ? '#94A3B8' : '#64748B', whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#94A3B8', marginRight: 3 }}>시간</span>
                            {timeRange}
                          </span>
                        )}
                        {courtLabel && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: isPast ? '#94A3B8' : '#64748B', whiteSpace: 'nowrap' }}>
                            {courtLabel}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Location */}
                    {cs.location && (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 6 }}>
                        <MapPin size={11} style={{ color: '#94A3B8', flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                          {cs.location}
                        </span>
                      </div>
                    )}

                    {/* Guest info */}
                    {cs.guest_enabled && (
                      <p style={{ fontSize: 11, fontWeight: 500, color: '#4338CA', margin: '0 0 5px' }}>
                        게스트 가능 · {cs.guest_limit != null ? `${cs.guest_limit}명` : '제한 없음'}
                        {cs.fee_amount ? ` · 게스트비 ${cs.fee_amount.toLocaleString()}원` : ''}
                      </p>
                    )}

                    {/* Fee (members, non-guest) */}
                    {cs.fee_amount && !cs.guest_enabled && (
                      <p style={{ fontSize: 11, fontWeight: 500, color: '#64748B', margin: '0 0 5px' }}>
                        참가비 {cs.fee_amount.toLocaleString()}원
                      </p>
                    )}

                    {/* Memo */}
                    {cs.memo && (
                      <div
                        style={{
                          padding: '8px 10px', borderRadius: 8,
                          backgroundColor: '#F8FAFC',
                          border: '1px solid rgba(0,0,0,0.05)',
                          marginTop: 6,
                        }}
                      >
                        <p style={{ fontSize: 11, fontWeight: 500, color: '#64748B', lineHeight: 1.65, margin: 0, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                          {cs.memo}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Footer: 정모는 모든 사용자에게 참석 체크 진입점 노출. CEO/ADMIN은 수정 버튼 동시 노출 */}
                  {(cs.schedule_type === '정모' || canEditClubSchedule) && (
                    <div style={{ display: 'flex', borderTop: '1px solid rgba(0,0,0,0.05)', backgroundColor: '#FAFAFA' }}>
                      {cs.schedule_type === '정모' && !cs.id.startsWith('demo-') && (
                        <Link
                          href={`/club-schedule/${cs.id}`}
                          style={{
                            flex: 1, height: 38, fontSize: 11.5, fontWeight: 800,
                            color: '#3B82F6', textDecoration: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            whiteSpace: 'nowrap',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <CheckSquare size={13} />
                          참석 체크
                        </Link>
                      )}
                      {canEditClubSchedule && (
                        <button
                          type="button"
                          onClick={() => { setEditingClubSchedule(cs); setIsClubEditorOpen(true); }}
                          style={{
                            flex: 1, height: 38, fontSize: 11, fontWeight: 700,
                            color: '#94A3B8', cursor: 'pointer',
                            border: 'none', backgroundColor: 'transparent',
                            borderLeft: cs.schedule_type === '정모' && !cs.id.startsWith('demo-') ? '1px solid rgba(0,0,0,0.05)' : undefined,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                            whiteSpace: 'nowrap',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <Edit3 size={13} />
                          수정
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Empty state (대회 + 클럽 모두 없을 때) ── */}
        {((!showTournament || selectedDateEvents.length === 0) && (!showClub || selectedDateClubSchedules.length === 0)) && (
          <div
            style={{
              borderRadius: 14, backgroundColor: '#FFFFFF',
              border: '1px dashed rgba(0,0,0,0.10)',
              padding: '28px 20px',
              textAlign: 'center',
            }}
          >
            <p style={{ fontSize: 12, fontWeight: 600, color: '#CBD5E1', margin: 0 }}>
              이 날은 등록된 일정이 없습니다
            </p>
          </div>
        )}

        {/* ── 월간 일정 요약 ── */}
        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#475569', margin: '4px 2px 0' }}>
          {monthLabel} 일정 요약
        </p>

        {/* TEYEON 일정 섹션 — 필터 'tournament' 일 때 숨김 */}
        {(calendarFilter !== 'tournament') && (
          <div
            style={{
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setMonthlyClubOpen((p) => !p)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 11, paddingRight: 14, paddingBottom: 11, paddingLeft: 14,
                border: 'none', backgroundColor: 'transparent',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: CLUB_DOT_COLOR, flexShrink: 0 }} />
                <p style={{ fontSize: 13.5, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>
                  TEYEON 일정
                </p>
                <span style={{
                  fontSize: 10, fontWeight: 800, color: '#3730A3',
                  paddingTop: 1, paddingRight: 7, paddingBottom: 1, paddingLeft: 7, borderRadius: 99,
                  backgroundColor: 'rgba(99,102,241,0.10)',
                  border: '1px solid rgba(99,102,241,0.22)',
                }}>
                  {monthClubSchedules.length}건
                </span>
              </div>
              <ChevronDown
                size={15}
                style={{ color: '#94A3B8', transition: 'transform 0.2s', transform: monthlyClubOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            {monthlyClubOpen && (
              <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                {monthClubSchedules.length > 0 ? (
                  monthClubSchedules.map((cs, idx) => {
                    const typeStyle = CLUB_TYPE_STYLE[cs.schedule_type];
                    const [, mm, dd] = cs.schedule_date.split('-');
                    const timeRange = formatTimeRangeAmPm(cs.start_time, cs.end_time);
                    const isJeongmo = cs.schedule_type === '정모';
                    const isDemo = cs.id.startsWith('demo-');
                    const isPast = cs.schedule_date < todayKey;
                    const href = (isJeongmo && !isDemo) ? `/club-schedule/${cs.id}` : null;
                    const RowInner = (
                      <>
                        <div style={{ textAlign: 'center', flexShrink: 0, width: 28 }}>
                          <p style={{ fontSize: 14, fontWeight: 800, color: isPast ? '#94A3B8' : '#0F172A', margin: 0, lineHeight: 1 }}>
                            {parseInt(dd)}
                          </p>
                          <p style={{ fontSize: 9, fontWeight: 600, color: '#94A3B8', margin: '1px 0 0' }}>
                            {parseInt(mm)}월
                          </p>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: isPast ? '#64748B' : '#1E293B', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cs.title}
                          </p>
                          <p style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {[timeRange, cs.location].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 8, fontWeight: 800,
                            paddingTop: 1, paddingRight: 5, paddingBottom: 1, paddingLeft: 5, borderRadius: 4,
                            backgroundColor: typeStyle.bg, color: typeStyle.color, border: `1px solid ${typeStyle.border}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {typeStyle.badge}
                          </span>
                          {isPast && (
                            // 종료된 정모/번개 등은 빨간 '완료' 배지로 명확히 표시. 음영은 row 자체로 살림.
                            <span style={{
                              fontSize: 8, fontWeight: 800,
                              paddingTop: 1, paddingRight: 5, paddingBottom: 1, paddingLeft: 5, borderRadius: 4,
                              backgroundColor: 'rgba(220,38,38,0.10)', color: '#B91C1C',
                              border: '1px solid rgba(220,38,38,0.32)',
                              whiteSpace: 'nowrap',
                            }}>
                              완료
                            </span>
                          )}
                          {!isPast && canEditClubSchedule && !isDemo && (
                            <span style={{
                              fontSize: 8, fontWeight: 700, color: '#64748B',
                              paddingTop: 1, paddingRight: 5, paddingBottom: 1, paddingLeft: 5, borderRadius: 4,
                              backgroundColor: '#F1F5F9',
                              border: '1px solid rgba(0,0,0,0.06)',
                              whiteSpace: 'nowrap',
                            }}>
                              ADMIN
                            </span>
                          )}
                        </div>
                      </>
                    );
                    const rowStyle: React.CSSProperties = {
                      width: '100%', display: 'flex', alignItems: 'center',
                      gap: 10,
                      paddingTop: 10, paddingRight: 14, paddingBottom: 10, paddingLeft: 14,
                      border: 'none',
                      backgroundColor: isPast
                        ? (idx % 2 === 0 ? '#FBFCFD' : '#F8FAFB')
                        : (idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA'),
                      cursor: 'pointer', borderTop: idx === 0 ? 'none' : '1px solid rgba(0,0,0,0.04)',
                      textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                      boxSizing: 'border-box',
                      color: 'inherit', textDecoration: 'none',
                    };
                    if (href) {
                      return (
                        <Link key={cs.id} href={href} style={rowStyle}>
                          {RowInner}
                        </Link>
                      );
                    }
                    return (
                      <button
                        type="button"
                        key={cs.id}
                        onClick={() => {
                          setSelectedDate(cs.schedule_date);
                          setMonthlyClubOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={rowStyle}
                      >
                        {RowInner}
                      </button>
                    );
                  })
                ) : (
                  <div style={{ paddingTop: 24, paddingRight: 14, paddingBottom: 24, paddingLeft: 14, textAlign: 'center' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#CBD5E1', margin: 0 }}>
                      이번 달 등록된 TEYEON 일정이 없습니다.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 대회 일정 섹션 — 필터 'club' 일 때 숨김 */}
        {(calendarFilter !== 'club') && (
          <div
            style={{
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setMonthlyTournamentOpen((p) => !p)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 11, paddingRight: 14, paddingBottom: 11, paddingLeft: 14,
                border: 'none', backgroundColor: 'transparent',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#D4AF37', flexShrink: 0 }} />
                <p style={{ fontSize: 13.5, fontWeight: 800, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>
                  대회 일정
                </p>
                <span
                  style={{
                    fontSize: 10, fontWeight: 800, color: '#0D9488',
                    paddingTop: 1, paddingRight: 7, paddingBottom: 1, paddingLeft: 7, borderRadius: 99,
                    backgroundColor: 'rgba(13,148,136,0.10)',
                    border: '1px solid rgba(13,148,136,0.20)',
                  }}
                >
                  {monthEvents.length}건
                </span>
              </div>
              <ChevronDown
                size={15}
                style={{ color: '#94A3B8', transition: 'transform 0.2s', transform: monthlyTournamentOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            {monthlyTournamentOpen && (
              <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                {monthEvents.length > 0 ? (
                  monthEvents.map((event, idx) => {
                    const org = ORG_STYLE[event.organizer];
                    const isPastEvent = !!event.date && event.date < todayKey;
                    const displayStatus = isPastEvent ? '대회종료' : event.status;
                    const st = STATUS_STYLE[displayStatus];
                    const [, mm, dd] = event.date.split('-');
                    return (
                      <button
                        type="button"
                        key={event.id}
                        onClick={() => {
                          setSelectedDate(event.date);
                          setExpandedCardId(null);
                          setMonthlyTournamentOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center',
                          gap: 10,
                          paddingTop: 10, paddingRight: 14, paddingBottom: 10, paddingLeft: 14,
                          border: 'none',
                          backgroundColor: isPastEvent
                            ? (idx % 2 === 0 ? '#FBFCFD' : '#F8FAFB')
                            : (idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA'),
                          cursor: 'pointer', borderTop: idx === 0 ? 'none' : '1px solid rgba(0,0,0,0.04)',
                          textAlign: 'left', WebkitTapHighlightColor: 'transparent',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ textAlign: 'center', flexShrink: 0, width: 28 }}>
                          <p style={{ fontSize: 14, fontWeight: 800, color: isPastEvent ? '#94A3B8' : '#0F172A', margin: 0, lineHeight: 1 }}>
                            {parseInt(dd)}
                          </p>
                          <p style={{ fontSize: 9, fontWeight: 600, color: '#94A3B8', margin: '1px 0 0' }}>
                            {parseInt(mm)}월
                          </p>
                        </div>
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                          <p style={{ fontSize: 13, fontWeight: 700, color: isPastEvent ? '#64748B' : '#1E293B', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {event.title}
                          </p>
                          <p style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {event.venue}
                          </p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 8, fontWeight: 800, letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            paddingTop: 1, paddingRight: 5, paddingBottom: 1, paddingLeft: 5, borderRadius: 4,
                            backgroundColor: org.bg, color: org.color, border: `1px solid ${org.border}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {org.badge}
                          </span>
                          <span style={{
                            fontSize: 8, fontWeight: 700,
                            paddingTop: 1, paddingRight: 5, paddingBottom: 1, paddingLeft: 5, borderRadius: 4,
                            backgroundColor: st.bg, color: st.color, border: `1px solid ${st.border}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {displayStatus}
                          </span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div style={{ paddingTop: 24, paddingRight: 14, paddingBottom: 24, paddingLeft: 14, textAlign: 'center' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#CBD5E1', margin: 0 }}>
                      이번 달 등록된 대회 일정이 없습니다.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tournament Editor modal ── */}
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

      {/* ── CSV upload modal (CEO / ADMIN 전용) ── */}
      {isCSVUploadOpen && (
        <TournamentCSVUploadModal
          existingEvents={events}
          userId={user?.id}
          onComplete={() => { loadEvents(); }}
          onClose={() => setIsCSVUploadOpen(false)}
        />
      )}

      {/* ── Club Schedule Editor modal ── */}
      {isClubEditorOpen && (
        <ClubScheduleEditorModal
          schedule={editingClubSchedule}
          isSaving={isSavingClub}
          onClose={() => {
            if (isSavingClub) return;
            setIsClubEditorOpen(false);
            setEditingClubSchedule(null);
          }}
          onSave={handleSaveClubSchedule}
          onDelete={handleDeleteClubSchedule}
        />
      )}
    </main>
  );
}

// ─── TournamentEventEditorModal (원본 유지) ───────────────────────────────────

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
            <div className="sm:col-span-2">
              <ChipSelector
                label="주관"
                value={form.organizer}
                options={organizerOptions}
                onChange={(v) => updateField('organizer', v as TournamentEvent['organizer'])}
              />
            </div>
            <div className="sm:col-span-2">
              <ChipSelector
                label="부서"
                value={form.division}
                options={divisionOptions}
                onChange={(v) => updateField('division', v as TournamentEvent['division'])}
              />
            </div>
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

// ─── ChipSelector ─────────────────────────────────────────────────────────────

function ChipSelector<T extends string>({
  label,
  value,
  options,
  onChange,
  note,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
  note?: string;
}) {
  return (
    <div>
      <span
        style={{
          display: 'block',
          marginBottom: 8,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase' as const,
          color: '#64748B',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {options.map((option) => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: active ? '1.5px solid #0D9488' : '1px solid rgba(0,0,0,0.12)',
                backgroundColor: active ? 'rgba(13,148,136,0.09)' : '#FFFFFF',
                color: active ? '#0D9488' : '#475569',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.14s',
                whiteSpace: 'nowrap' as const,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {option}
            </button>
          );
        })}
      </div>
      {note && (
        <p style={{ marginTop: 6, fontSize: 10, fontWeight: 600, color: '#D97706' }}>
          {note}
        </p>
      )}
    </div>
  );
}

// ─── SelectField (원본 유지) ──────────────────────────────────────────────────

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
