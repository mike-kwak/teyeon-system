// TEYEON Digital Handbook — 정적 가이드 데이터(1차).
//   완전 콘텐츠: member-ranking (첫 프로토타입 — Handoff §10 예시 기준).
//   그 외 모듈은 목차/홈 구조 확인용 placeholder(DRAFT) — 상세 진입 시 "영상·내용 준비 중" 처리.
//   ⚠ 제외 라우트(Handoff §15): /club/members, /prediction, /results, 구 /special, 구 /tournament 등은 연결하지 않는다.

import {
  AUDIENCE_TO_SLUG,
  type AudienceMeta,
  type GuideModule,
  type HandbookAudience,
  type HandbookChapter,
} from './types';

export const AUDIENCES: AudienceMeta[] = [
  { id: 'MEMBER', slug: 'member', label: '회원', tagline: '정모 참여부터 기록·랭킹·회비까지', accent: '#0E8F84', accentInk: '#FFFFFF', previewLabel: 'Ranking 화면' },
  { id: 'OPERATOR', slug: 'operator', label: '운영진', tagline: '일정·KDK 운영·공식 기록·게스트 관리', accent: '#14263C', accentInk: '#FFFFFF', previewLabel: 'Admin 화면' },
  {
    id: 'INVITED_GUEST', slug: 'invited-guest', label: '초대받은 게스트', tagline: 'Guest Pass 하나로 정모 참여 준비 끝',
    accent: '#C9A24B', accentInk: '#3D2E08', previewLabel: 'Guest Pass 화면',
    description: 'TEYEON Guest Pass를 받은 게스트가 참가 전 확인해야 할 일정, 장소, 준비물, 경기 흐름을 안내합니다.',
  },
  {
    id: 'PUBLIC_GUEST', slug: 'public-guest', label: '처음 방문한 게스트', tagline: 'TEYEON 둘러보기와 게스트 신청',
    accent: '#6FC7BC', accentInk: '#0B3C36', previewLabel: '공개 홈 화면',
    description: 'TEYEON을 처음 알게 된 분이 클럽을 둘러보고 게스트 참가 신청 흐름을 이해할 수 있도록 안내합니다.',
  },
];
export const audienceMeta = (id: HandbookAudience): AudienceMeta => AUDIENCES.find((a) => a.id === id)!;

// ── 챕터 (회원 9챕터 = Handoff §5.B, 타 대상은 1차 골격만) ───────────────────
export const CHAPTERS: HandbookChapter[] = [
  { audience: 'MEMBER', order: 1, title: '시작하기' },
  { audience: 'MEMBER', order: 2, title: '일정과 정모 참여' },
  { audience: 'MEMBER', order: 3, title: 'KDK 경기' },
  { audience: 'MEMBER', order: 4, title: '공식 기록' },
  { audience: 'MEMBER', order: 5, title: 'Ranking' },
  { audience: 'MEMBER', order: 6, title: '회원 간 기록' },
  { audience: 'MEMBER', order: 7, title: '프로필과 개인 기록' },
  { audience: 'MEMBER', order: 8, title: '회비' },
  { audience: 'MEMBER', order: 9, title: 'TEYEON 문화와 도움말' },
  { audience: 'OPERATOR', order: 1, title: '일정 운영' },
  { audience: 'OPERATOR', order: 2, title: 'KDK 운영' },
  { audience: 'OPERATOR', order: 3, title: '게스트 관리' },
  { audience: 'INVITED_GUEST', order: 1, title: 'Guest Pass 사용하기' },
  { audience: 'INVITED_GUEST', order: 2, title: '정모 당일과 결과' },
  { audience: 'PUBLIC_GUEST', order: 1, title: 'TEYEON 둘러보기' },
  { audience: 'PUBLIC_GUEST', order: 2, title: '게스트 신청' },
];

const T = '2026-07-13T00:00:00+09:00';
const T_GUEST = '2026-07-21T00:00:00+09:00'; // 게스트 MVP(2차) 작성일

// placeholder 모듈 생성 헬퍼 — 목차 구조 확인용(DRAFT, 상세는 "준비 중" 표시).
const draft = (
  id: string, title: string, audience: HandbookAudience, chapter: string, route: string, summary: string,
  extra?: Partial<GuideModule>,
): GuideModule => ({
  id, title, audience: [audience], chapter, route, summary,
  prerequisites: [], steps: [], warnings: [],
  write_mode: 'READ_ONLY', privacy_level: 'LOW',
  recording_status: 'NOT_STARTED', handbook_status: 'DRAFT',
  related_modules: [], updated_at: T,
  ...extra,
});

