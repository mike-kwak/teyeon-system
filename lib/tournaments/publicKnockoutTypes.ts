// 공개 본선 대진 — get_public_knockout_bracket 응답 타입 (Batch 4D-2).
//
//   ⚠ 이 파일에는 내부 식별자 타입이 없다. 서버가 UUID 를 하나도 내려 주지 않는다.
//     화면 key 는 좌표로 만든 공개 키를 그대로 쓴다 —
//       라운드 'r1' · 자리 'r1p3' · 경기 'r1m2' · 팀 't12'.
//   ⚠ 개인정보가 없다. 팀은 번호 + 이름 스냅샷만 온다(예선 공개 DRAW 와 같은 수준).
//   ⚠ 이 타입은 표시용이다. 여기서 대진을 계산하거나 조합을 만들지 않는다.

/** 자리 종류. qualifier = 예선 결과 대기('N조 M위') / tbd = 이전 경기 승자 대기. */
export type PublicSlotType = 'team' | 'qualifier' | 'bye' | 'tbd';

export type PublicSourceKind = 'group_rank' | 'manual' | 'bye';

export interface PublicKnockoutTeam {
  /** 't12' — 화면 key 전용. 내부 id 가 아니다. */
  publicKey: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  withdrawn: boolean;
}

export interface PublicKnockoutRound {
  /** 'r1' */
  publicKey: string;
  roundNo: number;
  name: string;
  /** 우승 자리 라운드(경기 라운드가 아니다). */
  isFinalRound: boolean;
  slotCount: number;
}

export interface PublicKnockoutSlot {
  /** 'r1p3' */
  publicKey: string;
  roundNo: number;
  position: number;
  slotType: PublicSlotType;
  sourceKind: PublicSourceKind | null;
  /** '1조 1위' — 서버가 만든 문구. ⚠ 프런트에서 조합하지 않는다. */
  sourceLabel: string | null;
  /** 예선 결과가 반영됐는가. true 여도 sourceLabel 은 그대로 남는다. */
  resolved: boolean;
  isFinalSlot: boolean;
  /** 이 자리의 승자가 올라갈 다음 자리. 우승 자리만 null. */
  feedsSlotPublicKey: string | null;
  /** 아직 팀이 정해지지 않았으면 null(‘1조 1위’ 만 표시). */
  team: PublicKnockoutTeam | null;
}

export type PublicKnockoutMatchStatus = 'waiting' | 'calling' | 'playing' | 'completed';

export interface PublicKnockoutMatch {
  /** 'r1m2' */
  publicKey: string;
  roundNo: number;
  roundName: string | null;
  matchNo: number;
  status: PublicKnockoutMatchStatus;
  /** 진행 중일 때만 온다. */
  courtNo: number | null;
  courtName: string | null;
  /** 완료일 때만 온다. ⚠ 경기 중 가짜 실시간 점수는 없다. */
  score1: number | null;
  score2: number | null;
  /** 완료일 때만. 1 = team1 / 2 = team2. */
  winnerSide: 1 | 2 | null;
  targetSlotPublicKey: string | null;
  feederSlotPublicKeys: string[];
  team1: PublicKnockoutTeam;
  team2: PublicKnockoutTeam;
}

export interface PublicKnockoutBracket {
  slug: string;
  tournamentTitle: string;
  bracketTitle: string | null;
  /** locked = 진행 중 / completed = 종료. draft 는 공개되지 않는다. */
  bracketStatus: 'locked' | 'completed';
  publishedAt: string | null;
  completedAt: string | null;
  rounds: PublicKnockoutRound[];
  slots: PublicKnockoutSlot[];
  matches: PublicKnockoutMatch[];
  /** ⚠ 본선이 완료되기 전에는 항상 null. */
  champion: PublicKnockoutTeam | null;
}

/** 공개 화면에서 쓰는 자리 문구. 반영 여부와 무관하게 출처를 먼저 보여 준다. */
export function publicSlotText(slot: PublicKnockoutSlot): string {
  if (slot.slotType === 'bye') return '부전승';
  if (slot.slotType === 'tbd') return '승자 대기';
  if (slot.team) return `${slot.team.teamNo}. ${slot.team.player1Name} · ${slot.team.player2Name}`;
  return slot.sourceLabel ?? '미정';
}

export const PUBLIC_KNOCKOUT_STATUS_TEXT: Record<PublicKnockoutMatchStatus, string> = {
  waiting: '대기',
  calling: '경기 준비 중',
  playing: '진행 중',
  completed: '완료',
};
