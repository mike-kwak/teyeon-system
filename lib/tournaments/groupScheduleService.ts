// 예선 조별 일정 안내(출전 신고 · 예정 코트) — 공개 · 본부 조회와 저장.
//
//   공개: get_public_group_schedule (로그인 없이 · DRAW 공개 조건일 때만 값, 아니면 null)
//   본부: get_admin_group_schedule · set_schedule_settings · set_group_schedule (CEO/ADMIN)
//   ⚠ 몇 번째 조인지 · 예정 코트는 경기이사가 조마다 지정한 값 그대로다. 화면이 추정하지 않는다.
//   ⚠ 예정 코트는 안내용이다. 실제 코트는 경기 투입 때 정해지고 경기별로 따로 공개된다(실제가 항상 우선).
//   ⚠ SQL 이 아직 적용되지 않은 환경(함수 없음)에서는 '일정 없음' 으로 본다 — 기존 화면이 그대로 동작한다.

import { supabase } from '@/lib/supabase';
import { PUBLIC_DRAW_ENABLED } from './publicDrawFlags';
import {
  parsePublicGroupSchedule, type PublicGroupSchedule, type SessionNo,
} from './groupScheduleModel';

export * from './groupScheduleModel';

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sessionOf = (v: unknown): SessionNo | null => (v === 1 || v === '1' ? 1 : v === 2 || v === '2' ? 2 : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const isMissingFunction = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = str(e?.code);
  return code === 'PGRST202' || code === '42883' || code === '42P01' || code === 'PGRST205'
    || (/group_schedule|schedule_settings/.test(str(e?.message)) && /does not exist|schema cache|Could not find/.test(str(e?.message)));
};

/** 공개 조별 일정. null = 비공개 · 미설정 · SQL 미적용(구분하지 않는다). 조회 실패는 던진다(보던 값 유지). */
export async function fetchPublicGroupSchedule(slug: string): Promise<PublicGroupSchedule | null> {
  if (!PUBLIC_DRAW_ENABLED || !slug) return null;
  const { data, error } = await supabase.rpc('get_public_group_schedule', { p_slug: slug });
  if (error) {
    if (isMissingFunction(error)) return null;
    throw new Error('public group schedule unavailable');
  }
  return parsePublicGroupSchedule(data);
}

// ── 본부 ────────────────────────────────────────────────────────────────────

export interface ScheduleSettings {
  checkinPlace: string;
  session1CheckinDeadline: string | null;
  session1StartTime: string | null;
  session1StartNote: string | null;
  session2CheckinDeadline: string | null;
  session2StartTime: string | null;
  session2StartNote: string | null;
  updatedAt: string | null;
}

export interface AdminScheduleGroup {
  groupNo: number;
  groupType: 'preliminary' | 'placement';
  sessionNo: SessionNo | null;
  plannedCourtNo: number | null;
  teams: { teamNo: number; player1Name: string; player2Name: string }[];
}

export interface AdminScheduleCourt { courtNo: number; displayName: string | null; status: string }

export interface ScheduleWarning {
  kind: 'court_unknown' | 'court_disabled' | 'same_court_same_session' | 'court_over_two' | 'unassigned' | string;
  courtNo: number | null;
  groupNo: number | null;
  sessionNo: SessionNo | null;
  count: number | null;
}

export interface AdminGroupSchedule {
  drawStatus: 'draft' | 'locked' | string;
  drawPublishedAt: string | null;
  /** null = 아직 한 번도 저장하지 않음. */
  settings: ScheduleSettings | null;
  courts: AdminScheduleCourt[];
  groups: AdminScheduleGroup[];
  warnings: ScheduleWarning[];
}

