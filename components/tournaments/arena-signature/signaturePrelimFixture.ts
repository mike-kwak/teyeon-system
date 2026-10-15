// Signature 예선 — 가명 · 가상 장면 (순수 모듈, /tournaments/arena-design/signature/prelim 전용).
//
//   ⚠ 서버 · Supabase 와 연결되지 않는다. 이 파일은 운영 서비스 · RPC 를 import 하지 않는다.
//   ⚠ 20조 × 3팀의 '중반 · 종료' 장면은 기존 Demo fixture(buildArenaDemoSnapshot)를 **그대로** 쓴다.
//     기존 fixture 에 없는 장면만 여기서 만든다 — 공용 fixture 파일은 고치지 않는다.
//       · 예선 초반(early) — 경기는 시작됐지만 완료된 경기가 아직 없는 장면
//       · 조 구성 변형 — 48팀(16조) · 2팀 조 섞임(조당 2~3팀이 실제 대회 규칙)
//       · 예전 검토용 4팀 조(실제 대회 요구사항 아님 — 정식 지원 대상이 아니다)
//   ⚠ 순위 · 진출 · 동률 상태는 '서버가 돌려줄 값'을 흉내 내 **이 fixture 가 직접 적어 둔다.**
//     화면(SignatureGroupWall)은 이 값을 계산하지 않고 그대로 그린다.
//     규칙은 서버와 같게 맞췄다: 승률 → 게임 득실, 경기 0 인 팀은 rank 없음, 미해결 동률은 rank null.
//   ⚠ 선수 이름은 기존 Demo 의 가명 생성기(arenaDemoTeam)만 쓴다.

import { arenaDemoTeam, buildArenaDemoSnapshot } from '@/lib/tournaments/arenaDemoFixture';
import type {
  ArenaCourt, ArenaCourtMatch, ArenaGroup, ArenaSnapshot, ArenaStandingRow,
} from '@/lib/tournaments/arenaTypes';
import type { GroupRankingStatus, QualificationStatus } from '@/lib/tournaments/standingsTypes';

export type SignaturePrelimScene = 'early' | 'mid' | 'done';
export type SignaturePrelimGroupCount = 16 | 20;
export type SignaturePrelimGroupSize = 3 | 4;

export const SIGNATURE_PRELIM_SCENES: { id: SignaturePrelimScene; label: string }[] = [
  { id: 'early', label: '예선 초반' },
  { id: 'mid', label: '예선 중반' },
  { id: 'done', label: '예선 종료' },
];

export const prelimSceneOf = (v: string | null): SignaturePrelimScene =>
  v === 'early' || v === 'done' ? v : 'mid';

export interface SignaturePrelimOptions {
  scene: SignaturePrelimScene;
  /** 조 수 — 20(60팀 · 기본) / 16(48팀 · 검토용). */
  groups?: SignaturePrelimGroupCount;
  /** 조 크기 — 3(기본) / 4(예전 검토용 · 정식 지원 아님). */
  size?: SignaturePrelimGroupSize;
  /** 마지막 N개 조를 2팀 조로 만든다(조당 2~3팀 — 실제 배정 결과처럼 섞인 조 구성 확인용). */
  pairs?: number;
}

const QUALIFY = 2;
const COURT_COUNT = 10;
/** 쉬는 코트 — 기존 Demo 와 같다. */
const CLOSED_COURT = 10;

/** 진행 중 경기를 1번 코트부터 채운다(쉬는 코트 제외). 기존 Demo 의 코트 규칙과 같다. */
function courtsWith(playing: ArenaCourtMatch[]): ArenaCourt[] {
  const usable = Array.from({ length: COURT_COUNT }, (_, i) => i + 1).filter((n) => n !== CLOSED_COURT);
  const byCourt = new Map<number, ArenaCourtMatch>();
  playing.slice(0, usable.length).forEach((m, i) => byCourt.set(usable[i], m));
  return Array.from({ length: COURT_COUNT }, (_, i) => {
    const courtNo = i + 1;
    return {
      courtNo,
      displayName: courtNo === 1 ? '센터코트' : null,
      active: courtNo !== CLOSED_COURT,
      now: byCourt.get(courtNo) ?? null,
    };
  });
}

