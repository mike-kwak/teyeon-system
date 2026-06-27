import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Create an unmodified response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        // If the cookie is updated, update the request and response objects
        request.cookies.set({
          name,
          value,
          ...options,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({
          name,
          value,
          ...options,
        });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({
          name,
          value: '',
          ...options,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({
          name,
          value: '',
          ...options,
        });
      },
    },
  });

  // Call getSession or getUser to trigger the refresh of the auth token if needed
  const { data: { user } } = await supabase.auth.getUser();

  // ── Admin Console 서버 접근 제어 (/admin/**) ──────────────────────────────
  //   - 클라이언트 redirect 가 아니라 서버(미들웨어)에서 차단 → UI 숨김에만 의존하지 않음.
  //   - Admin Console 접근 = CEO / ADMIN 만(앱 역할 profiles.role). FINANCE_MANAGER 등 기능
  //     담당자는 제외(자동 부여 금지). members.role(클럽 직책)은 사용하지 않는다.
  //   - 장기 기준은 admin_users(supabase/add_admin_users.sql). 적용 후 아래 판정을
  //     is_admin_console_user() RPC 기준으로 교체 권장.
  //   - 실제 데이터 보호는 각 테이블 RLS 가 담당(2차 방어선).
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!user) {
      console.warn('[admin-guard] redirect: no authenticated user');
      return NextResponse.redirect(new URL('/', request.url));
    }
    // profile 조회 — AuthContext 와 동일한 id → email fallback 으로 일치.
    //   1순위: profiles.id = user.id
    //   2순위: id row 없으면, 인증된 user.email 과 profiles.email 정확 일치(이메일 하드코딩 whitelist 아님).
    let role = '';
    let lookup: 'id' | 'email' | 'not-found' = 'not-found';
    try {
      const byId = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (byId.data?.role) {
        role = String(byId.data.role).trim().toUpperCase();
        lookup = 'id';
      } else if (user.email) {
        const byEmail = await supabase
          .from('profiles')
          .select('role')
          .eq('email', user.email)
          .limit(1);
        const emailRole = byEmail.data?.[0]?.role;
        if (emailRole) {
          role = String(emailRole).trim().toUpperCase();
          lookup = 'email';
        }
      }
    } catch {
      // role 조회 실패 — 안전하게 차단. (민감정보 없이 사유만 로그)
      console.warn('[admin-guard] redirect: profile lookup error');
      return NextResponse.redirect(new URL('/', request.url));
    }

    const isAdminConsole = role === 'CEO' || role === 'ADMIN';
    if (!isAdminConsole) {
      // 이메일/토큰은 로그에 남기지 않는다. 진단용 사유만.
      console.warn('[admin-guard] redirect: not admin role', { hasUser: true, lookup, role: role || 'none' });
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return response;
}

export const config = {
  // Matcher for middleware: run on all paths except static files and api
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
