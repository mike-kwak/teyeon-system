// 예선 조별리그 표시 규칙 — Admin · Public 공용(순수 함수).
//
//   ⚠⚠ 순위 · 진출 · 동률을 계산하지 않는다.
//     rank · qualificationStatus · rankingStatus 는 서버(standings 계산 코어)가 준 값을 그대로 쓴다.
//     여기서 하는 일은 서버 값으로 '무엇을 어떤 모양으로 보여줄지'를 고르는 것뿐이다.
//   ⚠ Admin 전용 판단(운영 경고 · 액션)과 Public 전용 문구는 각 래퍼가 가진다. 여기에 두지 않는다.

import {
  formatGameDiff, type GroupRankingStatus, type QualificationStatus,
} from '@/lib/tournaments/standingsTypes';

// ── 색 (Cool Premium Light) ─────────────────────────────────────────────────
export const C = {
  navy: '#0F172A',
  body: '#334155',
  muted: '#64748B',
  faint: '#94A3B8',
  line: '#E2E8F0',
  lineSoft: '#EEF2F6',
  surface: '#F8FAFC',
  teal: '#0E8C80',
  tealText: '#0B7A70',
  tealTint: '#E6F4F2',
  green: '#1F7A4D',
  slate: '#5B6B8C',
  amber: '#A15C00',
  amberDot: '#E0A43A',
  amberTint: '#FFF8E8',
  amberLine: '#F1D8A2',
  red: '#B42318',
} as const;

// ── 입력 최소 모양 — Admin(GroupStandings) · Public(PublicDrawGroup) 둘 다 만족한다 ──
export interface PhaseInput {
  rankingStatus: GroupRankingStatus;
  completedMatches: number;
  cancelledMatches: number;
}
export interface ProgressInput extends PhaseInput {
  generatedMatches: number;
  expectedMatches: number;
}
export interface RowInput {
  played: number;
  wins: number;
  losses: number;
  gameDiff: number;
  rank: number | null;
  qualificationStatus: QualificationStatus;
}
export interface TeamNameInput {
  teamNo: number;
  player1Name: string;
  player2Name: string;
}

// ── 조 표시 단계 ────────────────────────────────────────────────────────────
//   서버는 경기 전에도 tieGroups 를 준다(승률이 전부 null → 전원 1위 동률).
//   행동이 필요한 동률은 rankingStatus = AGE_CHECK_REQUIRED(조 경기 전부 완료 + 미해결 동률) 하나뿐이다.
export type GroupPhase = 'NOT_STARTED' | 'IN_PROGRESS' | 'AGE_CHECK' | 'FINAL';

export const phaseOf = (g: PhaseInput): GroupPhase =>
  g.rankingStatus === 'FINAL' ? 'FINAL'
    : g.rankingStatus === 'AGE_CHECK_REQUIRED' ? 'AGE_CHECK'
    : g.completedMatches === 0 && g.cancelledMatches === 0 ? 'NOT_STARTED'
    : 'IN_PROGRESS';

/** 순위·진출 배지를 보여도 되는 단계 — 조 경기가 모두 끝난 뒤. */
export const isSettled = (p: GroupPhase): boolean => p === 'FINAL' || p === 'AGE_CHECK';

export type GroupFilter = 'all' | 'live' | 'pre' | 'done';

// ── 표시 단계(라벨 · 필터 전용) ─────────────────────────────────────────────
//   ⚠ 서버 rankingStatus · 경기 status 를 바꾸지 않는다. 화면에 '경기 전 / 진행 중 / 완료' 중
//     무엇으로 보일지만 정한다. 완료 경기가 0건이어도 호명 · 진행 중 · 취소된 경기가 있으면
//     이미 시작된 조이므로 '진행 중'으로 보인다('경기 전'과 충돌 방지).
const STARTED_MATCH_STATUS = new Set(['calling', 'playing', 'completed', 'cancelled']);

/** 조 경기 중 하나라도 시작됐는가(대기 외 상태). */
export const anyMatchStarted = (statuses: readonly string[]): boolean =>
  statuses.some((st) => STARTED_MATCH_STATUS.has(st));

export type DisplayStage = Exclude<GroupFilter, 'all'>;

export const displayStageOf = (g: PhaseInput, started = false): DisplayStage => {
  const p = phaseOf(g);
  return isSettled(p) ? 'done' : p === 'NOT_STARTED' && !started ? 'pre' : 'live';
};

export const filterOf = (g: PhaseInput, started = false): DisplayStage => displayStageOf(g, started);

export const FILTER_LABEL: Record<GroupFilter, string> = {
  all: '전체', live: '진행 중', pre: '경기 전', done: '완료',
};
export const FILTERS: GroupFilter[] = ['all', 'live', 'pre', 'done'];

/** 경기 진행 칸 — 완료 teal · 취소 amber · 나머지 회색. 순서는 의미 없다(개수만). */
export function progressSegments(g: ProgressInput): string[] {
  const total = g.generatedMatches || g.expectedMatches;
  return Array.from({ length: total }, (_, i) =>
    i < g.completedMatches ? C.teal
      : i < g.completedMatches + g.cancelledMatches ? C.amberDot
      : C.line);
}

export const progressText = (g: ProgressInput): string =>
  `${g.completedMatches} / ${g.generatedMatches || g.expectedMatches}`;

// ── 팀 행 ───────────────────────────────────────────────────────────────────

export interface Tone { bg: string; fg: string; bd: string }

