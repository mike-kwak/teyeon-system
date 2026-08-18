// KDK 세션 ↔ Club Schedule(정모) 연결 — 정모 화면에서 쓰는 조회/연결/해제 I/O.
//
//   단일 진실 소스: kdk_session_meta.club_schedule_id (supabase/add_kdk_session_club_schedule_link.sql)
//   이 서비스가 쓰는 컬럼은 club_schedule_id + updated_at 뿐이다.
//   matches / teyeon_archive_v1 / kdk_session_attendee_meta / kdk_guest_profiles /
//   finance_* / club_schedules 는 읽기만 하거나 아예 건드리지 않는다.
//
//   ⚠️ 연결 해제는 unlink 이지 삭제가 아니다 — 경기·점수·순위·공식 기록·정산은 그대로 남는다.
//   기존 KDK 화면의 연결 저장(app/kdk/page.tsx saveLinkedSchedule)과 같은 컬럼·같은 1:1 규칙을 쓴다.
//   다만 그쪽은 '진행 중인 세션'에서만 접근 가능해, 확정·정리된 세션은 이 서비스로만 다룰 수 있다.
import { supabase } from '../supabase';
import {
  mergeKdkSessionLinkInfo,
  precheckLink,
  resolveUnlinkOutcome,
  type KdkSessionLinkInfo,
  type UnlinkOutcome,
} from './sessionScheduleLinkCore';

export type { KdkSessionLinkInfo, UnlinkOutcome };

const META_TBL = 'kdk_session_meta';
const ARCHIVE_TBL = 'teyeon_archive_v1';

/** club_schedule_id 컬럼 미적용(마이그레이션 전) 환경 판별 — 기존 KDK 화면과 동일한 방식. */
export function isMissingLinkColumn(err: unknown): boolean {
  const e = err as { message?: unknown; details?: unknown } | null;
  return /club_schedule_id/i.test(`${e?.message || ''} ${e?.details || ''}`);
}

export const LINK_COLUMN_MISSING_MESSAGE =
  '정모 연결 컬럼이 운영 DB에 아직 없습니다. supabase/add_kdk_session_club_schedule_link.sql 을 적용해 주세요.';

/** 세션 id 목록의 Archive 상태(존재/공식) 조회. 실패해도 목록은 살린다(연결 관리가 막히면 안 됨). */
async function fetchArchiveFlags(sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  const { data, error } = await supabase
    .from(ARCHIVE_TBL)
    .select('id, is_official')
    .in('id', sessionIds);
  if (error) {
    console.warn('[kdkScheduleLink] Archive 상태 조회 실패(연결 관리는 계속 진행):', error);
    return [];
  }
  return data || [];
}

/**
 * 이 정모에 연결된 KDK 세션 조회. 정상 상태에서는 0건 또는 1건(1:1 unique index).
 * 2건 이상이면 데이터 이상 — 화면이 전부 보여 주고 각각 해제할 수 있게 배열로 돌려준다.
 */
export async function fetchLinkedKdkSessions(scheduleId: string): Promise<KdkSessionLinkInfo[]> {
  if (!scheduleId) return [];
  const { data, error } = await supabase
    .from(META_TBL)
    .select('session_id, updated_at')
    .eq('club_schedule_id', scheduleId);
  if (error) {
    if (isMissingLinkColumn(error)) return []; // 컬럼 미적용 = 연결 개념 자체가 없음
    throw error;
  }
  const rows = data || [];
  const archive = await fetchArchiveFlags(rows.map((r: any) => String(r?.session_id || '')).filter(Boolean));
  return mergeKdkSessionLinkInfo(rows, archive);
}

/**
 * 아직 어떤 정모에도 연결되지 않은 최근 KDK 세션 후보.
 * 잘못된 정모에서 해제한 세션을 '새로 만들지 않고' 올바른 정모에 다시 붙이기 위한 목록이다.
 * kdk_session_meta 에 row 가 있는 세션만 후보다(연결·게스트비·티커 등을 한 번이라도 저장한 세션).
 */
