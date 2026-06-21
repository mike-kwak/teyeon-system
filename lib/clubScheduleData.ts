// Club Schedule 전용 타입 / 상수 / 유틸.
// Tournament Schedule과 완전 분리 — tournament_events 관련 파일은 건드리지 않음.
// TODO: 정모 참석 체크 (참석/불참/미정), 시간대별 체크, 파트너 댓글 등은 별도 테이블로 확장 예정.
// TODO: KDK 운영 세션은 추후 특정 정모 일정에 연결 가능 (club_schedules.id FK 방향).
// TODO: Archive 공식 기록 / Finance 게스트비·코트비와 연결 예정.

export type ClubScheduleType = '정모' | '번개' | '단체전 연습' | '회식' | '기타';

/**
 * 코트 운영 방식
 *  - fixed:      고정 코트 수 (court_count 사용)
 *  - unknown:    미정
 *  - na:         해당 없음 (회식 등)
 *  - first_come: 선착순 (이순신처럼 코트 수 확정 안 됨)
 */
export type ClubCourtMode = 'fixed' | 'unknown' | 'na' | 'first_come';

export const CLUB_COURT_MODES: { value: ClubCourtMode; label: string }[] = [
  { value: 'fixed',      label: '고정 코트' },
  { value: 'unknown',    label: '미정' },
  { value: 'na',         label: 'N/A' },
  { value: 'first_come', label: '선착순' },
];

/** 카드/상세 표시용 코트 라벨. fixed면 숫자 사용, 나머지는 모드 라벨. */
export function formatCourtLabel(mode?: ClubCourtMode | null, count?: number | null): string {
  if (mode === 'fixed') {
    if (count && count > 0) return `코트 ${count}면`;
    return '코트 1면';
  }
  if (mode === 'first_come') return '선착순 코트';
  if (mode === 'na')         return '코트 N/A';
  if (mode === 'unknown')    return '코트 미정';
  // 모드 미지정 (구버전 데이터) — count가 있으면 fixed처럼, 없으면 미정.
  if (count && count > 0) return `코트 ${count}면`;
  return '코트 미정';
}

export interface ClubSchedule {
  id: string;
  title: string;
  schedule_type: ClubScheduleType;
  schedule_date: string;   // YYYY-MM-DD
  start_time?: string;     // HH:MM (24h, DB time 타입)
  end_time?: string;
  location?: string;
  court_count?: number;
  court_mode?: ClubCourtMode;     // add_club_schedule_court_mode.sql 적용 후 사용. 기본 fixed.
  guest_enabled: boolean;
  guest_limit?: number;    // null = 인원 제한 없음, 숫자 = 지정 인원
  fee_amount?: number;     // 원 단위
  show_on_main: boolean;
  memo?: string;
  created_by?: string;     // auth.users.id
  // ── 참석 체크 운영 설정 (add_club_schedule_attendance_settings.sql 적용 후 사용) ──
  attendance_enabled?: boolean;        // false → 참석 체크 UI 숨김. default true
  attendance_deadline?: string | null; // ISO timestamp. null이면 일정 시작 시각 전까지 수정 가능
}

// 에디터 입력 타입 — id 없으면 신규 등록
export type ClubScheduleInput = Omit<ClubSchedule, 'id' | 'created_by'> & { id?: string };

export const CLUB_SCHEDULE_TYPES: ClubScheduleType[] = [
  '정모', '번개', '단체전 연습', '회식', '기타',
];

export const CLUB_TYPE_STYLE: Record<ClubScheduleType, {
  badge: string;
  bg: string;
  color: string;
  border: string;
}> = {
  '정모':      { badge: '정모',    bg: 'rgba(99,102,241,0.09)',  color: '#3730A3', border: 'rgba(99,102,241,0.28)'  },
  '번개':      { badge: '번개',    bg: 'rgba(245,158,11,0.09)',  color: '#92400E', border: 'rgba(245,158,11,0.24)'  },
  '단체전 연습': { badge: '단체전', bg: 'rgba(16,185,129,0.09)', color: '#065F46', border: 'rgba(16,185,129,0.24)'  },
  '회식':      { badge: '회식',    bg: 'rgba(239,68,68,0.09)',   color: '#991B1B', border: 'rgba(239,68,68,0.22)'   },
  '기타':      { badge: '기타',    bg: 'rgba(100,116,139,0.09)', color: '#334155', border: 'rgba(100,116,139,0.20)' },
};

