// 예선 조별 일정 안내 — 순수 함수 · 타입(서버 호출 없음). 공개 화면 · MY MATCH · 미리보기가 같이 쓴다.
//   ⚠ 몇 번째 조인지 · 예정 코트는 운영진이 지정한 값 그대로다. 여기서 추정하지 않는다.

export type SessionNo = 1 | 2;

export interface PublicSession {
  sessionNo: SessionNo;
  checkinDeadline: string | null;   // 'HH:MM'
  startTime: string | null;         // 'HH:MM'
  startNote: string | null;
}

export interface PublicGroupScheduleRow {
  groupNo: number;
  sessionNo: SessionNo | null;
  plannedCourtNo: number | null;
  plannedCourtName: string | null;
}

export interface PublicGroupSchedule {
  checkinPlace: string | null;
  sessions: PublicSession[];
  groups: PublicGroupScheduleRow[];
}

/** 한 조의 안내(화면용) — 지정된 값만 채운다. */
export interface GroupScheduleInfo {
  groupNo: number;
  sessionNo: SessionNo | null;
  sessionLabel: string | null;
  plannedCourtNo: number | null;
  plannedCourtText: string | null;
  checkinDeadline: string | null;
  startTime: string | null;
  startNote: string | null;
  checkinPlace: string | null;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sessionOf = (v: unknown): SessionNo | null => (v === 1 || v === '1' ? 1 : v === 2 || v === '2' ? 2 : null);


export const SESSION_LABEL: Record<SessionNo, string> = { 1: '첫 번째 조', 2: '두 번째 조' };

export function parsePublicGroupSchedule(data: unknown): PublicGroupSchedule | null {
  if (data === null || data === undefined) return null;
  const o = rec(data);
  return {
    checkinPlace: strOrNull(o.checkinPlace),
    sessions: arr(o.sessions).map((v) => {
      const s = rec(v);
      return {
        sessionNo: sessionOf(s.sessionNo) ?? 1,
        checkinDeadline: strOrNull(s.checkinDeadline),
        startTime: strOrNull(s.startTime),
        startNote: strOrNull(s.startNote),
      };
    }),
    groups: arr(o.groups).map((v) => {
      const g = rec(v);
      return {
        groupNo: numOrNull(g.groupNo) ?? 0,
        sessionNo: sessionOf(g.sessionNo),
        plannedCourtNo: numOrNull(g.plannedCourtNo),
        plannedCourtName: strOrNull(g.plannedCourtName),
      };
    }),
  };
}

export const plannedCourtText = (no: number | null, name: string | null): string | null =>
  no === null ? null : name || `${no}번 코트`;

/** 조 번호 → 화면 안내. 그 조에 지정된 것이 하나도 없으면 null. */
export function scheduleForGroup(schedule: PublicGroupSchedule | null, groupNo: number): GroupScheduleInfo | null {
  if (!schedule) return null;
  const row = schedule.groups.find((g) => g.groupNo === groupNo);
  if (!row || (row.sessionNo === null && row.plannedCourtNo === null)) return null;
  const s = row.sessionNo ? schedule.sessions.find((x) => x.sessionNo === row.sessionNo) ?? null : null;
  return {
    groupNo,
    sessionNo: row.sessionNo,
    sessionLabel: row.sessionNo ? SESSION_LABEL[row.sessionNo] : null,
    plannedCourtNo: row.plannedCourtNo,
    plannedCourtText: plannedCourtText(row.plannedCourtNo, row.plannedCourtName),
    checkinDeadline: s?.checkinDeadline ?? null,
    startTime: s?.startTime ?? null,
    startNote: s?.startNote ?? null,
    checkinPlace: schedule.checkinPlace,
  };
}

/** 공통 안내에 보여 줄 내용이 있는가. */
export const hasCommonNotice = (s: PublicGroupSchedule | null): boolean =>
  !!s && (!!s.checkinPlace || s.sessions.some((x) => x.checkinDeadline || x.startTime || x.startNote));
