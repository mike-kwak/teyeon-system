// 관리자 — 회원 프로필 편집 · 대회 입상 기록 CRUD.
//   프로필: members 의 기존 컬럼(affiliation/mbti/나이/achievements/avatar_url)을 재사용하고,
//   한 줄 소개는 bio(신규 — supabase/add_member_achievements.sql) 를 사용한다.
//   계정 연결 핵심 정보(nickname/email/auth_user_id)는 여기서 다루지 않는다(등록/연결 service 담당).
//   입상 기록: member_achievements 별도 테이블 — TENNIS LOG 와 무관한 운영진 등록 공식 기록.
//   권한 실경계: UI canEditAdminSettings(CEO/ADMIN) + 운영 RLS(테이블 정책은 SQL 초안 참조).
import { supabase } from '../supabase';
import {
  ACHIEVEMENT_COLS,
  ACHIEVEMENT_ORGANIZATIONS,
  ACHIEVEMENT_DIVISIONS,
  ACHIEVEMENT_RESULTS,
  applyAchievementOrder,
  isMissingAchievementsTable,
  type MemberAchievement,
} from '../members/achievements';

export type { MemberAchievement } from '../members/achievements';
export {
  ACHIEVEMENT_ORGANIZATIONS,
  ACHIEVEMENT_DIVISIONS,
  ACHIEVEMENT_RESULTS,
} from '../members/achievements';

const ACHIEVEMENTS_TABLE_HINT =
  '입상 기록 테이블이 아직 없습니다. supabase/add_member_achievements.sql 적용 후 사용할 수 있습니다.';

// ── 회원 프로필 ───────────────────────────────────────────────────────────────

export interface MemberProfileForm {
  affiliation: string;
  mbti: string;
  /** members."나이" — 실데이터는 출생년도 텍스트(예: "1988") */
  birthYear: string;
  bio: string;
  avatarUrl: string;
}
// 참고: 레거시 members.achievements(수동 요약 문구)는 더 이상 읽지도 저장하지도 않는다.
//   입상의 단일 출처는 member_achievements — 표시 문구는 formatMemberAchievement 로 자동 생성.
//   기존 컬럼 값은 비파괴로 남겨 두되(삭제/변경 없음) UI/표시 경로에서 제외(추후 정리 별도 검토).

export async function fetchMemberProfile(
  memberId: string,
): Promise<MemberProfileForm & { nickname: string; legacyAchievementsText: string }> {
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
    avatarUrl: str(row.avatar_url),
    // 레거시 자유입력 원문 — '기존 입상 기록 가져오기' 도구 전용(읽기 전용, 저장 payload 미포함).
    legacyAchievementsText: str(row.achievements),
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
  // achievements(레거시 수동 요약)는 payload 에서 제외 — 저장 중단, 기존 DB 값은 건드리지 않음.
  const payload: Record<string, unknown> = {
    affiliation: norm(input.affiliation),
    mbti: norm(input.mbti)?.toString().toUpperCase() ?? null,
    나이: norm(input.birthYear),
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

/** 신규 입상 입력 — 필수 6요소만(멤버는 memberId 로 별도 전달). §1 필드 구조. */
export interface AchievementInput {
  /** KATO/KATA/KTA */
  organization: string;
  /** 연도(YYYY) — 문자열/숫자 허용 */
  year: string | number;
  tournamentName: string;
  /** 신인부/오픈부 */
  division: string;
  /** 우승/준우승/입상 */
  result: string;
}

function toRow(input: AchievementInput): Record<string, unknown> {
  const organization = String(input.organization || '').trim();
  const tournamentName = (input.tournamentName || '').trim();
  const division = String(input.division || '').trim();
  const result = String(input.result || '').trim();
  const year = typeof input.year === 'number' ? input.year : parseInt(String(input.year || '').trim(), 10);

  if (!organization || !(ACHIEVEMENT_ORGANIZATIONS as readonly string[]).includes(organization)) {
    throw new Error('대회 체계를 선택해 주세요 (KATO/KATA/KTA).');
  }
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    throw new Error('연도를 올바르게 선택해 주세요.');
  }
  if (!tournamentName) throw new Error('대회명을 입력해 주세요.');
  if (!division || !(ACHIEVEMENT_DIVISIONS as readonly string[]).includes(division)) {
    throw new Error('부서를 선택해 주세요 (신인부/오픈부).');
  }
  if (!result || !(ACHIEVEMENT_RESULTS as readonly string[]).includes(result)) {
    throw new Error('성적을 선택해 주세요 (우승/준우승/입상).');
  }
  return {
    organization,
    year,
    tournament_name: tournamentName,
    division,
    result,
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