type Kind = 'pre' | 'starting' | 'in_progress' | 'age_check' | 'withdrawn' | 'final';

interface RowValues {
  played?: number; wins?: number; losses?: number; gameDiff?: number;
  rank?: number | null; autoRank?: number; qualificationStatus?: QualificationStatus; withdrawn?: boolean;
}

function row(teamNo: number, v: RowValues): ArenaStandingRow {
  const t = arenaDemoTeam(teamNo, v.withdrawn ?? false);
  return {
    teamNo, player1Name: t.player1Name, player2Name: t.player2Name, withdrawn: t.withdrawn,
    played: v.played ?? 0, wins: v.wins ?? 0, losses: v.losses ?? 0, gameDiff: v.gameDiff ?? 0,
    rank: v.rank ?? null, autoRank: v.autoRank ?? 1, qualificationStatus: v.qualificationStatus ?? 'PENDING',
  };
}

/** 조 하나 — 서버 응답을 흉내 낸 값. playing 은 이 조에서 지금 코트에 올라간 경기(없으면 null).
 *   firstTeam = 이 조 첫 팀 번호(조 크기가 섞여도 팀 번호가 겹치지 않게 앞 조들에서 이어 받는다). */
function groupOf(groupNo: number, size: number, kind: Kind, firstTeam: number): { group: ArenaGroup; playing: ArenaCourtMatch | null } {
  const t = Array.from({ length: size }, (_, i) => firstTeam + i);
  const expected = (size * (size - 1)) / 2;
  const base = { groupNo, members: size, expectedMatches: expected, cancelledMatches: 0 };
  const match = (a: number, b: number): ArenaCourtMatch => ({
    matchNo: groupNo * 10 + a, stage: 'preliminary', groupNo, team1: arenaDemoTeam(a), team2: arenaDemoTeam(b),
  });
  let completed = 0;
  let status: GroupRankingStatus = 'PROVISIONAL';
  let rows: ArenaStandingRow[];
  let playing: ArenaCourtMatch | null = null;

  switch (kind) {
    case 'final': {
      // 승수 size-1 … 0, 득실 차등 — 1·2위 진출 확정(2팀 조는 두 팀 모두 진출 — 서버 규칙: 순위 ≤ 2).
      const diffs = size === 2 ? [6, -6] : size === 3 ? [7, 1, -8] : [10, 3, -4, -9];
      rows = t.map((n, i) => row(n, {
        played: size - 1, wins: size - 1 - i, losses: i, gameDiff: diffs[i], rank: i + 1, autoRank: i + 1,
        qualificationStatus: i < QUALIFY ? 'QUALIFIED' : 'NOT_QUALIFIED',
      }));
      completed = expected; status = 'FINAL';
      break;
    }
    case 'age_check': {
      // 경기는 끝났지만 승률 · 득실이 같은 동률이 남음 → rank null (임의 순위 없음).
      if (size === 3) {
        rows = t.map((n) => row(n, { played: 2, wins: 1, losses: 1, gameDiff: 0, rank: null, autoRank: 1 }));
      } else {
        rows = [
          row(t[0], { played: 3, wins: 3, losses: 0, gameDiff: 9, rank: 1, autoRank: 1, qualificationStatus: 'QUALIFIED' }),
          ...t.slice(1).map((n) => row(n, { played: 3, wins: 1, losses: 2, gameDiff: -3, rank: null, autoRank: 2 })),
        ];
      }
      completed = expected; status = 'AGE_CHECK_REQUIRED';
      break;
    }
    case 'withdrawn': {
      rows = [
        row(t[0], { played: 1, wins: 1, losses: 0, gameDiff: 3, rank: 1, autoRank: 1, qualificationStatus: 'QUALIFIED' }),
        row(t[1], { played: 1, wins: 0, losses: 1, gameDiff: -3, rank: 2, autoRank: 2, qualificationStatus: 'QUALIFIED' }),
        ...t.slice(2).map((n, i) => row(n, { withdrawn: true, rank: null, autoRank: 3 + i, qualificationStatus: 'NOT_QUALIFIED' })),
      ];
      completed = 1;
      break;
    }
    case 'in_progress': {
      // 1번 팀이 2번 팀을 이김(완료 1). 3번 · 4번 팀이 지금 코트에서 경기 중.
      //   2팀 조는 경기가 하나뿐이라 '진행 중'은 첫 경기가 코트에 올라간 장면(starting)과 같다.
      if (size === 2) {
        rows = t.map((n) => row(n, {}));
        playing = match(t[0], t[1]);
        break;
      }
      rows = [
        row(t[0], { played: 1, wins: 1, losses: 0, gameDiff: 4, rank: 1, autoRank: 1 }),
        row(t[1], { played: 1, wins: 0, losses: 1, gameDiff: -4, rank: 2, autoRank: 2 }),
        ...t.slice(2).map((n) => row(n, { rank: null, autoRank: 3 })),
      ];
      completed = 1;
      playing = size === 3 ? match(t[1], t[2]) : match(t[2], t[3]);
      break;
    }
    case 'starting':
      // 조 첫 경기가 코트에 올라감 — 완료 경기는 아직 없다(순위 없음).
      rows = t.map((n) => row(n, {}));
      playing = match(t[0], t[1]);
      break;
    case 'pre':
    default:
      rows = t.map((n) => row(n, {}));
      break;
  }
  return { group: { ...base, completedMatches: completed, rankingStatus: status, rows }, playing };
}

