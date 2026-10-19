// 관리자 미리보기 — 본부 조회 결과를 '공개 DRAW 응답과 같은 모양' 으로 바꾼다(순수 함수 · 서버 호출 없음).
//
//   get_public_preliminary_draw 가 내려주는 규칙을 그대로 따른다:
//     · 코트(번호 · 이름)는 진행 중(playing)일 때만, 점수 · 승자는 완료(completed)일 때만
//     · 조는 예선 조만(순위결정전은 placement 로 따로), 경기는 조 안 순서(sequence_no)대로
//     · uuid · 동률 상세 · 지문 · 나이 계열 없음 — 공개 화면 컴포넌트가 받는 필드만 만든다
//   조별 일정도 get_public_group_schedule 과 같은 모양으로 만든다(공통 안내는 저장된 값이 있을 때만).
//   ⚠ 순위 · 진출은 서버(standings 코어) 값 그대로 옮긴다. 여기서 계산하지 않는다.

import type { PublicDrawMatch, PublicPreliminaryDraw } from './publicDrawTypes';
import type { PreliminaryStandings } from './standingsTypes';
import type { MatchBoard } from './matchTypes';
import type { AdminGroupSchedule } from './groupScheduleService';
import type { PublicGroupSchedule } from './groupScheduleModel';

export function previewDraw(st: PreliminaryStandings, board: MatchBoard | null): PublicPreliminaryDraw {
  const courtName = (no: number | null) => (no === null ? null : board?.courts.find((c) => c.courtNo === no)?.displayName ?? null);
  const groups = [...st.groups].sort((a, b) => a.groupNo - b.groupNo).map((g) => {
    const matches: PublicDrawMatch[] = (board?.matches ?? [])
      .filter((m) => m.stage === 'preliminary' && m.groupNo === g.groupNo)
      .map((m) => {
        const playing = m.status === 'playing';
        const done = m.status === 'completed';
        return {
          sequenceNo: m.sequenceNo,
          matchNo: m.matchNo,
          status: m.status,
          courtNo: playing ? m.courtNo : null,
          courtName: playing ? courtName(m.courtNo) : null,
          score1: done ? m.score1 : null,
          score2: done ? m.score2 : null,
          winnerSide: (!done ? null : m.winnerTeamId === m.team1.teamId ? 1 : m.winnerTeamId === m.team2.teamId ? 2 : null) as 1 | 2 | null,
          team1: { teamNo: m.team1.teamNo, player1Name: m.team1.player1Name, player2Name: m.team1.player2Name },
          team2: { teamNo: m.team2.teamNo, player1Name: m.team2.player1Name, player2Name: m.team2.player2Name },
        };
      })
      .sort((a, b) => a.sequenceNo - b.sequenceNo);
    return {
      groupNo: g.groupNo,
      members: g.members,
      expectedMatches: g.expectedMatches,
      generatedMatches: g.generatedMatches,
      completedMatches: g.completedMatches,
      cancelledMatches: g.cancelledMatches,
      rankingStatus: g.rankingStatus,
      standings: g.standings.map((r) => ({
        teamNo: r.teamNo, player1Name: r.player1Name, player2Name: r.player2Name,
        withdrawn: r.teamStatus === 'withdrawn',
        played: r.played, wins: r.wins, losses: r.losses,
        gamesFor: r.gamesFor, gamesAgainst: r.gamesAgainst, gameDiff: r.gameDiff,
        rank: r.rank, qualificationStatus: r.qualificationStatus,
      })),
      matches,
    };
  });
  const placement = st.placement.map((p) => {
    const done = p.status === 'completed';
    const t0 = p.teams[0]?.teamId; const t1 = p.teams[1]?.teamId;
    return {
      groupNo: p.groupNo,
      matchNo: p.matchNo,
      status: p.status,
      score1: done ? p.score1 : null,
      score2: done ? p.score2 : null,
      winnerSide: (!done ? null : p.winnerTeamId && p.winnerTeamId === t0 ? 1 : p.winnerTeamId && p.winnerTeamId === t1 ? 2 : null) as 1 | 2 | null,
      teams: p.teams.map((t) => ({ teamNo: t.teamNo, player1Name: t.player1Name, player2Name: t.player2Name })),
    };
  });
  return { slug: st.slug, qualifyPerGroup: st.qualifyPerGroup, groups, placement };
}

export function previewSchedule(a: AdminGroupSchedule | null): PublicGroupSchedule | null {
  if (!a) return null;
  const s = a.settings;
  const courtName = (no: number | null) => (no === null ? null : a.courts.find((c) => c.courtNo === no)?.displayName ?? null);
  return {
    checkinPlace: s ? s.checkinPlace : null,
    sessions: s ? [
      { sessionNo: 1, checkinDeadline: s.session1CheckinDeadline, startTime: s.session1StartTime, startNote: s.session1StartNote },
      { sessionNo: 2, checkinDeadline: s.session2CheckinDeadline, startTime: s.session2StartTime, startNote: s.session2StartNote },
    ] : [],
    groups: a.groups
      .filter((g) => g.sessionNo !== null || g.plannedCourtNo !== null)
      .map((g) => ({ groupNo: g.groupNo, sessionNo: g.sessionNo, plannedCourtNo: g.plannedCourtNo, plannedCourtName: courtName(g.plannedCourtNo) }))
      .sort((x, y) => x.groupNo - y.groupNo),
  };
}
