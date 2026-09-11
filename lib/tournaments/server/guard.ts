// 서버 전용 모듈 가드.
//
//   이 프로젝트에는 'server-only' 패키지가 없으므로 동등한 런타임 가드를 직접 둔다.
//   실제 1차 방어선은 번들러다 — TURNSTILE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY 는
//   NEXT_PUBLIC_ 접두어가 없으므로 Next 가 클라이언트 번들에서 process.env 접근을
//   undefined 로 치환한다. 즉 값 자체가 브라우저로 갈 수 없다.
//   아래 가드는 그 위에 얹는 2차 방어선으로, 서버 모듈을 실수로 클라이언트 컴포넌트에서
//   import 했을 때 조용히 동작하지 않고 즉시 터지게 한다.

export function assertServerOnly(moduleName: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(`[server-only] ${moduleName} 은(는) 브라우저에서 import 할 수 없습니다.`);
  }
}
