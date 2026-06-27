// Guide & Recording — 개인정보 마스킹 helper (렌더링 전용).
//   원칙: DB 값을 변경하지 않는다. 촬영 화면에서 표시될 때만 가린다.
//   촬영 모드가 아닐 때는 호출부에서 원본을 그대로 쓰면 된다(이 helper 는 "가리는" 동작만 담당).

export const HIDDEN_LABEL = '촬영 모드에서 숨겨진 정보';

const onlyDigits = (s: string): string => s.replace(/\D/g, '');

/** 010-1234-5678 → 010-****-5678 (마지막 4자리만 노출). */
export function maskPhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const d = onlyDigits(phone);
    if (d.length < 4) return '***';
    const last4 = d.slice(-4);
    const first = d.length >= 10 ? d.slice(0, 3) : d.slice(0, Math.max(0, d.length - 4));
    return `${first}-****-${last4}`;
}

/** sample@example.com → s***@example.com */
export function maskEmail(email: string | null | undefined): string {
    if (!email) return '';
    const at = email.indexOf('@');
    if (at <= 0) return '***';
    const name = email.slice(0, at);
    const domain = email.slice(at + 1);
    const head = name.charAt(0);
    return `${head}***@${domain}`;
}

/** 123-456-789012 → ***-***-9012 (마지막 4자리만 노출). */
export function maskAccountNumber(account: string | null | undefined): string {
    if (!account) return '';
    const d = onlyDigits(account);
    if (d.length < 4) return '***-***-****';
    return `***-***-${d.slice(-4)}`;
}

export type NameMaskMode = 'keep' | 'initial' | 'full';
/**
 * 이름 마스킹. 모든 화면에서 무조건 가리지 않는다(촬영 목적/화면 특성에 따름).
 *   keep    : 그대로(일반 멤버 이름).
 *   initial : 첫 글자 + ○ (민감 운영 대상자/미납자/게스트 신청자).
 *   full    : 전부 ○ (테스트 이름 수준).
 */
export function maskPersonName(name: string | null | undefined, mode: NameMaskMode = 'initial'): string {
    if (!name) return '';
    const trimmed = name.trim();
    if (mode === 'keep') return trimmed;
    if (mode === 'full') return '○'.repeat(Math.max(2, [...trimmed].length));
    const chars = [...trimmed];
    if (chars.length <= 1) return chars[0] || '○';
    return chars[0] + '○'.repeat(chars.length - 1);
}

/** 예금주 등 짧은 텍스트 — initial 모드와 동일하게 가린다. */
export function maskName(name: string | null | undefined): string {
    return maskPersonName(name, 'initial');
}

/** 운영진 메모/내부 메모/토큰/UUID/상세 오류 등 — 통째로 가린다. */
export function maskPrivateText(): string {
    return HIDDEN_LABEL;
}

/** 토큰/UUID 등 식별자 — 앞 4자리만 노출 후 가림(길면). */
export function maskToken(token: string | null | undefined): string {
    if (!token) return '';
    if (token.length <= 6) return '••••';
    return `${token.slice(0, 4)}••••`;
}
