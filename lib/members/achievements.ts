// 회원 대회 입상 기록 — 공개 조회 + 표시 포맷(멤버 카드 · PlayerCardModal · 프로필 · 관리자 공용).
//   데이터: member_achievements 테이블(supabase/add_member_achievements.sql
//           + supabase/add_member_achievement_fields.sql 에서 organization/year 추가).
//   표시 형식(단일 helper): "{대회 체계} {대회명} {부서} {성적}"  예) "KATO 천안시장배 신인부 우승".
//   운영진이 확인 후 등록하는 TEYEON 공식 외부 대회 성과이며, TENNIS LOG(개인 회고/레슨일지)와 무관.
//   테이블/컬럼 미생성(마이그레이션 전) 환경에서도 화면이 깨지지 않도록 조회 실패는 빈 목록으로 처리한다.
import { supabase } from '../supabase';

// ── 선택값(단일 출처) ────────────────────────────────────────────────────────
export const ACHIEVEMENT_ORGANIZATIONS = ['KATO', 'KATA', 'KTA'] as const;
export const ACHIEVEMENT_DIVISIONS = ['신인부', '오픈부'] as const;
export const ACHIEVEMENT_RESULTS = ['우승', '준우승', '입상'] as const;
export type AchievementOrganization = (typeof ACHIEVEMENT_ORGANIZATIONS)[number];
export type AchievementDivision = (typeof ACHIEVEMENT_DIVISIONS)[number];
export type AchievementResult = (typeof ACHIEVEMENT_RESULTS)[number];

export interface MemberAchievement {
  id: string;
  member_id: string;
  /** 대회 체계 — KATO/KATA/KTA (레거시 행은 null 가능) */
  organization: string | null;
  /** 입상 연도(YYYY) — 레거시 행은 null 가능(tournament_date 에서 보정) */
  year: number | null;
  tournament_name: string;
  /** YYYY-MM-DD (date) — 레거시 호환용, 신규 입력은 사용하지 않음 */
  tournament_date: string | null;
  /** 최종 성적: 우승/준우승/입상 (레거시 4강·8강 등은 표시 시 입상으로 통일) */
  result: string;
  division: string | null;
  /** 레거시 컬럼 — 신규 표시/입력에서는 사용하지 않음(저장·표시 안 함) */
  partner_name: string | null;
  description: string | null;
  is_featured: boolean;
  is_public: boolean;
  display_order: number | null;
  created_at: string;
}

export const ACHIEVEMENT_COLS =
  'id, member_id, organization, year, tournament_name, tournament_date, result, division, partner_name, description, is_featured, is_public, display_order, created_at';

/**
 * 성적 표준화 — 3-값 체계로 통일. 우승/준우승 은 그대로, 그 외(4강·8강·16강·공동 3위·본선 진출·
 * 기타 자유 텍스트)는 모두 "입상" 으로 표시한다(§8 레거시 처리, 데이터 무손실).
 */
export function normalizeAchievementResult(result: string | null | undefined): AchievementResult {
  const r = (result || '').trim();
  if (r === '우승') return '우승';
  if (r === '준우승') return '준우승';
  return '입상';
}

/** 표준 표시 문자열: "KATO 천안시장배 신인부 우승". 누락 필드(체계/부서)는 건너뛰어 자연스럽게 연결. */
export function formatMemberAchievement(a: Pick<MemberAchievement, 'organization' | 'tournament_name' | 'division' | 'result'>): string {
  return [a.organization, a.tournament_name, a.division, normalizeAchievementResult(a.result)]
    .map((s) => (s == null ? '' : String(s).trim()))
    .filter(Boolean)
    .join(' ');
}

/**
 * Player Card 전용 compact 포맷: "신인부 입상 | 26년 아산 이충무공배 준우승".
 *   · 앞부분(카테고리) = 부서 + (우승이면 '우승', 그 외 '입상') — 레거시 수동 문구 관례 유지.
 *   · 뒷부분(상세)    = YY년 + 대회명 + 표준 성적.  🏆 이모지는 배지 렌더링 쪽에서 붙인다.
 *   프로필/목록 표준 문자열은 formatMemberAchievement — 이 포맷은 Player Card 배지에서만 사용.
 */
export function formatPlayerCardAchievement(
  a: Pick<MemberAchievement, 'division' | 'tournament_name' | 'result' | 'year' | 'tournament_date'>,
): string {
  const res = normalizeAchievementResult(a.result);
  const category = [a.division?.trim(), res === '우승' ? '우승' : '입상'].filter(Boolean).join(' ');
  const y = achievementYear(a);
  const detail = [y ? `${String(y).slice(2)}년` : '', (a.tournament_name || '').trim(), res]
    .filter(Boolean)
    .join(' ');
  return category ? `${category} | ${detail}` : detail;
}