export const MODULES: GuideModule[] = [
  // ── 첫 프로토타입: 회원 Ranking (완전 콘텐츠) ─────────────────────────────
  {
    id: 'member-ranking',
    title: 'TEYEON Ranking 확인하기',
    audience: ['MEMBER'],
    chapter: 'Ranking',
    route: '/ranking',
    summary: '공식 KDK 기록을 기준으로 시즌·월간·누적 랭킹과 주요 Awards를 확인할 수 있습니다.',
    prerequisites: ['회원 로그인', '공식 KDK 기록 존재'],
    steps: [
      '메인 화면에서 Ranking을 엽니다.',
      '시즌·월간·누적 기간을 선택합니다.',
      'TOP3와 전체 순위를 확인합니다.',
      '이전 시즌 FINAL을 확인합니다.',
      'Awards를 확인합니다.',
      '회원을 선택해 PlayerCard를 확인합니다.',
    ],
    warnings: ['공식 KDK 기록만 반영됩니다.', 'LIVE와 FINAL 시즌을 구분해서 표시합니다.'],
    write_mode: 'READ_ONLY',
    privacy_level: 'LOW',
    // 실제 영상 v01(2026-07-14 연결): 444×1308 세로, 44.4s, 9.0MB.
    //   장면: 메인→Ranking 진입→시즌→월간→누적→산정 기준→PlayerCard.
    //   ⚠ 이전 시즌 FINAL·Awards 장면 없음(종료 시즌 데이터 부재) — 시즌 종료 후 v02 재촬영.
    video_file: '/handbook/videos/member-ranking-overview-v01.mp4',
    poster_file: '/handbook/posters/member-ranking-overview-v01.webp', // t=9.0s 시즌 랭킹 프레임
    duration: 44.4,
    recording_status: 'RECORDED',
    handbook_status: 'READY',
    related_modules: ['member-head-to-head', 'member-archive', 'member-playercard'],
    updated_at: T,
    keywords: ['랭킹', '순위', '시즌', '어워즈', 'FINAL', '월간', '누적'],
  },

  // ── 회원 placeholder (챕터 구조 확인용) ──────────────────────────────────
  draft('member-install', '앱 설치와 로그인', 'MEMBER', '시작하기', '/', '홈 화면 추가와 카카오 로그인으로 TEYEON을 시작합니다.', { keywords: ['설치', '로그인', '카카오'] }),
  draft('member-home', '메인 화면 둘러보기', 'MEMBER', '시작하기', '/', 'TEYEON BOARD·다음 일정·주요 메뉴를 한눈에 봅니다.'),
  draft('member-calendar', 'TEYEON 일정 확인', 'MEMBER', '일정과 정모 참여', '/tournament-calendar', '정모·번개·대회 일정을 캘린더에서 확인합니다.', { keywords: ['일정', '캘린더'] }),
  draft('member-attendance', '정모 참석 응답하기', 'MEMBER', '일정과 정모 참여', '/tournament-calendar', '참석·불참·시간을 선택하고 명단을 확인합니다.', { write_mode: 'WRITES_DATA', keywords: ['참석', '정모'] }),
  draft('member-kdk-view', 'KDK 대진과 현재 경기', 'MEMBER', 'KDK 경기', '/kdk?entry=live', '내 대진과 현재·다음 경기를 확인합니다.', { keywords: ['KDK', '대진', '경기'] }),
  draft('member-kdk-display', '전광판으로 보기', 'MEMBER', 'KDK 경기', '/kdk/display', '코트 현황과 순위를 전광판 화면으로 봅니다.'),
  draft('member-archive', 'Archive 공식 기록', 'MEMBER', '공식 기록', '/archive', '공식 확정된 KDK 세션의 순위와 결과를 봅니다.', { keywords: ['아카이브', '기록'] }),
  draft('member-head-to-head', '상대·파트너 전적', 'MEMBER', '회원 간 기록', '/ranking/head-to-head', '회원 간 맞대결과 파트너 호흡 기록을 봅니다.', { keywords: ['상대전적', '파트너'] }),
  draft('member-playercard', 'PlayerCard 확인', 'MEMBER', '회원 간 기록', '/members', '회원 카드에서 공식 통계와 입상을 확인합니다.', { keywords: ['플레이어카드', '프로필'] }),
  draft('member-profile', '내 프로필과 공개 범위', 'MEMBER', '프로필과 개인 기록', '/profile', '내 공식 기록 요약과 카드 공개 범위를 관리합니다.', { write_mode: 'WRITES_DATA' }),
  draft('member-tennis-log', 'TENNIS LOG 기록', 'MEMBER', '프로필과 개인 기록', '/tennis-log', '대회 회고와 레슨 일지를 나만의 기록으로 남깁니다.', { write_mode: 'WRITES_DATA', privacy_level: 'MEDIUM' }),
  draft('member-finance', '내 회비 확인', 'MEMBER', '회비', '/finance', '납부 예정·완료와 연회비 상태를 확인합니다.', { privacy_level: 'MEDIUM', keywords: ['회비', '납부'] }),
  draft('member-lucky-vicky', 'LUCKY VICKY 알아보기', 'MEMBER', 'TEYEON 문화와 도움말', '/lucky-vicky', '파트너와 함께 도전하는 TEYEON 문화 이벤트입니다.'),

  // ── 타 대상 placeholder (홈 구조 확인용 최소) ────────────────────────────
  draft('operator-schedule', '정모 일정 관리', 'OPERATOR', '일정 운영', '/club/schedule', '정모 등록·수정과 참석 현황을 관리합니다.', { write_mode: 'WRITES_DATA', role_requirement: ['일정 담당'] }),
  draft('operator-kdk', 'KDK 대진 생성과 운영', 'OPERATOR', 'KDK 운영', '/kdk', '참가자 구성부터 점수 입력·공식 확정까지.', { write_mode: 'WRITES_DATA', role_requirement: ['KDK 운영'] }),
  draft('operator-guest', '게스트 신청 검토', 'OPERATOR', '게스트 관리', '/admin/guest-applications', '공개 신청을 검토하고 Guest Pass를 안내합니다.', { write_mode: 'WRITES_DATA', privacy_level: 'HIGH', role_requirement: ['게스트 담당'] }),
  // ── 게스트 MVP(2차) — 영상 없이 텍스트/단계 중심. 쉬운 문장, 전문 용어 최소화. ──
  //   ⚠ 개인 Guest Pass 링크는 토큰형이라 확정 샘플이 없다 — CTA 는 안내형(cta_disabled),
  //     가짜 URL/schedule id 하드코딩 금지. /guest/pass/preview 는 개발 QA 전용이라 연결하지 않는다.
  {
    id: 'guest-pass',
    title: 'Guest Pass 확인하기',
    audience: ['INVITED_GUEST'],
    chapter: 'Guest Pass 사용하기',
    route: '',
    cta_disabled: true,
    cta_label: 'Guest Pass 링크에서 확인',
    summary: '운영진 또는 회원에게 받은 Guest Pass 링크에서 정모 참가에 필요한 정보를 확인합니다.',
    highlight_badges: ['앱 설치 불필요', '링크 조회', '게스트 전용'],
    prerequisites: ['운영진 또는 회원에게 받은 Guest Pass 링크', '참가 확정 또는 운영진 안내 확인'],
    steps: [
      '전달받은 Guest Pass 링크를 엽니다.',
      '정모 날짜와 시간을 확인합니다.',
      '장소와 코트 정보를 확인합니다.',
      '게스트비와 준비물을 확인합니다.',
      '경기 방식과 현장 안내를 확인합니다.',
      '대진표 또는 현재 경기 정보가 공개되면 같은 페이지에서 확인합니다.',
      '문의가 있으면 초대한 회원 또는 운영진에게 확인합니다.',
    ],
    warnings: [
      'Guest Pass는 참가 안내용 페이지입니다.',
      '참가 가능 여부는 운영진 확인을 기준으로 합니다.',
      '당일 대진은 현장에서 편성된 뒤 공개될 수 있습니다.',
      '개인정보나 결제 정보는 이 페이지에 입력하지 않습니다.',
    ],
    write_mode: 'READ_ONLY',
    privacy_level: 'LOW',
    recording_status: 'NOT_STARTED', // 영상 준비 중 — 실제 게스트 영상 연결은 후속 작업
    handbook_status: 'READY',
    related_modules: ['invited-guest-live-court', 'invited-guest-results'],
    updated_at: T_GUEST,
    keywords: ['게스트', '초대', 'Guest Pass', '게스트비', '준비물'],
  },
  draft('invited-guest-live-court', '경기 당일 LIVE COURT 확인하기', 'INVITED_GUEST', '정모 당일과 결과', '', '정모 당일 코트 현황과 내 경기 순서를 확인합니다.', { cta_disabled: true, cta_label: 'Guest Pass 링크에서 확인' }),
  draft('invited-guest-results', '경기 후 결과 확인하기', 'INVITED_GUEST', '정모 당일과 결과', '', '정모가 끝난 뒤 내 경기 결과를 확인합니다.', { cta_disabled: true, cta_label: 'Guest Pass 링크에서 확인' }),

  {
    id: 'guest-application',
    title: '게스트 신청하기',
    audience: ['PUBLIC_GUEST'],
    chapter: '게스트 신청',
    route: '/guest', // 실제 공개 게스트 신청 페이지(비로그인 접근 가능 — AuthGuard public path)
    summary: 'TEYEON 게스트 모집이 열려 있을 때 공개 신청 페이지에서 참가 신청을 남기는 방법을 안내합니다.',
    highlight_badges: ['공개 신청', '운영진 검토', '앱 설치 불필요'],
    prerequisites: [
      '게스트 모집이 열려 있는 정모',
      '이름, 연락처, 지역/소속, 테니스 구력 등 신청 정보',
      '개인정보 수집 동의',
    ],
    steps: [
      'TEYEON 공개 게스트 신청 페이지를 엽니다.',
      '모집 중인 정모와 안내사항을 확인합니다.',
      '이름과 연락처를 입력합니다.',
      '지역, 소속 구분, 클럽명 또는 무소속 여부를 입력합니다.',
      '테니스 구력과 참고 성적이 있으면 입력합니다.',
      '개인정보 동의 후 신청을 제출합니다.',
      '운영진 검토와 연락을 기다립니다.',
      '승인되면 Guest Pass 안내를 받아 참가 정보를 확인합니다.',
    ],
    warnings: [
      '신청 즉시 참가 확정이 아닙니다.',
      '운영진 검토 후 참가 가능 여부가 안내됩니다.',
      '연락처와 개인정보가 포함되므로 촬영 시 실제 개인정보를 입력하지 않습니다.',
      '테스트 촬영 시에는 반드시 촬영용 데이터만 사용합니다.',
    ],
    write_mode: 'WRITES_DATA',
    privacy_level: 'MEDIUM',
    recording_status: 'NOT_STARTED', // 영상 준비 중 — 실제 게스트 영상 연결은 후속 작업
    handbook_status: 'READY',
    related_modules: ['public-guest-tour', 'public-guest-pass-after'],
    updated_at: T_GUEST,
    keywords: ['게스트', '신청', '모집', '공개', '참가'],
  },
  draft('public-guest-tour', 'TEYEON 공개 홈 둘러보기', 'PUBLIC_GUEST', 'TEYEON 둘러보기', '/club', '공개 일정과 클럽 소개로 TEYEON을 미리 봅니다.'),
  draft('public-guest-pass-after', '승인 후 Guest Pass 확인하기', 'PUBLIC_GUEST', '게스트 신청', '', '신청이 승인되면 받은 Guest Pass에서 참가 정보를 확인합니다.', { cta_disabled: true, cta_label: 'Guest Pass 링크에서 확인' }),
];

