// Club Schedule 정모 참석 체크 / 댓글 service.
// supabase/add_club_schedule_attendance.sql + add_club_schedule_attendance_settings.sql 의존.
// 식별자: PRIMARY user_id (auth.users.id) — UNIQUE(schedule_id, user_id) 적용됨.
//         member_id는 nullable로 함께 저장해 명단/이름 표시에 활용.

import { supabase } from './supabase';
import {
    resolveMemberDisplays,
    pickDisplayName,
    type ResolvedDisplays,
} from './memberDisplayResolver';

export type AttendanceStatus = 'attending' | 'not_attending';

// ArrivalTimeOption은 'HH:MM' 형태의 자유로운 문자열을 허용한다 — 정모 시작 시간이
// 18:30처럼 기본 후보 밖이어도 저장 가능. 후보 목록은 페이지에서 schedule.start_time
// 기반으로 동적 생성한다 (기본 19:00 / 19:30 / 20:00).
export type ArrivalTimeOption = string;
export type LeaveTimeOption = 'end' | '21:00' | '21:30';

export interface AttendanceRow {
    id: string;
    schedule_id: string;
    user_id: string;
    member_id: string | null;
    attendance_status: AttendanceStatus;
    arrival_time: string | null;     // 'HH:MM' (DB time)
    leave_time: string | null;       // 'end' | 'HH:MM'
    note: string | null;
    /**
     * 참석 저장 시점의 표시명 snapshot (members.nickname 기준).
     * 회원 lookup 실패 시 fallback 으로 사용. 카카오 닉네임 / 이메일 / UUID 저장 금지.
     * 컬럼이 운영 DB 에 아직 없는 환경에서도 안전하도록 service 는 retry-strip 처리.
     */
    display_name_snapshot: string | null;
    created_at: string;
    updated_at: string;
}

export interface AttendanceWithMember extends AttendanceRow {
    nickname: string | null;
    is_guest: boolean | null;
    /** members.avatar_url > profiles.avatar_url 우선순위로 해소된 사진. null이면 InitialAvatar fallback. */
    avatarUrl: string | null;
    /**
     * identity 식별용 — 화면/집계는 raw `member_id` 대신 이 값을 우선 사용.
     * 우선순위:
     *   1) attendance.member_id          (저장된 stable id)
     *   2) auth_user_id exact 매칭        (members.auth_user_id === attendance.user_id)
     *   3) profile.email exact 매칭       (members.email === profiles.email)
     *   4) 매칭 실패 → null  (snapshot 이름은 identity 로 사용하지 않음)
     */
    resolvedMemberId: string | null;
}

export interface AttendanceUpsertInput {
    schedule_id: string;
    user_id: string;
    member_id?: string | null;
    attendance_status: AttendanceStatus;
    arrival_time?: ArrivalTimeOption | null;
    leave_time?: LeaveTimeOption | null;
    note?: string | null;
    /**
     * 저장 시점에 운영진/회원이 알고 있는 표시명. 호출자가 members.nickname 을 채워 전달.
     * 회원 lookup 실패에도 명단에 사람 이름이 표시되도록 보호.
     */
    display_name_snapshot?: string | null;
}

export const ARRIVAL_OPTIONS: ArrivalTimeOption[] = ['19:00', '19:30', '20:00'];
export const LEAVE_OPTIONS: LeaveTimeOption[] = ['end', '21:00', '21:30'];

export const formatArrivalLabel = (t: ArrivalTimeOption) => `${t} 참석`;
export const formatLeaveLabel = (t: LeaveTimeOption) => (t === 'end' ? '끝까지' : `${t} 조퇴`);

// ── TEYEON 회원 권한 판정 (엄격) ────────────────────────────────────────────

/**
 * 정모 참석 체크는 TEYEON 회원만 가능.
 * 권한 판정의 유일한 기준: `members.auth_user_id = auth.uid()`.
 *
 * 이 함수는 attendance 저장 직전 / UI 잠금 여부 / 안전 자동 연결 평가에 동시에 쓰인다.
 * profile.email 추정 / 이름 부분 일치 / 카카오 닉네임은 절대 사용하지 않는다.
 */
export interface LinkedMember {
    /** members.id — 저장 payload 의 신뢰 가능한 단일 출처. */
    id: string;
    /** 화면 표시용 닉네임 (members.nickname). */
    nickname: string | null;
    /** 우리가 연결을 확정한 auth.users.id. 항상 호출자가 넘긴 userId 와 동일. */
    authUserId: string;
}