/** 연도 — year 우선, 없으면 tournament_date(YYYY-…)에서 보정. 둘 다 없으면 null. */
export function achievementYear(a: Pick<MemberAchievement, 'year' | 'tournament_date'>): number | null {
  if (typeof a.year === 'number' && Number.isFinite(a.year)) return a.year;
  if (a.tournament_date) {
    const y = parseInt(String(a.tournament_date).slice(0, 4), 10);
    if (Number.isFinite(y)) return y;
  }
  return null;
}

/** 목록 한 줄: "2026 · KATO 천안시장배 신인부 우승"(연도 없으면 대회 문자열만). */
export function formatAchievementListLine(a: MemberAchievement): string {
  const y = achievementYear(a);
  const body = formatMemberAchievement(a);
  return y ? `${y} · ${body}` : body;
}

/** 연도별 그룹(최신 연도 우선, 연도 미상은 맨 뒤). 각 그룹 내부는 입력 순서 유지(전달 배열 순). */
export function groupAchievementsByYear(list: MemberAchievement[]): { year: number | null; items: MemberAchievement[] }[] {
  const groups: { year: number | null; items: MemberAchievement[] }[] = [];
  const index = new Map<number | null, { year: number | null; items: MemberAchievement[] }>();
  for (const a of list) {
    const y = achievementYear(a);
    let g = index.get(y);
    if (!g) {
      g = { year: y, items: [] };
      index.set(y, g);
      groups.push(g);
    }
    g.items.push(a);
  }
  return groups.sort((a, b) => {
    if (a.year === b.year) return 0;
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  });
}

/** 정렬: 연도 최신 → 대회 날짜 최신 → 등록 최신(§4 연도별·최신 우선, 같은 연도 안 최근 등록순). */
export function applyAchievementOrder<T>(query: T): T {
  return (query as any)
    .order('year', { ascending: false, nullsFirst: false })
    .order('tournament_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false }) as T;
}

export function isMissingAchievementsTable(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  // 42P01: undefined_table / PGRST205: PostgREST schema cache miss / 42703: undefined_column(신규 컬럼 미적용)
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === '42703' ||
    (msg.includes('member_achievements') && (msg.includes('does not exist') || msg.includes('schema cache'))) ||
    ((msg.includes('organization') || msg.includes('year')) && msg.includes('column'))
  );
}

/** 한 회원의 공개 입상 기록 전체(연도 최신순). 프로필 전체보기·PlayerCardModal 이 사용. */
export async function fetchPublicAchievements(memberId: string): Promise<MemberAchievement[]> {
  if (!memberId) return [];
  try {
    const { data, error } = await applyAchievementOrder(
      supabase
        .from('member_achievements')
        .select(ACHIEVEMENT_COLS)
        .eq('member_id', memberId)
        .eq('is_public', true),
    );
    if (error) throw error;
    return (data || []) as MemberAchievement[];
  } catch (err) {
    if (!isMissingAchievementsTable(err)) console.warn('[achievements] fetch 실패:', err);
    return [];
  }
}

/**
 * 멤버 목록 카드용 요약 — 회원별 공개 기록 수 + 최신 기록 1건을 batch 1회로 조회(N+1 금지).
 * 목록 카드는 최신 1건 + "외 N건" 만 표시하고, 전체 표시는 상세 모달/프로필의 몫.
 */
export async function fetchAchievementSummaries(
  memberIds: string[],
): Promise<Map<string, { count: number; top: MemberAchievement }>> {
  const map = new Map<string, { count: number; top: MemberAchievement }>();
  const ids = Array.from(new Set(memberIds.filter(Boolean)));
  if (ids.length === 0) return map;
  try {
    const { data, error } = await applyAchievementOrder(
      supabase
        .from('member_achievements')
        .select(ACHIEVEMENT_COLS)
        .in('member_id', ids)
        .eq('is_public', true),
    );
    if (error) throw error;
    for (const row of (data || []) as MemberAchievement[]) {
      const cur = map.get(row.member_id);
      if (cur) cur.count += 1; // 전역 정렬이므로 회원별 첫 행이 곧 최신 대표 기록
      else map.set(row.member_id, { count: 1, top: row });
    }
  } catch (err) {
    if (!isMissingAchievementsTable(err)) console.warn('[achievements] summary 실패:', err);
  }
  return map;
}
