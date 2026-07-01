// KDK 정산(상금·벌금·게스트비) 계산 — 운영 중인 RankingTab.calculateSettlement 과 동일한 로직.
//
// ⚠️ 새로운 정산식이 아니다. components/RankingTab.tsx 의 calculateSettlement /
//    isGuestRankedPlayer / isAssociateGuestFeeMember 를 그대로 옮긴 것이며,
//    공식 기록 확정 시점에 "그때의 정산 결과"를 Archive 스냅샷으로 박제하는 데 쓴다.
//    규칙/금액 기준이 바뀌어도 과거 스냅샷은 변하지 않는다(Archive 가 source of truth).
//
//    RankingTab 과 값이 어긋나면 안 된다 — 둘 중 하나를 고치면 반드시 함께 맞춘다.

export interface SettlementPrizes {
    first: number; // 1등 상금
    l1: number;    // 하위 25~50% 벌금 (지각/L1)
    l2: number;    // 하위 25% 벌금 (L2)
}

/**
 * @deprecated 게스트비 임의 기본값. 더 이상 정산 fallback 으로 쓰지 않는다.
 * 게스트비는 세션 단일 출처(kdk_session_meta.guest_fee)에서만 온다. 신규 코드에서 사용 금지.
 */
export const KDK_GUEST_FEE = 10000;

// 준회원이지만 매 세션 게스트비를 부담하는 whitelist (현재 운영 규칙 그대로).
const ASSOCIATE_GUEST_FEE_NAMES: ReadonlySet<string> = new Set(['차형원']);

export function isGuestRankedPlayer(player: any): boolean {
    const id = String(player?.id || '');
    const name = String(player?.name || '');
    return player?.is_guest === true
        || player?.isGuest === true
        || /^manual-guest-/i.test(id)
        || /^g-/i.test(id)
        || /^manual-guest-/i.test(name)
        || /\s*\(G\)$/i.test(name)
        || /\s+g$/i.test(name);
}

export function isAssociateGuestFeeMember(player: any): boolean {
    const candidates = [player?.name, player?.nickname, player?.displayName]
        .map((v) => String(v || '').replace(/\s*\(G\)$/i, '').replace(/\s+g$/i, '').replace(/\s+/g, '').trim())
        .filter((v) => v.length > 0);
    return candidates.some((c) => ASSOCIATE_GUEST_FEE_NAMES.has(c));
}

export interface SettlementBreakdown {
    prizeAmount: number;     // 상금 (양수 / 0)
    penaltyAmount: number;   // 벌금 (음수 / 0)
    guestFeeAmount: number;  // 게스트비 (음수 / 0)
    finalAmount: number;     // 최종 = prize + penalty + guestFee
    penaltyLevel: 'L1' | 'L2' | null;
    isPenaltyTier: boolean;
    isFineTier: boolean;
    isGuest: boolean;
    owesGuestFee: boolean;
}

/**
 * idx = 전체 순위에서의 0-based 인덱스, total = 전체 인원.
 * RankingTab.calculateSettlement 과 동일한 tier 판정 / 금액 산식.
 */
export function computeSettlement(
    player: any,
    idx: number,
    total: number,
    prizes: SettlementPrizes,
    // 게스트비는 호출부에서 세션 단일 출처(kdk_session_meta.guest_fee) 값을 명시적으로 전달한다.
    // 임의 기본값(10,000) fabrication 을 막기 위해 필수 인자로 둔다(0 은 유효, null 은 호출 전 차단).
    guestFee: number,
): SettlementBreakdown {
    const bottomHalfCount = Math.ceil(total / 2);
    const penaltyCount = Math.ceil(bottomHalfCount / 2);
    const isPenaltyTier = idx >= (total - penaltyCount);
    const isFineTier = !isPenaltyTier && idx >= (total - bottomHalfCount);
    const isGuest = isGuestRankedPlayer(player);
    const owesGuestFee = isGuest || isAssociateGuestFeeMember(player);

    let prizeAmount = 0;
    let penaltyAmount = 0;
    if (idx === 0 && !isGuest) {
        prizeAmount = prizes.first || 10000;
    } else if (isPenaltyTier) {
        penaltyAmount = -(prizes.l2 || 5000);
    } else if (isFineTier) {
        penaltyAmount = -(prizes.l1 || 3000);
    }

    const guestFeeAmount = owesGuestFee ? -guestFee : 0;
    const finalAmount = prizeAmount + penaltyAmount + guestFeeAmount;
    const penaltyLevel: 'L1' | 'L2' | null = isPenaltyTier ? 'L2' : isFineTier ? 'L1' : null;

    return {
        prizeAmount,
        penaltyAmount,
        guestFeeAmount,
        finalAmount,
        penaltyLevel,
        isPenaltyTier,
        isFineTier,
        isGuest,
        owesGuestFee,
    };
}

// Archive raw_data.settlement_data 각 항목 스키마.
export interface SettlementSnapshotEntry {
    player_id: string | null;
    player_name: string;
    is_guest: boolean;
    is_associate_guest_fee_member: boolean;
    rank: number;
    wins: number;
    losses: number;
    points_for: number;
    points_against: number;
    diff: number;
    penalty_level: 'L1' | 'L2' | null;
    penalty_amount: number;
    guest_fee_amount: number;
    prize_amount: number;
    final_amount: number;
}
