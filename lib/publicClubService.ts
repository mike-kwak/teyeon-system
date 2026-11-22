// /club 공개 둘러보기에서 사용하는 service.
// ─ 원본 테이블 직접 SELECT 하지 않는다 (anon RLS 가 인증 회원만 허용).
// ─ Supabase RPC `get_public_*` 만 호출. 모든 RPC 는 공개 가능 필드만 jsonb 로 반환.
// ─ created_by / updated_by / 내부 메모 / 미확정 기록 / 개인정보 (이메일/전화) 미포함.

import { supabase } from './supabase';

const TEYEON_INSTAGRAM_URL = 'https://www.instagram.com/team_teyeon/';

/** 공개 인스타그램 URL — null 이면 버튼 숨김. 외부 공유 추적 쿼리(igsh 등) 저장 안 함. */
export function getTeyeonInstagramUrl(): string {
    return TEYEON_INSTAGRAM_URL;
}

// ── 일정 (Club Schedule) ────────────────────────────────────────────────────

export type PublicClubScheduleType = '정모' | '번개' | '단체전 연습' | '회식' | '기타';

export interface PublicClubSchedule {
    id: string;
    title: string;
    type: PublicClubScheduleType;
    date: string;                 // 'YYYY-MM-DD'
    startTime: string | null;     // 'HH:MM'
    endTime: string | null;
    location: string | null;
    courtCount: number | null;
    courtMode: string | null;
    isPast: boolean;
}

export async function fetchPublicClubSchedules(opts?: {
    pastDays?: number;
    futureDays?: number;
}): Promise<PublicClubSchedule[]> {
    const { data, error } = await supabase.rpc('get_public_club_schedules', {
        p_window_past_days: opts?.pastDays ?? 14,
        p_window_future_days: opts?.futureDays ?? 60,
    });
    if (error) {
        console.warn('[publicClub/schedules]', error?.message ?? error);
        return [];
    }
    return Array.isArray(data) ? (data as PublicClubSchedule[]) : [];
}

// ── 멤버 디렉토리 ──────────────────────────────────────────────────────────
// ⚠️ 내부 members.id 는 브라우저에 노출하지 않는다 (외부 둘러보기는 ID 의미 없음).

export interface PublicMember {
    nickname: string;
    avatarUrl: string | null;
    role: string | null;
}

export async function fetchPublicMembers(): Promise<PublicMember[]> {
    const { data, error } = await supabase.rpc('get_public_member_directory');
    if (error) {
        console.warn('[publicClub/members]', error?.message ?? error);
        return [];
    }
    return Array.isArray(data) ? (data as PublicMember[]) : [];
}

// ── KDK 세션 ──────────────────────────────────────────────────────────────

export type PublicKdkSessionState = 'preparing' | 'ready' | 'in_progress' | 'settling' | 'finished';

export interface PublicKdkSessionListItem {
    sessionId: string;
    title: string;
    createdAt: string;
    isOfficial: boolean;
    state: PublicKdkSessionState;
}

export async function fetchPublicKdkSessions(limit = 30): Promise<PublicKdkSessionListItem[]> {
    const { data, error } = await supabase.rpc('get_public_kdk_sessions', { p_limit: limit });
    if (error) {
        console.warn('[publicClub/kdk-list]', error?.message ?? error);
        return [];
    }
    return Array.isArray(data) ? (data as PublicKdkSessionListItem[]) : [];
}

/** 대진표 / 진행 중 / 대기 매치의 공개 표현. raw player_ids / 내부 ID 미포함. */
export interface PublicMatchRow {
    matchNo?: number;
    round?: number | null;
    court?: number | null;
    group?: string | null;
    playerNames: string[];
    /** 'waiting' | 'playing' | 'complete' */
    status?: string;
    /** 진행 중 매치에서만. */
    score1?: number | null;
    score2?: number | null;
}

/** in_progress 순위 항목 — name + 집계만. */
export interface PublicRankingRow {
    rank: number;
    name: string;
    wins: number;
    losses: number;
    pointsFor: number;
    pointsAgainst: number;
}

/** finished 공식 순위 항목 — 내부 player/member ID 없이 확정 집계만. */
export interface PublicFinalRankingRow {
    rank: number;
    name: string;
    group: string | null;
    wins: number;
    losses: number;
    diff: number;
}

/** finished 게스트 정산(공개용) — 금액은 양수 납부액. 내부 ID/Finance 상세 미포함. */
export interface PublicGuestSettlement {
    name: string;            // '이름(G)'
    guestFeeAmount: number;  // 게스트 기본 납부액 (양수)
    penaltyAmount: number;   // 벌금 (양수, 없으면 0)
    totalAmount: number;     // 최종 납부액 (양수)
    penaltyLabel: string | null; // 'L1' | 'L2' | null
}

/** finished 계좌(공개용) — Guest Pass 계좌 공개 ON 일 때만. 마스킹 표시명만. */
export interface PublicKdkAccount {
    bankName: string;
    accountNumber: string;
    accountHolder: string;
}

