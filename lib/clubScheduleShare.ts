// Club Schedule 정모 참석 체크 공유 helper.
// 회원용(TEYEON 로그인 전제) 안내문 생성 + 클립보드 복사.
// 공개 익명 참석 페이지/토큰은 만들지 않음 — 기존 /club-schedule/[id] 라우트와 인증 흐름 재사용.

import type { ClubSchedule } from './clubScheduleData';
import { formatTimeRangeAmPm } from './clubScheduleData';

/**
 * 정모 상세 URL 생성.
 *  - 브라우저 환경: window.location.origin 기반.
 *  - SSR: 빈 origin으로 path만 반환(렌더 시 호출되어도 안전).
 *  - query string은 포함하지 않음 (정식 상세 URL만).
 */
export function buildClubScheduleShareUrl(scheduleId: string): string {
    // scheduleId가 비어있으면 잘못된 URL(`/club-schedule/undefined`)을 만드는 대신 빈 문자열 반환.
    // 호출자(handleShare)가 schedule이 null이면 미리 return하므로 일반 흐름에선 도달하지 않음.
    if (!scheduleId) return '';
    const path = `/club-schedule/${scheduleId}`;
    if (typeof window === 'undefined') return path;
    return `${window.location.origin}${path}`;
}

/**
 * 공유 문구 하단 공통 "앱에서 열기" 안내 한 줄.
 * 안내문 복사 / 현황 공유 모두 동일 문구를 사용한다(중복 문자열 단일화).
 */
export function getOpenInAppGuideText(): string {
    return "앱 이용자는 링크를 연 뒤 'TEYEON 앱에서 열기'를 눌러주세요.";
}

/**
 * 마감 ISO → '6월 30일 오전 11:00' 형식. 마감 없으면 빈 문자열.
 */
function formatDeadlineForShare(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h = d.getHours();
    const mi = d.getMinutes();
    const ampm = h < 12 ? '오전' : '오후';
    const h12 = h % 12 || 12;
    const miStr = String(mi).padStart(2, '0');
    return `${m}월 ${day}일 ${ampm} ${h12}:${miStr}`;
}

/**
 * 일정 날짜 — '6월 30일' 형식.
 */
function formatScheduleDateShort(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return date;
    return `${m}월 ${d}일`;
}

/** 공통 정보 라인 (시간/장소/마감) — 안내문·현황 공유에 동일 포맷 재사용. */
function buildInfoLines(schedule: ClubSchedule): string[] {
    const lines: string[] = [];
    const timeRange = formatTimeRangeAmPm(schedule.start_time, schedule.end_time);
    if (timeRange) lines.push(`시간: ${timeRange}`);
    if (schedule.location) lines.push(`장소: ${schedule.location}`);
    return lines;
}

/** 마감 줄 — 없으면 빈 배열. */
function buildDeadlineLines(schedule: ClubSchedule): string[] {
    const deadlineText = formatDeadlineForShare(schedule.attendance_deadline ?? null);
    return deadlineText ? [`참석 마감: ${deadlineText}`] : [];
}

/**
 * 카카오톡/BAND에 그대로 붙여넣을 수 있는 참석 체크 안내문.
 * 회원 개인정보(이름/연락처/이메일/UUID 등)는 포함하지 않는다.
 *
 * @param opts.includeUrl - true(기본): 마지막에 안내 문장 + URL 포함 (클립보드 복사용).
 *                          false: 링크 문장과 URL 제외 (Web Share API 의 text 필드용 —
 *                          공유 시트가 url 을 별도로 받으므로 중복 방지).
 */
export function buildClubScheduleAttendanceGuideText(
    schedule: ClubSchedule,
    opts: { includeUrl?: boolean } = {},
): string {
    const includeUrl = opts.includeUrl !== false;
    const dateShort = formatScheduleDateShort(schedule.schedule_date);
    const titleLine = schedule.title?.trim()
        ? `${dateShort} ${schedule.title.trim()} 참석 체크 부탁드립니다.`
        : `${dateShort} TEYEON 정모 참석 체크 부탁드립니다.`;

    const lines: string[] = [titleLine, ''];
    lines.push(...buildInfoLines(schedule));
    lines.push(...buildDeadlineLines(schedule));

    if (includeUrl) {
        const url = buildClubScheduleShareUrl(schedule.id);
        lines.push('');
        lines.push('TEYEON 앱 로그인 후 아래 링크에서 참석 시간을 선택해 주세요.');
        lines.push(url);
        lines.push('');
        lines.push(getOpenInAppGuideText());
    }

    return lines.join('\n');
}

