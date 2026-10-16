// 경기 경과 시간 — 표시용 순수 함수 (타이머 1단계).
//
//   ⚠ 시각은 전부 서버 값이다. 시작 = play_started_at(start_hosted_match_timer 가 기록),
//     완료 = completed_at. 화면은 기기 시계를 서버 시계에 맞춰(serverNow) 차이만 계산한다.
//   ⚠ 코트 투입(started_at)은 시작이 아니다 — 투입 직후 타이머는 돌지 않는다('시작 대기').
//   ⚠ 서버(get_admin_match_board)가 유효한 값만 주지만, 화면도 한 번 더 거른다
//     (취소 → 복구 → 재투입 뒤 남은 예전 시작 시각 · 완료보다 늦은 시작 = 음수 소요).
//   ⚠ 보드에 serverNow 가 없으면(타이머 SQL 이전 서버) 타이머 기능 자체를 쓰지 않는다 — 버튼 · 시간 모두 숨긴다.
//   ⚠ React · DOM · 서버 의존 없음.

/** ISO 시각 → ms. 없거나 읽을 수 없으면 null. */
export function timeMs(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** 서버 시계 보정값(ms) — 서버 시각 = Date.now() + offset. serverNow 가 없으면 null(타이머 미지원). */
export function clockOffset(serverNowMs: number | null | undefined, receivedAtMs: number | null | undefined): number | null {
  if (typeof serverNowMs !== 'number' || !Number.isFinite(serverNowMs)) return null;
  if (typeof receivedAtMs !== 'number' || !Number.isFinite(receivedAtMs)) return null;
  return serverNowMs - receivedAtMs;
}

/** 경기 한 건의 타이머에 필요한 값. */
export interface MatchTimerInput {
  status: string;
  startedAt?: string | null;
  playStartedAt?: string | null;
  completedAt?: string | null;
}

export type MatchTimerState =
  /** 진행 중 · 시작 전(코트 투입만 됨) — '경기 시작' 버튼 / '시작 대기'. */
  | { kind: 'not_started' }
  /** 진행 중 · 시작됨 — 서버 시작 시각부터 흐른다. */
  | { kind: 'running'; startMs: number }
  /** 완료 · 시작 기록 있음 — completedAt − playStartedAt 으로 고정. */
  | { kind: 'finished'; durationMs: number }
  /** 완료 · 시작 기록 없음(시작 없이 완료 · 예전 값 무효). */
  | { kind: 'no_record' }
  /** 대기 · 호명 · 취소 — 타이머를 보이지 않는다. */
  | { kind: 'none' };

/**
 * 타이머 상태.
 *   시작 시각은 '이번 투입' 의 것일 때만 쓴다: playStartedAt ≥ startedAt (투입 시각이 없으면 쓰지 않는다).
 *   완료 경기는 completedAt ≥ playStartedAt 일 때만 시간을 고정한다(아니면 기록 없음).
 */
export function matchTimerState(m: MatchTimerInput): MatchTimerState {
  if (m.status !== 'playing' && m.status !== 'completed') return { kind: 'none' };
  const started = timeMs(m.startedAt);
  const play = timeMs(m.playStartedAt);
  const valid = play !== null && started !== null && play >= started;
  if (m.status === 'playing') return valid ? { kind: 'running', startMs: play } : { kind: 'not_started' };
  const done = timeMs(m.completedAt);
  if (!valid || done === null || done < play) return { kind: 'no_record' };
  return { kind: 'finished', durationMs: done - play };
}

/** 진행 중 경과(ms) — 기기 시계를 서버 시계로 보정한다. 음수는 0. */
export function runningMs(startMs: number, deviceNowMs: number, offsetMs: number): number {
  return Math.max(0, deviceNowMs + offsetMs - startMs);
}

/** MM:SS, 1시간 이상 H:MM:SS (KDK 와 같은 표기). 초 미만은 버린다. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