// 캘린더 dot 색상 — teal(접수)/gold(경기) 와 구분
export const CLUB_DOT_COLOR = '#6366F1'; // indigo

// HH:MM → "오전 H:MM" / "오후 H:MM"
export function formatClubTime(time?: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const ampm = h < 12 ? '오전' : '오후';
  const hour  = h % 12 || 12;
  return `${ampm} ${hour}:${String(m).padStart(2, '0')}`;
}

export function formatClubTimeRange(start?: string, end?: string): string {
  if (!start && !end) return '';
  if (start && end) return `${formatClubTime(start)} ~ ${formatClubTime(end)}`;
  if (start) return `${formatClubTime(start)} 시작`;
  return `~ ${formatClubTime(end)}`;
}

// ── 공통 시간 포맷 (PM 07:00 ~ 10:00 / AM 09:00 ~ PM 12:00) ────────────────
// 'HH:MM' 또는 'HH:MM:SS'(DB time) 입력 모두 허용. 초는 제거.

const trimSeconds = (t?: string): string => (t ? t.slice(0, 5) : '');

function toAmPmPart(time: string): { ampm: 'AM' | 'PM'; hh: string; mm: string } {
  const [hStr, mStr] = trimSeconds(time).split(':');
  const h = Number(hStr || 0);
  const m = Number(mStr || 0);
  const ampm: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
  const hh12 = h % 12 || 12;
  return { ampm, hh: String(hh12).padStart(2, '0'), mm: String(m).padStart(2, '0') };
}

/**
 * 표시 형식 통일:
 *  - 시작/종료 ampm이 같으면 한 번만:        "PM 07:00 ~ 10:00"
 *  - 시작/종료 ampm이 다르면 각각:           "AM 11:00 ~ PM 02:00"
 *  - 시작만 있으면:                          "PM 07:00 시작"
 *  - 종료만 있으면:                          "~ PM 10:00"
 *  - 둘 다 없으면 빈 문자열
 */
export function formatTimeRangeAmPm(start?: string, end?: string): string {
  const s = trimSeconds(start);
  const e = trimSeconds(end);
  if (!s && !e) return '';
  if (s && !e) {
    const sp = toAmPmPart(s);
    return `${sp.ampm} ${sp.hh}:${sp.mm} 시작`;
  }
  if (!s && e) {
    const ep = toAmPmPart(e);
    return `~ ${ep.ampm} ${ep.hh}:${ep.mm}`;
  }
  const sp = toAmPmPart(s);
  const ep = toAmPmPart(e);
  if (sp.ampm === ep.ampm) {
    return `${sp.ampm} ${sp.hh}:${sp.mm} ~ ${ep.hh}:${ep.mm}`;
  }
  return `${sp.ampm} ${sp.hh}:${sp.mm} ~ ${ep.ampm} ${ep.hh}:${ep.mm}`;
}

// Demo data — DB 연결 전 fallback (club_schedules 테이블이 없어도 화면에 표시됨)
export const demoClubSchedules: ClubSchedule[] = [
  {
    id: 'demo-club-1',
    title: '6월 정기 정모',
    schedule_type: '정모',
    schedule_date: '2026-06-14',
    start_time: '10:00',
    end_time: '14:00',
    location: '문래 테니스장',
    court_count: 3,
    guest_enabled: true,
    guest_limit: 4,
    fee_amount: 5000,
    show_on_main: true,
    memo: '점심 회식 예정. 파트너 미정인 멤버 우선 배정.',
  },
  {
    id: 'demo-club-2',
    title: '6월 번개 정모',
    schedule_type: '번개',
    schedule_date: '2026-06-21',
    start_time: '09:00',
    end_time: '12:00',
    location: '올림픽공원 테니스장',
    court_count: 2,
    guest_enabled: false,
    show_on_main: false,
    memo: '',
  },
];
