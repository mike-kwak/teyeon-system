// Control Center 재조회 순서 관리 (Batch 4F-4a · epoch / 조작 보류 4F-4b)
//   — React · DOM · 서버 의존 없음(단독 검증 대상).
//
//   규칙
//     · 조회는 한 번에 하나만 돈다(single-flight). 겹친 요청을 만들지 않는다.
//     · 조회 중에 요청이 들어오면 버리지 않는다 — '끝난 뒤 한 번 더' 로 예약한다.
//       여러 번 들어와도 후속 조회는 하나로 합친다.
//     · request() 가 돌려주는 Promise 는 **요청한 뒤에 시작되어 반영된** 조회가 끝나야 풀린다.
//       (조작 직후 기다리면 조작 결과가 반영된 조회를 보장받는다.)
//     · epoch — 조작이 시작되면(hold) epoch 가 올라간다. 그 전에 시작한 조회의 응답은
//       도착해도 **반영하지 않고 버린다**(조작 전 화면이 조작 뒤에 잠깐 되살아나지 않게).
//       버린 조회로는 아무도 풀어 주지 않는다 — 다음에 반영되는 조회가 풀어 준다.
//     · hold ~ release 사이(조작 RPC 가 도는 동안)에는 새 조회를 시작하지 않는다.
//       그 사이 들어온 요청(주기 갱신 · 복귀 신호)은 모아 두었다가 조작 후 재조회 한 번으로 합친다.
//     · dispose() 뒤에는 새 조회를 시작하지 않고, 기다리던 쪽은 모두 곧바로 풀린다.

export interface ReloadQueue {
  /** manual = 운영자가 직접 누른 새로고침(표시용 구분). */
  request: (manual?: boolean) => Promise<void>;
  /** 조작 시작 — epoch 를 올리고 새 조회를 멈춘다. 반드시 release 와 짝을 맞춘다. */
  hold: () => void;
  /** 조작 끝 — 멈춘 동안 쌓인 요청이 있으면 조회를 다시 시작한다. */
  release: () => void;
  /** 운영자가 누른 새로고침이 아직 끝나지 않았는가. */
  manualPending: () => boolean;
  dispose: () => void;
}

interface Waiter {
  need: number;
  manual: boolean;
  resolve: () => void;
}

export interface ReloadQueueOptions<R> {
  /** 한 번 조회한다. ⚠ throw 하지 않아야 한다(던져도 큐는 멈추지 않는다 — 그 회차는 버린다). */
  fetch: () => Promise<R>;
  /** 조회 결과를 화면에 반영한다. **그 조회를 시작한 뒤 조작이 없었을 때만** 불린다. */
  apply: (result: R) => void;
  /** 수동 새로고침 대기 상태가 바뀔 때(버튼 표시용). */
  onManual?: (pending: boolean) => void;
}

export function createReloadQueue<R>(opts: ReloadQueueOptions<R>): ReloadQueue {
  const { fetch, apply } = opts;
  const onManual = opts.onManual ?? (() => {});
  let seq = 0;           // 지금까지 시작한 조회 번호
  let epoch = 0;         // 조작이 시작될 때마다 오른다
  let running = false;
  let again = false;
  let held = 0;          // hold 중첩 수(정상이면 0 또는 1)
  let disposed = false;
  let waiters: Waiter[] = [];

  const manualPending = () => waiters.some((w) => w.manual);

  /** 반영된 조회 번호까지 기다리던 쪽을 푼다. */
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
      while (!disposed && held === 0) {
        again = false;
        const my = ++seq;
        const myEpoch = epoch;
        let result: R | undefined;
        let ok = false;
        try { result = await fetch(); ok = true; } catch { /* fetch 는 throw 하지 않는다 — 방어용 */ }
        if (disposed) break;
        if (!ok) {
          // 방어용 — fetch 가 던졌다. 반영할 것이 없으니 이 회차를 기다리던 쪽만 푼다(무한 재시도 금지).
          settle(my);
        } else if (myEpoch === epoch) {
          apply(result as R);
          settle(my);
        } else {
          // 조작이 끼어든 조회 — 반영하지 않는다. 기다리던 쪽은 다음(조작 뒤) 조회가 푼다.
          again = true;
        }
        if (!again || waiters.length === 0) break;
      }
    } finally {
      running = false;
    }
  };

  const kick = () => { if (!running && !disposed && held === 0 && waiters.length > 0) void pump(); };

  return {
    request: (manual = false) => new Promise<void>((resolve) => {
      if (disposed) { resolve(); return; }
      // 지금 도는 조회는 이 요청보다 먼저 시작했다 → 그 **다음** 조회를 기다린다.
      const wasManual = manualPending();
      waiters.push({ need: seq + 1, manual, resolve });
      if (manual && !wasManual) onManual(true);
      if (running) { again = true; return; }
      kick();
    }),
    hold: () => {
      if (disposed) return;
      held += 1;
      epoch += 1;          // 지금 도는 조회는 반영하지 않는다
    },
    release: () => {
      if (disposed || held === 0) return;
      held -= 1;
      // 조작 후 재조회(request)가 곧바로 이어지면 그쪽이 시작한다. 아무도 안 부르면 여기서 시작한다.
      queueMicrotask(kick);
    },
    manualPending,
    dispose: () => {
      disposed = true;
      const pending = waiters;
      waiters = [];
      pending.forEach((w) => w.resolve());
    },
  };
}
