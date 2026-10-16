// Signature 운영 연결 — 표시용 변환 (순수 함수만, /tournaments/[slug]/signature/* 전용).
//
//   데이터 조회는 운영 Arena 와 같은 훅(useArenaData)이 한다 — 같은 운영 RPC · 같은 10초 갱신 · 같은 실패 정책.
//   여기서는 정규화된 ArenaSnapshot / ArenaState 를 Signature 화면 모양으로 옮기기만 한다.
//   ⚠ 순위 · 승자 · 경기 상태를 계산하지 않는다(서버 값을 그대로 옮긴다).
//   ⚠ NEXT(코트별 다음 경기)는 운영 데이터에 없다 → 항상 null('미정'). 호명(calling) 경기를 NEXT 로 쓰지 않는다.
//   ⚠ 코트 상태는 저장된 courts.status(active / disabled)와 playing 경기에서만 온다. 없는 상태를 만들지 않는다.

import { arenaCourtSlots } from '@/components/tournaments/arena/ArenaCourtStrip';
import type { getOfficialTournament } from '@/lib/tournaments/officialInfo';

/** 공식 대회 정보(officialInfo 가 타입을 내보내지 않아 반환 타입에서 꺼낸다). */
type OfficialTournament = NonNullable<ReturnType<typeof getOfficialTournament>>;
import type { ArenaBracket, ArenaCourtMatch, ArenaSnapshot, ArenaState } from '@/lib/tournaments/arenaTypes';
import type { CourtBoardCourt, CourtBoardMatch } from './signatureCourtBoardFixture';
import type { SignatureEventInfo } from './SignatureHeader';

// ── 머리말 대회 정보 ─────────────────────────────────────────────────────────

const DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 공식 대회 정보 → 머리말 값. 날짜는 공식 정보의 ISO 날짜에서만 만든다. */
export function liveEventInfo(
  t: OfficialTournament, stage: SignatureEventInfo['stage'],
): SignatureEventInfo {
  const [y, m, d] = t.eventDateISO.split('-').map(Number);
  const day = DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return {
    year: t.year,
    tagline: t.subtitleEn,
    date: `${y}. ${String(m).padStart(2, '0')}. ${String(d).padStart(2, '0')} (${day})`,
    venue: t.venueName,
    stage,
  };
}

// ── 코트 전광판 ──────────────────────────────────────────────────────────────

/** 코트에서 진행 중인 경기의 단계 문구 — 저장된 stage · 조 번호 · 본선 라운드 이름에서만. */
export function liveStageLabel(now: ArenaCourtMatch, bracket: ArenaBracket | null): string {
  if (now.stage === 'knockout') {
    const m = bracket?.matches.find((x) => x.matchNo === now.matchNo);
    return m?.roundName ? `본선 ${m.roundName}` : '본선';
  }
  if (now.stage === 'placement') return '순위결정전';
  return now.groupNo !== null ? `예선 ${now.groupNo}조` : '예선';
}

/**
 * 스냅샷 → 코트 전광판 1~10.
 *   자리 배정은 운영 코트 줄과 같은 함수(arenaCourtSlots)를 쓴다. 등록되지 않은 자리는 registered=false.
 *   NOW = 그 코트의 playing 경기(정규화가 이미 골라 둔 값). NEXT = 항상 null(운영 데이터에 없음 → '미정').
 */
export function courtBoardFromSnapshot(snapshot: ArenaSnapshot): CourtBoardCourt[] {
  return arenaCourtSlots(snapshot.courts).map((cell) => {
    const c = cell.court;
    if (!c) {
      return { courtNo: cell.key, displayName: null, active: false, registered: false, now: null, next: null };
    }
    const offset = snapshot.clockOffset ?? null;
    const now: CourtBoardMatch | null = c.now
      ? {
          matchNo: c.now.matchNo, stageLabel: liveStageLabel(c.now, snapshot.bracket), team1: c.now.team1, team2: c.now.team2,
          // 경과 시간 — Control Center 와 같은 서버 시작 시각 · 같은 서버 시계 보정. 타이머 미지원 서버면 넣지 않는다.
          ...(offset !== null ? { timer: { startMs: c.now.playStartMs ?? null, offsetMs: offset } } : {}),
        }
      : null;
    return {
      courtNo: c.courtNo,
      displayName: c.displayName,
      active: c.active,
      registered: true,
      now: c.active ? now : null,
      next: null,
    };
  });
}

// ── 연결 상태 ────────────────────────────────────────────────────────────────

/** 마지막 성공 뒤 이 시간이 지나면 '갱신 지연'으로 본다(10초 갱신 × 3). */
export const LIVE_STALE_AFTER_MS = 30_000;

export type LiveStatusKind = 'loading' | 'unauthorized' | 'failed' | 'live' | 'stale';

export interface LiveStatus {
  kind: LiveStatusKind;
  /** 마지막으로 성공한 시각(없으면 null). */
  updatedAt: number | null;
}

/**
 * 화면 상태.
 *   · 보여 줄 데이터가 없으면 loading / unauthorized / failed.
 *   · 데이터가 있으면 live, 단 배경 갱신이 실패했거나(stale) 마지막 성공이 오래됐으면 stale.
 *   ⚠ 갱신 실패 중에도 마지막 정상 데이터는 그대로 보인다(화면을 비우지 않는다) — 대신 stale 로 분명히 알린다.
 */
export function liveStatusOf(state: ArenaState, nowMs: number): LiveStatus {
  if (!state.snapshot) {
    const kind: LiveStatusKind = !state.authorized ? 'unauthorized' : state.failed ? 'failed' : 'loading';
    return { kind, updatedAt: state.updatedAt };
  }
  if (!state.authorized) return { kind: 'unauthorized', updatedAt: state.updatedAt };
  const old = state.updatedAt !== null && nowMs - state.updatedAt > LIVE_STALE_AFTER_MS;
  return { kind: state.stale || old ? 'stale' : 'live', updatedAt: state.updatedAt };
}

/** HH:MM:SS (기기 시간대). */
export const clockText = (ms: number | null): string => {
  if (ms === null) return '—';
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};
