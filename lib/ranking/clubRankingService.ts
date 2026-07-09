// TEYEON 클럽 랭킹 — 조회 계층(얇은 래퍼). 계산은 전부 clubRankingCore(순수)가 담당.
//   · Archive 조회는 Profile 공통 기준(getMemberOfficialStats.fetchMemberOfficialStats)과
//     동일한 테이블/컬럼/필터를 사용한다: teyeon_archive_v1, archive_type='kdk', is_official=true.
//     차이는 단 하나 — 회원별 반복 조회가 아니라 "1회 조회 → 전 회원 배치 계산".
//   · 아바타는 /members 화면과 동일한 기존 해석 기준을 재사용한다(이름 부분 일치 없음, 배치 조회 — N+1 금지):
//       1) members.avatar_url
//       2) members.auth_user_id = profiles.id  (DB unique, 최우선 프로필 매칭 키)
//       3) (auth_user_id 없는 회원 한정) members.email = profiles.email  exact match
//       4) null → 화면에서 이니셜 fallback
//   · 운영 DB 쓰기 없음(읽기 전용).

import { supabase } from '../supabase';
import type { KdkArchiveRow } from '../kdkArchiveStats';
import { normalizeAvatarUrl } from '../memberDisplayResolver';
import {
  computeClubRanking,
  type ClubRankingResult,
  type ClubRankingSeason,
  type ClubRankingMemberInput,
} from './clubRankingCore';
import { getActiveRankingConfig } from './rankingConfig';

export type { ClubRankingResult, ClubRankingSeason };
export {
  RANKING_POINTS,
  RANKING_MIN_SESSIONS,
  BEST_WINRATE_MIN_GAMES,
} from './clubRankingCore';
export type {
  ClubRankingEntry,
  ClubRankingAwards,
  ClubRankingAwardWinner,
} from './clubRankingCore';

type MemberRow = {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  auth_user_id: string | null;
};

type ProfileRow = { id?: string | null; avatar_url?: string | null };

export type RankingInputs = {
  archiveRows: KdkArchiveRow[];
  members: ClubRankingMemberInput[];
};

/**
 * 랭킹 계산 입력(공식 KDK Archive + members 명단 + 아바타)을 1회 조회한다.
 *   산식(config)에 무관한 순수 입력 — Ranking Manager 미리보기가 현재/후보 config 로
 *   같은 입력을 2회 계산할 수 있도록 fetch 를 분리했다(중복 조회 방지).
 */
export async function loadRankingInputs(): Promise<RankingInputs> {
  const [archiveRes, membersRes] = await Promise.all([
    supabase
      .from('teyeon_archive_v1')
      .select('id, created_at, raw_data, is_official, archive_type')
      .eq('archive_type', 'kdk')
      .eq('is_official', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('members')
      // P1-2 개인정보 최소화 — email 미조회. 아바타 매칭은 auth_user_id → profiles 만.
      .select('id, nickname, avatar_url, auth_user_id'),
  ]);

  if (archiveRes.error) throw archiveRes.error;
  if (membersRes.error) throw membersRes.error;

  const memberRows = (membersRes.data || []) as MemberRow[];

  // ── 프로필 사진 배치 매칭 (auth_user_id → profiles 만 — email fallback 제거) ──
  const profileByAuthId = new Map<string, ProfileRow>();
  try {
    const authIds = Array.from(new Set(
      memberRows.map((m) => m.auth_user_id).filter((v): v is string => !!v),
    ));
    if (authIds.length > 0) {
      const byId = await supabase.from('profiles').select('id, avatar_url').in('id', authIds);
      if (!byId.error) for (const p of (byId.data || []) as ProfileRow[]) { if (p.id) profileByAuthId.set(p.id, p); }
    }
  } catch (err) {
    console.warn('[ClubRanking] profile avatar batch skipped:', err);
  }

  const members = memberRows.map((m) => {
    const profile = m.auth_user_id ? profileByAuthId.get(m.auth_user_id) : undefined;
    const avatarUrl =
      normalizeAvatarUrl(m.avatar_url) || normalizeAvatarUrl(profile?.avatar_url) || null;
    return {
      id: String(m.id),
      name: String(m.nickname || ''),
      avatarUrl,
    };
  });

  return { archiveRows: (archiveRes.data || []) as KdkArchiveRow[], members };
}

/**
 * 클럽 랭킹 집계 — 공식 KDK Archive 1회 조회 + members 명단 배치 계산.
 *   유효(published) 산식을 조회해 주입한다. 미존재/조회 실패 시 DEFAULT_RANKING_CONFIG 폴백(무장애).
 * @param season 연도(예: 2026) 또는 'all'(누적). 기본값은 현재 연도(현재 시즌).
 */
export async function fetchClubRanking(
  season: ClubRankingSeason = new Date().getFullYear(),
): Promise<ClubRankingResult> {
  const [inputs, configRes] = await Promise.all([
    loadRankingInputs(),
    getActiveRankingConfig(season),
  ]);
  return computeClubRanking(inputs.archiveRows, inputs.members, season, configRes.values);
}
