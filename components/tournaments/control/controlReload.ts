// Control Center 재조회 순서 관리 (Batch 4F-4a) — React · DOM · 서버 의존 없음(단독 검증 대상).
//
//   규칙
//     · 조회는 한 번에 하나만 돈다(single-flight). 겹친 요청을 만들지 않는다.
//     · 조회 중에 요청이 들어오면 버리지 않는다 — '끝난 뒤 한 번 더' 로 예약한다.
//       여러 번 들어와도 후속 조회는 하나로 합친다.
//     · request() 가 돌려주는 Promise 는 **요청한 뒤에 시작된** 조회가 끝나야 풀린다.
//       (조작 직후 기다리면 조작 결과가 반영된 조회를 보장받는다.)
//     · dispose() 뒤에는 새 조회를 시작하지 않고, 기다리던 쪽은 모두 곧바로 풀린다.
//   ⚠ 주기 갱신 · 복귀 재조회(4F-4b)도 이 request() 를 그대로 쓴다.

export interface ReloadQueue {
  /** manual = 운영자가 직접 누른 새로고침(표시용 구분). */
  request: (manual?: boolean) => Promise<void>;
  /** 운영자가 누른 새로고침이 아직 끝나지 않았는가. */
  manualPending: () => boolean;
  dispose: () => void;
}

interface Waiter {
  need: number;
  manual: boolean;
  resolve: () => void;
}

/**
 * @param run      한 번 조회한다. ⚠ throw 하지 않아야 한다(던져도 큐는 멈추지 않는다).
 * @param onManual 수동 새로고침 대기 상태가 바뀔 때(버튼 표시용).
 */
export function createReloadQueue(
  run: () => Promise<void>,
  onManual: (pending: boolean) => void = () => {},
): ReloadQueue {
  let seq = 0;           // 지금까지 시작한 조회 번호
  let running = false;
  let again = false;
  let disposed = false;
  let waiters: Waiter[] = [];

  const manualPending = () => waiters.some((w) => w.manual);

  const settle = (done: number) => {
    const before = manualPending();
    const rest: Waiter[] = [];
    waiters.forEach((w) => { if (w.need <= done) w.resolve(); else rest.push(w); });
    waiters = rest;
    if (before && !manualPending() && !disposed) onManual(false);
  };

  const pump = async () => {
    running = true;
    try {
      while (!disposed) {
        again = false;
        const my = ++seq;
        try { await run(); } catch { /* run 은 throw 하지 않는다 — 방어용 */ }
        settle(my);
        if (!again) break;
      }
    } finally {
      running = false;
    }
  };

  return {
    request: (manual = false) => new Promise<void>((resolve) => {
      if (disposed) { resolve(); return; }
      // 지금 도는 조회는 이 요청보다 먼저 시작했다 → 그 **다음** 조회를 기다린다.
      const wasManual = manualPending();
      waiters.push({ need: seq + 1, manual, resolve });
      if (manual && !wasManual) onManual(true);
      if (running) { again = true; return; }
      void pump();
    }),
    manualPending,
    dispose: () => {
      disposed = true;
      const pending = waiters;
      waiters = [];
      pending.forEach((w) => w.resolve());
    },
  };
}
