// Arena TV — Signature 디자인 토큰 (/tournaments/arena-design/signature 전용).
//
//   V4 Soft Stadium — Quiet Luxury × Daylight Tennis Championship.
//   Warm Ivory · Soft White 바탕, Deep Navy 글자, 절제된 Cobalt(진출 · 연결선), Muted Slate(보조).
//   강한 색은 LIVE(Navy + 노랑) 하나뿐이다. 결승은 Soft Gold.
//   ⚠ 운영 Arena 토큰(arena/arenaTheme.ts) · Autumn Ivory 토큰(arena-design/ivoryTheme.ts)과 **완전히 분리**된 파일이다.
//   ⚠ 물리 환경: 43인치 16:9 TV. 1920×1080 설계 캔버스 기준 1px ≈ 0.5mm 다.

export const SIG = {
  /** 배경 이미지가 늦게 뜰 때 보일 바탕. */
  bg: '#F6F2EA',
  letterbox: '#1A2238',

  navy: '#14234A',
  navyDeep: '#0E1A38',
  navySoft: '#2A3A62',
  /** 절제된 코발트 — 진출 · 연결선 · 리본 밑줄. (이름은 V3 와 같게 둔다) */
  royal: '#2E5AAC',
  royalBright: '#3D6BC0',
  sky: '#EEF1F6',
  ice: '#F7F5F0',
  white: '#FFFFFF',

  ink: '#14234A',
  inkSoft: '#34425F',
  muted: '#5E6A7E',
  faint: '#9AA3B2',
  /** 일반 칸 · 머리띠 경계선. */
  line: '#E2DED5',
  lineSoft: '#ECE8E0',

  /**
   * 64강 · 32강 레인 판 — TV 실물 검수 2차(10-16): 베이지 판이 TV 에서 노란빛으로 보였다 → 중립 연회색.
   *   흰 경기 카드와 명도 차이를 조금 더 벌린다(1차: rgba(233, 228, 218, 0.94) · 그 전: rgba(252, 250, 245, 0.9)).
   */
  lane: 'rgba(224, 226, 230, 0.96)',
  laneBorder: 'rgba(192, 197, 206, 0.95)',
  /** 64강 · 32강 경기 카드(같은 경기의 두 팀을 한 장으로 묶는다) — 외곽선 · 두 팀 사이 구분선. 판과 같은 중립 계열. */
  matchBorder: '#B6BCC6',
  matchDivider: '#E3E5E9',
  /**
   * 경기 카드 하단 그림자 — 아래로만 최대 3px(경기 칸 사이 틈 3~6px 안), 옆으로는 1px.
   *   인접 카드 · 옆으로 나가는 연결선을 덮지 않는다. 팀이 없는 빈 TBD 카드에는 쓰지 않는다.
   */
  shadowMatch: '0 1px 0 rgba(14, 26, 56, 0.10), 0 2px 2px -1px rgba(14, 26, 56, 0.12)',
  /** BYE 자리(상대가 없는 자리) — 중립 연회색. 아직 정해지지 않은 자리(TBD · 빈칸)와 다르게 글자를 둔다. */
  byeFill: '#E9E7E2',
  byeInk: '#7E8898',
  /** TBD — 아직 아무도 오지 않은 자리(경기 카드 안). 글자 없이 옅은 바탕만. */
  tbdFill: '#F6F4EF',
  /** 아직 아무도 오지 않은 자리. */
  ghost: 'rgba(255, 255, 255, 0.55)',
  ghostBorder: 'rgba(214, 209, 198, 0.9)',

  loserChip: '#EEF0F3',

  /** LIVE — Navy + 노랑(운영진 리뷰 확정: 'LIVE 코트는 노란색으로 즉시 식별'). 화면에서 가장 강한 색은 이것 하나다. */
  live: '#FFD93D',
  liveInk: '#14234A',

  gold: '#C9A04A',
  goldDeep: '#9C7826',
  goldSoft: '#FBF6EA',

  connectorIdle: 'rgba(110, 124, 150, 0.45)',
  /** 연결선 밑 흰 띠 — 경기장 배경 위에서도 선이 묻히지 않게. */
  connectorHalo: 'rgba(255, 255, 255, 0.85)',

  shadowCard: '0 1px 2px rgba(20, 35, 74, 0.08), 0 4px 10px rgba(20, 35, 74, 0.06)',
  /** 예선 조 카드(Raised) — 아래로 최대 8px(조 카드 사이 틈 12px 안), 옆으로는 4px. glow · blur 배경 없음. */
  shadowRaised: '0 1px 0 rgba(14, 26, 56, 0.08), 0 4px 7px -3px rgba(14, 26, 56, 0.24)',
  shadowPill: '0 1px 2px rgba(20, 35, 74, 0.1)',
} as const;