/**
 * 현재 사용자의 members row 를 auth_user_id 매칭으로만 조회.
 * 존재하지 않으면 null. caller 의 user_id 는 반드시 supabase 세션 (auth.uid()) 과 동일해야 한다.
 *
 * 보안 주의:
 *   - profile.email / members.email fallback 금지 (이 함수는 권한 판정용).
 *   - 동일 auth.uid() 에 매핑된 members row 가 둘 이상 존재하면 RLS / DB 의 무결성 문제이므로
 *     보수적으로 null 반환 + 경고 로그.
 */
export async function resolveLinkedMemberByAuthUid(userId: string): Promise<LinkedMember | null> {
    if (!userId) return null;
    try {
        const { data, error } = await supabase
            .from('members')
            .select('id, nickname, auth_user_id')
            .eq('auth_user_id', userId)
            .limit(2);
        if (error) {
            console.warn(
                `[ClubSchedule/linkedMember] code=${(error as any)?.code} | message=${(error as any)?.message}`,
            );
            return null;
        }
        const rows = (data || []) as Array<{ id: string; nickname: string | null; auth_user_id: string }>;
        if (rows.length === 0) return null;
        if (rows.length > 1) {
            console.warn(
                `[ClubSchedule/linkedMember] more than one members row matched auth_user_id — refusing to pick. ` +
                `Check unique constraint on members.auth_user_id.`
            );
            return null;
        }
        const m = rows[0];
        return {
            id: m.id,
            nickname: (m.nickname ?? '').trim() || null,
            authUserId: m.auth_user_id,
        };
    } catch (e: any) {
        console.warn('[ClubSchedule/linkedMember] threw', e?.message ?? e);
        return null;
    }
}

/**
 * 비회원이 service 직접 호출 / UI 우회로 attendance 를 저장하려 했을 때 던지는 표준 에러.
 * UI 는 try/catch 로 받아 "TEYEON 회원 전용 안내" 를 보여준다.
 */
export class AttendanceForbiddenError extends Error {
    constructor(message = 'TEYEON 회원 계정만 참석 체크를 저장할 수 있습니다.') {
        super(message);
        this.name = 'AttendanceForbiddenError';
    }
}

// ── Attendance CRUD ────────────────────────────────────────────────────────

/**
 * PostgreSQL의 time 컬럼은 select 시 'HH:MM:SS'로 돌아오는 반면, 화면 칩 비교는
 * 'HH:MM' 형식을 사용한다. 비교/저장이 항상 일치하도록 한 곳에서 정규화.
 * leave_time은 TEXT('end' | 'HH:MM')이라 그대로 유지.
 */
const normalizeArrivalTime = (raw: unknown): string | null => {
    if (raw == null) return null;
    const s = String(raw);
    if (s.length === 0) return null;
    // 'HH:MM:SS' / 'HH:MM:SS.sss' / 'HH:MM' 모두 첫 5자만 사용
    return s.slice(0, 5);
};

const normalizeAttendanceRow = <T extends { arrival_time: string | null }>(row: T): T => ({
    ...row,
    arrival_time: normalizeArrivalTime(row.arrival_time),
});

export async function fetchMyAttendance(
    scheduleId: string,
    userId: string,
): Promise<AttendanceRow | null> {
    const { data, error } = await supabase
        .from('club_schedule_attendances')
        .select('*')
        .eq('schedule_id', scheduleId)
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return normalizeAttendanceRow(data as AttendanceRow);
}

/**
 * `display_name_snapshot` 컬럼이 운영 DB 에 적용되지 않은 환경 대응 헬퍼.
 * 컬럼 미존재 에러('column ... does not exist' / PGRST204)이면 payload 에서 떼고 재시도.
 */
async function attendanceRequestWithSnapshotRetry(
    payload: Record<string, any>,
    mode: 'insert' | 'update',
    existingId?: string,
): Promise<AttendanceRow> {
    const doRequest = async (p: Record<string, any>) => {
        if (mode === 'update' && existingId) {
            return await supabase.from('club_schedule_attendances').update(p).eq('id', existingId).select('*').single();
        }
        return await supabase.from('club_schedule_attendances').insert([p]).select('*').single();
    };
    let res = await doRequest(payload);
    if (res.error) {
        const msg = `${(res.error as any)?.message || ''} ${(res.error as any)?.details || ''}`;
        if (/display_name_snapshot/i.test(msg)) {
            console.warn(
                '[Attendances/save] display_name_snapshot column missing — ' +
                'saving without snapshot. Apply supabase/add_attendance_display_name_snapshot.sql to enable.'
            );
            const { display_name_snapshot: _omit, ...rest } = payload;
            res = await doRequest(rest);
        }
    }
    if (res.error) throw res.error;
    return normalizeAttendanceRow(res.data as AttendanceRow);
}