/** 순위 칸 글자. 서버 rank 가 null(미해결 동률)이거나 아직 경기가 없으면 '–'. */
export const rankText = (r: Pick<RowInput, 'played' | 'rank'>): string =>
  r.played === 0 || r.rank === null ? '–' : String(r.rank);

/** 순위 칸 색. 진출 여부는 서버 qualificationStatus 를 그대로 따른다(완료 단계에서만). */
export function rankTone(r: Pick<RowInput, 'played' | 'rank' | 'qualificationStatus'>, phase: GroupPhase): Tone {
  const settled = isSettled(phase);
  if (settled && r.qualificationStatus === 'QUALIFIED') return { bg: C.teal, fg: '#FFFFFF', bd: C.teal };
  if (rankText(r) === '–' || (settled && r.qualificationStatus === 'NOT_QUALIFIED')) {
    return { bg: '#F1F4F8', fg: C.muted, bd: '#F1F4F8' };
  }
  return { bg: '#FFFFFF', fg: C.navy, bd: '#D5DCE6' };
}

export const recordText = (r: Pick<RowInput, 'played' | 'wins' | 'losses'>): string =>
  r.played === 0 ? '경기 전' : `${r.wins}승 ${r.losses}패`;

/**
 * 득실 표시 — 서버 gameDiff 그대로(+7 / 0 / -7). ⚠ gamesFor - gamesAgainst 로 다시 계산하지 않는다.
 * 완료 경기가 없는 팀은 null(0 을 만들어 보여주지 않는다).
 */
export function gameDiffView(r: Pick<RowInput, 'played' | 'gameDiff'>): { text: string; color: string } | null {
  if (r.played === 0) return null;
  return { text: formatGameDiff(r.gameDiff), color: r.gameDiff > 0 ? C.tealText : C.muted };
}

export const QUAL_TONE: Record<QualificationStatus, { fg: string; bg: string }> = {
  QUALIFIED: { fg: C.tealText, bg: C.tealTint },
  NOT_QUALIFIED: { fg: C.muted, bg: '#F1F4F8' },
  PENDING: { fg: '#8A4B00', bg: '#FFF4DB' },
};

// ── 검색 ────────────────────────────────────────────────────────────────────
//   팀 번호(정확히 일치) · 선수명(부분 일치). 서버 검색 없이 받은 데이터만 거른다.

export const normalizeQuery = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, '');

export function rowMatches(r: TeamNameInput, q: string): boolean {
  if (!q) return false;
  const num = q.replace(/번$/, '');
  if (/^\d+$/.test(num) && Number(num) === r.teamNo) return true;
  const names = `${r.player1Name}${r.player2Name}`.toLowerCase().replace(/\s+/g, '');
  return names.includes(q);
}

// ── 경기 상태 ───────────────────────────────────────────────────────────────

export function matchStatusView(
  status: string, courtNo: number | null = null,
): { label: string; color: string } {
  switch (status) {
    case 'completed': return { label: '완료', color: C.green };
    case 'playing':   return { label: courtNo ? `진행 중 · ${courtNo}번 코트` : '진행 중', color: C.tealText };
    case 'calling':   return { label: '호명 중', color: C.tealText };
    case 'cancelled': return { label: '취소됨', color: C.red };
    default:          return { label: '대기', color: C.muted };
  }
}

export const teamName = (t: Pick<TeamNameInput, 'player1Name' | 'player2Name'>): string =>
  `${t.player1Name} · ${t.player2Name}`;

// ── 순위결정전 표시 번호 ─────────────────────────────────────────────────────
//   ⚠ 표시 전용. DB 의 group_type = 'placement' 는 그대로이며 예선 순위 계산에 들어가지 않는다.
//   참가자가 "나는 17조"로 인지할 수 있도록 일반 조 번호 흐름에 이어 붙인다: 일반 조 N개 → N + 1조.
//   (번호를 하드코딩하지 않는다. 48팀처럼 순위결정전이 없으면 표시되지 않는다.)
export const placementDisplayNo = (preliminaryGroupCount: number, index = 0): number =>
  preliminaryGroupCount + index + 1;

export const PLACEMENT_TAG = '순위결정전';

/** 순위결정전 경기 상태 → 목록 필터 구분(경기 1개라 상태가 곧 진행도다). */
export const placementFilterOf = (status: string): Exclude<GroupFilter, 'all'> =>
  status === 'completed' ? 'done' : status === 'waiting' ? 'pre' : 'live';

/** 순위결정전 카드 · 상세 상태. 취소 등 예외 문구는 Admin / Public 래퍼가 정한다. */
export function placementStatusView(status: string): { label: string; color: string } {
  if (status === 'completed') return { label: '완료', color: C.green };
  if (status === 'waiting') return { label: '경기 전', color: C.slate };
  return { label: '진행 중', color: C.tealText };
}

/** 완료 경기 0건일 때 조 상세 안내 — 진행 중인 경기가 있어도 어긋나지 않는 표현. */
export const NO_RESULT_YET_NOTICE = '아직 완료된 경기가 없습니다. 첫 경기 결과가 등록되면 순위가 표시됩니다.';

/** 순위결정전 상세 안내. */
export const PLACEMENT_NOTICE_HEAD = '두 팀 모두 본선에 진출합니다.';
export const PLACEMENT_NOTICE_BODY = '경기 결과는 본선 배치 순서에만 반영됩니다.';