/** 라틴 대문자 헤드라인 · 한글 본문. 글꼴 변수는 상위 경로(arena-design) layout 이 붙인다. */
export const SIG_FONT_DISPLAY = 'var(--font-ivory-display), var(--font-ivory-kr), sans-serif';
export const SIG_FONT_BODY = 'var(--font-ivory-kr), var(--font-ivory-display), sans-serif';

/**
 * 세로 배분(1920×1080 캔버스).
 *   12 + 헤더 96 + 8 + 코트 150 + 10 + 리본 44 + 6 + 대진 744 + 10 = 1080
 */
export const SIG_LAYOUT = {
  padX: 24,
  padTop: 12,
  padBottom: 10,
  headerHeight: 96,
  headerGap: 8,
  courtHeight: 150,
  courtGap: 10,
  courtColumnGap: 10,
  ribbonHeight: 44,
  ribbonGap: 6,
  bodyHeight: 744,
} as const;

/**
 * 코트 현황 위치(프레젠테이션 전용).
 *   bottom = 운영진 리뷰 확정안(기본값): 머리말 → 리본 → 대진 → LIVE COURT STATUS 줄
 *   top    = 이전 V4 배치(비교용, ?courtPosition=top): 머리말 → 코트 카드 10개 → 리본 → 대진
 *   ⚠ 세로 높이 합계는 같다(순서만 바뀐다) — 대진 좌표 · 크기는 두 배치가 똑같다.
 */
export type SignatureCourtPosition = 'top' | 'bottom';
export const courtPositionOf = (v: string | null): SignatureCourtPosition => (v === 'top' ? 'top' : 'bottom');

/** 클럽 모토 — 머리말 대회명 아래. */
export const SIG_MOTTO = 'CONNECTED BY TENNIS';

export const SIG_BOARD_WIDTH = 1920 - SIG_LAYOUT.padX * 2;               // 1872
export const SIG_BOARD_HEIGHT = SIG_LAYOUT.ribbonHeight + SIG_LAYOUT.ribbonGap + SIG_LAYOUT.bodyHeight; // 794

/**
 * 대진 가로 배분 — 열마다 폭이 다르다(바깥 64강이 가장 넓다).
 *   2 × (168 + 152 + 144 × 3) + 결승 208 + 간격 16 × 10 = 1872
 */
export const SIG_COLUMNS = {
  outer: 168,     // 가장 바깥 열(64강)
  second: 152,    // 그 안쪽(32강)
  inner: 144,     // 16강 · 8강 · 4강
  final: 208,
  gap: 16,
  /** 16강 이상 칸 높이 — 칸이 적어 세로 여유가 많다. 중심 y 는 그대로 둔다. */
  innerNodeHeight: 92,      // 알약 42 × 2 + 틈 8 — 긴 영문 이름을 세 줄(이름 / 성 / 짝)까지 담는다
  innerPillGap: 8,
  finalHeight: 148,
} as const;

/**
 * 세로 밀도 단계 — 큰 단계부터 744px 안에 들어가는 첫 단계를 쓴다.
 *   한쪽 가지 높이 = 경기 칸 × card + 부전승 칸 × compact + (칸 수 − 1) × gap
 *   TV 실물 검수(10-16) 후 부전승 칸이 [팀 / BYE] 두 줄 카드가 됐다 — 팀 줄에 두 줄 이름(12.5px × 2)이 들어가도록
 *   부전승 칸을 39px 이상으로 올리고 경기 칸을 그만큼 낮췄다(경기 칸도 두 줄 이름이 들어가는 높이를 지킨다).
 *   36팀(경기 2 + BYE 14): B = 2×64 + 14×39 + 15×4 = 734 · 40팀(경기 4 + BYE 12): C = 4×57 + 12×39 + 15×3 = 741 · 48팀: D = 733
 *   (이전: B 68/38/5 = 743 · C 64/34/4 = 724)
 */
