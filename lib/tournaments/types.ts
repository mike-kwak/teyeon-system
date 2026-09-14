// TEYEON 주최 공개 대회(hosted tournament) 공개 도메인 타입.
//   ⚠️ lib/tournament_types.ts(단수형, KDK attendee/ranking)와 무관하다. 서로 import 하지 않는다.
//   DB 테이블 namespace 는 hosted_* (기존 public.tournament_events = /tournament-calendar 전용, 재사용 금지).

/** 신청 상태 — DB check 제약과 1:1(소문자 통일). */
export type RegistrationStatus =
  | 'applied'
  | 'waitlisted'
  | 'confirmed'
  | 'cancelled'
  | 'rejected';

/** 입금 상태 — 신청 상태와 절대 한 필드로 합치지 않는다. */
export type PaymentStatus = 'pending' | 'paid' | 'refund_pending' | 'refunded';

/** Hub 상단 네비게이션 단계. */
export type TournamentPhaseKey = 'info' | 'teams' | 'draw' | 'live' | 'results';

export interface TournamentNavItem {
  key: TournamentPhaseKey;
  label: string;
  /** 'current' = 지금 보고 있는 화면, 'open' = 이동 가능, 'pending' = 아직 미공개. */
  state: 'current' | 'open' | 'pending';
  /** state='open' 일 때만 사용. */
  href?: string;
  /** state='pending' 일 때 사용자에게 보여줄 공개 시점(요강 문구 변경 금지). */
  releaseNote?: string;
}

export interface TournamentPrizeRow {
  /** '우승' | '준우승' | '공동 3위' */
  rank: string;
  /** 영문 병기. */
  rankEn: string;
  amount: number;
  /** '트로피' | '메달' */
  trophy: string;
  /** 공동 3위처럼 '각' 이 붙는 경우. */
  each?: boolean;
}

export interface TournamentFormatStage {
  /** 'STAGE 01 · 예선' */
  eyebrow: string;
  title: string;
  description: string;
  tone: 'light' | 'navy';
}

/** 공식 1Page 대회요강에서 그대로 옮긴 확정 정보(Single Source of Truth). */
export interface OfficialTournament {
  slug: string;
  /** '2026' — 히어로 상단 연도. */
  year: string;
  /** ['TEYEON', 'OPEN'] — 시안대로 줄바꿈이 확정된 워드마크. */
  wordmark: string[];
  titleFull: string;
  subtitleKo: string;
  subtitleEn: string;
  /** 헤더 우측 짧은 표기. */
  shortTag: string;

  eventDateISO: string;
  /** '2026.10.25 SUN' */
  eventDateLabel: string;
  /** '10.25 SUN' */
  eventDateShort: string;
  startTimeLabel: string;
  venueName: string;

  organizerName: string;
  sponsorName: string;
  /** 시합구. */
  ballName: string;

  entryFee: number;
  targetCapacity: number;
  maxCapacity: number;

  registrationCloseISO: string;
  /** '2026.10.19 MON · 17:00' */
  registrationCloseLabel: string;
  /** '10.19 MON 17:00 마감' */
  registrationCloseShort: string;

  totalPrize: number;
  prizes: TournamentPrizeRow[];

  formatStages: TournamentFormatStage[];
  matchRule: string;
  groupRankRule: string;
  drawRule: string;
  formatCaption: string;

  registrationNotes: string[];
  eligibility: { text: string; note?: string }[];
  mediaNotice: string;
  safetyNotes: string[];
  discretionNote: string;

  contacts: { role: string; name: string; phone: string; primary?: boolean }[];
  contactCaption: string;
}

/** 공개 접수 현황 — RPC(get_public_tournament) 응답. 개인정보·내부 UUID 미포함. */
export interface TournamentPublicStatus {
  /** 활성 신청 팀 수(applied + waitlisted + confirmed). */
  appliedCount: number;
  targetCapacity: number;
  maxCapacity: number;
  /** 서버가 판정한 접수 가능 여부. 클라이언트 시각으로 재판정하지 않는다. */
  isRegistrationOpen: boolean;
  /** 참가비(원). 공개 RPC 가 내려주는 DB 값. */
  entryFee: number;
  /**
   * 입금 계좌 — hosted_tournaments.bank_* 값.
   *   ⚠ 공개 RPC 가 계좌를 내려주기 전에는 전부 null 이다. 그 경우 화면은 계좌를 만들어내지 않고
   *     "신청 완료 화면에서 확인" 안내만 보여준다(하드코딩 금지).
   */
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
}