// ── 조회 helper ───────────────────────────────────────────────────────────────
export const chaptersOf = (audience: HandbookAudience): HandbookChapter[] =>
  CHAPTERS.filter((c) => c.audience === audience).sort((a, b) => a.order - b.order);

export const modulesOf = (audience: HandbookAudience): GuideModule[] =>
  MODULES.filter((m) => m.audience.includes(audience));

export const modulesInChapter = (audience: HandbookAudience, chapter: string): GuideModule[] =>
  modulesOf(audience).filter((m) => m.chapter === chapter);

export const getModule = (id: string): GuideModule | undefined => MODULES.find((m) => m.id === id);

export const moduleHref = (m: GuideModule): string =>
  `/handbook/${AUDIENCE_TO_SLUG[m.audience[0]]}/${m.id}`;

/** 챕터 순서 기준 이전·다음(같은 대상 내). */
export function prevNextOf(audience: HandbookAudience, id: string): { prev?: GuideModule; next?: GuideModule } {
  const ordered = chaptersOf(audience).flatMap((c) => modulesInChapter(audience, c.title));
  const i = ordered.findIndex((m) => m.id === id);
  if (i < 0) return {};
  return { prev: ordered[i - 1], next: ordered[i + 1] };
}

/** 검색(제목+요약+keywords 한글 부분 일치) — 전 대상. */
export function searchModules(query: string): GuideModule[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return MODULES.filter((m) =>
    m.title.toLowerCase().includes(q)
    || m.summary.toLowerCase().includes(q)
    || (m.keywords || []).some((k) => k.toLowerCase().includes(q)),
  ).slice(0, 12);
}
