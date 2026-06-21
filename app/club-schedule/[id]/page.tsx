'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, MapPin, Calendar, Clock, Users, Lock, Send, Trash2, Plus, Share2, Check } from 'lucide-react';
import { shareOrCopyClubSchedule } from '@/lib/clubScheduleShare';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchClubScheduleById } from '@/lib/clubScheduleService';
import {
    fetchMyAttendance,
    upsertAttendance,
    fetchAttendancesWithMembers,
    buildAttendanceSummary,
    evaluateAttendanceWindow,
    fetchComments,
    createComment,
    updateComment,
    deleteComment,
    resolveMemberIdForUser,
    ARRIVAL_OPTIONS,
    LEAVE_OPTIONS,
    type ArrivalTimeOption,
    type LeaveTimeOption,
    type AttendanceStatus,
    type AttendanceRow,
    type AttendanceWithMember,
    type AttendanceSummary,
    type CommentWithMember,
} from '@/lib/clubScheduleAttendanceService';
import { CLUB_TYPE_STYLE, formatTimeRangeAmPm, type ClubSchedule } from '@/lib/clubScheduleData';

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
    const isAdmin = role === 'CEO' || role === 'ADMIN';

    const [schedule, setSchedule] = useState<ClubSchedule | null>(null);
    const [linkedMemberId, setLinkedMemberId] = useState<string | null>(null);
    const [myAttendance, setMyAttendance] = useState<AttendanceRow | null>(null);
    const [allAttendances, setAllAttendances] = useState<AttendanceWithMember[]>([]);
    const [comments, setComments] = useState<CommentWithMember[]>([]);
    const [totalMemberCount, setTotalMemberCount] = useState(0);

    const [pageLoading, setPageLoading] = useState(true);
    const [scheduleLoadError, setScheduleLoadError] = useState<string>('');
    const [attendancesError, setAttendancesError] = useState<string>('');
    const [commentsError, setCommentsError] = useState<string>('');
    const [memberCountError, setMemberCountError] = useState<string>('');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [saveError, setSaveError] = useState<string>('');
    const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
    const [commentBody, setCommentBody] = useState('');
    const [commentCategory, setCommentCategory] = useState<string | null>('일반');
    const [postingComment, setPostingComment] = useState(false);
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [shareState, setShareState] = useState<'idle' | 'busy' | 'copied' | 'shared' | 'failed'>('idle');

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

        // 멤버 수 — is_guest 필터를 쓰지 않고 단순 count.
        // (이전 .or('is_guest.is.null,is_guest.eq.false') 가 일부 환경에서 400을 발생시켜 전체 로드 실패의 원인이었음)
        try {
            const { count, error } = await supabase
                .from('members')
                .select('id', { count: 'exact', head: true });
            if (error) throw error;
            setTotalMemberCount(count || 0);
            setMemberCountError('');
        } catch (err: any) {
            logSupabaseError('MemberCount', err);
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

    // 본인의 members.id를 안정적으로 찾는다 — profiles → members.email exact match.
    useEffect(() => {
        if (!user?.id) { setLinkedMemberId(null); return; }
        let cancelled = false;
        resolveMemberIdForUser({ userId: user.id, userEmail: user.email ?? null })
            .then((id) => {
                if (cancelled) return;
                setLinkedMemberId(id);
                if (!id) {
                    // member_id가 잡히지 않은 경우 — 명단에 본인이 '회원 정보 없음'으로 나오는 주된 원인.
                    // 저장은 user_id로 정상 진행되지만, member_id null인 row를 남기지 않으려면
                    // profiles.email 또는 members.email 데이터를 점검해야 한다.
                    console.warn(
                        '[ClubSchedule/member-id] 로그인 사용자의 members.id를 찾지 못했습니다. ' +
                        'profiles.id 매칭, profiles.email 값, 또는 members.email 등록 여부 확인 필요.'
                    );
                }
            })
            .catch(() => {
                if (cancelled) return;
                setLinkedMemberId(null);
            });
        return () => { cancelled = true; };
    }, [user?.id, user?.email]);

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

    // 본인 row의 nickname이 비어있을 때 표시용 이름을 user_metadata / email에서 보강.
    // (auth.user_metadata와 email은 본인 토큰 안에서만 안전하게 사용. 다른 회원 row에는 적용하지 않음)
    const attendancesForDisplay = useMemo(() => {
        if (!user?.id) return allAttendances;
        const meta = user.user_metadata || {};
        const emailLocal = user.email ? user.email.split('@')[0] : null;
        const selfFallback =
            (meta.nickname as string | undefined) ||
            (meta.full_name as string | undefined) ||
            (meta.name as string | undefined) ||
            emailLocal ||
            null;
        if (!selfFallback) return allAttendances;
        return allAttendances.map((row) =>
            row.user_id === user.id && !row.nickname
                ? { ...row, nickname: selfFallback }
                : row
        );
    }, [allAttendances, user?.id, user?.user_metadata, user?.email]);

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
        setSaveStatus('saving');
        setSaveError('');
        try {
            // member_id가 아직 비어있으면 즉석에서 한 번 더 시도 — 최초 진입 직후 저장하는
            // 경우에도 attendance row에 정식 member_id가 함께 저장되도록 보강.
            let memberIdToSave = linkedMemberId;
            if (!memberIdToSave) {
                memberIdToSave = await resolveMemberIdForUser({
                    userId: user.id,
                    userEmail: user.email ?? null,
                });
                if (memberIdToSave) setLinkedMemberId(memberIdToSave);
            }

            const saved = await upsertAttendance({
                schedule_id: schedule.id,
                user_id: user.id,
                member_id: memberIdToSave,
                attendance_status: opts.status,
                arrival_time: opts.status === 'attending' ? (opts.arrival ?? null) : null,
                leave_time:   opts.status === 'attending' ? (opts.leave   ?? null) : null,
                note: myAttendance?.note ?? null,
            });
            // 1) 내 응답 즉시 갱신
            setMyAttendance(saved);
            setSaveStatus('saved');

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
            logSupabaseError('Attendance/save', err);
            setSaveStatus('error');
            setSaveError('참석 상태 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        }
    }, [user?.id, schedule, linkedMemberId, myAttendance?.note, isReadOnly]);

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
        setPostingComment(true);
        try {
            if (editingCommentId) {
                await updateComment({
                    id: editingCommentId,
                    body,
                    category: commentCategory,
                });
            } else {
                await createComment({
                    schedule_id: schedule.id,
                    user_id: user.id,
                    member_id: linkedMemberId,
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
        if (!confirm('이 댓글을 삭제하시겠어요?')) return;
        try {
            await deleteComment(id);
            setComments((prev) => prev.filter((c) => c.id !== id));
            if (editingCommentId === id) resetCommentForm();
        } catch (err) {
            logSupabaseError('Comment/delete', err);
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
                        {/* 참석 체크 안내문 공유 (회원 전용 — 공개 익명 페이지 아님) */}
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
                                            : '참석 안내문 복사'}
                        </button>
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

                        {/* 저장 상태 배너 (시안 B/C/D) */}
                        {myAttendance && (
                            <StatusBanner status={myStatus} arrival={myArrival} leave={myLeave} />
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
                    </section>
                )}

                {/* 참석 현황 (시간대별) */}
                <section style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <SectionTitle title="참석 현황" inline />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                            {memberCountError
                                ? '총원 집계 중'
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
                            expanded={expandedBucket === `arrival-${b.time}`}
                            onToggle={() => setExpandedBucket(expandedBucket === `arrival-${b.time}` ? null : `arrival-${b.time}`)}
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
                                expanded={expandedBucket === `leave-${b.time}`}
                                onToggle={() => setExpandedBucket(expandedBucket === `leave-${b.time}` ? null : `leave-${b.time}`)}
                            />
                        ))
                    }
                    <BucketRow
                        color="#EF4444"
                        label="불참"
                        count={summary.totalNotAttending}
                        members={summary.notAttendingList}
                        expanded={expandedBucket === 'absent'}
                        onToggle={() => setExpandedBucket(expandedBucket === 'absent' ? null : 'absent')}
                    />

                    {summary.totalGuestsAttending > 0 && (
                        <p style={{ fontSize: 11, fontWeight: 600, color: '#475569', margin: '10px 0 0' }}>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#94A3B8', marginRight: 6 }} />
                            게스트 {summary.totalGuestsAttending}명 포함
                        </p>
                    )}

                    {/* 운영진 전용 요약 */}
                    {isAdmin && (
                        <div
                            style={{
                                marginTop: 12, padding: '10px 12px', borderRadius: 12,
                                backgroundColor: '#F8FAFC', border: '1px solid rgba(15,23,42,0.08)',
                            }}
                        >
                            <p style={{ fontSize: 10, fontWeight: 800, color: '#0F172A', margin: '0 0 8px', letterSpacing: '0.04em' }}>
                                🛠 운영진 전용 · 참석 요약
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                <MiniStat value={summary.totalAttending} label="참석" />
                                <MiniStat value={summary.totalNotAttending} label="불참" />
                                <MiniStat value={summary.totalPending} label="미응답" />
                                <MiniStat value={`${guestRequestCount}건`} label="게스트 신청" />
                                <MiniStat
                                    value={schedule.court_count
                                        ? `${Math.ceil(summary.totalAttending / Math.max(1, schedule.court_count))}명/코트`
                                        : '—'}
                                    label={schedule.court_count ? `코트당 평균 인원 · ${schedule.court_count}면` : '코트 미지정'}
                                    wide
                                />
                            </div>
                        </div>
                    )}
                </section>

                {/* 특이사항 / 파트너 요청 */}
                <section style={cardStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <SectionTitle title="특이사항 · 파트너 요청" inline />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                            댓글 {comments.length}
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
                        {comments.map((c) => (
                            <CommentRow
                                key={c.id}
                                comment={c}
                                canDelete={user?.id === c.user_id || isAdmin}
                                canEdit={user?.id === c.user_id}
                                onEdit={() => handleStartEditComment(c)}
                                onDelete={() => handleDeleteComment(c.id)}
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

const BucketRow = ({
    color, label, count, members, expanded, onToggle,
}: {
    color: string;
    label: string;
    count: number;
    members: AttendanceWithMember[];
    expanded: boolean;
    onToggle: () => void;
}) => (
    <div style={{ borderBottom: '1px solid rgba(15,23,42,0.06)', padding: '10px 0' }}>
        <button
            type="button"
            onClick={onToggle}
            style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
            }}
        >
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                {label}
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: count > 0 ? color : '#94A3B8' }}>
                {count}명
            </span>
            <ChevronRight
                size={14}
                style={{
                    color: '#CBD5E1',
                    transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
                    transition: 'transform 0.18s',
                }}
            />
        </button>
        {expanded && members.length > 0 && (
            <p style={{
                margin: '6px 0 0 16px', fontSize: 11, fontWeight: 600, color: '#475569', lineHeight: 1.55, wordBreak: 'keep-all',
            }}>
                {members.map((m, i) => (
                    <span key={m.id}>
                        {m.nickname || '회원 정보 없음'}{m.is_guest ? '(G)' : ''}
                        {i < members.length - 1 ? ', ' : ''}
                    </span>
                ))}
            </p>
        )}
    </div>
);

const MiniStat = ({ value, label, wide }: { value: React.ReactNode; label: string; wide?: boolean }) => (
    <div style={{
        gridColumn: wide ? 'span 2' : 'span 1',
        padding: '10px 8px', borderRadius: 10,
        backgroundColor: '#FFFFFF', border: '1px solid rgba(15,23,42,0.08)',
        textAlign: 'center',
    }}>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
            {value}
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 9.5, fontWeight: 700, color: '#64748B', letterSpacing: '0.02em' }}>
            {label}
        </p>
    </div>
);

const CommentRow = ({
    comment, canDelete, canEdit, onEdit, onDelete,
}: {
    comment: CommentWithMember;
    canDelete: boolean;
    canEdit?: boolean;
    onEdit?: () => void;
    onDelete: () => void;
}) => {
    const initial = (comment.nickname || '?').charAt(0);
    const ts = new Date(comment.created_at);
    const tsLabel = `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
    return (
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                backgroundColor: '#EAF3FC', color: '#1F5FB5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 900,
            }}>
                {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>
                        {comment.nickname || '회원 정보 없음'}
                    </span>
                    {comment.category && (() => {
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
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 12, fontWeight: 500, color: '#1E293B', lineHeight: 1.55, wordBreak: 'keep-all' }}>
                    {comment.body}
                </p>
                {(canDelete || canEdit) && (
                    <div style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        {canEdit && onEdit && (
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
