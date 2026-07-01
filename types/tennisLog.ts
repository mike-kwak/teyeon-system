// TENNIS LOG — 개인 기록 타입(외부 대회 + 레슨일지).
// DB: public.tennis_log_tournaments, public.tennis_log_lessons
//
// 네이밍: DB row 와 1:1 대응되는 snake_case 필드를 사용한다(대회 기록 TournamentRecord 와 동일 관례).
//   지시문의 camelCase 권장(TennisLessonLog)은 기존 tennis-log 모듈 관례와 충돌하므로,
//   일관성을 위해 snake_case 로 조정하되 의미는 동일하게 유지한다.

export type TournamentMatchOutcome = 'win' | 'loss' | 'draw' | 'other';

/** 경기별 결과 — 1차에서는 별도 테이블 없이 match_results jsonb 배열로 저장.
 *  id 는 DB row id 가 아니라 클라이언트 배열 항목 식별용 문자열. */
export interface TournamentMatchResult {
  id: string;
  stage: string;
  opponent: string;
  scoreFor: string;
  scoreAgainst: string;
  result: TournamentMatchOutcome;
  memo?: string;
}

/** DB row 와 1:1 대응되는 대회 기록. */
export interface TournamentRecord {
  id: string;
  owner_user_id: string;
  tournament_date: string; // 'YYYY-MM-DD'
  tournament_name: string;
  region: string | null;
  venue: string | null;
  event_type: string;
  participation_category: string | null;
  participation_category_custom: string | null;
  partner_name: string | null;
  final_result: string;
  result_detail: string | null;
  condition_rating: number | null;
  one_line_review: string;
  good_points: string | null;
  improvements: string | null;
  next_goal: string | null;
  partner_memo: string | null;
  match_results: TournamentMatchResult[];
  created_at: string;
  updated_at: string;
}

/** 생성/수정 입력값(owner_user_id·id·타임스탬프 제외). */
export interface TournamentRecordInput {
  tournament_date: string;
  tournament_name: string;
  region?: string | null;
  venue?: string | null;
  event_type: string;
  participation_category?: string | null;
  participation_category_custom?: string | null;
  partner_name?: string | null;
  final_result: string;
  result_detail?: string | null;
  condition_rating?: number | null;
  one_line_review: string;
  good_points?: string | null;
  improvements?: string | null;
  next_goal?: string | null;
  partner_memo?: string | null;
  match_results: TournamentMatchResult[];
}

// ── 종목(event_type) ─────────────────────────────────────────────────────────
// partnerRequired: 복식·혼합복식은 파트너 필수. 단식은 불필요, 단체전·기타는 선택.
export interface EventTypeOption {
  value: string;
  partnerRequired: boolean;
}

export const EVENT_TYPE_OPTIONS: EventTypeOption[] = [
  { value: '단식', partnerRequired: false },
  { value: '남자 복식', partnerRequired: true },
  { value: '여자 복식', partnerRequired: true },
  { value: '혼합 복식', partnerRequired: true },
  { value: '단체전', partnerRequired: false },
  { value: '기타', partnerRequired: false },
];

export function isPartnerRequired(eventType: string): boolean {
  return EVENT_TYPE_OPTIONS.find((o) => o.value === eventType)?.partnerRequired ?? false;
}

// ── 참가 구분(participation_category) ─────────────────────────────────────────
// 엄밀한 부서명이 아니라 사용자 입력 편의를 위한 '참가 구분'. '기타'는 직접 입력.
export const PARTICIPATION_CATEGORY_CUSTOM_VALUE = '기타';

export const PARTICIPATION_CATEGORY_OPTIONS: string[] = [
  '신인부',
  '오픈부',
  '지역대회',
  PARTICIPATION_CATEGORY_CUSTOM_VALUE,
];

/** 참가 구분 표시값 — '기타'면 직접 입력값 우선. 없으면 null(숨김). */
export function displayParticipationCategory(
  r: Pick<TournamentRecord, 'participation_category' | 'participation_category_custom'>,
): string | null {
  const c = (r.participation_category || '').trim();
  if (!c) return null;
  if (c === PARTICIPATION_CATEGORY_CUSTOM_VALUE) {
    return (r.participation_category_custom || '').trim() || '기타';
  }
  return c;
}

// ── 최종 성적(final_result) ──────────────────────────────────────────────────
// 칩 표시는 짧게('예탈'), 접근성/상세 문구는 길게('예선 탈락').
// '본선' 선택 시 result_detail(본선 상세) 필수 → 표시: '본선 · {detail}'.
export const FINAL_RESULT_DETAIL_TRIGGER = '본선';

export const FINAL_RESULT_OPTIONS: string[] = ['우승', '준우승', '4강', '8강', '본선', '예탈'];

const FINAL_RESULT_LONG_LABEL: Record<string, string> = {
  예탈: '예선 탈락',
};

/** 칩/상세에서 쓰는 전체 표기('예탈' → '예선 탈락'). 매핑이 없으면 원문. */
export function finalResultLongLabel(value: string): string {
  return FINAL_RESULT_LONG_LABEL[value] ?? value;
}

// ── 경기 승패 표시 ───────────────────────────────────────────────────────────
export const MATCH_OUTCOME_OPTIONS: { value: TournamentMatchOutcome; label: string }[] = [
  { value: 'win', label: '승' },
  { value: 'loss', label: '패' },
  { value: 'draw', label: '무' },
  { value: 'other', label: '기타' },
];

export function matchOutcomeLabel(outcome: TournamentMatchOutcome): string {
  return MATCH_OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? '기타';
}

/** 최종 성적 표시값 — '본선'이면 '본선 · {result_detail}', '예탈'이면 '예선 탈락'. */
export function displayFinalResult(record: Pick<TournamentRecord, 'final_result' | 'result_detail'>): string {
  if (record.final_result === FINAL_RESULT_DETAIL_TRIGGER) {
    const detail = (record.result_detail || '').trim();
    return detail ? `본선 · ${detail}` : '본선';
  }
  return finalResultLongLabel(record.final_result);
}

// ── 레슨일지 (DB: public.tennis_log_lessons) ─────────────────────────────────

/** DB row 와 1:1 대응되는 레슨일지 기록. */
export interface TennisLessonRecord {
  id: string;
  owner_user_id: string;
  lesson_date: string; // 'YYYY-MM-DD'
  coach_name: string | null;
  lesson_topic: string; // 레슨 주제
  learned_points: string; // 오늘 배운 핵심 내용
  correction_points: string | null; // 자세/동작 교정 포인트
  practice_tasks: string | null; // 다음 레슨 전 연습 과제
  next_goal: string | null; // 현재 연습 목표로 사용
  free_memo: string | null; // 자유 메모
  created_at: string;
  updated_at: string;
}

/** 생성/수정 입력값(owner_user_id·id·타임스탬프 제외). */
export interface TennisLessonInput {
  lesson_date: string;
  coach_name?: string | null;
  lesson_topic: string;
  learned_points: string;
  correction_points?: string | null;
  practice_tasks?: string | null;
  next_goal?: string | null;
  free_memo?: string | null;
}
