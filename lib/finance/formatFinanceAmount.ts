// 금액 표시 공통 helper.
// - 모든 화면에서 동일한 KRW 표기 사용 (₩ 또는 '원' 접미사).
// - 0, 음수, NaN 안전 처리.
// - 금액 줄바꿈 방지를 위해 호출자는 white-space: nowrap 유지 권장.

/**
 * 일반 금액 표시. 1000 단위 구분자 + '원' 접미사.
 * 음수는 '-' 접두사. 0 / NaN 은 '0원'.
 */
export function formatWon(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return '0원';
    const v = Math.trunc(value);
    if (v === 0) return '0원';
    const sign = v < 0 ? '-' : '';
    return `${sign}${Math.abs(v).toLocaleString('ko-KR')}원`;
}

/** ₩ prefix 변형 — 디자인 시안 통일용. */
export function formatWonSymbol(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) return '₩0';
    const v = Math.trunc(value);
    if (v === 0) return '₩0';
    const sign = v < 0 ? '-' : '';
    return `${sign}₩${Math.abs(v).toLocaleString('ko-KR')}`;
}

/** 입력 검증 — 양의 정수만 허용. */
export function isValidPaymentAmount(value: unknown): value is number {
    if (typeof value !== 'number' || Number.isNaN(value)) return false;
    if (!Number.isFinite(value)) return false;
    return value > 0 && Math.trunc(value) === value;
}
