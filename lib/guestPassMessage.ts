// Guest Pass 카카오톡 안내문 빌더 + 공유/복사 헬퍼.
//
// 포맷 규칙 (운영진 결정):
//   - 이모지는 날짜/시간/장소 라인에만 제한적으로 사용
//   - 대진표는 Guest Pass 링크에서 당일 공개된다고 명시
//   - 게스트비/규칙/링크 순서 고정
//
// 모든 텍스트는 사용자 입력값 그대로 사용. HTML escape 불필요 (plain text).

import type { GuestPassData } from './guestPassData';

/** 'YYYY-MM-DD' → 'YYYY년 M월 D일 (요일)' */
function formatDateKo(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    if (!y) return date;
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${y}년 ${m}월 ${d}일 (${days[dt.getDay()]})`;
}

/** 'HH:MM' 또는 'HH:MM:SS' → 'HH:MM'. */
function trimSeconds(t?: string): string {
    return t ? t.slice(0, 5) : '';
}

/**
 * 게스트비 표기 — KDK 세션 단일 출처 상태 기준.
 * confirmed(0 포함)만 실제 금액(0→무료), 그 외에는 안내 문구(임의 금액 노출 금지).
 */
function formatGuestFeeKo(fee: GuestPassData['fee']): string {
    const status = fee.guestFeeStatus ?? 'unlinked';
    if (status === 'confirmed' && typeof fee.guestFee === 'number') {
        return fee.guestFee > 0 ? `${fee.guestFee.toLocaleString()}원` : '무료';
    }
    if (status === 'unset') return '미설정 (KDK 설정에서 입력 예정)';
    if (status === 'conflict') return '연결 확인 필요';
    return '추후 안내';
}

export interface BuildKakaoMessageOpts {
    data: GuestPassData;
    /** 공개 페이지 절대 URL — e.g. 'https://teyeon.app/guest/pass/Ab3Kp91XzQ' */
    guestPassUrl: string;
}

/**
 * 카카오톡 단톡방/1:1 채팅에 그대로 붙여넣을 안내문.
 * 운영진이 [복사] 버튼으로 클립보드에 담은 뒤 채팅창에 paste 하는 흐름.
 */
export function buildKakaoMessage({ data, guestPassUrl }: BuildKakaoMessageOpts): string {
    const lines: string[] = [];
    lines.push('[TEYEON 게스트 안내]');
    lines.push('');
    lines.push(`일정: ${data.schedule.title}`);
    lines.push(`📅 날짜: ${formatDateKo(data.schedule.date)}`);

    const start = trimSeconds(data.schedule.startTime);
    const end = trimSeconds(data.schedule.endTime);
    if (start && end) {
        lines.push(`⏰ 시간: ${start} ~ ${end}`);
    } else if (start) {
        lines.push(`⏰ 시간: ${start} 시작`);
    } else if (end) {
        lines.push(`⏰ 시간: ~ ${end}`);
    }

    if (data.schedule.location) {
        lines.push(`📍 장소: ${data.schedule.location}`);
    }
    lines.push(`게스트비: ${formatGuestFeeKo(data.fee)}`);
    lines.push('');

    // 규칙 — defaults에 입력된 항목만 자연 문장으로 나열.
    // (UI guestNote 와 동일 소스. 빈 항목은 자동 생략.)
    const noteTexts = data.guestNote.map((n) => n.text).filter(Boolean);
    if (noteTexts.length > 0) {
        for (const t of noteTexts) lines.push(t);
        lines.push('');
    }

    lines.push('자세한 안내와 당일 대진표는 아래 링크에서 확인해주세요.');
    lines.push('');
    lines.push(guestPassUrl);

    return lines.join('\n');
}

/**
 * 공개 페이지 절대 URL 생성. 호출자(브라우저) location.origin 기준.
 * 토큰이 없으면 빈 문자열 반환 — 호출자가 분기.
 */
export function buildGuestPassUrl(opts: { token: string | null; origin?: string }): string {
    if (!opts.token) return '';
    const origin = opts.origin
        ?? (typeof window !== 'undefined' ? window.location.origin : '');
    return `${origin}/guest/pass/${opts.token}`;
}

// ── 공유/복사 헬퍼 ──────────────────────────────────────────────────────────

export type ShareOrCopyResult =
    | { mode: 'share' }
    | { mode: 'copy' }
    | { mode: 'failed'; reason?: string };

/**
 * Web Share API 우선, 실패/미지원 시 클립보드 복사. clubScheduleShare.ts 와 동일 패턴.
 */
export async function shareOrCopyText(opts: {
    title?: string;
    text: string;
    url?: string;
}): Promise<ShareOrCopyResult> {
    try {
        if (typeof navigator !== 'undefined' && typeof (navigator as any).share === 'function') {
            try {
                await (navigator as any).share({
                    title: opts.title,
                    text: opts.text,
                    url: opts.url,
                });
                return { mode: 'share' };
            } catch (e: any) {
                // 사용자가 share 시트를 닫은 경우(AbortError)는 실패로 처리하지 않음.
                if (e?.name === 'AbortError') return { mode: 'failed', reason: 'aborted' };
                // 그 외는 클립보드로 폴백.
            }
        }
        const toCopy = opts.url ? `${opts.text}\n${opts.url}` : opts.text;
        await copyText(toCopy);
        return { mode: 'copy' };
    } catch (e: any) {
        return { mode: 'failed', reason: e?.message ?? 'unknown' };
    }
}

export async function copyText(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return;
    }
    // 비-https 폴백
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}
