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

/**
 * 카카오톡/BAND에 그대로 붙여넣을 수 있는 참석 체크 안내문.
 * 회원 개인정보(이름/연락처/이메일/UUID 등)는 포함하지 않는다.
 */
export function buildClubScheduleShareText(schedule: ClubSchedule): string {
    const url = buildClubScheduleShareUrl(schedule.id);
    const dateShort = formatScheduleDateShort(schedule.schedule_date);
    const titleLine = schedule.title?.trim()
        ? `${dateShort} ${schedule.title.trim()} 참석 체크 부탁드립니다.`
        : `${dateShort} TEYEON 정모 참석 체크 부탁드립니다.`;

    const lines: string[] = [titleLine, ''];

    const timeRange = formatTimeRangeAmPm(schedule.start_time, schedule.end_time);
    if (timeRange) lines.push(`시간: ${timeRange}`);
    if (schedule.location) lines.push(`장소: ${schedule.location}`);
    const deadlineText = formatDeadlineForShare(schedule.attendance_deadline ?? null);
    if (deadlineText) lines.push(`참석 마감: ${deadlineText}`);

    lines.push('');
    lines.push('TEYEON 앱 로그인 후 아래 링크에서 참석 시간을 선택해 주세요.');
    lines.push(url);

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
 * Web Share API 시도 → 실패/미지원 시 클립보드 fallback.
 * 반환: { mode: 'share' | 'copy' | 'failed' }
 */
export async function shareOrCopyClubSchedule(
    schedule: ClubSchedule,
): Promise<{ mode: 'share' | 'copy' | 'failed' }> {
    const text = buildClubScheduleShareText(schedule);
    const url = buildClubScheduleShareUrl(schedule.id);
    const title = buildClubScheduleShareTitle(schedule);

    // 개발 환경에서만 share URL과 schedule id를 한 번 출력 — 디버깅용. 민감 정보 없음.
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[ClubSchedule/share]', { scheduleId: schedule.id, url });
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
            await navigator.share({ title, text, url });
            return { mode: 'share' };
        } catch (err: any) {
            // 사용자가 취소(AbortError)한 경우는 실패로 취급하지 않음 — 그대로 종료.
            if (err?.name === 'AbortError') return { mode: 'share' };
            // 그 외 실패는 클립보드로 fallback.
        }
    }
    const ok = await copyTextSafe(text);
    return { mode: ok ? 'copy' : 'failed' };
}
