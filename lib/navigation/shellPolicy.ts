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
