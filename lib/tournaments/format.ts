// 공개 Tournament 화면 표기 helper. 숫자/금액만 다루며 정책 판단은 하지 않는다.

/** 40000 → '40,000원' */
export function won(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`;
}

/** 40000 → '40,000' (단위를 따로 붙일 때) */
export function wonNumber(amount: number): string {
  return amount.toLocaleString('ko-KR');
}

/**
 * 접수 진행률(0~1). target 기준이며 1을 넘지 않는다.
 *   ⚠️ 화면 표시 전용. 정원 판정은 서버 RPC 가 단독으로 한다(클라이언트 count 판정 금지).
 */
export function registrationProgress(applied: number, target: number): number {
  if (!Number.isFinite(applied) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(1, applied / target));
}