export async function upsertAttendance(input: AttendanceUpsertInput): Promise<AttendanceRow> {
    // ── 권한 게이트 ──────────────────────────────────────────────────────────
    // UI 우회 (직접 service 호출 / 콘솔 호출 / 스크립트) 도 차단해야 함.
    // 유일한 기준: members.auth_user_id = auth.uid().
    //   - caller 가 넘긴 member_id 는 신뢰하지 않는다 (다른 회원 사칭 차단).
    //   - 매핑 없으면 AttendanceForbiddenError throw — 저장 자체 차단.
    //   - DB 의 INSERT/UPDATE 정책 (restrict_club_attendance_to_members.sql) 과 이중 방어.
    const linked = await resolveLinkedMemberByAuthUid(input.user_id);
    if (!linked) {
        throw new AttendanceForbiddenError();
    }
    const trustedMemberId = linked.id;

    const payload: Record<string, any> = {
        schedule_id: input.schedule_id,
        user_id: input.user_id,
        // ⚠️ caller 가 넘긴 input.member_id 는 사용하지 않음 — 항상 strict resolver 결과로 강제.
        member_id: trustedMemberId,
        attendance_status: input.attendance_status,
        // 불참이면 시간 필드는 강제로 null — DB constraint와 일치시킨다.
        arrival_time: input.attendance_status === 'attending' ? (input.arrival_time ?? null) : null,
        leave_time:   input.attendance_status === 'attending' ? (input.leave_time ?? null)   : null,
        note: input.note ?? null,
        // 표시명 snapshot — caller 가 넘긴 값이 비어있으면 members.nickname 으로 보정.
        display_name_snapshot:
            ((input.display_name_snapshot ?? '').trim() || linked.nickname || null),
        updated_at: new Date().toISOString(),
    };

    // 명시적 select → update/insert. supabase.upsert(onConflict)가 일부 환경에서
    // UNIQUE index와 호환되지 않는 케이스를 피하고, RLS도 insert/update 정책으로 명확히 갈린다.
    const { data: existing, error: fetchErr } = await supabase
        .from('club_schedule_attendances')
        .select('id')
        .eq('schedule_id', input.schedule_id)
        .eq('user_id', input.user_id)
        .maybeSingle();
    if (fetchErr) throw fetchErr;

    if (existing?.id) {
        return await attendanceRequestWithSnapshotRetry(payload, 'update', existing.id);
    }
    return await attendanceRequestWithSnapshotRetry(payload, 'insert');
}

/**
 * 본인 참석 응답 취소 — 자신의 attendance row 를 삭제해 미응답 상태로 복구한다.
 *   - 별도 'cancelled' 상태를 저장하지 않는다(row 자체 삭제 → row 부재 = 미응답).
 *   - 회원 전용: members.auth_user_id = auth.uid() 매핑이 있어야 한다(upsert 와 동일 기준).
 *   - 삭제 범위는 schedule_id + user_id(=auth.uid()) 로 강제 → 본인 row 만, 타인 row 삭제 불가.
 *     caller 가 attendance id 를 넘기더라도 사용하지 않는다(사칭/우회 방지).
 *   - DB 의 DELETE 정책(club_schedule_attendances_delete: auth.uid() = user_id)이 서버단 이중 방어.
 */
