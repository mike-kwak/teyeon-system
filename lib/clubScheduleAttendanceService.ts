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
    created_at: string;
    updated_at: string;
}

export interface AttendanceWithMember extends AttendanceRow {
    nickname: string | null;
    is_guest: boolean | null;
    /** members.avatar_url > profiles.avatar_url 우선순위로 해소된 사진. null이면 InitialAvatar fallback. */
    avatarUrl: string | null;
}

export interface AttendanceUpsertInput {
    schedule_id: string;
    user_id: string;
    member_id?: string | null;
    attendance_status: AttendanceStatus;
    arrival_time?: ArrivalTimeOption | null;
    leave_time?: LeaveTimeOption | null;
    note?: string | null;
}

export const ARRIVAL_OPTIONS: ArrivalTimeOption[] = ['19:00', '19:30', '20:00'];
export const LEAVE_OPTIONS: LeaveTimeOption[] = ['end', '21:00', '21:30'];

export const formatArrivalLabel = (t: ArrivalTimeOption) => `${t} 참석`;
export const formatLeaveLabel = (t: LeaveTimeOption) => (t === 'end' ? '끝까지' : `${t} 조퇴`);

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

export async function upsertAttendance(input: AttendanceUpsertInput): Promise<AttendanceRow> {
    const payload = {
        schedule_id: input.schedule_id,
        user_id: input.user_id,
        member_id: input.member_id ?? null,
        attendance_status: input.attendance_status,
        // 불참이면 시간 필드는 강제로 null — DB constraint와 일치시킨다.
        arrival_time: input.attendance_status === 'attending' ? (input.arrival_time ?? null) : null,
        leave_time:   input.attendance_status === 'attending' ? (input.leave_time ?? null)   : null,
        note: input.note ?? null,
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
        const { data, error } = await supabase
            .from('club_schedule_attendances')
            .update(payload)
            .eq('id', existing.id)
            .select('*')
            .single();
        if (error) throw error;
        return normalizeAttendanceRow(data as AttendanceRow);
    }

    const { data, error } = await supabase
        .from('club_schedule_attendances')
        .insert([payload])
        .select('*')
        .single();
    if (error) throw error;
    return normalizeAttendanceRow(data as AttendanceRow);
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
    const { data: attendances, error: attErr } = await supabase
        .from('club_schedule_attendances')
        .select(
            'id, schedule_id, user_id, member_id, attendance_status, ' +
            'arrival_time, leave_time, note, created_at, updated_at'
        )
        .eq('schedule_id', scheduleId);
    if (attErr) throw attErr;

    const normalized: AttendanceWithMember[] = (attendances || []).map((row: any) => ({
        id: row.id,
        schedule_id: row.schedule_id,
        user_id: row.user_id,
        member_id: row.member_id,
        attendance_status: row.attendance_status,
        arrival_time: normalizeArrivalTime(row.arrival_time),
        leave_time: row.leave_time,
        note: row.note,
        created_at: row.created_at,
        updated_at: row.updated_at,
        nickname: null,
        is_guest: null,
        avatarUrl: null,
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

    for (const row of normalized) {
        const pick = pickDisplayName({
            userId: row.user_id,
            memberId: row.member_id,
            resolved,
            selfName: null,
        });
        if (pick.name !== '회원 정보 없음') {
            row.nickname = pick.name;
        }
        if (pick.isGuest !== null) row.is_guest = pick.isGuest;
        if (pick.avatarUrl) row.avatarUrl = pick.avatarUrl;
        // 화면용 보강 — DB는 미변경. 다음 저장 시 page가 정식 member_id로 update.
        if (!row.member_id && pick.resolvedMemberId) row.member_id = pick.resolvedMemberId;
    }

    return normalized;
}

/**
 * 로그인 사용자의 member.id를 안정적으로 찾는다.
 * 1순위: profiles.id == user.id → profiles.email → members.email
 * 2순위: 직접 user.email로 members.email
 * 둘 다 실패하면 null. attendance 저장은 그대로 진행 (member_id nullable).
 */
export async function resolveMemberIdForUser(opts: {
    userId: string;
    userEmail?: string | null;
}): Promise<string | null> {
    // 1순위: profiles 우회. profiles.id가 곧 auth.users.id이므로 exact match.
    try {
        const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', opts.userId)
            .maybeSingle();
        const email = profile?.email || opts.userEmail || null;
        if (email) {
            const { data: m } = await supabase
                .from('members')
                .select('id')
                .eq('email', email)
                .limit(1)
                .maybeSingle();
            if (m?.id) return m.id as string;
        }
    } catch {
        /* swallow — 2순위 시도 */
    }

    // 2순위: 직접 email
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
