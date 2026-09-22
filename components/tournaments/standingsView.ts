'use client';

// 예선 조별리그 — Admin 전용 표시 판단 + 데이터 로딩.
//   공용 표시 규칙(단계 · 진행 칸 · 순위 칸 · 검색)은 standings/presentation.ts 에 있다.
//
//   ⚠⚠ 순위 · 진출 · 동률을 계산하지 않는다(서버 standings 계산 코어 값 그대로).
//   ⚠ 여기 있는 '확인 필요' · 운영 경고는 Admin 전용이다. Public 래퍼는 이 파일을 쓰지 않는다.

import React from 'react';
import {
  fetchPreliminaryStandings, standingsActionMessage,
} from '@/lib/tournaments/standingsAdminService';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import {
  RANKING_STATUS_LABEL, type GroupStandings, type PreliminaryStandings, type StandingRow,
} from '@/lib/tournaments/standingsTypes';
import type { MatchBoard, TournamentMatch } from '@/lib/tournaments/matchTypes';
import {
  C, displayStageOf, gameDiffView, isSettled, phaseOf, rankText, rankTone, recordText, rowMatches, QUAL_TONE,
  type GroupPhase,
} from '@/components/tournaments/standings/presentation';
import type { CompactRow, RankRowView } from '@/components/tournaments/standings/primitives';
import { QUALIFICATION_LABEL, formatGameDiff, standingTeamName } from '@/lib/tournaments/standingsTypes';

export * from '@/components/tournaments/standings/presentation';

/** 서버가 운영 판단을 요구한 조(합산연령 확인 또는 취소 경기 잔존). */
export const needsAttention = (g: GroupStandings): boolean =>
  g.rankingStatus === 'AGE_CHECK_REQUIRED' || g.policyRequired !== null;

/**
 * 메인 카드 상태 — 네 가지만. 예외는 '확인 필요' 하나로 묶는다.
 *   started = 조 경기 중 하나라도 호명 · 진행 · 완료 · 취소됐는가(표시 전용 — 서버 상태 불변).
 */
export function cardStatus(g: GroupStandings, started = false): { label: string; color: string } {
  if (needsAttention(g)) return { label: '확인 필요', color: C.amber };
  if (phaseOf(g) === 'FINAL') return { label: '완료', color: C.green };
  if (displayStageOf(g, started) === 'pre') return { label: '경기 전', color: C.slate };
  return { label: '진행 중', color: C.tealText };
}

/** 상세 헤더 상태. */
export function detailStatus(g: GroupStandings, started = false): { label: string; color: string } {
  if (needsAttention(g)) return { label: '확인 필요', color: C.amber };
  if (phaseOf(g) === 'FINAL') return { label: RANKING_STATUS_LABEL.FINAL, color: C.green };
  if (displayStageOf(g, started) === 'pre') return { label: '경기 전', color: C.slate };
  return { label: RANKING_STATUS_LABEL.PROVISIONAL, color: C.tealText };
}

/** 메인 카드 팀 줄 (Admin). */
export function adminCompactRow(r: StandingRow, phase: GroupPhase, q: string): CompactRow {
  const pre = phase === 'NOT_STARTED';
  return {
    key: r.teamId,
    p1: r.player1Name,
    p2: r.player2Name,
    rank: pre ? null : rankText(r),
    tone: rankTone(r, phase),
    record: pre ? null : r.teamStatus === 'withdrawn' ? '기권' : recordText(r),
    diff: pre ? null : gameDiffView(r)?.text ?? null,
    diffColor: gameDiffView(r)?.color,
    muted: phase === 'FINAL' && r.qualificationStatus === 'NOT_QUALIFIED',
    hit: rowMatches(r, q),
  };
}

/** 상세 순위표 행 (Admin) — 동률 · 순서 확정 · 기권 메모 포함. */
export function adminRankRow(r: StandingRow, phase: GroupPhase): RankRowView {
  const settled = isSettled(phase);
  // 서버가 미해결 동률로 둔 팀만 '동률' 표시. 진행 중 raw tie 는 표시하지 않는다.
  const tieNote = phase === 'AGE_CHECK' && r.tieGroupRank !== null && r.resolvedOrder === null
    ? `${r.tieGroupRank}위 동률` : '';
  const resolvedNote = r.resolvedOrder !== null ? `순서 확정${r.resolvedReason ? ` · ${r.resolvedReason}` : ''}` : '';
  const withdrawn = r.teamStatus === 'withdrawn';
  const q = QUAL_TONE[r.qualificationStatus];
  return {
    key: r.teamId,
    rank: rankText(r),
    tone: rankTone(r, phase),
    name: standingTeamName(r),
    muted: settled && r.qualificationStatus === 'NOT_QUALIFIED',
    note: [withdrawn ? '기권' : '', tieNote, resolvedNote].filter(Boolean).join(' · '),
    noteColor: tieNote ? C.amber : withdrawn ? C.red : C.tealText,
    record: recordText(r),
    recordMuted: r.played === 0,
    diff: r.played === 0 ? '–' : formatGameDiff(r.gameDiff),
    diffColor: r.played === 0 ? C.faint : r.gameDiff > 0 ? C.tealText : C.muted,
    badge: settled ? { label: QUALIFICATION_LABEL[r.qualificationStatus], fg: q.fg, bg: q.bg } : null,
  };
}

export function groupMatches(board: MatchBoard | null, groupNo: number): TournamentMatch[] {
  if (!board) return [];
  return board.matches
    .filter((m) => m.stage === 'preliminary' && m.groupType !== 'placement' && m.groupNo === groupNo)
    .sort((a, b) => a.sequenceNo - b.sequenceNo);
}

// ── 데이터 ──────────────────────────────────────────────────────────────────
//   순위는 standings RPC, 경기 목록·조편성 상태는 match board 가 권위 있는 값이다.
//   Realtime 없음 — 화면 진입 · 새로고침 · write 성공 후 전체 재조회.

export function useStandingsData(slug: string) {
  const [standings, setStandings] = React.useState<PreliminaryStandings | null>(null);
  const [board, setBoard] = React.useState<MatchBoard | null>(null);
  const [ready, setReady] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const reload = React.useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError('');
    try {
      const [st, mb] = await Promise.all([
        fetchPreliminaryStandings(slug),
        fetchMatchBoard(slug).catch(() => ({ ready: false, board: null as MatchBoard | null })),
      ]);
      setReady(st.ready);
      setStandings(st.standings);
      setBoard(mb.board);
    } catch (err) {
      setReady(false);
      setError(standingsActionMessage(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  React.useEffect(() => { void reload(); }, [reload]);

  return { standings, board, ready, loading, error, reload };
}
