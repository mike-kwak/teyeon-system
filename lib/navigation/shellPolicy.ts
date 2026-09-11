// 셸 '폭' 정책 단일 소스 — Handbook 전용 desktop wide shell.
//   표시 여부 정책(bottomNavPolicy.ts)과는 분리된 축이다(그 파일에 폭 정책 추가 금지).
//   RootShell(셸 maxWidth) · GlobalHeader(내부 콘텐츠 행) · BottomNav(바 폭)가
//   동일 판정을 공유해 세 크롬의 폭이 어긋나지 않도록 한다.
//   일반 화면 450px 정책은 여기서 다루지 않는다(변경 금지 영역).

/** Handbook wide shell 최대 폭(px). 컨테이너 쿼리 two-pane(≥1024)·에디토리얼 그리드(≥1280) 상한. */
export const WIDE_SHELL_MAX = 1280;

/** wide shell 적용 경로 — /handbook 및 모든 하위 경로. */
export function isWideShellPath(pathname: string): boolean {
  const p = pathname || '';
  return p === '/handbook' || p.startsWith('/handbook/');
}

/**
 * 셸 전체 폭(모바일 컨테이너 해제) 경로 — 공개 Tournament 영역 전용.
 *   /tournaments 는 QR 로 들어오는 외부 참가자용 공식 대회 사이트다. PC 로 열었을 때
 *   450px 컬럼 + 좌우 검정 배경으로 보이지 않도록 셸을 화면 폭까지 펼친다.
 *   내부 콘텐츠 폭 제한은 components/tournaments/tournamentShell.css(.tt-container)가 담당한다.
 *
 *   ⚠ 반드시 복수형 '/tournaments' 만 매칭한다. '/tournament' 로 매칭하면
 *      내부 KDK 화면(/tournament, /tournament/manual)과 회원 대회 캘린더(/tournament-calendar)의
 *      기존 모바일 셸까지 함께 풀려버린다.
 */
export function isFullWidthShellPath(pathname: string): boolean {
  const p = pathname || '';
  return p === '/tournaments' || p.startsWith('/tournaments/');
}