function kindsFor(scene: SignaturePrelimScene, count: number, sizes: number[]): Kind[] {
  return Array.from({ length: count }, (_, i) => {
    const g = i + 1;
    const size = sizes[i];
    if (scene === 'done') return 'final';
    if (scene === 'early') return g <= 9 ? 'starting' : 'pre';
    // 중반 — 앞 30% 확정, 한 조는 동률 확인, (3팀 조라면) 한 조는 기권, 이어서 진행 중(최대 8조), 나머지 경기 전.
    const finals = Math.round(count * 0.3);
    if (g <= finals) return 'final';
    // 2팀 조는 동률 확인 · 기권 장면을 만들지 않는다(경기가 하나뿐이다).
    if (g === finals + 1) return size === 2 ? 'final' : 'age_check';
    if (size === 3 && g === finals + 2) return 'withdrawn';
    const live0 = finals + (sizes[0] === 4 ? 2 : 3);
    if (g >= live0 && g < live0 + 8) return 'in_progress';
    return 'pre';
  });
}

/** Signature 예선 스냅샷. 운영 Arena 가 RPC 결과를 정규화해 만드는 것과 같은 모양이다. */
export function buildSignaturePrelimSnapshot(o: SignaturePrelimOptions): ArenaSnapshot {
  const count = o.groups ?? 20;
  const size = o.size ?? 3;
  const pairs = size === 3 ? Math.max(0, Math.min(o.pairs ?? 0, count)) : 0;
  // 기존 Demo fixture 에 있는 장면은 그대로 쓴다.
  if (count === 20 && size === 3 && pairs === 0 && (o.scene === 'mid' || o.scene === 'done')) {
    return { ...buildArenaDemoSnapshot('preliminary', o.scene), slug: 'arena-signature-prelim' };
  }
  // 조 크기 — 마지막 pairs 개 조만 2팀. 팀 번호는 앞 조에서 이어진다.
  const sizes = Array.from({ length: count }, (_, i) => (i >= count - pairs ? 2 : size));
  const firsts = sizes.reduce<number[]>((acc, s, i) => { acc.push(i === 0 ? 1 : acc[i - 1] + sizes[i - 1]); return acc; }, []);
  const built = kindsFor(o.scene, count, sizes).map((k, i) => groupOf(i + 1, sizes[i], k, firsts[i]));
  const playing = built.map((b) => b.playing).filter((m): m is ArenaCourtMatch => m !== null);
  return {
    slug: 'arena-signature-prelim',
    mode: 'preliminary',
    tournamentTitle: '2026 TEYEON OPEN · DEMO',
    courts: courtsWith(playing),
    groups: built.map((b) => b.group),
    qualifyPerGroup: QUALIFY,
    bracket: null,
  };
}
