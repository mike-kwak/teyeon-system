// 테스트(리허설) 대회 판정 — 현장 운영 2단계.
//
//   ⚠ 기준은 DB 의 fixture 가드와 같다: slug 가 'fixture-' 로 시작한다(seed_fixture_tournament 의 3중 가드 ①).
//     fixture 대회는 draft 로 만들어지므로 공개 RPC(get_public_tournament 등)가 아무 것도 돌려주지 않는다
//     → 참가자 공개 화면 · 공개 전광판에 섞이지 않는다(이 모듈이 아니라 서버가 막는다).
//   ⚠ 화면은 '테스트 대회' 임을 크게 표시하고, 공개 화면으로 가는 링크(전광판 · ARENA TV · 허브)를 숨긴다.

import type { OfficialTournament } from './types';

export const TEST_TOURNAMENT_PREFIX = 'fixture-';

export function isTestTournamentSlug(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && slug.startsWith(TEST_TOURNAMENT_PREFIX) && slug.length > TEST_TOURNAMENT_PREFIX.length;
}

/** Control Center 머리말에 쓰는 대회 정보 — 공식 대회 정보 중 화면이 실제로 쓰는 값만. */
export type ControlEvent = Pick<OfficialTournament, 'titleFull' | 'eventDateLabel' | 'venueName'> & {
  /** 테스트(리허설) 대회 — 공개 화면 링크를 숨기고 경고 띠를 띄운다. */
  test?: boolean;
};

export function testControlEvent(slug: string): ControlEvent {
  return {
    titleFull: `테스트 대회 · ${slug}`,
    eventDateLabel: 'REHEARSAL',
    venueName: '실제 대회 아님 · 참가자 화면 비공개',
    test: true,
  };
}