export interface SignatureTier {
  id: 'F1' | 'F2' | 'B' | 'C' | 'D';
  cardHeight: number;
  compactHeight: number;
  rowGap: number;
  /** 경기 칸 안 두 팀 사이 틈. */
  pairGap: number;
  /** 한 줄 이름 기본 · 최소 크기. */
  nameBase: number;
  nameMin: number;
}

export const SIG_TIERS: SignatureTier[] = [
  { id: 'B', cardHeight: 64, compactHeight: 39, rowGap: 4, pairGap: 4, nameBase: 18, nameMin: 15 },
  { id: 'C', cardHeight: 57, compactHeight: 39, rowGap: 3, pairGap: 4, nameBase: 17, nameMin: 14 },
  { id: 'D', cardHeight: 56, compactHeight: 30, rowGap: 3, pairGap: 2, nameBase: 15, nameMin: 13 },
];

/**
 * 표시 모드(프레젠테이션 전용 — 운영진 수동 전환, 자동 전환 없음). 본선 · 예선이 같은 이름 · 같은 주소를 쓴다.
 *   courts = 코트 포함: 하단 코트 10개 스트립 표시
 *   focus  = 코트 미포함: 스트립을 접고, 확보한 160px(코트 150 + 틈 10)을 본선 대진 · 예선 조 순위의 세로 공간에 준다.
 *   ⚠ 경기 단계와 무관하게 언제든 고를 수 있다. 가로 배분과 결승 크기는 두 모드가 같다.
 *   주소: ?view=courts | ?view=focus. 예전 주소도 그대로 열린다 —
 *     semifinal(본선 '4강 확대') · groups(예선 '조 확대') → focus,  full(본선 '전체 보기') → courts.
 */
export type SignatureViewMode = 'courts' | 'focus';
export const SIGNATURE_VIEW_LABEL: Record<SignatureViewMode, string> = { courts: '코트 포함', focus: '코트 미포함' };
/** 버튼 순서(본선 · 예선 공통). */
export const SIGNATURE_VIEW_ORDER: SignatureViewMode[] = ['courts', 'focus'];
/** 주소 값 → 표시 모드. 값이 없거나 모르는 값이면 화면별 기본값. */
export function viewModeOf(v: string | null, fallback: SignatureViewMode): SignatureViewMode {
  if (v === 'focus' || v === 'semifinal' || v === 'groups') return 'focus';
  if (v === 'courts' || v === 'full') return 'courts';
  return fallback;
}

/** 코트 미포함 모드의 대진 본문 높이 = 744 + 코트 줄 150 + 틈 10. */
export const SIG_FOCUS_BODY_HEIGHT = SIG_LAYOUT.bodyHeight + SIG_LAYOUT.courtHeight + SIG_LAYOUT.courtGap;   // 904

/**
 * 코트 미포함 모드 세로 밀도 — 큰 단계부터 904px 안에 들어가는 첫 단계(다 넘치면 일반 단계 B → C → D 로 이어진다).
 *   36팀(경기 2 + BYE 14): F1 = 2×80 + 14×46 + 15×6 = 894
 *   40팀(경기 4 + BYE 12): F2 = 4×74 + 12×42 + 15×6 = 890
 */
export const SIG_FOCUS_TIERS: SignatureTier[] = [
  { id: 'F1', cardHeight: 80, compactHeight: 46, rowGap: 6, pairGap: 4, nameBase: 19, nameMin: 16 },
  { id: 'F2', cardHeight: 74, compactHeight: 42, rowGap: 6, pairGap: 4, nameBase: 18.5, nameMin: 15.5 },
  ...SIG_TIERS,
];
/** 코트 미포함 모드 16강 이상 칸 높이(알약 46 × 2 + 틈 8). */
export const SIG_FOCUS_INNER_NODE_HEIGHT = 100;

/** 코트 줄 접기 · 대진 자리잡기 전환 시간(ms). prefers-reduced-motion 이면 즉시 바뀐다. */
export const SIG_VIEW_TRANSITION_MS = 480;

/** 이름이 이보다 작아지지 않게 한다(TV 가독 하한). */
export const SIG_NAME_FLOOR = 12.5;

/** 코트 번호 두 자리 표기(COURT 01). */
export const courtCode = (n: number): string => String(n).padStart(2, '0');