export async function deleteMyAttendance(scheduleId: string, userId: string): Promise<void> {
    if (!scheduleId || !userId) {
        throw new AttendanceForbiddenError('일정 또는 사용자 정보가 없어 응답을 취소할 수 없습니다.');
    }
    // 1) 현재 세션 확인 + caller 가 넘긴 userId 가 실제 auth.uid() 와 일치하는지(사칭 방지).
    const { data: { session } } = await supabase.auth.getSession();
    const sessionUid = session?.user?.id;
    if (!sessionUid || sessionUid !== userId) {
        throw new AttendanceForbiddenError('로그인 세션을 확인할 수 없어 응답을 취소할 수 없습니다.');
    }
    // 2) 연결 회원 확인(회원 전용 정책 — 미연결/게스트는 취소 불가).
    const linked = await resolveLinkedMemberByAuthUid(userId);
    if (!linked) {
        throw new AttendanceForbiddenError();
    }
    // 3) 본인 row 만 삭제. RLS(auth.uid() = user_id)가 서버단에서 한 번 더 보장.
    const { error } = await supabase
        .from('club_schedule_attendances')
        .delete()
        .eq('schedule_id', scheduleId)
        .eq('user_id', userId);
    if (error) {
        // 개인정보 제외, 디버그용 코드/메시지만.
        console.warn(
            `[Attendances/cancel] code=${(error as any)?.code} | message=${(error as any)?.message} | ` +
            `details=${(error as any)?.details} | hint=${(error as any)?.hint}`,
        );
        throw error;
    }
}

/**
 * 일정의 모든 참석 row + members 닉네임을 가져온다.
 *
 * 이전에는 `select('*, members:member_id(...)')`로 inner join을 시도했는데,
 * members 테이블 RLS 또는 PostgREST 관계 설정 문제로 join이 깨지면 attendances
 * 자체 fetch까지 실패하는 부작용이 있었다. 이제는 attendances 우선 fetch →
 * members는 별도 보조 쿼리로 보강. members 조회가 실패해도 시간대별 현황은 정상 동작.
 */
export async function fetchAttendancesWithMembers(
    scheduleId: string,
): Promise<AttendanceWithMember[]> {
    // 1) attendances 본체 — 이 쿼리만 throw하면 호출자가 에러 표시.
    //    display_name_snapshot 미적용 환경 대비: 컬럼 누락 에러면 한 번 폴백 select.
    type RawRow = {
        id: string; schedule_id: string; user_id: string; member_id: string | null;
        attendance_status: AttendanceStatus;
        arrival_time: string | null; leave_time: string | null; note: string | null;
        display_name_snapshot: string | null;
        created_at: string; updated_at: string;
    };
    let attendances: RawRow[] = [];
    {
        const sel =
            'id, schedule_id, user_id, member_id, attendance_status, ' +
            'arrival_time, leave_time, note, display_name_snapshot, created_at, updated_at';
        const { data, error } = await supabase
            .from('club_schedule_attendances')
            .select(sel)
            .eq('schedule_id', scheduleId);
        if (error) {
            const msg = `${(error as any)?.message || ''} ${(error as any)?.details || ''}`;
            if (/display_name_snapshot/i.test(msg)) {
                console.warn(
                    '[Attendances/fetch] display_name_snapshot column missing — falling back. ' +
                    'Apply supabase/add_attendance_display_name_snapshot.sql to enable name snapshot fallback.'
                );
                const fb = await supabase
                    .from('club_schedule_attendances')
                    .select(
                        'id, schedule_id, user_id, member_id, attendance_status, ' +
                        'arrival_time, leave_time, note, created_at, updated_at'
                    )
                    .eq('schedule_id', scheduleId);
                if (fb.error) throw fb.error;
                attendances = ((fb.data || []) as any[]).map((r) => ({ ...r, display_name_snapshot: null }));
            } else {
                throw error;
            }
        } else {
            attendances = ((data || []) as any[]) as RawRow[];
        }
    }

    const normalized: AttendanceWithMember[] = attendances.map((row) => ({
        id: row.id,
        schedule_id: row.schedule_id,
        user_id: row.user_id,
        member_id: row.member_id,
        attendance_status: row.attendance_status,
        arrival_time: normalizeArrivalTime(row.arrival_time),
        leave_time: row.leave_time,
        note: row.note,
        display_name_snapshot: row.display_name_snapshot,
        created_at: row.created_at,
        updated_at: row.updated_at,
        nickname: null,
        is_guest: null,
        avatarUrl: null,
        resolvedMemberId: null,
    }));

    // 2) 공통 resolver로 일괄 해소 — comments와 동일 로직 재사용 (N+1 회피, 최대 3 batch).
    let resolved: ResolvedDisplays;
    try {
        resolved = await resolveMemberDisplays(
            normalized.map((r) => ({ userId: r.user_id, memberId: r.member_id })),
        );
    } catch (e: any) {
        console.warn(`[Attendances/resolve] failed — fallback to empty:`, e?.message ?? e);
        resolved = { byUserId: new Map(), byMemberId: new Map() };
    }

    // 3) 이름 + identity 합성.
    //    identity (resolvedMemberId) — 집계/중복 방지 키. snapshot 은 절대 identity 로 사용하지 않음.
    //      우선순위: attendance.member_id  →  resolver hit (member id / auth_user_id exact)  →  null
    //    name — 화면 표시용. snapshot 은 매핑 실패 시에만 fallback.
    //      우선순위: resolver hit (members.nickname)  →  attendance.display_name_snapshot  →  '회원 정보 없음'
    //    카카오 닉네임 / 이메일 / UUID 는 어떤 경로로도 사용되지 않음.
    let unresolvedCount = 0;
    for (const row of normalized) {
        const pick = pickDisplayName({
            userId: row.user_id,
            memberId: row.member_id,
            resolved,
            selfName: null,
        });
        // identity 확정 — raw attendance.member_id 우선, 없으면 resolver 결과.
        // snapshot 은 identity 에 절대 포함하지 않는다.
        row.resolvedMemberId = row.member_id ?? pick.resolvedMemberId ?? null;

        if (pick.name !== '회원 정보 없음') {
            row.nickname = pick.name;
        } else if (row.display_name_snapshot) {
            // resolver 실패 → 표시명만 snapshot 으로 보강 (identity 는 위에서 이미 결정됨).
            row.nickname = row.display_name_snapshot;
        } else {
            unresolvedCount += 1;
        }
        if (pick.isGuest !== null) row.is_guest = pick.isGuest;
        if (pick.avatarUrl) row.avatarUrl = pick.avatarUrl;
        // 화면용 보강 — DB 는 미변경. 다음 저장 시 page 가 member_id 를 함께 저장.
        // ⚠️ snapshot 으로 member_id 를 채우지 않는다 (이름 → uuid 추정 금지).
    }

    // 개발 진단 — 매핑 실패 row 수만 로그 (UUID 본문 출력 금지). 운영 환경 미출력.
    if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
        const withMemberId = normalized.filter((r) => !!r.member_id).length;
        const withResolved = normalized.filter((r) => !!r.resolvedMemberId).length;
        const withSnapshot = normalized.filter((r) => !!r.display_name_snapshot).length;
        // eslint-disable-next-line no-console
        console.info(
            `[Attendances/resolve] total=${normalized.length} memberIdSet=${withMemberId} ` +
            `resolved=${withResolved} snapshotSet=${withSnapshot} unresolved=${unresolvedCount}`
        );
    }

    return normalized;
}

