// BottomNav 표시 정책 단일 소스(single source of truth).
//   RootShell(하단 예약 영역 토큰 --active-bottom-nav-area)과 BottomNav(렌더 여부)가
//   동일 함수를 사용해 판정이 어긋나지 않도록 한다.
//   false 인 경로 = BottomNav 숨김 + GlobalMain 하단 예약을 safe-area 만으로 축소(72px 과잉 여백 제거).
//
//   주의: /admin/** 은 RootShell 이 별도 Admin shell 로 처리하므로 여기서 다루지 않는다.

export function shouldShowBottomNav(pathname: string): boolean {
  const p = pathname || '';

  // Guest Pass / 공개 둘러보기(/club) / 공개 재무 — 앱 내부 chrome 미노출.
  if (p.startsWith('/guest/pass')) return false;
  if (p === '/club' || p.startsWith('/club/')) return false;
  if (p.startsWith('/finance/public')) return false;

  // KDK 전광판(display) — 프로젝터/거치 화면. 하단 nav 숨김.
  if (p === '/kdk/display' || p.startsWith('/kdk/display/')) return false;

  // TENNIS LOG 작성/수정 폼(신규·수정) — 자체 하단 저장 바 사용.
  //   홈/목록/상세(/tennis-log, /tennis-log/tournaments, /tennis-log/tournaments/[id])에서는 유지.
  if (
    p === '/tennis-log/tournaments/new' ||
    p === '/tennis-log/lessons/new' ||
    /^\/tennis-log\/(tournaments|lessons)\/[^/]+\/edit$/.test(p)
  ) {
    return false;
  }

  // 공지 작성/수정 폼 — 목록(/notice)·상세(/notice/[id])는 유지, 정확 경로만 매칭.
  if (p === '/notice/create' || /^\/notice\/edit\/[^/]+$/.test(p)) {
    return false;
  }

  return true;
}
