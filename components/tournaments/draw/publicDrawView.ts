'use client';

// 공개 예선 DRAW — Public 전용 표시 판단 + 데이터 로딩.
//
//   ⚠⚠ 순위 · 진출 · 동률을 계산하지 않는다(서버 standings 계산 코어 값 그대로).
//   ⚠ 운영 문구 · 행동(합산연령 확인 필요 · 순서 지정 · 경기 운영 이동 · 복구)을 쓰지 않는다.
//     AGE_CHECK_REQUIRED → '순위 확인 중', CANCELLED 잔존 → '결과 확인 중' 처럼
//     참가자가 이해할 수 있는 read-only 상태로만 표현한다.

import React from 'react';
import { fetchPublicPreliminaryDraw } from '@/lib/tournaments/publicDrawService';
import type {
  PublicDrawGroup, PublicDrawMatch, PublicPreliminaryDraw, PublicStandingRow,
} from '@/lib/tournaments/publicDrawTypes';
import { QUALIFICATION_LABEL, RANKING_STATUS_LABEL, formatGameDiff } from '@/lib/tournaments/standingsTypes';
import {
  C, QUAL_TONE, anyMatchStarted, displayStageOf, gameDiffView, isSettled, phaseOf, rankText, rankTone,
  recordText, rowMatches, teamName, type GroupPhase,
} from '@/components/tournaments/standings/presentation';
import type { CompactRow, RankRowView } from '@/components/tournaments/standings/primitives';

export type PublicNotice = 'RANK_CHECK' | 'RESULT_CHECK' | null;

/** 공개 화면이 알려줄 확인 상태. 서버 상태를 참가자 언어로 바꿀 뿐 새로 판단하지 않는다. */
export function publicNotice(g: PublicDrawGroup): PublicNotice {
  if (g.rankingStatus === 'AGE_CHECK_REQUIRED') return 'RANK_CHECK';
  if (g.rankingStatus === 'PROVISIONAL' && g.cancelledMatches > 0) return 'RESULT_CHECK';
  return null;
}

/** 조 경기 중 하나라도 시작됐는가 — 라벨 · 필터 표시 전용. */
export const publicGroupStarted = (g: PublicDrawGroup): boolean => anyMatchStarted(g.matches.map((m) => m.status));

export function publicCardStatus(g: PublicDrawGroup): { label: string; color: string } {
  const n = publicNotice(g);
  if (n === 'RANK_CHECK') return { label: '순위 확인 중', color: C.amber };
  if (n === 'RESULT_CHECK') return { label: '결과 확인 중', color: C.amber };
  const p = phaseOf(g);
  if (p === 'FINAL') return { label: '완료', color: C.green };
  if (displayStageOf(g, publicGroupStarted(g)) === 'pre') return { label: '경기 전', color: C.slate };
  return { label: '진행 중', color: C.tealText };
}

export function publicDetailStatus(g: PublicDrawGroup): { label: string; color: string } {
  const n = publicNotice(g);
  if (n === 'RANK_CHECK') return { label: '순위 확인 중', color: C.amber };
  if (n === 'RESULT_CHECK') return { label: '결과 확인 중', color: C.amber };
  const p = phaseOf(g);
  if (p === 'FINAL') return { label: RANKING_STATUS_LABEL.FINAL, color: C.green };
  if (displayStageOf(g, publicGroupStarted(g)) === 'pre') return { label: '경기 전', color: C.slate };
  return { label: RANKING_STATUS_LABEL.PROVISIONAL, color: C.tealText };
}

/** 공개 경기 상태 — 운영 용어(호명 · 취소)를 참가자 언어로. */
export function publicMatchStatus(m: Pick<PublicDrawMatch, 'status' | 'courtNo' | 'courtName'>): { label: string; color: string } {
  switch (m.status) {
    case 'completed': return { label: '완료', color: C.green };
    case 'playing': {
      const court = m.courtName || (m.courtNo ? `${m.courtNo}번 코트` : '');
      return { label: court ? `진행 중 · ${court}` : '진행 중', color: C.tealText };
    }
    case 'calling':   return { label: '경기 준비 중', color: C.tealText };
    case 'cancelled': return { label: '결과 확인 중', color: C.slate };
    default:          return { label: '대기', color: C.muted };
  }
}

