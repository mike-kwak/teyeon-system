// Tournament 운영 단계(phase) — Hub 네비게이션 구성의 단일 출처.
//
//   왜 있나: 탭을 고정 배열로 하드코딩해 두면, 나중에
//     "참가팀 확정 후에는 DRAW 를 기본으로", "대회 당일에는 LIVE 를 기본으로"
//   같은 요구가 들어올 때 화면 곳곳을 고쳐야 한다. 그 지점을 여기 한 곳으로 모은다.
//
//   ⚠ 이번 단계 범위
//     · phase 판정 + 각 탭의 공개 여부/안내 문구까지만 만든다.
//     · DRAW 는 운영진이 예선 DRAW 를 공개했을 때만 열린다(drawPublished). LIVE / RESULTS 는 계속 'pending'.
//     · "phase 에 따라 기본 진입 탭을 바꾸는" 동작도 아직 넣지 않는다(아래 TODO 참고).
//       지금 Hub 의 기본 진입은 항상 INFO 다.

import type { TournamentNavItem, TournamentPhaseKey } from './types';

export type TournamentPhase =
  /** 공개 준비(draft) — 접수 전. */
  | 'preparing'
  /** 접수 기간 — INFO / REGISTER 중심. */
  | 'registration'
  /** 접수 마감 ~ 대회 전 — 참가팀 확정, 이후 DRAW 우선. */
  | 'teams_fixed'
  /** 대회 당일 — 이후 LIVE 우선. */
  | 'match_day'
  /** 종료 — 이후 RESULTS 우선. */
  | 'finished';

/** hosted_tournaments.status → 운영 phase. */
export function resolvePhase(status?: string | null): TournamentPhase {
  switch (status) {
    case 'registration_open':
      return 'registration';
    case 'registration_closed':
      return 'teams_fixed';
    case 'in_progress':
      return 'match_day';
    case 'completed':
      return 'finished';
    case 'published':
      return 'registration';
    default:
      return 'preparing'; // draft / cancelled / 미확인
  }
}

/**
 * TODO(향후): phase 별 기본 진입 탭.
 *   QR 로 Hub 에 들어왔을 때 어떤 탭을 먼저 보여줄지의 기준값이다.
 *   지금은 어디에서도 사용하지 않는다 — 실제로 DRAW/LIVE/RESULTS 화면이 생긴 뒤,
 *   그리고 운영진 수동 override(예: hosted_tournaments.default_tab 컬럼) 정책이 정해진 뒤에 연결한다.
 *   여기 값만 바꾸면 되도록 판정을 이 파일 밖으로 흘리지 않는다.
 */
export const PHASE_PRIMARY_TAB: Record<TournamentPhase, TournamentPhaseKey> = {
  preparing: 'info',
  registration: 'info',
  teams_fixed: 'draw',
  match_day: 'live',
  finished: 'results',
};

/** 아직 열리지 않은 탭의 공개 시점 안내(요강 규정이 아니라 사이트 운영 안내 문구). */
const RELEASE_NOTE: Record<Exclude<TournamentPhaseKey, 'info' | 'teams'>, string> = {
  draw: '참가팀 확정 후 공개',
  live: '대회 당일 공개',
  results: '경기 종료 후 공개',
};

/**
 * Hub 상단 네비게이션 구성.
 *   current       = 지금 보고 있는 화면
 *   phase         = 운영 단계(현재는 안내 문구에만 영향)
 *   drawPublished = 서버 공개 RPC 가 예선 DRAW 를 돌려줬는가.
 *                   ⚠ 운영진이 DRAW 를 공개했을 때만 true — 조편성 LOCK 만으로는 열지 않는다.
 */
export function buildHubNavItems(opts: {
  slug: string;
  current: TournamentPhaseKey;
  phase: TournamentPhase;
  drawPublished?: boolean;
}): TournamentNavItem[] {
  const { slug, current, drawPublished = false } = opts;
  const base = `/tournaments/${slug}`;

  const item = (
    key: TournamentPhaseKey,
    label: string,
    href: string | null,
    releaseNote?: string,
  ): TournamentNavItem => {
    if (key === current) return { key, label, state: 'current' };
    if (href) return { key, label, state: 'open', href };
    return { key, label, state: 'pending', releaseNote };
  };

  return [
    item('info', 'INFO', base),
    item('teams', 'TEAMS', `${base}/teams`),
    item('draw', 'DRAW', drawPublished ? `${base}/draw` : null, RELEASE_NOTE.draw),
    item('live', 'LIVE', null, RELEASE_NOTE.live),
    item('results', 'RESULTS', null, RELEASE_NOTE.results),
  ];
}
