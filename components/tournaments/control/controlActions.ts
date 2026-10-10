'use client';

// Control Center 조작 래퍼 (Batch 4F-3 · 결과 반환 4F-4a · 조회 보호 · 결과 판정 4F-4b).
//
//   ⚠ 이 파일은 **엔진이 아니다**. 기존 운영 service 를 그대로 부르고,
//     중복 클릭 방지 · 재조회 · 오류 문구만 한 곳에 모은다.
//   ⚠ 여기서 다시 만들지 않는 것: RPC 호출 · 점수 규칙 · 승자 판정 ·
//     코트 검증 · 팀 중복 검증 · version 검증. 전부 기존 service / 서버가 한다.
//   ⚠ 새 오류 체계를 만들지 않는다 — matchActionMessage · bracketActionMessage 를 그대로 쓴다.
//   ⚠ optimistic update 를 하지 않는다. 성공이든 실패든 전체를 다시 읽는다(authoritative refetch).
//   ⚠ 취소 · 복구 · 완료 결과 수정은 이 래퍼에 두지 않는다(기존 경기 운영 · 본선 대진 화면이 맡는다).
//   ⚠ 조작 결과는 세 가지다 — 화면은 **'success' 일 때만** 선택을 풀고 모달을 닫는다.
//     · success    : 서버가 받아들였다고 응답했다
//     · failure    : 서버가 거절했고, 재조회한 상태에도 요청한 결과가 없다
//     · unverified : 응답은 실패인데 서버에 요청한 결과가 보인다(또는 재조회를 못 했다)
//       — 공용 fetch 래퍼가 응답을 잃은 POST 를 다시 보내 version_conflict 를 받은 경우일 수 있다.
//         누가 바꿨는지는 서버 상태로 알 수 없으므로 성공이라 추정하지 않고 확인을 요청한다.
//   ⚠ 조작 RPC 가 도는 동안에는 조회를 멈추고(hold), 그 전에 시작한 조회 응답은 버린다.

import React from 'react';
import {
  callMatch, completeMatch, matchActionMessage, startMatch, uncallMatch,
} from '@/lib/tournaments/matchAdminService';
import { bracketActionMessage, completeKnockoutMatch } from '@/lib/tournaments/bracketAdminService';
import type { MatchBoard } from '@/lib/tournaments/matchTypes';
import { classifyFetchError, intentVisible, judgeActionResult } from './controlModel';
import type { ControlActionIntent, ControlActionVerdict, ControlMatchRow } from './controlModel';

/** 조작 대상에서 실제로 필요한 것만. 화면이 무엇을 들고 있든 이 네 가지면 된다. */
export type ActionTarget = Pick<ControlMatchRow, 'matchId' | 'matchNo' | 'stage' | 'version'>;

/** 진행 중인 조작의 키. '' 이면 한가하다. 기존 경기 운영 화면과 같은 **전역 1건** 방식이다. */
export type BusyKey = string;

export type ActionResult = ControlActionVerdict;

export interface ControlActions {
  busy: BusyKey;
  toast: string;
  call: (m: ActionTarget) => Promise<ActionResult>;
  uncall: (m: ActionTarget) => Promise<ActionResult>;
  /** ⚠ m.version 은 운영자가 **고른 순간의** version 이어야 한다(최신 조회 값으로 바꿔 넣지 않는다). */
  start: (m: ActionTarget, courtNo: number) => Promise<ActionResult>;
  /** 완료. 예선이면 complete_match, 본선이면 complete_knockout_match 로 갈린다. */
  /** ⚠ m.version 은 점수 모달을 **연 순간의** version 이어야 한다. */
  complete: (m: ActionTarget, score1: number, score2: number) => Promise<ActionResult>;
}

/** 조작이 기대는 조회 쪽 기능(useControlData 가 준다). */
export interface ControlActionData {
  reload: () => Promise<void>;
  hold: () => void;
  release: () => void;
  latest: () => { board: MatchBoard | null; at: number | null };
}

/** 본선 경기의 실패 문구는 본선 쪽 사전을 쓴다(없는 reason 은 양쪽 모두 같은 기본 문구). */
const messageFor = (m: ActionTarget) =>
  (m.stage === 'knockout' ? bracketActionMessage : matchActionMessage);

/** 판정 문구에 쓰는 '요청한 결과' 이름. */
const intentText = (m: ActionTarget, it: ControlActionIntent): string => {
  switch (it.kind) {
    case 'call': return `M${m.matchNo} 호명`;
    case 'uncall': return `M${m.matchNo} 호명 취소`;
    case 'start': return `M${m.matchNo} ${it.courtNo}번 코트 투입`;
    default: return `M${m.matchNo} ${it.score1}:${it.score2} 완료`;
  }
};