/** 본부 조회. ready=false 는 권한 없음 · 대회 없음 · SQL 미적용. */
export async function fetchAdminGroupSchedule(slug: string): Promise<{ ready: boolean; data: AdminGroupSchedule | null; missing?: boolean }> {
  const { data, error } = await supabase.rpc('get_admin_group_schedule', { p_slug: slug });
  if (error) {
    if (isMissingFunction(error)) return { ready: false, data: null, missing: true };
    throw error;
  }
  if (data === null || data === undefined) return { ready: false, data: null };
  const o = rec(data);
  const st = o.settings ? rec(o.settings) : null;
  return {
    ready: true,
    data: {
      drawStatus: str(o.drawStatus) || 'draft',
      drawPublishedAt: strOrNull(o.drawPublishedAt),
      settings: st ? {
        checkinPlace: str(st.checkinPlace),
        session1CheckinDeadline: strOrNull(st.session1CheckinDeadline),
        session1StartTime: strOrNull(st.session1StartTime),
        session1StartNote: strOrNull(st.session1StartNote),
        session2CheckinDeadline: strOrNull(st.session2CheckinDeadline),
        session2StartTime: strOrNull(st.session2StartTime),
        session2StartNote: strOrNull(st.session2StartNote),
        updatedAt: strOrNull(st.updatedAt),
      } : null,
      courts: arr(o.courts).map((v) => { const c = rec(v); return { courtNo: numOrNull(c.courtNo) ?? 0, displayName: strOrNull(c.displayName), status: str(c.status) }; }),
      groups: arr(o.groups).map((v) => {
        const g = rec(v);
        return {
          groupNo: numOrNull(g.groupNo) ?? 0,
          groupType: str(g.groupType) === 'placement' ? 'placement' : 'preliminary',
          sessionNo: sessionOf(g.sessionNo),
          plannedCourtNo: numOrNull(g.plannedCourtNo),
          teams: arr(g.teams).map((t) => { const x = rec(t); return { teamNo: numOrNull(x.teamNo) ?? 0, player1Name: str(x.player1Name), player2Name: str(x.player2Name) }; }),
        };
      }),
      warnings: arr(o.warnings).map((v) => {
        const w = rec(v);
        return { kind: str(w.kind), courtNo: numOrNull(w.courtNo), groupNo: numOrNull(w.groupNo), sessionNo: sessionOf(w.sessionNo), count: numOrNull(w.count) };
      }),
    },
  };
}

export interface SettingsInput {
  checkinPlace: string;
  session1Deadline: string;
  session1Start: string;
  session1Note: string;
  session2Deadline: string;
  session2Start: string;
  session2Note: string;
}

const okOrThrow = (data: unknown) => {
  const o = rec(data);
  if (o.ok !== true) throw Object.assign(new Error(str(o.reason) || 'failed'), { reason: str(o.reason) });
  return o;
};

export async function saveScheduleSettings(slug: string, v: SettingsInput): Promise<void> {
  const { data, error } = await supabase.rpc('set_schedule_settings', {
    p_slug: slug, p_checkin_place: v.checkinPlace,
    p_session1_deadline: v.session1Deadline, p_session1_start: v.session1Start, p_session1_note: v.session1Note,
    p_session2_deadline: v.session2Deadline, p_session2_start: v.session2Start, p_session2_note: v.session2Note,
  });
  if (error) throw error;
  okOrThrow(data);
}

export async function saveGroupSchedule(slug: string, groupNo: number, sessionNo: SessionNo | null, plannedCourtNo: number | null): Promise<void> {
  const { data, error } = await supabase.rpc('set_group_schedule', {
    p_slug: slug, p_group_no: groupNo, p_session_no: sessionNo, p_planned_court_no: plannedCourtNo,
  });
  if (error) throw error;
  okOrThrow(data);
}

export function scheduleActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = str(e?.code);
  const key = str(e?.reason) || str(e?.message);
  if (code === '42501' || /not authorized/i.test(key)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (isMissingFunction(err)) return '조별 일정 기능이 아직 적용되지 않았습니다. (SQL 적용 대기)';
  switch (key) {
    case 'tournament_not_found':  return '대회를 찾을 수 없습니다.';
    case 'invalid_checkin_place': return '출전 신고 장소를 1~40자로 입력해 주세요.';
    case 'invalid_time':          return '시각은 08:40 처럼 HH:MM 형식으로 입력해 주세요.';
    case 'invalid_start_note':    return '시작 안내는 60자 이내로 입력해 주세요.';
    case 'invalid_session':       return '첫 번째 조 또는 두 번째 조를 선택해 주세요.';
    case 'invalid_court':
    case 'court_not_found':       return '등록되지 않은 코트입니다. 코트 관리에서 먼저 코트를 확인해 주세요.';
    case 'group_not_found':       return '조를 찾을 수 없습니다. 조편성을 다시 불러와 주세요.';
    default:                      return '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

export const WARNING_TEXT = (w: ScheduleWarning): string => {
  switch (w.kind) {
    case 'unassigned':              return `${w.groupNo}조: 순서 또는 예정 코트가 아직 지정되지 않았습니다.`;
    case 'court_unknown':           return `${w.groupNo}조: ${w.courtNo}번 코트가 코트 목록에 없습니다.`;
    case 'court_disabled':          return `${w.groupNo}조: ${w.courtNo}번 코트가 사용 중지 상태입니다.`;
    case 'same_court_same_session': return `${w.courtNo}번 코트에 ${w.sessionNo === 1 ? '첫 번째' : '두 번째'} 조가 ${w.count}개 지정되어 있습니다.`;
    case 'court_over_two':          return `${w.courtNo}번 코트에 조가 ${w.count}개 지정되어 있습니다(보통 2개).`;
    default:                        return '확인이 필요한 일정이 있습니다.';
  }
};