export async function fetchUnlinkedKdkSessions(clubId: string, limit = 20): Promise<KdkSessionLinkInfo[]> {
  let query = supabase
    .from(META_TBL)
    .select('session_id, updated_at')
    .is('club_schedule_id', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  // club_id 는 nullable — 과거 row 가 누락돼도 후보에서 빠지지 않도록 null 도 포함한다.
  if (clubId) query = query.or(`club_id.eq.${clubId},club_id.is.null`);

  const { data, error } = await query;
  if (error) {
    if (isMissingLinkColumn(error)) throw new Error(LINK_COLUMN_MISSING_MESSAGE);
    throw error;
  }
  const rows = data || [];
  const archive = await fetchArchiveFlags(rows.map((r: any) => String(r?.session_id || '')).filter(Boolean));
  return mergeKdkSessionLinkInfo(rows, archive);
}

/**
 * 연결 해제 — 단일 UPDATE 로 club_schedule_id 만 NULL 로 바꾼다(원자적).
 *
 *   · WHERE 에 session_id 와 club_schedule_id 를 함께 걸어, 화면에서 본 '그 연결'만 해제한다.
 *     다른 기기가 이미 바꿨다면 0 row 가 영향받고 'already_changed' 를 돌려준다(덮어쓰지 않음).
 *   · updated_at 외 다른 컬럼(ticker_message / guest_fee / group_courts / club_id)은 건드리지 않는다.
 *   · KDK 세션·경기·점수·순위·Archive·Finance·attendee_meta 는 일절 변경하지 않는다.
 */
export async function unlinkKdkSessionFromSchedule(
  sessionId: string,
  scheduleId: string,
): Promise<UnlinkOutcome> {
  if (!sessionId || !scheduleId) throw new Error('session_id / club_schedule_id 가 없습니다.');
  const { data, error } = await supabase
    .from(META_TBL)
    .update({ club_schedule_id: null, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('club_schedule_id', scheduleId)
    .select('session_id');
  if (error) {
    if (isMissingLinkColumn(error)) throw new Error(LINK_COLUMN_MISSING_MESSAGE);
    throw error;
  }
  return resolveUnlinkOutcome((data || []).length);
}

/**
 * 기존 KDK 세션을 정모에 연결(재연결 포함) — 새 세션을 만들지 않는다.
 * 1:1 규칙을 사전 점검한 뒤 UPDATE 한다(unique partial index 위반을 사용자 안내로 먼저 흡수).
 * meta row 가 없는 세션은 이 경로로 연결하지 않는다 — 진행 중 세션은 기존 KDK 설정 화면을 쓴다.
 */
export async function linkKdkSessionToSchedule(sessionId: string, scheduleId: string): Promise<void> {
  if (!sessionId || !scheduleId) throw new Error('session_id / club_schedule_id 가 없습니다.');

  const { data: occupied, error: checkErr } = await supabase
    .from(META_TBL)
    .select('session_id')
    .eq('club_schedule_id', scheduleId)
    .limit(1)
    .maybeSingle();
  if (checkErr) {
    if (isMissingLinkColumn(checkErr)) throw new Error(LINK_COLUMN_MISSING_MESSAGE);
    throw checkErr;
  }
  const verdict = precheckLink(sessionId, scheduleId, occupied?.session_id ? String(occupied.session_id) : null);
  if (verdict === 'already_linked') return;
  if (verdict === 'schedule_occupied') throw new Error('이 정모에는 이미 연결된 KDK 세션이 있습니다.');

  const { data, error } = await supabase
    .from(META_TBL)
    .update({ club_schedule_id: scheduleId, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .is('club_schedule_id', null)
    .select('session_id');
  if (error) {
    if (isMissingLinkColumn(error)) throw new Error(LINK_COLUMN_MISSING_MESSAGE);
    if (/duplicate key/i.test(error.message || '') || /unique/i.test(error.message || '')) {
      throw new Error('이 정모에는 이미 연결된 KDK 세션이 있습니다.');
    }
    throw error;
  }
  if ((data || []).length === 0) {
    throw new Error('이 KDK 세션의 연결 상태가 방금 바뀌었습니다. 새로고침 후 다시 시도해주세요.');
  }
}
