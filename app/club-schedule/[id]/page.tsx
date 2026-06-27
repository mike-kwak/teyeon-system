'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, MapPin, Calendar, Clock, Users, Lock, Send, Trash2, Share2, Check, MessageSquare } from 'lucide-react';
import { shareOrCopyClubSchedule, shareClubScheduleStatus } from '@/lib/clubScheduleShare';
import { useAuth } from '@/context/AuthContext';
import { useAnalytics } from '@/components/analytics/AnalyticsProvider';
import { useGuideRecording } from '@/hooks/useGuideRecording';
import { supabase } from '@/lib/supabase';
import { fetchClubScheduleById } from '@/lib/clubScheduleService';
import {
    fetchMyAttendance,
    upsertAttendance,
    deleteMyAttendance,
    fetchAttendancesWithMembers,
    buildAttendanceSummary,
    evaluateAttendanceWindow,
    fetchComments,
    createComment,
    updateComment,
    deleteComment,
    resolveMemberIdForUser,
    resolveLinkedMemberByAuthUid,
    AttendanceForbiddenError,
    ARRIVAL_OPTIONS,
    LEAVE_OPTIONS,
    type ArrivalTimeOption,
    type LeaveTimeOption,
    type AttendanceStatus,
    type AttendanceRow,
    type AttendanceWithMember,
    type AttendanceSummary,
    type CommentWithMember,
    type LinkedMember,
} from '@/lib/clubScheduleAttendanceService';
import { CLUB_TYPE_STYLE, formatTimeRangeAmPm, type ClubSchedule } from '@/lib/clubScheduleData';
import ProfileAvatar from '@/components/ProfileAvatar';
import { InitialAvatar } from '@/components/tournament/InitialAvatar';
import { normalizeAvatarUrl } from '@/lib/memberDisplayResolver';
import GuestPassSettingsCard from '@/components/club-schedule/GuestPassSettingsCard';
import GuestPassMemberLink from '@/components/club-schedule/GuestPassMemberLink';

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

