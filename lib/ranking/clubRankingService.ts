// TEYEON 클럽 랭킹 — 조회 계층(얇은 래퍼). 계산은 전부 clubRankingCore(순수)가 담당.
//   · Archive 조회는 Profile 공통 기준(getMemberOfficialStats.fetchMemberOfficialStats)과
//     동일한 테이블/컬럼/필터를 사용한다: teyeon_archive_v1, archive_type='kdk', is_official=true.
//     차이는 단 하나 — 회원별 반복 조회가 아니라 "1회 조회 → 전 회원 배치 계산".
//   · 운영 DB 쓰기 없음(읽기 전용).

import { supabase } from '../supabase';
import type { KdkArchiveRow } from '../kdkArchiveStats';
import {
  computeClubRanking,
  type ClubRankingResult,
  type ClubRankingSeason,
} from './clubRankingCore';

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

/**
 * 클럽 랭킹 집계 — 공식 KDK Archive 1회 조회 + members 명단 배치 계산.
 * @param season 연도(예: 2026) 또는 'all'(누적). 기본값은 현재 연도(현재 시즌).
 */
export async function fetchClubRanking(
  season: ClubRankingSeason = new Date().getFullYear(),
): Promise<ClubRankingResult> {
  const [archiveRes, membersRes] = await Promise.all([
    supabase
      .from('teyeon_archive_v1')
      .select('id, created_at, raw_data, is_official, archive_type')
      .eq('archive_type', 'kdk')
      .eq('is_official', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('members')
      .select('id, nickname, avatar_url'),
  ]);

  if (archiveRes.error) throw archiveRes.error;
  if (membersRes.error) throw membersRes.error;

  const members = (membersRes.data || []).map((m: any) => ({
    id: String(m.id),
    name: String(m.nickname || ''),
    avatarUrl: (m.avatar_url as string | null) || null,
  }));

  return computeClubRanking((archiveRes.data || []) as KdkArchiveRow[], members, season);
}
