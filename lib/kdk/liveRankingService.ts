// 공식 라이브 순위 RPC wrapper — get_kdk_live_official_ranking (SECURITY DEFINER, anon 실행 가능).
//   전광판(/kdk/display)의 Ranking Tower 공식 source. 서버가 세션 snapshot + members."나이"로
//   공식 comparator 를 계산하므로 anon 에서도 폰과 동일한 순위를 받으며,
//   응답에는 birthYear/UUID/개인정보가 포함되지 않는다.
//   실패/미생성 시 null 반환 — 호출부는 클라이언트 재계산으로 fallback 하지 말 것
//   (anon 은 게스트 birthYear 가 없어 잘못된 순위가 됨 → '순위 확인 중' 상태 표시).
import { supabase } from '../supabase';

export interface LiveOfficialRankingRow {
  name: string;
  wins: number;
  losses: number;
  pf: number;
  pa: number;
  diff: number;
  rank: number;
  isGuest: boolean;
}

const isMissingFunction = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === '42883' || code === 'PGRST202' ||
    (msg.includes('get_kdk_live_official_ranking') && (msg.includes('does not exist') || msg.includes('schema cache')));
};

/** 공식 라이브 순위 조회. 실패(네트워크/미생성/권한)는 null — 절대 클라 재계산으로 대체하지 말 것. */
export async function fetchLiveOfficialRanking(sessionId: string): Promise<LiveOfficialRankingRow[] | null> {
  if (!sessionId) return null;
  try {
    const { data, error } = await supabase.rpc('get_kdk_live_official_ranking', { p_session_id: sessionId });
    if (error) throw error;
    if (!Array.isArray(data)) return [];
    return (data as any[]).map((row) => ({
      name: String(row?.name ?? ''),
      wins: Number(row?.wins ?? 0),
      losses: Number(row?.losses ?? 0),
      pf: Number(row?.pf ?? 0),
      pa: Number(row?.pa ?? 0),
      diff: Number(row?.diff ?? 0),
      rank: Number(row?.rank ?? 0),
      isGuest: row?.isGuest === true,
    }));
  } catch (err) {
    if (!isMissingFunction(err)) console.warn('[liveRanking] RPC 실패:', err);
    return null;
  }
}
