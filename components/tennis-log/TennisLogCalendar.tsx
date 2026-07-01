'use client';

// TENNIS LOG 기록 캘린더 — 홈에 접힘 기본으로 붙는 개인 기록 월간 달력.
//   · 기존 대회/레슨 기록을 날짜 기준으로 조회해 dot 표시(신규 DB/RLS 없음).
//   · 두 상태 분리: (1) 현재 화면 펼침(expanded) (2) 다음 방문 자동 펼침(pinned, localStorage).
//   · 핀 토글은 펼침/접힘을 바꾸지 않는다.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pin,
  RotateCcw,
} from 'lucide-react';
import { listTournamentsByDateRange } from '@/lib/tennisLogTournamentService';
import { listLessonsByDateRange } from '@/lib/tennisLogLessonService';
import {
  buildMonthGrid,
  formatKoreanDate,
  formatLocalISO,
  monthRange,
  parseISO,
  shiftMonth,
  todayLocalISO,
  WEEKDAY_LABELS,
} from '@/lib/tennisLogCalendarUtils';
import {
  displayFinalResult,
  displayParticipationCategory,
  type TennisLessonRecord,
  type TournamentRecord,
} from '@/types/tennisLog';

// Cool Premium Light 토큰(홈과 동일 값 유지).
const NAVY = '#0F1B33';
const TEAL = '#0E7C76';
const AQUA = '#4B9DB6';
const GOLD = '#C2A24E'; // 대회 dot 전용 warm accent(절제 사용).
const INK = '#0F172A';
const SUB = '#64748B';
const FAINT = '#94A3B8';
const CARD_BORDER = 'rgba(0,0,0,0.06)';

const PIN_KEY_PREFIX = 'teyeon:tennis-log:calendar-pinned:';

function pinStorageKey(userId: string): string {
  return `${PIN_KEY_PREFIX}${userId}`;
}
function readPinned(userId: string | null): boolean {
  if (!userId || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(pinStorageKey(userId)) === 'true';
  } catch {
    return false;
  }
}
function writePinned(userId: string | null, value: boolean): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(pinStorageKey(userId), value ? 'true' : 'false');
  } catch {
    /* 저장 실패해도 화면은 정상 동작 */
  }
}

interface Props {
  userId: string | null;
  onToast?: (message: string) => void;
}

