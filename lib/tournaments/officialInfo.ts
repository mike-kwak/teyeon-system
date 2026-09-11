// 2026 TEYEON OPEN — 공식 확정 정보(Single Source of Truth).
//
//   출처: 임원진 최종 승인된 공식 모집 포스터 + 공식 1Page 대회요강(OFFICIAL TOURNAMENT REGULATIONS).
//   이 파일의 문구는 요강 원문을 그대로 옮긴 것이다.
//
//   ⛔ 금지
//     · 참가자격 · 경기방식 · 상금 · 일정 문구를 임의로 바꾸거나 요약해 의미를 변경하는 것
//     · 요강에 없는 새로운 경기규정 · 안내문 추가
//     · 지역대회 예외 기준 / 단식 64드로 기준 추측
//   변경이 필요하면 먼저 공식 요강이 개정되어야 하고, 그 다음 이 파일을 고친다.
//
//   ℹ️ 예선 순위의 '합산연령' 은 높은 팀/낮은 팀 중 어느 쪽이 우선인지 아직 미확정이다.
//      따라서 표기만 하고 정렬 로직 · 나이 컬럼 · 부연 설명을 만들지 않는다.

import type { OfficialTournament } from './types';

export const TEYEON_OPEN_2026_SLUG = '2026-teyeon-open';

const TEYEON_OPEN_2026: OfficialTournament = {
  slug: TEYEON_OPEN_2026_SLUG,
  year: '2026',
  wordmark: ['TEYEON', 'OPEN'],
  titleFull: '2026 TEYEON OPEN',
  subtitleKo: '비랭킹 복식 테니스 대회',
  subtitleEn: 'NON-RANKING DOUBLES TOURNAMENT',
  shortTag: '2026 OPEN',

  eventDateISO: '2026-10-25',
  eventDateLabel: '2026.10.25 SUN',
  eventDateShort: '10.25 SUN',
  startTimeLabel: '09:00',
  venueName: '아산시 강변 테니스장',

  organizerName: 'TEYEON TENNIS CLUB',
  sponsorName: '아산시 테니스 협회',
  ballName: '낫소 짜르투어',

  entryFee: 40000,
  targetCapacity: 48,
  maxCapacity: 60,

  registrationCloseISO: '2026-10-19T17:00:00+09:00',
  registrationCloseLabel: '2026.10.19 MON · 17:00',
  registrationCloseShort: '10.19 MON 17:00 마감',

  totalPrize: 1100000,
  prizes: [
    { rank: '우승', rankEn: 'CHAMPION', amount: 600000, trophy: '트로피' },
    { rank: '준우승', rankEn: 'RUNNER-UP', amount: 300000, trophy: '트로피' },
    { rank: '공동 3위', rankEn: '3RD PLACE', amount: 100000, trophy: '메달', each: true },
  ],

  formatStages: [
    {
      eyebrow: 'STAGE 01 · 예선',
      title: '3팀 조별리그',
      description: '조별 순위는 승률 > 득실차 > 합산연령 순으로 결정합니다.',
      tone: 'light',
    },
    {
      eyebrow: 'STAGE 02 · 본선',
      title: '각 조 상위 2팀 진출',
      description: '본선은 토너먼트 방식으로 진행합니다.',
      tone: 'navy',
    },
  ],
  matchRule: '6게임 1세트 · No-Ad · 5:5 타이브레이크',
  groupRankRule: '승률 > 득실차 > 합산연령',
  drawRule: '집행부에서 직권 진행',
  formatCaption: '본 요강에 명시되지 않은 사항은 대회본부에서 직권으로 결정합니다.',

  // 요강 02 참가 신청.
  registrationNotes: [
    '접수순을 기본으로 하며, 공식 포스터 및 대회요강의 QR로 신청합니다.',
    '참가신청 완료가 최종 참가확정을 의미하지 않으며, 입금 확인 후 참가확정 처리합니다.',
    '접수 마감일까지 미입금 시 대기팀 운영 상황에 따라 참가 순위가 변경될 수 있습니다.',
  ],

  // 요강 05 참가 자격 / 페어 요건 — 순서·표현 원문 유지.
  eligibility: [
    { text: '랭킹 및 비랭킹 대회 우승자는 출전 불가' },
    { text: '랭킹 및 비랭킹 대회 입상자끼리 페어 불가' },
    {
      text: '비랭킹 대회 입상 기준은 전국단위 비랭킹 대회로 한정',
      note: '예 · 가온사랑배 · 한라동백배 · 한우리배 등',
    },
    { text: '클럽대항전 · 맑은쌀배 등 지역대회는 위 전국단위 비랭킹 입상 기준에서 제외하여 참가 가능' },
    { text: '단식 64드로 이상 대회의 입상 및 우승자는 입상자 대우' },
    { text: '외국인 참가자 · 외국인의 경우 사전 연락 후 집행부 심의를 거쳐 출전 여부 결정' },
  ],

  // 요강 06 촬영 · 중계 및 안전 안내 — 법률 문구 확대 금지.
  mediaNotice:
    '대회 기록 및 홍보를 위해 경기 및 행사 현장이 사진·영상으로 촬영될 수 있으며, 준결승·결승 등 주요 경기는 온라인으로 실시간 중계될 수 있습니다.',
  safetyNotes: [
    '출전 선수는 생활체육 공제보험 가입을 권장합니다.',
    '경기 중 부상 시 주최 측은 일체의 책임을 지지 않습니다.',
  ],
  discretionNote: '본 요강에 명시되지 않은 사항은 대회본부에서 직권으로 결정합니다.',

  // 요강 07 대회 문의 · 참가신청. 번호는 공식 포스터/요강 표기 그대로.
  contacts: [
    { role: '회장', name: '박광현', phone: '010-9352-0919' },
    { role: '경기', name: '김민준', phone: '010-7224-3689', primary: true },
    { role: '재무', name: '곽민섭', phone: '010-2696-0356' },
  ],
  contactCaption: '참가신청 관련 문의는 경기 담당에게 연락해 주세요.',
};

const OFFICIAL_TOURNAMENTS: Record<string, OfficialTournament> = {
  [TEYEON_OPEN_2026_SLUG]: TEYEON_OPEN_2026,
};

/** slug 로 공식 대회 정보 조회. 미등록 slug 는 null(QR 오타 대응 — 404 대신 안내 화면). */
export function getOfficialTournament(slug: string | null | undefined): OfficialTournament | null {
  if (!slug) return null;
  return OFFICIAL_TOURNAMENTS[slug] ?? null;
}