export interface PublicKdkSessionDetail {
    sessionId: string;
    title: string;
    state: PublicKdkSessionState;
    isOfficial: boolean;
    createdAt?: string;
    confirmedAt?: string | null;
    /** finished: 공식 확정 순위. 내부 player/member ID 미포함. */
    finalRanking?: PublicFinalRankingRow[];
    /** finished: 공식 확정 경기 결과. playerNames 와 점수만 포함. */
    matches?: PublicMatchRow[];
    /** finished: 게스트별 정산(공개용). 정산 스냅샷이 있을 때만 채워짐. */
    guestSettlements?: PublicGuestSettlement[];
    /** finished: 게스트 납부 합계. */
    guestSettlementTotal?: number;
    /** finished: 정산 스냅샷이 없어 금액 확정 불가 → true 면 "운영진 정산 확인 중". */
    guestSettlementPending?: boolean;
    /** finished: 연결된 Guest Pass 계좌 공개 ON 일 때만. 아니면 null. */
    account?: PublicKdkAccount | null;
    /** ready: 전체 대진표 (matchNo / round / court / group / playerNames / status). */
    bracket?: PublicMatchRow[];
    /** in_progress: 코트별 현재 경기. */
    nowPlaying?: PublicMatchRow[];
    /** in_progress: 대기 매치 목록. */
    waiting?: PublicMatchRow[];
    /** in_progress: 공개 가능한 실시간 순위 (완료 매치 기준 집계, 상위 16). */
    ranking?: PublicRankingRow[];
    /** in_progress / ready / settling 시 라이브 카운트. */
    liveCounts?: {
        total: number;
        playing: number;
        waiting: number;
        complete: number;
    };
}

export async function fetchPublicKdkSession(sessionId: string): Promise<PublicKdkSessionDetail | null> {
    if (!sessionId) return null;
    const { data, error } = await supabase.rpc('get_public_kdk_session', { p_session_id: sessionId });
    if (error) {
        console.warn('[publicClub/kdk-detail]', error?.message ?? error);
        return null;
    }
    if (!data) return null;
    return withOfficialLiveRanking(data as PublicKdkSessionDetail);
}

/** get_kdk_live_official_ranking 응답 행(공개 전광판과 같은 공식 순위 · 내부 ID/출생연도 미포함). */
interface OfficialLiveRankingRow { name: string; wins: number; losses: number; pf: number; pa: number; rank: number }

/**
 * in_progress 순위를 공식 기준으로 맞춘다.
 *   get_public_kdk_session 의 진행 중 순위는 이름 기준 집계 + (승수 · 득실 · 득점) 정렬이라
 *   공식 규칙(승수 → 득실 → 연장자 → 이름 · id)과 동률 처리 순서가 다를 수 있다.
 *   → 이미 anon 에 공개된 공식 RPC get_kdk_live_official_ranking(전광판 RANKING TOWER 와 같은 source)으로 교체한다.
 *   새 공개 권한 없음. 실패하거나 빈 응답이면 기존 순위를 그대로 둔다(화면 무변화).
 */
export async function withOfficialLiveRanking(detail: PublicKdkSessionDetail): Promise<PublicKdkSessionDetail> {
    if (detail.state !== 'in_progress' || !detail.sessionId) return detail;
    try {
        const { data, error } = await supabase.rpc('get_kdk_live_official_ranking', { p_session_id: detail.sessionId });
        if (error || !Array.isArray(data) || data.length === 0) return detail;
        const ranking: PublicRankingRow[] = (data as OfficialLiveRankingRow[])
            .filter((r) => r && typeof r.name === 'string' && Number.isFinite(Number(r.rank)))
            .sort((a, b) => Number(a.rank) - Number(b.rank))
            .slice(0, 16)
            .map((r) => ({
                rank: Number(r.rank),
                name: r.name,
                wins: Number(r.wins) || 0,
                losses: Number(r.losses) || 0,
                pointsFor: Number(r.pf) || 0,
                pointsAgainst: Number(r.pa) || 0,
            }));
        return ranking.length ? { ...detail, ranking } : detail;
    } catch {
        return detail;
    }
}

/** Guest Pass 정모 → 연결된 KDK 세션 상태. 없으면 null. */
export async function fetchScheduleKdkState(scheduleId: string): Promise<PublicKdkSessionDetail | null> {
    if (!scheduleId) return null;
    const { data, error } = await supabase.rpc('get_public_schedule_kdk_state', { p_schedule_id: scheduleId });
    if (error) {
        console.warn('[publicClub/schedule-kdk-state]', error?.message ?? error);
        return null;
    }
    if (!data) return null;
    return data as PublicKdkSessionDetail;
}

/**
 * Guest Pass token → 연결된 KDK 세션 상태. token 만 알면 호출 가능 (schedule_id 노출 안 함).
 * 카드의 'KDK 경기 안내' 영역 자동 전환에 사용.
 */
export async function fetchGuestPassKdkState(token: string): Promise<PublicKdkSessionDetail | null> {
    if (!token) return null;
    const { data, error } = await supabase.rpc('get_public_guest_pass_kdk_state', { p_token: token });
    if (error) {
        console.warn('[publicClub/guest-pass-kdk-state]', error?.message ?? error);
        return null;
    }
    if (!data) return null;
    return data as PublicKdkSessionDetail;
}

// ── 스페셜 매치 ───────────────────────────────────────────────────────────

export interface PublicSpecialSession {
    sessionId: string;
    title: string;
    updatedAt: string;
}

export async function fetchPublicSpecialSessions(limit = 20): Promise<PublicSpecialSession[]> {
    const { data, error } = await supabase.rpc('get_public_special_sessions', { p_limit: limit });
    if (error) {
        console.warn('[publicClub/special]', error?.message ?? error);
        return [];
    }
    return Array.isArray(data) ? (data as PublicSpecialSession[]) : [];
}
