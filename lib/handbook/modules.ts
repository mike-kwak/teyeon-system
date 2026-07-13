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
  { id: 'INVITED_GUEST', slug: 'invited-guest', label: '초대받은 게스트', tagline: 'Guest Pass 하나로 정모 참여 준비 끝', accent: '#C9A24B', accentInk: '#3D2E08', previewLabel: 'Guest Pass 화면' },
  { id: 'PUBLIC_GUEST', slug: 'public-guest', label: '처음 방문한 게스트', tagline: 'TEYEON 둘러보기와 게스트 신청', accent: '#6FC7BC', accentInk: '#0B3C36', previewLabel: '공개 홈 화면' },
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
  { audience: 'PUBLIC_GUEST', order: 1, title: 'TEYEON 둘러보기' },
  { audience: 'PUBLIC_GUEST', order: 2, title: '게스트 신청' },
];

const T = '2026-07-13T00:00:00+09:00';

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
    poster_file: undefined, // 향후: /handbook/posters/member-ranking.png
    recording_status: 'NOT_STARTED', // 실제 영상 연결 전 — 준비 중 상태로 표시
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
  draft('invited-guest-pass', 'Guest Pass 사용하기', 'INVITED_GUEST', 'Guest Pass 사용하기', '/guest/pass/preview', '일정·비용·대진·결과를 링크 하나로 확인합니다.'),
  draft('public-guest-tour', 'TEYEON 둘러보기', 'PUBLIC_GUEST', 'TEYEON 둘러보기', '/club', '공개 일정과 KDK 기록으로 클럽을 미리 봅니다.'),
  draft('public-guest-join', '게스트 참여 신청', 'PUBLIC_GUEST', '게스트 신청', '/guest', '모집 중인 정모에 게스트 참여를 신청합니다.', { write_mode: 'WRITES_DATA', privacy_level: 'MEDIUM' }),
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
