import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  // 환경변수 체크 - 없으면 통과
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase environment variables not set');
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({
            request: {
              headers: req.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 로그인 페이지는 항상 접근 가능
  if (req.nextUrl.pathname === '/login') {
    // 이미 로그인된 사용자는 메인으로 리다이렉트
    if (user) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return response;
  }

  // API 라우트는 인증 체크 건너뜀
  if (req.nextUrl.pathname.startsWith('/api')) {
    return response;
  }

  // 로그인하지 않은 사용자는 로그인 페이지로 리다이렉트
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
