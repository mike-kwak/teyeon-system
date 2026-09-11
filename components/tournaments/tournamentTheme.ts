// 2026 TEYEON OPEN — 공개 Tournament Hub 디자인 토큰 (Cool Premium Light).
//   ⚠️ 이 디렉터리(components/tournaments, 복수형)는 "TEYEON 이 주최하는 외부 공개 대회" 전용이다.
//      단수형 components/tournament/** 는 내부 KDK/스페셜매치 운영 UI 이므로 혼동 금지.
//
//   승인된 Claude Design 시안(Tournament Public Landing) 기준.
//   금지: 과도한 gradient / neon·glow / glassmorphism 남발 / stock photo / 작은 폰트.

export const TT = {
  /** 페이지 바탕 — Very Light Gray(Cool). */
  bg: '#F4F6F8',
  surface: '#FFFFFF',
  /** 정보 밴드용 아주 옅은 쿨 틴트. */
  tint: '#EDF3F5',

  ink: '#0F172A',
  inkSoft: '#334155',
  muted: '#64748B',
  subtle: '#94A3B8',
  /** 준비중 네비 등 비활성 텍스트. 대비 확보를 위해 과하게 밝히지 않는다. */
  faint: '#AFBAC6',

  line: '#E3E9ED',
  lineSoft: '#F0F4F6',

  /** Primary — TEYEON Teal. */
  teal: '#0E8C80',
  tealDeep: '#0A6F65',
  tealSoft: '#E7F3F1',
  /** Deep Navy 위에서 쓰는 밝은 아쿠아. */
  tealOnNavy: '#3ED6C0',

  /** Strong Brand — Deep Navy(공식 포스터 계열). */
  navy: '#102A3D',
  navySoft: '#1A3C53',

  /** Tennis Yellow — 포인트 한정 사용(면적 최소). */
  yellow: '#E5E10B',
} as const;

/** 소문자 한글 본문 + 라틴 대문자 라벨 폰트. */
export const FONT_LABEL = 'var(--font-rajdhani), sans-serif';
export const FONT_BODY = 'var(--font-geist), sans-serif';

/** 공개 Hub 콘텐츠 최대 폭(RootShell 450px 셸 내부). */
export const TT_MAX_WIDTH = 430;

/** 섹션 좌우 여백 — 320px 에서도 본문이 눌리지 않는 값. */
export const TT_GUTTER = 18;
