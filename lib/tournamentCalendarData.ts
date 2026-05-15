export type TournamentOrganizer = 'KATO' | 'KATA' | 'KTA' | '지역대회' | '비랭킹';
export type TournamentDivision = '신인부' | '오픈부' | '단체전' | '기타';
export type TournamentStatus = '접수예정' | '접수중' | '접수종료' | '대회진행중' | '대회종료' | '대회취소';
export type TournamentResult = '64' | '32' | '16' | '8' | 'Finalist' | '준우승' | '우승' | '취소' | 'X' | '예정';

export interface TournamentPair {
  id?: string;
  player1: string;
  player2: string;
  result?: TournamentResult;
}

export interface TournamentPartnerRequest {
  id?: string;
  name: string;
  memo?: string;
}

export interface TournamentEvent {
  id: string;
  title: string;
  date: string;
  venue: string;
  organizer: TournamentOrganizer;
  division: TournamentDivision;
  grade?: string;
  registrationStart?: string;
  status: TournamentStatus;
  memo?: string;
  pairs: TournamentPair[];
  lookingForPartners: string[];
  partnerRequests?: TournamentPartnerRequest[];
}

export const tournamentEvents: TournamentEvent[] = [
  {
    id: 'boryeong-mud-2026',
    title: '보령 머드배',
    date: '2026-05-17',
    venue: '보령종합테니스장',
    organizer: 'KATO',
    division: '신인부',
    grade: 'A',
    registrationStart: '2026-05-01',
    status: '접수중',
    memo: '신인부 페어 위주로 출전 검토. 이동 시간 확인 필요.',
    pairs: [
      { player1: '맹동석', player2: '김재형', result: '64' },
      { player1: '남인우', player2: '곽민섭' },
      { player1: '김영우', player2: '전용원', result: '준우승' },
    ],
    lookingForPartners: ['현섭(G)', '광훈(G)'],
  },
  {
    id: 'incheon-namdong-open-2026',
    title: '인천 남동오픈',
    date: '2026-05-23',
    venue: '남동아시아드테니스장',
    organizer: 'KATO',
    division: '신인부',
    grade: '2',
    registrationStart: '2026-05-10',
    status: '접수중',
    memo: '수도권 접근성이 좋아 후보 페어가 많음.',
    pairs: [
      { player1: '강정호', player2: '김민준' },
      { player1: '김상준', player2: '맹동석', result: '8' },
      { player1: '성찬(G)', player2: '전용원', result: '32' },
    ],
    lookingForPartners: ['은지(G)'],
  },
  {
    id: 'seocheon-hansan-2026',
    title: '서천 한산모시배',
    date: '2026-05-24',
    venue: '서천군테니스장',
    organizer: 'KATO',
    division: '신인부',
    grade: '1',
    registrationStart: '2026-05-12',
    status: '접수예정',
    memo: '접수 시작일 알림 필요. 숙박 여부 확인.',
    pairs: [
      { player1: '추석', player2: '박광현', result: '32' },
      { player1: '보훈', player2: '인우' },
    ],
    lookingForPartners: ['슬기(G)', '민호(G)'],
  },
  {
    id: 'suwon-hwaseong-2026',
    title: '수원 화성배',
    date: '2026-06-06',
    venue: '수원만석공원테니스장',
    organizer: 'KATO',
    division: '오픈부',
    grade: 'MA',
    registrationStart: '2026-05-20',
    status: '접수예정',
    memo: '오픈부 출전 가능 페어만 체크.',
    pairs: [
      { player1: '민준', player2: '효철' },
    ],
    lookingForPartners: [],
  },
  {
    id: 'gangneung-imhae-2026',
    title: '강릉 임해배',
    date: '2026-06-13',
    venue: '강릉종합운동장 테니스코트',
    organizer: '비랭킹',
    division: '신인부',
    registrationStart: '2026-05-25',
    status: '접수예정',
    memo: '비랭킹 대회. 여행 겸 출전 후보.',
    pairs: [
      { player1: '동석', player2: '광훈(G)', result: '16' },
    ],
    lookingForPartners: ['현민'],
  },
  {
    id: 'kta-summer-team-2026',
    title: 'KTA 여름 단체전',
    date: '2026-06-20',
    venue: '올림픽공원 테니스장',
    organizer: 'KTA',
    division: '단체전',
    grade: '팀',
    registrationStart: '2026-06-01',
    status: '접수예정',
    memo: '단체전 엔트리 구성 필요.',
    pairs: [
      { player1: 'TEYEON A팀', player2: '엔트리 미정' },
      { player1: 'TEYEON B팀', player2: '엔트리 미정' },
    ],
    lookingForPartners: [],
  },
  {
    id: 'kata-june-rookie-2026',
    title: 'KATA 6월 신인부',
    date: '2026-06-21',
    venue: '부천종합운동장 테니스코트',
    organizer: 'KATA',
    division: '신인부',
    grade: 'B',
    registrationStart: '2026-06-03',
    status: '접수예정',
    memo: 'KATA 랭킹 반영 여부 확인.',
    pairs: [
      { player1: '강진', player2: '재형' },
    ],
    lookingForPartners: ['상아(G)'],
  },
  {
    id: 'local-night-cup-2026',
    title: '동탄 야간배',
    date: '2026-05-29',
    venue: '동탄센트럴파크 테니스장',
    organizer: '지역대회',
    division: '기타',
    registrationStart: '2026-05-18',
    status: '접수중',
    memo: '평일 야간 소규모 대회. 참석 가능자만 체크.',
    pairs: [
      { player1: '영우', player2: '재형', result: '취소' },
    ],
    lookingForPartners: ['정민(G)'],
  },
];

const toDateOnly = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function parseTournamentDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatTournamentDate(date: string) {
  const parsed = parseTournamentDate(date);
  return `${parsed.getFullYear()}.${String(parsed.getMonth() + 1).padStart(2, '0')}.${String(parsed.getDate()).padStart(2, '0')}`;
}

export function getTournamentDday(date?: string, referenceDate = new Date()) {
  if (!date) return null;
  const target = toDateOnly(parseTournamentDate(date));
  const reference = toDateOnly(referenceDate);
  const diff = Math.round((target.getTime() - reference.getTime()) / 86400000);
  if (diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

export function getEventsForMonth(year: number, monthIndex: number) {
  return tournamentEvents
    .filter((event) => {
      const date = parseTournamentDate(event.date);
      return date.getFullYear() === year && date.getMonth() === monthIndex;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getMonthlyFeaturedEvents(referenceDate = new Date(), limit = 3) {
  const currentMonthEvents = getEventsForMonth(referenceDate.getFullYear(), referenceDate.getMonth());
  return currentMonthEvents.slice(0, limit);
}

export function getUpcomingRegistrationEvents(referenceDate = new Date(), limit = 3) {
  const reference = toDateOnly(referenceDate).getTime();
  return tournamentEvents
    .filter((event) => event.registrationStart && parseTournamentDate(event.registrationStart).getTime() >= reference)
    .sort((a, b) => (a.registrationStart || '').localeCompare(b.registrationStart || ''))
    .slice(0, limit);
}
