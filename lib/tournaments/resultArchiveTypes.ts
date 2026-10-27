// TEYEON OPEN 공식 결과 아카이브 — 화면 타입.
//   ⚠ 모든 기록은 확정 스냅샷(서버 hosted_tournament_result_archives.snapshot)에서만 온다. 화면은 계산하지 않는다.

import type { PublicPreliminaryDraw } from './publicDrawTypes';
import type { PublicKnockoutBracket, PublicKnockoutTeam } from './publicKnockoutTypes';

export interface ResultEditionSummary {
  slug: string;
  editionNo: number;
  editionLabel: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  champion: PublicKnockoutTeam | null;
}

export interface ResultAwardTeam { team: PublicKnockoutTeam; matchNo: number | null }
export interface ResultSemifinalist extends ResultAwardTeam {
  lostTo: PublicKnockoutTeam | null;
  score1: number | null;
  score2: number | null;
  /** 이 팀(패자)이 그 경기의 몇 번 쪽이었는가 — 점수 읽는 방향. */
  loserSide: 1 | 2 | null;
}

export interface ResultAwards {
  champion: ResultAwardTeam;
  runnerUp: ResultAwardTeam;
  final: { matchNo: number; score1: number | null; score2: number | null; team1: PublicKnockoutTeam | null; team2: PublicKnockoutTeam | null; winnerSide: 1 | 2 | null };
  semifinalists: ResultSemifinalist[];
}

export interface ResultCounts {
  preliminaryMatches: number; preliminaryCompleted: number;
  knockoutMatches: number; knockoutCompleted: number;
  firstRoundSlots: number; byeSlots: number; entrants: number;
}

export type ResultPhotoCategory = 'hero' | 'champion' | 'runner_up' | 'semifinal' | 'group';
export type ResultVideoCategory = 'highlight' | 'final' | 'semifinal_match' | 'ceremony' | 'sketch';

export interface ResultMedia {
  id: string;
  kind: 'photo' | 'video';
  category: ResultPhotoCategory | ResultVideoCategory;
  title: string | null;
  storagePath: string | null;
  youtubeId: string | null;
  displayOrder: number;
  /** 이 사진의 입상팀 번호(공식 스냅샷의 teamNo). 우승 · 준우승 · 공동 3위 사진만, 비어 있으면 미지정. */
  teamNo?: number | null;
  /** 관리자 조회에만 있다. */
  isPublic?: boolean;
  /** 화면이 붙인다 — 사진의 서명 URL(실패 · 만료면 null). */
  url?: string | null;
}

/** 입상팀 선수별 소속 클럽(대회 당시 기록 — get_public_tournament_result_clubs). 이름은 저장 당시 스냅샷 이름(대조용). */
export interface ResultTeamClubs {
  teamNo: number;
  player1Name: string;
  player2Name: string;
  player1Club: string | null;
  player2Club: string | null;
}

export interface ResultArchive {
  slug: string;
  editionNo: number;
  editionLabel: string;
  version: number;
  confirmedAt: string | null;
  tournament: { title: string; subtitle: string | null; eventDate: string | null; venueName: string | null; organizerName: string | null };
  awards: ResultAwards | null;
  counts: ResultCounts | null;
  preliminary: PublicPreliminaryDraw | null;
  knockout: PublicKnockoutBracket | null;
  media: ResultMedia[];
  /** 입상팀 소속 클럽. 고정 기록이 없거나 조회 실패면 빈 배열 — 화면은 클럽 줄 없이 그린다. */
  teamClubs?: ResultTeamClubs[];
}

export interface ResultCheck { key: string; ok: boolean; value: string | number | null }

export interface ResultAdminState {
  /** 사진 저장 폴더 이름(관리자 조회에만). */
  tournamentId: string;
  archive: {
    editionNo: number; editionLabel: string; version: number; isPublic: boolean;
    confirmedAt: string | null; publishedAt: string | null; snapshotMd5: string;
    awards: ResultAwards | null; counts: ResultCounts | null;
  } | null;
  preview: {
    sourceMd5: string; ok: boolean; checks: ResultCheck[]; counts: ResultCounts | null; awards: ResultAwards | null;
    tournament: { title: string; eventDate: string | null; venueName: string | null } | null;
    /** 확정된 기록과 지금 LIVE 기록이 같은가(확정 전이면 false). */
    matchesArchive: boolean;
  };
  usedEditionNos: number[];
  media: ResultMedia[];
  history: Array<{ action: string; at: string; note: string | null; fromVersion: string | null; toVersion: string | null }>;
}

export const RESULT_PHOTO_CATEGORIES: Array<[ResultPhotoCategory, string]> = [
  ['champion', '우승'], ['runner_up', '준우승'], ['semifinal', '공동 3위'], ['group', '단체 시상'], ['hero', '대회 대표 사진'],
];
export const RESULT_VIDEO_CATEGORIES: Array<[ResultVideoCategory, string]> = [
  ['highlight', '공식 하이라이트'], ['final', '결승전'], ['semifinal_match', '4강 경기'], ['ceremony', '시상식'], ['sketch', '대회 스케치'],
];
