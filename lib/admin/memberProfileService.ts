// 관리자 — 회원 프로필 편집 · 대회 입상 기록 CRUD.
//   프로필: members 의 기존 컬럼(affiliation/mbti/나이/achievements/avatar_url)을 재사용하고,
//   한 줄 소개는 bio(신규 — supabase/add_member_achievements.sql) 를 사용한다.
//   계정 연결 핵심 정보(nickname/email/auth_user_id)는 여기서 다루지 않는다(등록/연결 service 담당).
//   입상 기록: member_achievements 별도 테이블 — TENNIS LOG 와 무관한 운영진 등록 공식 기록.
//   권한 실경계: UI canEditAdminSettings(CEO/ADMIN) + 운영 RLS(테이블 정책은 SQL 초안 참조).
import { supabase } from '../supabase';
import {
  ACHIEVEMENT_COLS,
  applyAchievementOrder,
  isMissingAchievementsTable,
  type MemberAchievement,
} from '../members/achievements';

export type { MemberAchievement } from '../members/achievements';

/** 성적 선택지 — UI 에서 '직접 입력' 선택 시 자유 텍스트로 전환한다. */
export const ACHIEVEMENT_RESULT_OPTIONS = ['우승', '준우승', '공동 3위', '4강', '8강', '16강', '본선 진출'];

const ACHIEVEMENTS_TABLE_HINT =
  '입상 기록 테이블이 아직 없습니다. supabase/add_member_achievements.sql 적용 후 사용할 수 있습니다.';

// ── 회원 프로필 ───────────────────────────────────────────────────────────────

export interface MemberProfileForm {
  affiliation: string;
  mbti: string;
  /** members."나이" — 실데이터는 출생년도 텍스트(예: "1988") */
  birthYear: string;
  bio: string;
  /** members.achievements — 목록 카드의 🏆 요약 문구(레거시 단일 텍스트) */
  achievementsSummary: string;
  avatarUrl: string;
}

export async function fetchMemberProfile(memberId: string): Promise<MemberProfileForm & { nickname: string }> {
  const { data, error } = await supabase.from('members').select('*').eq('id', memberId).single();
  if (error) throw error;
  const row = data as Record<string, unknown>;
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    nickname: str(row.nickname),
    affiliation: str(row.affiliation),
    mbti: str(row.mbti),
    birthYear: str(row['나이']),
    bio: str(row.bio),
    achievementsSummary: str(row.achievements),
    avatarUrl: str(row.avatar_url),
  };
}

const isMissingColumn = (err: unknown, col: string): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const msg = String(e?.message || '');
  return String(e?.code) === 'PGRST204' && msg.includes(`'${col}'`);
};

/**
 * 프로필 저장. bio 컬럼이 아직 없는(마이그레이션 전) 운영 환경에서는
 * bio 만 제외하고 나머지를 저장한 뒤 bioSkipped 로 알린다 — 저장 전체가 죽지 않게.
 */
export async function updateMemberProfile(
  memberId: string,
  input: MemberProfileForm,
): Promise<{ bioSkipped: boolean }> {
  if (!memberId) throw new Error('대상 회원이 없습니다.');
  const norm = (v: string) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };
  const payload: Record<string, unknown> = {
    affiliation: norm(input.affiliation),
    mbti: norm(input.mbti)?.toString().toUpperCase() ?? null,
    나이: norm(input.birthYear),
    achievements: norm(input.achievementsSummary),
    avatar_url: norm(input.avatarUrl),
    bio: norm(input.bio),
  };
  const { error } = await supabase.from('members').update(payload).eq('id', memberId);
  if (error && isMissingColumn(error, 'bio')) {
    delete payload.bio;
    const retry = await supabase.from('members').update(payload).eq('id', memberId);
    if (retry.error) throw retry.error;
    return { bioSkipped: true };
  }
  if (error) throw error;
  return { bioSkipped: false };
}

// ── 대회 입상 기록 CRUD ──────────────────────────────────────────────────────

export interface AchievementInput {
  tournamentName: string;
  /** YYYY-MM-DD 또는 빈 값 */
  tournamentDate: string;
  result: string;
  division: string;
  partnerName: string;
  isFeatured: boolean;
  isPublic: boolean;
  /** 표시 순서(낮을수록 위) — 빈 값이면 자동(날짜순) */
  displayOrder: string;
}

function toRow(input: AchievementInput): Record<string, unknown> {
  const tournamentName = (input.tournamentName || '').trim();
  const result = (input.result || '').trim();
  if (!tournamentName) throw new Error('대회명을 입력해 주세요.');
  if (!result) throw new Error('최종 성적을 선택하거나 입력해 주세요.');
  const norm = (v: string) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };
  const orderText = (input.displayOrder ?? '').trim();
  const displayOrder = orderText === '' ? null : Number(orderText);
  if (displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder < 0)) {
    throw new Error('표시 순서는 0 이상의 정수로 입력해 주세요.');
  }
  return {
    tournament_name: tournamentName,
    tournament_date: norm(input.tournamentDate),
    result,
    division: norm(input.division),
    partner_name: norm(input.partnerName),
    is_featured: !!input.isFeatured,
    is_public: !!input.isPublic,
    display_order: displayOrder,
  };
}

const rethrow = (err: unknown): never => {
  if (isMissingAchievementsTable(err)) throw new Error(ACHIEVEMENTS_TABLE_HINT);
  throw err;
};

/** 관리자용 목록 — 비공개 기록 포함 전체. */
export async function listAchievementsAdmin(memberId: string): Promise<MemberAchievement[]> {
  if (!memberId) return [];
  try {
    const { data, error } = await applyAchievementOrder(
      supabase.from('member_achievements').select(ACHIEVEMENT_COLS).eq('member_id', memberId),
    );
    if (error) throw error;
    return (data || []) as MemberAchievement[];
  } catch (err) {
    return rethrow(err);
  }
}

export async function createAchievement(memberId: string, input: AchievementInput): Promise<MemberAchievement> {
  if (!memberId) throw new Error('대상 회원이 없습니다.');
  try {
    const { data, error } = await supabase
      .from('member_achievements')
      .insert({ member_id: memberId, ...toRow(input) })
      .select(ACHIEVEMENT_COLS)
      .single();
    if (error) throw error;
    return data as MemberAchievement;
  } catch (err) {
    return rethrow(err);
  }
}

export async function updateAchievement(id: string, input: AchievementInput): Promise<MemberAchievement> {
  if (!id) throw new Error('대상 기록이 없습니다.');
  try {
    const { data, error } = await supabase
      .from('member_achievements')
      .update({ ...toRow(input), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(ACHIEVEMENT_COLS)
      .single();
    if (error) throw error;
    return data as MemberAchievement;
  } catch (err) {
    return rethrow(err);
  }
}

export async function deleteAchievement(id: string): Promise<void> {
  if (!id) throw new Error('대상 기록이 없습니다.');
  try {
    const { error } = await supabase.from('member_achievements').delete().eq('id', id);
    if (error) throw error;
  } catch (err) {
    rethrow(err);
  }
}
