// TEYEON KDK 선수별 성적 집계 — 단일 출처(SSoT).
//
//   ⚠ 이것은 **추출(리팩터링)이다. 계산식 변경이 아니다.**
//     hooks/useRanking.ts 안에 있던 집계 로직을 그대로 옮겼을 뿐이며,
//     LIVE KDK · Special Match · Archive 정정이 모두 이 함수 하나를 쓴다.
//     결과가 과거와 1이라도 달라지면 그것은 버그다(fixture 로 고정한다).
//
//   공식 집계 규칙(변경 대상 아님):
//     · status === 'complete' 인 경기만 센다.
//     · 동점 경기(score1 === score2)는 **집계에서 제외**한다 — 공식 규칙이며
//       전광판 RPC · Archive 재계산과 같다. (과거 동점을 양 팀 패로 세던 시절의
//       화면별 losses 불일치를 없애기 위한 결정.)
//     · player_ids 의 [0,1] = team1(score1), [2,3] = team2(score2).
//     · 득점(pf) = 자기 팀 점수 합, 실점(pa) = 상대 팀 점수 합, 득실(diff) = pf − pa.
//     · 승/패는 점수에서 파생한다(winner 필드를 쓰지 않는다).
//
//   ⚠ 순위(정렬)는 여기서 하지 않는다 — lib/kdk/officialRanking.ts 가 맡는다.
//   ⚠ 정산(벌금·상금)도 여기서 하지 않는다 — lib/kdk/settlement.ts 가 맡는다.

/** 선수 1명의 집계 결과. 기존 useRanking.RankStats 와 같은 모양이다. */
export interface KdkPlayerStats {
  wins: number;
  losses: number;
  diff: number;
  games: number;
  pf: number;
  pa: number;
}

/** 집계 입력 — 경기 1건에서 실제로 읽는 필드만. LIVE Match · Archive snapshot 둘 다 받는다. */
export interface KdkAggregateMatch {
  status?: string | null;
  score1?: number | string | null;
  score2?: number | string | null;
  /** LIVE 는 playerIds, Archive snapshot 은 player_ids/playerIds 를 함께 저장한다. */
  playerIds?: readonly (string | null | undefined)[] | null;
  player_ids?: readonly (string | null | undefined)[] | null;
  /** 이름 복구용(선택). LIVE 는 없고 Archive snapshot 에만 있다. */
  player_names?: readonly (string | null | undefined)[] | null;
}

export interface KdkAggregateResult {
  stats: Record<string, KdkPlayerStats>;
  /** 경기 metadata 에서 복구한 선수 id → 표시명. 집계와 무관하게 '이름 찾기'에만 쓴다. */
  nameLookup: Record<string, string>;
}

export const EMPTY_KDK_PLAYER_STATS: KdkPlayerStats = {
  wins: 0, losses: 0, diff: 0, games: 0, pf: 0, pa: 0,
};

/** 집계가 실제로 쓰는 참가자 id 배열. LIVE(playerIds) · Archive(player_ids) 양쪽을 받는다. */
export function kdkMatchPlayerIds(match: KdkAggregateMatch): readonly (string | null | undefined)[] {
  return match?.playerIds ?? match?.player_ids ?? [];
}

/**
 * 선수별 승/패·득점·실점·득실 집계.
 *
 *   ⚠ hooks/useRanking.ts 의 playerStatsData useMemo 를 **그대로** 옮긴 것이다.
 *     순회 순서 · 조건 · 누적 방식을 바꾸지 않는다(결과 동일성 보장).
 */
export function aggregateKdkPlayerStats(
  matches: readonly KdkAggregateMatch[] | null | undefined,
): KdkAggregateResult {
  const res: Record<string, KdkPlayerStats> = {};
  const nameMap: Record<string, string> = {};

  matches?.forEach(m => {
    // [v35.8.4] 이름 복구용 map 은 완료되지 않은 경기에서도 모은다(집계와 무관).
    const ids = m?.playerIds ?? m?.player_ids;
    if (ids && m?.player_names) {
      ids.forEach((pid, idx) => {
        const pName = m.player_names?.[idx];
        if (pid && pName && !String(pName).startsWith('g-')) {
          nameMap[pid] = String(pName);
        }
      });
    }

    if (m?.status !== 'complete') return;
    // 동점 경기는 집계 제외 — 공식 규칙(전광판 RPC·Archive 재계산과 동일).
    if (Number(m?.score1 || 0) === Number(m?.score2 || 0)) return;

    (m?.playerIds ?? m?.player_ids)?.forEach((pid, idx) => {
      if (!pid) return;
      if (!res[pid]) res[pid] = { ...EMPTY_KDK_PLAYER_STATS };
      const isTeam1 = idx < 2;
      const score1 = Number(m?.score1 || 0);
      const score2 = Number(m?.score2 || 0);
      const win = isTeam1 ? (score1 > score2) : (score2 > score1);
      const d = isTeam1 ? (score1 - score2) : (score2 - score1);

      res[pid].games += 1;
      res[pid].pf += isTeam1 ? score1 : score2;
      res[pid].pa += isTeam1 ? score2 : score1;
      if (win) res[pid].wins += 1;
      else res[pid].losses += 1;
      res[pid].diff += d;
    });
  });

  return { stats: res, nameLookup: nameMap };
}
