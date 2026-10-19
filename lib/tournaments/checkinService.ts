// 현장 팀 체크인(Admin) — 현장 운영 1단계.
//
//   · 원본 테이블을 직접 읽지 않는다. RPC 2개(get_admin_team_checkins · set_team_checkin)만 쓴다.
//     RPC 내부에서 can_manage_tournaments()(CEO/ADMIN)를 다시 검증한다.
//   · 업무 실패는 { ok:false, reason } 이다. 권한 실패(42501)만 예외.
//   ⚠ set_team_checkin 은 같은 값을 다시 보내도 결과가 같다(멱등) → 공용 fetch 의 자동 재시도에 맡겨도 안전하다.
//     그래서 NO_RETRY 목록에 넣지 않는다. 화면은 응답의 checkedIn(최종 상태)만 본다(changed 는 보지 않는다).

import { supabase } from '@/lib/supabase';
import type { TeamCheckinBoard, TeamCheckinRow, TeamCheckinStatus } from './checkinModel';

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/** 체크인 SQL 이 아직 적용되지 않은 서버인가(함수 · 테이블 없음). */
export function isCheckinMissing(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === 'PGRST202' || code === '42883' || code === '42P01'
    || (/get_admin_team_checkins|set_team_checkin|hosted_tournament_team_checkins/.test(msg)
        && /does not exist|schema cache|Could not find/.test(msg));
}

const rowOf = (v: unknown): TeamCheckinRow => {
  const r = rec(v);
  return {
    teamId: str(r.teamId),
    teamNo: num(r.teamNo),
    player1Name: str(r.player1Name),
    player2Name: str(r.player2Name),
    player1ClubName: strOrNull(r.player1ClubName),
    player2ClubName: strOrNull(r.player2ClubName),
    clubName: strOrNull(r.clubName),
    status: (str(r.status) === 'withdrawn' ? 'withdrawn' : 'active') as TeamCheckinStatus,
    checkedInAt: strOrNull(r.checkedInAt),
  };
};

/**
 * 체크인 현황.
 *   권한이 없거나 대회를 못 찾으면 RPC 가 null → ready=false('0팀' 과 '조회 불가' 는 다르다).
 *   ⚠ 네트워크 · 서버 오류는 throw 한다(화면이 보던 목록을 지우지 않고 안내만 한다).
 */
export async function fetchTeamCheckins(
  slug: string,
): Promise<{ ready: boolean; board: TeamCheckinBoard | null }> {
  const { data, error } = await supabase.rpc('get_admin_team_checkins', { p_slug: slug });
  if (error) throw error;
  if (data === null || data === undefined) return { ready: false, board: null };
  const o = rec(data);
  const teams = Array.isArray(o.teams) ? o.teams.map(rowOf).filter((t) => t.teamId !== '') : [];
  return {
    ready: true,
    board: {
      slug: str(o.slug) || slug,
      teams,
      total: num(o.total),
      checkedIn: num(o.checkedIn),
      withdrawn: num(o.withdrawn),
      serverNow: strOrNull(o.serverNow),
    },
  };
}

export interface CheckinWriteResult {
  teamId: string;
  teamNo: number;
  checkedIn: boolean;
  checkedInAt: string | null;
  changed: boolean;
}

/** 체크인(true) / 취소(false). ok=false 면 reason 을 담아 throw. */
export async function setTeamCheckin(
  slug: string, teamId: string, checked: boolean,
): Promise<CheckinWriteResult> {
  const { data, error } = await supabase.rpc('set_team_checkin', {
    p_slug: slug, p_team_id: teamId, p_checked: checked,
  });
  if (error) throw error;
  const o = rec(data);
  if (o.ok !== true) {
    const err = new Error(str(o.reason) || 'UNKNOWN') as Error & { reason?: string };
    err.reason = str(o.reason) || 'UNKNOWN';
    throw err;
  }
  return {
    teamId: str(o.teamId) || teamId,
    teamNo: num(o.teamNo),
    checkedIn: o.checkedIn === true,
    checkedInAt: strOrNull(o.checkedInAt),
    changed: o.changed === true,
  };
}

/** 오류 → 본부용 한국어 한 줄. 내부 상세를 노출하지 않는다. */
export function checkinActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  const reason = String(e?.reason || '');
  if (code === '42501' || /not authorized/i.test(msg)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (isCheckinMissing(err)) return '체크인 기능이 아직 서버에 적용되지 않았습니다.';
  switch (reason) {
    case 'team_not_found': return '팀을 찾을 수 없습니다. 목록을 새로고침해 주세요.';
    case 'team_withdrawn': return '기권 처리된 팀은 체크인할 수 없습니다.';
    case 'invalid_value':  return '잘못된 요청입니다. 새로고침 후 다시 시도해 주세요.';
    default: break;
  }
  if (/fetch|network|Failed to fetch|timeout/i.test(msg)) return '연결이 불안정합니다. 목록을 다시 불러와 상태를 확인해 주세요.';
  return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}