export function useControlActions(data: ControlActionData): ControlActions {
  const { reload, hold, release, latest } = data;
  const [busy, setBusy] = React.useState<BusyKey>('');
  const [toast, setToast] = React.useState('');

  // 렌더 사이 값이 밀리지 않도록 잠금은 ref 로 본다(state 는 화면 표시용).
  const lock = React.useRef('');
  const timer = React.useRef<number | null>(null);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const say = React.useCallback((msg: string, ms = 3800) => {
    if (!mounted.current) return;
    setToast(msg);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (mounted.current) setToast('');
    }, ms);
  }, []);

  /**
   * 조작 공통.
   *   1) 이미 다른 조작이 돌고 있으면 아무 것도 하지 않는다(중복 클릭 방지)
   *   2) 조회 보류(hold) — 그 전에 시작한 조회 응답은 반영되지 않는다
   *   3) service 호출 → 보류 해제(release)
   *   4) **성공이든 실패든** 전체 재조회 — 이 조작 뒤에 시작된 조회가 반영될 때까지 기다린다
   *   5) 실패면 재조회한 서버 상태로 다시 판정한다(실패 확인 / 확인 불가)
   *   6) 결과를 한 줄로 알린다 — 최신 상태가 화면에 반영된 다음이다
   */
  const run = React.useCallback(async (
    key: BusyKey,
    target: ActionTarget,
    intent: ControlActionIntent,
    fn: () => Promise<string>,
  ): Promise<ActionResult> => {
    if (lock.current) return 'failure';
    lock.current = key;
    setBusy(key);
    const startedAt = Date.now();
    let okMsg: string | null = null;
    let err: unknown = null;
    try {
      hold();
      try {
        okMsg = await fn();
      } catch (e) {
        err = e;
      } finally {
        release();
      }
      await reload();

      if (okMsg !== null) { say(okMsg); return 'success'; }

      const reason = (err as { reason?: string } | null)?.reason ?? null;
      const snap = latest();
      // 조작 뒤 재조회가 반영되지 못했으면(실패) 판정에 쓰지 않는다 — 추정하지 않는다.
      const fresh = snap.at !== null && snap.at >= startedAt ? snap.board : null;
      const verdict = judgeActionResult(intent, reason, fresh);

      if (verdict === 'unverified') {
        const now = fresh ? fresh.matches.find((x) => x.matchId === intent.matchId) ?? null : null;
        say(!fresh
          ? '요청 결과를 확인할 수 없습니다. 최신 상태를 불러오지 못했습니다 — 새로고침 후 현재 상태를 확인해 주세요.'
          : intentVisible(intent, now)
            ? `응답은 실패로 왔지만 서버에는 ${intentText(target, intent)}(으)로 반영되어 있습니다. `
              + '이 화면의 요청이 처리된 것인지 확인할 수 없으니 현장에서 확인해 주세요.'
            // 요청한 결과는 안 보이지만, 이 요청이 반영된 뒤 다시 바뀐 것일 수 있다 — 실패라고 단정하지 않는다.
            : `${intentText(target, intent)} 요청의 결과를 확인할 수 없습니다. 그 사이 이 경기의 상태가 다시 바뀌었습니다 `
              + '— 현재 화면 상태를 기준으로 현장에서 확인해 주세요.',
        7000);
        return 'unverified';
      }
      // 실패 확인 — 다른 운영자가 먼저 바꾼 경우는 '실패' 가 아니라 '늦었다'. 문구를 따로 둔다.
      say(reason === 'version_conflict'
        ? '다른 운영자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다.'
        : reason === 'already_changed'
          ? '경기 상태가 이미 바뀌었습니다. 최신 상태를 다시 불러왔습니다.'
          : reason === null && classifyFetchError(err) === 'network'
            ? '요청이 서버에 반영되지 않았습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
            : messageFor(target)(err));
      return 'failure';
    } finally {
      lock.current = '';
      if (mounted.current) setBusy('');
    }
  }, [reload, hold, release, latest, say]);

  const call = React.useCallback((m: ActionTarget) => run(
    `call-${m.matchId}`, m,
    { kind: 'call', matchId: m.matchId, version: m.version },
    async () => { await callMatch(m.matchId, m.version); return `M${m.matchNo} 호명했습니다.`; },
  ), [run]);

  const uncall = React.useCallback((m: ActionTarget) => run(
    `uncall-${m.matchId}`, m,
    { kind: 'uncall', matchId: m.matchId, version: m.version },
    async () => { await uncallMatch(m.matchId, m.version); return `M${m.matchNo} 호명을 취소했습니다.`; },
  ), [run]);

  // 투입 = 코트 배정 + 시작. 한 번의 start_match 로 끝난다(예선 · 본선 같은 RPC).
  const start = React.useCallback((m: ActionTarget, courtNo: number) => run(
    `start-${m.matchId}`, m,
    { kind: 'start', matchId: m.matchId, version: m.version, courtNo },
    async () => {
      const r = await startMatch(m.matchId, courtNo, m.version);
      return `M${m.matchNo} · ${r.courtNo}번 코트에서 시작했습니다.`;
    },
  ), [run]);

  // 완료. ⚠ 승자를 보내지 않는다 — 서버가 점수에서 정한다.
  //   본선은 점수 저장 · 승자 전달 · 다음 경기 생성이 서버 한 트랜잭션에서 함께 일어난다.
  const complete = React.useCallback((m: ActionTarget, score1: number, score2: number) => run(
    `complete-${m.matchId}`, m,
    { kind: 'complete', matchId: m.matchId, version: m.version, score1, score2 },
    async () => {
      if (m.stage === 'knockout') {
        return await completeKnockoutMatch(m.matchId, score1, score2, m.version);
      }
      await completeMatch(m.matchId, score1, score2, m.version);
      return `M${m.matchNo} 결과를 저장했습니다.`;
    },
  ), [run]);

  return { busy, toast, call, uncall, start, complete };
}
