import type { BirthYearStatus } from '@/lib/kdk/officialRanking';

export type { BirthYearStatus };

export interface Member {
    id: string;
    nickname: string;
    role?: string;
    position?: string;
    is_guest?: boolean;
    avatar_url?: string;
    age?: number;
    mbti?: string;
    achievements?: string;
}

export type AttendeeConfig = {
    id: string;
    name: string;
    is_guest?: boolean;
    group: 'A' | 'B';
    startTime: string;
    endTime: string;
    isLate?: boolean;
    /** 레거시 — 과거 세션 호환용. 4자리 연도 값일 때만 순위 계산에 인정(만 나이 숫자는 무시). */
    age?: number;
    /** 4자리 출생연도 — 공식 동률(연장자 우위) 계산 전용. 공개 화면 비노출. 신규 저장은 이 필드 사용. */
    birthYear?: number | null;
    /**
     * 출생연도 확보 상태 — 개인정보가 아닌 운영 상태값.
     * 'declined' = 운영자가 공식 확정 화면에서 '생년 미입력으로 진행'을 승인함(완전 동률 후순위 감수).
     * 미기재 = 아직 처리하지 않음. 순위 계산에는 쓰이지 않는다(차단 해제 판단 전용).
     */
    birthYearStatus?: BirthYearStatus;
    isWinner?: boolean;
};

export interface Match {
    id: string;
    playerIds: string[];
    playerNames?: string[]; // Server-side mapping for guests & spectators
    player_names?: string[]; // Legacy server-side mapping
    court: number | null;
    status: 'waiting' | 'playing' | 'complete';
    score1?: number;
    score2?: number;
    mode: string;
    round?: number;
    teams?: [string[], string[]];
    groupName?: string;
    group?: string; // Legacy/Special Match group
    /** KDK 경기 타이머 시작 시각(DB matches.started_at, server now()). null/미설정 = 시작 대기. */
    startedAt?: string | null;
}

export type RankTrend = 'up' | 'down' | 'same';

export interface RankedPlayer {
    id: string;
    name: string;
    is_guest?: boolean;
    avatar?: string;
    group: string;
    age: number;
    wins: number;
    losses: number;
    diff: number;
    games?: number;
    pf: number;
    pa: number;
    trend?: RankTrend;
    /** 공식 comparator 입력용 stable id(= id). useRanking 이 함께 채운다. */
    playerId?: string;
    /** 4자리 출생연도(정규화 완료) — 공식 동률 계산 전용, 공개 비노출. */
    birthYear?: number | null;
    /** 출생연도 확보 상태 — 확정 차단 해제 판단 전용(순위 비교에는 미사용). */
    birthYearStatus?: BirthYearStatus;
}

export type UserRole = 'CEO' | 'ADMIN' | 'MEMBER' | 'GUEST';
export type KDKConcept = 'RANDOM' | 'MBTI' | 'AWARD' | 'AGE';
