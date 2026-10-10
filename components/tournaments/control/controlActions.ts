'use client';

// Control Center 조작 래퍼 (Batch 4F-3 · 결과 반환 4F-4a).
//
//   ⚠ 이 파일은 **엔진이 아니다**. 기존 운영 service 를 그대로 부르고,
//     중복 클릭 방지 · 재조회 · 오류 문구만 한 곳에 모은다.
//   ⚠ 여기서 다시 만들지 않는 것: RPC 호출 · 점수 규칙 · 승자 판정 ·
//     코트 검증 · 팀 중복 검증 · version 검증. 전부 기존 service / 서버가 한다.
//   ⚠ 새 오류 체계를 만들지 않는다 — matchActionMessage · bracketActionMessage 를 그대로 쓴다.
//   ⚠ optimistic update 를 하지 않는다. 성공이든 실패든 전체를 다시 읽는다(authoritative refetch).
//   ⚠ 취소 · 복구 · 완료 결과 수정은 이 래퍼에 두지 않는다(기존 경기 운영 · 본선 대진 화면이 맡는다).
//   ⚠ 조작은 성공 여부(boolean)를 돌려준다 — 화면은 **성공했을 때만** 선택을 풀고 모달을 닫는다.
//     실패 · 충돌이면 운영자가 보던 선택과 입력을 그대로 둔다.

import React from 'react';
import {
  callMatch, completeMatch, matchActionMessage, startMatch, uncallMatch,
} from '@/lib/tournaments/matchAdminService';
import { bracketActionMessage, completeKnockoutMatch } from '@/lib/tournaments/bracketAdminService';
import type { ControlMatchRow } from './controlModel';

/** 조작 대상에서 실제로 필요한 것만. 화면이 무엇을 들고 있든 이 네 가지면 된다. */
export type ActionTarget = Pick<ControlMatchRow, 'matchId' | 'matchNo' | 'stage' | 'version'>;

/** 진행 중인 조작의 키. '' 이면 한가하다. 기존 경기 운영 화면과 같은 **전역 1건** 방식이다. */
export type BusyKey = string;

export interface ControlActions {
  busy: BusyKey;
  toast: string;
  /** true = 서버가 받아들였다. false = 거절 · 실패 · 다른 조작이 돌고 있어 시작하지 않음. */
  call: (m: ActionTarget) => Promise<boolean>;
  uncall: (m: ActionTarget) => Promise<boolean>;
  /** ⚠ m.version 은 운영자가 **고른 순간의** version 이어야 한다(최신 조회 값으로 바꿔 넣지 않는다). */
  start: (m: ActionTarget, courtNo: number) => Promise<boolean>;
  /** 완료. 예선이면 complete_match, 본선이면 complete_knockout_match 로 갈린다. */
  /** ⚠ m.version 은 점수 모달을 **연 순간의** version 이어야 한다. */
  complete: (m: ActionTarget, score1: number, score2: number) => Promise<boolean>;
}

/** 본선 경기의 실패 문구는 본선 쪽 사전을 쓴다(없는 reason 은 양쪽 모두 같은 기본 문구). */
const messageFor = (m: ActionTarget) =>
  (m.stage === 'knockout' ? bracketActionMessage : matchActionMessage);

export function useControlActions(reload: () => Promise<void>): ControlActions {
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

  const say = React.useCallback((msg: string) => {
    if (!mounted.current) return;
    setToast(msg);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (mounted.current) setToast('');
    }, 3800);
  }, []);

  /**
   * 조작 공통.
   *   1) 이미 다른 조작이 돌고 있으면 아무 것도 하지 않는다(중복 클릭 방지)
   *   2) service 호출
   *   3) **성공이든 실패든** 전체 재조회 — 화면이 서버 상태를 추측하지 않는다
   *      (reload 는 조회 중이어도 버려지지 않고, 이 조작 **뒤에 시작된** 조회가 끝나야 풀린다)
   *   4) 결과를 한 줄로 알린다 — 최신 상태가 화면에 반영된 다음이다
   *   5) 성공 여부를 돌려준다
   */
  const run = React.useCallback(async (
    key: BusyKey,
    fn: () => Promise<string>,
    toText: (err: unknown) => string,
  ): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = key;
    setBusy(key);
    try {
      const msg = await fn();
      await reload();
      say(msg);
      return true;
    } catch (err) {
      const reason = (err as { reason?: string } | null)?.reason;
      // 다른 운영자가 먼저 바꾼 경우 — 실패가 아니라 '늦었다'. 문구를 따로 둔다.
      const msg = reason === 'version_conflict'
        ? '다른 운영자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다.'
        : reason === 'already_changed'
          ? '경기 상태가 이미 바뀌었습니다. 최신 상태를 다시 불러왔습니다.'
          : toText(err);
      await reload();
      say(msg);
      return false;
    } finally {
      lock.current = '';
      if (mounted.current) setBusy('');
    }
  }, [reload, say]);

  const call = React.useCallback((m: ActionTarget) => run(
    `call-${m.matchId}`,
    async () => { await callMatch(m.matchId, m.version); return `M${m.matchNo} 호명했습니다.`; },
    messageFor(m),
  ), [run]);

  const uncall = React.useCallback((m: ActionTarget) => run(
    `uncall-${m.matchId}`,
    async () => { await uncallMatch(m.matchId, m.version); return `M${m.matchNo} 호명을 취소했습니다.`; },
    messageFor(m),
  ), [run]);

  // 투입 = 코트 배정 + 시작. 한 번의 start_match 로 끝난다(예선 · 본선 같은 RPC).
  const start = React.useCallback((m: ActionTarget, courtNo: number) => run(
    `start-${m.matchId}`,
    async () => {
      const r = await startMatch(m.matchId, courtNo, m.version);
      return `M${m.matchNo} · ${r.courtNo}번 코트에서 시작했습니다.`;
    },
    messageFor(m),
  ), [run]);

  // 완료. ⚠ 승자를 보내지 않는다 — 서버가 점수에서 정한다.
  //   본선은 점수 저장 · 승자 전달 · 다음 경기 생성이 서버 한 트랜잭션에서 함께 일어난다.
  const complete = React.useCallback((m: ActionTarget, score1: number, score2: number) => run(
    `complete-${m.matchId}`,
    async () => {
      if (m.stage === 'knockout') {
        return await completeKnockoutMatch(m.matchId, score1, score2, m.version);
      }
      await completeMatch(m.matchId, score1, score2, m.version);
      return `M${m.matchNo} 결과를 저장했습니다.`;
    },
    messageFor(m),
  ), [run]);

  return { busy, toast, call, uncall, start, complete };
}