/** 이전 이름 호환 — 기존 호출자는 안내문 빌더로 그대로 매핑. */
export const buildClubScheduleShareText = buildClubScheduleAttendanceGuideText;

// ── 현재 참석 현황 공유 ──────────────────────────────────────────────────────

export interface ClubScheduleStatusShareInput {
    schedule: ClubSchedule;
    /** attendance_status='attending' row 수 */
    totalAttending: number;
    /** attendance_status='not_attending' row 수 */
    totalNotAttending: number;
    /** 활성 회원 중 attendance row 가 없는 회원 수 */
    totalNoResponse: number;
    /** 댓글 category='게스트 신청' 건수 (구조화된 승인 인원 아님 — 신청 건수만) */
    totalGuestRequests: number;
}

/**
 * 카카오톡/BAND 에 그대로 붙여넣을 수 있는 현재 참석 현황 공유 문구.
 *
 * 형식 (예):
 *   6월 23일 TEYEON 정모 참석 현황입니다.
 *
 *   시간: PM 07:00 ~ 10:00
 *   장소: SK테니스장
 *
 *   참석 8명
 *   불참 1명
 *   미응답 14명
 *   게스트 신청 2건
 *
 *   아직 응답하지 않은 회원은 TEYEON 앱에서 참석 여부를 선택해 주세요.
 *   참석 마감: 6월 23일 오전 11:00
 *
 *   아래 링크에서 현재 참석 현황을 확인할 수 있습니다.
 *   https://.../club-schedule/<id>
 *
 * - 게스트는 구조화된 인원이 아닌 댓글 신청 건수이므로 `게스트 신청 N건` 으로 고정.
 * - 회원 이름 / UUID / 이메일 / 카카오 닉네임은 절대 포함하지 않음.
 */
export function buildClubScheduleStatusShareText(
    input: ClubScheduleStatusShareInput,
    opts: { includeUrl?: boolean } = {},
): string {
    const includeUrl = opts.includeUrl !== false;
    const { schedule, totalAttending, totalNotAttending, totalNoResponse, totalGuestRequests } = input;
    const dateShort = formatScheduleDateShort(schedule.schedule_date);
    const titleLine = schedule.title?.trim()
        ? `${dateShort} ${schedule.title.trim()} 참석 현황입니다.`
        : `${dateShort} TEYEON 정모 참석 현황입니다.`;

    const lines: string[] = [titleLine, ''];

    // 시간/장소
    lines.push(...buildInfoLines(schedule));
    if (lines.length > 2) lines.push('');

    // 인원 집계 — 게스트는 신청 건수 표기 고정.
    lines.push(`참석 ${Math.max(0, totalAttending)}명`);
    lines.push(`불참 ${Math.max(0, totalNotAttending)}명`);
    lines.push(`미응답 ${Math.max(0, totalNoResponse)}명`);
    lines.push(`게스트 신청 ${Math.max(0, totalGuestRequests)}건`);

    lines.push('');
    lines.push('아직 응답하지 않은 회원은 TEYEON 앱에서 참석 여부를 선택해 주세요.');
    lines.push(...buildDeadlineLines(schedule));

    if (includeUrl) {
        const url = buildClubScheduleShareUrl(schedule.id);
        lines.push('');
        lines.push('아래 링크에서 현재 참석 현황을 확인할 수 있습니다.');
        lines.push(url);
        lines.push('');
        lines.push(getOpenInAppGuideText());
    }

    return lines.join('\n');
}

/** Web Share API용 title — 너무 길지 않게 잘라 사용. */
export function buildClubScheduleShareTitle(schedule: ClubSchedule): string {
    const dateShort = formatScheduleDateShort(schedule.schedule_date);
    const base = schedule.title?.trim() || 'TEYEON 정모';
    return `${dateShort} ${base} 참석 체크`;
}

