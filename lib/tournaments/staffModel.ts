// 현장 운영자 화면 — 순수 판정(목록 나누기 · 코트 필터 · 점수창 연결 · 충돌 판정).
//
//   ⚠ 서버 값을 그대로 쓴다. 상태를 추측하거나 계산해 저장하지 않는다.
//   ⚠ 현장 운영자가 조작할 수 있는 경기 = 진행 중(코트 투입됨) 예선 · 본선. 코트 투입은 본부만 한다(서버도 막는다).

import type { StaffBoard, StaffMatch } from './staffService';
import type { ControlMatchRow } from '@/components/tournaments/control/controlModel';

export type StaffTab = 'playing' | 'next' | 'done';

/** 코트 필터 — 비어 있으면 전체. */
export type CourtFilter = ReadonlySet<number>;

const inCourts = (m: StaffMatch, f: CourtFilter): boolean =>
  f.size === 0 || (m.courtNo !== null && f.has(m.courtNo));

/** 진행 중 — 코트 번호 순. */
export function playingMatches(board: StaffBoard, f: CourtFilter): StaffMatch[] {
  return board.matches
    .filter((m) => m.status === 'playing' && inCourts(m, f))
    .sort((a, b) => (a.courtNo ?? 999) - (b.courtNo ?? 999) || a.matchNo - b.matchNo);
}

/** 다음 경기 — 호명 먼저, 그다음 대기(경기 번호 순). 코트가 아직 없으므로 코트 필터와 무관하다. */
export function nextMatches(board: StaffBoard, limit = 12): StaffMatch[] {
  const calling = board.matches.filter((m) => m.status === 'calling');
  const waiting = board.matches.filter((m) => m.status === 'waiting');
  return [...calling, ...waiting].slice(0, limit);
}

/** 최근 완료 — 완료 시각 최신순. */
export function doneMatches(board: StaffBoard, limit = 15): StaffMatch[] {
  return board.matches
    .filter((m) => m.status === 'completed')
    .sort((a, b) => (Date.parse(b.completedAt ?? '') || 0) - (Date.parse(a.completedAt ?? '') || 0) || b.matchNo - a.matchNo)
    .slice(0, limit);
}

/** 현장 운영자가 이 경기를 조작할 수 있는가(화면 판단 — 서버가 다시 판정한다). */
export function staffCanOperate(m: StaffMatch, role: StaffBoard['role']): boolean {
  void role;   // 현장 운영자 · 본부 모두 진행 중 경기(예선 · 본선)를 조작한다 — 서버가 다시 판정한다
  return m.status === 'playing';
}

export const staffMatchHead = (m: StaffMatch): string =>
  m.stage === 'knockout' ? '본선' : m.groupNo !== null && m.groupType !== 'placement' ? `${m.groupNo}조` : '순위결정전';

/** 기존 점수창(ControlScoreDialog)에 넘기는 모양. 본선이면 점수창이 확인 단계(다음 → 확인 → 완료)를 붙인다. */
export function toControlRow(m: StaffMatch): ControlMatchRow {
  return {
    matchId: m.matchId,
    matchNo: m.matchNo,
    stage: m.stage,
    status: m.status,
    groupNo: m.groupNo,
    courtNo: m.courtNo,
    version: m.version,
    roundName: m.stage === 'knockout' ? '본선' : null,
    isFinal: false,
    team1: { teamNo: m.team1.teamNo, player1Name: m.team1.player1Name, player2Name: m.team1.player2Name },
    team2: { teamNo: m.team2.teamNo, player1Name: m.team2.player1Name, player2Name: m.team2.player2Name },
    startedAt: m.startedAt,
    playStartedAt: m.playStartedAt,
    completedAt: m.completedAt,
  };
}

/**
 * 점수창을 연 뒤 서버에서 경기가 바뀌었는가 — 바뀌었으면 안내 문구(저장 차단), 그대로면 null.
 *   ⚠ 최신 보드가 없으면(조회 실패) 판단하지 않는다(null) — 저장 시 서버가 version 으로 가린다.
 */
export function staffScoreConflict(opened: StaffMatch, board: StaffBoard | null): string | null {
  if (!board) return null;
  const now = board.matches.find((m) => m.matchId === opened.matchId);
  if (!now) return '이 경기를 찾을 수 없습니다. 닫고 다시 확인해 주세요.';
  if (now.status === 'completed') {
    return `이미 다른 기기에서 완료된 경기입니다${now.score1 !== null && now.score2 !== null ? ` (${now.score1}:${now.score2})` : ''}.`;
  }
  if (now.status !== 'playing') return '경기 상태가 바뀌었습니다. 닫고 다시 확인해 주세요.';
  if (now.version !== opened.version) return '다른 기기에서 이 경기를 먼저 바꿨습니다. 닫고 다시 열어 주세요.';
  return null;
}