export const teamKey = (t: { teamNo: number }): string => `t${t.teamNo}`;

export function publicCompactRow(r: PublicStandingRow, phase: GroupPhase, q: string): CompactRow {
  const pre = phase === 'NOT_STARTED';
  return {
    key: teamKey(r),
    p1: r.player1Name,
    p2: r.player2Name,
    rank: pre ? null : rankText(r),
    tone: rankTone(r, phase),
    record: pre ? null : r.withdrawn ? '기권' : recordText(r),
    diff: pre ? null : gameDiffView(r)?.text ?? null,
    diffColor: gameDiffView(r)?.color,
    muted: phase === 'FINAL' && r.qualificationStatus === 'NOT_QUALIFIED',
    hit: rowMatches(r, q),
  };
}

export function publicRankRow(r: PublicStandingRow, phase: GroupPhase): RankRowView {
  const settled = isSettled(phase);
  const q = QUAL_TONE[r.qualificationStatus];
  return {
    key: teamKey(r),
    rank: rankText(r),
    tone: rankTone(r, phase),
    name: teamName(r),
    muted: settled && r.qualificationStatus === 'NOT_QUALIFIED',
    note: r.withdrawn ? '기권' : '',
    noteColor: C.red,
    record: recordText(r),
    recordMuted: r.played === 0,
    diff: r.played === 0 ? '–' : formatGameDiff(r.gameDiff),
    diffColor: r.played === 0 ? C.faint : r.gameDiff > 0 ? C.tealText : C.muted,
    badge: settled ? { label: QUALIFICATION_LABEL[r.qualificationStatus], fg: q.fg, bg: q.bg } : null,
  };
}

// ── 데이터 ──────────────────────────────────────────────────────────────────
//   Realtime 없음. 진입 시 1회 + 화면을 보는 동안 주기 갱신 + 탭으로 돌아왔을 때 다시 불러온다.
//   ⚠ 주기는 공개 본선과 같다(KNOCKOUT_POLL_MS 45초) — 경기 중인지 · 결과를 휴대폰에서 다시 열지 않아도 보게.
//   ⚠ 배경 갱신이 실패하면 보고 있던 내용을 그대로 둔다(화면을 '공개 전' 으로 비우지 않는다).
//   ⚠ 화면이 숨겨지면 멈춘다. 예선이 모두 끝나면(모든 조 순위 확정 · 순위결정전 완료) 주기 갱신을 멈춘다.
export const PRELIM_POLL_MS = 45_000;

export function usePublicDraw(slug: string) {
  const [draw, setDraw] = React.useState<PublicPreliminaryDraw | null>(null);
  const [loading, setLoading] = React.useState(true);
  const hasData = React.useRef(false);
  const settled = React.useRef(false);
  const inFlight = React.useRef(false);

  const load = React.useCallback(async () => {
    if (!slug || inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetchPublicPreliminaryDraw(slug);
      hasData.current = r.draw !== null;
      settled.current = !!r.draw && r.draw.groups.length > 0 && r.draw.groups.every((g) => g.rankingStatus === 'FINAL')
        && r.draw.placement.every((p) => p.status === 'completed');
      setDraw(r.draw);
    } catch {
      // 첫 조회 실패만 '공개 전' 과 같은 빈 상태로 둔다. 배경 갱신 실패는 보고 있던 내용을 유지한다.
      if (!hasData.current) setDraw(null);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [slug]);

  React.useEffect(() => {
    void load();
    let timer: number | null = null;
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      timer = window.setInterval(() => { if (!settled.current) void load(); }, PRELIM_POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') { void load(); start(); }
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  return { draw, loading };
}

/**
 * Hub 네비게이션용 — 예선 DRAW 가 공개됐는가(INFO · TEAMS 화면에서 DRAW 탭을 열지 결정).
 *   ⚠ 기능 스위치가 꺼져 있으면(migration 전) 호출하지 않고 false — 기존 '준비 중' 그대로.
 */
export function usePublicDrawPublished(slug: string): boolean {
  const [published, setPublished] = React.useState(false);
  React.useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetchPublicPreliminaryDraw(slug)
      .then((r) => { if (!cancelled) setPublished(!!r.draw); })
      .catch(() => { if (!cancelled) setPublished(false); });
    return () => { cancelled = true; };
  }, [slug]);
  return published;
}