/**
 * 로그인 사용자의 member.id를 안정적으로 찾는다.
 * 1순위: members.auth_user_id == user.id (운영진 사전 매핑 — 가장 강한 신호, 대부분 커버)
 * 2순위: 본인 session email 로 members.email exact (미연결 회원 보조)
 * 둘 다 실패하면 null. attendance 저장은 그대로 진행 (member_id nullable).
 *
 * P1-2 개인정보 최소화: profiles.email 조회를 제거(email payload 방지). 2순위의 입력 email 은
 * Supabase Auth 세션 값(opts.userEmail)이며, members 조회는 select('id') 라 응답에 email 이 없다.
 */
export async function resolveMemberIdForUser(opts: {
    userId: string;
    userEmail?: string | null;
}): Promise<string | null> {
    // 1순위: auth_user_id exact — DB unique 사전 매핑.
    try {
        const { data: m } = await supabase
            .from('members')
            .select('id')
            .eq('auth_user_id', opts.userId)
            .limit(1)
            .maybeSingle();
        if (m?.id) return m.id as string;
    } catch {
        /* swallow — 2순위 시도 */
    }

    // 2순위: 본인 세션 email 로 members.email (응답은 id 만 — email 미노출).
    if (opts.userEmail) {
        try {
            const { data: m } = await supabase
                .from('members')
                .select('id')
                .eq('email', opts.userEmail)
                .limit(1)
                .maybeSingle();
            if (m?.id) return m.id as string;
        } catch { /* noop */ }
    }
    return null;
}

// ── Aggregations for 시간대별 참석 현황 ────────────────────────────────────

export interface ArrivalBucket {
    time: ArrivalTimeOption;
    count: number;
    members: AttendanceWithMember[];
}

export interface LeaveBucket {
    time: LeaveTimeOption;
    count: number;
    members: AttendanceWithMember[];
}

