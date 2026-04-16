
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
    age?: number;
    isWinner?: boolean;
};

export interface Match {
    id: string;
    playerIds: string[];
    court: number | null;
    status: 'waiting' | 'playing' | 'complete';
    score1?: number;
    score2?: number;
    mode: string;
    round?: number;
    teams?: [string[], string[]];
    groupName?: string;
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
    games: number;
    pf: number;
    pa: number;
    trend: RankTrend;
}

export type UserRole = 'CEO' | 'Staff' | 'Member' | 'Guest';
export type KDKConcept = 'RANDOM' | 'MBTI' | 'AWARD' | 'AGE';