/**
 * Clipboard API 복사 + execCommand fallback.
 * 반환: 성공 여부.
 */
export async function copyTextSafe(text: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext !== false) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // 일부 모바일 환경/insecure context에서 거절될 수 있어 fallback로.
        }
    }
    if (typeof document === 'undefined') return false;
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

/**
 * Web Share API + clipboard fallback 공통 orchestrator.
 *
 * 링크 중복 방지:
 *   - Web Share API 는 `text` + `url` 을 함께 받으면 공유 앱이 자동으로 url 을 본문 끝에 붙임.
 *     → `shareText` 에는 본문만 (URL/링크 안내 문장 제외) 전달, `url` 필드에만 정모 URL 전달.
 *   - Clipboard fallback 에는 카카오톡/BAND 에 그대로 붙여넣기 좋도록 `clipboardText`
 *     (마지막에 안내 문장 + URL 포함) 그대로 사용.
 */
async function shareOrCopyText(opts: {
    shareText: string;
    clipboardText: string;
    title: string;
    url: string;
}): Promise<{ mode: 'share' | 'copy' | 'failed' }> {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
            await navigator.share({ title: opts.title, text: opts.shareText, url: opts.url });
            return { mode: 'share' };
        } catch (err: any) {
            // 사용자가 취소(AbortError)한 경우는 실패로 취급하지 않음.
            if (err?.name === 'AbortError') return { mode: 'share' };
            // 그 외 실패는 클립보드로 fallback.
        }
    }
    const ok = await copyTextSafe(opts.clipboardText);
    return { mode: ok ? 'copy' : 'failed' };
}

/**
 * 참석 안내문 공유 — Web Share API 시도 → 실패/미지원 시 클립보드 fallback.
 * - Web Share 에는 URL/링크 안내 문장 제외한 본문만 전달 (url 필드와 중복 방지).
 * - Clipboard fallback 에는 기존처럼 마지막에 URL 포함된 전체 본문 사용.
 */
export async function shareOrCopyClubSchedule(
    schedule: ClubSchedule,
): Promise<{ mode: 'share' | 'copy' | 'failed' }> {
    const shareText      = buildClubScheduleAttendanceGuideText(schedule, { includeUrl: false });
    const clipboardText  = buildClubScheduleAttendanceGuideText(schedule, { includeUrl: true });
    const url            = buildClubScheduleShareUrl(schedule.id);
    const title          = buildClubScheduleShareTitle(schedule);

    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[ClubSchedule/share-guide]', { scheduleId: schedule.id, url });
    }
    return shareOrCopyText({ shareText, clipboardText, title, url });
}

/**
 * 현재 참석 현황 공유 — 안내문과 별도. 인원 집계는 호출자가 최신 값으로 전달.
 * - Web Share 에는 URL/링크 안내 문장 제외한 본문만 전달 (url 필드와 중복 방지).
 * - Clipboard fallback 에는 기존처럼 마지막에 URL 포함된 전체 본문 사용.
 */
export async function shareClubScheduleStatus(
    input: ClubScheduleStatusShareInput,
): Promise<{ mode: 'share' | 'copy' | 'failed' }> {
    const shareText     = buildClubScheduleStatusShareText(input, { includeUrl: false });
    const clipboardText = buildClubScheduleStatusShareText(input, { includeUrl: true });
    const url           = buildClubScheduleShareUrl(input.schedule.id);
    const dateShort     = formatScheduleDateShort(input.schedule.schedule_date);
    const base          = input.schedule.title?.trim() || 'TEYEON 정모';
    const title         = `${dateShort} ${base} 참석 현황`;

    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        // 카운트만 출력 — UUID/이름 없음. 디버깅용.
        // eslint-disable-next-line no-console
        console.log('[ClubSchedule/share-status]', {
            scheduleId: input.schedule.id,
            counts: {
                attending: input.totalAttending,
                notAttending: input.totalNotAttending,
                noResponse: input.totalNoResponse,
                guestRequests: input.totalGuestRequests,
            },
        });
    }
    return shareOrCopyText({ shareText, clipboardText, title, url });
}
