// TEYEON Digital Handbook — 타입 정의.
//   기준: design_handoff_teyeon_handbook/README.md §10 GuideModule (필드명 유지 — 이후 영상/데이터 연결 호환).
//   1차: 정적 TS 데이터(lib/handbook/modules.ts). DB/Supabase 미사용.
//   원칙: 가이드 "제작 상태(recording/handbook_status)"와 사용자 "학습 상태(읽음)"는 절대 혼합 표기하지 않는다.

export type HandbookAudience = 'MEMBER' | 'OPERATOR' | 'INVITED_GUEST' | 'PUBLIC_GUEST';

/** URL 세그먼트(/handbook/[audience]) ↔ 내부 ID 매핑 */
export const AUDIENCE_SLUGS: Record<string, HandbookAudience> = {
  member: 'MEMBER',
  operator: 'OPERATOR',
  'invited-guest': 'INVITED_GUEST',
  'public-guest': 'PUBLIC_GUEST',
};
export const AUDIENCE_TO_SLUG: Record<HandbookAudience, string> = {
  MEMBER: 'member',
  OPERATOR: 'operator',
  INVITED_GUEST: 'invited-guest',
  PUBLIC_GUEST: 'public-guest',
};

export interface AudienceMeta {
  id: HandbookAudience;
  slug: string;
  /** 화면 표시명 */
  label: string;
  /** 홈 카드 한 줄 설명 */
  tagline: string;
  /** Handoff §1 accent */
  accent: string;
  /** accent 대비 잉크(어두운 배경 여부) */
  accentInk: string;
  /** 홈 preview 캡션(대표 화면) */
  previewLabel: string;
  /** 목차 상단 요약(없으면 미표시) — 홈 카드 tagline 보다 긴 문장 허용 */
  description?: string;
}

export type GuideRecordingStatus = 'NOT_STARTED' | 'VIDEO_IN_PROGRESS' | 'RECORDED' | 'REVIEWED';
export type GuideHandbookStatus = 'DRAFT' | 'READY' | 'PUBLISHED';
export type GuideWriteMode = 'READ_ONLY' | 'WRITES_DATA';
export type GuidePrivacyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface GuideModule {
  id: string;
  title: string;
  audience: HandbookAudience[];
  chapter: string;
  /** 실제 앱 기능 경로(CTA 바로가기). cta_disabled 모듈은 '' 허용 */
  route: string;
  /** CTA 라벨 오버라이드(기본 '실제 기능으로 이동') */
  cta_label?: string;
  /** true 면 CTA 를 링크 대신 안내형(비활성)으로 표시 — 확정된 대상 경로가 없는 모듈용(가짜 URL 하드코딩 금지) */
  cta_disabled?: boolean;
  /** 대상별 핵심 메시지 칩(예: '앱 설치 불필요') — 파생 배지(모드/개인정보/제작 상태)와 별개의 안내용 */
  highlight_badges?: string[];
  role_requirement?: string[];
  summary: string;
  prerequisites: string[];
  steps: string[];
  warnings: string[];
  write_mode: GuideWriteMode;
  privacy_level: GuidePrivacyLevel;
  video_file?: string;
  poster_file?: string;
  /** seconds */
  duration?: number;
  recording_status: GuideRecordingStatus;
  handbook_status: GuideHandbookStatus;
  related_modules: string[];
  source_commit?: string;
  /** ISO 8601 */
  updated_at: string;
  /** 검색 보조 키워드(한글 매칭) */
  keywords?: string[];
}

export interface HandbookChapter {
  /** 챕터 표시명(GuideModule.chapter 와 일치) */
  title: string;
  audience: HandbookAudience;
  /** 정렬 순서(1부터) */
  order: number;
}