export interface AttendanceSummary {
    totalAttending: number;
    totalNotAttending: number;
    totalPending: number;            // members 수 - 응답 수
    totalGuestsAttending: number;
    arrivalBuckets: ArrivalBucket[]; // 19:00 / 19:30 / 20:00
    leaveBuckets: LeaveBucket[];     // end / 21:00 / 21:30
    attendingList: AttendanceWithMember[];
    notAttendingList: AttendanceWithMember[];
    rawCount: number;
}

export function buildAttendanceSummary(
    rows: AttendanceWithMember[],
    totalMemberCount: number,
    arrivalCandidates?: string[],
): AttendanceSummary {
    const attendingList = rows.filter((r) => r.attendance_status === 'attending');
    const notAttendingList = rows.filter((r) => r.attendance_status === 'not_attending');

    // arrivalCandidates(예: ['18:30','19:00','19:30','20:00'])가 주어지면 그것을 사용.
    // 없으면 기본 ARRIVAL_OPTIONS 유지. + 실제 row에 존재하는 시간 중 후보 밖이면 자동 추가.
    const baseCandidates = arrivalCandidates && arrivalCandidates.length > 0
        ? arrivalCandidates
        : ([...ARRIVAL_OPTIONS] as string[]);
    const extra = new Set<string>();
    for (const r of attendingList) {
        if (r.arrival_time && !baseCandidates.includes(r.arrival_time)) extra.add(r.arrival_time);
    }
    const finalCandidates = Array.from(new Set([...baseCandidates, ...extra])).sort();

    const arrivalBuckets: ArrivalBucket[] = finalCandidates.map((time) => {
        const members = attendingList.filter((r) => r.arrival_time === time);
        return { time: time as ArrivalTimeOption, count: members.length, members };
    });

    const leaveBuckets: LeaveBucket[] = LEAVE_OPTIONS.map((time) => {
        const members = attendingList.filter((r) => r.leave_time === time);
        return { time, count: members.length, members };
    });

    const totalAttending = attendingList.length;
    const totalNotAttending = notAttendingList.length;
    const responded = totalAttending + totalNotAttending;
    const totalPending = Math.max(0, totalMemberCount - responded);
    const totalGuestsAttending = attendingList.filter((r) => r.is_guest === true).length;

    return {
        totalAttending,
        totalNotAttending,
        totalPending,
        totalGuestsAttending,
        arrivalBuckets,
        leaveBuckets,
        attendingList,
        notAttendingList,
        rawCount: rows.length,
    };
}

// ── 마감 시간 / 편집 가능 여부 ─────────────────────────────────────────────

/**
 * 참석 체크 가능한 상태인지 판정.
 * 기준:
 *   - attendance_enabled === false → 불가 (UI 자체 숨김)
 *   - attendance_deadline 있고 현재 > deadline → 불가
 *   - attendance_deadline 없으면 schedule_date + start_time 직전까지 가능 (없으면 schedule_date 자정)
 */
export interface AttendanceWindowState {
    isOpen: boolean;
    isDisabledByFlag: boolean;
    isPastDeadline: boolean;
    deadline: Date | null;
}

export function evaluateAttendanceWindow(opts: {
    attendance_enabled?: boolean;
    attendance_deadline?: string | null;
    schedule_date: string;
    start_time?: string;
    now?: Date;
}): AttendanceWindowState {
    const now = opts.now ?? new Date();
    const flagEnabled = opts.attendance_enabled !== false; // default true

    if (!flagEnabled) {
        return { isOpen: false, isDisabledByFlag: true, isPastDeadline: false, deadline: null };
    }

    let deadline: Date | null = null;
    if (opts.attendance_deadline) {
        deadline = new Date(opts.attendance_deadline);
    } else {
        // 마감 시간 미지정 — 일정 시작 시각, 없으면 일정 당일 00:00.
        const [y, m, d] = opts.schedule_date.split('-').map(Number);
        if (opts.start_time) {
            const [hh, mm] = opts.start_time.split(':').map(Number);
            deadline = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
        } else {
            deadline = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
        }
    }

    const isPastDeadline = deadline ? now.getTime() > deadline.getTime() : false;
    return {
        isOpen: !isPastDeadline,
        isDisabledByFlag: false,
        isPastDeadline,
        deadline,
    };
}

// ── 댓글 (특이사항 / 파트너 요청) ──────────────────────────────────────────

