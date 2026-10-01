// Arena TV 디자인 토큰 (Batch 4E-1).
//
//   LIGHT ARENA — 밝은 바탕 위에 Deep Navy 코트 줄 하나가 시선의 기준점이 된다.
//   ⚠ 공개 Hub 토큰(tournamentTheme.ts)에서 파생만 한다. 그 파일은 수정하지 않는다.
//   ⚠ 색을 많이 쓰지 않는다 — 90% 는 조용하고, 10%(진행 중)만 살아 있다.
//     neon · glow · gradient · glass · 과한 둥근 모서리를 쓰지 않는다.
//
//   물리 환경: 32인치 16:9 TV 를 비교적 가까이서 본다. 거대 타이포가 아니라
//   '정보 밀도 + 빠른 판독' 이 기준이다. 최종 치수는 실제 TV 에서 다시 맞춘다.

import { TT, FONT_LABEL, FONT_BODY } from '@/components/tournaments/tournamentTheme';

export const ARENA = {
  /** 바탕 — Cool White. */
  bg: '#F7F9FB',
  /** 보드 면. */
  surface: TT.surface,
  line: '#E2E8EE',
  lineSoft: '#EDF1F5',
  /**
   * 조 순위 벽의 구획선 — Very Light Blue Gray.
   *   카드가 아니라 '현황판의 구획선'이다. 32인치 TV 에서 옆 조와 구분될 만큼만 진하고,
   *   그 이상 올리면 20개의 카드처럼 보이기 시작한다.
   */
  wallLine: '#D6DEE7',

  ink: TT.navy,          // Deep Navy — 가장 중요한 글자
  inkSoft: '#2F4A60',
  muted: '#64788A',
  faint: '#93A5B4',

  /** 코트 줄 바탕 — Deep Navy. */
  strip: TT.navy,
  stripSoft: '#17384F',
  stripLine: '#24506C',
  /** Navy 위 글자. */
  onStrip: '#F2F7FA',
  onStripMuted: '#7E9AAE',

  /** 진행 중 — TEYEON Aqua. 화면에서 유일하게 '살아 있는' 색이다. */
  live: TT.tealOnNavy,
  liveInk: '#0B2432',
  /** 밝은 면 위에서 쓰는 Teal. */
  teal: TT.teal,

  /** 결승·우승 전용(4E-3 에서 사용). 절제된 Soft Gold. */
  gold: '#C9A227',
  goldSoft: '#F6EFD8',
} as const;

export const ARENA_FONT_LABEL = FONT_LABEL;
export const ARENA_FONT_BODY = FONT_BODY;

/** 설계 캔버스 — 실제 화면 크기와 무관하게 이 좌표로 그린다. */
export const ARENA_CANVAS = { width: 1920, height: 1080 } as const;

/** 세로 구성 — 머리말 · 코트 줄은 높이가 고정이고, 남은 높이를 본문이 쓴다. */
export const ARENA_LAYOUT = {
  padX: 36,
  padY: 24,
  headerHeight: 84,
  stripHeight: 168,
  gap: 20,
} as const;

/** 본문(Main Board)이 쓸 수 있는 높이. 4E-2 · 4E-3 이 이 값을 기준으로 들어간다. */
export const arenaBoardHeight = (): number =>
  ARENA_CANVAS.height
  - ARENA_LAYOUT.padY * 2
  - ARENA_LAYOUT.headerHeight
  - ARENA_LAYOUT.stripHeight
  - ARENA_LAYOUT.gap * 2;

/** 본문 안쪽 폭(테두리 1px 양쪽 제외). 화면을 재지 않고 계산만으로 배치하기 위해 쓴다. */
export const arenaBoardWidth = (): number =>
  ARENA_CANVAS.width - ARENA_LAYOUT.padX * 2 - 2;