const formatDateKo = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    if (!y) return date;
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${y}년 ${m}월 ${d}일 (${days[dt.getDay()]})`;
};

const formatDeadlineKo = (deadline: Date | null) => {
    if (!deadline) return '';
    const m = deadline.getMonth() + 1;
    const d = deadline.getDate();
    const h = deadline.getHours();
    const mi = deadline.getMinutes();
    const ampm = h < 12 ? '오전' : '오후';
    const h12 = h % 12 || 12;
    const miStr = String(mi).padStart(2, '0');
    return `${m}월 ${d}일 ${ampm} ${h12}:${miStr}`;
};

const ARRIVAL_DOT_COLOR: Record<ArrivalTimeOption, string> = {
    '19:00': '#10B981',
    '19:30': '#3B82F6',
    '20:00': '#6366F1',
};
const LEAVE_DOT_COLOR: Record<LeaveTimeOption, string> = {
    'end':   '#0F172A',
    '21:00': '#F59E0B',
    '21:30': '#F59E0B',
};

// ── Component ───────────────────────────────────────────────────────────────

export default function ClubScheduleAttendancePage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const scheduleId = params?.id || '';
    const { user, role } = useAuth();
    const { track } = useAnalytics();
    const { guardWriteAction, shouldHideAdminControls } = useGuideRecording();
    const isAdmin = (role === 'CEO' || role === 'ADMIN') && !shouldHideAdminControls;

    // 활성 회원 — 미응답 명단 계산 + 총원 표시용. members 테이블에서 직접 fetch.
    // ⚠️ 운영 DB의 members 테이블에는 is_guest / active / status 같은 분류 컬럼이 없다.
    //    이번 작업에서는 members 전체를 정모 응답 대상 기준으로 사용 (추정 컬럼 추가 금지).
    interface ActiveMember {
        id: string;
        nickname: string | null;
        avatar_url: string | null;
        auth_user_id: string | null;
    }

    const [schedule, setSchedule] = useState<ClubSchedule | null>(null);
    const [linkedMemberId, setLinkedMemberId] = useState<string | null>(null);
    /**
     * TEYEON 회원 매핑 상태 — 정모 참석 체크 권한의 유일한 판정 기준.
     *   - 'loading' : 조회 진행 중. 버튼은 잠금 상태로 표시.
     *   - 'linked'  : members.auth_user_id === auth.uid() 매칭됨 → 참석/불참 저장 가능.
     *   - 'unlinked': 매칭 실패 — 비회원/게스트/미연결 계정. 참석 체크 카드 숨김.
     * 이 상태는 profile.email / 카카오 닉네임 같은 추정 경로로는 절대 바뀌지 않는다.
     */
    const [linkedMember, setLinkedMember] = useState<LinkedMember | null>(null);
    const [linkedMemberStatus, setLinkedMemberStatus] =
        useState<'loading' | 'linked' | 'unlinked'>('loading');
    const [myAttendance, setMyAttendance] = useState<AttendanceRow | null>(null);
    const [allAttendances, setAllAttendances] = useState<AttendanceWithMember[]>([]);
    const [comments, setComments] = useState<CommentWithMember[]>([]);
    const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([]);
    /**
     * 회원 명단 로드 단계 상태.
     *   - 'loading': fetch 진행 중 — 총원/미응답을 숫자로 확정 표시하지 않는다.
     *   - 'ok':      성공 — 0명도 정상 결과로 표시.
     *   - 'failed':  Supabase 오류로 명단 없음 — 미응답 0명으로 오해되지 않게 경고 표시.
     */
    const [membersLoadStatus, setMembersLoadStatus] = useState<'loading' | 'ok' | 'failed'>('loading');

    const [pageLoading, setPageLoading] = useState(true);
    const [scheduleLoadError, setScheduleLoadError] = useState<string>('');
    const [attendancesError, setAttendancesError] = useState<string>('');
    const [commentsError, setCommentsError] = useState<string>('');
    const [memberCountError, setMemberCountError] = useState<string>('');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [saveError, setSaveError] = useState<string>('');
    const [cancelOpen, setCancelOpen] = useState(false);      // 응답 취소 확인 모달
    const [cancelling, setCancelling] = useState(false);      // 취소 처리 중
    const [commentBody, setCommentBody] = useState('');
    const [commentCategory, setCommentCategory] = useState<string | null>('일반');
    const [postingComment, setPostingComment] = useState(false);
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    /** 답글 작성 중인 원댓글 id. null이면 답글 입력창 미표시. */
    const [replyingToId, setReplyingToId] = useState<string | null>(null);
    const [replyBody, setReplyBody] = useState('');
    const [postingReply, setPostingReply] = useState(false);
    const [shareState, setShareState] = useState<'idle' | 'busy' | 'copied' | 'shared' | 'failed'>('idle');
    /** 현재 참석 현황 공유 버튼 상태 — 안내문 복사와 분리. */
    const [statusShareState, setStatusShareState] = useState<'idle' | 'busy' | 'copied' | 'shared' | 'failed'>('idle');

    const logSupabaseError = (label: string, err: any) => {
        // Supabase error는 message/details/hint/code 가 자주 분리되어 있고
        // console에 객체를 그대로 넘기면 일부 환경에서 "Object"로 collapsed.
        // 한 줄 메시지로 평탄화해 발생 즉시 모든 필드가 보이도록 한다.
        const code = err?.code ?? '(no code)';
        const message = err?.message ?? '(no message)';
        const details = err?.details ?? '(no details)';
        const hint = err?.hint ?? '(no hint)';
        console.warn(
            `[ClubSchedule/${label}] code=${code} | message=${message} | details=${details} | hint=${hint}`
        );
        if (err) console.warn(`[ClubSchedule/${label}/raw]`, err);
    };

    // ── 일정 본체 로드 (실패해도 보조 데이터와 분리) ───────────────────────
    const loadSchedule = useCallback(async () => {
        if (!scheduleId) return;
        try {
            const sch = await fetchClubScheduleById(scheduleId);
            setSchedule(sch);
            if (!sch) {
                setScheduleLoadError('not_found');
            } else {
                setScheduleLoadError('');
            }
        } catch (err: any) {
            logSupabaseError('Schedule', err);
            setSchedule(null);
            setScheduleLoadError(err?.message || 'failed');
        }
    }, [scheduleId]);

    // ── 보조 데이터 로드 (각각 try/catch — 하나가 실패해도 페이지 표시 유지) ──
    const loadAuxiliary = useCallback(async () => {
        if (!scheduleId) return;

        // 참석 현황
        try {
            const attendances = await fetchAttendancesWithMembers(scheduleId);
            setAllAttendances(attendances);
            setAttendancesError('');
        } catch (err: any) {
            logSupabaseError('Attendances', err);
            setAttendancesError(err?.message || 'failed');
        }

        // 댓글
        try {
            const cmts = await fetchComments(scheduleId);
            setComments(cmts);
            setCommentsError('');
        } catch (err: any) {
            logSupabaseError('Comments', err);
            setCommentsError(err?.message || 'failed');
        }

        // 활성 회원 — 총원/미응답 명단 계산용. members 테이블 전체 조회.
        // ⚠️ is_guest / active / status 같은 분류 컬럼은 운영 DB에 없으므로 select 하지 않는다
        //    (있다고 가정해 select 하면 PostgREST 400 → 명단 전체 누락 + '미응답 0명' 잘못 표시).
        setMembersLoadStatus('loading');
        try {
            const { data, error } = await supabase
                .from('members')
                .select('id, nickname, avatar_url, auth_user_id');
            if (error) throw error;
            setActiveMembers((data || []) as ActiveMember[]);
            setMembersLoadStatus('ok');
            setMemberCountError('');
        } catch (err: any) {
            // 실제 Supabase 오류를 그대로 노출 — 운영 DevTools에서 원인 파악 가능.
            // (개인정보 누출 없음: code/message/details/hint 만 출력)
            logSupabaseError('MemberCount (select id, nickname, avatar_url, auth_user_id)', err);
            setMembersLoadStatus('failed');
            setMemberCountError(err?.message || 'failed');
        }

        // 내 응답 — 로그인 사용자만
        if (user?.id) {
            try {
                const mine = await fetchMyAttendance(scheduleId, user.id);
                setMyAttendance(mine);
            } catch (err: any) {
                logSupabaseError('MyAttendance', err);
            }
        }
    }, [scheduleId, user?.id]);

    useEffect(() => {
        let active = true;
        (async () => {
            if (!scheduleId) { setPageLoading(false); return; }
            setPageLoading(true);
            await loadSchedule();
            if (!active) return;
            await loadAuxiliary();
            if (!active) return;
            setPageLoading(false);
        })();
        return () => { active = false; };
    }, [scheduleId, loadSchedule, loadAuxiliary]);

    // (1) 엄격 권한 판정 — members.auth_user_id === auth.uid() 매핑만 신뢰.
    //     profile.email / 이름 추정 / 카카오 닉네임 사용 금지. 정모 참석 체크 가능 여부의 단일 진실.
    useEffect(() => {
        if (!user?.id) {
            setLinkedMember(null);
            setLinkedMemberStatus('unlinked');
            return;
        }
        let cancelled = false;
        setLinkedMemberStatus('loading');
        resolveLinkedMemberByAuthUid(user.id)
            .then((linked) => {
                if (cancelled) return;
                if (linked) {
                    setLinkedMember(linked);
                    setLinkedMemberStatus('linked');
                    // 표시명/댓글 저장에 사용되는 linkedMemberId 도 함께 채워둠 — 우회 매핑보다 강한 신뢰 출처.
                    setLinkedMemberId(linked.id);
                } else {
                    setLinkedMember(null);
                    setLinkedMemberStatus('unlinked');
                }
            })
            .catch(() => {
                if (cancelled) return;
                setLinkedMember(null);
                setLinkedMemberStatus('unlinked');
            });
        return () => { cancelled = true; };
    }, [user?.id]);

    // (2) 표시명/댓글 저장용 fallback — profiles.email → members.email exact. 권한 판정에는 사용 안 함.
    //     ⚠️ 위의 strict resolver 가 매핑 성공 시 linkedMemberId 를 이미 채웠으므로 그때는 skip.
    useEffect(() => {
        if (!user?.id) { setLinkedMemberId(null); return; }
        if (linkedMember) return; // strict 매핑 우선
        let cancelled = false;
        resolveMemberIdForUser({ userId: user.id, userEmail: user.email ?? null })
            .then((id) => {
                if (cancelled) return;
                setLinkedMemberId(id);
            })
            .catch(() => {
                if (cancelled) return;
                setLinkedMemberId(null);
            });
        return () => { cancelled = true; };
    }, [user?.id, user?.email, linkedMember]);

    // ── 파생 상태 ───────────────────────────────────────────────────────────
    const windowState = useMemo(() => {
        if (!schedule) return { isOpen: true, isDisabledByFlag: false, isPastDeadline: false, deadline: null };
        return evaluateAttendanceWindow({
            attendance_enabled: schedule.attendance_enabled,
            attendance_deadline: schedule.attendance_deadline,
            schedule_date: schedule.schedule_date,
            start_time: schedule.start_time,
        });
    }, [schedule]);

    // ── attendance 집계 정제 ───────────────────────────────────────────────
    // 1) 화면 표시용으로 본인 사진만 fallback 보강 (카카오 user_metadata).
    //    ⚠️ 이름은 보강하지 않는다 — 카카오 닉네임을 화면에 노출하지 않는 운영 규칙.
    // 2) 비회원/미연결 row 는 회원 참석/불참 숫자에서 제외.
    //    회원 판정 키: attendance.resolvedMemberId 가 activeMembers.id 에 존재하거나
    //                  attendance.user_id 가 activeMembers.auth_user_id 와 일치.
    //    snapshot 이름 / 부분 일치 / 카카오 닉네임은 신뢰하지 않는다.
    //    → 결과적으로 '회원 정보 없음' 이 참석/불참 명단에 새로 추가되지 않는다.
    const { memberAttendances, unlinkedAttendances } = useMemo(() => {
        const memberIdSet = new Set(activeMembers.map((m) => m.id));
        const memberAuthIdSet = new Set(
            activeMembers.map((m) => m.auth_user_id).filter((v): v is string => !!v),
        );
        const memberRows: AttendanceWithMember[] = [];
        const orphanRows: AttendanceWithMember[] = [];
        for (const row of allAttendances) {
            const matchedById = row.resolvedMemberId && memberIdSet.has(row.resolvedMemberId);
            const matchedByAuth = row.user_id && memberAuthIdSet.has(row.user_id);
            if (matchedById || matchedByAuth) {
                memberRows.push(row);
            } else {
                orphanRows.push(row);
            }
        }
        return { memberAttendances: memberRows, unlinkedAttendances: orphanRows };
    }, [allAttendances, activeMembers]);

    const attendancesForDisplay = useMemo(() => {
        if (!user?.id) return memberAttendances;
        const meta = user.user_metadata || {};
        const selfAvatarFallback = normalizeAvatarUrl(
            (meta.avatar_url as string | undefined) ||
            (meta.picture as string | undefined) ||
            null
        );
        if (!selfAvatarFallback) return memberAttendances;
        return memberAttendances.map((row) => {
            if (row.user_id !== user.id) return row;
            if (row.avatarUrl) return row;
            return { ...row, avatarUrl: selfAvatarFallback };
        });
    }, [memberAttendances, user?.id, user?.user_metadata]);

    // 댓글/답글에도 동일하게 사진만 보강. 이름은 카카오 닉네임으로 떨어지지 않는다.
    const commentsForDisplay = useMemo(() => {
        if (!user?.id) return comments;
        const meta = user.user_metadata || {};
        const selfAvatarFallback = normalizeAvatarUrl(
            (meta.avatar_url as string | undefined) ||
            (meta.picture as string | undefined) ||
            null
        );
        if (!selfAvatarFallback) return comments;
        const enrichSelf = (c: CommentWithMember): CommentWithMember => {
            if (c.user_id !== user.id) return c;
            if (c.avatarUrl) return c;
            return { ...c, avatarUrl: selfAvatarFallback };
        };
        return comments.map((c) => {
            const top = enrichSelf(c);
            if (top.replies && top.replies.length > 0) {
                top.replies = top.replies.map(enrichSelf);
            }
            return top;
        });
    }, [comments, user?.id, user?.user_metadata]);

    /** 원댓글 + 답글 전체 개수 — 헤더 N 표시용. */
    const totalCommentCount = useMemo(() => {
        let n = 0;
        for (const c of comments) {
            n += 1;
            if (c.replies) n += c.replies.length;
        }
        return n;
    }, [comments]);

    /**
     * 활성 회원 중 attendance row 가 없는 회원 = 미응답.
     *
     * identity 키: attendance.resolvedMemberId (service 가 산출 — member_id / auth_user_id / email exact)
     *   - snapshot 이름 만으로는 미응답에서 제외하지 않는다.
     *   - resolvedMemberId 가 없으면 (= members.id 와 연결할 수 없는 row) 미응답 계산에 영향 X.
     * 보강 키: auth_user_id 매칭 — activeMembers 의 auth_user_id 가
     *   attendance.user_id 와 일치하면 응답 처리 (resolvedMemberId 가 비어도 안전망).
     *
     * 같은 회원이 응답 + 미응답에 동시에 보이지 않도록 members.id 기준 Set 사용.
     *
     * ⚠️ 게스트 필터링은 적용하지 않음 — 운영 members 테이블에 is_guest 컬럼이 없음.
     */
    const noResponseMembers = useMemo(() => {
        if (membersLoadStatus !== 'ok' || activeMembers.length === 0) return [] as ActiveMember[];
        const respondedMemberIds = new Set<string>();
        const respondedAuthUserIds = new Set<string>();
        // ⚠️ 미응답 계산은 회원으로 확정된 attendance(memberAttendances)만 기준으로 한다.
        //    비회원/미연결 row 는 응답으로 인정하지 않는다 (다른 회원이 미응답에서 누락되는 위험 방지).
        for (const r of memberAttendances) {
            if (r.resolvedMemberId) respondedMemberIds.add(r.resolvedMemberId);
            if (r.user_id) respondedAuthUserIds.add(r.user_id);
        }
        const result = activeMembers.filter((m) => {
            if (respondedMemberIds.has(m.id)) return false;
            if (m.auth_user_id && respondedAuthUserIds.has(m.auth_user_id)) return false;
            return true;
        });
        // 개발 진단 — count 만 (UUID/이메일/이름 출력 금지). 운영 환경 미출력.
        if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
            const respondedCount = activeMembers.length - result.length;
            // eslint-disable-next-line no-console
            console.info(
                `[ClubSchedule/no-response] active=${activeMembers.length} ` +
                `responded=${respondedCount} noResponse=${result.length} ` +
                `(memberAttendances=${memberAttendances.length} unlinked=${unlinkedAttendances.length})`
            );
        }
        return result;
    }, [activeMembers, memberAttendances, unlinkedAttendances.length, membersLoadStatus]);

    // 운영진에게만 노출하는 운영 경고 — 회원 매핑이 풀린 attendance row 카운트.
    // 일반 회원 화면에는 노출하지 않는다 (디버그 노이즈 + 개인정보 추정 우려).
    const showUnlinkedBadge = isAdmin && unlinkedAttendances.length > 0;

    // 총원 — 로드 성공 시에만 숫자, 아니면 null.
    const totalMemberCount = membersLoadStatus === 'ok' ? activeMembers.length : 0;

    // 게스트 신청 댓글 건수 — 실제 확정 게스트 수는 아직 별도 데이터로 없으므로
    // 운영진 요약 카드의 '게스트' 자리를 댓글 카테고리 기반 'N건'으로 대체한다.
    // TODO: 향후 승인된 게스트 신청 데이터(별도 테이블/플래그)가 생기면 "게스트 N명"으로 교체.
    const guestRequestCount = useMemo(
        () => comments.filter((c) => c.category === '게스트 신청').length,
        [comments],
    );

    const typeStyle = schedule ? CLUB_TYPE_STYLE[schedule.schedule_type] : null;
    const isReadOnly = !windowState.isOpen;
    const myStatus: AttendanceStatus | null = myAttendance?.attendance_status ?? null;
    const myArrival = (myAttendance?.arrival_time as string | null) ?? null;
    const myLeave = (myAttendance?.leave_time as LeaveTimeOption | null) ?? null;

    // 참석 시작 후보 — schedule.start_time이 19:00이면 기본 [19:00,19:30,20:00],
    // 18:30처럼 더 이른 시각이면 그 시각을 포함한 후보가 생성된다.
    // 저장된 myArrival이 후보에 없으면 그것도 포함시켜 칩 highlight 유지.
    const arrivalCandidates: string[] = useMemo(() => {
        const base = ['19:00', '19:30', '20:00'];
        const ss = (schedule?.start_time || '').slice(0, 5);
        const pool = new Set<string>(base);
        if (ss && /^\d{2}:\d{2}$/.test(ss)) {
            pool.add(ss);
            // 시작이 19:00 미만(예: 18:30, 18:40)이면 시작 후보의 머리 자리로 사용.
        }
        if (myArrival && /^\d{2}:\d{2}$/.test(myArrival)) {
            pool.add(myArrival);
        }
        return Array.from(pool).sort();
    }, [schedule?.start_time, myArrival]);

    const summary: AttendanceSummary = useMemo(
        () => buildAttendanceSummary(attendancesForDisplay, totalMemberCount, arrivalCandidates),
        [attendancesForDisplay, totalMemberCount, arrivalCandidates],
    );

    // ── 저장 ────────────────────────────────────────────────────────────────
    const saveMyAttendance = useCallback(async (opts: {
        status: AttendanceStatus;
        arrival?: ArrivalTimeOption | null;
        leave?: LeaveTimeOption | null;
    }) => {
        if (!user?.id || !schedule) return;
        if (isReadOnly) return;
        if (!guardWriteAction('참석 저장')) return; // 촬영 모드: 실제 저장 차단
        // ── 권한 게이트 (UI 1차) ────────────────────────────────────────────
        // strict 매핑이 안 됐으면 service 호출 자체를 막는다. service 도 같은 검사를 하므로 이중 방어.
        if (linkedMemberStatus !== 'linked' || !linkedMember) {
            setSaveStatus('error');
            setSaveError('TEYEON 회원 계정만 참석 체크를 저장할 수 있습니다.');
            return;
        }
        setSaveStatus('saving');
        setSaveError('');
        try {
            // member_id 는 strict resolver 결과를 단일 출처로 사용 — caller 매핑 추정 제거.
            const trustedMemberId = linkedMember.id;
            // 표시명 snapshot — strict 매핑된 members.nickname 우선, 없으면 activeMembers fallback.
            const selfMember = activeMembers.find((m) => m.id === trustedMemberId);
            const displayNameSnapshot = linkedMember.nickname || selfMember?.nickname || null;

            const saved = await upsertAttendance({
                schedule_id: schedule.id,
                user_id: user.id,
                member_id: trustedMemberId,
                attendance_status: opts.status,
                arrival_time: opts.status === 'attending' ? (opts.arrival ?? null) : null,
                leave_time:   opts.status === 'attending' ? (opts.leave   ?? null) : null,
                note: myAttendance?.note ?? null,
                display_name_snapshot: displayNameSnapshot,
            });
            // 1) 내 응답 즉시 갱신
            setMyAttendance(saved);
            setSaveStatus('saved');

            // Analytics — 참석 저장이 DB 에 성공한 이후에만 기록(비차단·무예외). 개인정보 미포함.
            track('attendance_submit', { status: opts.status, schedule_type: 'club_schedule' });

            // 2) 본인 + 전체 현황을 모두 명시적으로 재조회 — 사용자 가이드 순서.
            //    한쪽이 실패해도 다른 쪽은 갱신되도록 try 분리.
            try {
                const [refreshedMine, refreshedAll] = await Promise.all([
                    fetchMyAttendance(schedule.id, user.id),
                    fetchAttendancesWithMembers(schedule.id),
                ]);
                if (refreshedMine) setMyAttendance(refreshedMine);
                setAllAttendances(refreshedAll);
                setAttendancesError('');
            } catch (refreshErr: any) {
                logSupabaseError('Attendances/refresh', refreshErr);
            }
        } catch (err: any) {
            // service 레이어 권한 게이트 또는 RLS 거부 — UI 와 같은 안내 문구로 통일.
            if (err instanceof AttendanceForbiddenError) {
                setSaveStatus('error');
                setSaveError(err.message);
                // 강제 unlinked 로 마킹 — 이후 버튼 잠금 유지.
                setLinkedMember(null);
                setLinkedMemberStatus('unlinked');
                return;
            }
            logSupabaseError('Attendance/save', err);
            setSaveStatus('error');
            setSaveError('참석 상태 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        }
    }, [user?.id, schedule, linkedMember, linkedMemberStatus, myAttendance?.note, isReadOnly, activeMembers, guardWriteAction]);

    // ── 응답 취소 (본인 attendance row 삭제 → 미응답 복구) ──────────────────────
    const handleCancelResponse = useCallback(async () => {
        if (!user?.id || !schedule) return;
        if (isReadOnly) return;
        if (!guardWriteAction('응답 취소')) return; // 촬영 모드: 실제 삭제 차단
        if (linkedMemberStatus !== 'linked' || !linkedMember) {
            setCancelOpen(false);
            setSaveStatus('error');
            setSaveError('회원 계정 연결을 확인할 수 없어 응답을 취소하지 못했습니다.');
            return;
        }
        setCancelling(true);
        setSaveError('');
        try {
            await deleteMyAttendance(schedule.id, user.id);
            // 성공 후에만 로컬 상태 정리(실패 시 기존 응답 유지). 화면 새로고침/깜빡임 없음.
            setMyAttendance(null);
            setSaveStatus('idle');
            setCancelOpen(false);
            // 명단/집계 즉시 갱신 — 본인/전체 attendance refetch.
            try {
                const [refreshedMine, refreshedAll] = await Promise.all([
                    fetchMyAttendance(schedule.id, user.id),
                    fetchAttendancesWithMembers(schedule.id),
                ]);
                setMyAttendance(refreshedMine); // null 예상 → 미응답
                setAllAttendances(refreshedAll);
                setAttendancesError('');
            } catch (refreshErr: any) {
                logSupabaseError('Attendances/refresh', refreshErr);
            }
        } catch (err: any) {
            if (err instanceof AttendanceForbiddenError) {
                setSaveStatus('error');
                setSaveError('회원 계정 연결을 확인할 수 없어 응답을 취소하지 못했습니다.');
            } else {
                logSupabaseError('Attendance/cancel', err);
                setSaveStatus('error');
                setSaveError('응답을 취소하지 못했습니다. 다시 시도해 주세요.');
            }
            setCancelOpen(false);
        } finally {
            setCancelling(false);
        }
    }, [user?.id, schedule, isReadOnly, linkedMember, linkedMemberStatus, guardWriteAction]);

    const handlePickArrival = (t: ArrivalTimeOption) => {
        if (isReadOnly) return;
        saveMyAttendance({ status: 'attending', arrival: t, leave: myLeave ?? 'end' });
    };
    const handlePickLeave = (t: LeaveTimeOption) => {
        if (isReadOnly) return;
        if (myStatus !== 'attending') return; // 참석 시작 선택이 우선
        saveMyAttendance({ status: 'attending', arrival: myArrival ?? '19:00', leave: t });
    };
    const handlePickAbsent = () => {
        if (isReadOnly) return;
        saveMyAttendance({ status: 'not_attending' });
    };

    // 참석 체크 안내문 공유 — Web Share API → 클립보드 fallback. 중복 클릭 방지.
    const handleShare = useCallback(async () => {
        if (!schedule) return;
        if (shareState === 'busy') return;
        setShareState('busy');
        try {
            const result = await shareOrCopyClubSchedule(schedule);
            if (result.mode === 'share') {
                setShareState('shared');
            } else if (result.mode === 'copy') {
                setShareState('copied');
            } else {
                setShareState('failed');
                alert('복사에 실패했습니다. 브라우저 권한을 확인해 주세요.');
            }
        } catch {
            setShareState('failed');
        }
        // 짧은 피드백 후 idle 복귀
        window.setTimeout(() => setShareState('idle'), 2200);
    }, [schedule, shareState]);

    /**
     * 현재 참석 현황 공유.
     *
     * 흐름:
     *   1) 회원 명단 조회가 실패한 상태(membersLoadStatus !== 'ok')면 즉시 차단 → 잘못된 '미응답 0명' 공유 방지.
     *   2) 공유 직전 attendances 가벼운 refetch → 최신 집계 확보. members/comments 는 페이지가 이미 관리.
     *   3) buildAttendanceSummary 로 즉시 계산 → 참석/불참/미응답/게스트 신청 건수 산출.
     *   4) 카카오톡/BAND 호환 텍스트 → Web Share → 클립보드 fallback.
     *
     * 회원 이름/UUID/이메일은 절대 문구에 포함하지 않는다 (helper 가 가공).
     */
    const handleShareStatus = useCallback(async () => {
        if (!schedule) return;
        if (statusShareState === 'busy') return;
        // 회원 명단이 없으면 미응답을 잘못 0명으로 공유할 위험 — 차단.
        if (membersLoadStatus !== 'ok') {
            alert('미응답 집계 확인이 필요합니다. 회원 명단을 다시 불러온 뒤 시도해 주세요.');
            return;
        }

        setStatusShareState('busy');
        try {
            // 공유 직전 attendances refetch — 최신 집계 필수.
            // ⚠️ refetch 실패 시 기존 state 로 공유하지 않는다 (오래된 숫자 공유 차단).
            let attendancesNow: AttendanceWithMember[];
            try {
                const refreshed = await fetchAttendancesWithMembers(schedule.id);
                attendancesNow = refreshed;
                setAllAttendances(refreshed);
            } catch {
                setStatusShareState('failed');
                alert('최신 참석 현황을 불러오지 못했습니다. 다시 시도해 주세요.');
                window.setTimeout(() => setStatusShareState('idle'), 2200);
                return;
            }

            // 공유 집계 정제 — 회원으로 확정된 row 만 사용. 비회원/미연결 row 는 카운트/이름 모두 제외.
            const memberIdSet = new Set(activeMembers.map((m) => m.id));
            const memberAuthIdSet = new Set(
                activeMembers.map((m) => m.auth_user_id).filter((v): v is string => !!v),
            );
            const memberRowsNow = attendancesNow.filter((r) => {
                const byId = r.resolvedMemberId && memberIdSet.has(r.resolvedMemberId);
                const byAuth = r.user_id && memberAuthIdSet.has(r.user_id);
                return byId || byAuth;
            });

            // 최신 memberRowsNow 기준 집계 — 화면 summary 와 동일 로직 (buildAttendanceSummary).
            const freshSummary = buildAttendanceSummary(
                memberRowsNow,
                activeMembers.length,
                arrivalCandidates,
            );
            // 미응답: 활성 회원 중 attendance row 없음. resolvedMemberId + auth_user_id 매칭으로 중복 방지.
            const respondedMemberIds = new Set<string>();
            const respondedAuthUserIds = new Set<string>();
            for (const r of memberRowsNow) {
                if (r.resolvedMemberId) respondedMemberIds.add(r.resolvedMemberId);
                if (r.user_id) respondedAuthUserIds.add(r.user_id);
            }
            const noResponseCount = activeMembers.filter((m) => {
                if (respondedMemberIds.has(m.id)) return false;
                if (m.auth_user_id && respondedAuthUserIds.has(m.auth_user_id)) return false;
                return true;
            }).length;

            // 게스트 신청은 댓글 category 기준 건수 — guestRequestCount 가 이미 그것.
            const result = await shareClubScheduleStatus({
                schedule,
                totalAttending:    freshSummary.totalAttending,
                totalNotAttending: freshSummary.totalNotAttending,
                totalNoResponse:   noResponseCount,
                totalGuestRequests: guestRequestCount,
            });
            if (result.mode === 'share') {
                setStatusShareState('shared');
            } else if (result.mode === 'copy') {
                setStatusShareState('copied');
            } else {
                setStatusShareState('failed');
                alert('현황을 공유하지 못했습니다. 다시 시도해 주세요.');
            }
        } catch {
            setStatusShareState('failed');
        }
        window.setTimeout(() => setStatusShareState('idle'), 2200);
    }, [
        schedule, statusShareState, membersLoadStatus,
        allAttendances, activeMembers, arrivalCandidates, guestRequestCount,
    ]);

    const resetCommentForm = () => {
        setCommentBody('');
        setCommentCategory('일반');
        setEditingCommentId(null);
    };

    // ── 댓글 작성/수정 ──────────────────────────────────────────────────────
    const handleSubmitComment = async () => {
        if (!user?.id || !schedule) return;
        const body = commentBody.trim();
        if (!body) return;
        if (!guardWriteAction(editingCommentId ? '댓글 수정' : '댓글 작성')) return; // 촬영 모드 차단
        setPostingComment(true);
        try {
            if (editingCommentId) {
                await updateComment({
                    id: editingCommentId,
                    body,
                    category: commentCategory,
                });
            } else {
                // 댓글 작성 시점에 member_id가 아직 비어있으면 즉석 보강 (attendance 저장과 동일 패턴).
                // 실패해도 댓글 작성 자체는 막지 않음 — user_id는 항상 저장.
                let memberIdToSave = linkedMemberId;
                if (!memberIdToSave) {
                    try {
                        memberIdToSave = await resolveMemberIdForUser({
                            userId: user.id,
                            userEmail: user.email ?? null,
                        });
                        if (memberIdToSave) setLinkedMemberId(memberIdToSave);
                    } catch { /* noop */ }
                }
                await createComment({
                    schedule_id: schedule.id,
                    user_id: user.id,
                    member_id: memberIdToSave,
                    category: commentCategory,
                    body,
                });
            }
            resetCommentForm();
            try {
                const refreshed = await fetchComments(schedule.id);
                setComments(refreshed);
                setCommentsError('');
            } catch (refreshErr: any) {
                logSupabaseError('Comments/refresh', refreshErr);
            }
        } catch (err: any) {
            logSupabaseError(editingCommentId ? 'Comment/update' : 'Comment/post', err);
        } finally {
            setPostingComment(false);
        }
    };

    const handleStartEditComment = (c: CommentWithMember) => {
        setEditingCommentId(c.id);
        setCommentBody(c.body);
        setCommentCategory(c.category || '일반');
        // 입력 영역으로 부드럽게 스크롤
        setTimeout(() => {
            document.getElementById('comment-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
    };

    const handleCancelEditComment = () => {
        resetCommentForm();
    };

    const handleDeleteComment = async (id: string) => {
        if (!guardWriteAction('댓글 삭제')) return; // 촬영 모드 차단
        if (!confirm('이 댓글을 삭제하시겠어요?')) return;
        try {
            await deleteComment(id);
            // 원댓글 삭제 시 답글은 DB cascade 로 삭제됨.
            // 상태에서는 해당 id 의 원댓글을 제거하거나, 답글이면 부모의 replies 에서 제거.
            setComments((prev) =>
                prev
                    .filter((c) => c.id !== id)
                    .map((c) => (c.replies && c.replies.length > 0
                        ? { ...c, replies: c.replies.filter((r) => r.id !== id) }
                        : c)),
            );
            if (editingCommentId === id) resetCommentForm();
            if (replyingToId === id) {
                setReplyingToId(null);
                setReplyBody('');
            }
        } catch (err) {
            logSupabaseError('Comment/delete', err);
        }
    };

    // ── 답글 작성/취소 ──────────────────────────────────────────────────────
    const handleStartReply = (parentId: string) => {
        // 이미 같은 댓글에 답글 입력 중이면 토글로 닫기.
        if (replyingToId === parentId) {
            setReplyingToId(null);
            setReplyBody('');
            return;
        }
        // 다른 댓글에서 작성 중이던 답글은 폐기 — 한 번에 하나의 답글 입력만.
        setReplyingToId(parentId);
        setReplyBody('');
        // 입력 영역으로 부드럽게 스크롤 — DOM 마운트 후.
        setTimeout(() => {
            document.getElementById(`reply-input-${parentId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
    };

    const handleCancelReply = () => {
        setReplyingToId(null);
        setReplyBody('');
    };

    const handleSubmitReply = async (parentId: string) => {
        if (!user?.id || !schedule) return;
        const body = replyBody.trim();
        if (!body) return;
        setPostingReply(true);
        try {
            let memberIdToSave = linkedMemberId;
            if (!memberIdToSave) {
                try {
                    memberIdToSave = await resolveMemberIdForUser({
                        userId: user.id,
                        userEmail: user.email ?? null,
                    });
                    if (memberIdToSave) setLinkedMemberId(memberIdToSave);
                } catch { /* noop */ }
            }
            await createComment({
                schedule_id: schedule.id,
                user_id: user.id,
                member_id: memberIdToSave,
                // 답글은 카테고리 미사용 — 부모와 무관하게 일반으로 저장.
                category: '일반',
                body,
                parent_comment_id: parentId,
            });
            handleCancelReply();
            try {
                const refreshed = await fetchComments(schedule.id);
                setComments(refreshed);
                setCommentsError('');
            } catch (refreshErr: any) {
                logSupabaseError('Comments/refresh-after-reply', refreshErr);
            }
        } catch (err: any) {
            logSupabaseError('Reply/post', err);
        } finally {
            setPostingReply(false);
        }
    };

    // ── Render ──────────────────────────────────────────────────────────────
    if (pageLoading) {
        return (
            <main style={pageBaseStyle}>
                <div style={{ ...containerStyle, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.1em' }}>LOADING...</p>
                </div>
            </main>
        );
    }
    if (!schedule) {
        const isNotFound = scheduleLoadError === 'not_found' || scheduleLoadError === '';
        return (
            <main style={pageBaseStyle}>
                <div style={{ ...containerStyle, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>
                        {isNotFound ? '일정을 찾을 수 없습니다' : '일정을 불러오지 못했습니다'}
                    </p>
                    {!isNotFound && (
                        <p style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                            잠시 후 다시 시도해 주세요
                        </p>
                    )}
                    <Link href="/tournament-calendar" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#3B82F6' }}>
                        ← 캘린더로 돌아가기
                    </Link>
                </div>
            </main>
        );
    }

    const attendanceEnabledFlag = schedule.attendance_enabled !== false;

    return (
        <main style={pageBaseStyle}>
            <div style={containerStyle}>
                {/* HEADER */}
                <header style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
                    <button
                        type="button"
                        onClick={() => router.back()}
                        aria-label="뒤로"
                        style={{
                            width: 34, height: 34, borderRadius: '50%',
                            border: '1px solid rgba(0,0,0,0.09)', backgroundColor: '#FFFFFF',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#475569', cursor: 'pointer', flexShrink: 0,
                        }}
                    >
                        <ChevronLeft size={17} strokeWidth={2.2} />
                    </button>
                    <div>
                        <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.28em', textTransform: 'uppercase', color: '#3B82F6', margin: 0, lineHeight: 1.3 }}>
                            TEYEON CALENDAR · CLUB SCHEDULE
                        </p>
                        <p style={{ fontSize: 16, fontWeight: 900, color: '#0F172A', margin: 0, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                            정모 참석 체크
                        </p>
                    </div>
                </header>

                {/* HERO: 정모 요약 */}
                <section style={cardStyle}>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 8, marginBottom: 10, flexWrap: 'wrap',
                    }}>
                        {typeStyle ? (
                            <span style={{
                                display: 'inline-block', fontSize: 9, fontWeight: 800, padding: '3px 9px',
                                borderRadius: 5, backgroundColor: typeStyle.bg, color: typeStyle.color,
                                border: `1px solid ${typeStyle.border}`, letterSpacing: '0.06em',
                            }}>
                                🏷️ {typeStyle.badge}
                            </span>
                        ) : <span />}
                        {/* 공유 액션 — 안내문 / 현황. 좁은 화면에서 자연스럽게 줄바꿈. */}
                        <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            flexWrap: 'wrap', justifyContent: 'flex-end',
                        }}>
                            {/* 1) 참석 체크 안내문 공유 (기존) */}
                            <button
                                type="button"
                                onClick={handleShare}
                                disabled={shareState === 'busy'}
                                aria-label="참석 체크 안내문 복사"
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    height: 30, paddingLeft: 10, paddingRight: 10,
                                    borderRadius: 999,
                                    border: '1px solid rgba(59,130,246,0.28)',
                                    backgroundColor: shareState === 'copied' || shareState === 'shared'
                                        ? 'rgba(16,185,129,0.10)'
                                        : 'rgba(59,130,246,0.08)',
                                    color: shareState === 'copied' || shareState === 'shared'
                                        ? '#065F46'
                                        : '#1D4ED8',
                                    fontSize: 11, fontWeight: 800,
                                    letterSpacing: '-0.01em',
                                    cursor: shareState === 'busy' ? 'wait' : 'pointer',
                                    whiteSpace: 'nowrap',
                                    WebkitTapHighlightColor: 'transparent',
                                    transition: 'background-color 0.15s, color 0.15s',
                                }}
                            >
                                {shareState === 'copied' ? <Check size={12} /> : <Share2 size={12} />}
                                {shareState === 'copied'
                                    ? '복사 완료'
                                    : shareState === 'shared'
                                        ? '공유 완료'
                                        : shareState === 'failed'
                                            ? '복사 실패'
                                            : shareState === 'busy'
                                                ? '준비 중'
                                                : '안내문 복사'}
                            </button>

                            {/* 2) 현재 참석 현황 공유 — 신규.
                                회원 명단 로드 실패 시 비활성화 (잘못된 '미응답 0명' 공유 방지). */}
                            <button
                                type="button"
                                onClick={handleShareStatus}
                                disabled={statusShareState === 'busy' || membersLoadStatus !== 'ok'}
                                aria-label="현재 참석 현황 공유"
                                title={membersLoadStatus !== 'ok' ? '회원 명단 로드 후 사용할 수 있습니다' : undefined}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                    height: 30, paddingLeft: 10, paddingRight: 10,
                                    borderRadius: 999,
                                    border: '1px solid rgba(15,159,152,0.30)',
                                    backgroundColor: statusShareState === 'copied' || statusShareState === 'shared'
                                        ? 'rgba(16,185,129,0.10)'
                                        : membersLoadStatus !== 'ok'
                                            ? 'rgba(100,116,139,0.06)'
                                            : 'rgba(15,159,152,0.08)',
                                    color: statusShareState === 'copied' || statusShareState === 'shared'
                                        ? '#065F46'
                                        : membersLoadStatus !== 'ok'
                                            ? '#94A3B8'
                                            : '#0E7C76',
                                    fontSize: 11, fontWeight: 800,
                                    letterSpacing: '-0.01em',
                                    cursor: statusShareState === 'busy' ? 'wait' :
                                            membersLoadStatus !== 'ok' ? 'not-allowed' : 'pointer',
                                    whiteSpace: 'nowrap',
                                    WebkitTapHighlightColor: 'transparent',
                                    transition: 'background-color 0.15s, color 0.15s',
                                    opacity: membersLoadStatus !== 'ok' ? 0.7 : 1,
                                }}
                            >
                                {statusShareState === 'copied' ? <Check size={12} /> : <Share2 size={12} />}
                                {statusShareState === 'copied'
                                    ? '복사 완료'
                                    : statusShareState === 'shared'
                                        ? '공유 완료'
                                        : statusShareState === 'failed'
                                            ? '공유 실패'
                                            : statusShareState === 'busy'
                                                ? '준비 중'
                                                : '현황 공유'}
                            </button>
                        </div>
                    </div>
                    <h2 style={{ fontSize: 18, fontWeight: 900, color: '#0F172A', margin: '0 0 10px', letterSpacing: '-0.02em', wordBreak: 'keep-all' }}>
                        {schedule.title}
                    </h2>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <li style={infoRowStyle}>
                            <Calendar size={12} style={{ color: '#94A3B8' }} />
                            <span style={infoLabelStyle}>날짜</span>
                            <span style={infoValueStyle}>{formatDateKo(schedule.schedule_date)}</span>
                        </li>
                        {(schedule.start_time || schedule.end_time) && (
                            <li style={infoRowStyle}>
                                <Clock size={12} style={{ color: '#94A3B8' }} />
                                <span style={infoLabelStyle}>시간</span>
                                <span style={infoValueStyle}>
                                    {formatTimeRangeAmPm(schedule.start_time, schedule.end_time)}
                                </span>
                            </li>
                        )}
                        {schedule.location && (
                            <li style={infoRowStyle}>
                                <MapPin size={12} style={{ color: '#94A3B8' }} />
                                <span style={infoLabelStyle}>장소</span>
                                <span style={infoValueStyle}>
                                    {schedule.location}
                                    {schedule.court_count ? ` · ${schedule.court_count}면` : ''}
                                </span>
                            </li>
                        )}
                        {schedule.guest_enabled && (
                            <li style={infoRowStyle}>
                                <Users size={12} style={{ color: '#94A3B8' }} />
                                <span style={infoLabelStyle}>게스트</span>
                                <span style={infoValueStyle}>
                                    {schedule.guest_limit != null ? `게스트 ${schedule.guest_limit}명 가능` : '게스트 가능'}
                                </span>
                            </li>
                        )}
                    </ul>

                    {windowState.deadline && (
                        <div
                            style={{
                                marginTop: 12, padding: '8px 12px', borderRadius: 10,
                                backgroundColor: windowState.isPastDeadline ? 'rgba(100,116,139,0.08)' : 'rgba(245,158,11,0.10)',
                                border: `1px solid ${windowState.isPastDeadline ? 'rgba(100,116,139,0.18)' : 'rgba(245,158,11,0.24)'}`,
                                display: 'flex', alignItems: 'center', gap: 6,
                                fontSize: 11, fontWeight: 700,
                                color: windowState.isPastDeadline ? '#475569' : '#92400E',
                            }}
                        >
                            {windowState.isPastDeadline
                                ? <><Lock size={11} /> 참석 체크가 마감되었습니다</>
                                : <>⏰ 참석 체크 마감 · {formatDeadlineKo(windowState.deadline)}</>}
                        </div>
                    )}
                </section>

                {/* 내 참석 시간 */}
                {attendanceEnabledFlag && (
                    <section style={cardStyle}>
                        <SectionTitle title="내 참석 시간" />

                        {/* ── 회원 매핑 분기 ────────────────────────────────────────────────
                            'loading'   → 안내 로딩
                            'unlinked'  → TEYEON 회원 전용 안내 카드만 표시 (버튼 모두 숨김)
                            'linked'    → 기존 참석/조퇴/불참 UI */}
                        {linkedMemberStatus === 'loading' ? (
                            <p style={{ fontSize: 11.5, fontWeight: 600, color: '#94A3B8', textAlign: 'center', margin: '14px 0' }}>
                                회원 정보 확인 중...
                            </p>
                        ) : linkedMemberStatus === 'unlinked' ? (
                            <NonMemberAttendanceNotice isLoggedIn={!!user?.id} />
                        ) : (
                            <>
                                {/* 저장 상태 배너 (시안 B/C/D) */}
                                {myAttendance && (
                                    <StatusBanner status={myStatus} arrival={myArrival} leave={myLeave} />
                                )}

                                {/* 응답 취소 — 응답한 회원에게만. 보조(낮은 계층) 빨간 outline. */}
                                {myAttendance && !isReadOnly && (
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0 4px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setCancelOpen(true)}
                                            disabled={cancelling}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                                height: 32, padding: '0 12px', borderRadius: 9,
                                                border: '1px solid rgba(192,57,43,0.45)', backgroundColor: 'transparent',
                                                color: '#C0392B', fontSize: 11.5, fontWeight: 700,
                                                cursor: cancelling ? 'default' : 'pointer', opacity: cancelling ? 0.6 : 1,
                                            }}
                                        >
                                            응답 취소
                                        </button>
                                    </div>
                                )}

                                {!myAttendance && !isReadOnly && (
                                    <p style={{ fontSize: 11.5, fontWeight: 600, color: '#64748B', margin: '0 0 14px', lineHeight: 1.55 }}>
                                        참석 가능한 시작 시간을 하나 선택해 주세요. 조퇴 예정이면 시간도 함께 표시할 수 있어요.
                                    </p>
                                )}

                                {/* 참석 시작 시간 — schedule.start_time 기반 동적 후보 */}
                                <SubLabel>참석 시작</SubLabel>
                                <div style={chipRowStyle}>
                                    {arrivalCandidates.map((t) => (
                                        <TimeChip
                                            key={t}
                                            label={t}
                                            sub="참석"
                                            selected={myStatus === 'attending' && myArrival === t}
                                            disabled={isReadOnly}
                                            onClick={() => handlePickArrival(t as ArrivalTimeOption)}
                                            color="#10B981"
                                        />
                                    ))}
                                </div>

                                {/* 조퇴 시간 */}
                                <SubLabel hint=" (선택)">조퇴 시간</SubLabel>
                                <div style={chipRowStyle}>
                                    {LEAVE_OPTIONS.map((t) => (
                                        <TimeChip
                                            key={t}
                                            label={t === 'end' ? '끝까지' : t}
                                            sub={t === 'end' ? '' : '조퇴'}
                                            selected={myStatus === 'attending' && myLeave === t}
                                            disabled={isReadOnly || myStatus !== 'attending'}
                                            onClick={() => handlePickLeave(t)}
                                            color="#3B82F6"
                                        />
                                    ))}
                                </div>

                                {/* 또는 */}
                                <p style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: '#94A3B8', margin: '12px 0' }}>
                                    또는
                                </p>

                                {/* 불참 */}
                                <AbsentButton
                                    selected={myStatus === 'not_attending'}
                                    disabled={isReadOnly}
                                    onClick={handlePickAbsent}
                                />

                                {saveStatus === 'saving' && (
                                    <p style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: '#3B82F6', textAlign: 'center' }}>
                                        저장 중...
                                    </p>
                                )}
                                {saveStatus === 'error' && (
                                    <p style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: '#C0392B', textAlign: 'center' }}>
                                        {saveError}
                                    </p>
                                )}
                                {isReadOnly && (
                                    <div
                                        style={{
                                            marginTop: 12, padding: '10px 12px', borderRadius: 10,
                                            backgroundColor: '#F1F5F9', border: '1px solid rgba(100,116,139,0.18)',
                                            fontSize: 11, fontWeight: 700, color: '#475569', textAlign: 'center',
                                        }}
                                    >
                                        참석 체크 마감 · 현황과 명단은 계속 확인할 수 있어요
                                    </div>
                                )}

                                {/* 응답 취소 확인 모달 */}
                                {cancelOpen && (
                                    <div
                                        role="dialog" aria-modal="true" aria-label="참석 응답 취소 확인"
                                        onClick={() => { if (!cancelling) setCancelOpen(false); }}
                                        style={{ position: 'fixed', inset: 0, zIndex: 80, backgroundColor: 'rgba(15,27,51,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                                    >
                                        <div
                                            onClick={(e) => e.stopPropagation()}
                                            style={{ width: '100%', maxWidth: 320, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}
                                        >
                                            <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#0F1B33' }}>참석 응답을 취소할까요?</p>
                                            <p style={{ margin: '8px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6 }}>취소하면 미응답 상태로 돌아갑니다.</p>
                                            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                                                <button type="button" onClick={() => setCancelOpen(false)} disabled={cancelling}
                                                    style={{ flex: 1, height: 42, borderRadius: 11, border: '1px solid #D9E1EC', backgroundColor: '#FFFFFF', color: '#334155', fontSize: 13, fontWeight: 800, cursor: cancelling ? 'default' : 'pointer' }}>
                                                    돌아가기
                                                </button>
                                                <button type="button" onClick={handleCancelResponse} disabled={cancelling}
                                                    style={{ flex: 1, height: 42, borderRadius: 11, border: 'none', backgroundColor: '#C0392B', color: '#FFFFFF', fontSize: 13, fontWeight: 800, cursor: cancelling ? 'default' : 'pointer', opacity: cancelling ? 0.7 : 1 }}>
                                                    {cancelling ? '취소 중...' : '응답 취소'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                )}

                {/* 참석 현황 (시간대별) */}
                <section style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <SectionTitle title="참석 현황" inline />
                        <span style={{ fontSize: 11, fontWeight: 700, color: membersLoadStatus === 'failed' ? '#B91C1C' : '#64748B' }}>
                            {membersLoadStatus === 'loading'
                                ? '총원 집계 중'
                                : membersLoadStatus === 'failed'
                                    ? '총원 확인 불가'
                                    : totalMemberCount > 0
                                        ? `총 ${totalMemberCount}명`
                                        : ''}
                        </span>
                    </div>

                    {attendancesError && (
                        <div
                            style={{
                                marginBottom: 10, padding: '8px 10px', borderRadius: 8,
                                backgroundColor: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.22)',
                                fontSize: 11, fontWeight: 700, color: '#92400E',
                            }}
                        >
                            참석 현황을 불러오지 못했습니다
                        </div>
                    )}

                    {summary.arrivalBuckets.map((b) => (
                        <BucketRow
                            key={b.time}
                            color={ARRIVAL_DOT_COLOR[b.time]}
                            label={`${b.time} 참석`}
                            count={b.count}
                            members={b.members}
                        />
                    ))}
                    {summary.leaveBuckets
                        .filter((b) => b.time !== 'end')
                        .map((b) => (
                            <BucketRow
                                key={b.time}
                                color={LEAVE_DOT_COLOR[b.time]}
                                label={`${b.time} 조퇴`}
                                count={b.count}
                                members={b.members}
                            />
                        ))
                    }
                    <BucketRow
                        color="#EF4444"
                        label="불참"
                        count={summary.totalNotAttending}
                        members={summary.notAttendingList}
                    />

                    {summary.totalGuestsAttending > 0 && (
                        <p style={{ fontSize: 11, fontWeight: 600, color: '#475569', margin: '10px 0 0' }}>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#94A3B8', marginRight: 6 }} />
                            게스트 {summary.totalGuestsAttending}명 포함
                        </p>
                    )}
                    {/* 운영진 전용 — 회원 매핑이 풀린 attendance row 카운트.
                        일반 회원에게는 표시하지 않는다 (UUID/이름 추정 우려 + 디버그 노이즈). */}
                    {showUnlinkedBadge && (
                        <p
                            style={{
                                margin: '10px 0 0', padding: '6px 10px', borderRadius: 8,
                                backgroundColor: 'rgba(245,158,11,0.10)',
                                border: '1px solid rgba(245,158,11,0.24)',
                                fontSize: 10.5, fontWeight: 700, color: '#92400E',
                                wordBreak: 'keep-all', lineHeight: 1.5,
                            }}
                        >
                            ⚠ 운영진 안내 · 연결되지 않은 참석 기록 {unlinkedAttendances.length}건
                            (회원 합계 제외)
                        </p>
                    )}
                </section>

                {/* 참석 현황 요약 — 모든 로그인 회원에게 공개. 이름은 항상 펼쳐서 표시. */}
                <section style={cardStyle}>
                    <SectionTitle title="참석 현황 요약" />

                    {membersLoadStatus === 'failed' && (
                        <div
                            style={{
                                marginBottom: 10, padding: '8px 10px', borderRadius: 8,
                                backgroundColor: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.28)',
                                fontSize: 11, fontWeight: 700, color: '#B91C1C',
                            }}
                        >
                            회원 명단을 불러오지 못했습니다 · 미응답 계산 불가
                        </div>
                    )}
                    {membersLoadStatus === 'loading' && (
                        <div
                            style={{
                                marginBottom: 10, padding: '8px 10px', borderRadius: 8,
                                backgroundColor: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.18)',
                                fontSize: 11, fontWeight: 700, color: '#475569',
                            }}
                        >
                            회원 명단 불러오는 중…
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <NameListRow
                            color="#10B981"
                            label="참석"
                            count={summary.totalAttending}
                            names={summary.attendingList.map((m) =>
                                `${m.nickname || '회원 정보 없음'}${m.is_guest ? '(G)' : ''}`,
                            )}
                        />
                        <NameListRow
                            color="#EF4444"
                            label="불참"
                            count={summary.totalNotAttending}
                            names={summary.notAttendingList.map((m) =>
                                `${m.nickname || '회원 정보 없음'}${m.is_guest ? '(G)' : ''}`,
                            )}
                        />
                        {/* 미응답: 활성 회원 중 attendance row 가 없는 회원. members.nickname 사용.
                            로딩/실패 상태에서는 숫자 대신 안내문을 placeholder로 사용. */}
                        <NameListRow
                            color="#F59E0B"
                            label="미응답"
                            count={membersLoadStatus === 'ok' ? noResponseMembers.length : 0}
                            names={noResponseMembers.map((m) => m.nickname || '회원 정보 없음')}
                            emptyPlaceholder={
                                membersLoadStatus === 'loading' ? '회원 명단 불러오는 중…'
                                    : membersLoadStatus === 'failed' ? '계산 불가 (회원 명단 미수신)'
                                        : '—'
                            }
                            countOverride={
                                membersLoadStatus === 'loading' ? '집계 중'
                                    : membersLoadStatus === 'failed' ? '확인 불가'
                                        : undefined
                            }
                            isLast
                        />
                    </div>

                    {/* 보조 통계 — 코트당 평균 + 게스트 신청 건수. 운영진 전용 표시 제거. */}
                    <div
                        style={{
                            marginTop: 10, padding: '8px 10px', borderRadius: 10,
                            backgroundColor: '#F8FAFC', border: '1px solid rgba(15,23,42,0.06)',
                            display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between',
                            fontSize: 11, fontWeight: 700, color: '#475569',
                        }}
                    >
                        <span>
                            코트당 평균{' '}
                            <strong style={{ color: '#0F172A', fontWeight: 900 }}>
                                {schedule.court_count
                                    ? `${Math.ceil(summary.totalAttending / Math.max(1, schedule.court_count))}명`
                                    : '—'}
                            </strong>
                            {schedule.court_count ? ` · ${schedule.court_count}면` : ' · 코트 미지정'}
                        </span>
                        <span>
                            게스트 신청{' '}
                            <strong style={{ color: '#0F172A', fontWeight: 900 }}>
                                {guestRequestCount}건
                            </strong>
                        </span>
                    </div>
                </section>

                {/* 특이사항 / 파트너 요청 */}
                <section style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <SectionTitle title="특이사항 · 파트너 요청" inline />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                            댓글 {totalCommentCount}
                        </span>
                    </div>

                    {commentsError && (
                        <div
                            style={{
                                marginBottom: 10, padding: '8px 10px', borderRadius: 8,
                                backgroundColor: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.22)',
                                fontSize: 11, fontWeight: 700, color: '#92400E',
                            }}
                        >
                            댓글을 불러오지 못했습니다
                        </div>
                    )}

                    {!commentsError && comments.length === 0 && (
                        <p style={{ fontSize: 11.5, fontWeight: 600, color: '#94A3B8', textAlign: 'center', margin: '14px 0' }}>
                            아직 댓글이 없어요
                        </p>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {commentsForDisplay.map((c) => (
                            <CommentThread
                                key={c.id}
                                comment={c}
                                currentUserId={user?.id ?? null}
                                isAdmin={isAdmin}
                                replyingToId={replyingToId}
                                replyBody={replyBody}
                                postingReply={postingReply}
                                onReplyToggle={() => handleStartReply(c.id)}
                                onReplyBodyChange={setReplyBody}
                                onReplyCancel={handleCancelReply}
                                onReplySubmit={() => handleSubmitReply(c.id)}
                                onEditParent={() => handleStartEditComment(c)}
                                onDeleteParent={() => handleDeleteComment(c.id)}
                                onEditReply={(reply) => handleStartEditComment(reply)}
                                onDeleteReply={(replyId) => handleDeleteComment(replyId)}
                            />
                        ))}
                    </div>

                    {/* 작성 입력 (신규/수정 통합) */}
                    {user?.id && (
                        <div
                            id="comment-input"
                            style={{
                                marginTop: 14,
                                paddingTop: 10,
                                paddingRight: 10,
                                paddingBottom: 10,
                                paddingLeft: 10,
                                borderRadius: 14,
                                backgroundColor: '#F8FAFC',
                                border: `1px solid ${editingCommentId ? 'rgba(59,130,246,0.32)' : 'rgba(15,23,42,0.06)'}`,
                                display: 'flex', flexDirection: 'column', gap: 8,
                            }}
                        >
                            {editingCommentId && (
                                <p style={{ fontSize: 11, fontWeight: 800, color: '#1D4ED8', margin: 0, letterSpacing: '-0.01em' }}>
                                    댓글 수정 중
                                </p>
                            )}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {(['일반', '늦음', '조퇴', '파트너 요청', '게스트 신청'] as const).map((cat) => (
                                    <button
                                        key={cat}
                                        type="button"
                                        onClick={() => setCommentCategory(cat)}
                                        style={{
                                            fontSize: 10, fontWeight: 800,
                                            paddingTop: 4, paddingRight: 9, paddingBottom: 4, paddingLeft: 9,
                                            borderRadius: 999,
                                            backgroundColor: commentCategory === cat ? '#0F172A' : '#FFFFFF',
                                            color: commentCategory === cat ? '#FFFFFF' : '#475569',
                                            border: `1px solid ${commentCategory === cat ? '#0F172A' : 'rgba(15,23,42,0.10)'}`,
                                            cursor: 'pointer',
                                            WebkitTapHighlightColor: 'transparent',
                                        }}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                                <textarea
                                    value={commentBody}
                                    onChange={(e) => setCommentBody(e.target.value)}
                                    placeholder={
                                        commentCategory === '게스트 신청'
                                            ? '게스트 이름, 참석 시간 등 필요한 내용을 남겨주세요.'
                                            : '늦은 시간, 늦음, 파트너 요청 등을 남겨주세요'
                                    }
                                    rows={2}
                                    style={{
                                        flex: 1, resize: 'none', minHeight: 38,
                                        paddingTop: 8, paddingRight: 10, paddingBottom: 8, paddingLeft: 10,
                                        borderRadius: 10,
                                        border: '1px solid rgba(15,23,42,0.10)',
                                        fontSize: 12, fontWeight: 500, color: '#0F172A',
                                        backgroundColor: '#FFFFFF',
                                        fontFamily: 'inherit',
                                        outline: 'none',
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={handleSubmitComment}
                                    disabled={postingComment || !commentBody.trim()}
                                    style={{
                                        width: editingCommentId ? 'auto' : 38, minWidth: editingCommentId ? 80 : undefined,
                                        height: 38, flexShrink: 0,
                                        paddingLeft: editingCommentId ? 12 : 0, paddingRight: editingCommentId ? 12 : 0,
                                        borderRadius: editingCommentId ? 10 : '50%',
                                        backgroundColor: commentBody.trim() ? '#3B82F6' : '#CBD5E1',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        cursor: commentBody.trim() ? 'pointer' : 'not-allowed',
                                        WebkitTapHighlightColor: 'transparent',
                                        fontSize: 12, fontWeight: 800,
                                    }}
                                    aria-label={editingCommentId ? '수정 저장' : '댓글 보내기'}
                                >
                                    {editingCommentId
                                        ? '수정 저장'
                                        : <Send size={15} />}
                                </button>
                            </div>
                            {editingCommentId && (
                                <button
                                    type="button"
                                    onClick={handleCancelEditComment}
                                    style={{
                                        fontSize: 11, fontWeight: 700, color: '#64748B',
                                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                        alignSelf: 'flex-start',
                                        WebkitTapHighlightColor: 'transparent',
                                    }}
                                >
                                    취소
                                </button>
                            )}
                        </div>
                    )}
                </section>

                {/* Guest Pass — 페이지 최하단.
                    운영진에게는 설정 카드, 활성 시 일반 회원에게는 링크 복사 카드.
                    schedule.guest_enabled === false 인 정모는 두 카드 모두 숨김. */}
                {schedule.guest_enabled && (
                    <div style={{ paddingBottom: 24 }}>
                        {isAdmin
                            ? <GuestPassSettingsCard schedule={schedule} userId={user?.id} />
                            : <GuestPassMemberLink schedule={schedule} />}
                    </div>
                )}
            </div>
        </main>
    );
}

// ── Sub-components ──────────────────────────────────────────────────────────

const SectionTitle = ({ title, inline }: { title: string; inline?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: inline ? 0 : 12 }}>
        <span style={{ width: 4, height: 16, background: 'linear-gradient(180deg, #10B981, #059669)', borderRadius: 2 }} />
        <h3 style={{ fontSize: 14, fontWeight: 900, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>
            {title}
        </h3>
    </div>
);

/**
 * 비회원·게스트·미연결 계정 안내 카드.
 * 정모 일정/현황 조회는 그대로 두고, 참석/조퇴/불참 버튼만 안내 카드로 대체된다.
 *
 * 문구 정책:
 *   - "회원 정보 없음" 같은 시스템 디버그 표현을 사용자 안내에 사용하지 않는다.
 *   - 운영진에게 직접 연락하는 자연스러운 경로만 제시.
 *   - 작은 화면(360px)에서도 줄바꿈이 자연스럽도록 wordBreak: keep-all.
 */
const NonMemberAttendanceNotice = ({ isLoggedIn }: { isLoggedIn: boolean }) => {
    const heading = isLoggedIn
        ? '회원 계정 연결이 확인되지 않았습니다'
        : 'TEYEON 회원 전용 참석 체크입니다';
    const body = isLoggedIn
        ? 'TEYEON 회원이라면 운영진에게 계정 연결을 요청해 주세요. 게스트 참여는 초대한 회원 또는 운영진을 통해 신청해 주세요.'
        : '게스트 참여는 초대한 회원 또는 운영진을 통해 신청해 주세요.';
    return (
        <div
            role="status"
            style={{
                padding: '14px 14px', borderRadius: 12,
                backgroundColor: '#F8FAFC',
                border: '1px solid rgba(15,23,42,0.08)',
                display: 'flex', flexDirection: 'column', gap: 8,
            }}
        >
            <p style={{
                margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A',
                wordBreak: 'keep-all', lineHeight: 1.45,
            }}>
                {heading}
            </p>
            <p style={{
                margin: 0, fontSize: 11.5, fontWeight: 600, color: '#475569',
                wordBreak: 'keep-all', lineHeight: 1.55,
            }}>
                {body}
            </p>
        </div>
    );
};

const SubLabel = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
    <p style={{ fontSize: 11, fontWeight: 700, color: '#475569', margin: '12px 0 6px', letterSpacing: '-0.01em' }}>
        {children}
        {hint && <span style={{ color: '#94A3B8', fontWeight: 500 }}>{hint}</span>}
    </p>
);

const TimeChip = ({
    label, sub, selected, disabled, onClick, color,
}: {
    label: string;
    sub: string;
    selected: boolean;
    disabled?: boolean;
    onClick: () => void;
    color: string;
}) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '10px 4px',
            borderRadius: 12,
            backgroundColor: selected ? `${color}14` : '#FFFFFF',
            border: `1.5px solid ${selected ? color : 'rgba(15,23,42,0.10)'}`,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled && !selected ? 0.5 : 1,
            WebkitTapHighlightColor: 'transparent',
            transition: 'background-color 0.15s, border-color 0.15s',
        }}
    >
        <span style={{
            fontSize: 15, fontWeight: 900, color: selected ? color : '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.1,
        }}>
            {label}
        </span>
        {sub && (
            <span style={{ fontSize: 9, fontWeight: 700, color: selected ? color : '#94A3B8', marginTop: 3, letterSpacing: '0.02em' }}>
                {sub}
            </span>
        )}
    </button>
);

const AbsentButton = ({
    selected, disabled, onClick,
}: { selected: boolean; disabled?: boolean; onClick: () => void }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
            width: '100%', height: 42, borderRadius: 12,
            backgroundColor: selected ? 'rgba(239,68,68,0.10)' : '#FFFFFF',
            border: `1.5px solid ${selected ? '#EF4444' : 'rgba(15,23,42,0.10)'}`,
            color: selected ? '#EF4444' : '#475569',
            fontSize: 13, fontWeight: 800,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled && !selected ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent',
            transition: 'background-color 0.15s, border-color 0.15s',
        }}
    >
        {selected && <span style={{ fontSize: 13 }}>✕</span>}
        불참
    </button>
);

const StatusBanner = ({
    status, arrival, leave,
}: { status: AttendanceStatus | null; arrival: ArrivalTimeOption | null; leave: LeaveTimeOption | null }) => {
    if (!status) return null;
    if (status === 'not_attending') {
        return (
            <div
                style={{
                    margin: '0 0 12px', padding: '10px 12px', borderRadius: 10,
                    backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)',
                    color: '#991B1B', fontSize: 12, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
            >
                <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 16, height: 16, borderRadius: '50%',
                    backgroundColor: '#EF4444', color: '#FFFFFF', fontSize: 10, fontWeight: 900,
                }}>✕</span>
                불참으로 저장됨
            </div>
        );
    }
    const leaveLabel = leave === 'end' || !leave ? '끝까지' : `${leave} 조퇴`;
    return (
        <div
            style={{
                margin: '0 0 12px', padding: '10px 12px', borderRadius: 10,
                backgroundColor: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.22)',
                color: '#065F46', fontSize: 12, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
        >
            <span style={{ fontSize: 13 }}>✓</span>
            {arrival || '19:00'} 참석 · {leaveLabel} 로 저장됨
        </div>
    );
};

/**
 * 시간대별 참석/불참 row — 이름 목록 항상 표시. 펼침 토글 제거.
 * "누가 어디에 있는지" 한눈에 보여야 하는 운영 화면 우선순위.
 */
const BucketRow = ({
    color, label, count, members,
}: {
    color: string;
    label: string;
    count: number;
    members: AttendanceWithMember[];
}) => (
    <div style={{ borderBottom: '1px solid rgba(15,23,42,0.06)', padding: '10px 0' }}>
        <div
            style={{
                display: 'flex', alignItems: 'center', gap: 8,
            }}
        >
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                {label}
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: count > 0 ? color : '#94A3B8' }}>
                {count}명
            </span>
        </div>
        {/* 이름 목록 — 항상 표시. 0명일 땐 회색 placeholder. */}
        <p style={{
            margin: '6px 0 0 16px', fontSize: 11,
            fontWeight: members.length > 0 ? 600 : 500,
            color: members.length > 0 ? '#475569' : '#CBD5E1',
            lineHeight: 1.55, wordBreak: 'keep-all',
        }}>
            {members.length > 0
                ? members.map((m, i) => (
                    <span key={m.id}>
                        {m.nickname || '회원 정보 없음'}{m.is_guest ? '(G)' : ''}
                        {i < members.length - 1 ? ', ' : ''}
                    </span>
                ))
                : '—'}
        </p>
    </div>
);

/**
 * 참석/불참/미응답 명단 row — 이름 항상 표시. 펼침 토글 제거.
 * 표시값은 호출자에서 가공해 names: string[] 으로 전달. 개인정보(이메일/UUID/카카오 닉네임) 노출 금지.
 *
 * emptyPlaceholder: names가 비어있을 때 표시할 안내문 (기본 '—').
 *                   미응답 row에서 loading/failed 상태를 사용자에게 보여줄 때 사용.
 * countOverride:    count 숫자 대신 문자열을 카운트 자리에 표시 (loading/failed 안내).
 */
const NameListRow = ({
    color, label, count, names, isLast, emptyPlaceholder = '—', countOverride,
}: {
    color: string;
    label: string;
    count: number;
    names: string[];
    isLast?: boolean;
    emptyPlaceholder?: string;
    countOverride?: string;
}) => (
    <div
        style={{
            borderBottom: isLast ? 'none' : '1px solid rgba(15,23,42,0.06)',
            padding: '10px 0',
        }}
    >
        <div
            style={{
                display: 'flex', alignItems: 'center', gap: 8,
            }}
        >
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                {label}
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: count > 0 ? color : '#94A3B8' }}>
                {countOverride ?? `${count}명`}
            </span>
        </div>
        <p
            style={{
                margin: '6px 0 0 16px',
                fontSize: 11,
                fontWeight: names.length > 0 ? 600 : 500,
                color: names.length > 0 ? '#475569' : '#CBD5E1',
                lineHeight: 1.6, wordBreak: 'keep-all',
            }}
        >
            {names.length > 0 ? names.join(', ') : emptyPlaceholder}
        </p>
    </div>
);

