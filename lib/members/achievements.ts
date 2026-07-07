// 회원 대회 입상 기록 — 공개 조회(멤버 카드 · PlayerCardModal 공용).
//   데이터: member_achievements 테이블(supabase/add_member_achievements.sql).
//   운영진이 확인 후 등록하는 TEYEON 공식 외부 대회 성과이며,
//   TENNIS LOG(개인 작성 회고/레슨일지)와는 완전히 별개 — 자동 연동하지 않는다.
//   테이블 미생성(마이그레이션 전) 환경에서도 화면이 깨지지 않도록 조회 실패는 빈 목록으로 처리한다.
import { supabase } from '../supabase';

export interface MemberAchievement {
  id: string;
  member_id: string;
  tournament_name: string;
  /** YYYY-MM-DD (date) — 미상이면 null */
  tournament_date: string | null;
  /** 최종 성적: 우승/준우승/공동 3위/4강/8강/16강/본선 진출 또는 직접 입력 텍스트 */
  result: string;
  division: string | null;
  partner_name: string | null;
  description: string | null;
  is_featured: boolean;
  is_public: boolean;
  display_order: number | null;
  created_at: string;
}

export const ACHIEVEMENT_COLS =
  'id, member_id, tournament_name, tournament_date, result, division, partner_name, description, is_featured, is_public, display_order, created_at';

/** 정렬: 대표 기록 → 표시 순서 → 대회 날짜 최신 → 등록 최신. */
export function applyAchievementOrder<T>(query: T): T {
  return (query as any)
    .order('is_featured', { ascending: false })
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('tournament_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false }) as T;
}

export function isMissingAchievementsTable(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  // 42P01: Postgres undefined_table / PGRST205: PostgREST가 테이블을 schema cache에서 못 찾음
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (msg.includes('member_achievements') && (msg.includes('does not exist') || msg.includes('schema cache')))
  );
}

/** 한 회원의 공개 입상 기록 전체. 상세 화면(PlayerCardModal)은 이 목록을 전부 표시한다. */
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
 * 멤버 목록 카드용 요약 — 회원별 공개 기록 수 + 대표 기록 1건을 batch 1회로 조회(N+1 금지).
 * 목록 카드는 대표 1건 + "외 N건" 만 표시하고, 전체 표시는 상세 모달의 몫.
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
      if (cur) cur.count += 1; // 전역 정렬이므로 회원별 첫 행이 곧 대표 기록
      else map.set(row.member_id, { count: 1, top: row });
    }
  } catch (err) {
    if (!isMissingAchievementsTable(err)) console.warn('[achievements] summary 실패:', err);
  }
  return map;
}

/** 카드/목록용 한 줄 문구: "2026 아산시장배 신인부 우승". 대회명에 연도가 이미 있으면 중복하지 않는다. */
export function formatAchievementLine(a: MemberAchievement): string {
  const year = a.tournament_date ? a.tournament_date.slice(0, 4) : '';
  const prefix = year && !a.tournament_name.includes(year) ? `${year} ` : '';
  const division = a.division ? ` ${a.division}` : '';
  return `${prefix}${a.tournament_name}${division} ${a.result}`.trim();
}
