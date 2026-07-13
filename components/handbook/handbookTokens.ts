// TEYEON Digital Handbook — 디자인 토큰(Handoff README §3, 확정값 — 임의 변경 금지).
//   프로젝트 컨벤션(inline style)에 맞춰 TS 상수로 국소화. 전역 CSS 무변경.

export const HB = {
  bg: '#F4F7F9',
  bgWarm: '#FAF9F4',
  surface: '#FFFFFF',
  surfaceSub: '#F1F5F7',
  surfaceSoft: '#F4F8F8',
  textPrimary: '#14263C',
  textSecondary: '#46586C',
  textTertiary: '#7C8B9C',
  textDisabled: '#AEB9C4',
  teal: '#0E8F84',
  tealDeep: '#0B6B63',
  tealGrad: 'linear-gradient(135deg,#16A091,#0B6E63)',
  aqua: '#6FC7BC',
  gold: '#C9A24B',
  goldInk: '#8A6A20',
  border: '#E2E9EE',
  borderSub: '#E9EEF1',
  successBg: '#E3F4F1',
  successInk: '#0B6B63',
  warningBg: '#FBF3DF',
  warningBorder: '#EDD9A8',
  warningInk: '#6B5215',
  dangerBg: '#FFF8F0',   // 실제 저장(amber wash — red 금지)
  dangerBorder: '#F0DCC0',
  dangerInk: '#7A521E',
  device: '#0B1220',
  darkCard: '#0F1B2D',
} as const;

export const HB_SHADOW = {
  card: '0 1px 2px rgba(20,38,60,.05)',
  elevated: '0 1px 2px rgba(20,38,60,.05), 0 10px 30px rgba(20,38,60,.07)',
  selected: '0 10px 26px rgba(20,38,60,.12)',
  stickyVideo: '0 1px 2px rgba(20,38,60,.05), 0 14px 40px rgba(20,38,60,.08)',
  device: '0 24px 60px rgba(11,18,32,.35)',
  ctaTeal: '0 8px 20px rgba(14,143,132,.25)',
} as const;

/** 세리프 포인트 워드 전용(app/handbook/layout.tsx 에서 --font-hb-serif 제공) */
export const HB_SERIF = 'var(--font-hb-serif), "Noto Serif KR", Georgia, serif';

// sticky 기준 주의: GlobalHeader 는 단일 스크롤러(GlobalMain) '바깥' 형제 요소라
// 스크롤포트 상단이 이미 헤더 아래에서 시작한다 → 페이지 내부 sticky top 은 0 기준(헤더 보정 불필요).