export default function TennisLogCalendar({ userId, onToast }: Props) {
  const router = useRouter();
  const today = todayLocalISO();
  const todayParts = parseISO(today) ?? { year: 2000, month: 1, day: 1 };

  // (1) 펼침 상태 · (2) 핀 상태 — 분리. 둘 다 pin(localStorage)에서 초기화(깜빡임 없이 첫 페인트부터 반영).
  const [pinned, setPinned] = useState<boolean>(() => readPinned(userId));
  const [expanded, setExpanded] = useState<boolean>(() => readPinned(userId));
  const pinHydrated = useRef<boolean>(false);

  const [view, setView] = useState<{ year: number; month: number }>({
    year: todayParts.year,
    month: todayParts.month,
  });
  const [selected, setSelected] = useState<string>(today);
  const [showPicker, setShowPicker] = useState(false);

  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  const [lessons, setLessons] = useState<TennisLessonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const reqRef = useRef(0);

  // userId 가 첫 렌더 이후 확정되는 경우 대비(초기 lazy-init 가 false 였을 때만 1회 보정).
  useEffect(() => {
    if (pinHydrated.current || !userId) return;
    pinHydrated.current = true;
    const p = readPinned(userId);
    setPinned(p);
    setExpanded(p);
  }, [userId]);

  // 월 데이터 로드 — 마운트(현재 월, 접힘 요약용) + 월 이동 시. 오래된 응답이 최신 월을 덮지 않게 reqRef 가드.
  const loadMonth = useCallback(async () => {
    if (!userId) return;
    const my = reqRef.current + 1;
    reqRef.current = my;
    setLoading(true);
    setHasError(false);
    const { start, endExclusive } = monthRange(view.year, view.month);
    try {
      const [tRes, lRes] = await Promise.all([
        listTournamentsByDateRange(start, endExclusive),
        listLessonsByDateRange(start, endExclusive),
      ]);
      if (my !== reqRef.current) return; // stale 응답 폐기
      if (tRes.error || lRes.error) {
        setHasError(true);
        setLoading(false);
        return;
      }
      setTournaments(tRes.data ?? []);
      setLessons(lRes.data ?? []);
      setLoading(false);
    } catch {
      if (my !== reqRef.current) return;
      setHasError(true);
      setLoading(false);
    }
  }, [userId, view.year, view.month]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  const isCurrentMonth = view.year === todayParts.year && view.month === todayParts.month;

  // 날짜별 기록 존재 dot(종류별 1개). 조회 결과는 이미 view 월 범위로 제한됨.
  const tournamentDates = useMemo(
    () => new Set(tournaments.map((t) => t.tournament_date)),
    [tournaments],
  );
  const lessonDates = useMemo(() => new Set(lessons.map((l) => l.lesson_date)), [lessons]);

  const selectedTournaments = useMemo(
    () => tournaments.filter((t) => t.tournament_date === selected),
    [tournaments, selected],
  );
  const selectedLessons = useMemo(
    () => lessons.filter((l) => l.lesson_date === selected),
    [lessons, selected],
  );

  const weeks = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month]);

  // ── 동작 핸들러 ──────────────────────────────────────────────────────────
  const togglePin = () => {
    const next = !pinned;
    setPinned(next); // 펼침 상태는 건드리지 않는다.
    writePinned(userId, next);
    onToast?.(
      next ? '기록 캘린더가 홈에 고정되었습니다.' : '다음 방문부터 기본 접힘으로 표시됩니다.',
    );
  };

  const goMonth = (delta: number) => {
    const next = shiftMonth(view.year, view.month, delta);
    setView(next);
    setSelected(formatLocalISO(next.year, next.month, 1)); // 이전 월 선택/기록이 남지 않게 새 월 1일로 이동.
    setShowPicker(false);
  };

  const goToday = () => {
    const t = todayLocalISO();
    const p = parseISO(t);
    if (p) setView({ year: p.year, month: p.month });
    setSelected(t);
    setShowPicker(false);
  };

  const pickYearMonth = (year: number, month: number) => {
    setView({ year, month });
    setSelected(formatLocalISO(year, month, 1));
  };

  const years = useMemo(() => {
    const base = todayParts.year;
    const list: number[] = [];
    for (let y = base + 1; y >= base - 10; y -= 1) list.push(y);
    return list;
  }, [todayParts.year]);

  const summaryText = (() => {
    if (loading) return '이번 달 기록 불러오는 중…';
    if (hasError) return '기록을 불러오지 못했습니다.';
    const prefix = isCurrentMonth ? '이번 달' : `${view.year}년 ${view.month}월`;
    if (tournaments.length === 0 && lessons.length === 0) {
      return `${prefix}에 기록된 대회와 레슨이 없습니다.`;
    }
    return `${prefix} 대회 ${tournaments.length} · 레슨 ${lessons.length}`;
  })();

  return (
    <section
      style={{
        marginBottom: 18,
        backgroundColor: '#FFFFFF',
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}
    >
      {/* 헤더(접힘/펼침 공통) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 12px 13px 15px',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            minWidth: 34,
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(14,124,118,0.10)',
            color: TEAL,
          }}
        >
          <CalendarDays size={18} strokeWidth={1.9} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em' }}>
            기록 캘린더
          </p>
          {!expanded && (
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 11.5,
                fontWeight: 600,
                color: tournaments.length + lessons.length > 0 && !loading && !hasError ? SUB : FAINT,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {summaryText}
            </p>
          )}
        </div>

        {/* 핀 — 펼침/접힘과 독립. */}
        <button
          type="button"
          onClick={togglePin}
          aria-pressed={pinned}
          aria-label={pinned ? '기록 캘린더 고정 해제' : '기록 캘린더 홈에 고정'}
          style={{
            width: 44,
            height: 44,
            minWidth: 44,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pinned ? 'rgba(14,124,118,0.12)' : 'transparent',
              color: pinned ? TEAL : FAINT,
              border: pinned ? `1px solid rgba(14,124,118,0.30)` : `1px solid ${CARD_BORDER}`,
            }}
          >
            <Pin size={16} strokeWidth={2} fill={pinned ? TEAL : 'none'} />
          </span>
        </button>

        {/* 펼치기/접기 */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? '기록 캘린더 접기' : '기록 캘린더 펼치기'}
          style={{
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '0 8px 0 10px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11.5,
            fontWeight: 800,
            color: TEAL,
            whiteSpace: 'nowrap',
          }}
        >
          {expanded ? '접기' : '캘린더 보기'}
          {expanded ? (
            <ChevronUp size={15} strokeWidth={2.4} />
          ) : (
            <ChevronDown size={15} strokeWidth={2.4} />
          )}
        </button>
      </div>

      {/* 펼친 본문 */}
      {expanded && (
        <div style={{ padding: '0 12px 14px', borderTop: `1px solid ${CARD_BORDER}` }}>
          {/* 월 네비게이션 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              margin: '12px 0 8px',
            }}
          >
            <NavButton ariaLabel="이전 달" onClick={() => goMonth(-1)}>
              <ChevronLeft size={18} strokeWidth={2.2} />
            </NavButton>
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              aria-expanded={showPicker}
              aria-label="연도·월 선택"
              style={{
                flex: 1,
                minWidth: 0,
                height: 38,
                borderRadius: 10,
                border: `1px solid ${CARD_BORDER}`,
                backgroundColor: showPicker ? 'rgba(14,124,118,0.06)' : '#FFFFFF',
                color: NAVY,
                fontSize: 14.5,
                fontWeight: 800,
                letterSpacing: '-0.01em',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              {view.year}년 {view.month}월
              <ChevronDown size={14} strokeWidth={2.2} style={{ color: SUB }} />
            </button>
            <NavButton ariaLabel="다음 달" onClick={() => goMonth(1)}>
              <ChevronRight size={18} strokeWidth={2.2} />
            </NavButton>
            <button
              type="button"
              onClick={goToday}
              aria-label="오늘로 이동"
              style={{
                height: 38,
                padding: '0 12px',
                borderRadius: 10,
                border: `1px solid ${CARD_BORDER}`,
                backgroundColor: '#FFFFFF',
                color: TEAL,
                fontSize: 12.5,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              오늘
            </button>
          </div>

          {/* 연·월 빠른 선택 */}
          {showPicker && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <select
                aria-label="연도 선택"
                value={view.year}
                onChange={(e) => pickYearMonth(Number(e.target.value), view.month)}
                style={selectStyle}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
              <select
                aria-label="월 선택"
                value={view.month}
                onChange={(e) => pickYearMonth(view.year, Number(e.target.value))}
                style={selectStyle}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 범례 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '2px 2px 8px' }}>
            <LegendDot color={GOLD} label="대회" />
            <LegendDot color={AQUA} label="레슨" />
          </div>

          {/* 요일 헤더 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {WEEKDAY_LABELS.map((w, i) => (
              <div
                key={w}
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: i === 0 ? '#C2564B' : i === 6 ? '#3F72A6' : FAINT,
                  padding: '2px 0 6px',
                }}
              >
                {w}
              </div>
            ))}
          </div>

          {/* 월간 격자(고정 높이 — 로딩 중에도 흔들리지 않음) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {week.map((cell, ci) => {
                  if (!cell) return <div key={ci} style={{ height: 44 }} />;
                  const isSelected = cell.iso === selected;
                  const isToday = cell.iso === today;
                  const hasT = tournamentDates.has(cell.iso);
                  const hasL = lessonDates.has(cell.iso);
                  const aria =
                    formatKoreanDate(cell.iso) +
                    (hasT ? ', 대회 기록 있음' : '') +
                    (hasL ? ', 레슨 기록 있음' : '');
                  return (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => setSelected(cell.iso)}
                      aria-label={aria}
                      aria-selected={isSelected}
                      style={{
                        height: 44,
                        border: isToday && !isSelected ? `1.5px solid ${TEAL}` : '1.5px solid transparent',
                        borderRadius: 11,
                        backgroundColor: isSelected ? TEAL : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                        padding: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: isSelected || isToday ? 800 : 600,
                          color: isSelected ? '#FFFFFF' : INK,
                          lineHeight: 1,
                        }}
                      >
                        {cell.day}
                      </span>
                      <span style={{ display: 'flex', gap: 3, height: 5, alignItems: 'center' }}>
                        {hasT && (
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: '50%',
                              backgroundColor: isSelected ? '#FFFFFF' : GOLD,
                            }}
                          />
                        )}
                        {hasL && (
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: '50%',
                              backgroundColor: isSelected ? 'rgba(255,255,255,0.72)' : AQUA,
                            }}
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 선택 날짜 기록 */}
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: '0 2px 8px', fontSize: 12, fontWeight: 800, color: NAVY }}>
              {formatKoreanDate(selected)} 기록
            </p>

            {hasError ? (
              <div
                style={{
                  border: `1px solid rgba(194,86,75,0.30)`,
                  backgroundColor: 'rgba(194,86,75,0.06)',
                  borderRadius: 12,
                  padding: '16px 14px',
                  textAlign: 'center',
                }}
              >
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#9B3D34' }}>
                  기록을 불러오지 못했습니다.
                </p>
                <button
                  type="button"
                  onClick={() => void loadMonth()}
                  style={{
                    marginTop: 10,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 38,
                    padding: '0 16px',
                    borderRadius: 10,
                    border: 'none',
                    backgroundColor: TEAL,
                    color: '#FFFFFF',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw size={14} strokeWidth={2.4} />
                  다시 시도
                </button>
              </div>
            ) : loading ? (
              <div
                style={{
                  minHeight: 74,
                  borderRadius: 12,
                  border: `1px dashed ${CARD_BORDER}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: FAINT,
                }}
              >
                불러오는 중…
              </div>
            ) : selectedTournaments.length + selectedLessons.length === 0 ? (
              <div
                style={{
                  minHeight: 74,
                  borderRadius: 12,
                  border: `1px dashed rgba(15,27,51,0.14)`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '16px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: FAINT,
                  wordBreak: 'keep-all',
                }}
              >
                이 날짜에 작성한 기록이 없습니다.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {selectedTournaments.map((t) => (
                  <CalendarTournamentCard
                    key={t.id}
                    record={t}
                    onClick={() => router.push(`/tennis-log/tournaments/${t.id}`)}
                  />
                ))}
                {selectedLessons.map((l) => (
                  <CalendarLessonCard
                    key={l.id}
                    record={l}
                    onClick={() => router.push(`/tennis-log/lessons/${l.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── 보조 컴포넌트 ───────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 40,
  borderRadius: 10,
  border: `1px solid ${CARD_BORDER}`,
  backgroundColor: '#FFFFFF',
  color: NAVY,
  fontSize: 13.5,
  fontWeight: 700,
  padding: '0 10px',
  cursor: 'pointer',
  boxSizing: 'border-box',
};

function NavButton({
  children,
  ariaLabel,
  onClick,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        width: 38,
        height: 38,
        minWidth: 38,
        borderRadius: 10,
        border: `1px solid ${CARD_BORDER}`,
        backgroundColor: '#FFFFFF',
        color: SUB,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: color }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: SUB }}>{label}</span>
    </span>
  );
}

function CalendarTournamentCard({ record, onClick }: { record: TournamentRecord; onClick: () => void }) {
  const category = displayParticipationCategory(record);
  const meta = [record.event_type, category, record.partner_name]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(' · ');
  return (
    <button type="button" onClick={onClick} style={cardStyle} className="active:scale-[0.99]">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: GOLD, flexShrink: 0 }} />
          <span style={cardTitleStyle}>{record.tournament_name}</span>
        </span>
        <span style={chipStyle(GOLD)}>{displayFinalResult(record)}</span>
      </div>
      {meta && <p style={cardMetaStyle}>{meta}</p>}
      {record.one_line_review && <p style={cardBodyStyle}>{record.one_line_review}</p>}
    </button>
  );
}

function CalendarLessonCard({ record, onClick }: { record: TennisLessonRecord; onClick: () => void }) {
  const summary = (record.learned_points || '').trim();
  const secondary = (record.correction_points || record.practice_tasks || '').trim();
  return (
    <button type="button" onClick={onClick} style={cardStyle} className="active:scale-[0.99]">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: AQUA, flexShrink: 0 }} />
          <span style={cardTitleStyle}>{record.lesson_topic}</span>
        </span>
        {record.coach_name && (
          <span style={{ fontSize: 11, fontWeight: 700, color: SUB, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {record.coach_name}
          </span>
        )}
      </div>
      {summary && <p style={cardMetaStyle}>{summary}</p>}
      {secondary && <p style={cardBodyStyle}>{secondary}</p>}
    </button>
  );
}

const cardStyle: React.CSSProperties = {
  textAlign: 'left',
  width: '100%',
  boxSizing: 'border-box',
  backgroundColor: '#FFFFFF',
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: 13,
  boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  cursor: 'pointer',
};
const cardTitleStyle: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 800,
  color: INK,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const cardMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  fontWeight: 600,
  color: '#586478',
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'keep-all',
};
const cardBodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  fontWeight: 500,
  color: FAINT,
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  wordBreak: 'keep-all',
};
function chipStyle(color: string): React.CSSProperties {
  return {
    flexShrink: 0,
    padding: '3px 9px',
    borderRadius: 999,
    backgroundColor: `${color}1F`,
    color: '#7A5E1B',
    fontSize: 11,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    maxWidth: '48%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}
