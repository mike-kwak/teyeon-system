// TENNIS LOG 기록 캘린더 — 로컬 날짜 유틸.
//   date-only('YYYY-MM-DD') 값은 절대 new Date('YYYY-MM-DD')로 파싱하지 않는다
//   (UTC 자정으로 파싱돼 한국 시간에서 하루 밀리는 문제 방지).
//   · grouping/표시: 'YYYY-MM-DD' 문자열을 직접 분해.
//   · 달력 격자 계산: 숫자 인자 Date(로컬 기준)만 사용 → 시차 영향 없음.

export interface CalendarCell {
  iso: string; // 'YYYY-MM-DD'
  day: number; // 1..31
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 로컬 기준 'YYYY-MM-DD' 포맷(숫자 → 문자열). 달력 셀 key 도 이걸로 생성. */
export function formatLocalISO(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 오늘(로컬) 'YYYY-MM-DD'. 인자 없는 new Date() 는 로컬 now 이므로 시차 문제 없음. */
export function todayLocalISO(): string {
  const now = new Date();
  return formatLocalISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 'YYYY-MM-DD' → {year, month, day}. 형식 불일치면 null. */
export function parseISO(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 'YYYY-MM-DD' → 'YYYY년 M월 D일'(표시/aria-label용). */
export function formatKoreanDate(iso: string): string {
  const p = parseISO(iso);
  return p ? `${p.year}년 ${p.month}월 ${p.day}일` : iso;
}

/** 선택 월 조회 범위: [start 포함, endExclusive 미만) = 다음 달 1일. */
export function monthRange(year: number, month: number): { start: string; endExclusive: string } {
  const start = formatLocalISO(year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start, endExclusive: formatLocalISO(nextYear, nextMonth, 1) };
}

/** 월간 달력 격자 — 일요일 시작, 주 단위 배열. 빈 칸은 null. */
export function buildMonthGrid(year: number, month: number): (CalendarCell | null)[][] {
  const firstWeekday = new Date(year, month - 1, 1).getDay(); // 0=일 (로컬)
  const daysInMonth = new Date(year, month, 0).getDate(); // 말일 (로컬)
  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push({ iso: formatLocalISO(year, month, d), day: d });
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (CalendarCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 이전/다음 달 계산(로컬, 연도 경계 안전). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
