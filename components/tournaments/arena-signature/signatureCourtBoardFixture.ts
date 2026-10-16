// Signature Court Board — 가명 · 가상 장면 (순수 모듈, /tournaments/arena-design/signature/courts 전용).
//
//   보조 모니터(코트 전용 전광판) 디자인 Demo 데이터.
//   ⚠ 서버 · Supabase 와 연결되지 않는다. 운영 서비스 · RPC 를 import 하지 않는다.
//   ⚠ NEXT(코트별 다음 경기)는 **현재 운영 시스템에 없는 정보**다. 여기서는 디자인 확인을 위해
//     장면마다 손으로 적어 둔 가상 값일 뿐이다 — 조별 경기 순서 등으로 자동 배정하지 않는다.
//     NEXT 가 없으면 null 이고, 화면은 '미정'으로 보인다.
//   ⚠ 선수 이름은 기존 Demo 의 가명 생성기(arenaDemoTeam)만 쓴다(긴 이름 팀 포함 — 가독성 점검용).

import { arenaDemoTeam } from '@/lib/tournaments/arenaDemoFixture';
import type { ArenaTeam } from '@/lib/tournaments/arenaTypes';

export type CourtBoardScene = 'mixed' | 'busy' | 'quiet';

export const COURT_BOARD_SCENES: { id: CourtBoardScene; label: string }[] = [
  { id: 'mixed', label: '상태 혼합' },
  { id: 'busy', label: '전 코트 진행' },
  { id: 'quiet', label: '경기 전' },
];

export const courtBoardSceneOf = (v: string | null): CourtBoardScene =>
  v === 'busy' || v === 'quiet' ? v : 'mixed';

/** 코트에 올라간(또는 올라갈) 경기 한 건. stageLabel 은 '예선 7조' · '본선 32강' 처럼 화면에 그대로 쓰는 문구. */
export interface CourtBoardMatch {
  matchNo: number;
  stageLabel: string;
  team1: ArenaTeam;
  team2: ArenaTeam;
  /**
   * 경기 경과 시간(운영 연결 화면의 NOW 전용). 없으면 시간 칸을 그리지 않는다(Demo · 타이머 미지원 서버).
   *   startMs = 서버 시작 시각(ms) — null 이면 '시작 대기'. offsetMs = 서버 시각 − 기기 시각.
   */
  timer?: { startMs: number | null; offsetMs: number };
}

export interface CourtBoardCourt {
  courtNo: number;
  displayName: string | null;
  /** 코트 운영 여부. false 면 운영 중지 — NOW · NEXT 를 보이지 않는다. */
  active: boolean;
  /** 운영 데이터에 등록된 코트인가(운영 연결 화면 전용). 없으면 등록된 것으로 본다(Demo fixture 는 늘 등록). */
  registered?: boolean;
  /** 지금 진행 중인 경기(운영 데이터의 playing 과 같은 의미). 없으면 null. */
  now: CourtBoardMatch | null;
  /** 이 코트의 다음 경기(가상). 없으면 null → '미정'. */
  next: CourtBoardMatch | null;
}

const m = (matchNo: number, stageLabel: string, a: number, b: number): CourtBoardMatch => ({
  matchNo, stageLabel, team1: arenaDemoTeam(a), team2: arenaDemoTeam(b),
});

type Spec = [now: CourtBoardMatch | null, next: CourtBoardMatch | null];

/** 장면별 코트 1~10. 코트 10 은 기존 Demo 와 같이 운영 중지. */
const SPECS: Record<CourtBoardScene, Spec[]> = {
  // 다섯 가지 상태를 한 화면에서 모두 확인한다.
  mixed: [
    [m(101, '예선 7조', 19, 20), m(121, '예선 8조', 22, 23)],     // LIVE + NEXT
    [m(102, '예선 2조', 4, 5), m(122, '예선 9조', 25, 26)],       // 긴 영문 이름
    [m(103, '예선 1조', 1, 2), null],                              // LIVE + NEXT 미정
    [m(104, '예선 13조', 38, 37), m(124, '예선 16조', 47, 46)],   // 긴 이름 NEXT
    [m(105, '예선 11조', 31, 32), null],
    [null, m(126, '예선 12조', 34, 35)],                           // 현재 없음 + NEXT
    [null, m(127, '예선 5조', 14, 13)],                            // 현재 없음 + 긴 이름 NEXT
    [null, null],                                                  // 대기 중 · 배정 없음
    [m(109, '예선 3조', 9, 7), m(129, '예선 4조', 10, 11)],
    [null, null],                                                  // 운영 중지(아래에서 active=false)
  ],
  busy: [
    [m(201, '본선 32강', 1, 4), m(211, '본선 32강', 7, 10)],
    [m(202, '본선 32강', 13, 16), m(212, '본선 32강', 19, 22)],
    [m(203, '본선 32강', 25, 28), m(213, '본선 32강', 31, 34)],
    [m(204, '본선 32강', 37, 40), m(214, '본선 32강', 43, 46)],
    [m(205, '본선 32강', 49, 52), m(215, '본선 32강', 55, 58)],
    [m(206, '본선 32강', 2, 5), m(216, '본선 32강', 8, 11)],
    [m(207, '본선 32강', 14, 17), m(217, '본선 32강', 20, 23)],
    [m(208, '본선 32강', 26, 29), m(218, '본선 32강', 32, 35)],
    [m(209, '본선 32강', 38, 41), m(219, '본선 32강', 44, 47)],
    [null, null],
  ],
  quiet: [
    [null, m(301, '예선 1조', 1, 2)],
    [null, m(302, '예선 2조', 4, 5)],
    [null, m(303, '예선 3조', 7, 8)],
    [null, m(304, '예선 4조', 10, 11)],
    [null, m(305, '예선 5조', 13, 14)],
    [null, null],
    [null, null],
    [null, null],
    [null, null],
    [null, null],
  ],
};

const CLOSED_COURT = 10;

export function buildCourtBoard(scene: CourtBoardScene): CourtBoardCourt[] {
  return SPECS[scene].map(([now, next], i) => {
    const courtNo = i + 1;
    const active = courtNo !== CLOSED_COURT;
    return {
      courtNo,
      displayName: courtNo === 1 ? '센터코트' : null,
      active,
      // ⚠ 운영 중지 코트에는 경기를 두지 않는다.
      now: active ? now : null,
      next: active ? next : null,
    };
  });
}