export interface CommentRow {
    id: string;
    schedule_id: string;
    user_id: string;
    member_id: string | null;
    category: string | null;     // '파트너 요청' / '늦음' / '조퇴' / null
    body: string;
    /** 1단계 대댓글의 원댓글 id. null이면 원댓글. 2단계 이상 중첩은 service에서 정규화. */
    parent_comment_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface CommentWithMember extends CommentRow {
    nickname: string | null;
    /** members.avatar_url > profiles.avatar_url 우선순위로 해소된 사진. null이면 InitialAvatar fallback. */
    avatarUrl: string | null;
    /** 원댓글일 때만 채워짐. 답글 리스트는 created_at ASC. */
    replies?: CommentWithMember[];
}

export async function fetchComments(scheduleId: string): Promise<CommentWithMember[]> {
    // 1) comments 본체 — 관계 join을 빼고 단순 select. RLS/관계 문제로 join 실패 시
    //    댓글 전체가 사라지는 위험 차단. parent_comment_id 포함 — 답글 트리 구성용.
    //    parent_comment_id 컬럼이 운영 DB에 아직 없을 수도 있으므로 한 번 실패 시 폴백.
    type RawCommentRow = {
        id: string; schedule_id: string; user_id: string; member_id: string | null;
        category: string | null; body: string;
        parent_comment_id: string | null;
        created_at: string; updated_at: string;
    };
    let rows: RawCommentRow[] = [];
    {
        const { data, error } = await supabase
            .from('club_schedule_comments')
            .select(
                'id, schedule_id, user_id, member_id, category, body, parent_comment_id, ' +
                'created_at, updated_at'
            )
            .eq('schedule_id', scheduleId)
            .order('created_at', { ascending: true });
        if (error) {
            const e: any = error;
            const missing = /parent_comment_id/i.test(`${e?.message || ''} ${e?.details || ''}`);
            if (!missing) {
                console.warn(
                    `[Comments/fetch] code=${e?.code} | message=${e?.message} | details=${e?.details} | hint=${e?.hint}`,
                );
                throw error;
            }
            // parent_comment_id 컬럼 미적용 환경 — supabase/add_club_schedule_comment_replies.sql 안내.
            console.warn(
                '[Comments/fetch] parent_comment_id column missing — falling back to flat comments. ' +
                'Apply supabase/add_club_schedule_comment_replies.sql to enable replies.'
            );
            const fb = await supabase
                .from('club_schedule_comments')
                .select('id, schedule_id, user_id, member_id, category, body, created_at, updated_at')
                .eq('schedule_id', scheduleId)
                .order('created_at', { ascending: true });
            if (fb.error) throw fb.error;
            rows = ((fb.data || []) as any[]).map((r) => ({ ...r, parent_comment_id: null }));
        } else {
            rows = ((data || []) as any[]) as RawCommentRow[];
        }
    }

    // 2) 공통 resolver로 이름 일괄 해소 (원댓글 + 답글 모두 한 번에).
    //    한 댓글의 이름 조회 실패가 다른 댓글 전체 로드를 막지 않도록 resolver는 내부에서
    //    예외 swallow 후 로그만 남김.
    let resolved: ResolvedDisplays;
    try {
        resolved = await resolveMemberDisplays(
            rows.map((r) => ({ userId: r.user_id, memberId: r.member_id })),
        );
    } catch (e: any) {
        console.warn(`[Comments/resolve] failed completely — fallback to empty:`, e?.message ?? e);
        resolved = { byUserId: new Map(), byMemberId: new Map() };
    }

    const enriched: CommentWithMember[] = rows.map((row) => {
        const pick = pickDisplayName({
            userId: row.user_id,
            memberId: row.member_id,
            resolved,
            selfName: null,
        });
        return {
            id: row.id,
            schedule_id: row.schedule_id,
            user_id: row.user_id,
            member_id: row.member_id ?? pick.resolvedMemberId,
            category: row.category,
            body: row.body,
            parent_comment_id: row.parent_comment_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            nickname: pick.name === '회원 정보 없음' ? null : pick.name,
            avatarUrl: pick.avatarUrl,
        };
    });

    // 3) 트리 구성 — 원댓글 아래 답글 배열 attach.
    //    parent_comment_id 가 유효하지 않거나(부모가 없거나) 1단계를 초과하면
    //    안전하게 원댓글로 승격(parent를 null로 처리)해 표시.
    const parents: CommentWithMember[] = [];
    const repliesByParent = new Map<string, CommentWithMember[]>();
    const idSet = new Set(enriched.map((c) => c.id));
    for (const c of enriched) {
        if (c.parent_comment_id && idSet.has(c.parent_comment_id)) {
            const arr = repliesByParent.get(c.parent_comment_id);
            if (arr) arr.push(c); else repliesByParent.set(c.parent_comment_id, [c]);
        } else {
            // 원댓글이거나, 부모를 찾지 못한 고아 답글은 원댓글로 표시 (안전)
            parents.push({ ...c, parent_comment_id: null });
        }
    }
    // 답글은 created_at ASC (오래된 순) — 원댓글 조회 결과의 정렬이 ASC라 그대로 유지.
    for (const p of parents) {
        const replies = repliesByParent.get(p.id);
        p.replies = replies ?? [];
    }
    return parents;
}

export async function createComment(input: {
    schedule_id: string;
    user_id: string;
    member_id?: string | null;
    category?: string | null;
    body: string;
    /** 답글 작성 시 부모 댓글 id. 답글의 답글은 정규화하여 1단계로 강제. null/미지정이면 원댓글. */
    parent_comment_id?: string | null;
}): Promise<CommentRow> {
    // ── 1단계 강제 정규화 ───────────────────────────────────────────────────
    // - parent_comment_id 가 지정되었으면 해당 댓글이 답글(=parent.parent_comment_id가 있음)인지 확인
    // - 답글에 대해 답글을 다시 다는 경우 실제 parent는 그 답글의 parent_comment_id 로 정규화
    // - 다른 일정의 댓글을 parent로 지정하는 것은 schedule_id 비교로 차단
    // - 본인을 parent로 지정하는 것은 insert 전이라 id가 없으므로 자연스럽게 불가
    let normalizedParentId: string | null = null;
    if (input.parent_comment_id) {
        try {
            const { data: parent, error: pErr } = await supabase
                .from('club_schedule_comments')
                .select('id, parent_comment_id, schedule_id')
                .eq('id', input.parent_comment_id)
                .maybeSingle();
            if (pErr) {
                // parent_comment_id 컬럼 자체가 없으면 답글 기능을 무시하고 원댓글로 저장.
                const msg = (pErr as any)?.message || '';
                if (/parent_comment_id/i.test(msg)) {
                    normalizedParentId = null;
                } else {
                    throw pErr;
                }
            } else if (parent) {
                if (parent.schedule_id !== input.schedule_id) {
                    throw new Error('[Comments] parent comment belongs to a different schedule');
                }
                normalizedParentId = parent.parent_comment_id || parent.id;
            }
        } catch (e: any) {
            // 정규화 단계 실패는 답글 저장 자체를 막지 않음 — 안전을 위해 원댓글로 떨어짐.
            console.warn('[Comments/normalizeParent] failed — falling back to top-level comment:', e?.message ?? e);
            normalizedParentId = null;
        }
    }

    const payload: Record<string, any> = {
        schedule_id: input.schedule_id,
        user_id: input.user_id,
        member_id: input.member_id ?? null,
        category: input.category ?? null,
        body: input.body.trim(),
    };
    if (normalizedParentId) payload.parent_comment_id = normalizedParentId;

    const { data, error } = await supabase
        .from('club_schedule_comments')
        .insert([payload])
        .select('*')
        .single();
    if (error) {
        // parent_comment_id 컬럼 미적용 환경 — payload에서 제외하고 1회 재시도.
        const msg = (error as any)?.message || (error as any)?.details || '';
        if (normalizedParentId && /parent_comment_id/i.test(msg)) {
            console.warn(
                '[Comments/create] parent_comment_id column missing — saving as top-level comment. ' +
                'Apply supabase/add_club_schedule_comment_replies.sql to enable replies.'
            );
            delete payload.parent_comment_id;
            const retry = await supabase
                .from('club_schedule_comments')
                .insert([payload])
                .select('*')
                .single();
            if (retry.error) throw retry.error;
            return retry.data as CommentRow;
        }
        throw error;
    }
    return data as CommentRow;
}

export async function updateComment(input: {
    id: string;
    body: string;
    category?: string | null;
}): Promise<CommentRow> {
    const { data, error } = await supabase
        .from('club_schedule_comments')
        .update({
            body: input.body.trim(),
            category: input.category ?? null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', input.id)
        .select('*')
        .single();
    if (error) throw error;
    return data as CommentRow;
}

export async function deleteComment(id: string): Promise<void> {
    const { error } = await supabase
        .from('club_schedule_comments')
        .delete()
        .eq('id', id);
    if (error) throw error;
}