/**
 * 1단계 스레드: 원댓글 + (답글 입력창 if replying) + 답글들.
 *
 * 시각 구조:
 *   ─── 원댓글
 *   │   ↳ 답글 입력 (답글 버튼 누르면 바로 아래)
 *   │   ↳ 답글 A-1
 *   │   ↳ 답글 A-2
 *
 * 부모 + 답글 묶음을 옅은 배경/좌측 가이드선으로 시각 연결.
 * 답글 입력창은 부모 바로 아래에 표시되어 컨텍스트가 끊기지 않음.
 */
const CommentThread = ({
    comment, currentUserId, isAdmin,
    replyingToId, replyBody, postingReply,
    onReplyToggle, onReplyBodyChange, onReplyCancel, onReplySubmit,
    onEditParent, onDeleteParent,
    onEditReply, onDeleteReply,
}: {
    comment: CommentWithMember;
    currentUserId: string | null;
    isAdmin: boolean;
    replyingToId: string | null;
    replyBody: string;
    postingReply: boolean;
    onReplyToggle: () => void;
    onReplyBodyChange: (v: string) => void;
    onReplyCancel: () => void;
    onReplySubmit: () => void;
    onEditParent: () => void;
    onDeleteParent: () => void;
    onEditReply: (reply: CommentWithMember) => void;
    onDeleteReply: (replyId: string) => void;
}) => {
    const isReplyingHere = replyingToId === comment.id;
    const hasReplies = !!comment.replies && comment.replies.length > 0;
    const showInlineChildren = isReplyingHere || hasReplies;
    return (
        <div
            style={{
                // 스레드 그룹 — 흰 카드 위에 살짝 옅은 배경/테두리. 다른 원댓글과의 구분을 강화.
                borderRadius: 12,
                backgroundColor: showInlineChildren ? 'rgba(15,23,42,0.025)' : 'transparent',
                border: showInlineChildren ? '1px solid rgba(15,23,42,0.05)' : '1px solid transparent',
                padding: showInlineChildren ? 10 : 0,
                display: 'flex', flexDirection: 'column', gap: 10,
                transition: 'background-color 0.15s, border-color 0.15s',
            }}
        >
            <CommentItem
                comment={comment}
                isReply={false}
                canDelete={currentUserId === comment.user_id || isAdmin}
                canEdit={currentUserId === comment.user_id}
                canReply={!!currentUserId}
                isReplying={isReplyingHere}
                onEdit={onEditParent}
                onDelete={onDeleteParent}
                onReplyToggle={onReplyToggle}
            />

            {/* 답글 입력 — 원댓글 바로 아래. 답글 리스트보다 먼저 표시되어 컨텍스트가 자연스럽게 이어짐. */}
            {isReplyingHere && currentUserId && (
                <div
                    id={`reply-input-${comment.id}`}
                    style={{
                        // 들여쓰기는 답글과 동일 — 시각적으로 답글 위치를 미리 보여줌.
                        marginLeft: 16,
                        paddingTop: 10, paddingRight: 10, paddingBottom: 10, paddingLeft: 12,
                        borderRadius: 10,
                        backgroundColor: '#FFFFFF',
                        border: '1px solid rgba(59,130,246,0.32)',
                        borderLeft: '3px solid #3B82F6',
                        display: 'flex', flexDirection: 'column', gap: 8,
                    }}
                >
                    <p style={{ fontSize: 11, fontWeight: 800, color: '#1D4ED8', margin: 0, letterSpacing: '-0.01em' }}>
                        답글 작성 중
                    </p>
                    {/* 모바일에서도 한 줄에서 잘리지 않도록 textarea + 버튼은 세로 배치. */}
                    <textarea
                        value={replyBody}
                        onChange={(e) => onReplyBodyChange(e.target.value)}
                        placeholder="답글을 입력하세요"
                        rows={2}
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            resize: 'none', minHeight: 38,
                            paddingTop: 8, paddingRight: 10, paddingBottom: 8, paddingLeft: 10,
                            borderRadius: 8,
                            border: '1px solid rgba(15,23,42,0.10)',
                            fontSize: 12, fontWeight: 500, color: '#0F172A',
                            backgroundColor: '#FFFFFF',
                            fontFamily: 'inherit',
                            outline: 'none',
                        }}
                    />
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            onClick={onReplyCancel}
                            style={{
                                height: 30, paddingLeft: 12, paddingRight: 12,
                                borderRadius: 8,
                                border: '1px solid rgba(15,23,42,0.10)',
                                backgroundColor: '#FFFFFF', color: '#64748B',
                                fontSize: 11, fontWeight: 800,
                                cursor: 'pointer',
                                WebkitTapHighlightColor: 'transparent',
                            }}
                        >
                            취소
                        </button>
                        <button
                            type="button"
                            onClick={onReplySubmit}
                            disabled={postingReply || !replyBody.trim()}
                            style={{
                                height: 30, paddingLeft: 14, paddingRight: 14,
                                borderRadius: 8,
                                backgroundColor: replyBody.trim() ? '#3B82F6' : '#CBD5E1',
                                color: '#FFFFFF', border: 'none',
                                fontSize: 11, fontWeight: 800,
                                cursor: replyBody.trim() ? 'pointer' : 'not-allowed',
                                WebkitTapHighlightColor: 'transparent',
                            }}
                        >
                            {postingReply ? '등록 중...' : '등록'}
                        </button>
                    </div>
                </div>
            )}

            {/* 답글 리스트 — 좌측 가이드선으로 부모와 연결. created_at ASC. */}
            {hasReplies && (
                <div
                    style={{
                        marginLeft: 16,
                        paddingLeft: 12,
                        borderLeft: '2px solid rgba(59,130,246,0.18)',
                        display: 'flex', flexDirection: 'column', gap: 10,
                    }}
                >
                    {comment.replies!.map((r) => (
                        <CommentItem
                            key={r.id}
                            comment={r}
                            isReply
                            canDelete={currentUserId === r.user_id || isAdmin}
                            canEdit={currentUserId === r.user_id}
                            // 답글에서 다시 답글을 눌러도 부모 원댓글에 답글로 추가됨 (service 정규화).
                            canReply={!!currentUserId}
                            isReplying={false}
                            onEdit={() => onEditReply(r)}
                            onDelete={() => onDeleteReply(r.id)}
                            onReplyToggle={onReplyToggle}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const CommentItem = ({
    comment, isReply, canDelete, canEdit, canReply, isReplying, onEdit, onDelete, onReplyToggle,
}: {
    comment: CommentWithMember;
    isReply: boolean;
    canDelete: boolean;
    canEdit: boolean;
    canReply: boolean;
    isReplying: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onReplyToggle: () => void;
}) => {
    const displayName = comment.nickname || '회원 정보 없음';
    const ts = new Date(comment.created_at);
    const tsLabel = `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
    // 수정 표시 — created_at 과 updated_at 이 의미 있게 차이 나면 '수정됨' 라벨.
    const updated = new Date(comment.updated_at);
    const isEdited = Math.abs(updated.getTime() - ts.getTime()) > 1500;
    const avatarSize = isReply ? 24 : 28;
    return (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <div style={{ width: avatarSize, height: avatarSize, flexShrink: 0 }}>
                {/* avatarUrl 있으면 ProfileAvatar(이미지) — 로드 실패 시 fallbackIcon=InitialAvatar.
                    avatarUrl 없으면 바로 InitialAvatar.
                    개인정보 alt 노출 금지 → 일관된 '프로필 이미지' alt 사용. */}
                {comment.avatarUrl ? (
                    <ProfileAvatar
                        src={comment.avatarUrl}
                        alt="프로필 이미지"
                        size={avatarSize}
                        className="rounded-full"
                        fallbackIcon={<InitialAvatar name={displayName} size={avatarSize} />}
                    />
                ) : (
                    <InitialAvatar name={displayName} size={avatarSize} />
                )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: isReply ? 11.5 : 12, fontWeight: 800, color: '#0F172A' }}>
                        {displayName}
                    </span>
                    {!isReply && comment.category && (() => {
                        // 게스트 신청만 살짝 다른 톤 — 과한 색상은 피하고 운영진 인지성만 살림.
                        const isGuestReq = comment.category === '게스트 신청';
                        return (
                            <span style={{
                                fontSize: 9, fontWeight: 800,
                                paddingTop: 1, paddingRight: 6, paddingBottom: 1, paddingLeft: 6,
                                borderRadius: 4,
                                backgroundColor: isGuestReq ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.10)',
                                color: isGuestReq ? '#065F46' : '#3730A3',
                                border: `1px solid ${isGuestReq ? 'rgba(16,185,129,0.28)' : 'rgba(99,102,241,0.22)'}`,
                                letterSpacing: '0.04em',
                            }}>
                                {comment.category}
                            </span>
                        );
                    })()}
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8' }}>{tsLabel}</span>
                    {isEdited && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8' }}>· 수정됨</span>
                    )}
                </div>
                <p style={{ margin: '3px 0 0', fontSize: isReply ? 11.5 : 12, fontWeight: 500, color: '#1E293B', lineHeight: 1.55, wordBreak: 'keep-all' }}>
                    {comment.body}
                </p>
                {(canDelete || canEdit || (canReply && !isReply)) && (
                    <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        {/* 답글 버튼은 원댓글에만 표시 — 1단계 스레드 정책. */}
                        {canReply && !isReply && (
                            <button
                                type="button"
                                onClick={onReplyToggle}
                                style={{
                                    fontSize: 10, fontWeight: 700,
                                    color: isReplying ? '#1D4ED8' : '#475569',
                                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                <MessageSquare size={10} />
                                {isReplying ? '답글 취소' : '답글'}
                            </button>
                        )}
                        {canEdit && (
                            <button
                                type="button"
                                onClick={onEdit}
                                style={{
                                    fontSize: 10, fontWeight: 700, color: '#3B82F6',
                                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                수정
                            </button>
                        )}
                        {canDelete && (
                            <button
                                type="button"
                                onClick={onDelete}
                                style={{
                                    fontSize: 10, fontWeight: 700, color: '#94A3B8',
                                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                <Trash2 size={10} />
                                삭제
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Shared styles ───────────────────────────────────────────────────────────

const pageBaseStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '100dvh',
    backgroundColor: '#F2F4F7',
    marginBottom: 'calc(-1 * var(--page-bottom-safe))',
};

const containerStyle: React.CSSProperties = {
    // padding shorthand를 분리한 형태 — loading/not-found 분기에서 paddingTop만 덮어쓸 때
    // React의 "Removing a style property during rerender (paddingTop)" 경고를 회피.
    width: '100%',
    maxWidth: 430,
    margin: '0 auto',
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 'var(--page-bottom-safe)',
    paddingLeft: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    boxSizing: 'border-box',
};

const cardStyle: React.CSSProperties = {
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    border: '1px solid rgba(15,23,42,0.06)',
    boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
    padding: 16,
};

const infoRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
};

const infoLabelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: '#94A3B8', minWidth: 32,
};

const infoValueStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: '#0F172A', flex: 1, wordBreak: 'keep-all',
};

const chipRowStyle: React.CSSProperties = {
    display: 'flex', gap: 7,
};
