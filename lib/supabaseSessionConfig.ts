// @supabase/ssr 쿠키 세션 공용 설정.
//   - 브라우저 클라이언트(lib/supabase.ts, createBrowserClient)와
//     서버 클라이언트(middleware.ts, createServerClient)가 "동일한 auth 쿠키"를 쓰도록 한 곳에서 공유.
//   - @supabase/ssr 은 storageKey 를 auth 세션 쿠키 이름의 base 로 사용한다
//     (예: storageKey='teyeon_auth_session' → 쿠키 teyeon_auth_session / .0 / .1 ...).
//     양쪽 storageKey 가 다르면 middleware 의 getUser() 가 브라우저가 쓴 세션 쿠키를 못 찾는다.
//   - 값 자체는 기존 lib/supabase.ts 와 동일 → 기존 로그인/세션 동작 변경 없음.

export const AUTH_STORAGE_KEY = 'teyeon_auth_session';

export const AUTH_COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 30, // 30 Days (Standard Persistence)
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};
