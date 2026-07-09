import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_STORAGE_KEY, AUTH_COOKIE_OPTIONS } from '@/lib/supabaseSessionConfig';
import { canAccessAdminRoute } from '@/lib/admin/adminAccess';

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
    // 브라우저 클라이언트(lib/supabase.ts)와 동일한 auth 쿠키 이름/속성을 사용해야
    // getUser() 가 브라우저가 쓴 세션 쿠키를 읽을 수 있다(쿠키 이름 = storageKey).
    auth: { storageKey: AUTH_STORAGE_KEY },
    cookieOptions: AUTH_COOKIE_OPTIONS,
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
  //   - Admin Console 접근 = profiles.role 기준(members.role/클럽 직책 미사용).
  //     · /admin/settings, /admin/guide-recording → CEO/ADMIN/OPERATOR/FINANCE_MANAGER 허용(조회·Guide).
  //     · 그 밖의 /admin/**                        → CEO/ADMIN 만(기존 정책). 판정은 lib/admin/adminAccess.
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

    // /admin/ranking 은 CEO OR ranking_managers 만 — role 로 결정되지 않으므로 서버에서 helper 로 판정.
    //   (다른 /admin 경로에서는 불필요한 RPC 호출을 피하기 위해 이 경로에서만 조회)
    let isRankingManager = false;
    if (request.nextUrl.pathname.startsWith('/admin/ranking')) {
      try {
        const { data: canManage } = await supabase.rpc('can_manage_ranking');
        isRankingManager = canManage === true;
      } catch {
        isRankingManager = false; // RPC 미생성/실패 → CEO 만 role 로 통과(안전)
      }
    }

    // route 별 접근 판정(단일 출처). 운영진/FINANCE_MANAGER 는 settings·guide 만 허용.
    if (!canAccessAdminRoute(request.nextUrl.pathname, role, { isRankingManager })) {
      // 이메일/토큰은 로그에 남기지 않는다. 진단용 사유만.
      console.warn('[admin-guard] redirect: route not allowed for role', { hasUser: true, lookup, role: role || 'none' });
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return response;
}

export const config = {
  // Matcher: /admin/** 에서만 실행.
  //   이 미들웨어의 유일한 책임은 Admin Console 서버 접근 제어(getUser + profiles.role 판정)다.
  //   이전에는 전 라우트에서 실행되어 모든 문서 요청 TTFB 에 supabase.auth.getUser() 네트워크 왕복이
  //   추가됐다(전 화면 로딩 지연·지터의 주원인). 일반 라우트의 세션 유지/토큰 갱신은
  //   브라우저 클라이언트(lib/supabase.ts, autoRefreshToken)가 전담하며, 서버 컴포넌트/route handler/
  //   server action 어디에서도 세션 쿠키를 읽지 않음을 전수 확인함(createServerClient 사용처 = 이 파일뿐).
  //   ':path*' 는 0개 이상 세그먼트 → /admin 및 /admin/** 모두 매칭.
  matcher: ['/admin/:path*'],
};
