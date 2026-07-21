
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
    /** 4자리 출생연도 — 공식 동률(연소자 우위) 계산 전용. 공개 화면 비노출. 신규 저장은 이 필드 사용. */
    birthYear?: number | null;
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
}

export type UserRole = 'CEO' | 'ADMIN' | 'MEMBER' | 'GUEST';
export type KDKConcept = 'RANDOM' | 'MBTI' | 'AWARD' | 'AGE';
